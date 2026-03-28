/** Bold detection for canvas text elements (saved templates / editor) */
export function isTextElementBold(el) {
  if (el?.type !== 'text') return false;
  const w = el.fontWeight;
  return (
    w === 'bold' ||
    w === '700' ||
    w === '600' ||
    (typeof w === 'number' && w >= 600) ||
    (typeof w === 'string' && /^(6|7)\d{2}$/.test(w))
  );
}

/** Default text box width % — nominal fontSize is tuned for this width */
export const ID_CARD_TEXT_REF_WIDTH_PERCENT = 42;

/**
 * Effective font size (px) for canvas template text: scales down when the box is wider or
 * narrower than the reference width so lines stay within the box and nothing clips.
 * User-set fontSize is the "design" size at {@link ID_CARD_TEXT_REF_WIDTH_PERCENT}% width.
 */
export function getCanvasTextEffectiveFontSizePx(el, widthPercent) {
  if (el?.type !== 'text') return 12;
  const base = typeof el.fontSize === 'number' && el.fontSize > 0 ? el.fontSize : 12;
  const w = Math.max(5, Math.min(100, widthPercent));
  const ref = ID_CARD_TEXT_REF_WIDTH_PERCENT;
  const sym = Math.min(ref / w, w / ref);
  const scaled = base * sym;
  return Math.round(Math.max(6, scaled));
}

/** CSS object for text elements — editor canvas and IdCardRenderer must match */
export function getTextTypographyStyle(el) {
  if (el.type !== 'text') return {};
  const bold = isTextElementBold(el);
  return {
    fontWeight: bold ? el.fontWeight || '700' : el.fontWeight || '400',
    fontStyle: el.fontStyle === 'italic' ? 'italic' : 'normal',
    textDecoration: el.textDecoration === 'underline' ? 'underline' : 'none',
  };
}
