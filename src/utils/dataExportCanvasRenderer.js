/**
 * Data-driven ID card export: draw template + student fields on an offscreen canvas.
 * Avoids DOM/screenshot pipelines for canvas-style templates (image + element JSON).
 *
 * Fabric templates and non-canvas layouts fall back to capture in SavedIdCardsList.
 */

import { getTemplateById, getInternalTemplateId } from "../data/idCardTemplates";
import { getUploadedTemplateById } from "../data/uploadedTemplatesStorage";
import {
  getCanvasTextEffectiveFontSizePx,
  getTextTypographyStyle,
  isTextElementBold,
  fontFamilyCssForElement,
} from "./idCardTextTypography";

/** When true, per-card export prefers this renderer (capture remains fallback). */
export const USE_DATA_EXPORT_RENDERER_PRIMARY = true;

const DEFAULT_CARD_W_MM = 90;
const DEFAULT_CARD_H_MM = 57;
const MM_TO_CSS_PX = 96 / 25.4;

const imageCache = new Map();

function convertDimensionToMm(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  switch (unit) {
    case "cm":
      return n * 10;
    case "inch":
      return n * 25.4;
    case "px":
      return n * 0.264583;
    case "mm":
    default:
      return n;
  }
}

function getCardSizeMm(card) {
  let wMm = DEFAULT_CARD_W_MM;
  let hMm = DEFAULT_CARD_H_MM;
  if (
    card?.dimension &&
    typeof card.dimension.width === "number" &&
    typeof card.dimension.height === "number"
  ) {
    const u = card.dimensionUnit || "mm";
    const w = convertDimensionToMm(card.dimension.width, u);
    const h = convertDimensionToMm(card.dimension.height, u);
    if (w != null && w > 0) wMm = w;
    if (h != null && h > 0) hMm = h;
  }
  return { wMm, hMm };
}

function getUploadedOrStoredTemplate(card) {
  return (
    card.uploadedTemplate ||
    (card.templateId?.startsWith("uploaded-")
      ? getUploadedTemplateById(card.templateId)
      : null)
  );
}

function isMissing(v) {
  return v == null || v === "";
}

function getCanvasRawValue(data, key) {
  if (!key || !data) return undefined;
  if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
  const ex = data.extraFields;
  if (ex instanceof Map && ex.has(key)) return ex.get(key);
  if (ex && typeof ex === "object" && Object.prototype.hasOwnProperty.call(ex, key)) {
    return ex[key];
  }
  return undefined;
}

/** Same field resolution as IdCardRenderer.resolveCanvasDataField */
export function resolveCanvasDataFieldForExport(data, fieldKey) {
  if (!fieldKey || !data) return null;
  const tryKeys = (keys) => {
    for (const k of keys) {
      const v = getCanvasRawValue(data, k);
      if (!isMissing(v)) return v;
    }
    return null;
  };
  const aliasGroups = {
    phone: ["phone", "mobile", "studentMobile", "contact", "whatsapp"],
    mobile: ["mobile", "phone", "studentMobile", "contact", "whatsapp"],
    email: ["email", "studentEmail"],
    studentId: ["studentId", "admissionNo", "rollNo", "uniqueCode", "regNo"],
    admissionNo: ["admissionNo", "regNo", "studentId"],
    rollNo: ["rollNo", "studentId"],
    className: ["className", "class"],
    name: ["name", "studentName"],
    dateOfBirth: ["dateOfBirth", "dob", "birthDate"],
    address: ["address", "residentialAddress"],
    fatherName: ["fatherName", "fathersName"],
    motherName: ["motherName", "mothersName"],
    house: ["house", "houseName", "transport", "route"],
    fatherPrimaryContact: [
      "fatherPrimaryContact",
      "fatherMobile",
      "fatherPhone",
      "fatherphone",
      "fathermobile",
    ],
    motherPrimaryContact: [
      "motherPrimaryContact",
      "motherMobile",
      "motherPhone",
      "motherphone",
    ],
    section: ["section", "division"],
    schoolName: ["schoolName", "school"],
  };
  const keys = aliasGroups[fieldKey] || [fieldKey];
  return tryKeys(keys);
}

function formatDateDMY(input) {
  if (input == null || input === "") return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

function buildRendererData(card) {
  return {
    studentImage: card.studentImage,
    name: card.name,
    studentId: card.studentId,
    className: card.className,
    schoolName: card.schoolName,
    extraFields: card.extraFields || {},
    ...(card.address != null && card.address !== "" ? { address: card.address } : {}),
    ...(card.dateOfBirth
      ? { dateOfBirth: formatDateDMY(card.dateOfBirth) }
      : {}),
    ...(card.phone ? { phone: card.phone } : {}),
    ...(card.email ? { email: card.email } : {}),
    ...(card.schoolLogo ? { schoolLogo: card.schoolLogo } : {}),
    ...(card.signature ? { signature: card.signature } : {}),
  };
}

/**
 * True for API / editor canvas templates (front image + elements). Not Fabric.
 */
export function cardSupportsDataExportRenderer(card) {
  if (!card || String(card.templateId || "").startsWith("fabric-")) return false;
  const uploadedT = getUploadedOrStoredTemplate(card);
  if (
    uploadedT?.frontImage &&
    Array.isArray(uploadedT.elements) &&
    uploadedT.elements.length > 0
  ) {
    return true;
  }
  const internalId = getInternalTemplateId(card.templateId);
  const t = getTemplateById(internalId || card.templateId);
  return Boolean(t?.image && Array.isArray(t.elements) && t.elements.length > 0);
}

export function cardSupportsDataExportBack(card) {
  if (!card || String(card.templateId || "").startsWith("fabric-")) return false;
  const uploadedT = getUploadedOrStoredTemplate(card);
  const backImage = uploadedT?.backImage;
  const backEls = uploadedT?.backElements;
  return Boolean(
    backImage && Array.isArray(backEls) && backEls.length > 0,
  );
}

function resolveTemplateForSide(card, side) {
  const uploadedT = getUploadedOrStoredTemplate(card);
  if (side === "back") {
    if (!uploadedT?.backImage || !Array.isArray(uploadedT.backElements)) return null;
    return {
      image: uploadedT.backImage,
      elements: uploadedT.backElements,
    };
  }
  if (
    uploadedT?.frontImage &&
    Array.isArray(uploadedT.elements) &&
    uploadedT.elements.length > 0
  ) {
    return { image: uploadedT.frontImage, elements: uploadedT.elements };
  }
  const internalId = getInternalTemplateId(card.templateId);
  const t = getTemplateById(internalId || card.templateId);
  if (t?.image && t.elements?.length) return { image: t.image, elements: t.elements };
  return null;
}

function loadImageCached(src) {
  if (!src) return Promise.reject(new Error("Missing image URL"));
  const hit = imageCache.get(src);
  if (hit) return hit;
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageCache.set(src, Promise.resolve(img));
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Image failed to load: ${src}`));
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      mime,
      quality,
    );
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("readAsDataURL failed"));
    r.readAsDataURL(blob);
  });
}

function normalizeTextAlign(el) {
  const a = el?.textAlign;
  if (a === "center" || a === "right") return a;
  return "left";
}

function normalizeTextVerticalAlign(el) {
  const v = el?.textVerticalAlign;
  if (v === "center" || v === "middle") return "center";
  if (v === "bottom") return "bottom";
  return "top";
}

/**
 * Word-wrap lines to fit maxWidth (px) using canvas measureText.
 */
function wrapTextLines(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = String(text).split(/\r?\n/);
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      const test = `${line} ${w}`;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawTextElement(ctx, el, textContent, canvasW, canvasH, pixelScale) {
  if (!textContent) return;
  const x = (el.x / 100) * canvasW;
  const y = (el.y / 100) * canvasH;
  const boxW = ((typeof el.width === "number" && el.width > 0 ? el.width : 42) / 100) * canvasW;
  const boxH =
    typeof el.height === "number" && el.height > 0
      ? (el.height / 100) * canvasH
      : undefined;

  const basePx = getCanvasTextEffectiveFontSizePx(el) * pixelScale;
  const typo = getTextTypographyStyle(el);
  const family = fontFamilyCssForElement(el) || "sans-serif";
  const weight = isTextElementBold(el) ? "bold" : typo.fontWeight || "400";
  const italic = typo.fontStyle === "italic" ? "italic " : "";
  ctx.font = `${italic}${weight} ${basePx}px ${family}`;
  ctx.fillStyle =
    el.color && String(el.color).trim() !== "" ? String(el.color) : "#111827";

  const hAlign = normalizeTextAlign(el);
  const vAlign = normalizeTextVerticalAlign(el);
  const wrapMultiline = el.dataField === "address";
  const maxLineW = Math.max(4, boxW - 2 * pixelScale);
  const lines = wrapMultiline
    ? wrapTextLines(ctx, textContent, maxLineW)
    : [String(textContent)];

  const lineHeight = basePx * 1.2;
  let totalH = lines.length * lineHeight;
  let startY = y;
  if (boxH != null) {
    if (vAlign === "center") startY = y + (boxH - totalH) / 2;
    else if (vAlign === "bottom") startY = y + boxH - totalH;
    if (startY < y) startY = y;
  }

  lines.forEach((line, i) => {
    const ly = startY + i * lineHeight + basePx * 0.85;
    let lx = x;
    const w = ctx.measureText(line).width;
    if (hAlign === "center") lx = x + (boxW - w) / 2;
    else if (hAlign === "right") lx = x + boxW - w;
    ctx.fillText(line, lx, ly);
  });
}

/**
 * Renders one card side to canvas (template image + elements). Caller supplies valid template.
 */
export async function renderCardSideToCanvas(card, side, options = {}) {
  const tpl = resolveTemplateForSide(card, side);
  if (!tpl?.image || !tpl.elements?.length) {
    throw new Error("No canvas template for side");
  }
  const pixelScale = typeof options.pixelScale === "number" ? options.pixelScale : 2;
  const { wMm, hMm } = getCardSizeMm(card);
  const wPx = Math.max(2, Math.round(wMm * MM_TO_CSS_PX * pixelScale));
  const hPx = Math.max(2, Math.round(hMm * MM_TO_CSS_PX * pixelScale));

  const canvas = document.createElement("canvas");
  canvas.width = wPx;
  canvas.height = hPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  const data = buildRendererData(card);
  const bg = await loadImageCached(tpl.image);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, wPx, hPx);
  ctx.drawImage(bg, 0, 0, wPx, hPx);

  for (const el of tpl.elements) {
    if (el.type === "photo" && data.studentImage) {
      try {
        const photo = await loadImageCached(data.studentImage);
        const px = (el.x / 100) * wPx;
        const py = (el.y / 100) * hPx;
        const pw = (el.width / 100) * wPx;
        const ph = (el.height / 100) * hPx;
        ctx.drawImage(photo, px, py, pw, ph);
      } catch (_) {
        /* skip broken photo */
      }
    } else if (el.type !== "photo") {
      const resolved = el.dataField
        ? resolveCanvasDataFieldForExport(data, el.dataField)
        : null;
      const text =
        resolved != null && !isMissing(resolved)
          ? String(resolved)
          : el.content != null
            ? String(el.content)
            : "";
      drawTextElement(ctx, el, text, wPx, hPx, pixelScale);
    }
  }

  return canvas;
}

/**
 * @param {"front"|"back"} side
 * @param {{ mime?: string, quality?: number, pixelScale?: number }} options
 */
export async function renderCardSideToDataUrl(card, side, options = {}) {
  const canvas = await renderCardSideToCanvas(card, side, options);
  const mime = options.mime || "image/jpeg";
  const q =
    typeof options.quality === "number"
      ? options.quality
      : mime === "image/png"
        ? undefined
        : 0.92;
  const blob = await canvasToBlob(
    canvas,
    mime,
    mime === "image/jpeg" ? q : undefined,
  );
  return blobToDataUrl(blob);
}

export async function renderCardSideToBlob(card, side, options = {}) {
  const canvas = await renderCardSideToCanvas(card, side, options);
  const mime = options.mime || "image/jpeg";
  const q =
    typeof options.quality === "number"
      ? options.quality
      : mime === "image/png"
        ? undefined
        : 0.92;
  return canvasToBlob(
    canvas,
    mime,
    mime === "image/jpeg" ? q : undefined,
  );
}
