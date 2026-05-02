const STORAGE_KEY = 'uploadedIdCardTemplates';

/** Avoid parsing localStorage on every getUploadedTemplateById (preview renders many cards). */
let uploadedTemplatesCache = null;

export function getUploadedTemplates() {
  if (uploadedTemplatesCache) return uploadedTemplatesCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      uploadedTemplatesCache = { nextId: 1, templates: [] };
      return uploadedTemplatesCache;
    }
    const data = JSON.parse(raw);
    uploadedTemplatesCache = {
      nextId: data.nextId ?? 1,
      templates: data.templates ?? [],
    };
    return uploadedTemplatesCache;
  } catch {
    uploadedTemplatesCache = { nextId: 1, templates: [] };
    return uploadedTemplatesCache;
  }
}

export function saveUploadedTemplate({
  id = null,
  name,
  frontImage,
  backImage,
  elements,
  /** Layout for back face when front/back are separate (same shape as `elements`). */
  backElements,
  schoolId = null,
}) {
  const data = getUploadedTemplates();
  const template = {
    id: id ?? `uploaded-${data.nextId}`,
    name: name || 'Uploaded Template',
    frontImage: frontImage || null,
    backImage: backImage || null,
    elements: elements || [],
    ...(Array.isArray(backElements) ? { backElements } : {}),
    ...(schoolId != null && schoolId !== '' ? { schoolId } : {}),
  };
  if (id) {
    const idx = data.templates.findIndex((t) => t.id === id);
    if (idx >= 0) data.templates[idx] = template;
    else data.templates.push(template);
  } else {
    template.id = `uploaded-${data.nextId}`;
    data.templates.push(template);
    data.nextId += 1;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  uploadedTemplatesCache = data;
  return template.id;
}

export function getUploadedTemplateById(id) {
  const { templates } = getUploadedTemplates();
  return templates.find((t) => t.id === id) || null;
}

export function deleteUploadedTemplate(id) {
  const data = getUploadedTemplates();
  data.templates = data.templates.filter((t) => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  uploadedTemplatesCache = data;
}
