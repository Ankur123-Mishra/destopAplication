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
  { value: 'arial-black', label: 'Arial Black' },
  { value: 'arial-rounded', label: 'Arial Rounded MT Bold' },
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
  { value: 'agency-fb', label: 'Agency FB' },
  { value: 'agency-fb-bold', label: 'Agency FB Bold' },
  { value: 'algerian', label: 'Algerian' },
  { value: 'arlrdbd', label: 'Arial Rounded MT Bold (ARLRDBD)' },
  { value: 'avant-garde', label: 'Avant Garde' },
  { value: 'avant-garde-medium', label: 'Avant Garde Medium (avgardm)' },
  { value: 'avant-garde-medium-italic', label: 'Avant Garde Medium Italic (avgardmi)' },
  { value: 'avant-garde-demi', label: 'Avant Garde Demi (avgardn)' },
  { value: 'avant-garde-demi-italic', label: 'Avant Garde Demi Italic (avgardni)' },
  { value: 'bahnschrift', label: 'Bahnschrift' },
  { value: 'raj-07-4', label: 'RAJ 07_4' },
  { value: 'raj-47-2', label: 'RAJ 47_2' },
  { value: 'raj-52-2', label: 'RAJ 52_2' },
  { value: 'raj-58-2', label: 'RAJ 58_2' },
  { value: 'raj-58-bold-2', label: 'RAJ 58-Bold_2' },
  { value: 'raj-79-2', label: 'RAJ 79_2' },
  { value: 'raj-100-2', label: 'RAJ 100_2' },
  { value: 'raj-prabhat-0', label: 'RAJ_PRABHAT_0' },
  { value: 's1003890', label: 'S1003890' },
  { value: 's1082890', label: 'S1082890' },
  { value: 's1095890', label: 'S1095890' },
  { value: 's1265890', label: 'S1265890' },
  { value: 'souveni2', label: 'SOUVENI2' },
  { value: 'souveni3', label: 'SOUVENI3' },
  { value: 'souvenir', label: 'SOUVENIR' },
  { value: 'souvenirlctteedem', label: 'SouvenirlctTEEdem' },
  { value: 'ubuntu-regular', label: 'Ubuntu Regular' },
  { value: 'ubuntu-bold', label: 'Ubuntu Bold' },
  { value: 'ubuntu-condensed', label: 'Ubuntu Condensed' },
  { value: 'ubuntu-light', label: 'Ubuntu Light' },
  { value: 'ubuntu-light-italic', label: 'Ubuntu Light Italic' },
  { value: 'ubuntu-medium', label: 'Ubuntu Medium' },
  { value: 'ubuntu-medium-italic', label: 'Ubuntu Medium Italic' },
  { value: 'ubuntu-italic', label: 'Ubuntu Italic' },
];

const FONT_FAMILY_STACKS = {
  'system-ui':
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  'arial-black': '"Arial Black", Arial, Helvetica, sans-serif',
  'arial-rounded': '"Arial Rounded MT Bold", "Helvetica Rounded", Arial, sans-serif',
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
  'agency-fb': '"Agency FB", "AgencyFB", "Arial Narrow", sans-serif',
  'agency-fb-bold': '"Agency FB Bold", "Agency FB", "Arial Narrow", sans-serif',
  algerian: 'Algerian, "Times New Roman", serif',
  arlrdbd: '"Arial Rounded MT Bold", "Helvetica Rounded", Arial, sans-serif',
  'avant-garde': '"ITC Avant Garde Gothic", "Avant Garde", CenturyGothic, "Arial Rounded MT Bold", sans-serif',
  'avant-garde-medium':
    '"ITC Avant Garde Gothic", "ITC Avant Garde Gothic Medium", "Avant Garde", CenturyGothic, sans-serif',
  'avant-garde-medium-italic':
    '"ITC Avant Garde Gothic", "ITC Avant Garde Gothic Medium", "Avant Garde", CenturyGothic, sans-serif',
  'avant-garde-demi':
    '"ITC Avant Garde Gothic", "ITC Avant Garde Gothic Demi", "Avant Garde", CenturyGothic, sans-serif',
  'avant-garde-demi-italic':
    '"ITC Avant Garde Gothic", "ITC Avant Garde Gothic Demi", "Avant Garde", CenturyGothic, sans-serif',
  bahnschrift: 'Bahnschrift, "Segoe UI", Arial, sans-serif',
  'raj-07-4': '"RAJ 07_4", "RAJ 07 4", serif',
  'raj-47-2': '"RAJ 47_2", "RAJ 47 2", serif',
  'raj-52-2': '"RAJ 52_2", "RAJ 52 2", serif',
  'raj-58-2': '"RAJ 58_2", "RAJ 58 2", serif',
  'raj-58-bold-2': '"RAJ 58-Bold_2", "RAJ 58 Bold 2", serif',
  'raj-79-2': '"RAJ 79_2", "RAJ 79 2", serif',
  'raj-100-2': '"RAJ 100_2", "RAJ 100 2", serif',
  'raj-prabhat-0': '"RAJ_PRABHAT_0", "RAJ PRABHAT 0", serif',
  s1003890: '"S1003890", sans-serif',
  s1082890: '"S1082890", sans-serif',
  s1095890: '"S1095890", sans-serif',
  s1265890: '"S1265890", sans-serif',
  souveni2: '"SOUVENI2", "Souvenir", serif',
  souveni3: '"SOUVENI3", "Souvenir", serif',
  souvenir: '"SOUVENIR", "Souvenir", serif',
  souvenirlctteedem: '"SouvenirlctTEEdem", "Souvenir LT", "Souvenir", serif',
  'ubuntu-regular': '"Ubuntu", "Ubuntu Regular", sans-serif',
  'ubuntu-bold': '"Ubuntu Bold", "Ubuntu", sans-serif',
  'ubuntu-condensed': '"Ubuntu Condensed", "Ubuntu", sans-serif',
  'ubuntu-light': '"Ubuntu Light", "Ubuntu", sans-serif',
  'ubuntu-light-italic': '"Ubuntu Light Italic", "Ubuntu Light", "Ubuntu", sans-serif',
  'ubuntu-medium': '"Ubuntu Medium", "Ubuntu", sans-serif',
  'ubuntu-medium-italic': '"Ubuntu Medium Italic", "Ubuntu Medium", "Ubuntu", sans-serif',
  'ubuntu-italic': '"Ubuntu Italic", "Ubuntu", sans-serif',
};

function fontFamilyCssForElement(el) {
  if (el?.type !== 'text') return undefined;
  const key = el.fontFamily;
  if (key == null || key === '') return undefined;
  return FONT_FAMILY_STACKS[key];
}

/** Default text box width % when an element omits width */
export const ID_CARD_TEXT_REF_WIDTH_PERCENT = 42;

/**
 * Pixel font size for canvas template text: follows `el.fontSize` only.
 * Text box width/height does not change type size — adjust font with the font size control.
 * @param {number} [_widthPercent] legacy argument from callers; ignored
 */
export function getCanvasTextEffectiveFontSizePx(el, _widthPercent) {
  if (el?.type !== 'text') return 10;
  const base = typeof el.fontSize === 'number' && el.fontSize > 0 ? el.fontSize : 10;
  return Math.round(Math.max(4, base));
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

/** Horizontal alignment of text inside the template text box (saved on text elements). */
function normalizeTextAlignInBox(el) {
  const a = el?.textAlign;
  if (a === 'center' || a === 'right') return a;
  return 'left';
}

/** Vertical alignment inside the box: top | center | bottom */
function normalizeTextVerticalAlignInBox(el) {
  const v = el?.textVerticalAlign;
  if (v === 'center' || v === 'middle') return 'center';
  if (v === 'bottom') return 'bottom';
  return 'top';
}

/**
 * Dropdown options: position of text inside its width/height box (editor + printed card).
 * Each option sets {@link textAlign} and {@link textVerticalAlign} on the element.
 */
export const TEXT_IN_BOX_ALIGN_OPTIONS = [
  { value: 'left-top', label: 'Top — Left', textAlign: 'left', textVerticalAlign: 'top' },
  { value: 'center-top', label: 'Top — Center', textAlign: 'center', textVerticalAlign: 'top' },
  { value: 'right-top', label: 'Top — Right', textAlign: 'right', textVerticalAlign: 'top' },
  { value: 'left-center', label: 'Middle — Left', textAlign: 'left', textVerticalAlign: 'center' },
  { value: 'center-center', label: 'Middle — Center', textAlign: 'center', textVerticalAlign: 'center' },
  { value: 'right-center', label: 'Middle — Right', textAlign: 'right', textVerticalAlign: 'center' },
  { value: 'left-bottom', label: 'Bottom — Left', textAlign: 'left', textVerticalAlign: 'bottom' },
  { value: 'center-bottom', label: 'Bottom — Center', textAlign: 'center', textVerticalAlign: 'bottom' },
  { value: 'right-bottom', label: 'Bottom — Right', textAlign: 'right', textVerticalAlign: 'bottom' },
];

export function getTextInBoxAlignKey(el) {
  if (el?.type !== 'text') return 'left-top';
  const h = normalizeTextAlignInBox(el);
  const v = normalizeTextVerticalAlignInBox(el);
  const opt = TEXT_IN_BOX_ALIGN_OPTIONS.find((o) => o.textAlign === h && o.textVerticalAlign === v);
  return opt?.value ?? 'left-top';
}

function minHeightPercentForTextVerticalAlign(el) {
  if (el?.type !== 'text') return undefined;
  const v = normalizeTextVerticalAlignInBox(el);
  if (v === 'top') return undefined;
  if (typeof el.height === 'number' && el.height > 0) return el.height;
  return 8;
}

/**
 * Flex layout for the text box outer + full-width inner (horizontal alignment via text-align).
 * Editor canvas and IdCardRenderer must pass both onto matching DOM nodes.
 */
export function getTextBoxLayoutStyles(el) {
  if (el?.type !== 'text') return { container: {}, content: {} };
  const v = normalizeTextVerticalAlignInBox(el);
  const h = normalizeTextAlignInBox(el);
  const justifyContent = v === 'center' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
  const minH = minHeightPercentForTextVerticalAlign(el);
  return {
    container: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent,
      ...(minH != null ? { minHeight: `${minH}%` } : {}),
    },
    content: {
      width: '100%',
      minWidth: 0,
      textAlign: h,
    },
  };
}
