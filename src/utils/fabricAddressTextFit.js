import { Textbox } from 'fabric';

/** Fabric templates (fabric-*) — max wrapped lines before shrinking (matches canvas ID logic). */

export const FABRIC_ADDRESS_MAX_LINES = 3;
export const FABRIC_ADDRESS_MIN_FONT = 4;

function numericFabricFontWeight(fw) {
  if (fw == null || fw === '') return 400;
  if (fw === 'bold') return 700;
  if (fw === 'normal') return 400;
  if (typeof fw === 'number') return Math.min(900, Math.max(250, Math.round(fw)));
  const n = parseInt(String(fw), 10);
  return Number.isFinite(n) ? Math.min(900, Math.max(250, n)) : 400;
}

function fabricTextboxWrappedLineCount(tb) {
  try {
    tb.initDimensions?.();
  } catch (_) {
    /* ignore */
  }
  if (Array.isArray(tb._textLines) && tb._textLines.length)
    return Math.max(1, tb._textLines.length);
  tb.initDimensions?.();
  let linePx = tb.getHeightOfLine?.(0);
  if (!linePx || linePx <= 0)
    linePx = (tb.fontSize || 14) * (tb.lineHeight || 1.3);
  const totalH = tb.calcTextHeight?.();
  const h =
    typeof totalH === 'number' && totalH > 0
      ? totalH
      : (tb.height || 1) * Math.abs(tb.scaleY || 1);
  return Math.max(1, Math.ceil(h / linePx - 1e-5));
}

function nextLighterWeight(weight) {
  const ladder = [900, 800, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250];
  const n = ladder.find((s) => s < weight);
  return n != null ? n : Math.max(200, weight - 50);
}

function fabricWeightCss(num) {
  if (num >= 700) return 'bold';
  return String(Math.round(num));
}

/** Shrink font (then weight) only when wrapped line count > maxLines at template size. */
export function fitFabricAddressTextbox(tb, canvas) {
  const baseSize = Math.max(
    FABRIC_ADDRESS_MIN_FONT,
    (tb.fontSize || 14) * Math.abs(tb.scaleY || 1),
  );
  tb.set({ scaleX: 1, scaleY: 1, fontSize: baseSize, fontWeight: tb.fontWeight });
  tb.initDimensions?.();
  canvas.requestRenderAll();

  if (fabricTextboxWrappedLineCount(tb) <= FABRIC_ADDRESS_MAX_LINES) {
    return;
  }

  let w = numericFabricFontWeight(tb.fontWeight);
  while (w >= 250) {
    let lo = FABRIC_ADDRESS_MIN_FONT;
    let hi = baseSize;
    const fw = fabricWeightCss(w);
    for (let i = 0; i < 14; i += 1) {
      const mid = (lo + hi) / 2;
      tb.set({ fontSize: mid, fontWeight: fw });
      tb.initDimensions?.();
      canvas.requestRenderAll();
      const lines = fabricTextboxWrappedLineCount(tb);
      if (lines <= FABRIC_ADDRESS_MAX_LINES) lo = mid;
      else hi = mid;
    }
    const cand = Math.max(FABRIC_ADDRESS_MIN_FONT, Math.round(lo * 10) / 10);
    tb.set({ fontSize: cand, fontWeight: fw });
    tb.initDimensions?.();
    canvas.requestRenderAll();
    if (fabricTextboxWrappedLineCount(tb) <= FABRIC_ADDRESS_MAX_LINES) return;
    w = nextLighterWeight(w);
  }
}

/**
 * Replace a single-line Fabric text placeholder with a wrapping Textbox sized to the same box.
 */
export function replaceFabricTextWithAddressTextbox(canvas, textObj, addressStr) {
  const boxW = Math.max(48, textObj.getScaledWidth());
  const effFont = (textObj.fontSize || 14) * Math.abs(textObj.scaleY || 1);
  const opts = {
    left: textObj.left,
    top: textObj.top,
    angle: textObj.angle || 0,
    fill: textObj.fill,
    fontFamily: textObj.fontFamily,
    fontSize: effFont,
    fontWeight: textObj.fontWeight,
    fontStyle: textObj.fontStyle || 'normal',
    textAlign: textObj.textAlign || 'left',
    lineHeight: textObj.lineHeight || 1.2,
    underline: textObj.underline,
    linethrough: textObj.linethrough,
    originX: textObj.originX,
    originY: textObj.originY,
    flipX: textObj.flipX,
    flipY: textObj.flipY,
    opacity: textObj.opacity ?? 1,
    width: boxW,
    splitByGrapheme: false,
    skewX: textObj.skewX,
    skewY: textObj.skewY,
    scaleX: 1,
    scaleY: 1,
    selectable: textObj.selectable,
    evented: textObj.evented,
    dataField: 'address',
    customType: textObj.customType,
  };
  const tb = new Textbox(String(addressStr), opts);
  canvas.remove(textObj);
  canvas.add(tb);
  return tb;
}
