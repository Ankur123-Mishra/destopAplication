export const ID_CARD_TEMPLATES = [
  { id: 'navy-design', name: 'School Card (Navy)', description: 'Image, School, Class, Address', image: null },
  { id: 'green-design', name: 'School Card (Green)', description: 'Image, School, Class, Address', image: null },
  { id: 'maroon-design', name: 'School Card (Maroon)', description: 'Image, School, Class, Address', image: null },
  { id: 'cambridge-design', name: 'School Card (Cambridge)', description: 'Yellow bands, diagonal, logo, icons, Principal', image: null },
  { id: 'elegant-blue-design', name: 'School Card (Elegant Blue)', description: 'Image, School, Class, Address', image: null },
];

/** Template IDs that use school logo, signature, and address fields */
export const SCHOOL_CARD_TEMPLATE_IDS = ['navy-design', 'green-design', 'maroon-design', 'cambridge-design', 'elegant-blue-design'];

/** Map internal template id to API template id (same as mobile: template-navy, template-green, template-maroon) */
const INTERNAL_TO_API_TEMPLATE_ID = {
  'navy-design': 'template-navy',
  'green-design': 'template-green',
  'maroon-design': 'template-maroon',
  'cambridge-design': 'template-cambridge',
  'elegant-blue-design': 'template-elegant-blue',
};

export function getApiTemplateId(internalId) {
  return INTERNAL_TO_API_TEMPLATE_ID[internalId] ?? internalId;
}

/** Map API template id (template-navy, etc.) to internal id (navy-design) for rendering */
const API_TO_INTERNAL_TEMPLATE_ID = {
  'template-navy': 'navy-design',
  'template-green': 'green-design',
  'template-maroon': 'maroon-design',
  'template-cambridge': 'cambridge-design',
  'template-elegant-blue': 'elegant-blue-design',
};

export function getInternalTemplateId(apiId) {
  return API_TO_INTERNAL_TEMPLATE_ID[apiId] ?? apiId;
}

export function getTemplateById(id) {
  return ID_CARD_TEMPLATES.find((t) => t.id === id) || null;
}
