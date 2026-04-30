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

/** Fast = bulk jobs; balanced = default; high = small batches (sharper, slower). */
export const EXPORT_RENDER_PRESET = {
  fast: { pixelScale: 2.1, jpegQuality: 0.88, pagePixelScale: 1.95 },
  balanced: { pixelScale: 2.85, jpegQuality: 0.93, pagePixelScale: 2.65 },
  high: { pixelScale: 3.75, jpegQuality: 0.97, pagePixelScale: 3.5 },
};

export function getCardExportPreset({ bulk, megaBulkPage } = {}) {
  if (megaBulkPage) return EXPORT_RENDER_PRESET.fast;
  if (bulk) return EXPORT_RENDER_PRESET.balanced;
  return EXPORT_RENDER_PRESET.high;
}

export function getPageExportPreset({ bulk, megaBulkPage } = {}) {
  if (megaBulkPage) return EXPORT_RENDER_PRESET.fast;
  if (bulk) return { ...EXPORT_RENDER_PRESET.balanced, pagePixelScale: 2.75 };
  return EXPORT_RENDER_PRESET.high;
}

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
    ...(card.colorCodeImage ? { colorCodeImage: card.colorCodeImage } : {}),
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
  const p = loadImageUncached(src);
  imageCache.set(src, p);
  return p;
}

/** Prefer createImageBitmap (decode once); fall back to HTMLImageElement. */
async function loadImageUncached(src) {
  if (typeof createImageBitmap === "function") {
    try {
      const res = await fetch(src, { mode: "cors", credentials: "omit" });
      const blob = await res.blob();
      return await createImageBitmap(blob);
    } catch (_) {
      /* fall through */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image failed to load: ${src}`));
    img.src = src;
  });
}

function drawImageSource(ctx, source, dx, dy, dw, dh, fit = "fill") {
  if (!source) return;
  const sw = source.width || source.videoWidth || 0;
  const sh = source.height || source.videoHeight || 0;
  if (!sw || !sh || !dw || !dh) return;

  if (fit === "fill") {
    ctx.drawImage(source, dx, dy, dw, dh);
    return;
  }

  const srcRatio = sw / sh;
  const destRatio = dw / dh;

  // Match CSS object-fit behavior used by preview renderer.
  if (fit === "contain") {
    let rw = dw;
    let rh = dh;
    if (srcRatio > destRatio) {
      rh = dw / srcRatio;
    } else {
      rw = dh * srcRatio;
    }
    const rx = dx + (dw - rw) / 2;
    const ry = dy + (dh - rh) / 2;
    ctx.drawImage(source, rx, ry, rw, rh);
    return;
  }

  // cover
  let sx = 0;
  let sy = 0;
  let sWidth = sw;
  let sHeight = sh;
  if (srcRatio > destRatio) {
    sWidth = sh * destRatio;
    sx = (sw - sWidth) / 2;
  } else {
    sHeight = sw / destRatio;
    sy = (sh - sHeight) / 2;
  }
  ctx.drawImage(source, sx, sy, sWidth, sHeight, dx, dy, dw, dh);
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
  drawImageSource(ctx, bg, 0, 0, wPx, hPx);

  const paintOrder = (() => {
    const portraits = [];
    const badges = [];
    const rest = [];
    for (const el of tpl.elements) {
      if (el?.type === "photo") portraits.push(el);
      else if (el?.type === "colorCode") badges.push(el);
      else rest.push(el);
    }
    return [...portraits, ...badges, ...rest];
  })();

  for (const el of paintOrder) {
    if (el.type === "photo" && el.showOnTemplate !== false && data.studentImage) {
      try {
        const photo = await loadImageCached(data.studentImage);
        const px = (el.x / 100) * wPx;
        const py = (el.y / 100) * hPx;
        const pw = (el.width / 100) * wPx;
        const ph = (el.height / 100) * hPx;
        drawImageSource(ctx, photo, px, py, pw, ph, "cover");
      } catch (_) {
        /* skip broken photo */
      }
    } else if (
      el.type === "colorCode" &&
      el.showOnTemplate !== false &&
      data.colorCodeImage
    ) {
      try {
        const badge = await loadImageCached(data.colorCodeImage);
        const px = (el.x / 100) * wPx;
        const py = (el.y / 100) * hPx;
        const pw = (el.width / 100) * wPx;
        const ph = (el.height / 100) * hPx;
        drawImageSource(ctx, badge, px, py, pw, ph, "contain");
      } catch (_) {
        /* skip broken badge */
      }
    } else if (el.type !== "photo" && el.type !== "colorCode") {
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

function hasFabricCard(c) {
  return Boolean(c && String(c.templateId || "").startsWith("fabric-"));
}

/**
 * True when every card on this spread can be drawn via data canvas (no Fabric, correct template side).
 */
export function canRenderSpreadPageDataOnly(pageCards, side) {
  if (!pageCards?.length) return false;
  for (const c of pageCards) {
    if (hasFabricCard(c)) return false;
    if (side === "back") {
      if (!cardSupportsDataExportBack(c)) return false;
    } else if (!cardSupportsDataExportRenderer(c)) {
      return false;
    }
  }
  return true;
}

/** Match preview `getCardCropMarks`: 2mm black dots at sheet corners (per corner card). */
const CROP_MARK_DIAMETER_MM = 2;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} totalCards
 * @param {"front"|"back"} side
 * @param {number} cols
 * @param {number} cwPx
 * @param {number} chPx
 * @param {number} gapHPx
 * @param {number} gapVPx
 * @param {number} startX
 * @param {number} startY
 * @param {number} mmToPx page mm → pixel scale (same as layout math in this file)
 */
function drawSpreadPageCropMarks(
  ctx,
  totalCards,
  side,
  cols,
  cwPx,
  chPx,
  gapHPx,
  gapVPx,
  startX,
  startY,
  mmToPx,
) {
  if (!totalCards || cols < 1) return;
  const R = Math.floor((totalCards - 1) / cols);
  const firstRowFirst = 0;
  const firstRowLast = Math.min(cols - 1, totalCards - 1);
  const lastRowFirst = R * cols;
  const lastRowLast = totalCards - 1;
  const rPx = (CROP_MARK_DIAMETER_MM / 2) * mmToPx;

  ctx.save();
  ctx.fillStyle = "#000000";

  for (let i = 0; i < totalCards; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ci = side === "back" ? cols - 1 - col : col;
    const x = startX + ci * (cwPx + gapHPx);
    const y = startY + row * (chPx + gapVPx);

    const isTopLeft = i === firstRowFirst;
    const isTopRight = i === firstRowLast;
    const isBottomLeft = i === lastRowFirst;
    const isBottomRight = i === lastRowLast;

    if (side === "back") {
      if (isTopLeft) {
        ctx.beginPath();
        ctx.arc(x + cwPx, y, rPx, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isTopRight) {
        ctx.beginPath();
        ctx.arc(x, y, rPx, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isBottomLeft) {
        ctx.beginPath();
        ctx.arc(x + cwPx, y + chPx, rPx, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isBottomRight) {
        ctx.beginPath();
        ctx.arc(x, y + chPx, rPx, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      if (isTopLeft) {
        ctx.beginPath();
        ctx.arc(x, y, rPx, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isTopRight) {
        ctx.beginPath();
        ctx.arc(x + cwPx, y, rPx, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isBottomLeft) {
        ctx.beginPath();
        ctx.arc(x, y + chPx, rPx, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isBottomRight) {
        ctx.beginPath();
        ctx.arc(x + cwPx, y + chPx, rPx, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/**
 * One printable sheet: background + grid of card sides (matches preview layout).
 * @param {object} layout pageWidthMm, pageHeightMm, marginMm, gapHm, gapVm, cols, rows, cardWidthMm, cardHeightMm
 */
export async function renderSpreadPageToCanvas(
  pageCards,
  side,
  layout,
  pageBgHex,
  options = {},
) {
  const {
    pageWidthMm,
    pageHeightMm,
    marginMm,
    gapHm,
    gapVm,
    cols,
    rows,
    cardWidthMm,
    cardHeightMm,
  } = layout;
  const { bulk, megaBulkPage, pagePixelScale: optPagePs, pixelScale: optCardPs, ...restOpt } =
    options;
  const pagePreset = getPageExportPreset({ bulk, megaBulkPage });
  const pagePixelScale =
    typeof optPagePs === "number" ? optPagePs : pagePreset.pagePixelScale;
  const cardPreset = getCardExportPreset({ bulk, megaBulkPage });
  const cardPixelScale =
    typeof optCardPs === "number" ? optCardPs : cardPreset.pixelScale;
  /** Never render a card at lower internal resolution than the grid cell (avoids blurry upscaling). */
  const cardRenderPixelScale = Math.max(cardPixelScale, pagePixelScale);

  const pageWPx = Math.max(
    2,
    Math.round(pageWidthMm * MM_TO_CSS_PX * pagePixelScale),
  );
  const pageHPx = Math.max(
    2,
    Math.round(pageHeightMm * MM_TO_CSS_PX * pagePixelScale),
  );
  const mmToPx = pageWPx / pageWidthMm;

  const canvas = document.createElement("canvas");
  canvas.width = pageWPx;
  canvas.height = pageHPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  const bg = normalizeHexForCanvas(pageBgHex);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, pageWPx, pageHPx);

  const marginPx = marginMm * mmToPx;
  const cwPx = cardWidthMm * mmToPx;
  const chPx = cardHeightMm * mmToPx;
  const gapHPx = gapHm * mmToPx;
  const gapVPx = gapVm * mmToPx;
  const gridW = cols * cwPx + Math.max(0, cols - 1) * gapHPx;
  const gridH = rows * chPx + Math.max(0, rows - 1) * gapVPx;
  const innerW = pageWPx - 2 * marginPx;
  const innerH = pageHPx - 2 * marginPx;
  const startX = marginPx + Math.max(0, (innerW - gridW) / 2);
  const startY = marginPx + Math.max(0, (innerH - gridH) / 2);

  const cardOpts = {
    ...restOpt,
    bulk,
    megaBulkPage,
    pixelScale: cardRenderPixelScale,
    quality: cardPreset.jpegQuality,
    mime: "image/jpeg",
  };

  const cardCanvases = await Promise.all(
    pageCards.map((c) => renderCardSideToCanvas(c, side, cardOpts)),
  );

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  for (let i = 0; i < pageCards.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ci = side === "back" ? cols - 1 - col : col;
    const x = startX + ci * (cwPx + gapHPx);
    const y = startY + row * (chPx + gapVPx);
    const cc = cardCanvases[i];
    drawImageSource(ctx, cc, x, y, cwPx, chPx);
  }

  drawSpreadPageCropMarks(
    ctx,
    pageCards.length,
    side,
    cols,
    cwPx,
    chPx,
    gapHPx,
    gapVPx,
    startX,
    startY,
    mmToPx,
  );

  return canvas;
}

function normalizeHexForCanvas(hex) {
  if (typeof hex !== "string" || !/^#?[0-9a-fA-F]{3,8}$/.test(hex.trim())) {
    return "#ffffff";
  }
  let s = hex.trim();
  if (!s.startsWith("#")) s = `#${s}`;
  if (s.length === 4) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return s.length >= 7 ? s.slice(0, 7) : "#ffffff";
}

export async function renderSpreadPageToJpegBlob(pageCards, side, layout, pageBgHex, options) {
  const canvas = await renderSpreadPageToCanvas(
    pageCards,
    side,
    layout,
    pageBgHex,
    options,
  );
  const preset = getPageExportPreset(options);
  const q =
    typeof options?.jpegQuality === "number"
      ? options.jpegQuality
      : preset.jpegQuality ?? EXPORT_RENDER_PRESET.balanced.jpegQuality;
  return canvasToBlob(canvas, "image/jpeg", q);
}

export async function renderSpreadPageToPngBlob(pageCards, side, layout, pageBgHex, options) {
  const canvas = await renderSpreadPageToCanvas(
    pageCards,
    side,
    layout,
    pageBgHex,
    options,
  );
  return canvasToBlob(canvas, "image/png");
}
