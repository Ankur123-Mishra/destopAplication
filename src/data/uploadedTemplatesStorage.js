const STORAGE_KEY = 'uploadedIdCardTemplates';

export function getUploadedTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nextId: 1, templates: [] };
    const data = JSON.parse(raw);
    return { nextId: data.nextId ?? 1, templates: data.templates ?? [] };
  } catch {
    return { nextId: 1, templates: [] };
  }
}

export function saveUploadedTemplate({ id = null, name, frontImage, backImage, elements }) {
  const data = getUploadedTemplates();
  const template = {
    id: id ?? `uploaded-${data.nextId}`,
    name: name || 'Uploaded Template',
    frontImage: frontImage || null,
    backImage: backImage || null,
    elements: elements || [],
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
}
