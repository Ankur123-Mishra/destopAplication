import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { List } from "react-window";
import { useLocation, useMatch, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import Header from "../components/Header";
import IdCardRenderer from "../components/IdCardRenderer";
import IdCardBackPreview from "../components/IdCardBackPreview";
import FabricIdCardGenerator from "../components/FabricIdCardGenerator";
import {
  getTemplateById,
  getInternalTemplateId,
} from "../data/idCardTemplates";
import { getFabricTemplateById } from "../data/fabricTemplatesStorage";
import { getUploadedTemplateById } from "../data/uploadedTemplatesStorage";
import { deductTemplateDownloadPoints } from "../api/dashboard";
import * as offlineApi from "../api/dashboard";
import * as onlineApi from "../api/network_backend";
import { API_BASE_URL } from "../api/config";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { flushSync } from "react-dom";
import {
  USE_DATA_EXPORT_RENDERER_PRIMARY,
  cardSupportsDataExportBack,
  cardSupportsDataExportRenderer,
  renderCardSideToBlob,
  getCardExportPreset,
  getPageExportPreset,
  canRenderSpreadPageDataOnly,
  renderSpreadPageToJpegBlob,
  renderSpreadPageToPngBlob,
  renderSpreadPageToCanvas,
  blobToDataUrl,
} from "../utils/dataExportCanvasRenderer";

// A4 size (mm). Preview and print show as many cards per page as fit on one A4.
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

/** Preview/print paper presets (dimensions match product UI labels; inches × 25.4 → mm). */
const INCH_TO_MM = 25.4;
const PAGE_PRESET_MM = {
  c1: { w: 8 * INCH_TO_MM, h: 12 * INCH_TO_MM },
  c2: { w: 12 * INCH_TO_MM, h: 18 * INCH_TO_MM },
  c3: { w: 4 * INCH_TO_MM, h: 6 * INCH_TO_MM },
  a3: { w: 11.7 * INCH_TO_MM, h: 16.5 * INCH_TO_MM },
  a4: { w: A4_WIDTH_MM, h: A4_HEIGHT_MM },
  a5: { w: 5.8 * INCH_TO_MM, h: 8.3 * INCH_TO_MM },
  p1: { w: 8.5 * INCH_TO_MM, h: 14 * INCH_TO_MM },
};

const PAGE_PRESET_DISPLAY_NAME = {
  c1: "C1",
  c2: "C2",
  c3: "C3",
  a3: "A3",
  a4: "A4",
  a5: "A5",
  p1: "P1",
};
const PRINT_PAGE_MARGIN_MM = 4;
const PRINT_GAP_MM = 4;
/** Default horizontal/vertical gap between cards in the preview grid (mm). */
const DEFAULT_PREVIEW_GRID_GAP_MM = 1;
const DEFAULT_CARD_WIDTH_MM = 90;
const DEFAULT_CARD_HEIGHT_MM = 57;
/** Build preview/print card rows in slices so opening preview stays instant for large lists. */
const PREVIEW_CARDS_CHUNK_SIZE = 64;
/** Render preview pages in small batches so first pages appear immediately. */
const PREVIEW_PAGES_RENDER_CHUNK_SIZE = 1;
const PREVIEW_PAGES_RENDER_DELAY_MS = 16;
/** Stable fallback so `studentsForPreviewPrint` / card-building effects are not invalidated every render. */
const EMPTY_STUDENTS = [];

async function uint8FromBlob(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function fullPhotoUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("http")) return url;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("blob:")) return url;
  const base = API_BASE_URL.replace(/\/$/, "");
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

/** Strip erroneous trailing "– A" / "- A" from class labels (same as ClassIdCardsWizard). */
function normalizeClassNameForDisplay(label) {
  if (!label || typeof label !== "string") return label;
  return label.replace(/\s*[–-]\s*A\s*$/i, "").trim();
}

/** Class + section for ID card preview without duplicating section or a stray leading " - …". */
function formatStudentClassForIdCard(cls) {
  if (!cls) return "";
  const name = String(cls.className ?? "").trim();
  const sec = String(cls.section ?? "").trim();
  if (!name && !sec) return "";
  let combined;
  if (name && sec) {
    const nl = name.toLowerCase();
    const sl = sec.toLowerCase();
    const alreadyHasSection =
      nl.endsWith(`-${sl}`) ||
      nl.endsWith(` - ${sl}`) ||
      nl.endsWith(` ${sl}`);
    combined = alreadyHasSection ? name : `${name} - ${sec}`;
  } else {
    combined = name || sec;
  }
  return normalizeClassNameForDisplay(combined);
}

function isFullApiCanvasTemplate(t) {
  return Boolean(
    t &&
    typeof t === "object" &&
    t.frontImage &&
    Array.isArray(t.elements) &&
    t.elements.length > 0,
  );
}

function templateLayoutScore(t) {
  if (!isFullApiCanvasTemplate(t)) return -1;
  const frontCount = Array.isArray(t.elements) ? t.elements.length : 0;
  const backCount = Array.isArray(t.backElements) ? t.backElements.length : 0;
  const hasBackArt = t.backImage ? 1 : 0;
  return frontCount + backCount + hasBackArt;
}

/** Same localStorage key as ClassIdCardsWizard — "saved ID cards" flag per school. */
const SAVED_ID_CARDS_FLAG_PREFIX = "classIdCardsWizard.savedIdCardsSchool:";

function readSavedIdCardsFlagForSchool(schoolId) {
  if (!schoolId || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(`${SAVED_ID_CARDS_FLAG_PREFIX}${schoolId}`) === "1";
  } catch {
    return false;
  }
}

function rawStudentsIndicateSavedIdCards(rawStudents) {
  if (!Array.isArray(rawStudents)) return false;
  return rawStudents.some((s) => {
    if (!s || typeof s !== "object") return false;
    if (s.hasTemplate === true) return true;
    const t = s.template;
    return isFullApiCanvasTemplate(t);
  });
}

function computeSchoolHasSavedIdCards(schoolId, rawStudents) {
  return readSavedIdCardsFlagForSchool(schoolId) || rawStudentsIndicateSavedIdCards(rawStudents);
}

/**
 * Same logic as ClassIdCardsWizard pickSchoolLevelTemplate — school-level uploaded layout for Edit template.
 */
function pickSchoolLevelTemplate(studentsRes, schoolId, schoolsList, _isOnlineMode) {
  const raw = studentsRes?.students ?? [];
  let schoolDoc = null;
  const first = raw[0];
  if (
    first &&
    typeof first.schoolId === "object" &&
    first.schoolId != null &&
    !Array.isArray(first.schoolId)
  ) {
    schoolDoc = first.schoolId;
  } else if (first && typeof first.school === "object" && first.school != null) {
    schoolDoc = first.school;
  }
  if (!schoolDoc && Array.isArray(schoolsList) && schoolId) {
    const s = schoolsList.find((x) => x._id === schoolId);
    if (s) schoolDoc = s;
  }

  const fallbackOfflineTemplate = offlineApi.resolveSchoolUploadedPhotographerTemplate(schoolId, schoolDoc);
  const responseTemplate = studentsRes?.template;
  if (isFullApiCanvasTemplate(responseTemplate)) {
    if (
      isFullApiCanvasTemplate(fallbackOfflineTemplate) &&
      templateLayoutScore(fallbackOfflineTemplate) > templateLayoutScore(responseTemplate)
    ) {
      return fallbackOfflineTemplate;
    }
    return responseTemplate;
  }

  return fallbackOfflineTemplate;
}

/**
 * GET /schools/:id/students often puts canvas layout on response.template; each student.template
 * may only hold templateId/status. Merge so preview uses the same art + elements as class-wise APIs.
 *
 * student.template may still pass isFullApiCanvasTemplate with a partial elements[] while the
 * class/school root template has the full layout from Edit template. Prefer root layout when
 * the root is a full canvas template so preview shows every saved front element.
 */
function mergeSchoolRootTemplateIntoStudent(student, rootTemplate) {
  const st = student?.template;
  if (isFullApiCanvasTemplate(rootTemplate)) {
    return {
      ...rootTemplate,
      ...(st && typeof st === "object" ? st : {}),
      frontImage: rootTemplate.frontImage,
      backImage: rootTemplate.backImage,
      elements: rootTemplate.elements,
      ...(rootTemplate.backElements != null ? { backElements: rootTemplate.backElements } : {}),
    };
  }
  if (isFullApiCanvasTemplate(st)) return st;
  return st ?? null;
}

/** Copy common API top-level fields into extraFields so canvas dataField bindings resolve (all-students vs class payloads differ). */
function mergeExtraFieldsFromStudent(student) {
  const ex = {
    ...(student?.extraFields && typeof student.extraFields === "object"
      ? student.extraFields
      : {}),
  };
  const fill = (key, val) => {
    if (val == null || val === "") return;
    if (ex[key] != null && ex[key] !== "") return;
    ex[key] = val;
  };
  const resolveRollNo = (s) =>
    s?.rollNo ??
    s?.sNo ??
    s?.sno ??
    s?.srNo ??
    s?.srno ??
    s?.serialNo ??
    s?.serial ??
    s?.admissionNo ??
    s?.uniqueCode ??
    "";
  fill("fatherName", student.fatherName);
  fill("motherName", student.motherName);
  fill("guardianName", student.guardianName);
  fill("className", student.className);
  fill("section", student.section);
  fill("rollNo", resolveRollNo(student));
  fill("admissionNo", student.admissionNo);
  fill("uniqueCode", student.uniqueCode);
  fill("phone", student.phone ?? student.mobile);
  fill("mobile", student.mobile ?? student.phone);
  fill("email", student.email);
  fill("dateOfBirth", student.dateOfBirth ?? student.dob ?? student.birthDate);
  fill("gender", student.gender);
  fill("bloodGroup", student.bloodGroup);
  fill("house", student.house);
  fill("marking", student.marking);
  fill("status", student.status);
  fill("fatherPrimaryContact", student.fatherPrimaryContact);
  fill("motherPrimaryContact", student.motherPrimaryContact);
  fill("photoNo", student.photoNo ?? "");
  fill("studentName", student.studentName);
  return ex;
}

function resolveClassNameForIdCard(student) {
  if (
    typeof student.className === "string" &&
    student.className.trim() !== ""
  ) {
    return normalizeClassNameForDisplay(student.className.trim());
  }
  if (student.class && typeof student.class === "object") {
    return formatStudentClassForIdCard(student.class);
  }
  if (student.classId && typeof student.classId === "object") {
    return formatStudentClassForIdCard(student.classId);
  }
  return formatStudentClassForIdCard(student.class);
}

function compareClassForDisplay(a, b) {
  const aNameRaw = String(a?.className ?? "").trim();
  const bNameRaw = String(b?.className ?? "").trim();
  const aNameNum = Number.parseFloat(aNameRaw);
  const bNameNum = Number.parseFloat(bNameRaw);
  const aHasNum = Number.isFinite(aNameNum);
  const bHasNum = Number.isFinite(bNameNum);

  if (aHasNum && bHasNum && aNameNum !== bNameNum) return aNameNum - bNameNum;
  if (aHasNum !== bHasNum) return aHasNum ? -1 : 1;

  const nameCmp = aNameRaw.localeCompare(bNameRaw, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (nameCmp !== 0) return nameCmp;

  const aSection = String(a?.section ?? "").trim();
  const bSection = String(b?.section ?? "").trim();
  return aSection.localeCompare(bSection, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortClassesForDisplay(list) {
  return [...list].sort(compareClassForDisplay);
}

function getStudentClassIdStringForSort(student) {
  if (!student || typeof student !== "object") return null;
  if (typeof student.classId === "string" && student.classId.trim() !== "")
    return student.classId.trim();
  if (student.classId && typeof student.classId === "object") {
    const id = student.classId._id ?? student.classId.id;
    if (id != null && id !== "") return String(id);
  }
  return null;
}

/** Same shape as class rows in `classes` — used with compareClassForDisplay. */
function getPseudoClassForSort(student) {
  return {
    className:
      (typeof student.className === "string" && student.className.trim() !== ""
        ? student.className
        : student.classId && typeof student.classId === "object"
          ? String(student.classId.className ?? "").trim()
          : "") || "",
    section:
      (typeof student.section === "string" ? student.section : "").trim() ||
      (student.classId && typeof student.classId === "object"
        ? String(student.classId.section ?? "").trim()
        : "") ||
      "",
  };
}

/**
 * Class rank for preview ordering: match school `classes` list when possible,
 * otherwise infer position from class name/section (smallest class first).
 */

function getStudentClassRankForPreview(student, classesOrdered) {
  const list = classesOrdered ?? [];
  const cid = getStudentClassIdStringForSort(student);
  if (cid && list.length > 0) {
    const idx = list.findIndex((c) => c && c._id === cid);
    if (idx >= 0) return idx;
  }
  const pseudo = getPseudoClassForSort(student);
  if (list.length === 0) return 0;
  let insertPos = 0;
  while (
    insertPos < list.length &&
    compareClassForDisplay(list[insertPos], pseudo) < 0
  ) {
    insertPos += 1;
  }
  return insertPos;
}

function sortStudentsForPreviewPrint(students, classesOrdered) {
  if (!Array.isArray(students) || students.length <= 1) return students;
  const list = classesOrdered ?? [];
  const hasClasses = list.length > 0;

  const nameKey = (s) =>
    String(s.studentName ?? s.name ?? "")
      .trim()
      .toLocaleLowerCase();

  return [...students].sort((a, b) => {
    if (!hasClasses) {
      const cmp = compareClassForDisplay(
        getPseudoClassForSort(a),
        getPseudoClassForSort(b),
      );
      if (cmp !== 0) return cmp;
      return nameKey(a).localeCompare(nameKey(b));
    }
    const ra = getStudentClassRankForPreview(a, list);
    const rb = getStudentClassRankForPreview(b, list);
    if (ra !== rb) return ra - rb;
    return nameKey(a).localeCompare(nameKey(b));
  });
}

/** Saved ID card / template present — used for bulk preview and per-row preview. */
function studentHasRenderableSavedCard(
  s,
  schoolListResponse = null,
  options = {},
) {
  if (!s || typeof s !== "object") return false;
  const { allowRootTemplateFallback = true } = options;
  const t = s.template;
  if (isFullApiCanvasTemplate(t)) return true;
  if (s.hasTemplate === true) return true;
  if (t && typeof t === "object" && t.templateId) return true;
  const root = schoolListResponse?.template;
  const rootOk = isFullApiCanvasTemplate(root);

  if (schoolListResponse == null) {
    return false;
  }

  // School/class API often omits per-student flags when photo is missing (hasTemplate false),
  // but the shared root template still applies — preview with an empty photo slot.
  if (allowRootTemplateFallback && rootOk) return true;
  return false;
}


function studentHasUploadedPhoto(s) {
  if (!s || typeof s !== "object") return false;
  if (s.hasPhoto === true) return true;
  if (typeof s.photoUrl === "string" && s.photoUrl.trim() !== "") return true;
  return false;
}

function preloadImageSrc(src) {
  if (!src || typeof src !== "string" || !src.trim()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const im = new Image();
    const done = () => resolve();
    im.onload = done;
    im.onerror = done;
    im.src = src;
  });
}

/** Decode student photo + template art before mounting preview cells so layout and image appear together. */
function preloadCardVisualAssets(card) {
  if (!card || typeof card !== "object") return Promise.resolve();
  const urls = [];
  if (card.studentImage) urls.push(card.studentImage);
  if (card.colorCodeImage) urls.push(card.colorCodeImage);
  const ut = card.uploadedTemplate;
  if (ut) {
    if (ut.frontImage) urls.push(ut.frontImage);
    if (ut.backImage) urls.push(ut.backImage);
  }
  if (card.templateId?.startsWith("fabric-")) {
    const ft = getFabricTemplateById(card.templateId);
    if (ft?.backgroundDataUrl) urls.push(ft.backgroundDataUrl);
  }
  return Promise.all(urls.map(preloadImageSrc));
}

/** Virtual list row height (must match CSS: card padding + two lines + list gap). */
const SAVED_ID_STUDENT_ROW_HEIGHT = 80;
const SAVED_ID_STUDENT_LIST_VIEWPORT_HEIGHT = 600;

const VirtualizedSavedIdStudentRow = React.memo(function VirtualizedSavedIdStudentRow({
  index,
  style,
  ariaAttributes,
  students,
  studentToCard,
  studentHasRenderableSavedCard,
  schoolAllStudentsData,
  templateStatus,
  isAllSchoolStudents,
  isViewTemplateFlow,
  getTemplateName,
  formatStudentClassForIdCard,
  requestOpenCardPreview,
  setEditStudentData,
  formatToDDMMYYYYDot,
}) {
  const student = students[index];
  if (!student) return null;
  const card = studentToCard(student);
  const hasUploadedPhoto = studentHasUploadedPhoto(student);
  const canOpenPreview =
    hasUploadedPhoto &&
    studentHasRenderableSavedCard(
      student,
      isAllSchoolStudents ? schoolAllStudentsData : templateStatus,
      isAllSchoolStudents ? { allowRootTemplateFallback: false } : undefined,
    );
  return (
    <div
      style={{ ...style, paddingBottom: 0 }}
      {...ariaAttributes}
    >
      <div
        style={{ display: "flex", gap: "8px", alignItems: "center", height: "100%" }}
      >
        <button
          type="button"
          className="saved-idcard-item"
          disabled={!canOpenPreview}
          title={
            !canOpenPreview
              ? !hasUploadedPhoto
                ? "Photo not uploaded for this student"
                : isViewTemplateFlow
                  ? "No template data for this student"
                  : "No saved ID card for this student"
              : undefined
          }
          style={{
            flex: 1,
            ...(hasUploadedPhoto
              ? {}
              : {
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderColor: "rgba(255,255,255,0.2)",
                }),
            ...(!canOpenPreview ? { opacity: 0.55, cursor: "not-allowed" } : {}),
          }}
          onClick={() => {
            if (!canOpenPreview) return;
            void requestOpenCardPreview(student);
          }}
        >
          <span className="saved-idcard-name">{student.studentName}</span>
          <span className="text-muted saved-idcard-meta">
            {canOpenPreview ? (
              <>
                {getTemplateName(card.templateId, card)} ·{" "}
                {student.admissionNo || student.rollNo || ""} ·{" "}
                {student.template?.status || ""}
              </>
            ) : !hasUploadedPhoto ? (
              <>
                {formatStudentClassForIdCard(student.class) || "—"} ·{" "}
                {student.admissionNo || student.rollNo || ""} · Photo missing
              </>
            ) : (
              <>
                {formatStudentClassForIdCard(student.class) || "—"} ·{" "}
                {student.admissionNo || student.rollNo || ""}
                {isAllSchoolStudents ? " · No saved card" : ""}
              </>
            )}
          </span>
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{
            flexShrink: 0,
            padding: "6px 12px",
            fontSize: "0.85rem",
            height: "auto",
          }}
          onClick={(e) => {
            e.stopPropagation();
            const dobVal = student.dateOfBirth || student.dob || "";
            setEditStudentData({
              ...student,
              dateOfBirth: formatToDDMMYYYYDot(dobVal),
              dob: formatToDDMMYYYYDot(dobVal),
            });
          }}
        >
          Edit
        </button>
      </div>
    </div>
  );
});

function formatDateDMY(input) {
  if (!input) return "";
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const dd = String(input.getDate()).padStart(2, "0");
    const mm = String(input.getMonth() + 1).padStart(2, "0");
    const yy = String(input.getFullYear());
    return `${dd}/${mm}/${yy}`;
  }
  const s = String(input).trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    const dd = String(m2[1]).padStart(2, "0");
    const mm = String(m2[2]).padStart(2, "0");
    return `${dd}/${mm}/${m2[3]}`;
  }
  return s;
}

function formatToDDMMYYYYDot(input) {
  if (!input) return "";
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const dd = String(input.getDate()).padStart(2, "0");
    const mm = String(input.getMonth() + 1).padStart(2, "0");
    const yy = String(input.getFullYear());
    return `${dd}.${mm}.${yy}`;
  }
  const s = String(input).trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    const dd = String(m2[1]).padStart(2, "0");
    const mm = String(m2[2]).padStart(2, "0");
    return `${dd}.${mm}.${m2[3]}`;
  }
  if (s.includes("T")) return s.split("T")[0].replace(/-/g, ".");
  return s;
}

function convertToMm(value, unit) {
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return value;

  switch (unit) {
    case "cm":
      return numValue * 10;
    case "inch":
      return numValue * 25.4;
    case "px":
      return numValue * 0.264583;
    case "mm":
    default:
      return numValue;
  }
}

// Allow smaller custom sizes (user wants < 50mm).
// Keep a small but practical minimum of 1mm (0.1cm).
const MIN_PAGE_CM = 0.1;
const MAX_PAGE_CM = 120;
const MIN_PAGE_MM = MIN_PAGE_CM * 10;
const MAX_PAGE_MM = MAX_PAGE_CM * 10;
/** Keep typing smooth but apply page resize almost instantly. */
const PAGE_SIZE_INPUT_DEBOUNCE_MS = 40;
/** Keep spacing fields responsive while avoiding heavy re-layout on every keystroke. */
const PREVIEW_GAP_INPUT_DEBOUNCE_MS = 120;

const MIN_PREVIEW_GAP_MM = 0;
const MAX_PREVIEW_GAP_MM = 40;

function clampPreviewGapMm(value, fallback = DEFAULT_PREVIEW_GRID_GAP_MM) {
  const n =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value ?? "").replace(",", ".").trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PREVIEW_GAP_MM, Math.max(MIN_PREVIEW_GAP_MM, n));
}

const DEFAULT_PREVIEW_PAGE_BG = "#ffffff";

/** Preview download: high-res capture + max JPEG quality (per-card, page ZIP, PDF raster). */
const PREVIEW_EXPORT_HTML2CANVAS_SCALE = 7;
const PREVIEW_EXPORT_JPEG_QUALITY = 1;
/** Bulk ZIP / many cards: still sharp, faster `toDataURL` than 1.0. */
const PREVIEW_EXPORT_JPEG_QUALITY_BULK = 0.94;

/** Use faster html2canvas settings + parallel capture when preview has many pages/cards (not only all-school). */
const FAST_PREVIEW_EXPORT_THRESHOLD_PAGES = 6;
const FAST_PREVIEW_EXPORT_THRESHOLD_CARDS = 15;
/** Parallel capture finishes many cards per tick; throttle progress UI so the counter moves ~this many steps per second. */
const FAST_EXPORT_PROGRESS_UPDATES_PER_SEC = 3;
/** Full-page JPEG/PDF raster: above this, use lower scale + higher parallelism (full A4 at scale 4 is extremely slow). */
const MEGA_BULK_PAGE_THRESHOLD = 35;
/** Slightly lower quality for huge page-only exports — much faster encode, still fine for print preview. */
const PREVIEW_EXPORT_PAGE_JPEG_QUALITY_MEGA = 0.92;

/** PDF export only: JPEG embedded in jsPDF pages (does not affect standalone JPG/PNG file export). */
const PDF_EXPORT_EMBED_JPEG_QUALITY = PREVIEW_EXPORT_JPEG_QUALITY;
const PDF_EXPORT_EMBED_JPEG_QUALITY_BULK = 0.92;
const PDF_EXPORT_EMBED_JPEG_QUALITY_MEGA = 0.9;
/**
 * At or above this spread page count, skip Electron `printToPDF` and use the renderer/jsPDF path
 * (native print is less predictable for large batches).
 */
const PDF_EXPORT_SKIP_NATIVE_PRINT_MIN_PAGES = 12;
/** When native print is allowed, only for at most this many pages (small jobs). */
const PDF_EXPORT_NATIVE_PRINT_MAX_PAGES = 8;

/**
 * Large preview exports: avoid duplicate work (per-card + full page in one run). JPEG defaults to
 * page-only when the user left "both"; PNG skips per-card files. Keeps html2canvas scale low (cost ∝ scale²).
 */
const FAST_EXPORT_AUTO_PAGE_ONLY = true;

/**
 * Scales try highest first; primary follows devicePixelRatio so Retina exports stay sharp.
 * `bulk: true` (see-all school export): lower caps + fewer retries so many cards/pages finish much faster.
 */
function getHtml2CanvasExportScaleAttempts(options = {}) {
  const bulk = Boolean(options.bulk);
  const megaBulkPage = Boolean(options.megaBulkPage);
  const dpr =
    typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  /* Mega bulk: cap ~2–2.25 — cost grows with scale². */
  if (bulk && megaBulkPage) {
    const primary = Math.min(2.25, Math.max(1.5, Math.round(dpr)));
    return [...new Set([primary, 2, 1.75, 1.5, 1])]
      .filter((n) => n > 0)
      .sort((a, b) => b - a);
  }
  if (bulk) {
    const primary = Math.min(3.5, Math.max(1.5, Math.round(1.5 * dpr)));
    return [...new Set([primary, 3, 2.5, 2, 1.5, 1])]
      .filter((n) => n > 0)
      .sort((a, b) => b - a);
  }
  const primary = Math.min(
    10,
    Math.max(PREVIEW_EXPORT_HTML2CANVAS_SCALE, Math.round(4 * dpr)),
  );
  const list = [
    primary,
    PREVIEW_EXPORT_HTML2CANVAS_SCALE,
    5,
    4,
    3,
    2,
    1,
  ];
  return [...new Set(list)]
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
}

/** Ensures `<input type="color" />` gets a valid #rrggbb value. */
function normalizeHexColor(input, fallback = DEFAULT_PREVIEW_PAGE_BG) {
  if (typeof input !== "string") return fallback;
  const s = input.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function parseCmInput(value) {
  const n = Number.parseFloat(
    String(value ?? "")
      .replace(",", ".")
      .trim(),
  );
  return Number.isFinite(n) ? n : NaN;
}

/** Clamps user-entered page dimension in cm; invalid input uses fallbackCm. */
function clampPageCm(value, fallbackCm) {
  const n = parseCmInput(value);
  const cm = Number.isFinite(n) ? n : fallbackCm;
  return Math.min(MAX_PAGE_CM, Math.max(MIN_PAGE_CM, cm));
}

function parseUnitInput(value) {
  const n = Number.parseFloat(
    String(value ?? "")
      .replace(",", ".")
      .trim(),
  );
  return Number.isFinite(n) ? n : NaN;
}

function mmToUnit(mm, unit) {
  const n = Number(mm);
  if (!Number.isFinite(n)) return n;
  switch (unit) {
    case "cm":
      return n / 10;
    case "inch":
      return n / 25.4;
    case "px":
      return n / 0.264583; // 1px ~= 0.264583mm (96dpi)
    case "mm":
    default:
      return n;
  }
}

function clampPageMm(valueMm, fallbackMm) {
  const n = typeof valueMm === "number" ? valueMm : Number(valueMm);
  if (!Number.isFinite(n)) return fallbackMm;
  return Math.min(MAX_PAGE_MM, Math.max(MIN_PAGE_MM, n));
}

function getStepForUnit(unit) {
  switch (unit) {
    case "cm":
      return 0.1;
    case "inch":
      return 0.04;
    case "px":
      return 4;
    case "mm":
    default:
      return 1;
  }
}

function getGapStepForUnit(unit) {
  switch (unit) {
    case "cm":
      return 0.05;
    case "inch":
      return 0.02;
    case "px":
      return 2;
    case "mm":
    default:
      return 0.5;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Coalesces rapid progress callbacks (e.g. parallel html2canvas) to at most one UI update per interval,
 * always keeping the latest `{ current, total, label }`. Call `flush()` when a phase ends so the bar catches up.
 */
function createProgressThrottle(intervalMs, emitFn) {
  let pending = null;
  let lastEmit = 0;
  let timeoutId = null;
  const flushPending = () => {
    timeoutId = null;
    if (pending !== null) {
      emitFn(pending);
      pending = null;
      lastEmit = Date.now();
    }
  };
  return {
    emit(p) {
      pending = p;
      const now = Date.now();
      const elapsed = now - lastEmit;
      if (elapsed >= intervalMs) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        flushPending();
      } else if (!timeoutId) {
        timeoutId = setTimeout(flushPending, intervalMs - elapsed);
      }
    },
    flush() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pending !== null) {
        emitFn(pending);
        pending = null;
        lastEmit = Date.now();
      }
    },
  };
}

class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelledError";
  }
}

function isExportCancelledError(e) {
  return e instanceof ExportCancelledError || e?.name === "ExportCancelledError";
}

/** Resolves in `ms` but throws ExportCancelledError if `shouldAbort()` becomes true. */
async function abortableDelay(ms, shouldAbort, chunkMs = 120) {
  const fn = typeof shouldAbort === "function" ? shouldAbort : () => false;
  let left = Math.max(0, ms);
  while (left > 0) {
    if (fn()) throw new ExportCancelledError();
    const step = Math.min(chunkMs, left);
    await delay(step);
    left -= step;
  }
}

/**
 * Like batched `Promise.all`, but keeps `concurrency` tasks in flight: the next item
 * starts as soon as any slot finishes (avoids long gaps waiting on the slowest in a batch).
 */
async function mapWithConcurrency(items, concurrency, mapper, shouldAbort) {
  const n = items?.length ?? 0;
  if (!n) return [];
  const limit = Math.max(1, Math.min(concurrency, n));
  const results = new Array(n);
  let next = 0;
  const abortFn = typeof shouldAbort === "function" ? shouldAbort : () => false;

  async function worker() {
    while (true) {
      if (abortFn()) throw new ExportCancelledError();
      const i = next;
      next += 1;
      if (i >= n) return;
      results[i] = await mapper(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * HashRouter-safe: same intent as `useMatch(…/school/:id/all-students)` but avoids
 * missing bulk export optimizations if the match pattern ever fails to line up.
 * Does not match `/school/…/class/…` (e.g. a class whose id is literally "all-students").
 */
function pathnameIsSchoolAllStudentsRoute(pathname, basePath) {
  if (typeof pathname !== "string" || typeof basePath !== "string") return false;
  const esc = basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${esc}/school/[^/]+/all-students/?$`).test(pathname);
}

/**
 * html2canvas respects ancestor overflow:hidden; multiline canvas address would still clip in PDF/JPG.
 * Relax overflow on the clone only (from .idcard-canvas-text--wrap up toward the page).
 */
function relaxCaptureOverflowForWrappedCanvasText(clonedDoc) {
  if (!clonedDoc?.querySelectorAll) return;
  clonedDoc.querySelectorAll(".idcard-canvas-text--wrap").forEach((el) => {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 24; depth += 1) {
      const cls = node.classList;
      if (cls?.contains("preview-overlay") || node === clonedDoc.body) break;
      if (
        cls?.contains("print-card-cell") ||
        cls?.contains("print-page") ||
        cls?.contains("preview-card-half") ||
        cls?.contains("preview-card-stack") ||
        cls?.contains("idcard-image-template-canvas")
      ) {
        node.style.setProperty("overflow", "visible", "important");
      }
      node = node.parentElement;
    }
  });
}

/** Corner crop marks sit half outside the card; html2canvas clips if any ancestor keeps overflow:hidden. */
function relaxCaptureOverflowForCropMarks(clonedDoc) {
  if (!clonedDoc?.querySelectorAll) return;
  clonedDoc.querySelectorAll(".idcard-sheet-crop-mark").forEach((el) => {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 24; depth += 1) {
      const cls = node.classList;
      if (cls?.contains("preview-overlay") || node === clonedDoc.body) break;
      node.style.setProperty("overflow", "visible", "important");
      node = node.parentElement;
    }
  });
}

/**
 * Clone-only hints so exported JPEG/PDF matches on-screen text and template art more closely.
 * Template art is rendered as a full-bleed <img> in IdCardRenderer (not CSS background-image).
 */

function applyExportRenderHintsToClone(clonedDoc) {
  if (!clonedDoc?.head) return;
  const id = "idcard-export-capture-hints";
  if (clonedDoc.getElementById(id)) return;
  const style = clonedDoc.createElement("style");
  style.id = id;
  style.textContent = `
    .print-card-cell .idcard,
    .print-card-cell .idcard * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-card-cell .idcard svg {
      shape-rendering: geometricPrecision;
    }
    /*
      html2canvas often rasterizes absolute %‑positioned overlays a little lower than
      the live preview (subpixel / flex vs capture). Nudge overlays up on the clone only
      so JPEG/PDF export matches what you see on screen.
    */
    .print-card-cell .idcard-image-template-canvas .idcard-canvas-el {
      transform: translateY(-0.4px) !important;
    }
    .print-card-cell .idcard-image-template-overlay {
      transform: translateY(-0.4px) !important;
    }
    /* Sheet corner dots: explicit px size helps html2canvas; mm-only sizing can rasterize as 0. */
    .idcard-sheet-crop-mark {
      width: 7.56px !important;
      height: 7.56px !important;
      min-width: 7.56px !important;
      min-height: 7.56px !important;
      background-color: #000000 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  `;
  clonedDoc.head.appendChild(style);
}

/**
 * Fabric.js cards: capture the backing-store canvas directly at width×height×scale.
 * html2canvas re-samples the CSS-downscaled <canvas> in the cell and looks soft/blurred.
 */

function rasterizeFabricCanvasForExport(sourceCanvas, pageBackgroundColor, scale) {
  const bg = normalizeHexColor(pageBackgroundColor);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not get 2d context for export");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out;
}

/** Base file name: mobile digits when available; otherwise student id / fallback. Unique per batch. */
function jpegBaseNameForCard(card, index, used) {
  const digits = String(card.phone ?? "").replace(/\D/g, "");
  let base;
  if (digits.length >= 4) {
    base = digits.slice(0, 48);
  } else {
    const fallback = String(
      card.studentId ?? card._id ?? `card_${index + 1}`,
    )
      .replace(/[^\w.\-]/g, "_")
      .replace(/_+/g, "_");
    base = fallback.slice(0, 48) || `card_${index + 1}`;
  }
  base = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (!base) base = `card_${index + 1}`;
  let name = base;
  let n = 2;
  while (used.has(name)) {
    name = `${base}_${n}`;
    n += 1;
  }
  used.add(name);
  return name;
}

/**
 * Prefer direct children of the print grid so nested nodes cannot inflate the count
 * (which caused JPEG export to wait forever or mismatch).
 */
function getFrontCardCellElements(wrap) {
  if (!wrap?.querySelectorAll) return [];
  const direct = wrap.querySelectorAll(
    ".preview-page--front .print-cards-grid > .print-card-cell",
  );
  if (direct.length > 0) return Array.from(direct);
  return Array.from(
    wrap.querySelectorAll(".preview-page--front .print-card-cell"),
  );
}

function getBackCardCellElements(wrap) {
  if (!wrap?.querySelectorAll) return [];
  const direct = wrap.querySelectorAll(
    ".preview-page--back .print-cards-grid > .print-card-cell",
  );
  if (direct.length > 0) return Array.from(direct);
  return Array.from(
    wrap.querySelectorAll(".preview-page--back .print-card-cell"),
  );
}

/** Resolved custom back PNG for uploaded templates (same as renderBackOnlyForPrint). */
function resolveCardBackImage(card) {
  const uploadedT =
    card.uploadedTemplate ||
    (card.templateId?.startsWith("uploaded-")
      ? getUploadedTemplateById(card.templateId)
      : null);
  return uploadedT?.backImage ?? undefined;
}

function isUploadedStyleTemplate(card) {
  return (
    card.uploadedTemplate != null ||
    (typeof card.templateId === "string" &&
      card.templateId.startsWith("uploaded-"))
  );
}

/** Show a back preview/print page for this card: built-in/fabric backs, or uploaded template with a custom back image. */
function cardShowsBackOnPreview(card) {
  return !isUploadedStyleTemplate(card) || Boolean(resolveCardBackImage(card));
}

/** Include a back JPEG for this student (skip when uploaded template has no custom back image). */
function cardExportsBackJpeg(card) {
  return cardShowsBackOnPreview(card);
}

function batchHasBackPage(pageCards) {
  if (!pageCards?.length) return false;
  return pageCards.some((c) => cardShowsBackOnPreview(c));
}

/** How many back grid cells exist in the preview DOM (one per slot on each batch that has a back page). */
function countExpectedBackDomCells(cards, cardsPerPage) {
  let n = 0;
  const batches = Math.ceil(cards.length / cardsPerPage) || 0;
  for (let b = 0; b < batches; b++) {
    const start = b * cardsPerPage;
    const pageCards = cards.slice(start, start + cardsPerPage);
    if (batchHasBackPage(pageCards)) n += pageCards.length;
  }
  return n;
}

/** Index into getBackCardCellElements() for global card index, or -1 if that batch has no back page. */
function backDomIndexForCard(cards, cardsPerPage, cardIndex) {
  const batchIndex = Math.floor(cardIndex / cardsPerPage);
  let offset = 0;
  for (let b = 0; b < batchIndex; b++) {
    const start = b * cardsPerPage;
    const pageCards = cards.slice(start, start + cardsPerPage);
    if (batchHasBackPage(pageCards)) offset += pageCards.length;
  }
  const start = batchIndex * cardsPerPage;
  const pageCards = cards.slice(start, start + cardsPerPage);
  if (!batchHasBackPage(pageCards)) return -1;
  return offset + (cardIndex - start);
}

/**
 * Writes JPEGs into a subfolder of `parentDirHandle`.
 * The folder must be chosen earlier via `showDirectoryPicker()` during a user click
 * (calling showDirectoryPicker here after async work throws "Must be handling a user gesture").
 */

async function saveJpegsToFolderWithFilePicker(
  subfolderName,
  files,
  onProgress,
  parentDirHandle,
  shouldAbort = null,
) {
  if (!parentDirHandle?.getDirectoryHandle) {
    throw new Error("No folder was selected for saving.");
  }
  const abortFn = typeof shouldAbort === "function" ? shouldAbort : () => false;
  onProgress?.({
    label: "Saving JPEG files…",
    current: 0,
    total: files.length,
  });
  const sub = await parentDirHandle.getDirectoryHandle(subfolderName, {
    create: true,
  });
  for (let i = 0; i < files.length; i++) {
    if (abortFn()) throw new ExportCancelledError();
    const f = files[i];
    onProgress?.({
      label: "Saving JPEG files…",
      current: i + 1,
      total: files.length,
    });
    const safe = String(f.filename || "card.jpg").replace(
      /[<>:"/\\|?*\x00-\x1f]/g,
      "_",
    );
    const fh = await sub.getFileHandle(safe, { create: true });
    const w = await fh.createWritable();
    if (f.blob instanceof Blob) {
      await w.write(f.blob);
    } else if (f.dataBytes instanceof Uint8Array) {
      await w.write(f.dataBytes);
    } else {
      const blob = await (await fetch(f.dataUrl)).blob();
      await w.write(blob);
    }
    await w.close();
  }
}

function makeHtml2CanvasOpts(pageBackgroundColor) {
  const bg = normalizeHexColor(pageBackgroundColor);
  return {
    useCORS: true,
    logging: false,
    backgroundColor: bg,
    imageTimeout: 25000,
    onclone(clonedDoc) {
      relaxCaptureOverflowForWrappedCanvasText(clonedDoc);
      relaxCaptureOverflowForCropMarks(clonedDoc);
      applyExportRenderHintsToClone(clonedDoc);
    },
  };
}

/**
 * High-DPI capture with scale fallback. Do not set `foreignObjectRendering: true` here:
 * in Electron/Chromium it often "succeeds" but rasterizes to a blank (solid black/white) image.
 */

async function html2canvasForExport(
  element,
  pageBackgroundColor,
  captureOpts = {},
) {
  const bulk = Boolean(captureOpts.bulk);
  const megaBulkPage = Boolean(captureOpts.megaBulkPage);
  const scaleOpts = { bulk, megaBulkPage };
  const fabricSource = element?.querySelector?.(
    ".fabric-idcard-canvas-wrap canvas",
  );
  if (
    fabricSource &&
    typeof fabricSource.width === "number" &&
    fabricSource.width > 0 &&
    typeof fabricSource.height === "number" &&
    fabricSource.height > 0
  ) {
    const scales = getHtml2CanvasExportScaleAttempts(scaleOpts);
    let lastFabricErr;
    for (const scale of scales) {
      try {
        return rasterizeFabricCanvasForExport(
          fabricSource,
          pageBackgroundColor,
          scale,
        );
      } catch (e) {
        lastFabricErr = e;
        console.warn(
          `Fabric canvas direct export (scale ${scale}) failed, retrying`,
          e,
        );
      }
    }
    console.warn(
      "Fabric direct export failed; falling back to html2canvas on cell",
      lastFabricErr,
    );
  }

  const base = makeHtml2CanvasOpts(pageBackgroundColor);
  const scales = getHtml2CanvasExportScaleAttempts(scaleOpts);
  let lastErr;
  for (const scale of scales) {
    try {
      return await html2canvas(element, {
        ...base,
        scale,
        foreignObjectRendering: false,
      });
    } catch (e) {
      lastErr = e;
      console.warn(`html2canvas (scale ${scale}) failed, retrying lower scale`, e);
    }
  }
  throw lastErr || new Error("html2canvas failed");
}

async function html2canvasWithFallback(
  element,
  pageBackgroundColor,
  captureOpts = {},
  outputFormat = "jpeg",
) {
  const canvas = await html2canvasForExport(
    element,
    pageBackgroundColor,
    captureOpts,
  );
  if (outputFormat === "png") {
    return canvas.toDataURL("image/png");
  }
  const q =
    typeof captureOpts.jpegQuality === "number"
      ? captureOpts.jpegQuality
      : PREVIEW_EXPORT_JPEG_QUALITY;
  return canvas.toDataURL("image/jpeg", q);
}

function canUseElectronNativeCapture() {
  return (
    typeof window !== "undefined" &&
    window.electron &&
    typeof window.electron.captureViewRect === "function"
  );
}

function canUseElectronPrintToPdf() {
  return (
    typeof window !== "undefined" &&
    window.electron &&
    typeof window.electron.printToPdf === "function"
  );
}

/** While set, preview toolbar + progress UI are removed from layout so capturePage() only sees card/page pixels. */
const EXPORT_NATIVE_CAPTURE_HIDE_CHROME_CLASS =
  "export-native-capture-hide-chrome";

/**
 * `webContents.capturePage(rect)` only snapshots **on-screen** pixels. Elements taller/wider than
 * the viewport (typical full preview pages in mm) get clipped — truncated labels, wrong grid, blank fields.
 * Those must use html2canvas, which rasterizes the full DOM subtree.
 */
function shouldUseHtml2CanvasInsteadOfNativeCapture(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return true;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return true;
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const m = 6;
  if (r.width > iw - m || r.height > ih - m) return true;
  if (r.top < m || r.left < m) return true;
  if (r.bottom > ih - m || r.right > iw - m) return true;
  return false;
}

function getPhysicalRectForCapture(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  el.scrollIntoView({ block: "center", inline: "nearest" });
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const left = r.left * dpr;
  const top = r.top * dpr;
  const right = r.right * dpr;
  const bottom = r.bottom * dpr;
  const x = Math.floor(left);
  const y = Math.floor(top);
  const width = Math.max(1, Math.ceil(right) - x);
  const height = Math.max(1, Math.ceil(bottom) - y);
  return { x, y, width, height };
}

async function electronCaptureElementToDataUrl(
  el,
  outputFormat,
  jpegQuality = PREVIEW_EXPORT_JPEG_QUALITY,
) {
  document.body.classList.add(EXPORT_NATIVE_CAPTURE_HIDE_CHROME_CLASS);
  try {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const rect = getPhysicalRectForCapture(el);
    if (!rect) throw new Error("Could not measure element for capture.");
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const wantPng = outputFormat === "png";
    const res = await window.electron.captureViewRect({
      ...rect,
      format: wantPng ? "png" : "jpeg",
      jpegQuality: wantPng ? undefined : jpegQuality,
    });
    if (!res?.success) {
      throw new Error(res?.error || "Native capture failed.");
    }
    const mime = res.mime || (wantPng ? "image/png" : "image/jpeg");
    return `data:${mime};base64,${res.dataBase64}`;
  } finally {
    document.body.classList.remove(EXPORT_NATIVE_CAPTURE_HIDE_CHROME_CLASS);
  }
}

/** Electron: fast viewport capture when the node fully fits on screen; else html2canvas (full DOM raster). */
async function rasterizeElementForExport(
  el,
  pageBackgroundColor,
  captureOpts = {},
  outputFormat = "jpeg",
) {
  const q =
    typeof captureOpts.jpegQuality === "number"
      ? captureOpts.jpegQuality
      : outputFormat === "png"
        ? undefined
        : PREVIEW_EXPORT_JPEG_QUALITY;
  if (canUseElectronNativeCapture() && !shouldUseHtml2CanvasInsteadOfNativeCapture(el)) {
    try {
      return await electronCaptureElementToDataUrl(el, outputFormat, q);
    } catch (e) {
      console.warn("Native capture failed, using html2canvas.", e);
    }
  }
  return html2canvasWithFallback(
    el,
    pageBackgroundColor,
    captureOpts,
    outputFormat,
  );
}

/**
 * Front + optional back JPEG per student. Backs are omitted when the template has no custom back image (uploaded single-side).
 * onProgress: ({ label, current, total }) => void.
 */
async function buildPreviewFrontAndBackJpegFiles(
  wrap,
  cards,
  pageBackgroundColor,
  onProgress,
  cardsPerPage,
  captureOpts = {},
) {
  const bulk = Boolean(captureOpts.bulk);
  const shouldAbort =
    typeof captureOpts.shouldAbort === "function"
      ? captureOpts.shouldAbort
      : () => false;
  const betweenMs = bulk ? 0 : 80;
  const retryBaseMs = bulk ? 40 : 300;
  const maxCaptureAttempts = bulk ? 2 : 3;
  const captureFlags = {
    bulk,
    ...(bulk ? { jpegQuality: PREVIEW_EXPORT_JPEG_QUALITY_BULK } : {}),
  };
  const hasFabricInBatch = cards.some((c) =>
    String(c.templateId || "").startsWith("fabric-"),
  );

  const frontEls = getFrontCardCellElements(wrap);
  const backEls = getBackCardCellElements(wrap);
  const expectedBackCells = countExpectedBackDomCells(cards, cardsPerPage);
  if (!cards.length || frontEls.length !== cards.length) {
    throw new Error(
      `Preview not ready (front ${frontEls.length}, students ${cards.length}). Wait and try again.`,
    );
  }
  if (backEls.length !== expectedBackCells) {
    throw new Error(
      `Preview not ready (front ${frontEls.length}, back ${backEls.length}, expected back slots ${expectedBackCells}). Wait and try again.`,
    );
  }
  const used = new Set();
  const bases = cards.map((card, i) => jpegBaseNameForCard(card, i, used));
  const files = [];
  const backExportCount = cards.filter((c) => cardExportsBackJpeg(c)).length;
  const totalSteps = cards.length + backExportCount;
  const useNativeCapture = canUseElectronNativeCapture();
  const allCanvasDataCards =
    !hasFabricInBatch &&
    cards.every((c) => cardSupportsDataExportRenderer(c)) &&
    cards
      .filter((c) => cardExportsBackJpeg(c))
      .every((c) => cardSupportsDataExportBack(c));
  /** Data renderer: higher parallelism; DOM capture stays lower (native serializes). */
  const captureConcurrency = useNativeCapture
    ? 1
    : allCanvasDataCards
      ? bulk
        ? Math.min(16, Math.max(8, Math.ceil(cards.length / 80)))
        : 6
    : bulk
      ? cards.length > 200
        ? 8
        : cards.length > 60
          ? 6
          : 5
      : 2;

  async function captureCell(el, label, index1, card, side) {
    let payload;
    let lastErr;
    for (let attempt = 0; attempt < maxCaptureAttempts; attempt++) {
      if (shouldAbort()) throw new ExportCancelledError();
      try {
        const useData =
          USE_DATA_EXPORT_RENDERER_PRIMARY &&
          (side === "front"
            ? cardSupportsDataExportRenderer(card)
            : cardSupportsDataExportBack(card));
        if (useData) {
          try {
            const preset = getCardExportPreset({
              bulk,
              megaBulkPage: Boolean(captureFlags.megaBulkPage),
            });
            const q =
              typeof captureFlags.jpegQuality === "number"
                ? captureFlags.jpegQuality
                : PREVIEW_EXPORT_JPEG_QUALITY;
            const blob = await renderCardSideToBlob(card, side, {
              mime: "image/jpeg",
              quality: q,
              pixelScale: preset.pixelScale,
            });
            payload = { dataBytes: await uint8FromBlob(blob) };
          } catch (dataErr) {
            console.warn(
              "[export] Data canvas JPEG failed, using capture fallback.",
              dataErr,
            );
            payload = {
              dataUrl: await rasterizeElementForExport(
                el,
                pageBackgroundColor,
                captureFlags,
                "jpeg",
              ),
            };
          }
        } else {
          payload = {
            dataUrl: await rasterizeElementForExport(
              el,
              pageBackgroundColor,
              captureFlags,
              "jpeg",
            ),
          };
        }
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        if (shouldAbort()) throw new ExportCancelledError();
        await delay(retryBaseMs * (attempt + 1));
      }
    }
    if (!payload) {
      throw lastErr || new Error(`Failed to capture ${label} card ${index1}`);
    }
    return payload;
  }
  const backTasks = [];
  for (let i = 0; i < cards.length; i++) {
    if (!cardExportsBackJpeg(cards[i])) continue;
    const domIdx = backDomIndexForCard(cards, cardsPerPage, i);
    if (domIdx < 0 || !backEls[domIdx]) {
      throw new Error(
        `Back preview missing for card ${i + 1}. Wait and try again.`,
      );
    }
    backTasks.push({ i, domIdx });
  }
  /**
   * Preview (non-bulk): front then back was ~2× wall time for dual-sided cards.
   * Interleave jobs so front + back can rasterize together; keep front-then-back
   * phases for bulk exports to limit peak memory from many html2canvas runs.
   */
  const useMergedFrontBackParallel = !bulk && backTasks.length > 0;
  const mergedCaptureConcurrency = useNativeCapture
    ? 1
    : allCanvasDataCards
      ? Math.min(8, Math.max(6, captureConcurrency))
      : Math.min(6, Math.max(4, captureConcurrency));

  let step = 0;
  let frontPayloads;
  let backPayloads;
  if (useMergedFrontBackParallel) {
    const mergedJobs = [];
    for (let i = 0; i < cards.length; i++) {
      mergedJobs.push({
        side: "front",
        cardIndex: i,
        el: frontEls[i],
        card: cards[i],
      });
    }
    for (const { i, domIdx } of backTasks) {
      mergedJobs.push({
        side: "back",
        cardIndex: i,
        el: backEls[domIdx],
        card: cards[i],
      });
    }
    const mergedResults = await mapWithConcurrency(
      mergedJobs,
      mergedCaptureConcurrency,
      async (job) => {
        const payload = await captureCell(
          job.el,
          job.side,
          job.cardIndex + 1,
          job.card,
          job.side,
        );
        step += 1;
        onProgress?.({
          label:
            job.side === "front"
              ? "Capturing JPEGs (front)…"
              : "Capturing JPEGs (back)…",
          current: step,
          total: totalSteps,
        });
        if (betweenMs > 0) await delay(betweenMs);
        return { ...job, payload };
      },
      shouldAbort,
    );
    frontPayloads = new Array(cards.length);
    const backPayloadByIndex = new Map();
    for (const r of mergedResults) {
      if (r.side === "front") frontPayloads[r.cardIndex] = r.payload;
      else backPayloadByIndex.set(r.cardIndex, r.payload);
    }
    backPayloads = backTasks.map(({ i }) => {
      const p = backPayloadByIndex.get(i);
      if (!p) {
        throw new Error(`Back capture missing for card ${i + 1}.`);
      }
      return p;
    });
  } else {
    frontPayloads = await mapWithConcurrency(
      frontEls,
      captureConcurrency,
      async (el, i) => {
        const payload = await captureCell(el, "front", i + 1, cards[i], "front");
        step += 1;
        onProgress?.({
          label: "Capturing JPEGs (front)…",
          current: step,
          total: totalSteps,
        });
        if (betweenMs > 0) await delay(betweenMs);
        return payload;
      },
      shouldAbort,
    );
    if (shouldAbort()) throw new ExportCancelledError();
    backPayloads = await mapWithConcurrency(
      backTasks,
      captureConcurrency,
      async ({ i, domIdx }) => {
        const payload = await captureCell(
          backEls[domIdx],
          "back",
          i + 1,
          cards[i],
          "back",
        );
        step += 1;
        onProgress?.({
          label: "Capturing JPEGs (back)…",
          current: step,
          total: totalSteps,
        });
        if (betweenMs > 0) await delay(betweenMs);
        return payload;
      },
      shouldAbort,
    );
  }
  for (let i = 0; i < cards.length; i++) {
    files.push({
      // 01/02 so default name-sorted folder views list front before back (…_back… sorts before …_front…)
      filename: `${bases[i]}_01_front.jpg`,
      ...frontPayloads[i],
    });
  }
  if (shouldAbort()) throw new ExportCancelledError();
  for (let t = 0; t < backTasks.length; t++) {
    const { i } = backTasks[t];
    files.push({ filename: `${bases[i]}_02_back.jpg`, ...backPayloads[t] });
  }
  if (shouldAbort()) throw new ExportCancelledError();
  return files;
}

/**
 * Builds one JPEG per preview page (same page size as the preview),
 * e.g. page-001.jpg, page-002.jpg... This avoids the "thin width" issue
 * of stitching all pages into a single long image.
 *
 * @param {object|null} pageExportContext - When set with cards + layout, uses data→canvas for
 *   canvas templates (fast); DOM capture remains per-page fallback.
 */
async function buildPreviewPagesJpegFiles(
  pageNodes,
  pageBackgroundColor,
  onProgress,
  captureOpts = {},
  pageExportContext = null,
) {
  const bulk = Boolean(captureOpts.bulk);
  const shouldAbort =
    typeof captureOpts.shouldAbort === "function"
      ? captureOpts.shouldAbort
      : () => false;
  const betweenMs = bulk ? 0 : 120;
  const nodes = Array.from(pageNodes || []);
  const megaBulkPage =
    bulk && nodes.length >= MEGA_BULK_PAGE_THRESHOLD;
  const captureFlags = {
    bulk,
    megaBulkPage,
    ...(megaBulkPage
      ? { jpegQuality: PREVIEW_EXPORT_PAGE_JPEG_QUALITY_MEGA }
      : bulk
        ? { jpegQuality: PREVIEW_EXPORT_JPEG_QUALITY_BULK }
        : {}),
  };
  const n = nodes.length;
  const { cards, cardsPerPage, layout } = pageExportContext || {};
  const useNativeCapture = canUseElectronNativeCapture();
  const allSpreadsDataCapable =
    USE_DATA_EXPORT_RENDERER_PRIMARY &&
    cards?.length &&
    layout &&
    Number.isFinite(cardsPerPage) &&
    nodes.every((node) => {
      const bi = Number(node?.dataset?.batchIndex);
      if (!Number.isFinite(bi)) return false;
      const side = node?.dataset?.spreadSide === "back" ? "back" : "front";
      const start = bi * cardsPerPage;
      const pageCards = cards.slice(start, start + cardsPerPage);
      return canRenderSpreadPageDataOnly(pageCards, side);
    });
  const pageConcurrency =
    allSpreadsDataCapable && !useNativeCapture
      ? bulk
        ? Math.min(16, Math.max(8, Math.ceil(n / 20)))
        : 4
      : useNativeCapture
        ? 1
        : !bulk
          ? 2
          : n > 150
            ? 7
            : n > 80
              ? 6
              : n > 40
                ? 5
                : 4;
  if (nodes.length === 0) return [];
  const files = [];
  let pagesDone = 0;
  const pagePayloads = await mapWithConcurrency(
    nodes,
    pageConcurrency,
    async (node) => {
      if (shouldAbort()) throw new ExportCancelledError();
      let payload;
      const bi = Number(node?.dataset?.batchIndex);
      const side = node?.dataset?.spreadSide === "back" ? "back" : "front";
      const start = Number.isFinite(bi) ? bi * cardsPerPage : NaN;
      const pageCards =
        Number.isFinite(start) && cards?.length
          ? cards.slice(start, start + cardsPerPage)
          : [];
      const useDataSpread =
        USE_DATA_EXPORT_RENDERER_PRIMARY &&
        layout &&
        pageCards.length > 0 &&
        canRenderSpreadPageDataOnly(pageCards, side);
      if (useDataSpread) {
        try {
          const preset = getPageExportPreset({ bulk, megaBulkPage });
          const blob = await renderSpreadPageToJpegBlob(
            pageCards,
            side,
            layout,
            pageBackgroundColor,
            {
              bulk,
              megaBulkPage,
              jpegQuality:
                typeof captureFlags.jpegQuality === "number"
                  ? captureFlags.jpegQuality
                  : preset.jpegQuality,
            },
          );
          payload = { dataBytes: await uint8FromBlob(blob) };
        } catch (e) {
          console.warn(
            "[export] Data canvas page JPEG failed, using capture fallback.",
            e,
          );
          payload = {
            dataUrl: await rasterizeElementForExport(
              node,
              pageBackgroundColor,
              captureFlags,
              "jpeg",
            ),
          };
        }
      } else {
        payload = {
          dataUrl: await rasterizeElementForExport(
            node,
            pageBackgroundColor,
            captureFlags,
            "jpeg",
          ),
        };
      }
      pagesDone += 1;
      onProgress?.({
        label: "Capturing JPEG pages…",
        current: pagesDone,
        total: nodes.length,
      });
      if (betweenMs > 0) await delay(betweenMs);
      return payload;
    },
    shouldAbort,
  );
  for (let i = 0; i < nodes.length; i++) {
    const idx = String(i + 1).padStart(3, "0");
    files.push({ filename: `page-${idx}.jpg`, ...pagePayloads[i] });
  }
  if (shouldAbort()) throw new ExportCancelledError();
  return files;
}

/**
 * PNG parity with JPEG export: front + optional back PNG per student.
 */
async function buildPreviewFrontAndBackPngFiles(
  wrap,
  cards,
  pageBackgroundColor,
  onProgress,
  cardsPerPage,
  captureOpts = {},
) {
  const bulk = Boolean(captureOpts.bulk);
  const shouldAbort =
    typeof captureOpts.shouldAbort === "function"
      ? captureOpts.shouldAbort
      : () => false;
  const betweenMs = bulk ? 0 : 80;
  const retryBaseMs = bulk ? 40 : 300;
  const maxCaptureAttempts = bulk ? 2 : 3;
  const captureFlags = { bulk };
  const hasFabricInBatch = cards.some((c) =>
    String(c.templateId || "").startsWith("fabric-"),
  );

  const frontEls = getFrontCardCellElements(wrap);
  const backEls = getBackCardCellElements(wrap);
  const expectedBackCells = countExpectedBackDomCells(cards, cardsPerPage);
  if (!cards.length || frontEls.length !== cards.length) {
    throw new Error(
      `Preview not ready (front ${frontEls.length}, students ${cards.length}). Wait and try again.`,
    );
  }
  if (backEls.length !== expectedBackCells) {
    throw new Error(
      `Preview not ready (front ${frontEls.length}, back ${backEls.length}, expected back slots ${expectedBackCells}). Wait and try again.`,
    );
  }
  const used = new Set();
  const bases = cards.map((card, i) => jpegBaseNameForCard(card, i, used));
  const files = [];
  const backExportCount = cards.filter((c) => cardExportsBackJpeg(c)).length;
  const totalSteps = cards.length + backExportCount;
  const useNativeCapture = canUseElectronNativeCapture();
  const allCanvasDataCards =
    !hasFabricInBatch &&
    cards.every((c) => cardSupportsDataExportRenderer(c)) &&
    cards
      .filter((c) => cardExportsBackJpeg(c))
      .every((c) => cardSupportsDataExportBack(c));
  const captureConcurrency = useNativeCapture
    ? 1
    : allCanvasDataCards
      ? bulk
        ? Math.min(14, Math.max(6, Math.ceil(cards.length / 80)))
        : 5
    : bulk
      ? cards.length > 200
        ? 8
        : cards.length > 60
          ? 6
          : 5
      : 2;

  async function captureCell(el, label, index1, card, side) {
    let payload;
    let lastErr;
    for (let attempt = 0; attempt < maxCaptureAttempts; attempt++) {
      if (shouldAbort()) throw new ExportCancelledError();
      try {
        const useData =
          USE_DATA_EXPORT_RENDERER_PRIMARY &&
          (side === "front"
            ? cardSupportsDataExportRenderer(card)
            : cardSupportsDataExportBack(card));
        if (useData) {
          try {
            const preset = getCardExportPreset({ bulk, megaBulkPage: false });
            const blob = await renderCardSideToBlob(card, side, {
              mime: "image/png",
              pixelScale: preset.pixelScale,
            });
            payload = { dataBytes: await uint8FromBlob(blob) };
          } catch (dataErr) {
            console.warn(
              "[export] Data canvas PNG failed, using capture fallback.",
              dataErr,
            );
            payload = {
              dataUrl: await rasterizeElementForExport(
                el,
                pageBackgroundColor,
                captureFlags,
                "png",
              ),
            };
          }
        } else {
          payload = {
            dataUrl: await rasterizeElementForExport(
              el,
              pageBackgroundColor,
              captureFlags,
              "png",
            ),
          };
        }
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        if (shouldAbort()) throw new ExportCancelledError();
        await delay(retryBaseMs * (attempt + 1));
      }
    }
    if (!payload) {
      throw lastErr || new Error(`Failed to capture ${label} card ${index1}`);
    }
    return payload;
  }

  const backTasks = [];
  for (let i = 0; i < cards.length; i++) {
    if (!cardExportsBackJpeg(cards[i])) continue;
    const domIdx = backDomIndexForCard(cards, cardsPerPage, i);
    if (domIdx < 0 || !backEls[domIdx]) {
      throw new Error(`Back preview missing for card ${i + 1}. Wait and try again.`);
    }
    backTasks.push({ i, domIdx });
  }
  const useMergedFrontBackParallel = !bulk && backTasks.length > 0;
  const mergedCaptureConcurrency = useNativeCapture
    ? 1
    : allCanvasDataCards
      ? Math.min(8, Math.max(6, captureConcurrency))
      : Math.min(6, Math.max(4, captureConcurrency));

  let step = 0;
  let frontPayloads;
  let backPayloads;
  if (useMergedFrontBackParallel) {
    const mergedJobs = [];
    for (let i = 0; i < cards.length; i++) {
      mergedJobs.push({
        side: "front",
        cardIndex: i,
        el: frontEls[i],
        card: cards[i],
      });
    }
    for (const { i, domIdx } of backTasks) {
      mergedJobs.push({
        side: "back",
        cardIndex: i,
        el: backEls[domIdx],
        card: cards[i],
      });
    }
    const mergedResults = await mapWithConcurrency(
      mergedJobs,
      mergedCaptureConcurrency,
      async (job) => {
        const payload = await captureCell(
          job.el,
          job.side,
          job.cardIndex + 1,
          job.card,
          job.side,
        );
        step += 1;
        onProgress?.({
          label:
            job.side === "front"
              ? "Capturing PNGs (front)…"
              : "Capturing PNGs (back)…",
          current: step,
          total: totalSteps,
        });
        if (betweenMs > 0) await delay(betweenMs);
        return { ...job, payload };
      },
      shouldAbort,
    );
    frontPayloads = new Array(cards.length);
    const backPayloadByIndex = new Map();
    for (const r of mergedResults) {
      if (r.side === "front") frontPayloads[r.cardIndex] = r.payload;
      else backPayloadByIndex.set(r.cardIndex, r.payload);
    }
    backPayloads = backTasks.map(({ i }) => {
      const p = backPayloadByIndex.get(i);
      if (!p) {
        throw new Error(`Back capture missing for card ${i + 1}.`);
      }
      return p;
    });
  } else {
    frontPayloads = await mapWithConcurrency(
      frontEls,
      captureConcurrency,
      async (el, i) => {
        const payload = await captureCell(el, "front", i + 1, cards[i], "front");
        step += 1;
        onProgress?.({
          label: "Capturing PNGs (front)…",
          current: step,
          total: totalSteps,
        });
        if (betweenMs > 0) await delay(betweenMs);
        return payload;
      },
      shouldAbort,
    );
    if (shouldAbort()) throw new ExportCancelledError();
    backPayloads = await mapWithConcurrency(
      backTasks,
      captureConcurrency,
      async ({ i, domIdx }) => {
        const payload = await captureCell(
          backEls[domIdx],
          "back",
          i + 1,
          cards[i],
          "back",
        );
        step += 1;
        onProgress?.({
          label: "Capturing PNGs (back)…",
          current: step,
          total: totalSteps,
        });
        if (betweenMs > 0) await delay(betweenMs);
        return payload;
      },
      shouldAbort,
    );
  }
  for (let i = 0; i < cards.length; i++) {
    files.push({ filename: `${bases[i]}_01_front.png`, ...frontPayloads[i] });
  }
  if (shouldAbort()) throw new ExportCancelledError();
  for (let t = 0; t < backTasks.length; t++) {
    const { i } = backTasks[t];
    files.push({ filename: `${bases[i]}_02_back.png`, ...backPayloads[t] });
  }
  if (shouldAbort()) throw new ExportCancelledError();
  return files;
}

async function buildPreviewPagesPngFiles(
  pageNodes,
  pageBackgroundColor,
  onProgress,
  captureOpts = {},
  pageExportContext = null,
) {
  const bulk = Boolean(captureOpts.bulk);
  const shouldAbort =
    typeof captureOpts.shouldAbort === "function"
      ? captureOpts.shouldAbort
      : () => false;
  const betweenMs = bulk ? 0 : 120;
  const nodes = Array.from(pageNodes || []);
  const megaBulkPage =
    bulk && nodes.length >= MEGA_BULK_PAGE_THRESHOLD;
  const captureFlags = { bulk, megaBulkPage };
  const n = nodes.length;
  const { cards, cardsPerPage, layout } = pageExportContext || {};
  const useNativeCapture = canUseElectronNativeCapture();
  const allSpreadsDataCapable =
    USE_DATA_EXPORT_RENDERER_PRIMARY &&
    cards?.length &&
    layout &&
    Number.isFinite(cardsPerPage) &&
    nodes.every((node) => {
      const bi = Number(node?.dataset?.batchIndex);
      if (!Number.isFinite(bi)) return false;
      const side = node?.dataset?.spreadSide === "back" ? "back" : "front";
      const start = bi * cardsPerPage;
      const pageCards = cards.slice(start, start + cardsPerPage);
      return canRenderSpreadPageDataOnly(pageCards, side);
    });
  const pageConcurrency =
    allSpreadsDataCapable && !useNativeCapture
      ? bulk
        ? Math.min(14, Math.max(6, Math.ceil(n / 20)))
        : 4
      : useNativeCapture
        ? 1
        : !bulk
          ? 2
          : n > 150
            ? 7
            : n > 80
              ? 6
              : n > 40
                ? 5
                : 4;
  if (nodes.length === 0) return [];
  const files = [];
  let pagesDone = 0;
  const pagePayloads = await mapWithConcurrency(
    nodes,
    pageConcurrency,
    async (node) => {
      if (shouldAbort()) throw new ExportCancelledError();
      let payload;
      const bi = Number(node?.dataset?.batchIndex);
      const side = node?.dataset?.spreadSide === "back" ? "back" : "front";
      const start = Number.isFinite(bi) ? bi * cardsPerPage : NaN;
      const pageCards =
        Number.isFinite(start) && cards?.length
          ? cards.slice(start, start + cardsPerPage)
          : [];
      const useDataSpread =
        USE_DATA_EXPORT_RENDERER_PRIMARY &&
        layout &&
        pageCards.length > 0 &&
        canRenderSpreadPageDataOnly(pageCards, side);
      if (useDataSpread) {
        try {
          const blob = await renderSpreadPageToPngBlob(
            pageCards,
            side,
            layout,
            pageBackgroundColor,
            { bulk, megaBulkPage },
          );
          payload = { dataBytes: await uint8FromBlob(blob) };
        } catch (e) {
          console.warn(
            "[export] Data canvas page PNG failed, using capture fallback.",
            e,
          );
          payload = {
            dataUrl: await rasterizeElementForExport(
              node,
              pageBackgroundColor,
              captureFlags,
              "png",
            ),
          };
        }
      } else {
        payload = {
          dataUrl: await rasterizeElementForExport(
            node,
            pageBackgroundColor,
            captureFlags,
            "png",
          ),
        };
      }
      pagesDone += 1;
      onProgress?.({
        label: "Capturing PNG pages…",
        current: pagesDone,
        total: nodes.length,
      });
      if (betweenMs > 0) await delay(betweenMs);
      return payload;
    },
    shouldAbort,
  );
  for (let i = 0; i < nodes.length; i++) {
    const idx = String(i + 1).padStart(3, "0");
    files.push({ filename: `page-${idx}.png`, ...pagePayloads[i] });
  }
  if (shouldAbort()) throw new ExportCancelledError();
  return files;
}

/**
 * Browser fallback: one .zip download containing a subfolder of all JPEGs.
 * (Multiple `<a download>` clicks are blocked after the first file in most browsers.)
 */
async function downloadJpegsAsZipFolder(
  safeSub,
  files,
  onProgress,
  shouldAbort = null,
) {
  const abortFn = typeof shouldAbort === "function" ? shouldAbort : () => false;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const root = zip.folder(safeSub);
  if (!root) throw new Error("Could not build ZIP.");
  for (let i = 0; i < files.length; i++) {
    if (abortFn()) throw new ExportCancelledError();
    const f = files[i];
    onProgress?.({
      label: "Packing JPEGs into ZIP…",
      current: i + 1,
      total: files.length,
    });
    const safeName = String(f.filename || `card-${i + 1}.jpg`).replace(
      /[<>:"/\\|?*\x00-\x1f]/g,
      "_",
    );
    if (f.blob instanceof Blob) {
      root.file(safeName, f.blob);
    } else if (f.dataBytes instanceof Uint8Array) {
      root.file(safeName, f.dataBytes);
    } else {
      const s = String(f.dataUrl || "");
      const comma = s.indexOf(",");
      const base64 = comma >= 0 ? s.slice(comma + 1) : s;
      root.file(safeName, base64, { base64: true });
    }
  }
  onProgress?.({
    label: "Saving ZIP file…",
    current: files.length,
    total: files.length,
  });
  if (abortFn()) throw new ExportCancelledError();
  // JPEGs are already compressed; DEFLATE on hundreds of files is very slow for little gain.
  const useStore = files.length >= 20;
  const blob = await zip.generateAsync(
    {
      type: "blob",
      ...(useStore
        ? { compression: "STORE" }
        : { compression: "DEFLATE", compressionOptions: { level: 6 } }),
    },
    () => {
      if (abortFn()) throw new ExportCancelledError();
    },
  );
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `${safeSub}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param webParentDirHandle - DirectoryHandle from showDirectoryPicker() during the Download click (browser only).
 */
async function saveJpegExportToFolder(
  subfolderName,
  files,
  onProgress,
  webParentDirHandle = null,
  shouldAbort = null,
) {
  const abortFn = typeof shouldAbort === "function" ? shouldAbort : () => false;
  const safeSub =
    String(subfolderName)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 120) || "id-cards-jpeg";
  if (typeof window !== "undefined" && window.electron?.selectOutputFolder) {
    const el = window.electron;
    onProgress?.({ label: "Choose folder to save JPEGs…", current: 0, total: 1 });
    if (abortFn()) throw new ExportCancelledError();
    const pick = await el.selectOutputFolder();
    if (!pick.success) return { cancelled: true };
    if (abortFn()) throw new ExportCancelledError();

    const runBatchSave = async () => {
      if (!el.saveJpegExportFolder) {
        throw new Error(
          "JPEG save is not available. Fully quit the app and start it again so Electron loads the latest code.",
        );
      }
      if (abortFn()) throw new ExportCancelledError();
      onProgress?.({
        label: "Writing JPEG files…",
        current: 0,
        total: files.length,
      });
      const r = await el.saveJpegExportFolder({
        parentFolderPath: pick.folderPath,
        subfolderName: safeSub,
        files,
      });
      if (!r.success) {
        throw new Error(r.error || "Could not save JPEG files.");
      }
      onProgress?.({
        label: "Writing JPEG files…",
        current: files.length,
        total: files.length,
      });
      if (el.openFolder) await el.openFolder(r.folderPath);
      return { folderPath: r.folderPath };
    };

    if (el.ensureJpegExportDir && el.writeJpegFile) {
      try {
        const mkdirRes = await el.ensureJpegExportDir({
          parentFolderPath: pick.folderPath,
          subfolderName: safeSub,
        });
        if (!mkdirRes.success) {
          throw new Error(
            mkdirRes.error || "Could not create folder for JPEG export.",
          );
        }
        const dir = mkdirRes.folderPath;
        for (let i = 0; i < files.length; i++) {
          if (abortFn()) throw new ExportCancelledError();
          onProgress?.({
            label: "Writing JPEG files…",
            current: i + 1,
            total: files.length,
          });
          const f = files[i];
          const payload = {
            directoryPath: dir,
            filename: f.filename,
          };
          if (f.dataBytes instanceof Uint8Array) {
            payload.dataBytes = f.dataBytes;
          } else if (f.blob instanceof Blob) {
            payload.dataBytes = await uint8FromBlob(f.blob);
          } else {
            payload.dataUrl = f.dataUrl;
          }
          const wr = await el.writeJpegFile(payload);
          if (!wr.success) {
            throw new Error(
              wr.error || `Failed to write ${files[i].filename}`,
            );
          }
        }
        if (el.openFolder) await el.openFolder(dir);
        return { folderPath: dir };
      } catch (e) {
        const msg = String(e?.message || e);
        const ipcNotReady =
          /no handler registered|not registered for ['"]ensure-jpeg|ERR_UNKNOWN/i.test(
            msg,
          );
        if (ipcNotReady && el.saveJpegExportFolder) {
          console.warn(
            "[JPEG export] Per-file save IPC unavailable (fully quit & reopen the app to load main process). Using batch save.",
            e,
          );
          return runBatchSave();
        }
        throw e;
      }
    }

    return runBatchSave();
  }

  if (
    webParentDirHandle &&
    typeof webParentDirHandle.getDirectoryHandle === "function"
  ) {
    try {
      await saveJpegsToFolderWithFilePicker(
        safeSub,
        files,
        onProgress,
        webParentDirHandle,
        shouldAbort,
      );
      return {};
    } catch (e) {
      if (e?.name === "AbortError") return { cancelled: true };
      throw e;
    }
  }

  await downloadJpegsAsZipFolder(safeSub, files, onProgress, shouldAbort);
  window.alert(
    `Downloaded "${safeSub}.zip". Extract it to get a folder with all ${files.length} JPEG file(s).`,
  );
  return { fallbackDownloads: true };
}

async function downloadPngsAsZipFolder(
  safeSub,
  files,
  onProgress,
  shouldAbort = null,
) {
  const abortFn = typeof shouldAbort === "function" ? shouldAbort : () => false;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const root = zip.folder(safeSub);
  if (!root) throw new Error("Could not build ZIP.");
  for (let i = 0; i < files.length; i++) {
    if (abortFn()) throw new ExportCancelledError();
    const f = files[i];
    onProgress?.({
      label: "Packing PNGs into ZIP…",
      current: i + 1,
      total: files.length,
    });
    const safeName = String(f.filename || `card-${i + 1}.png`).replace(
      /[<>:"/\\|?*\x00-\x1f]/g,
      "_",
    );
    if (f.blob instanceof Blob) {
      root.file(safeName, f.blob);
    } else if (f.dataBytes instanceof Uint8Array) {
      root.file(safeName, f.dataBytes);
    } else {
      const s = String(f.dataUrl || "");
      const comma = s.indexOf(",");
      const base64 = comma >= 0 ? s.slice(comma + 1) : s;
      root.file(safeName, base64, { base64: true });
    }
  }
  onProgress?.({
    label: "Saving ZIP file…",
    current: files.length,
    total: files.length,
  });
  if (abortFn()) throw new ExportCancelledError();
  const useStore = files.length >= 20;
  const blob = await zip.generateAsync(
    {
      type: "blob",
      ...(useStore
        ? { compression: "STORE" }
        : { compression: "DEFLATE", compressionOptions: { level: 6 } }),
    },
    () => {
      if (abortFn()) throw new ExportCancelledError();
    },
  );
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `${safeSub}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function savePngExportToFolder(
  subfolderName,
  files,
  onProgress,
  shouldAbort = null,
) {
  const abortFn = typeof shouldAbort === "function" ? shouldAbort : () => false;
  const safeSub =
    String(subfolderName)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 120) || "id-cards-png";
  if (typeof window !== "undefined" && window.electron?.selectOutputFolder) {
    const el = window.electron;
    onProgress?.({ label: "Choose folder to save PNGs…", current: 0, total: 1 });
    if (abortFn()) throw new ExportCancelledError();
    const pick = await el.selectOutputFolder();
    if (!pick.success) return { cancelled: true };
    if (abortFn()) throw new ExportCancelledError();

    const runBatchSave = async () => {
      if (!el.savePngExportFolder) {
        throw new Error(
          "PNG save is not available. Fully quit the app and start it again so Electron loads the latest code.",
        );
      }
      if (abortFn()) throw new ExportCancelledError();
      onProgress?.({
        label: "Writing PNG files…",
        current: 0,
        total: files.length,
      });
      const r = await el.savePngExportFolder({
        parentFolderPath: pick.folderPath,
        subfolderName: safeSub,
        files,
      });
      if (!r.success) {
        throw new Error(r.error || "Could not save PNG files.");
      }
      onProgress?.({
        label: "Writing PNG files…",
        current: files.length,
        total: files.length,
      });
      if (el.openFolder) await el.openFolder(r.folderPath);
      return { folderPath: r.folderPath };
    };

    if (el.ensurePngExportDir && el.writePngFile) {
      try {
        const mkdirRes = await el.ensurePngExportDir({
          parentFolderPath: pick.folderPath,
          subfolderName: safeSub,
        });
        if (!mkdirRes.success) {
          throw new Error(
            mkdirRes.error || "Could not create folder for PNG export.",
          );
        }
        const dir = mkdirRes.folderPath;
        for (let i = 0; i < files.length; i++) {
          if (abortFn()) throw new ExportCancelledError();
          onProgress?.({
            label: "Writing PNG files…",
            current: i + 1,
            total: files.length,
          });
          const f = files[i];
          const payload = {
            directoryPath: dir,
            filename: f.filename,
          };
          if (f.dataBytes instanceof Uint8Array) {
            payload.dataBytes = f.dataBytes;
          } else if (f.blob instanceof Blob) {
            payload.dataBytes = await uint8FromBlob(f.blob);
          } else {
            payload.dataUrl = f.dataUrl;
          }
          const wr = await el.writePngFile(payload);
          if (!wr.success) {
            throw new Error(
              wr.error || `Failed to write ${files[i].filename}`,
            );
          }
        }
        if (el.openFolder) await el.openFolder(dir);
        return { folderPath: dir };
      } catch (e) {
        const msg = String(e?.message || e);
        const ipcNotReady =
          /no handler registered|not registered for ['"]ensure-png|ERR_UNKNOWN/i.test(
            msg,
          );
        if (ipcNotReady && el.savePngExportFolder) {
          console.warn(
            "[PNG export] Per-file save IPC unavailable (fully quit & reopen the app to load main process). Using batch save.",
            e,
          );
          return runBatchSave();
        }
        throw e;
      }
    }

    return runBatchSave();
  }

  await downloadPngsAsZipFolder(safeSub, files, onProgress, shouldAbort);
  window.alert(
    `Downloaded "${safeSub}.zip". Extract it to get a folder with all ${files.length} PNG file(s).`,
  );
  return { fallbackDownloads: true };
}

/**
 * Preview PDF fast pipeline (default): sequential pages, data render first, DOM fallback per page.
 * Disable with `localStorage.setItem('pdfExportFastMode', '0')` to use legacy parallel assembly.
 */
function isPdfExportFastModeEnabled() {
  try {
    return (
      typeof localStorage === "undefined" ||
      localStorage.getItem("pdfExportFastMode") !== "0"
    );
  } catch {
    return true;
  }
}

function pdfExportRasterConcurrency(
  pageElements,
  pageCount,
  bulk,
  spreadDataExportContext,
) {
  const useNativeCapture = canUseElectronNativeCapture();
  const { cards, cardsPerPage, layout } = spreadDataExportContext || {};
  const allSpreadsDataCapable =
    USE_DATA_EXPORT_RENDERER_PRIMARY &&
    cards?.length &&
    layout &&
    Number.isFinite(cardsPerPage) &&
    pageElements.every((node) => {
      const bi = Number(node?.dataset?.batchIndex);
      if (!Number.isFinite(bi)) return false;
      const side = node?.dataset?.spreadSide === "back" ? "back" : "front";
      const start = bi * cardsPerPage;
      const pageCards = cards.slice(start, start + cardsPerPage);
      return canRenderSpreadPageDataOnly(pageCards, side);
    });
  return allSpreadsDataCapable && !useNativeCapture
    ? bulk
      ? Math.min(16, Math.max(8, Math.ceil(pageCount / 20)))
      : 4
    : useNativeCapture
      ? 1
      : !bulk
        ? 2
        : pageCount > 150
          ? 7
          : pageCount > 80
            ? 6
            : pageCount > 40
              ? 5
              : 4;
}

/** Legacy PDF path: parallel page rasterization then one write (used when fast mode flag is off). */
async function exportPreviewPdfLegacyParallelAssembly({
  pageElements,
  pageWidthMm,
  pageHeightMm,
  subfolderName,
  pageBackgroundColor,
  captureOpts,
  spreadDataExportContext,
  emitProgress,
  abortFn,
}) {
  const pageCount = pageElements.length;
  const { cards, cardsPerPage, layout } = spreadDataExportContext || {};
  const safeSub =
    String(subfolderName)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 120) || "id-cards";
  const el =
    typeof window !== "undefined" && window.electron ? window.electron : null;
  const rasterCaptureConcurrency = pdfExportRasterConcurrency(
    pageElements,
    pageCount,
    Boolean(captureOpts.bulk),
    spreadDataExportContext,
  );
  const pdf = new jsPDF({
    unit: "mm",
    format: [pageWidthMm, pageHeightMm],
    orientation: pageHeightMm >= pageWidthMm ? "portrait" : "landscape",
  });
  let pagesCaptured = 0;
  const canvases = await mapWithConcurrency(
    pageElements,
    rasterCaptureConcurrency,
    async (element) => {
      const bi = Number(element?.dataset?.batchIndex);
      const side = element?.dataset?.spreadSide === "back" ? "back" : "front";
      const start = Number.isFinite(bi) ? bi * cardsPerPage : NaN;
      const pageCards =
        Number.isFinite(start) && cards?.length
          ? cards.slice(start, start + cardsPerPage)
          : [];
      let canvas;
      if (
        layout &&
        pageCards.length > 0 &&
        canRenderSpreadPageDataOnly(pageCards, side)
      ) {
        try {
          canvas = await renderSpreadPageToCanvas(
            pageCards,
            side,
            layout,
            pageBackgroundColor,
            captureOpts,
          );
        } catch (e) {
          console.warn(
            "[export] Data canvas PDF page failed, using DOM capture.",
            e,
          );
          canvas = await html2canvasForExport(
            element,
            pageBackgroundColor,
            captureOpts,
          );
        }
      } else {
        canvas = await html2canvasForExport(
          element,
          pageBackgroundColor,
          captureOpts,
        );
      }
      if (abortFn()) throw new ExportCancelledError();
      pagesCaptured += 1;
      emitProgress({
        label: "Creating PDF…",
        current: pagesCaptured,
        total: pageCount,
      });
      return canvas;
    },
    abortFn,
  );
  const orientShort = pageHeightMm >= pageWidthMm ? "p" : "l";
  for (let i = 0; i < pageCount; i++) {
    if (abortFn()) throw new ExportCancelledError();
    const canvas = canvases[i];
    if (i > 0) pdf.addPage([pageWidthMm, pageHeightMm], orientShort);
    pdf.addImage(
      canvas,
      "JPEG",
      0,
      0,
      pageWidthMm,
      pageHeightMm,
      undefined,
      "FAST",
    );
  }
  if (
    el?.selectOutputFolder &&
    el?.savePdfExportFile &&
    typeof el.selectOutputFolder === "function" &&
    typeof el.savePdfExportFile === "function"
  ) {
    emitProgress({ label: "Choose folder to save PDF…", current: 0, total: 1 });
    const pick = await el.selectOutputFolder();
    if (abortFn()) throw new ExportCancelledError();
    if (!pick?.success || !pick?.folderPath) return;
    emitProgress({ label: "Writing PDF file…", current: 0, total: 1 });
    const pdfBytes = pdf.output("arraybuffer");
    const result = await el.savePdfExportFile({
      parentFolderPath: pick.folderPath,
      subfolderName: safeSub,
      filename: `${safeSub}.pdf`,
      dataBytes: new Uint8Array(pdfBytes),
    });
    if (!result?.success) {
      throw new Error(result?.error || "Could not save PDF file.");
    }
    if (el.openFolder) await el.openFolder(pick.folderPath);
    return;
  }
  pdf.save(`${safeSub}.pdf`);
}

/**
 * Preview download: multi-page PDF only. JPG/PNG use `buildPreviewPagesJpegFiles` / `buildPreviewPagesPngFiles` etc.
 * Per page: data JPEG blob → jsPDF; on failure DOM capture; pages rasterize in parallel (bounded concurrency), then assemble in order.
 */
async function exportPreviewPdfFromPreview(
  pageElements,
  pageWidthMm,
  pageHeightMm,
  subfolderName,
  pageBackgroundColor = DEFAULT_PREVIEW_PAGE_BG,
  onProgress = null,
  shouldAbort = null,
  fastBulkCapture = false,
  spreadDataExportContext = null,
) {
  if (!pageElements?.length) return;
  const abortFn = typeof shouldAbort === "function" ? shouldAbort : () => false;
  const rawEmit = typeof onProgress === "function" ? onProgress : () => {};
  const emitProgress = (p) => {
    if (abortFn()) return;
    rawEmit(p);
  };
  const pageCount = pageElements.length;
  const bulk =
    Boolean(fastBulkCapture) ||
    pageCount >= FAST_PREVIEW_EXPORT_THRESHOLD_PAGES;
  const megaBulkPage = bulk && pageCount >= MEGA_BULK_PAGE_THRESHOLD;
  const captureOpts = { bulk, megaBulkPage };
  const pdfEmbedJpegQuality = megaBulkPage
    ? PDF_EXPORT_EMBED_JPEG_QUALITY_MEGA
    : bulk
      ? PDF_EXPORT_EMBED_JPEG_QUALITY_BULK
      : PDF_EXPORT_EMBED_JPEG_QUALITY;
  const { cards, cardsPerPage, layout } = spreadDataExportContext || {};
  const safeSub =
    String(subfolderName)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 120) || "id-cards";
  const el =
    typeof window !== "undefined" && window.electron ? window.electron : null;

  const mayTryElectronNativePrint =
    pageCount < PDF_EXPORT_SKIP_NATIVE_PRINT_MIN_PAGES &&
    pageCount <= PDF_EXPORT_NATIVE_PRINT_MAX_PAGES;

  let nativePdfBytes = null;
  if (
    mayTryElectronNativePrint &&
    canUseElectronPrintToPdf() &&
    el?.printToPdf &&
    el?.selectOutputFolder &&
    el?.savePdfExportFile
  ) {
    document.body.classList.add("id-preview-pdf-export");
    try {
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      await abortableDelay(150, abortFn);
      if (abortFn()) throw new ExportCancelledError();
      emitProgress({ label: "Generating PDF…", current: 0, total: 1 });
      const pdfRes = await el.printToPdf({
        printBackground: true,
        preferCSSPageSize: true,
        pageWidthMicrons: Math.round(pageWidthMm * 1000),
        pageHeightMicrons: Math.round(pageHeightMm * 1000),
      });
      if (abortFn()) throw new ExportCancelledError();
      if (pdfRes?.success && pdfRes.dataBytes?.length) {
        nativePdfBytes = pdfRes.dataBytes;
      }
    } catch (err) {
      console.warn("Chromium printToPDF failed, falling back to jsPDF export.", err);
    } finally {
      document.body.classList.remove("id-preview-pdf-export");
    }
  }

  if (nativePdfBytes) {
    emitProgress({ label: "Choose folder to save PDF…", current: 0, total: 1 });
    const pick = await el.selectOutputFolder();
    if (abortFn()) throw new ExportCancelledError();
    if (!pick?.success || !pick?.folderPath) return;
    emitProgress({ label: "Writing PDF file…", current: 0, total: 1 });
    const result = await el.savePdfExportFile({
      parentFolderPath: pick.folderPath,
      subfolderName: safeSub,
      filename: `${safeSub}.pdf`,
      dataBytes: nativePdfBytes,
    });
    if (!result?.success) {
      throw new Error(result?.error || "Could not save PDF file.");
    }
    if (el.openFolder) await el.openFolder(pick.folderPath);
    return;
  }

  if (!isPdfExportFastModeEnabled()) {
    await exportPreviewPdfLegacyParallelAssembly({
      pageElements,
      pageWidthMm,
      pageHeightMm,
      subfolderName,
      pageBackgroundColor,
      captureOpts,
      spreadDataExportContext,
      emitProgress,
      abortFn,
    });
    return;
  }

  const pdf = new jsPDF({
    unit: "mm",
    format: [pageWidthMm, pageHeightMm],
    orientation: pageHeightMm >= pageWidthMm ? "portrait" : "landscape",
  });
  const orientShort = pageHeightMm >= pageWidthMm ? "p" : "l";

  const rasterConcurrency = pdfExportRasterConcurrency(
    pageElements,
    pageCount,
    bulk,
    spreadDataExportContext,
  );
  let pagesRasterDone = 0;
  const pageImages = await mapWithConcurrency(
    pageElements,
    rasterConcurrency,
    async (element, i) => {
      if (abortFn()) throw new ExportCancelledError();
      const bi = Number(element?.dataset?.batchIndex);
      const side = element?.dataset?.spreadSide === "back" ? "back" : "front";
      const start = Number.isFinite(bi) ? bi * cardsPerPage : NaN;
      const pageCards =
        Number.isFinite(start) && cards?.length
          ? cards.slice(start, start + cardsPerPage)
          : [];

      let imageForPdf = null;
      const dataOk =
        USE_DATA_EXPORT_RENDERER_PRIMARY &&
        layout &&
        pageCards.length > 0 &&
        canRenderSpreadPageDataOnly(pageCards, side);

      if (dataOk) {
        try {
          const blob = await renderSpreadPageToJpegBlob(
            pageCards,
            side,
            layout,
            pageBackgroundColor,
            {
              bulk,
              megaBulkPage,
              jpegQuality: pdfEmbedJpegQuality,
            },
          );
          imageForPdf = await blobToDataUrl(blob);
        } catch (e) {
          console.warn(
            "[export] PDF data render failed for page, trying DOM capture.",
            e,
          );
        }
      }

      if (!imageForPdf) {
        try {
          imageForPdf = await html2canvasForExport(
            element,
            pageBackgroundColor,
            captureOpts,
          );
        } catch (e2) {
          throw new Error(
            `Could not build PDF page ${i + 1} of ${pageCount}. Wait for the preview to finish loading, then try again.`,
          );
        }
      }

      pagesRasterDone += 1;
      emitProgress({
        label: "Creating PDF…",
        current: pagesRasterDone,
        total: pageCount,
      });
      return imageForPdf;
    },
    abortFn,
  );

  for (let i = 0; i < pageCount; i++) {
    if (abortFn()) throw new ExportCancelledError();
    const imageForPdf = pageImages[i];
    if (i > 0) pdf.addPage([pageWidthMm, pageHeightMm], orientShort);
    pdf.addImage(
      imageForPdf,
      "JPEG",
      0,
      0,
      pageWidthMm,
      pageHeightMm,
      undefined,
      "FAST",
    );
  }

  if (
    el?.selectOutputFolder &&
    el?.savePdfExportFile &&
    typeof el.selectOutputFolder === "function" &&
    typeof el.savePdfExportFile === "function"
  ) {
    emitProgress({ label: "Choose folder to save PDF…", current: 0, total: 1 });
    const pick = await el.selectOutputFolder();
    if (abortFn()) throw new ExportCancelledError();
    if (!pick?.success || !pick?.folderPath) return;
    emitProgress({ label: "Writing PDF file…", current: 0, total: 1 });
    const pdfBytes = pdf.output("arraybuffer");
    const result = await el.savePdfExportFile({
      parentFolderPath: pick.folderPath,
      subfolderName: safeSub,
      filename: `${safeSub}.pdf`,
      dataBytes: new Uint8Array(pdfBytes),
    });
    if (!result?.success) {
      throw new Error(result?.error || "Could not save PDF file.");
    }
    if (el.openFolder) await el.openFolder(pick.folderPath);
    return;
  }
  pdf.save(`${safeSub}.pdf`);
}

export default function SavedIdCardsList({
  title = "Saved ID Cards",
  basePath = "/saved-id-cards",
  previewBasePath = "/saved-id-cards/preview",
  backTo = "/dashboard",
} = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { schoolId, classId } = useParams();
  const allStudentsMatch = useMatch({
    path: `${basePath}/school/:schoolId/all-students`,
    end: true,
  });
  const isAllSchoolStudents =
    Boolean(allStudentsMatch) ||
    pathnameIsSchoolAllStudentsRoute(location.pathname, basePath);
  const showStudentsView =
    (schoolId != null && classId != null) || isAllSchoolStudents;
  const { user, setOfflineMode } = useApp();
  const isViewTemplateFlow = basePath === "/view-template";
  const [viewMode, setViewMode] = useState("offline"); // offline | online
  const showOnlineProjects = user?.id !== "offline-user";
  const isOnlineMode = viewMode === "online";
  const activeApi = isOnlineMode ? onlineApi : offlineApi;
  const [showPrintView, setShowPrintView] = useState(false);
  const [showPreviewView, setShowPreviewView] = useState(false);
  const [singleCardPreview, setSingleCardPreview] = useState(null); // card object when viewing one student's card
  const printContentRef = useRef(null);
  const previewScrollRef = useRef(null);
  const previewPagesWrapRef = useRef(null);
  /** Refs for react-window FixedSizeList container and list component. */
  const savedIdStudentListWrapRef = useRef(null);
  const savedIdStudentListRef = useRef(null);
  const [savedIdStudentListViewportHeight, setSavedIdStudentListViewportHeight] =
    useState(Math.max(SAVED_ID_STUDENT_LIST_VIEWPORT_HEIGHT, window.innerHeight - 200));
  /** Browser JPEG export: DirectoryHandle from showDirectoryPicker (must be set during click). */
  const jpegWebParentDirHandleRef = useRef(null);
  /** User clicked "Cancel download" while an export is running. */
  const exportCancelRequestedRef = useRef(false);

  const [showDownloadMenuList, setShowDownloadMenuList] = useState(false);
  const [showDownloadMenuPreview, setShowDownloadMenuPreview] = useState(false);
  const [pendingExportFormat, setPendingExportFormat] = useState(null); // 'jpg' | 'png' | 'pdf'
  /** JPEG only: 'both' (class preview) | 'single' | 'pages' (see-all preview); cleared after export */
  const [jpegExportMode, setJpegExportMode] = useState(null);
  const [seeAllJpegDialogOpen, setSeeAllJpegDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** { label: string, current: number, total: number } | null */
  const [exportProgress, setExportProgress] = useState(null);
  const [chargingDownloadPoints, setChargingDownloadPoints] = useState(false);

  const [pageSizeMode, setPageSizeMode] = useState("a4"); // key of PAGE_PRESET_MM | 'custom'
  const [pageSizeUnit, setPageSizeUnit] = useState("mm"); // 'mm' | 'cm' | 'px' | 'inch'
  const [customPageWidthMm, setCustomPageWidthMm] = useState(A4_WIDTH_MM);
  const [customPageHeightMm, setCustomPageHeightMm] = useState(A4_HEIGHT_MM);
  // Keep a raw string input so Backspace/Delete can clear fully.
  // Numeric values are applied to `customPageWidthMm/HeightMm` only when parseable.
  const [customPageWidthInput, setCustomPageWidthInput] = useState(
    String(mmToUnit(A4_WIDTH_MM, pageSizeUnit)),
  );
  const [customPageHeightInput, setCustomPageHeightInput] = useState(
    String(mmToUnit(A4_HEIGHT_MM, pageSizeUnit)),
  );
  const [isEditingPageWidth, setIsEditingPageWidth] = useState(false);
  const [isEditingPageHeight, setIsEditingPageHeight] = useState(false);
  const pageWidthInputCommitTimeoutRef = useRef(null);
  const pageHeightInputCommitTimeoutRef = useRef(null);

  const [previewGapUnit, setPreviewGapUnit] = useState("mm"); // 'mm' | 'cm' | 'px' | 'inch'

  const [previewGapHorizontalMm, setPreviewGapHorizontalMm] =
    useState(DEFAULT_PREVIEW_GRID_GAP_MM);
  const [previewGapVerticalMm, setPreviewGapVerticalMm] =
    useState(DEFAULT_PREVIEW_GRID_GAP_MM);
  const [previewGapHorizontalInput, setPreviewGapHorizontalInput] = useState(
    String(mmToUnit(DEFAULT_PREVIEW_GRID_GAP_MM, previewGapUnit)),
  );
  const [previewGapVerticalInput, setPreviewGapVerticalInput] = useState(
    String(mmToUnit(DEFAULT_PREVIEW_GRID_GAP_MM, previewGapUnit)),
  );
  const [isEditingPreviewGapHorizontal, setIsEditingPreviewGapHorizontal] =
    useState(false);
  const [isEditingPreviewGapVertical, setIsEditingPreviewGapVertical] =
    useState(false);
  const previewGapHorizontalCommitTimeoutRef = useRef(null);
  const previewGapVerticalCommitTimeoutRef = useRef(null);
  const [previewPageBackgroundColor, setPreviewPageBackgroundColor] =
    useState(DEFAULT_PREVIEW_PAGE_BG);

  const pageWidthMm = React.useMemo(() => {
    if (pageSizeMode === "custom") {
      return clampPageMm(customPageWidthMm, A4_WIDTH_MM);
    }
    const preset = PAGE_PRESET_MM[pageSizeMode];
    return preset ? preset.w : A4_WIDTH_MM;
  }, [pageSizeMode, customPageWidthMm]);

  const pageHeightMm = React.useMemo(() => {
    if (pageSizeMode === "custom") {
      return clampPageMm(customPageHeightMm, A4_HEIGHT_MM);
    }
    const preset = PAGE_PRESET_MM[pageSizeMode];
    return preset ? preset.h : A4_HEIGHT_MM;
  }, [pageSizeMode, customPageHeightMm]);
  // Keep visual page frame instant, while heavy card layout can settle a moment later.
  const layoutPageWidthMm = React.useDeferredValue(pageWidthMm);
  const layoutPageHeightMm = React.useDeferredValue(pageHeightMm);
  // Gap changes can reflow many preview pages; defer to keep typing and UI responsive.
  const layoutPreviewGapHorizontalMm = React.useDeferredValue(
    previewGapHorizontalMm,
  );
  const layoutPreviewGapVerticalMm = React.useDeferredValue(previewGapVerticalMm);
  const clearPageSizeCommitTimers = React.useCallback(() => {
    if (pageWidthInputCommitTimeoutRef.current !== null) {
      window.clearTimeout(pageWidthInputCommitTimeoutRef.current);
      pageWidthInputCommitTimeoutRef.current = null;
    }
    if (pageHeightInputCommitTimeoutRef.current !== null) {
      window.clearTimeout(pageHeightInputCommitTimeoutRef.current);
      pageHeightInputCommitTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPageSizeCommitTimers(), [clearPageSizeCommitTimers]);

  const scheduleWidthMmCommitFromInput = React.useCallback(
    (rawValue) => {
      if (pageWidthInputCommitTimeoutRef.current !== null) {
        window.clearTimeout(pageWidthInputCommitTimeoutRef.current);
        pageWidthInputCommitTimeoutRef.current = null;
      }
      const parsed = parseUnitInput(rawValue);
      if (!Number.isFinite(parsed)) return;
      pageWidthInputCommitTimeoutRef.current = window.setTimeout(() => {
        const nextMm = clampPageMm(
          convertToMm(parsed, pageSizeUnit),
          A4_WIDTH_MM,
        );
        setCustomPageWidthMm(nextMm);
        pageWidthInputCommitTimeoutRef.current = null;
      }, PAGE_SIZE_INPUT_DEBOUNCE_MS);
    },
    [pageSizeUnit],
  );

  const scheduleHeightMmCommitFromInput = React.useCallback(
    (rawValue) => {
      if (pageHeightInputCommitTimeoutRef.current !== null) {
        window.clearTimeout(pageHeightInputCommitTimeoutRef.current);
        pageHeightInputCommitTimeoutRef.current = null;
      }
      const parsed = parseUnitInput(rawValue);
      if (!Number.isFinite(parsed)) return;
      pageHeightInputCommitTimeoutRef.current = window.setTimeout(() => {
        const nextMm = clampPageMm(
          convertToMm(parsed, pageSizeUnit),
          A4_HEIGHT_MM,
        );
        setCustomPageHeightMm(nextMm);
        pageHeightInputCommitTimeoutRef.current = null;
      }, PAGE_SIZE_INPUT_DEBOUNCE_MS);
    },
    [pageSizeUnit],
  );

  // When the unit changes, re-render the input from numeric mm values,
  // but don't clobber while the user is actively editing.
  useEffect(() => {
    if (pageSizeMode !== "custom") return;
    if (isEditingPageWidth) return;
    setCustomPageWidthInput(String(mmToUnit(customPageWidthMm, pageSizeUnit)));
  }, [pageSizeMode, isEditingPageWidth, customPageWidthMm, pageSizeUnit]);

  useEffect(() => {
    if (pageSizeMode !== "custom") return;
    if (isEditingPageHeight) return;
    setCustomPageHeightInput(
      String(mmToUnit(customPageHeightMm, pageSizeUnit)),
    );
  }, [pageSizeMode, isEditingPageHeight, customPageHeightMm, pageSizeUnit]);

  const clearPreviewGapCommitTimers = React.useCallback(() => {
    if (previewGapHorizontalCommitTimeoutRef.current !== null) {
      window.clearTimeout(previewGapHorizontalCommitTimeoutRef.current);
      previewGapHorizontalCommitTimeoutRef.current = null;
    }
    if (previewGapVerticalCommitTimeoutRef.current !== null) {
      window.clearTimeout(previewGapVerticalCommitTimeoutRef.current);
      previewGapVerticalCommitTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPreviewGapCommitTimers(), [clearPreviewGapCommitTimers]);

  const scheduleHorizontalPreviewGapCommitFromInput = React.useCallback(
    (rawValue) => {
      if (previewGapHorizontalCommitTimeoutRef.current !== null) {
        window.clearTimeout(previewGapHorizontalCommitTimeoutRef.current);
        previewGapHorizontalCommitTimeoutRef.current = null;
      }
      const parsed = parseUnitInput(rawValue);
      if (!Number.isFinite(parsed)) return;
      previewGapHorizontalCommitTimeoutRef.current = window.setTimeout(() => {
        const nextMm = clampPreviewGapMm(
          convertToMm(parsed, previewGapUnit),
          DEFAULT_PREVIEW_GRID_GAP_MM,
        );
        setPreviewGapHorizontalMm(nextMm);
        previewGapHorizontalCommitTimeoutRef.current = null;
      }, PREVIEW_GAP_INPUT_DEBOUNCE_MS);
    },
    [previewGapUnit],
  );

  const scheduleVerticalPreviewGapCommitFromInput = React.useCallback(
    (rawValue) => {
      if (previewGapVerticalCommitTimeoutRef.current !== null) {
        window.clearTimeout(previewGapVerticalCommitTimeoutRef.current);
        previewGapVerticalCommitTimeoutRef.current = null;
      }
      const parsed = parseUnitInput(rawValue);
      if (!Number.isFinite(parsed)) return;
      previewGapVerticalCommitTimeoutRef.current = window.setTimeout(() => {
        const nextMm = clampPreviewGapMm(
          convertToMm(parsed, previewGapUnit),
          DEFAULT_PREVIEW_GRID_GAP_MM,
        );
        setPreviewGapVerticalMm(nextMm);
        previewGapVerticalCommitTimeoutRef.current = null;
      }, PREVIEW_GAP_INPUT_DEBOUNCE_MS);
    },
    [previewGapUnit],
  );

  useEffect(() => {
    if (isEditingPreviewGapHorizontal) return;
    setPreviewGapHorizontalInput(
      String(mmToUnit(previewGapHorizontalMm, previewGapUnit)),
    );
  }, [isEditingPreviewGapHorizontal, previewGapHorizontalMm, previewGapUnit]);

  useEffect(() => {
    if (isEditingPreviewGapVertical) return;
    setPreviewGapVerticalInput(String(mmToUnit(previewGapVerticalMm, previewGapUnit)));
  }, [isEditingPreviewGapVertical, previewGapVerticalMm, previewGapUnit]);

  // Level 1: Schools
  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [errorSchools, setErrorSchools] = useState("");

  // Level 2: Classes
  const [classes, setClasses] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [errorClasses, setErrorClasses] = useState("");
  const [selectedSchool, setSelectedSchool] = useState(null);

  // Level 3: Students (with saved ID cards)
  const [templateStatus, setTemplateStatus] = useState(null);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [errorStudents, setErrorStudents] = useState("");
  const [selectedClass, setSelectedClass] = useState(null);
  /** GET /api/photographer/schools/:schoolId/students — full school roster */
  const [schoolAllStudentsData, setSchoolAllStudentsData] = useState(null);
  /** Full inline photos for Preview/Print only (list rows use memory-safe payloads). */
  const [bulkPhotoDetailPayload, setBulkPhotoDetailPayload] = useState(null);
  /** idle → loading (fetching full photos) → ready | failed — gates preview cards until URLs exist. */
  const [bulkPhotoHydrationStatus, setBulkPhotoHydrationStatus] =
    useState("idle");
  const [viewTemplateEditProbe, setViewTemplateEditProbe] = useState({
    done: false,
    show: false,
  });

  const [editStudentData, setEditStudentData] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editStudentData) return;
    setSavingEdit(true);
    try {
      const studentId = editStudentData._id || editStudentData.id;
      
      // Clean populated fields before update so we don't corrupt the DB keys
      const { school, _id, ...cleanData } = editStudentData;
      if (typeof cleanData.schoolId === 'object') {
        cleanData.schoolId = cleanData.schoolId.id || cleanData.schoolId._id;
      }
      if (typeof cleanData.classId === 'object') {
        cleanData.classId = cleanData.classId.id || cleanData.classId._id;
      }
      
      if (viewMode === "offline") {
        await offlineApi.updateStudent(studentId, cleanData);
      } else {
        if (onlineApi.updateStudent) {
          const onlinePayload = {
            studentName: cleanData.studentName || cleanData.name || "",
            classId: cleanData.classId || "",
            admissionNo: cleanData.admissionNo || "",
            rollNo: cleanData.rollNo || "",
            fatherName: cleanData.fatherName || "",
            motherName: cleanData.motherName || "",
            dob: cleanData.dob || cleanData.dateOfBirth || "",
            mobile: cleanData.mobile || cleanData.phone || "",
            email: cleanData.email || "",
            gender: cleanData.gender || "",
            bloodGroup: cleanData.bloodGroup || "",
            photoNo: cleanData.photoNo || "",
            uniqueCode: cleanData.uniqueCode || "",
            house: cleanData.house || "",
            marking: cleanData.marking || "",
            extraFields:
              cleanData.extraFields && typeof cleanData.extraFields === "object"
                ? cleanData.extraFields
                : {},
          };
          if (Object.prototype.hasOwnProperty.call(cleanData, "address")) {
            onlinePayload.address = cleanData.address || "";
          }
          await onlineApi.updateStudent(studentId, onlinePayload);
        }
      }

      const updater = (prevList) => {
        if (!prevList) return prevList;
        return prevList.map((s) => {
          const sid = s._id || s.id;
          if (sid === studentId) return { ...s, ...editStudentData };
          return s;
        });
      };

      if (isAllSchoolStudents) {
         setSchoolAllStudentsData((prev) => prev ? { ...prev, students: updater(prev.students) } : prev);
      } else {
         setTemplateStatus((prev) => prev ? { ...prev, students: updater(prev.students) } : prev);
      }
      setEditStudentData(null);
    } catch (err) {
      alert("Failed to update student details: " + err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => {
    if (showOnlineProjects) return;
    if (viewMode === "online") setViewMode("offline");
  }, [showOnlineProjects, viewMode]);

  useEffect(() => {
    setOfflineMode(viewMode !== "online");
  }, [viewMode, setOfflineMode]);

  // Fetch schools when on root saved-id-cards
  useEffect(() => {
    if (schoolId != null) return;
    let cancelled = false;
    setLoadingSchools(true);
    setErrorSchools("");
    activeApi
      .getAssignedSchools()
      .then((res) => {
        if (!cancelled) {
          console.log("res schools", res.schools);
          setSchools(res.schools ?? []);
          setLoadingSchools(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorSchools(err?.message || "Failed to load schools");
          setLoadingSchools(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, activeApi]);

  // Fetch classes when schoolId is in URL
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    setLoadingClasses(true);
    setErrorClasses("");
    setTemplateStatus(null);
    activeApi
      .getAssignedSchools()
      .then((res) => {
        const school = (res.schools ?? []).find((s) => s._id === schoolId);
        if (!cancelled)
          setSelectedSchool(school || { _id: schoolId, schoolName: schoolId });
      })
      .catch(() => { });
    activeApi
      .getClassesBySchool(schoolId)
      .then((res) => {
        if (!cancelled) {
          setClasses(sortClassesForDisplay(res.classes ?? []));
          setLoadingClasses(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorClasses(err?.message || "Failed to load classes");
          setLoadingClasses(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, activeApi]);

  // View Template: probe school for uploaded canvas template (show Edit template next to Create Template).
  useEffect(() => {
    if (!isViewTemplateFlow || !schoolId || classId != null) {
      setViewTemplateEditProbe({ done: false, show: false });
      return;
    }
    let cancelled = false;
    setViewTemplateEditProbe({ done: false, show: false });
    Promise.all([
      activeApi.getAssignedSchools(),
      activeApi.getStudentsBySchool(schoolId, { retainPhotos: false }),
      activeApi.getClassesBySchool(schoolId).catch(() => ({ classes: [] })),
    ])
      .then(async ([schoolsRes, studentsRes, classesRes]) => {
        if (cancelled) return;
        let payload = studentsRes;
        const classes = classesRes.classes ?? [];
        if (!isFullApiCanvasTemplate(studentsRes.template) && classes.length > 0) {
          try {
            const byClass = await activeApi.getStudentsBySchoolAndClass(
              schoolId,
              classes[0]._id,
              { retainPhotos: false },
            );
            if (
              !cancelled &&
              isFullApiCanvasTemplate(byClass.template)
            ) {
              payload = { ...studentsRes, template: byClass.template };
            }
          } catch {
            /* keep school payload */
          }
        }
        if (cancelled) return;
        const schoolsList = schoolsRes.schools ?? [];
        const apiTemplate = pickSchoolLevelTemplate(
          payload,
          schoolId,
          schoolsList,
          isOnlineMode,
        );
        const schoolHasSaved = computeSchoolHasSavedIdCards(
          schoolId,
          payload.students,
        );
        const show =
          schoolHasSaved &&
          Boolean(
            apiTemplate?.frontImage &&
              Array.isArray(apiTemplate.elements) &&
              apiTemplate.elements.length > 0,
          );
        setViewTemplateEditProbe({ done: true, show });
      })
      .catch(() => {
        if (!cancelled) setViewTemplateEditProbe({ done: true, show: false });
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, classId, isViewTemplateFlow, activeApi, isOnlineMode]);

  // Fetch students (template status) when both schoolId and classId are in URL
  useEffect(() => {
    if (!schoolId || !classId) return;
    let cancelled = false;
    setLoadingStudents(true);
    setErrorStudents("");
    activeApi
      .getClassesBySchool(schoolId)
      .then((res) => {
        const cls = (res.classes ?? []).find((c) => c._id === classId);
        if (!cancelled)
          setSelectedClass(
            cls || { _id: classId, className: classId, section: "" },
          );
      })
      .catch(() => { });
    const fetchTemplateStatus = async () => {
      if (typeof activeApi.getTemplatesStatus === "function") {
        return activeApi.getTemplatesStatus(schoolId, classId, {
          retainPhotos: false,
        });
      }
      const data = await activeApi.getStudentsBySchoolAndClass(
        schoolId,
        classId,
        { retainPhotos: false },
      );
      const students = data?.students ?? [];
      const withTemplates = students.filter((s) =>
        studentHasRenderableSavedCard(s, data),
      ).length;
      return {
        ...data,
        summary: {
          ...(data?.summary || {}),
          withTemplates,
          withoutTemplates: Math.max(0, students.length - withTemplates),
        },
      };
    };
    fetchTemplateStatus()
      .then((data) => {
        if (!cancelled) {
          setTemplateStatus(data);
          setLoadingStudents(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorStudents(err?.message || "Failed to load students");
          setLoadingStudents(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, classId, activeApi]);

  // Full-school student list (See all students)
  useEffect(() => {
    if (!schoolId || !isAllSchoolStudents) {
      setSchoolAllStudentsData(null);
      return;
    }
    let cancelled = false;
    setLoadingStudents(true);
    setErrorStudents("");
    setTemplateStatus(null);
    setSelectedClass({
      _id: "all",
      className: "All students",
      section: "",
    });
    Promise.all([
      activeApi.getAssignedSchools(),
      activeApi.getStudentsBySchool(schoolId, { retainPhotos: false }),
    ])
      .then(([schoolsRes, studentsRes]) => {
        if (cancelled) return;
        const school = (schoolsRes.schools ?? []).find((s) => s._id === schoolId);
        setSelectedSchool(school || { _id: schoolId, schoolName: schoolId });

        // In "See all" list we must keep template eligibility per-student/per-school only.
        // Borrowing one class template here makes template-missing classes wrongly previewable.
        const payload = studentsRes;
        if (!cancelled) {
          setSchoolAllStudentsData(payload);
          setLoadingStudents(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorStudents(err?.message || "Failed to load students");
          setLoadingStudents(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, isAllSchoolStudents, activeApi]);

  const allSchoolStudentsRaw =
    schoolAllStudentsData?.students ?? EMPTY_STUDENTS;
  const classStudentsRaw = templateStatus?.students ?? EMPTY_STUDENTS;

  const studentsForList = isAllSchoolStudents
    ? allSchoolStudentsRaw
    : classStudentsRaw;

  useLayoutEffect(() => {
    const el = savedIdStudentListWrapRef.current;
    if (!el) return;
    
    let timeoutId = null;
    
    const calculateHeight = () => {
      if (showStudentsView) {
        // Get the available height by checking the parent container
        const rect = el.getBoundingClientRect();
        
        // Calculate available height more accurately
        let availableHeight = rect.height;
        
        // If height is too small, use a more dynamic calculation
        if (availableHeight < 500) {
          // Use viewport height minus header and other elements
          const viewportHeight = window.innerHeight;
          const headerHeight = 80; // Header + back button
          const buttonsHeight = 120; // Total students info + preview/print buttons
          const margins = 60; // Margins, padding, and card spacing
          availableHeight = Math.max(500, viewportHeight - headerHeight - buttonsHeight - margins);
        }
        
        setSavedIdStudentListViewportHeight((prev) => {
          const next = Math.max(500, Math.floor(availableHeight));
          return prev === next ? prev : next;
        });
      }
    };
    
    const debouncedCalculateHeight = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(calculateHeight, 50); // 50ms debounce
    };
    
    const ro = new ResizeObserver(debouncedCalculateHeight);
    
    ro.observe(el);
    calculateHeight(); // Initial calculation without debounce
    
    // Also recalculate on window resize with debouncing
    const handleResize = () => {
      debouncedCalculateHeight();
    };
    window.addEventListener('resize', handleResize);
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [
    schoolId,
    classId,
    isAllSchoolStudents,
    showStudentsView,
    loadingStudents,
    studentsForList.length,
  ]);

  // Reset scroll when route or roster size changes. react-window v2 List uses `listRef` + scrollToRow (not ref + scrollToItem).
  useEffect(() => {
    const api = savedIdStudentListRef.current;
    if (!api || typeof api.scrollToRow !== "function") return;
    if (studentsForList.length === 0) return;
    try {
      api.scrollToRow({ index: 0, align: "start", behavior: "instant" });
    } catch {
      /* ignore — list may not be measured yet */
    }
  }, [schoolId, classId, isAllSchoolStudents, studentsForList.length]);

  // Recalculate height on orientation change or major layout shifts
  useEffect(() => {
    const handleOrientationChange = () => {
      setTimeout(() => {
        if (showStudentsView) {
          const viewportHeight = window.innerHeight;
          const headerHeight = 80;
          const buttonsHeight = 120;
          const margins = 60;
          const availableHeight = Math.max(500, viewportHeight - headerHeight - buttonsHeight - margins);
          setSavedIdStudentListViewportHeight((prev) => {
            const next = Math.floor(availableHeight);
            return prev === next ? prev : next;
          });
        }
      }, 100);
    };

    window.addEventListener('orientationchange', handleOrientationChange);
    return () => window.removeEventListener('orientationchange', handleOrientationChange);
  }, [showStudentsView]);

  /** Prefer bulk photo reload for preview/print; otherwise memory-safe list rows. */
  const studentsRawForPreviewPipeline = React.useMemo(() => {
    const match =
      bulkPhotoDetailPayload &&
      ((bulkPhotoDetailPayload.kind === "school" && isAllSchoolStudents) ||
        (bulkPhotoDetailPayload.kind === "class" && !isAllSchoolStudents));
    if (match) {
      return bulkPhotoDetailPayload.data?.students ?? EMPTY_STUDENTS;
    }
    return isAllSchoolStudents ? allSchoolStudentsRaw : classStudentsRaw;
  }, [
    bulkPhotoDetailPayload,
    isAllSchoolStudents,
    allSchoolStudentsRaw,
    classStudentsRaw,
  ]);

  /** Filter only on the list screen; sort is O(n log n) — defer until Preview/Print/export so large rosters don't jank. */
  const studentsFilteredForPreviewPrint = React.useMemo(() => {
    return isAllSchoolStudents
      ? studentsRawForPreviewPipeline.filter((s) =>
          studentHasUploadedPhoto(s) &&
          studentHasRenderableSavedCard(s, schoolAllStudentsData, {
            allowRootTemplateFallback: false,
          }),
        )
      : studentsRawForPreviewPipeline.filter((s) =>
          studentHasUploadedPhoto(s) &&
          studentHasRenderableSavedCard(s, templateStatus),
        );
  }, [
    isAllSchoolStudents,
    studentsRawForPreviewPipeline,
    schoolAllStudentsData,
    templateStatus,
  ]);

  const needPreviewPrintSortedOrder =
    showPreviewView || showPrintView || pendingExportFormat != null;

  const studentsForPreviewPrint = React.useMemo(() => {
    const filtered = studentsFilteredForPreviewPrint;
    if (filtered.length <= 1) return filtered;
    if (!needPreviewPrintSortedOrder) return filtered;
    return sortStudentsForPreviewPrint(filtered, classes);
  }, [
    studentsFilteredForPreviewPrint,
    needPreviewPrintSortedOrder,
    classes,
  ]);

  /** Stripped list rows have hasPhoto but empty photoUrl — must finish bulk fetch before building preview cards. */
  const previewNeedsBulkPhotoData = React.useMemo(() => {
    if (!needPreviewPrintSortedOrder) return false;
    return studentsForPreviewPrint.some(
      (s) =>
        studentHasUploadedPhoto(s) &&
        (!s.photoUrl || !String(s.photoUrl).trim()),
    );
  }, [needPreviewPrintSortedOrder, studentsForPreviewPrint]);

  useEffect(() => {
    if (!showPreviewView && !showPrintView) {
      setBulkPhotoDetailPayload(null);
      setBulkPhotoHydrationStatus("idle");
      return;
    }
    if (!schoolId || studentsForList.length === 0) return;

    if (!previewNeedsBulkPhotoData) {
      setBulkPhotoHydrationStatus("ready");
      return;
    }

    let cancelled = false;
    setBulkPhotoHydrationStatus("loading");
    (async () => {
      try {
        if (isAllSchoolStudents) {
          const data = await activeApi.getStudentsBySchool(schoolId, {
            retainPhotos: true,
          });
          if (!cancelled) {
            setBulkPhotoDetailPayload({ kind: "school", data });
            setBulkPhotoHydrationStatus("ready");
          }
        } else if (classId) {
          const data = await activeApi.getStudentsBySchoolAndClass(
            schoolId,
            classId,
            { retainPhotos: true },
          );
          if (!cancelled) {
            setBulkPhotoDetailPayload({ kind: "class", data });
            setBulkPhotoHydrationStatus("ready");
          }
        } else {
          if (!cancelled) setBulkPhotoHydrationStatus("failed");
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setBulkPhotoDetailPayload(null);
          setBulkPhotoHydrationStatus("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    showPreviewView,
    showPrintView,
    schoolId,
    classId,
    isAllSchoolStudents,
    activeApi,
    studentsForList.length,
    previewNeedsBulkPhotoData,
  ]);

  /** One shared canvas template object for all cards — avoids duplicating multi‑MB base64 per student. */
  const sharedUploadedCanvasTemplate = React.useMemo(() => {
    const root = isAllSchoolStudents
      ? schoolAllStudentsData?.template
      : templateStatus?.template;
    if (!isFullApiCanvasTemplate(root)) return null;
    return {
      name: root.name || "Uploaded Template",
      frontImage: fullPhotoUrl(root.frontImage),
      backImage: fullPhotoUrl(root.backImage),
      elements: root.elements,
      ...(root.backElements != null ? { backElements: root.backElements } : {}),
    };
  }, [isAllSchoolStudents, schoolAllStudentsData?.template, templateStatus?.template]);

  const getTemplateName = React.useCallback((templateId, card = null) => {
    if (templateId === "uploaded-custom" && card?.uploadedTemplate?.name)
      return card.uploadedTemplate.name;
    if (templateId === "uploaded-custom") return "Uploaded Template";
    if (templateId && String(templateId).startsWith("uploaded-")) {
      return (
        getUploadedTemplateById(templateId)?.name ||
        card?.uploadedTemplate?.name ||
        "Uploaded Template"
      );
    }
    const internalId = templateId ? getInternalTemplateId(templateId) : null;
    const t =
      getTemplateById(internalId || templateId) ||
      getFabricTemplateById(templateId);
    return t?.name || templateId;
  }, []);

  // Build card-like object from API student for preview/print
  // Include address, name, photoUrl, studentId, dimension (from school) so ID card preview shows full data and size
  const studentToCard = React.useCallback(
    (student) => {
    const apiTemplate = isAllSchoolStudents
      ? mergeSchoolRootTemplateIntoStudent(
        student,
        schoolAllStudentsData?.template,
      )
      : mergeSchoolRootTemplateIntoStudent(
        student,
        templateStatus?.template,
      );
    const isApiTemplateRenderable = isFullApiCanvasTemplate(apiTemplate);

    // API canvas templates must use uploadedTemplate override (same as View Template); DB templateIds are not in idCardTemplates.js.
    const templateId = isApiTemplateRenderable
      ? "uploaded-custom"
      : apiTemplate?.templateId;

    const extraFields = mergeExtraFieldsFromStudent(student);
    const resolvedRollNo =
      student.rollNo ??
      student.sNo ??
      student.sno ??
      student.srNo ??
      student.srno ??
      student.serialNo ??
      student.serial ??
      student.admissionNo ??
      student.uniqueCode ??
      "";

    const uploadedTemplateForCard =
      isApiTemplateRenderable &&
      (sharedUploadedCanvasTemplate
        ? sharedUploadedCanvasTemplate
        : {
          name: apiTemplate?.name || "Uploaded Template",
          frontImage: fullPhotoUrl(apiTemplate.frontImage),
          backImage: fullPhotoUrl(apiTemplate.backImage),
          elements: apiTemplate.elements,
          ...(apiTemplate.backElements != null
            ? { backElements: apiTemplate.backElements }
            : {}),
        });

    return {
      _id: student._id,
      id: apiTemplate?.templateId || student._id,
      studentId:
        student.admissionNo ?? student.rollNo ?? student.uniqueCode ?? "",
      name: student.studentName ?? "",
      rollNo: resolvedRollNo,
      templateId,
      uploadedTemplate: isApiTemplateRenderable ? uploadedTemplateForCard : null,
      studentImage: fullPhotoUrl(student.photoUrl),
      ...(student.colorCodeImageUrl ? { colorCodeImage: fullPhotoUrl(student.colorCodeImageUrl) } : {}),
      className: resolveClassNameForIdCard(student),
      schoolName:
        student.school?.schoolName ||
        (typeof student.schoolId === "object" && student.schoolId?.schoolName
          ? student.schoolId.schoolName
          : "") ||
        "",
      address: student.address ?? "",
      dateOfBirth:
        student.dateOfBirth ?? student.birthDate ?? student.dob ?? undefined,
      phone: student.mobile ?? student.phone ?? undefined,
      email: student.email ?? undefined,
      extraFields,
      dimension:
        student.school?.dimension ??
        (typeof student.schoolId === "object"
          ? student.schoolId.dimension
          : null) ??
        null,
      dimensionUnit:
        student.school?.dimensionUnit ??
        (typeof student.schoolId === "object"
          ? student.schoolId.dimensionUnit
          : null) ??
        "mm",
    };
  },
    [
      isAllSchoolStudents,
      schoolAllStudentsData?.template,
      templateStatus?.template,
      sharedUploadedCanvasTemplate,
    ],
  );

  const requestOpenCardPreview = React.useCallback(
    async (student) => {
      let st = student;
      const id = student?._id || student?.id;
      const needsHydrate =
        studentHasUploadedPhoto(student) &&
        (!student.photoUrl || !String(student.photoUrl).trim());
      if (needsHydrate && id) {
        const pool = bulkPhotoDetailPayload?.data?.students;
        if (Array.isArray(pool)) {
          const hit = pool.find((x) => (x._id || x.id) === id);
          if (
            hit &&
            typeof hit.photoUrl === "string" &&
            hit.photoUrl.trim() !== ""
          ) {
            st = hit;
          }
        }
        if (!st.photoUrl || !String(st.photoUrl).trim()) {
          try {
            const classIdStr =
              typeof student.classId === "object" && student.classId != null
                ? student.classId._id || student.classId.id
                : student.classId;
            if (isOnlineMode) {
              if (typeof onlineApi.getStudentRecordForPreview === "function") {
                const row = await onlineApi.getStudentRecordForPreview(
                  id,
                  schoolId,
                  classIdStr,
                );
                if (row) st = row;
              }
            } else if (
              typeof offlineApi.getStudentRecordForPreview === "function"
            ) {
              const row = await offlineApi.getStudentRecordForPreview(id);
              if (row) st = row;
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
      setSingleCardPreview(studentToCard(st));
    },
    [
      bulkPhotoDetailPayload,
      isOnlineMode,
      schoolId,
      studentToCard,
    ],
  );

  const savedIdStudentListItemData = React.useMemo(
    () => ({
      students: studentsForList,
      studentToCard,
      studentHasRenderableSavedCard,
      schoolAllStudentsData,
      templateStatus,
      isAllSchoolStudents,
      isViewTemplateFlow,
      getTemplateName,
      formatStudentClassForIdCard,
      requestOpenCardPreview,
      setEditStudentData,
      formatToDDMMYYYYDot,
    }),
    [
      studentsForList,
      studentToCard,
      schoolAllStudentsData,
      templateStatus,
      isAllSchoolStudents,
      isViewTemplateFlow,
      getTemplateName,
      requestOpenCardPreview,
      // Stable functions don't need to be in dependencies:
      // formatStudentClassForIdCard, setEditStudentData, formatToDDMMYYYYDot
    ],
  );

  const getPreviewUrl = (student) => {
    const templateId = student.template?.templateId || student._id;
    let base = `${previewBasePath}/${student._id}/${templateId}`;
    if (schoolId && classId)
      base += `?schoolId=${encodeURIComponent(schoolId)}&classId=${encodeURIComponent(classId)}`;
    else if (schoolId && isAllSchoolStudents)
      base += `?schoolId=${encodeURIComponent(schoolId)}&allStudents=1`;
    return base;
  };

  /** Building thousands of card objects on the main list screen freezes the UI; build only for preview/print. */
  const needCardsForPrintLayout = showPreviewView || showPrintView;
  const [cardsToPrint, setCardsToPrint] = useState([]);
  const previewWaitingForBulkPhotos =
    needCardsForPrintLayout &&
    previewNeedsBulkPhotoData &&
    (bulkPhotoHydrationStatus === "idle" ||
      bulkPhotoHydrationStatus === "loading");

  useEffect(() => {
    if (!needCardsForPrintLayout) {
      setCardsToPrint([]);
      return;
    }
    const students = studentsForPreviewPrint;
    if (students.length === 0) {
      setCardsToPrint([]);
      return;
    }
    if (previewWaitingForBulkPhotos) {
      setCardsToPrint([]);
      return;
    }

    let cancelled = false;

    const preloadChunkCards = (cards) =>
      Promise.all(cards.map((c) => preloadCardVisualAssets(c)));

    const run = async () => {
      const buildChunk = (slice) => slice.map((s) => studentToCard(s));

      const pushChunk = async (start, end, isFirst) => {
        const slice = students.slice(start, end);
        const chunk = buildChunk(slice);
        await preloadChunkCards(chunk);
        if (cancelled) return;
        if (isFirst) setCardsToPrint(chunk);
        else setCardsToPrint((prev) => [...prev, ...chunk]);
      };

      const firstEnd = Math.min(PREVIEW_CARDS_CHUNK_SIZE, students.length);
      await pushChunk(0, firstEnd, true);
      let index = firstEnd;
      while (index < students.length) {
        const end = Math.min(index + PREVIEW_CARDS_CHUNK_SIZE, students.length);
        await pushChunk(index, end, false);
        index = end;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    needCardsForPrintLayout,
    studentsForPreviewPrint,
    studentToCard,
    previewWaitingForBulkPhotos,
  ]);
  const cardsToPrintRef = useRef(cardsToPrint);
  cardsToPrintRef.current = cardsToPrint;
  const hasFabricCards = cardsToPrint.some((c) =>
    c.templateId?.startsWith("fabric-"),
  );

  // How many cards fit per page from current page size (preset or custom), card dimensions and current preview gaps
  const printLayout = React.useMemo(() => {
    const first = cardsToPrint[0];
    let cardWidthMm = DEFAULT_CARD_WIDTH_MM;
    let cardHeightMm = DEFAULT_CARD_HEIGHT_MM;
    if (
      first?.dimension &&
      typeof first.dimension.width === "number" &&
      typeof first.dimension.height === "number"
    ) {
      const unit = first.dimensionUnit || "mm";
      cardWidthMm = convertToMm(first.dimension.width, unit);
      cardHeightMm = convertToMm(first.dimension.height, unit);
    }
    if (!Number.isFinite(cardWidthMm) || cardWidthMm <= 0) {
      cardWidthMm = DEFAULT_CARD_WIDTH_MM;
    }
    if (!Number.isFinite(cardHeightMm) || cardHeightMm <= 0) {
      cardHeightMm = DEFAULT_CARD_HEIGHT_MM;
    }
    const usableW = layoutPageWidthMm - 2 * PRINT_PAGE_MARGIN_MM;
    const usableH = layoutPageHeightMm - 2 * PRINT_PAGE_MARGIN_MM;
    const gapH = layoutPreviewGapHorizontalMm;
    const gapV = layoutPreviewGapVerticalMm;
    const cols = Math.max(
      1,
      Math.floor((usableW + gapH) / (cardWidthMm + gapH)),
    );
    const rows = Math.max(
      1,
      Math.floor((usableH + gapV) / (cardHeightMm + gapV)),
    );
    const cardsPerPage = cols * rows;
    const totalPages = cardsToPrint.length
      ? Math.ceil(cardsToPrint.length / cardsPerPage)
      : 0;
    return { cardWidthMm, cardHeightMm, cols, rows, cardsPerPage, totalPages };
  }, [
    cardsToPrint,
    layoutPageWidthMm,
    layoutPageHeightMm,
    layoutPreviewGapHorizontalMm,
    layoutPreviewGapVerticalMm,
  ]);

  const { cardWidthMm, cardHeightMm, cols, rows, cardsPerPage, totalPages } =
    printLayout;

  // One A4 page = fronts; optional second page = backs per batch only when at least one card has a back (uploaded custom or built-in)
  const previewSpreadPages = React.useMemo(() => {
    const out = [];
    if (!cardsToPrint.length || !cardsPerPage) return out;
    const batches = Math.ceil(cardsToPrint.length / cardsPerPage);
    for (let b = 0; b < batches; b++) {
      const start = b * cardsPerPage;
      const pageCards = cardsToPrint.slice(start, start + cardsPerPage);
      out.push({ batchIndex: b, side: "front" });
      if (batchHasBackPage(pageCards)) out.push({ batchIndex: b, side: "back" });
    }
    return out;
  }, [cardsToPrint, cardsPerPage]);

  const spreadPagesCount = previewSpreadPages.length;
  const [visiblePreviewSpreadPagesCount, setVisiblePreviewSpreadPagesCount] =
    useState(0);
  const previewLayoutRenderKey = `${layoutPageWidthMm}|${layoutPageHeightMm}|${layoutPreviewGapHorizontalMm}|${layoutPreviewGapVerticalMm}|${cardsPerPage}|${cardsToPrint.length}`;
  const lastPreviewLayoutRenderKeyRef = useRef(null);
  const layoutJustChangedForPreview =
    lastPreviewLayoutRenderKeyRef.current !== previewLayoutRenderKey;
  const shouldRenderAllPreviewSpreadPages =
    exporting ||
    pendingExportFormat !== null ||
    seeAllJpegDialogOpen ||
    showPrintView;
  const effectiveVisiblePreviewSpreadPagesCount =
    shouldRenderAllPreviewSpreadPages
      ? spreadPagesCount
      : layoutJustChangedForPreview
        ? Math.min(PREVIEW_PAGES_RENDER_CHUNK_SIZE, spreadPagesCount)
        : visiblePreviewSpreadPagesCount;
  const visiblePreviewSpreadPages = React.useMemo(() => {
    if (shouldRenderAllPreviewSpreadPages) return previewSpreadPages;
    return previewSpreadPages.slice(0, effectiveVisiblePreviewSpreadPagesCount);
  }, [
    previewSpreadPages,
    shouldRenderAllPreviewSpreadPages,
    effectiveVisiblePreviewSpreadPagesCount,
  ]);
  const previewPagesStillRendering =
    showPreviewView &&
    !shouldRenderAllPreviewSpreadPages &&
    effectiveVisiblePreviewSpreadPagesCount < spreadPagesCount;

  useLayoutEffect(() => {
    lastPreviewLayoutRenderKeyRef.current = previewLayoutRenderKey;
  }, [previewLayoutRenderKey]);

  useEffect(() => {
    if (!showPreviewView) {
      setVisiblePreviewSpreadPagesCount(0);
      return;
    }
    if (spreadPagesCount <= 0) {
      setVisiblePreviewSpreadPagesCount(0);
      return;
    }
    if (shouldRenderAllPreviewSpreadPages) {
      setVisiblePreviewSpreadPagesCount(spreadPagesCount);
      return;
    }
    let cancelled = false;
    let timeoutId = null;
    let rafId = null;
    let renderedCount = Math.min(PREVIEW_PAGES_RENDER_CHUNK_SIZE, spreadPagesCount);
    setVisiblePreviewSpreadPagesCount(renderedCount);

    const pump = () => {
      if (cancelled) return;
      renderedCount = Math.min(
        spreadPagesCount,
        renderedCount + PREVIEW_PAGES_RENDER_CHUNK_SIZE,
      );
      setVisiblePreviewSpreadPagesCount(renderedCount);
      if (renderedCount < spreadPagesCount) {
        timeoutId = window.setTimeout(() => {
          rafId = requestAnimationFrame(pump);
        }, PREVIEW_PAGES_RENDER_DELAY_MS);
      }
    };

    if (renderedCount < spreadPagesCount) {
      timeoutId = window.setTimeout(() => {
        rafId = requestAnimationFrame(pump);
      }, PREVIEW_PAGES_RENDER_DELAY_MS);
    }

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [showPreviewView, spreadPagesCount, shouldRenderAllPreviewSpreadPages]);

  const previewPrintCardsStillLoading =
    needCardsForPrintLayout &&
    studentsForPreviewPrint.length > 0 &&
    (previewWaitingForBulkPhotos ||
      cardsToPrint.length < studentsForPreviewPrint.length);

  useEffect(() => {
    if (!showPreviewView) return;
    const scroller = previewScrollRef.current;
    if (!scroller) return;
    // Always open preview from the true left edge.
    scroller.scrollLeft = 0;
    const raf1 = requestAnimationFrame(() => {
      scroller.scrollLeft = 0;
      const raf2 = requestAnimationFrame(() => {
        scroller.scrollLeft = 0;
      });
      void raf2;
    });
    return () => cancelAnimationFrame(raf1);
  }, [
    showPreviewView,
    layoutPageWidthMm,
    layoutPageHeightMm,
    cols,
    rows,
    layoutPreviewGapHorizontalMm,
    layoutPreviewGapVerticalMm,
  ]);

  const pageSizeSummary = React.useMemo(() => {
    const u = pageSizeUnit === "px" ? "px" : pageSizeUnit;
    if (pageSizeMode === "custom") {
      return `Custom (${mmToUnit(pageWidthMm, pageSizeUnit).toFixed(1)}×${mmToUnit(pageHeightMm, pageSizeUnit).toFixed(1)} ${u})`;
    }
    const preset = PAGE_PRESET_MM[pageSizeMode];
    const name =
      PAGE_PRESET_DISPLAY_NAME[pageSizeMode] ?? String(pageSizeMode).toUpperCase();
    if (preset) {
      return `${name} (${mmToUnit(preset.w, pageSizeUnit).toFixed(1)}×${mmToUnit(preset.h, pageSizeUnit).toFixed(1)} ${u})`;
    }
    return `A4 (${mmToUnit(A4_WIDTH_MM, pageSizeUnit).toFixed(1)}×${mmToUnit(A4_HEIGHT_MM, pageSizeUnit).toFixed(1)} ${u})`;
  }, [pageSizeMode, pageSizeUnit, pageWidthMm, pageHeightMm]);

  const pageSizeControlStyle = {
    background: "#2a2a2a",
    border: "1px solid rgba(255,255,255,0.2)",
    color: "#fff",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
  };

  const renderPageSizeControls = (idPrefix = "page") => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
      }}
    >
      <label
        htmlFor={`${idPrefix}-size-mode`}
        style={{ color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" }}
      >
        Page size
      </label>
      <select
        id={`${idPrefix}-size-mode`}
        value={pageSizeMode}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") {
            let w = customPageWidthMm;
            let h = customPageHeightMm;
            if (pageSizeMode !== "custom") {
              const preset = PAGE_PRESET_MM[pageSizeMode];
              if (preset) {
                w = preset.w;
                h = preset.h;
              } else {
                w = A4_WIDTH_MM;
                h = A4_HEIGHT_MM;
              }
            }
            const cw = clampPageMm(w, A4_WIDTH_MM);
            const ch = clampPageMm(h, A4_HEIGHT_MM);
            setCustomPageWidthMm(cw);
            setCustomPageHeightMm(ch);
            setCustomPageWidthInput(String(mmToUnit(cw, pageSizeUnit)));
            setCustomPageHeightInput(String(mmToUnit(ch, pageSizeUnit)));
          }
          setPageSizeMode(v);
        }}
        style={{ ...pageSizeControlStyle, minWidth: 280 }}
      >
        <option value="c1">{`C1[08.0" x 12.0"]`}</option>
        <option value="c2">{`C2[12.0" x 18.0"]`}</option>
        <option value="c3">{`C3[04.0" x 06.0"]`}</option>
        <option value="a3">{`A3 [11.7" x 16.5"]`}</option>
        <option value="a4">{`A4 [08.3" x 11.7"]`}</option>
        <option value="a5">{`A5 [05.8" x 08.3"]`}</option>
        <option value="p1">{`P1 [08.5" x 14.0"]`}</option>
        <option value="custom">CUSTOME SIZE</option>
      </select>
      <label
        htmlFor={`${idPrefix}-unit`}
        style={{ color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" }}
      >
        Unit
      </label>
      <select
        id={`${idPrefix}-unit`}
        value={pageSizeUnit}
        onChange={(e) => setPageSizeUnit(e.target.value)}
        style={{ ...pageSizeControlStyle, minWidth: 110 }}
      >
        <option value="mm">mm</option>
        <option value="cm">cm</option>
        <option value="px">pixel</option>
        <option value="inch">inch</option>
      </select>
      {pageSizeMode === "custom" && (
        <>
          <label
            htmlFor={`${idPrefix}-w`}
            style={{
              color: "rgba(255,255,255,0.85)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Width ({pageSizeUnit === "px" ? "px" : pageSizeUnit})
            <input
              id={`${idPrefix}-w`}
              type="number"
              min={mmToUnit(MIN_PAGE_MM, pageSizeUnit)}
              max={mmToUnit(MAX_PAGE_MM, pageSizeUnit)}
              step={getStepForUnit(pageSizeUnit)}
              value={customPageWidthInput}
              onChange={(e) => {
                const raw = e.target.value;
                setCustomPageWidthInput(raw);
                scheduleWidthMmCommitFromInput(raw);
              }}
              onFocus={() => setIsEditingPageWidth(true)}
              onBlur={() => {
                if (pageWidthInputCommitTimeoutRef.current !== null) {
                  window.clearTimeout(pageWidthInputCommitTimeoutRef.current);
                  pageWidthInputCommitTimeoutRef.current = null;
                }
                const parsed = parseUnitInput(customPageWidthInput);
                if (!Number.isFinite(parsed)) {
                  setCustomPageWidthInput(
                    String(mmToUnit(customPageWidthMm, pageSizeUnit)),
                  );
                  setIsEditingPageWidth(false);
                  return;
                }
                const nextMm = clampPageMm(
                  convertToMm(parsed, pageSizeUnit),
                  A4_WIDTH_MM,
                );
                setCustomPageWidthMm(nextMm);
                setCustomPageWidthInput(String(mmToUnit(nextMm, pageSizeUnit)));
                setIsEditingPageWidth(false);
              }}
              style={{ ...pageSizeControlStyle, width: 88 }}
            />
          </label>
          <label
            htmlFor={`${idPrefix}-h`}
            style={{
              color: "rgba(255,255,255,0.85)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Height ({pageSizeUnit === "px" ? "px" : pageSizeUnit})
            <input
              id={`${idPrefix}-h`}
              type="number"
              min={mmToUnit(MIN_PAGE_MM, pageSizeUnit)}
              max={mmToUnit(MAX_PAGE_MM, pageSizeUnit)}
              step={getStepForUnit(pageSizeUnit)}
              value={customPageHeightInput}
              onChange={(e) => {
                const raw = e.target.value;
                setCustomPageHeightInput(raw);
                scheduleHeightMmCommitFromInput(raw);
              }}
              onFocus={() => setIsEditingPageHeight(true)}
              onBlur={() => {
                if (pageHeightInputCommitTimeoutRef.current !== null) {
                  window.clearTimeout(pageHeightInputCommitTimeoutRef.current);
                  pageHeightInputCommitTimeoutRef.current = null;
                }
                const parsed = parseUnitInput(customPageHeightInput);
                if (!Number.isFinite(parsed)) {
                  setCustomPageHeightInput(
                    String(mmToUnit(customPageHeightMm, pageSizeUnit)),
                  );
                  setIsEditingPageHeight(false);
                  return;
                }
                const nextMm = clampPageMm(
                  convertToMm(parsed, pageSizeUnit),
                  A4_HEIGHT_MM,
                );
                setCustomPageHeightMm(nextMm);
                setCustomPageHeightInput(String(mmToUnit(nextMm, pageSizeUnit)));
                setIsEditingPageHeight(false);
              }}
              style={{ ...pageSizeControlStyle, width: 88 }}
            />
          </label>
        </>
      )}
    </div>
  );

  const renderPreviewGapControls = (idPrefix = "preview-gap") => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        marginTop: 10,
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" }}>
        Card spacing (preview)
      </span>
      <label
        htmlFor={`${idPrefix}-unit`}
        style={{ color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" }}
      >
        Unit
      </label>
      <select
        id={`${idPrefix}-unit`}
        value={previewGapUnit}
        onChange={(e) => setPreviewGapUnit(e.target.value)}
        style={{ ...pageSizeControlStyle, minWidth: 110 }}
      >
        <option value="mm">mm</option>
        <option value="cm">cm</option>
        <option value="px">pixel</option>
        <option value="inch">inch</option>
      </select>
      <label
        htmlFor={`${idPrefix}-h`}
        style={{
          color: "rgba(255,255,255,0.85)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        Horizontal ({previewGapUnit === "px" ? "px" : previewGapUnit})
        <input
          id={`${idPrefix}-h`}
          type="number"
          min={mmToUnit(MIN_PREVIEW_GAP_MM, previewGapUnit)}
          max={mmToUnit(MAX_PREVIEW_GAP_MM, previewGapUnit)}
          step={getGapStepForUnit(previewGapUnit)}
          value={previewGapHorizontalInput}
          onChange={(e) => {
            const raw = e.target.value;
            setPreviewGapHorizontalInput(raw);
            scheduleHorizontalPreviewGapCommitFromInput(raw);
          }}
          onFocus={() => setIsEditingPreviewGapHorizontal(true)}
          onBlur={() => {
            if (previewGapHorizontalCommitTimeoutRef.current !== null) {
              window.clearTimeout(previewGapHorizontalCommitTimeoutRef.current);
              previewGapHorizontalCommitTimeoutRef.current = null;
            }
            const parsed = parseUnitInput(previewGapHorizontalInput);
            if (!Number.isFinite(parsed)) {
              setPreviewGapHorizontalInput(
                String(mmToUnit(previewGapHorizontalMm, previewGapUnit)),
              );
              setIsEditingPreviewGapHorizontal(false);
              return;
            }
            const nextMm = clampPreviewGapMm(
              convertToMm(parsed, previewGapUnit),
              DEFAULT_PREVIEW_GRID_GAP_MM,
            );
            setPreviewGapHorizontalMm(nextMm);
            setPreviewGapHorizontalInput(String(mmToUnit(nextMm, previewGapUnit)));
            setIsEditingPreviewGapHorizontal(false);
          }}
          style={{ ...pageSizeControlStyle, width: 72 }}
        />
      </label>
      <label
        htmlFor={`${idPrefix}-v`}
        style={{
          color: "rgba(255,255,255,0.85)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        Vertical ({previewGapUnit === "px" ? "px" : previewGapUnit})
        <input
          id={`${idPrefix}-v`}
          type="number"
          min={mmToUnit(MIN_PREVIEW_GAP_MM, previewGapUnit)}
          max={mmToUnit(MAX_PREVIEW_GAP_MM, previewGapUnit)}
          step={getGapStepForUnit(previewGapUnit)}
          value={previewGapVerticalInput}
          onChange={(e) => {
            const raw = e.target.value;
            setPreviewGapVerticalInput(raw);
            scheduleVerticalPreviewGapCommitFromInput(raw);
          }}
          onFocus={() => setIsEditingPreviewGapVertical(true)}
          onBlur={() => {
            if (previewGapVerticalCommitTimeoutRef.current !== null) {
              window.clearTimeout(previewGapVerticalCommitTimeoutRef.current);
              previewGapVerticalCommitTimeoutRef.current = null;
            }
            const parsed = parseUnitInput(previewGapVerticalInput);
            if (!Number.isFinite(parsed)) {
              setPreviewGapVerticalInput(
                String(mmToUnit(previewGapVerticalMm, previewGapUnit)),
              );
              setIsEditingPreviewGapVertical(false);
              return;
            }
            const nextMm = clampPreviewGapMm(
              convertToMm(parsed, previewGapUnit),
              DEFAULT_PREVIEW_GRID_GAP_MM,
            );
            setPreviewGapVerticalMm(nextMm);
            setPreviewGapVerticalInput(String(mmToUnit(nextMm, previewGapUnit)));
            setIsEditingPreviewGapVertical(false);
          }}
          style={{ ...pageSizeControlStyle, width: 72 }}
        />
      </label>
      <label
        htmlFor={`${idPrefix}-page-bg`}
        style={{
          color: "rgba(255,255,255,0.85)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        Page color
        <input
          id={`${idPrefix}-page-bg`}
          type="color"
          value={normalizeHexColor(previewPageBackgroundColor)}
          onChange={(e) =>
            setPreviewPageBackgroundColor(normalizeHexColor(e.target.value))
          }
          title="Preview page background"
          style={{
            width: 40,
            height: 32,
            padding: 0,
            border: "1px solid rgba(255,255,255,0.35)",
            borderRadius: 6,
            cursor: "pointer",
            background: "transparent",
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "6px 10px", fontSize: 12 }}
          onClick={() => setPreviewPageBackgroundColor(DEFAULT_PREVIEW_PAGE_BG)}
        >
          White
        </button>
      </label>
    </div>
  );

  useEffect(() => {
    const onAfterPrint = () => setShowPrintView(false);
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  useEffect(() => {
    if (!showDownloadMenuList && !showDownloadMenuPreview) return;
    const close = (e) => {
      if (!e.target.closest(".download-dropdown-wrap")) {
        setShowDownloadMenuList(false);
        setShowDownloadMenuPreview(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showDownloadMenuList, showDownloadMenuPreview]);

  useEffect(() => {
    if (!pendingExportFormat || !showPreviewView) return;
    const format = pendingExportFormat;
    let cancelled = false;
    const run = async () => {
      exportCancelRequestedRef.current = false;
      const isAborted = () => cancelled || exportCancelRequestedRef.current;
      flushSync(() => {
        setExporting(true);
        setExportProgress({ label: "Preparing…", current: 0, total: 1 });
      });
      const subfolderName = isAllSchoolStudents
        ? String(
          selectedSchool?.schoolName ||
          selectedSchool?.schoolCode ||
          schoolId ||
          "School",
        ).trim() || "School"
        : String(
          selectedClass
            ? [selectedClass.className, selectedClass.section]
              .filter(Boolean)
              .join(" ")
              .trim()
            : classId || schoolId || "Class",
        ).trim() || "Class";
      let captured = false;
      const fastBulkPreviewExport =
        isAllSchoolStudents ||
        spreadPagesCount >= FAST_PREVIEW_EXPORT_THRESHOLD_PAGES ||
        studentsForPreviewPrint.length >= FAST_PREVIEW_EXPORT_THRESHOLD_CARDS;
      const autoPageOnlyLargeExport =
        FAST_EXPORT_AUTO_PAGE_ONLY && fastBulkPreviewExport;
      const useFastBulkCapture = format === "jpg" && fastBulkPreviewExport;
      /** Throttle parallel html2canvas progress so the counter steps ~1/s tick, not by concurrency (e.g. 7). */
      const useExportProgressThrottle =
        useFastBulkCapture ||
        ((format === "pdf" || format === "png") && fastBulkPreviewExport);
      const jpegCaptureOpts = { bulk: useFastBulkCapture, shouldAbort: isAborted };
      const fastRasterPoll =
        fastBulkPreviewExport && (format === "png" || format === "pdf");
      const maxAttempts =
        format === "jpg"
          ? useFastBulkCapture
            ? 120
            : 220
          : fastRasterPoll
            ? 120
            : 100;
      const stepMs =
        format === "jpg"
          ? useFastBulkCapture
            ? 12
            : 120
          : fastRasterPoll
            ? 12
            : 100;
      const progressThrottle = useExportProgressThrottle
        ? createProgressThrottle(
            Math.max(
              50,
              Math.round(1000 / FAST_EXPORT_PROGRESS_UPDATES_PER_SEC),
            ),
            (p) => {
              if (isAborted()) return;
              flushSync(() => setExportProgress(p));
            },
          )
        : null;
      const onProg = (p) => {
        if (isAborted()) return;
        if (progressThrottle) {
          progressThrottle.emit(p);
        } else {
          setExportProgress(p);
        }
      };
      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await abortableDelay(stepMs, isAborted);
          if (isAborted()) throw new ExportCancelledError();
          const wrap = previewPagesWrapRef.current;
          if (!wrap) continue;
          const nodes = wrap.querySelectorAll(".print-page.preview-page");
          const cards = cardsToPrintRef.current;
          const pageExportContext = {
            cards,
            cardsPerPage,
            layout: {
              pageWidthMm: layoutPageWidthMm,
              pageHeightMm: layoutPageHeightMm,
              marginMm: PRINT_PAGE_MARGIN_MM,
              gapHm: layoutPreviewGapHorizontalMm,
              gapVm: layoutPreviewGapVerticalMm,
              cols,
              rows,
              cardWidthMm,
              cardHeightMm,
            },
          };
          if (
            nodes.length <= 0 ||
            spreadPagesCount <= 0 ||
            nodes.length !== spreadPagesCount
          ) {
            continue;
          }
          if (format === "pdf") {
            setExportProgress({
              label: "Creating PDF…",
              current: 0,
              total: 1,
            });
            await exportPreviewPdfFromPreview(
              Array.from(nodes),
              pageWidthMm,
              pageHeightMm,
              subfolderName,
              previewPageBackgroundColor,
              onProg,
              isAborted,
              fastBulkPreviewExport,
              pageExportContext,
            );
            progressThrottle?.flush();
            captured = true;
            break;
          }
          if (format === "jpg") {
            const rawJpegMode = jpegExportMode ?? "both";
            const effectiveJpegMode =
              autoPageOnlyLargeExport && rawJpegMode === "both"
                ? "pages"
                : rawJpegMode;
            const includePerCard =
              effectiveJpegMode === "both" || effectiveJpegMode === "single";
            const includePages =
              effectiveJpegMode === "both" || effectiveJpegMode === "pages";

            const frontCells = getFrontCardCellElements(wrap);
            const backCells = getBackCardCellElements(wrap);
            const expectedBackCells = countExpectedBackDomCells(
              cards,
              cardsPerPage,
            );

            if (includePerCard) {
              if (
                frontCells.length !== cards.length ||
                backCells.length !== expectedBackCells ||
                cards.length === 0
              ) {
                continue;
              }
            } else if (includePages) {
              if (nodes.length !== spreadPagesCount || spreadPagesCount <= 0) {
                continue;
              }
            } else {
              continue;
            }

            setExportProgress({
              label:
                autoPageOnlyLargeExport && rawJpegMode === "both"
                  ? "Large export: full pages only (faster)…"
                  : "Rendering cards…",
              current: 0,
              total: 1,
            });
            const renderDelayMs = includePerCard
              ? hasFabricCards
                ? useFastBulkCapture
                  ? 1200
                  : 2800
                : useFastBulkCapture
                  ? 120
                  : 650
              : hasFabricCards
                ? useFastBulkCapture
                  ? 500
                  : 2800
                : useFastBulkCapture
                  ? 32
                  : 400;
            await abortableDelay(renderDelayMs, isAborted);
            if (isAborted()) throw new ExportCancelledError();
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
            if (isAborted()) throw new ExportCancelledError();

            if (includePerCard) {
              const cellsReadyFront = getFrontCardCellElements(wrap);
              const cellsReadyBack = getBackCardCellElements(wrap);
              if (
                cellsReadyFront.length !== cards.length ||
                cellsReadyBack.length !== expectedBackCells
              ) {
                continue;
              }
            }

            const files = [];
            if (includePerCard) {
              const cardFiles = await buildPreviewFrontAndBackJpegFiles(
                wrap,
                cards,
                previewPageBackgroundColor,
                onProg,
                cardsPerPage,
                jpegCaptureOpts,
              );
              files.push(...cardFiles);
              progressThrottle?.flush();
            }
            if (includePages) {
              try {
                const pageFiles = await buildPreviewPagesJpegFiles(
                  nodes,
                  previewPageBackgroundColor,
                  onProg,
                  jpegCaptureOpts,
                  pageExportContext,
                );
                files.push(...pageFiles);
              } catch (e) {
                if (isExportCancelledError(e)) throw e;
                if (includePerCard) {
                  console.warn(
                    "Page JPEG export failed (keeping per-card JPEGs):",
                    e,
                  );
                } else {
                  throw e;
                }
              }
              progressThrottle?.flush();
            }

            if (files.length === 0) {
              continue;
            }

            const saveResult = await saveJpegExportToFolder(
              subfolderName,
              files,
              onProg,
              jpegWebParentDirHandleRef.current,
              isAborted,
            );
            progressThrottle?.flush();
            if (saveResult?.cancelled) {
              captured = true;
              break;
            }
            captured = true;
            break;
          }
          if (format === "png") {
            const pngPageOnly = autoPageOnlyLargeExport;
            if (!pngPageOnly) {
              const frontCells = getFrontCardCellElements(wrap);
              const backCells = getBackCardCellElements(wrap);
              const expectedBackCells = countExpectedBackDomCells(
                cards,
                cardsPerPage,
              );
              if (
                frontCells.length !== cards.length ||
                backCells.length !== expectedBackCells ||
                cards.length === 0 ||
                nodes.length !== spreadPagesCount ||
                spreadPagesCount <= 0
              ) {
                continue;
              }
            } else if (
              nodes.length !== spreadPagesCount ||
              spreadPagesCount <= 0
            ) {
              continue;
            }
            setExportProgress({
              label: pngPageOnly
                ? "Large export: full pages only (faster)…"
                : "Rendering cards…",
              current: 0,
              total: 1,
            });
            const renderDelayMs = pngPageOnly
              ? hasFabricCards
                ? 500
                : 32
              : hasFabricCards
                ? fastBulkPreviewExport
                  ? 1200
                  : 2800
                : fastBulkPreviewExport
                  ? 120
                  : 650;
            await abortableDelay(renderDelayMs, isAborted);
            if (isAborted()) throw new ExportCancelledError();
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
            if (isAborted()) throw new ExportCancelledError();

            if (!pngPageOnly) {
              const cellsReadyFront = getFrontCardCellElements(wrap);
              const cellsReadyBack = getBackCardCellElements(wrap);
              const expectedBackCells = countExpectedBackDomCells(
                cards,
                cardsPerPage,
              );
              if (
                cellsReadyFront.length !== cards.length ||
                cellsReadyBack.length !== expectedBackCells
              ) {
                continue;
              }
            }

            const files = [];
            if (!pngPageOnly) {
              const cardFiles = await buildPreviewFrontAndBackPngFiles(
                wrap,
                cards,
                previewPageBackgroundColor,
                onProg,
                cardsPerPage,
                { bulk: fastBulkPreviewExport, shouldAbort: isAborted },
              );
              files.push(...cardFiles);
              progressThrottle?.flush();
            }
            const pageFiles = await buildPreviewPagesPngFiles(
              nodes,
              previewPageBackgroundColor,
              onProg,
              { bulk: fastBulkPreviewExport, shouldAbort: isAborted },
              pageExportContext,
            );
            files.push(...pageFiles);
            progressThrottle?.flush();
            if (files.length === 0) continue;
            const saveResult = await savePngExportToFolder(
              subfolderName,
              files,
              onProg,
              isAborted,
            );
            progressThrottle?.flush();
            if (saveResult?.cancelled) {
              captured = true;
              break;
            }
            captured = true;
            break;
          }
        }
        if (
          !captured &&
          !cancelled &&
          !exportCancelRequestedRef.current
        ) {
          window.alert(
            "Could not capture the preview. Open Preview, wait for cards to load, then try Download again.",
          );
        }
      } catch (err) {
        if (!isExportCancelledError(err) && !cancelled) {
          console.error(err);
          window.alert(
            (typeof err?.message === "string" && err.message.trim()) ||
            "Download failed. Wait for the preview to finish loading, then try again.",
          );
        }
      } finally {
        if (!cancelled) {
          // Do not clear exportCancelRequestedRef here: in-flight html2canvas/PDF work can
          // finish after this finally runs; clearing the ref would let late onProgress calls
          // think the export is still active and show "Downloading…" again. The next run()
          // resets the ref at startup.
          setExporting(false);
          setPendingExportFormat(null);
          setJpegExportMode(null);
          setExportProgress(null);
          jpegWebParentDirHandleRef.current = null;
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    pendingExportFormat,
    jpegExportMode,
    showPreviewView,
    spreadPagesCount,
    studentsForPreviewPrint.length,
    cardsPerPage,
    pageWidthMm,
    pageHeightMm,
    layoutPageWidthMm,
    layoutPageHeightMm,
    layoutPreviewGapHorizontalMm,
    layoutPreviewGapVerticalMm,
    cols,
    rows,
    cardWidthMm,
    cardHeightMm,
    classId,
    schoolId,
    isAllSchoolStudents,
    selectedClass,
    selectedSchool,
    previewPageBackgroundColor,
    hasFabricCards,
  ]);

  const ensureViewTemplateDownloadCharge = async () => {
    if (!isViewTemplateFlow) return true;
    const studentIds = studentsForPreviewPrint
      .map((student) => student?._id)
      .filter((id) => typeof id === "string" && id.trim() !== "");

    if (studentIds.length === 0) {
      window.alert("No students found for template download.");
      return false;
    }

    try {
      setChargingDownloadPoints(true);
      const chargeResult = await deductTemplateDownloadPoints(studentIds);
      if (typeof chargeResult?.balanceAfter === "number") {
        window.dispatchEvent(
          new CustomEvent("photographer-points-updated", {
            detail: {
              pointsBalance: chargeResult.balanceAfter,
              perStudentTemplateCost: chargeResult.rateApplied,
            },
          }),
        );
      }
    } catch (err) {
      console.error(err);
      window.alert(
        err?.message || "Unable to deduct points. Please try again.",
      );
      return false;
    } finally {
      setChargingDownloadPoints(false);
    }
    return true;
  };

  /** Browser: folder picker here (must run in click handler). Then starts JPEG export. */
  const prepareAndStartJpegExport = async (mode) => {
    const isElectronApp = Boolean(
      typeof window !== "undefined" && window.electron?.selectOutputFolder,
    );
    const canTryFileSystemAccessPicker =
      !isElectronApp &&
      typeof window.showDirectoryPicker === "function" &&
      window.isSecureContext !== false;

    jpegWebParentDirHandleRef.current = null;
    if (canTryFileSystemAccessPicker) {
      try {
        jpegWebParentDirHandleRef.current =
          await window.showDirectoryPicker();
      } catch (e) {
        if (e?.name === "AbortError") return;
        console.warn("Folder picker unavailable, using download fallback:", e);
        jpegWebParentDirHandleRef.current = null;
      }
    }

    const charged = await ensureViewTemplateDownloadCharge();
    if (!charged) return;

    setJpegExportMode(mode);
    if (!showPreviewView) setShowPreviewView(true);
    setPendingExportFormat("jpg");
  };

  const triggerExport = async (fmt) => {
    if (exporting || chargingDownloadPoints) return;
    setShowDownloadMenuList(false);
    setShowDownloadMenuPreview(false);

    if (fmt === "jpg" && isAllSchoolStudents) {
      setSeeAllJpegDialogOpen(true);
      return;
    }

    if (fmt === "jpg") {
      await prepareAndStartJpegExport("both");
      return;
    }

    jpegWebParentDirHandleRef.current = null;

    flushSync(() => {
      setExporting(true);
      setExportProgress({ label: "Preparing…", current: 0, total: 1 });
    });
    const charged = await ensureViewTemplateDownloadCharge();
    if (!charged) {
      setExporting(false);
      setExportProgress(null);
      return;
    }

    if (!showPreviewView) {
      setShowPreviewView(true);
    }
    setPendingExportFormat(fmt);
  };

  const cardCellStyle = (card) => {
    const dim = card.dimension;
    const unit = card.dimensionUnit || "mm";
    if (
      dim &&
      typeof dim.width === "number" &&
      typeof dim.height === "number"
    ) {
      return {
        width: `${dim.width}${unit}`,
        height: `${dim.height}${unit}`,
        minWidth: `${dim.width}${unit}`,
        minHeight: `${dim.height}${unit}`,
      };
    }
    return undefined;
  };

  /** Front + back stack in single-student modal: match school card size (same logic as print preview). */
  const singleStackPreviewStyle = (card) => {
    const dim = card?.dimension;
    const unit = card?.dimensionUnit || "mm";
    let wMm = DEFAULT_CARD_WIDTH_MM;
    let hMm = DEFAULT_CARD_HEIGHT_MM;
    if (
      dim &&
      typeof dim.width === "number" &&
      typeof dim.height === "number"
    ) {
      wMm = convertToMm(dim.width, unit);
      hMm = convertToMm(dim.height, unit);
    }
    const stackHMm = 2 * hMm + PRINT_GAP_MM;
    return {
      width: `min(420px, 92vw, calc(85vh * ${wMm} / ${stackHMm}))`,
      maxWidth: "100%",
      height: "auto",
      aspectRatio: `${wMm} / ${stackHMm}`,
      boxSizing: "border-box",
      ["--card-w-mm"]: wMm,
      ["--card-h-mm"]: hMm,
    };
  };

  /** Single-student modal when uploaded template has no back image: one card height only. */
  const singleStackFrontOnlyStyle = (card) => {
    const dim = card?.dimension;
    const unit = card?.dimensionUnit || "mm";
    let wMm = DEFAULT_CARD_WIDTH_MM;
    let hMm = DEFAULT_CARD_HEIGHT_MM;
    if (
      dim &&
      typeof dim.width === "number" &&
      typeof dim.height === "number"
    ) {
      wMm = convertToMm(dim.width, unit);
      hMm = convertToMm(dim.height, unit);
    }
    return {
      width: `min(420px, 92vw, calc(85vh * ${wMm} / ${hMm}))`,
      maxWidth: "100%",
      height: "auto",
      aspectRatio: `${wMm} / ${hMm}`,
      boxSizing: "border-box",
      ["--card-w-mm"]: wMm,
      ["--card-h-mm"]: hMm,
    };
  };
  const getCardCropMarks = (index, totalCards, cols, isBackPage) => {
    const R = Math.floor((totalCards - 1) / cols);
    const firstRowFirst = 0;
    const firstRowLast = Math.min(cols - 1, totalCards - 1);
    const lastRowFirst = R * cols;
    const lastRowLast = totalCards - 1;

    let isTopLeft = false;
    let isTopRight = false;
    let isBottomLeft = false;
    let isBottomRight = false;

    if (index === firstRowFirst) isTopLeft = true;
    if (index === firstRowLast) isTopRight = true;
    if (index === lastRowFirst) isBottomLeft = true;
    if (index === lastRowLast) isBottomRight = true;

    if (!isTopLeft && !isTopRight && !isBottomLeft && !isBottomRight) return null;

    const renderDot = (pos, style) => (
      <div
        key={pos}
        className="idcard-sheet-crop-mark"
        style={{
          position: "absolute",
          width: "2mm",
          height: "2mm",
          backgroundColor: "#000",
          borderRadius: "50%",
          zIndex: 100,
          ...style
        }}
      />
    );

    const marks = [];
    if (isBackPage) {
      if (isTopLeft) marks.push(renderDot('tr', { top: 0, right: 0, transform: "translate(50%, -50%)" }));
      if (isTopRight) marks.push(renderDot('tl', { top: 0, left: 0, transform: "translate(-50%, -50%)" }));
      if (isBottomLeft) marks.push(renderDot('br', { bottom: 0, right: 0, transform: "translate(50%, 50%)" }));
      if (isBottomRight) marks.push(renderDot('bl', { bottom: 0, left: 0, transform: "translate(-50%, 50%)" }));
    } else {
      if (isTopLeft) marks.push(renderDot('tl', { top: 0, left: 0, transform: "translate(-50%, -50%)" }));
      if (isTopRight) marks.push(renderDot('tr', { top: 0, right: 0, transform: "translate(50%, -50%)" }));
      if (isBottomLeft) marks.push(renderDot('bl', { bottom: 0, left: 0, transform: "translate(-50%, 50%)" }));
      if (isBottomRight) marks.push(renderDot('br', { bottom: 0, right: 0, transform: "translate(50%, 50%)" }));
    }

    return marks.length > 0 ? <>{marks}</> : null;
  };

  const renderCardForPrint = (card, useGridSize = false, extraOverlay = null) => {
    const isFabric = card.templateId?.startsWith("fabric-");
    const fabricTemplate = isFabric
      ? getFabricTemplateById(card.templateId)
      : null;
    const cellStyle = useGridSize ? undefined : cardCellStyle(card);
    if (isFabric && fabricTemplate?.json) {
      const studentData = {
        name: card.name,
        studentId: card.studentId,
        className: card.className,
        schoolName: card.schoolName,
        studentImage: card.studentImage,
        ...(card.colorCodeImage ? { colorCodeImage: card.colorCodeImage } : {}),
        ...(card.address != null &&
          card.address !== "" && { address: card.address }),
      };
      return (
        <div
          key={`${card._id}-${card.id}`}
          className="print-card-cell fabric-card"
          style={{ ...cellStyle, position: "relative" }}
        >
          <FabricIdCardGenerator
            templateJson={fabricTemplate.json}
            backgroundDataUrl={fabricTemplate.backgroundDataUrl}
            studentData={studentData}
          />
          {extraOverlay}
        </div>
      );
    }
    const data = {
      studentImage: card.studentImage,
      ...(card.colorCodeImage ? { colorCodeImage: fullPhotoUrl(card.colorCodeImage) } : {}),
      name: card.name,
      studentId: card.studentId,
      className: card.className,
      schoolName: card.schoolName,
      extraFields: card.extraFields || {},
      ...(card.address != null &&
        card.address !== "" && { address: card.address }),
      ...(card.dateOfBirth && { dateOfBirth: formatDateDMY(card.dateOfBirth) }),
      ...(card.phone && { phone: card.phone }),
      ...(card.email && { email: card.email }),
      ...(card.schoolLogo && { schoolLogo: card.schoolLogo }),
      ...(card.signature && { signature: card.signature }),
    };
    const uploadedT =
      card.uploadedTemplate ||
      (card.templateId?.startsWith("uploaded-")
        ? getUploadedTemplateById(card.templateId)
        : null);
    const templateOverride = uploadedT
      ? { image: uploadedT.frontImage, elements: uploadedT.elements }
      : null;
    return (
      <div
        key={`${card._id}-${card.id}`}
        className="print-card-cell idcard-card"
        style={{ ...cellStyle, position: "relative" }}
      >
        <IdCardRenderer
          templateId={card.templateId}
          data={data}
          size="preview"
          template={templateOverride}
        />
        {extraOverlay}
      </div>
    );
  };

  const renderBackOnlyForPrint = (card, useGridSize = false, extraOverlay = null) => {
    const cellStyle = useGridSize ? undefined : cardCellStyle(card);
    const uploadedT =
      card.uploadedTemplate ||
      (card.templateId?.startsWith("uploaded-")
        ? getUploadedTemplateById(card.templateId)
        : null);
    const uploadedBack =
      uploadedT?.backImage ??
      (card.templateId?.startsWith("uploaded-")
        ? getUploadedTemplateById(card.templateId)?.backImage
        : undefined);
    const backEls = uploadedT?.backElements;
    const useCanvasBack = Array.isArray(backEls) && backEls.length > 0;
    const backData = {
      studentImage: card.studentImage,
      ...(card.colorCodeImage ? { colorCodeImage: fullPhotoUrl(card.colorCodeImage) } : {}),
      name: card.name,
      studentId: card.studentId,
      className: card.className,
      schoolName: card.schoolName,
      extraFields: card.extraFields || {},
      ...(card.address != null &&
        card.address !== "" && { address: card.address }),
      ...(card.dateOfBirth && { dateOfBirth: formatDateDMY(card.dateOfBirth) }),
      ...(card.phone && { phone: card.phone }),
      ...(card.email && { email: card.email }),
      ...(card.schoolLogo && { schoolLogo: card.schoolLogo }),
      ...(card.signature && { signature: card.signature }),
    };
    return (
      <div
        key={`back-${card._id}-${card.id}`}
        className="print-card-cell idcard-card"
        style={{ ...cellStyle, position: "relative" }}
      >
        {useCanvasBack && uploadedBack ? (
          <IdCardRenderer
            templateId={card.templateId}
            data={backData}
            size="preview"
            template={{ image: uploadedBack, elements: backEls }}
          />
        ) : (
          <IdCardBackPreview
            schoolName={card.schoolName}
            address={card.address}
            templateId={card.templateId}
            size="preview"
            backImage={uploadedBack}
          />
        )}
        {extraOverlay}
      </div>
    );
  };

  // Renders one card as front (full size) + optional back (single-student modal only)
  const renderCardWithBackForPreview = (card, useGridSize = false) => {
    const customBack = resolveCardBackImage(card);
    if (isUploadedStyleTemplate(card) && !customBack) {
      const stackStyle = useGridSize ? undefined : singleStackFrontOnlyStyle(card);
      return (
        <div
          key={`${card._id}-${card.id}`}
          className="preview-card-stack preview-card-stack-front-only"
          style={stackStyle}
        >
          <div className="preview-card-half preview-card-front">
            {renderCardForPrint(card, true)}
          </div>
        </div>
      );
    }
    const stackStyle = useGridSize ? undefined : singleStackPreviewStyle(card);
    return (
      <div
        key={`${card._id}-${card.id}`}
        className="preview-card-stack preview-card-with-back"
        style={stackStyle}
      >
        <div className="preview-card-half preview-card-front">
          {renderCardForPrint(card, true)}
        </div>
        <div className="preview-card-half preview-card-back">
          <div
            className="print-card-cell idcard-card"
            style={{ width: "100%", height: "100%" }}
          >
            {(() => {
              const uploadedT =
                card.uploadedTemplate ||
                (card.templateId?.startsWith("uploaded-")
                  ? getUploadedTemplateById(card.templateId)
                  : null);
              const uploadedBack =
                uploadedT?.backImage ??
                (card.templateId?.startsWith("uploaded-")
                  ? getUploadedTemplateById(card.templateId)?.backImage
                  : undefined);
              const backEls = uploadedT?.backElements;
              const useCanvasBack =
                Array.isArray(backEls) && backEls.length > 0 && uploadedBack;
              const backData = {
                studentImage: card.studentImage,
                ...(card.colorCodeImage ? { colorCodeImage: fullPhotoUrl(card.colorCodeImage) } : {}),
                name: card.name,
                studentId: card.studentId,
                className: card.className,
                schoolName: card.schoolName,
                extraFields: card.extraFields || {},
                ...(card.address != null &&
                  card.address !== "" && { address: card.address }),
                ...(card.dateOfBirth && {
                  dateOfBirth: formatDateDMY(card.dateOfBirth),
                }),
                ...(card.phone && { phone: card.phone }),
                ...(card.email && { email: card.email }),
                ...(card.schoolLogo && { schoolLogo: card.schoolLogo }),
                ...(card.signature && { signature: card.signature }),
              };
              return useCanvasBack ? (
                <IdCardRenderer
                  templateId={card.templateId}
                  data={backData}
                  size="preview"
                  template={{ image: uploadedBack, elements: backEls }}
                />
              ) : (
                <IdCardBackPreview
                  schoolName={card.schoolName}
                  address={card.address}
                  templateId={card.templateId}
                  size="preview"
                  backImage={uploadedBack}
                />
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  // —— View: Schools list (no schoolId)
  const renderSchoolsList = () => (
    <>
      <h3 style={{ marginBottom: 8 }}>Select school</h3>
      {isViewTemplateFlow && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            marginBottom: 12,
          }}
        >
          <button
            type="button"
            className={`btn ${viewMode === "offline" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setViewMode("offline")}
            style={{ padding: "6px 14px", fontSize: "13px" }}
          >
            Offline Projects
          </button>
          {showOnlineProjects && (
            <button
              type="button"
              className={`btn ${viewMode === "online" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setViewMode("online")}
              style={{ padding: "6px 14px", fontSize: "13px" }}
            >
              Online Projects
            </button>
          )}
        </div>
      )}
      <p
        className="text-muted"
        style={{ marginBottom: 20, fontSize: "0.9rem" }}
      >
        {isViewTemplateFlow
          ? "Click on a school to see its classes."
          : "Click on a school to see its classes with saved ID cards."}
      </p>
      {loadingSchools && <p className="text-muted">Loading schools…</p>}
      {errorSchools && <p className="text-danger">{errorSchools}</p>}
      {!loadingSchools && !errorSchools && schools.length === 0 && (
        <p className="text-muted">No schools assigned.</p>
      )}
      {!loadingSchools && !errorSchools && schools.length > 0 && (
        <ul className="saved-idcards-list">
          {schools.map((school) => (
            <li key={school._id}>
              <button
                type="button"
                className="saved-idcard-item saved-idcard-class-item"
                onClick={() => navigate(`${basePath}/school/${school._id}`)}
              >
                <span className="saved-idcard-name">
                  {school.schoolName || school.schoolCode || school._id}
                </span>
                <span className="text-muted saved-idcard-meta">
                  {school.schoolCode || ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // —— View: Classes list (schoolId, no classId)
  const renderClassesList = () => (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate(basePath)}
          style={{ padding: "6px 12px" }}
        >
          ← Back to schools
        </button>
        <h3 style={{ margin: 0 }}>
          {selectedSchool?.schoolName || selectedSchool?.schoolCode || schoolId}{" "}
          – Select class
        </h3>
      </div>
      <p
        className="text-muted"
        style={{ marginBottom: 20, fontSize: "0.9rem" }}
      >
        {isViewTemplateFlow
          ? "Click on a class to see its students."
          : "Click on a class to see students who have saved ID cards."}
      </p>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            navigate(`${basePath}/school/${schoolId}/all-students`)
          }
          style={{ padding: "10px 16px" }}
        >
          See all students
        </button>
        {isViewTemplateFlow && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                // Skip wizard "Students & photos" — go straight to template selection.
                navigate(`/view-template/wizard/template/${schoolId}/all`, {
                  state: { preferredOfflineMode: viewMode !== "online" },
                })
              }
              style={{ padding: "10px 16px" }}
            >
              Create Template
            </button>
            {viewTemplateEditProbe.done && viewTemplateEditProbe.show ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  navigate(`/view-template/wizard/template/${schoolId}/all`, {
                    state: {
                      openEditTemplate: true,
                      preferredOfflineMode: viewMode !== "online",
                    },
                  })
                }
                style={{ padding: "10px 16px" }}
              >
                Edit template
              </button>
            ) : null}
          </>
        )}
        {/* <span
          className="text-muted"
          style={{ fontSize: "0.9rem" }}
        >
          {isViewTemplateFlow
            ? "Entire school roster in one list, or create template for all."
            : "All students in this school; preview and print use saved ID cards only."}
        </span> */}
      </div>
      {loadingClasses && <p className="text-muted">Loading classes…</p>}
      {errorClasses && <p className="text-danger">{errorClasses}</p>}
      {!loadingClasses && !errorClasses && classes.length === 0 && (
        <p className="text-muted">No classes found.</p>
      )}
      {!loadingClasses && !errorClasses && classes.length > 0 && (
        <ul className="saved-idcards-list">
          {classes.map((cls) => (
            <li key={cls._id}>
              <button
                type="button"
                className="saved-idcard-item saved-idcard-class-item"
                onClick={() =>
                  navigate(`${basePath}/school/${schoolId}/class/${cls._id}`)
                }
              >
                <span className="saved-idcard-name">
                  {cls.className}
                  {cls.section ? ` ` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // —— View: Students list (schoolId + classId)
  const renderStudentsList = () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate(`${basePath}/school/${schoolId}`)}
          style={{ padding: "6px 12px" }}
        >
          ← Back to classes
        </button>
        <h3 style={{ margin: 0, flex: 1 }}>
          {selectedClass
            ? `${selectedClass.className}`
            : isAllSchoolStudents
              ? "All students"
              : classId}
          {isViewTemplateFlow ? " – Templates" : " – Saved ID cards"}
        </h3>
        <span
          style={{
            fontSize: "0.95rem",
            fontWeight: "500",
            backgroundColor: "rgba(255, 255, 255, 0.1)",
            padding: "4px 10px",
            borderRadius: "6px",
          }}
        >
          Total Students: {studentsForList.length}
        </span>
      </div>
      <p
        className="text-muted"
        style={{ marginBottom: 20, fontSize: "0.9rem" }}
      >
        {isAllSchoolStudents
          ? isViewTemplateFlow
            ? "Full school list. Rows with a template can open preview; Preview / Print includes only students with templates."
            : "Full school list. Rows with a saved ID card can open preview; Preview / Print includes only those students."
          : isViewTemplateFlow
            ? "Students with templates. Click to open preview."
            : "Students with saved ID cards. Click to open preview."}
      </p>
      {loadingStudents && <p className="text-muted">Loading students…</p>}
      {errorStudents && <p className="text-danger">{errorStudents}</p>}
      {!loadingStudents &&
        !errorStudents &&
        studentsForList.length === 0 && (
          <p className="text-muted">
            {isAllSchoolStudents
              ? "No students found for this school."
              : isViewTemplateFlow
                ? "No templates in this class."
                : "No saved ID cards in this class."}
          </p>
        )}
      {!loadingStudents &&
        !errorStudents &&
        studentsForList.length > 0 &&
        studentsForPreviewPrint.length === 0 &&
        isAllSchoolStudents && (
          <p className="text-muted" style={{ marginBottom: 16 }}>
            {isViewTemplateFlow
              ? "None of these students have template data yet."
              : "None of these students are ready for preview (saved card/template or photo is missing)."}
          </p>
        )}
      {!loadingStudents &&
        !errorStudents &&
        studentsForList.length > 0 &&
        studentsForPreviewPrint.length > 0 && (
          <div
            style={{
              marginBottom: 20,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowPreviewView(true)}
            >
              👁️ Preview ID Cards
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowPrintView(true)}
            >
              🖨️ Print Cards
            </button>
          </div>
        )}
      {!loadingStudents && !errorStudents && studentsForList.length > 0 && (
        <div
          ref={savedIdStudentListWrapRef}
          className="saved-idcards-list saved-idcards-list--virtual"
          style={{
            flex: 1,
            minHeight: 0,
            width: "100%",
            overflow: "hidden",
            height: "100%",
            position: "relative",
          }}
        >
          <List
            key={`${schoolId}-${classId}-${isAllSchoolStudents}`}
            listRef={savedIdStudentListRef}
            rowCount={studentsForList.length}
            rowHeight={SAVED_ID_STUDENT_ROW_HEIGHT}
            rowComponent={VirtualizedSavedIdStudentRow}
            rowProps={savedIdStudentListItemData}
            overscanCount={6}
            style={{
              height: savedIdStudentListViewportHeight,
              width: "100%",
              minWidth: 0,
              maxWidth: "100%",
            }}
          />
        </div>
      )}
    </div>
  );

  const showSchools = schoolId == null;
  const showClasses =
    schoolId != null && classId == null && !isAllSchoolStudents;
  const showStudents =
    (schoolId != null && classId != null) || isAllSchoolStudents;

  return (
    <>
      {showStudents ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            overflow: "hidden",
          }}
        >
          <Header title={title} showBack backTo={backTo} />
          <div
            className="card"
            style={{
              maxWidth: 960,
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {renderStudentsList()}
          </div>
        </div>
      ) : (
        <>
          <Header title={title} showBack backTo={backTo} />
          <div className="card" style={{ maxWidth: 960 }}>
            {showSchools && renderSchoolsList()}
            {showClasses && renderClassesList()}
          </div>
        </>
      )}

      {showPrintView && studentsForPreviewPrint.length > 0 && (
        <div className="print-overlay" aria-hidden="true">
          <div
            className="print-overlay-toolbar"
            style={{
              position: "fixed",
              top: 16,
              left: 16,
              zIndex: 10001,
              maxWidth: "min(720px, calc(100vw - 120px))",
            }}
          >

            {renderPageSizeControls("print")}
          </div>
          <div ref={printContentRef} className="print-pages-wrap">
            {previewPrintCardsStillLoading && spreadPagesCount === 0 ? (
              <p
                className="text-muted print-hide-in-print"
                style={{ padding: 24, color: "rgba(255,255,255,0.85)" }}
              >
                Preparing cards…
              </p>
            ) : (
              previewSpreadPages.map((desc) => {
                const { batchIndex, side } = desc;
                const isBackPage = side === "back";
                const start = batchIndex * cardsPerPage;
                const pageCards = cardsToPrint.slice(start, start + cardsPerPage);
                return (
                  <div
                    key={`print-${batchIndex}-${side}`}
                    className="print-page print-page-spread"
                    style={{
                      width: `${pageWidthMm}mm`,
                      height: `${pageHeightMm}mm`,
                      ["--card-w-mm"]: cardWidthMm,
                      ["--card-h-mm"]: cardHeightMm,
                      ["--cols"]: cols,
                      ["--rows"]: rows,
                    }}
                  >
                    <div
                      className="print-cards-grid"
                      style={{
                        gridTemplateColumns: `repeat(${cols}, ${cardWidthMm}mm)`,
                        gridTemplateRows: `repeat(${rows}, ${cardHeightMm}mm)`,
                        ...(isBackPage ? { direction: "rtl" } : {}),
                      }}
                    >
                      {pageCards.map((card, index) => {
                        const overlay = getCardCropMarks(index, pageCards.length, cols, isBackPage);
                        return isBackPage
                          ? renderBackOnlyForPrint(card, true, overlay)
                          : renderCardForPrint(card, true, overlay);
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="print-btn-group">
            <button
              type="button"
              className="btn btn-secondary print-hide-in-print"
              onClick={() => setShowPrintView(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary print-hide-in-print"
              disabled={
                previewPrintCardsStillLoading || spreadPagesCount === 0
              }
              onClick={() => window.print()}
            >
              Print Now
            </button>
          </div>
        </div>
      )}

      {showPreviewView && studentsForPreviewPrint.length > 0 && (
        <div className="preview-overlay" aria-hidden="true">
          <div
            className="preview-overlay-header"
            style={{ alignItems: "flex-start", gap: 16 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>
                ID Cards Preview – {pageSizeSummary}{" "}
                {spreadPagesCount > 0
                  ? `(${spreadPagesCount} page${spreadPagesCount !== 1 ? "s" : ""})${previewWaitingForBulkPhotos ? " — loading photos…" : ""}${previewPrintCardsStillLoading && !previewWaitingForBulkPhotos ? " — loading more cards…" : ""}${previewPagesStillRendering ? ` — rendering pages ${effectiveVisiblePreviewSpreadPagesCount}/${spreadPagesCount}…` : ""}`
                  : previewPrintCardsStillLoading
                    ? previewWaitingForBulkPhotos
                      ? "(loading photos…)"
                      : "(preparing cards…)"
                    : "(no pages)"}
              </h3>
              <div style={{ marginTop: 12 }}>
                {renderPageSizeControls("preview")}
                {renderPreviewGapControls("preview-gap")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                flexShrink: 0,
              }}
            >
              <div
                className="download-dropdown-wrap"
                style={{ position: "relative" }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={
                    exporting ||
                    chargingDownloadPoints ||
                    previewPrintCardsStillLoading
                  }
                  onClick={() => setShowDownloadMenuPreview((v) => !v)}
                >
                  {chargingDownloadPoints
                    ? "Checking balance…"
                    : exporting
                      ? "Downloading…"
                      : "⬇ Download"}{" "}
                  ▾
                </button>
                {showDownloadMenuPreview && (
                  <div
                    role="menu"
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 6,
                      zIndex: 20,
                      minWidth: 160,
                      background: "#2a2a2a",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 8,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                      overflow: "hidden",
                    }}
                  >
                    {["jpg", "pdf", "png"].map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        role="menuitem"
                        disabled={
                          exporting ||
                          chargingDownloadPoints ||
                          previewPrintCardsStillLoading
                        }
                        onClick={() => triggerExport(fmt)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 14px",
                          border: "none",
                          background: "transparent",
                          color: "#fff",
                          cursor:
                            exporting || chargingDownloadPoints
                              ? "not-allowed"
                              : "pointer",
                          fontSize: "0.95rem",
                          textTransform: "uppercase",
                        }}
                        onMouseEnter={(e) => {
                          if (!exporting && !chargingDownloadPoints)
                            e.currentTarget.style.background =
                              "rgba(255,255,255,0.08)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowPreviewView(false)}
                style={{ flexShrink: 0 }}
              >
                Close
              </button>
            </div>
          </div>
          <div className="preview-cards-scroll" ref={previewScrollRef}>
            <div
              className="preview-pages-wrap"
              ref={previewPagesWrapRef}
              style={{ paddingInline: 24, boxSizing: "content-box", margin: 0 }}
            >
              {previewPrintCardsStillLoading && spreadPagesCount === 0 ? (
                <p
                  style={{
                    padding: "48px 24px",
                    color: "rgba(255,255,255,0.88)",
                    fontSize: "1rem",
                    margin: 0,
                  }}
                >
                  Preparing cards…
                </p>
              ) : (
                visiblePreviewSpreadPages.map((desc) => {
                  const { batchIndex, side } = desc;
                  const isBackPage = side === "back";
                  const start = batchIndex * cardsPerPage;
                  const pageCards = cardsToPrint.slice(
                    start,
                    start + cardsPerPage,
                  );
                  return (
                    <div
                      key={`preview-${batchIndex}-${side}`}
                      data-batch-index={String(batchIndex)}
                      data-spread-side={side}
                      className={`print-page preview-page print-page-spread preview-page--center ${isBackPage ? "preview-page--back" : "preview-page--front"}`}
                      style={{
                        width: `${pageWidthMm}mm`,
                        height: `${pageHeightMm}mm`,
                        backgroundColor: normalizeHexColor(
                          previewPageBackgroundColor,
                        ),
                        ["--card-w-mm"]: cardWidthMm,
                        ["--card-h-mm"]: cardHeightMm,
                        ["--cols"]: cols,
                        ["--rows"]: rows,
                      }}
                    >

                      <div
                        className="print-cards-grid print-cards-grid--preview"
                        style={{
                          gridTemplateColumns: `repeat(${cols}, ${cardWidthMm}mm)`,
                          gridTemplateRows: `repeat(${rows}, ${cardHeightMm}mm)`,
                          columnGap: `${layoutPreviewGapHorizontalMm}mm`,
                          rowGap: `${layoutPreviewGapVerticalMm}mm`,
                          ...(isBackPage ? { direction: "rtl" } : {}),
                        }}
                      >
                        {pageCards.map((card, index) => {
                          const overlay = getCardCropMarks(index, pageCards.length, cols, isBackPage);
                          return isBackPage
                            ? renderBackOnlyForPrint(card, true, overlay)
                            : renderCardForPrint(card, true, overlay);
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          {seeAllJpegDialogOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="see-all-jpeg-dialog-title"
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 10055,
                background: "rgba(0,0,0,0.65)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
              onClick={() => setSeeAllJpegDialogOpen(false)}
            >
              <div
                style={{
                  background: "#2a2a2a",
                  borderRadius: 12,
                  padding: "22px 24px",
                  maxWidth: 440,
                  width: "100%",
                  border: "1px solid rgba(255,255,255,0.15)",
                  boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3
                  id="see-all-jpeg-dialog-title"
                  style={{ margin: "0 0 8px", color: "#fff", fontSize: "1.1rem" }}
                >
                  JPEG export
                </h3>
                <p
                  style={{
                    margin: "0 0 18px",
                    color: "rgba(255,255,255,0.82)",
                    fontSize: 14,
                    lineHeight: 1.45,
                  }}
                >
                  Choose how to save JPEGs: full preview pages, or per-card
                  front/back files.
                </p>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {/*
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={exporting || chargingDownloadPoints}
                    onClick={() => {
                      setSeeAllJpegDialogOpen(false);
                      void prepareAndStartJpegExport("both");
                    }}
                  >
                    Both (per card + page-wise)
                  </button>
                  */}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={exporting || chargingDownloadPoints}
                    onClick={() => {
                      setSeeAllJpegDialogOpen(false);
                      void prepareAndStartJpegExport("pages");
                    }}
                  >
                    Page-wise (full pages)
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={exporting || chargingDownloadPoints}
                    onClick={() => {
                      setSeeAllJpegDialogOpen(false);
                      void prepareAndStartJpegExport("single");
                    }}
                  >
                    Single images (per card)
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={exporting || chargingDownloadPoints}
                    onClick={() => setSeeAllJpegDialogOpen(false)}
                    style={{
                      background: "rgba(255,255,255,0.12)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      color: "rgba(255,255,255,0.9)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          {exportProgress && (
            <div
              className="export-progress-overlay"
              style={{
                position: "absolute",
                inset: 0,
                /* Above JPEG mode picker (10055) so Cancel is always clickable */
                zIndex: 10060,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "auto",
              }}
              aria-live="polite"
              aria-busy="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  background: "#2a2a2a",
                  padding: "20px 24px",
                  borderRadius: 12,
                  minWidth: 300,
                  maxWidth: "min(420px, 92vw)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    color: "#fff",
                    marginBottom: 12,
                    fontSize: 15,
                    fontWeight: 600,
                  }}
                >
                  {exportProgress.label}
                </div>
                <div
                  style={{
                    height: 10,
                    background: "rgba(255,255,255,0.12)",
                    borderRadius: 5,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(
                        100,
                        (exportProgress.current /
                          Math.max(exportProgress.total, 1)) *
                        100,
                      )}%`,
                      background: "#3b82f6",
                      transition: "width 0.2s ease-out",
                      borderRadius: 5,
                    }}
                  />
                </div>
                <div
                  style={{
                    color: "rgba(255,255,255,0.75)",
                    marginTop: 10,
                    fontSize: 13,
                  }}
                >
                  {exportProgress.total > 0
                    ? `${exportProgress.current} / ${exportProgress.total}`
                    : ""}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    marginTop: 16,
                    width: "100%",
                    padding: "10px 14px",
                    fontSize: 14,
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    exportCancelRequestedRef.current = true;
                    setExporting(false);
                    setExportProgress(null);
                  }}
                >
                  Cancel download
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {editStudentData && (
        <div
          className="single-card-preview-overlay"
          aria-hidden="true"
          onClick={() => setEditStudentData(null)}
        >
          <div
            className="single-card-preview-content"
            style={{
              width: 520,
              maxWidth: "92vw",
              maxHeight: "90vh",
              padding: 24,
              background: "#1a1a1a",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="single-card-preview-header"
              style={{
                padding: "0 0 16px",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                flexShrink: 0,
              }}
            >
              <h3 style={{ margin: 0 }}>Edit student</h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditStudentData(null)}
              >
                Close
              </button>
            </div>
            <form
              onSubmit={handleSaveEdit}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                marginTop: 16,
                overflowY: "auto",
                minHeight: 0,
                flex: 1,
                paddingRight: 4,
              }}
            >
              {(() => {
                const inp = {
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #333",
                  borderRadius: 6,
                  background: "#2a2a2a",
                  color: "white",
                  boxSizing: "border-box",
                };
                const lab = {
                  display: "block",
                  marginBottom: 6,
                  fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.8)",
                };
                const classLabel =
                  formatStudentClassForIdCard(editStudentData.class) ||
                  formatStudentClassForIdCard(editStudentData.classId) ||
                  [
                    editStudentData.className,
                    editStudentData.section,
                  ]
                    .filter(Boolean)
                    .join(" · ") ||
                  "—";
                return (
                  <>
                    <div>
                      <label style={lab}>Class</label>
                      <div
                        style={{
                          ...inp,
                          opacity: 0.85,
                          cursor: "default",
                        }}
                      >
                        {classLabel}
                      </div>
                    </div>
                    <div>
                      <label style={lab}>Student name</label>
                      <input
                        type="text"
                        className="form-control"
                        value={editStudentData.studentName || ""}
                        onChange={(e) =>
                          setEditStudentData({
                            ...editStudentData,
                            studentName: e.target.value,
                          })
                        }
                        style={inp}
                      />
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                      }}
                    >
                      <div>
                        <label style={lab}>Admission no.</label>
                        <input
                          type="text"
                          className="form-control"
                          value={editStudentData.admissionNo || ""}
                          onChange={(e) =>
                            setEditStudentData({
                              ...editStudentData,
                              admissionNo: e.target.value,
                            })
                          }
                          style={inp}
                        />
                      </div>
                      <div>
                        <label style={lab}>Roll no.</label>
                        <input
                          type="text"
                          className="form-control"
                          value={editStudentData.rollNo || ""}
                          onChange={(e) =>
                            setEditStudentData({
                              ...editStudentData,
                              rollNo: e.target.value,
                            })
                          }
                          style={inp}
                        />
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                      }}
                    >
                      <div>
                        <label style={lab}>{"Father's name"}</label>
                        <input
                          type="text"
                          className="form-control"
                          value={editStudentData.fatherName || ""}
                          onChange={(e) =>
                            setEditStudentData({
                              ...editStudentData,
                              fatherName: e.target.value,
                            })
                          }
                          style={inp}
                        />
                      </div>
                      <div>
                        <label style={lab}>{"Mother's name"}</label>
                        <input
                          type="text"
                          className="form-control"
                          value={editStudentData.motherName || ""}
                          onChange={(e) =>
                            setEditStudentData({
                              ...editStudentData,
                              motherName: e.target.value,
                            })
                          }
                          style={inp}
                        />
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                      }}
                    >
                      <div>
                        <label style={lab}>Gender</label>
                        <input
                          type="text"
                          className="form-control"
                          value={editStudentData.gender || ""}
                          onChange={(e) =>
                            setEditStudentData({
                              ...editStudentData,
                              gender: e.target.value,
                            })
                          }
                          style={inp}
                        />
                      </div>
                      <div>
                        <label style={lab}>Blood group</label>
                        <input
                          type="text"
                          className="form-control"
                          value={editStudentData.bloodGroup || ""}
                          onChange={(e) =>
                            setEditStudentData({
                              ...editStudentData,
                              bloodGroup: e.target.value,
                            })
                          }
                          style={inp}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={lab}>Email</label>
                      <input
                        type="email"
                        className="form-control"
                        value={editStudentData.email || ""}
                        onChange={(e) =>
                          setEditStudentData({
                            ...editStudentData,
                            email: e.target.value,
                          })
                        }
                        style={inp}
                      />
                    </div>
                    <div>
                      <label style={lab}>Mobile / phone</label>
                      <input
                        type="text"
                        className="form-control"
                        value={
                          editStudentData.phone ||
                          editStudentData.mobile ||
                          ""
                        }
                        onChange={(e) =>
                          setEditStudentData({
                            ...editStudentData,
                            phone: e.target.value,
                            mobile: e.target.value,
                          })
                        }
                        style={inp}
                      />
                    </div>
                    <div>
                      <label style={lab}>Address</label>
                      <textarea
                        className="form-control"
                        rows={3}
                        value={editStudentData.address || ""}
                        onChange={(e) =>
                          setEditStudentData({
                            ...editStudentData,
                            address: e.target.value,
                          })
                        }
                        style={{ ...inp, resize: "vertical", minHeight: 72 }}
                      />
                    </div>
                    <div>
                      <label style={lab}>Date of birth</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="DD.MM.YYYY"
                        value={
                          editStudentData.dateOfBirth ||
                          editStudentData.dob ||
                          ""
                        }
                        onChange={(e) =>
                          setEditStudentData({
                            ...editStudentData,
                            dateOfBirth: e.target.value,
                            dob: e.target.value,
                          })
                        }
                        style={inp}
                      />
                    </div>
                    <div>
                      <label style={lab}>Photo no.</label>
                      <input
                        type="text"
                        className="form-control"
                        value={editStudentData.photoNo || ""}
                        onChange={(e) =>
                          setEditStudentData({
                            ...editStudentData,
                            photoNo: e.target.value,
                          })
                        }
                        style={inp}
                      />
                    </div>
                  </>
                );
              })()}
              <div style={{ marginTop: 8, flexShrink: 0 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingEdit}
                  style={{ width: "100%", padding: "12px" }}
                >
                  {savingEdit ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {singleCardPreview && (
        <div
          className="single-card-preview-overlay"
          aria-hidden="true"
          onClick={() => setSingleCardPreview(null)}
        >
          <div
            className="single-card-preview-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="single-card-preview-header">
              <h3 style={{ margin: 0 }}>
                {singleCardPreview.name} – ID Card Preview
              </h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSingleCardPreview(null)}
              >
                Close
              </button>
            </div>
            <div className="single-card-preview-card-wrap">
              {renderCardWithBackForPreview(singleCardPreview)}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .print-overlay {
          position: fixed;
          inset: 0;
          background: #1a1a1a;
          z-index: 9999;
          overflow: auto;
          padding: 72px 20px 20px;
        }
        .print-btn-group {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 10000;
          display: flex;
          gap: 8px;
        }
        .preview-overlay {
          position: fixed;
          inset: 0;
          background: #1a1a1a;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .preview-overlay-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          flex-shrink: 0;
        }
        /* Electron capturePage: hide UI that would paint on top of cards (progress modal, toolbar). */
        body.export-native-capture-hide-chrome .export-progress-overlay {
          display: none !important;
        }
        body.export-native-capture-hide-chrome .preview-overlay-header {
          display: none !important;
        }
        body.export-native-capture-hide-chrome [role="dialog"][aria-labelledby="see-all-jpeg-dialog-title"] {
          display: none !important;
        }
        .preview-cards-scroll {
          flex: 1;
          overflow: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 24px;
          direction: ltr;
        }
        .preview-pages-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          width: max-content;
          min-width: 100%;
          margin: 0 auto;
          direction: ltr;
        }
        .print-page.preview-page {
          flex-shrink: 0;
          box-shadow: 0 4px 24px rgba(0,0,0,0.4);
          border-radius: 2px;
          overflow: hidden;
          box-sizing: border-box;
        }
        .print-pages-wrap {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0;
          width: max-content;
          min-width: 100%;
          margin: 0;
        }
        .single-card-preview-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.75);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          box-sizing: border-box;
        }
        .single-card-preview-content {
          background: #1a1a1a;
          border-radius: 12px;
          max-width: 100%;
          max-height: calc(100vh - 40px);
          overflow: auto;
          display: flex;
          flex-direction: column;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .single-card-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          flex-shrink: 0;
        }
        .single-card-preview-card-wrap {
          padding: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1;
          min-height: 280px;
        }
        .preview-card-stack {
          break-inside: avoid;
          page-break-inside: avoid;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          width: calc(var(--card-w-mm, 90) * 1mm);
          min-width: calc(var(--card-w-mm, 90) * 1mm);
          max-width: calc(var(--card-w-mm, 90) * 1mm);
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }
        .preview-card-with-back {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          min-height: 0;
          gap: ${PRINT_GAP_MM}mm;
        }
        .preview-cards-grid-with-back .preview-card-half {
          flex: 0 0 calc(var(--card-h-mm, 57) * 1mm);
          height: calc(var(--card-h-mm, 57) * 1mm);
          min-height: 0;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 10px;
        }
        .preview-card-half {
          flex: 1;
          min-height: 0;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 10px;
        }
        .preview-card-half .print-card-cell {
          width: 100% !important;
          height: 100% !important;
          min-width: 0;
          min-height: 0;
          max-width: 100%;
          max-height: 100%;
          border-radius: 10px;
          overflow: hidden;
        }
        .preview-card-half .print-card-cell .idcard,
        .preview-card-half .idcard {
          width: 100% !important;
          height: 100% !important;
          max-width: 100% !important;
          max-height: 100% !important;
          border-radius: 10px;
        }
        .preview-cards-grid-with-back .preview-card-stack.preview-card-with-back {
          height: 100%;
          min-height: 0;
          max-height: none;
        }
        .single-card-preview-card-wrap .preview-card-with-back {
          /* width / aspect-ratio / max-height come from inline singleStackPreviewStyle (school dimensions) */
          margin-left: auto;
          margin-right: auto;
        }
        .single-card-preview-card-wrap .preview-card-stack {
          min-width: 0;
          max-width: 100%;
          height: auto;
        }
        .single-card-preview-card-wrap .preview-card-half {
          min-height: 0;
        }
        .single-card-preview-card-wrap .print-card-cell {
          box-shadow: 0 4px 24px rgba(0,0,0,0.35);
          border-radius: 10px;
          overflow: visible;
        }
        .single-card-preview-card-wrap .print-card-cell.idcard-card {
          padding: 0;
          display: block;
        }
        .single-card-preview-card-wrap .print-card-cell.idcard-card .idcard {
          width: 100%;
          height: 100%;
          max-width: 100%;
          transform: none;
          box-sizing: border-box;
        }
        .single-card-preview-card-wrap .print-card-cell.idcard-card[style*="width"] .idcard {
          width: 100%;
          height: 100%;
        }
        .single-card-preview-card-wrap .print-card-cell.fabric-card {
          padding: 0;
        }
        .single-card-preview-card-wrap .print-card-cell.fabric-card .fabric-idcard-generator {
          transform: scale(0.65);
          transform-origin: top center;
        }
        .print-page {
          box-sizing: border-box;
          padding: ${PRINT_PAGE_MARGIN_MM}mm;
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
        }
        .preview-page--center {
          align-items: center !important;
          justify-content: center !important;
        }
        .preview-page--center .print-cards-grid.print-cards-grid--preview {
          width: max-content !important;
          height: max-content !important;
          margin: 0 auto;
        }
        .preview-page--front,
        .preview-page--front .print-cards-grid.print-cards-grid--preview {
          direction: ltr !important;
        }
        .print-cards-grid {
          display: grid;
          grid-template-columns: repeat(var(--cols, 2), calc(var(--card-w-mm, 90) * 1mm));
          grid-template-rows: repeat(var(--rows, 4), calc(var(--card-h-mm, 57) * 1mm));
          gap: ${PRINT_GAP_MM}mm;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }
        .print-cards-grid.print-cards-grid--preview {
          gap: unset;
          justify-content: center;
        }
        .print-card-cell {
          break-inside: avoid;
          page-break-inside: avoid;
          direction: ltr;
          display: flex;
          align-items: center;
          justify-content: center;
          width: calc(var(--card-w-mm, 90) * 1mm);
          height: calc(var(--card-h-mm, 57) * 1mm);
          min-width: calc(var(--card-w-mm, 90) * 1mm);
          min-height: calc(var(--card-h-mm, 57) * 1mm);
          max-width: calc(var(--card-w-mm, 90) * 1mm);
          max-height: calc(var(--card-h-mm, 57) * 1mm);
          overflow: visible;
          box-sizing: border-box;
        }
        .print-card-cell.fabric-card {
          padding: 0;
        }
        .print-card-cell.fabric-card .fabric-idcard-generator {
          transform-origin: top left;
        }
        .print-card-cell.idcard-card {
          padding: 0;
        }
        .print-card-cell.idcard-card .idcard {
          max-width: 100%;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }
        @media print {
          @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; }
          body * { visibility: hidden; }
          .print-overlay,
          .print-overlay * { visibility: visible; }
          body.id-preview-pdf-export .preview-overlay,
          body.id-preview-pdf-export .preview-overlay * {
            visibility: visible !important;
          }
          .print-overlay {
            position: absolute;
            inset: 0;
            left: 0;
            top: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100%;
            background: #fff;
            padding: 0;
            margin: 0;
            overflow: hidden;
          }
          .print-pages-wrap {
            padding: 0;
            margin: 0;
          }
          .print-hide-in-print { display: none !important; }
          .print-btn-group { display: none !important; }
          .print-overlay-toolbar { display: none !important; }
          .print-page {
            width: ${pageWidthMm}mm !important;
            height: ${pageHeightMm}mm !important;
            min-width: ${pageWidthMm}mm;
            min-height: ${pageHeightMm}mm;
            max-width: ${pageWidthMm}mm;
            max-height: ${pageHeightMm}mm;
            page-break-after: always;
            margin: 0;
            padding: ${PRINT_PAGE_MARGIN_MM}mm !important;
            box-sizing: border-box;
            overflow: hidden;
          }
          .print-page:last-child { page-break-after: auto; }
          .print-cards-grid {
            width: 100%;
            height: 100%;
            display: grid;
            grid-template-columns: repeat(var(--cols, 2), calc(var(--card-w-mm, 90) * 1mm));
            grid-template-rows: repeat(var(--rows, 4), calc(var(--card-h-mm, 57) * 1mm));
            gap: ${PRINT_GAP_MM}mm;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          .print-card-cell {
            width: calc(var(--card-w-mm, 90) * 1mm) !important;
            height: calc(var(--card-h-mm, 57) * 1mm) !important;
            min-width: calc(var(--card-w-mm, 90) * 1mm);
            min-height: calc(var(--card-h-mm, 57) * 1mm);
            max-width: calc(var(--card-w-mm, 90) * 1mm);
            max-height: calc(var(--card-h-mm, 57) * 1mm);
            box-sizing: border-box;
            overflow: visible;
          }
          .print-card-cell.fabric-card .fabric-idcard-generator {
            transform: scale(0.178);
            transform-origin: top left;
          }
          .print-card-cell.fabric-card .fabric-idcard-canvas-wrap {
            width: 506px;
            height: 319px;
          }
          .print-card-cell.idcard-card .idcard {
            width: 100%;
            height: 100%;
            max-width: none;
            object-fit: contain;
          }
          .print-card-cell.idcard-card {
            display: block;
          }
          /* Chromium printToPDF: multi-page preview (no html2canvas). */
          body.id-preview-pdf-export .preview-overlay-header,
          body.id-preview-pdf-export .export-progress-overlay {
            display: none !important;
          }
          body.id-preview-pdf-export .preview-overlay {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            min-height: 100% !important;
            background: #fff !important;
            overflow: visible !important;
            display: flex !important;
            flex-direction: column !important;
          }
          body.id-preview-pdf-export .preview-cards-scroll {
            overflow: visible !important;
            padding: 0 !important;
            flex: 1 1 auto !important;
            height: auto !important;
          }
          body.id-preview-pdf-export .preview-pages-wrap {
            gap: 0 !important;
            padding-inline: 0 !important;
          }
          body.id-preview-pdf-export .print-page.preview-page {
            page-break-after: always;
            break-after: page;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          body.id-preview-pdf-export .print-page.preview-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
        }
      `}</style>
    </>
  );
}
