import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import {
  deductTemplateDownloadPoints,
  getAssignedSchools,
  getClassesBySchool,
  getTemplatesStatus,
} from "../api/dashboard";
import { API_BASE_URL } from "../api/config";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// A4 size (mm). Preview and print show as many cards per page as fit on one A4.
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PRINT_PAGE_MARGIN_MM = 4;
const PRINT_GAP_MM = 4;
const DEFAULT_CARD_WIDTH_MM = 90;
const DEFAULT_CARD_HEIGHT_MM = 57;

function fullPhotoUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("http")) return url;
  const base = API_BASE_URL.replace(/\/$/, "");
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

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

const MIN_PREVIEW_GAP_MM = 0;
const MAX_PREVIEW_GAP_MM = 40;

function clampPreviewGapMm(value, fallback = PRINT_GAP_MM) {
  const n =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value ?? "").replace(",", ".").trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PREVIEW_GAP_MM, Math.max(MIN_PREVIEW_GAP_MM, n));
}

const DEFAULT_PREVIEW_PAGE_BG = "#ffffff";

/** Preview download: high-res capture + max JPEG quality (per-card, page ZIP, PDF raster). */
const PREVIEW_EXPORT_HTML2CANVAS_SCALE = 6;
const PREVIEW_EXPORT_JPEG_QUALITY = 1;

/** Scales try highest first; primary follows devicePixelRatio so Retina exports stay sharp. */
function getHtml2CanvasExportScaleAttempts() {
  const dpr =
    typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
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
      Some template art + absolute-positioned elements can end up a couple pixels
      lower in the captured clone (percent-based positioning vs export layout).
      Nudge overlay elements slightly up only for export so JPEG matches preview.
    */
    .print-card-cell .idcard-image-template-canvas .idcard-canvas-el {
      transform: translateY(-0.25px) !important;
    }
    .print-card-cell .idcard-image-template-overlay {
      transform: translateY(-0.25px) !important;
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
) {
  if (!parentDirHandle?.getDirectoryHandle) {
    throw new Error("No folder was selected for saving.");
  }
  onProgress?.({
    label: "Saving JPEG files…",
    current: 0,
    total: files.length,
  });
  const sub = await parentDirHandle.getDirectoryHandle(subfolderName, {
    create: true,
  });
  for (let i = 0; i < files.length; i++) {
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
    const blob = await (await fetch(f.dataUrl)).blob();
    await w.write(blob);
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
      applyExportRenderHintsToClone(clonedDoc);
    },
  };
}

/**
 * High-DPI capture with scale fallback. Do not set `foreignObjectRendering: true` here:
 * in Electron/Chromium it often "succeeds" but rasterizes to a blank (solid black/white) image.
 */
async function html2canvasForExport(element, pageBackgroundColor) {
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
    const scales = getHtml2CanvasExportScaleAttempts();
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
  const scales = getHtml2CanvasExportScaleAttempts();
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

async function html2canvasWithFallback(element, pageBackgroundColor) {
  const canvas = await html2canvasForExport(element, pageBackgroundColor);
  return canvas.toDataURL("image/jpeg", PREVIEW_EXPORT_JPEG_QUALITY);
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
) {
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

  async function captureCell(el, label, index1) {
    let dataUrl;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        dataUrl = await html2canvasWithFallback(el, pageBackgroundColor);
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        await delay(300 * (attempt + 1));
      }
    }
    if (!dataUrl) {
      throw lastErr || new Error(`Failed to capture ${label} card ${index1}`);
    }
    return dataUrl;
  }
  let step = 0;
  for (let i = 0; i < cards.length; i++) {
    step += 1;
    onProgress?.({
      label: "Capturing JPEGs (front)…",
      current: step,
      total: totalSteps,
    });
    const dataUrl = await captureCell(frontEls[i], "front", i + 1);
    files.push({ filename: `${bases[i]}_front.jpg`, dataUrl });
    await delay(80);
  }
  for (let i = 0; i < cards.length; i++) {
    if (!cardExportsBackJpeg(cards[i])) continue;
    const domIdx = backDomIndexForCard(cards, cardsPerPage, i);
    if (domIdx < 0 || !backEls[domIdx]) {
      throw new Error(
        `Back preview missing for card ${i + 1}. Wait and try again.`,
      );
    }
    step += 1;
    onProgress?.({
      label: "Capturing JPEGs (back)…",
      current: step,
      total: totalSteps,
    });
    const dataUrl = await captureCell(backEls[domIdx], "back", i + 1);
    files.push({ filename: `${bases[i]}_back.jpg`, dataUrl });
    await delay(80);
  }
  return files;
}

/**
 * Builds one JPEG per preview page (same page size as the preview),
 * e.g. page-001.jpg, page-002.jpg... This avoids the "thin width" issue
 * of stitching all pages into a single long image.
 */
async function buildPreviewPagesJpegFiles(pageNodes, pageBackgroundColor, onProgress) {
  const nodes = Array.from(pageNodes || []);
  if (nodes.length === 0) return [];
  const files = [];
  for (let i = 0; i < nodes.length; i++) {
    onProgress?.({
      label: "Capturing JPEG pages…",
      current: i + 1,
      total: nodes.length,
    });
    const dataUrl = await html2canvasWithFallback(nodes[i], pageBackgroundColor);
    const idx = String(i + 1).padStart(3, "0");
    files.push({ filename: `page-${idx}.jpg`, dataUrl });
    await delay(120);
  }
  return files;
}

/**
 * Browser fallback: one .zip download containing a subfolder of all JPEGs.
 * (Multiple `<a download>` clicks are blocked after the first file in most browsers.)
 */
async function downloadJpegsAsZipFolder(safeSub, files, onProgress) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const root = zip.folder(safeSub);
  if (!root) throw new Error("Could not build ZIP.");
  for (let i = 0; i < files.length; i++) {
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
    const s = String(f.dataUrl || "");
    const comma = s.indexOf(",");
    const base64 = comma >= 0 ? s.slice(comma + 1) : s;
    root.file(safeName, base64, { base64: true });
  }
  onProgress?.({
    label: "Saving ZIP file…",
    current: files.length,
    total: files.length,
  });
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
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
) {
  const safeSub =
    String(subfolderName)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 120) || "id-cards-jpeg";
  if (typeof window !== "undefined" && window.electron?.selectOutputFolder) {
    const el = window.electron;
    onProgress?.({ label: "Choose folder to save JPEGs…", current: 0, total: 1 });
    const pick = await el.selectOutputFolder();
    if (!pick.success) return { cancelled: true };

    const runBatchSave = async () => {
      if (!el.saveJpegExportFolder) {
        throw new Error(
          "JPEG save is not available. Fully quit the app and start it again so Electron loads the latest code.",
        );
      }
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
          onProgress?.({
            label: "Writing JPEG files…",
            current: i + 1,
            total: files.length,
          });
          const wr = await el.writeJpegFile({
            directoryPath: dir,
            filename: files[i].filename,
            dataUrl: files[i].dataUrl,
          });
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
      );
      return {};
    } catch (e) {
      if (e?.name === "AbortError") return { cancelled: true };
      throw e;
    }
  }

  await downloadJpegsAsZipFolder(safeSub, files, onProgress);
  window.alert(
    `Downloaded "${safeSub}.zip". Extract it to get a folder with all ${files.length} JPEG file(s).`,
  );
  return { fallbackDownloads: true };
}

/** Captures preview page DOM nodes to JPG/PNG (one file per page) or a single multi-page PDF. */
async function exportPreviewPagesAsFiles(
  pageElements,
  format,
  pageWidthMm,
  pageHeightMm,
  fileBaseName,
  pageBackgroundColor = DEFAULT_PREVIEW_PAGE_BG,
) {
  if (!pageElements?.length) return;

  if (format === "pdf") {
    const pdf = new jsPDF({
      unit: "mm",
      format: [pageWidthMm, pageHeightMm],
      orientation: pageHeightMm >= pageWidthMm ? "portrait" : "landscape",
    });
    for (let i = 0; i < pageElements.length; i++) {
      const canvas = await html2canvasForExport(
        pageElements[i],
        pageBackgroundColor,
      );
      const imgData = canvas.toDataURL(
        "image/jpeg",
        PREVIEW_EXPORT_JPEG_QUALITY,
      );
      if (i > 0) pdf.addPage([pageWidthMm, pageHeightMm], "p");
      pdf.addImage(imgData, "JPEG", 0, 0, pageWidthMm, pageHeightMm);
    }
    pdf.save(`${fileBaseName}.pdf`);
    return;
  }

  const ext = format === "png" ? "png" : "jpg";
  for (let i = 0; i < pageElements.length; i++) {
    const canvas = await html2canvasForExport(
      pageElements[i],
      pageBackgroundColor,
    );
    const url =
      format === "png"
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", PREVIEW_EXPORT_JPEG_QUALITY);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBaseName}-page-${i + 1}.${ext}`;
    a.click();
    await delay(300);
  }
}

export default function SavedIdCardsList({
  title = "Saved ID Cards",
  basePath = "/saved-id-cards",
  previewBasePath = "/saved-id-cards/preview",
  backTo = "/dashboard",
} = {}) {
  const navigate = useNavigate();
  const { schoolId, classId } = useParams();
  useApp(); // auth/context available if needed
  const isViewTemplateFlow = basePath === "/view-template";
  const [showPrintView, setShowPrintView] = useState(false);
  const [showPreviewView, setShowPreviewView] = useState(false);
  const [singleCardPreview, setSingleCardPreview] = useState(null); // card object when viewing one student's card
  const printContentRef = useRef(null);
  const previewPagesWrapRef = useRef(null);
  /** Browser JPEG export: DirectoryHandle from showDirectoryPicker (must be set during click). */
  const jpegWebParentDirHandleRef = useRef(null);

  const [showDownloadMenuList, setShowDownloadMenuList] = useState(false);
  const [showDownloadMenuPreview, setShowDownloadMenuPreview] = useState(false);
  const [pendingExportFormat, setPendingExportFormat] = useState(null); // 'jpg' | 'png' | 'pdf'
  const [exporting, setExporting] = useState(false);
  /** { label: string, current: number, total: number } | null */
  const [exportProgress, setExportProgress] = useState(null);
  const [chargingDownloadPoints, setChargingDownloadPoints] = useState(false);

  const [pageSizeMode, setPageSizeMode] = useState("a4"); // 'a4' | 'custom'
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

  const [previewGapUnit, setPreviewGapUnit] = useState("mm"); // 'mm' | 'cm' | 'px' | 'inch'

  const [previewGapHorizontalMm, setPreviewGapHorizontalMm] =
    useState(PRINT_GAP_MM);
  const [previewGapVerticalMm, setPreviewGapVerticalMm] =
    useState(PRINT_GAP_MM);
  const [centerPreviewCards, setCenterPreviewCards] = useState(false);
  const [previewPageBackgroundColor, setPreviewPageBackgroundColor] =
    useState(DEFAULT_PREVIEW_PAGE_BG);

  const pageWidthMm = React.useMemo(
    () =>
      pageSizeMode === "a4"
        ? A4_WIDTH_MM
        : clampPageMm(customPageWidthMm, A4_WIDTH_MM),
    [pageSizeMode, customPageWidthMm],
  );
  const pageHeightMm = React.useMemo(
    () =>
      pageSizeMode === "a4"
        ? A4_HEIGHT_MM
        : clampPageMm(customPageHeightMm, A4_HEIGHT_MM),
    [pageSizeMode, customPageHeightMm],
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

  // Fetch schools when on root saved-id-cards
  useEffect(() => {
    if (schoolId != null) return;
    let cancelled = false;
    setLoadingSchools(true);
    setErrorSchools("");
    getAssignedSchools()
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
  }, [schoolId]);

  // Fetch classes when schoolId is in URL
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    setLoadingClasses(true);
    setErrorClasses("");
    setTemplateStatus(null);
    getAssignedSchools()
      .then((res) => {
        const school = (res.schools ?? []).find((s) => s._id === schoolId);
        if (!cancelled)
          setSelectedSchool(school || { _id: schoolId, schoolName: schoolId });
      })
      .catch(() => {});
    getClassesBySchool(schoolId)
      .then((res) => {
        if (!cancelled) {
          setClasses(res.classes ?? []);
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
  }, [schoolId]);

  // Fetch students (template status) when both schoolId and classId are in URL
  useEffect(() => {
    if (!schoolId || !classId) return;
    let cancelled = false;
    setLoadingStudents(true);
    setErrorStudents("");
    getClassesBySchool(schoolId)
      .then((res) => {
        const cls = (res.classes ?? []).find((c) => c._id === classId);
        if (!cancelled)
          setSelectedClass(
            cls || { _id: classId, className: classId, section: "" },
          );
      })
      .catch(() => {});
    getTemplatesStatus(schoolId, classId)
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
  }, [schoolId, classId]);

  // Student data source:
  // `studentsWithTemplates` comes from `getTemplatesStatus(schoolId, classId)`
  // which calls API: GET `/api/photographer/templates/status?schoolId=...&classId=...`
  // Response includes `students` with `hasTemplate: true` for saved ID cards
  // (fallback to `summary.withTemplates` when available).
  const studentsWithTemplates =
    templateStatus?.students?.filter((s) => s.hasTemplate) ??
    templateStatus?.summary?.withTemplates ??
    [];

  console.log("studentsWithTemplates", studentsWithTemplates);

  const getTemplateName = (templateId, card = null) => {
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
  };

  // Build card-like object from API student for preview/print
  // Include address, name, photoUrl, studentId, dimension (from school) so ID card preview shows full data and size
  const studentToCard = (student) => {
    const apiTemplate = student?.template ?? null;
    const isApiTemplateRenderable = Boolean(
      apiTemplate?.frontImage && Array.isArray(apiTemplate?.elements),
    );

    // In "View Template" flow, render the template coming from API (frontImage/backImage/elements).
    // We pass it as uploadedTemplate override so existing IdCardRenderer + back preview can render it.
    const templateId =
      isViewTemplateFlow && isApiTemplateRenderable
        ? "uploaded-custom"
        : apiTemplate?.templateId;

    return {
      _id: student._id,
      id: apiTemplate?.templateId || student._id,
      studentId:
        student.admissionNo ?? student.rollNo ?? student.uniqueCode ?? "",
      name: student.studentName ?? "",
      templateId,
      uploadedTemplate:
        isViewTemplateFlow && isApiTemplateRenderable
          ? {
              name: apiTemplate?.name || "Uploaded Template",
              frontImage: fullPhotoUrl(apiTemplate.frontImage),
              backImage: fullPhotoUrl(apiTemplate.backImage),
              elements: apiTemplate.elements,
            }
          : null,
      studentImage: fullPhotoUrl(student.photoUrl),
      className: student.class
        ? `${student.class.className}${student.class.section ? ` - ${student.class.section}` : ""}`
        : "",
      schoolName: student.school?.schoolName || "",
      address: student.address ?? "",
      dateOfBirth:
        student.dateOfBirth ?? student.birthDate ?? student.dob ?? undefined,
      phone: student.mobile ?? student.phone ?? undefined,
      email: student.email ?? undefined,
      extraFields: student.extraFields || {},
      dimension: student.school?.dimension ?? null,
      dimensionUnit: student.school?.dimensionUnit ?? "mm",
    };
  };

  const getPreviewUrl = (student) => {
    const templateId = student.template?.templateId || student._id;
    let base = `${previewBasePath}/${student._id}/${templateId}`;
    if (schoolId && classId)
      base += `?schoolId=${encodeURIComponent(schoolId)}&classId=${encodeURIComponent(classId)}`;
    return base;
  };

  const cardsToPrint = studentsWithTemplates.map(studentToCard);
  const cardsToPrintRef = useRef(cardsToPrint);
  cardsToPrintRef.current = cardsToPrint;
  const hasFabricCards = cardsToPrint.some((c) =>
    c.templateId?.startsWith("fabric-"),
  );

  // How many cards fit per page from current page size (A4 or custom), card dimensions and current preview gaps
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
    const usableW = pageWidthMm - 2 * PRINT_PAGE_MARGIN_MM;
    const usableH = pageHeightMm - 2 * PRINT_PAGE_MARGIN_MM;
    const gapH = previewGapHorizontalMm;
    const gapV = previewGapVerticalMm;
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
  }, [cardsToPrint, pageWidthMm, pageHeightMm, previewGapHorizontalMm, previewGapVerticalMm]);

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

  const pageSizeSummary =
    pageSizeMode === "a4"
      ? `A4 (${mmToUnit(A4_WIDTH_MM, pageSizeUnit).toFixed(1)}×${mmToUnit(A4_HEIGHT_MM, pageSizeUnit).toFixed(1)} ${
          pageSizeUnit === "px" ? "px" : pageSizeUnit
        })`
      : `Custom (${mmToUnit(pageWidthMm, pageSizeUnit).toFixed(1)}×${mmToUnit(pageHeightMm, pageSizeUnit).toFixed(1)} ${
          pageSizeUnit === "px" ? "px" : pageSizeUnit
        })`;

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
        onChange={(e) => setPageSizeMode(e.target.value)}
        style={{ ...pageSizeControlStyle, minWidth: 140 }}
      >
        <option value="a4">A4</option>
        <option value="custom">Custom</option>
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

                const parsed = parseUnitInput(raw);
                if (!Number.isFinite(parsed)) return; // allow empty while editing

                const nextMm = clampPageMm(
                  convertToMm(parsed, pageSizeUnit),
                  A4_WIDTH_MM,
                );
                setCustomPageWidthMm(nextMm);
                // Normalize to the clamped value (keeps preview + input consistent).
                setCustomPageWidthInput(String(mmToUnit(nextMm, pageSizeUnit)));
              }}
              onFocus={() => setIsEditingPageWidth(true)}
              onBlur={() => setIsEditingPageWidth(false)}
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

                const parsed = parseUnitInput(raw);
                if (!Number.isFinite(parsed)) return; // allow empty while editing

                const nextMm = clampPageMm(
                  convertToMm(parsed, pageSizeUnit),
                  A4_HEIGHT_MM,
                );
                setCustomPageHeightMm(nextMm);
                // Normalize to the clamped value (keeps preview + input consistent).
                setCustomPageHeightInput(String(mmToUnit(nextMm, pageSizeUnit)));
              }}
              onFocus={() => setIsEditingPageHeight(true)}
              onBlur={() => setIsEditingPageHeight(false)}
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
          value={mmToUnit(previewGapHorizontalMm, previewGapUnit)}
          onChange={(e) => {
            const parsed = parseUnitInput(e.target.value);
            if (!Number.isFinite(parsed)) return;
            const nextMm = clampPreviewGapMm(
              convertToMm(parsed, previewGapUnit),
              PRINT_GAP_MM,
            );
            setPreviewGapHorizontalMm(nextMm);
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
          value={mmToUnit(previewGapVerticalMm, previewGapUnit)}
          onChange={(e) => {
            const parsed = parseUnitInput(e.target.value);
            if (!Number.isFinite(parsed)) return;
            const nextMm = clampPreviewGapMm(
              convertToMm(parsed, previewGapUnit),
              PRINT_GAP_MM,
            );
            setPreviewGapVerticalMm(nextMm);
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
    if (!showPrintView || !printContentRef.current) return;
    const timer = setTimeout(() => window.print(), hasFabricCards ? 2200 : 800);
    return () => clearTimeout(timer);
  }, [showPrintView, hasFabricCards]);

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
      setExporting(true);
      setExportProgress({ label: "Preparing…", current: 0, total: 1 });
      const fileBaseName = `id-cards-${classId || schoolId || "export"}-${Date.now()}`;
      let captured = false;
      const maxAttempts = format === "jpg" ? 220 : 100;
      const stepMs = format === "jpg" ? 120 : 100;
      const onProg = (p) => {
        if (!cancelled) setExportProgress(p);
      };
      try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await delay(stepMs);
          if (cancelled) return;
          const wrap = previewPagesWrapRef.current;
          if (!wrap) continue;
          const nodes = wrap.querySelectorAll(".print-page.preview-page");
          const cards = cardsToPrintRef.current;
          if (
            nodes.length <= 0 ||
            spreadPagesCount <= 0 ||
            nodes.length !== spreadPagesCount
          ) {
            continue;
          }
          if (format === "jpg") {
            const frontCells = getFrontCardCellElements(wrap);
            const backCells = getBackCardCellElements(wrap);
            const expectedBackCells = countExpectedBackDomCells(
              cards,
              cardsPerPage,
            );
            if (
              frontCells.length !== cards.length ||
              backCells.length !== expectedBackCells ||
              cards.length === 0
            ) {
              continue;
            }
            setExportProgress({
              label: "Rendering cards…",
              current: 0,
              total: 1,
            });
            await delay(hasFabricCards ? 2800 : 650);
            if (cancelled) return;
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
            const cellsReadyFront = getFrontCardCellElements(wrap);
            const cellsReadyBack = getBackCardCellElements(wrap);
            if (
              cellsReadyFront.length !== cards.length ||
              cellsReadyBack.length !== expectedBackCells
            ) {
              continue;
            }
            const classLabel = selectedClass
              ? `${selectedClass.className}`.trim()
              : String(classId || schoolId || "Class").trim();
            const subfolderName = `${classLabel}`;
            const files = await buildPreviewFrontAndBackJpegFiles(
              wrap,
              cards,
              previewPageBackgroundColor,
              onProg,
              cardsPerPage,
            );

            // Additionally export one JPEG per preview page (page-sized, clearer than a stitched long image).
            try {
              const pageFiles = await buildPreviewPagesJpegFiles(
                nodes,
                previewPageBackgroundColor,
                onProg,
              );
              files.push(...pageFiles);
            } catch (e) {
              console.warn("Page JPEG export failed (keeping per-card JPEGs):", e);
            }
            const saveResult = await saveJpegExportToFolder(
              subfolderName,
              files,
              onProg,
              jpegWebParentDirHandleRef.current,
            );
            if (saveResult?.cancelled) {
              captured = true;
              break;
            }
            captured = true;
            break;
          }
          setExportProgress({
            label:
              format === "pdf"
                ? "Creating PDF…"
                : format === "png"
                  ? "Capturing PNG pages…"
                  : "Exporting…",
            current: 0,
            total: 1,
          });
          await exportPreviewPagesAsFiles(
            Array.from(nodes),
            format,
            pageWidthMm,
            pageHeightMm,
            fileBaseName,
            previewPageBackgroundColor,
          );
          captured = true;
          break;
        }
        if (!captured && !cancelled) {
          window.alert(
            "Could not capture the preview. Open Preview, wait for cards to load, then try Download again.",
          );
        }
      } catch (err) {
        console.error(err);
        window.alert(
          (typeof err?.message === "string" && err.message.trim()) ||
            "Download failed. Wait for the preview to finish loading, then try again.",
        );
      } finally {
        if (!cancelled) {
          setExporting(false);
          setPendingExportFormat(null);
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
    showPreviewView,
    spreadPagesCount,
    cardsPerPage,
    pageWidthMm,
    pageHeightMm,
    classId,
    schoolId,
    previewPageBackgroundColor,
    hasFabricCards,
  ]);

  const triggerExport = async (fmt) => {
    if (exporting || chargingDownloadPoints) return;
    setShowDownloadMenuList(false);
    setShowDownloadMenuPreview(false);

    // Desktop app: never use showDirectoryPicker — it is blocked in Electron / file:// and throws
    // "The request is not allowed by the user agent or the platform in the current context."
    const isElectronApp = Boolean(
      typeof window !== "undefined" && window.electron?.selectOutputFolder,
    );
    const canTryFileSystemAccessPicker =
      fmt === "jpg" &&
      !isElectronApp &&
      typeof window.showDirectoryPicker === "function" &&
      window.isSecureContext !== false;

    if (fmt === "jpg") {
      jpegWebParentDirHandleRef.current = null;
      if (canTryFileSystemAccessPicker) {
        try {
          jpegWebParentDirHandleRef.current =
            await window.showDirectoryPicker();
        } catch (e) {
          if (e?.name === "AbortError") return;
          // NotAllowedError, SecurityError, or platform block — continue without folder API
          console.warn("Folder picker unavailable, using download fallback:", e);
          jpegWebParentDirHandleRef.current = null;
        }
      }
    } else {
      jpegWebParentDirHandleRef.current = null;
    }

    if (isViewTemplateFlow) {
      const studentIds = studentsWithTemplates
        .map((student) => student?._id)
        .filter((id) => typeof id === "string" && id.trim() !== "");

      if (studentIds.length === 0) {
        window.alert("No students found for template download.");
        return;
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
        return;
      } finally {
        setChargingDownloadPoints(false);
      }
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

  const renderCardForPrint = (card, useGridSize = false) => {
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
        ...(card.address != null &&
          card.address !== "" && { address: card.address }),
      };
      return (
        <div
          key={`${card._id}-${card.id}`}
          className="print-card-cell fabric-card"
          style={cellStyle}
        >
          <FabricIdCardGenerator
            templateJson={fabricTemplate.json}
            backgroundDataUrl={fabricTemplate.backgroundDataUrl}
            studentData={studentData}
          />
        </div>
      );
    }
    const data = {
      studentImage: card.studentImage,
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
        style={cellStyle}
      >
        <IdCardRenderer
          templateId={card.templateId}
          data={data}
          size="preview"
          template={templateOverride}
        />
      </div>
    );
  };

  const renderBackOnlyForPrint = (card, useGridSize = false) => {
    const cellStyle = useGridSize ? undefined : cardCellStyle(card);
    const uploadedBack =
      card.uploadedTemplate?.backImage ??
      (card.templateId?.startsWith("uploaded-")
        ? getUploadedTemplateById(card.templateId)?.backImage
        : undefined);
    return (
      <div
        key={`back-${card._id}-${card.id}`}
        className="print-card-cell idcard-card"
        style={cellStyle}
      >
        <IdCardBackPreview
          schoolName={card.schoolName}
          address={card.address}
          templateId={card.templateId}
          size="preview"
          backImage={uploadedBack}
        />
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
            <IdCardBackPreview
              schoolName={card.schoolName}
              address={card.address}
              templateId={card.templateId}
              size="preview"
              backImage={
                card.uploadedTemplate?.backImage ??
                (card.templateId?.startsWith("uploaded-")
                  ? getUploadedTemplateById(card.templateId)?.backImage
                  : undefined)
              }
            />
          </div>
        </div>
      </div>
    );
  };

  // —— View: Schools list (no schoolId)
  const renderSchoolsList = () => (
    <>
      <h3 style={{ marginBottom: 8 }}>Select school</h3>
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
          onClick={() => navigate(`${basePath}/school/${schoolId}`)}
          style={{ padding: "6px 12px" }}
        >
          ← Back to classes
        </button>
        <h3 style={{ margin: 0 }}>
          {selectedClass
            ? `${selectedClass.className}`
            : classId}
          {isViewTemplateFlow ? " – Templates" : " – Saved ID cards"}
        </h3>
      </div>
      <p
        className="text-muted"
        style={{ marginBottom: 20, fontSize: "0.9rem" }}
      >
        {isViewTemplateFlow
          ? "Students with templates. Click to open preview."
          : "Students with saved ID cards. Click to open preview."}
      </p>
      {loadingStudents && <p className="text-muted">Loading students…</p>}
      {errorStudents && <p className="text-danger">{errorStudents}</p>}
      {!loadingStudents &&
        !errorStudents &&
        studentsWithTemplates.length === 0 && (
          <p className="text-muted">
            {isViewTemplateFlow
              ? "No templates in this class."
              : "No saved ID cards in this class."}
          </p>
        )}
      {!loadingStudents &&
        !errorStudents &&
        studentsWithTemplates.length > 0 && (
          <>
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
              {/* <div
                className="download-dropdown-wrap"
                style={{ position: "relative", display: "inline-block" }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={exporting || chargingDownloadPoints}
                  onClick={() => setShowDownloadMenuList((v) => !v)}
                >
                  {chargingDownloadPoints
                    ? "Checking balance…"
                    : exporting
                      ? "Downloading…"
                      : "⬇ Download"}{" "}
                  ▾
                </button>
                {showDownloadMenuList && (
                  <div
                    role="menu"
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      marginTop: 6,
                      zIndex: 20,
                      minWidth: 160,
                      background: "#fff",
                      border: "1px solid #ddd",
                      borderRadius: 8,
                      boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
                      overflow: "hidden",
                    }}
                  >
                    {["jpg", "png", "pdf"].map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        role="menuitem"
                        disabled={exporting || chargingDownloadPoints}
                        onClick={() => triggerExport(fmt)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 14px",
                          border: "none",
                          background: "transparent",
                          cursor:
                            exporting || chargingDownloadPoints
                              ? "not-allowed"
                              : "pointer",
                          fontSize: "0.95rem",
                          textTransform: "uppercase",
                        }}
                        onMouseEnter={(e) => {
                          if (!exporting && !chargingDownloadPoints)
                            e.currentTarget.style.background = "#f3f4f6";
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
              </div> */}
            </div>
            <ul className="saved-idcards-list">
              {/* `student` yahan `studentsWithTemplates` se aa raha hai, jo `getTemplatesStatus` (templates/status API) se populate hota hai. */}
              {studentsWithTemplates.map((student) => {

                console.log('student', student);
                const card = studentToCard(student);
                return (
                  <li key={student._id}>
                    <button
                      type="button"
                      className="saved-idcard-item"
                      onClick={() => setSingleCardPreview(card)}
                    >
                      <span className="saved-idcard-name">
                        {student.studentName}
                      </span>
                      <span className="text-muted saved-idcard-meta">
                        {getTemplateName(card.templateId, card)} ·{" "}
                        {student.admissionNo || student.rollNo || ""} ·{" "}
                        {student.template?.status || ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
    </>
  );

  const showSchools = schoolId == null;
  const showClasses = schoolId != null && classId == null;
  const showStudents = schoolId != null && classId != null;

  return (
    <>
      <Header title={title} showBack backTo={backTo} />
      <div className="card" style={{ maxWidth: 960 }}>
        {showSchools && renderSchoolsList()}
        {showClasses && renderClassesList()}
        {showStudents && renderStudentsList()}
      </div>

      {showPrintView && cardsToPrint.length > 0 && spreadPagesCount > 0 && (
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
            {previewSpreadPages.map((desc) => {
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
                    }}
                  >
                    {pageCards.map((card) =>
                      isBackPage
                        ? renderBackOnlyForPrint(card, true)
                        : renderCardForPrint(card, true),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-secondary print-cancel-btn"
            onClick={() => setShowPrintView(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {showPreviewView && cardsToPrint.length > 0 && spreadPagesCount > 0 && (
        <div className="preview-overlay" aria-hidden="true">
          <div
            className="preview-overlay-header"
            style={{ alignItems: "flex-start", gap: 16 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>
                ID Cards Preview – {pageSizeSummary} ({spreadPagesCount} page
                {spreadPagesCount !== 1 ? "s" : ""}; each batch: fronts, then backs
                only when the template has a back image)
              </h3>
              <div style={{ marginTop: 12 }}>
                {renderPageSizeControls("preview")}
                {renderPreviewGapControls("preview-gap")}
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setCenterPreviewCards((v) => !v)}
                  >
                    {centerPreviewCards
                      ? "Centered layout: ON"
                      : "Center cards on page"}
                  </button>
                </div>
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
                  disabled={exporting || chargingDownloadPoints}
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
                    {["jpg", "png", "pdf"].map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        role="menuitem"
                        disabled={exporting || chargingDownloadPoints}
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
          <div className="preview-cards-scroll">
            <div className="preview-pages-wrap" ref={previewPagesWrapRef}>
              {previewSpreadPages.map((desc) => {
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
                    className={`print-page preview-page print-page-spread ${centerPreviewCards ? "preview-page--center" : ""} ${isBackPage ? "preview-page--back" : "preview-page--front"}`}
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
                        columnGap: `${previewGapHorizontalMm}mm`,
                        rowGap: `${previewGapVerticalMm}mm`,
                      }}
                    >
                      {pageCards.map((card) =>
                        isBackPage
                          ? renderBackOnlyForPrint(card, true)
                          : renderCardForPrint(card, true),
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {exportProgress && (
            <div
              className="export-progress-overlay"
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 10050,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
              aria-live="polite"
              aria-busy="true"
            >
              <div
                style={{
                  pointerEvents: "auto",
                  background: "#2a2a2a",
                  padding: "20px 24px",
                  borderRadius: 12,
                  minWidth: 300,
                  maxWidth: "min(420px, 92vw)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
                }}
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
              </div>
            </div>
          )}
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
        .print-cancel-btn {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 10000;
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
        .preview-cards-scroll {
          flex: 1;
          overflow: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }
        .preview-pages-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
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
          align-items: center;
          gap: 0;
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
          max-height: 100%;
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
        }
        .print-card-cell {
          break-inside: avoid;
          page-break-inside: avoid;
          display: flex;
          align-items: center;
          justify-content: center;
          width: calc(var(--card-w-mm, 90) * 1mm);
          height: calc(var(--card-h-mm, 57) * 1mm);
          min-width: calc(var(--card-w-mm, 90) * 1mm);
          min-height: calc(var(--card-h-mm, 57) * 1mm);
          max-width: calc(var(--card-w-mm, 90) * 1mm);
          max-height: calc(var(--card-h-mm, 57) * 1mm);
          overflow: hidden;
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
          .print-cancel-btn { display: none !important; }
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
            overflow: hidden;
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
        }
      `}</style>
    </>
  );
}
