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

/** Dropdown options — {@link el.fontFamily} stores the `value` key; CSS stacks are cross-platform */
export const ID_CARD_FONT_FAMILY_OPTIONS = [
  { value: '', label: 'Default (system)' },
  { value: 'system-ui', label: 'System UI' },
  { value: 'arial', label: 'Arial' },
  { value: 'helvetica-neue', label: 'Helvetica Neue' },
  { value: 'segoe', label: 'Segoe UI' },
  { value: 'calibri', label: 'Calibri' },
  { value: 'times', label: 'Times New Roman' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'cambria', label: 'Cambria' },
  { value: 'garamond', label: 'Garamond' },
  { value: 'palatino', label: 'Palatino' },
  { value: 'verdana', label: 'Verdana' },
  { value: 'tahoma', label: 'Tahoma' },
  { value: 'trebuchet', label: 'Trebuchet MS' },
  { value: 'lucida', label: 'Lucida Sans' },
  { value: 'courier', label: 'Courier New' },
  { value: 'comic', label: 'Comic Sans MS' },
  { value: 'impact', label: 'Impact' },
];

const FONT_FAMILY_STACKS = {
  'system-ui':
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  'helvetica-neue': '"Helvetica Neue", Helvetica, Arial, sans-serif',
  segoe: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
  calibri: 'Calibri, "Segoe UI", Candara, Verdana, sans-serif',
  times: '"Times New Roman", Times, serif',
  georgia: 'Georgia, "Times New Roman", serif',
  cambria: 'Cambria, Georgia, "Times New Roman", serif',
  garamond: 'Garamond, "Palatino Linotype", serif',
  palatino: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Geneva, Verdana, sans-serif',
  trebuchet: '"Trebuchet MS", Helvetica, sans-serif',
  lucida: '"Lucida Sans Unicode", "Lucida Grande", "Lucida Sans", sans-serif',
  courier: '"Courier New", Courier, monospace',
  comic: '"Comic Sans MS", "Comic Sans", cursive',
  impact: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
};

function fontFamilyCssForElement(el) {
  if (el?.type !== 'text') return undefined;
  const key = el.fontFamily;
  if (key == null || key === '') return undefined;
  return FONT_FAMILY_STACKS[key];
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
  const fontFamily = fontFamilyCssForElement(el);
  return {
    fontWeight: bold ? el.fontWeight || '700' : el.fontWeight || '400',
    fontStyle: el.fontStyle === 'italic' ? 'italic' : 'normal',
    textDecoration: el.textDecoration === 'underline' ? 'underline' : 'none',
    ...(fontFamily ? { fontFamily } : {}),
  };
}
