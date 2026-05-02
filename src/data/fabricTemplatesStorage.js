const STORAGE_KEY = 'fabricIdCardTemplates';

/** Avoid parsing localStorage on every getFabricTemplateById (preview grids call it per card). */
let fabricTemplatesCache = null;

export function getFabricTemplates() {
  if (fabricTemplatesCache) return fabricTemplatesCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      fabricTemplatesCache = { nextId: 1, templates: [] };
      return fabricTemplatesCache;
    }
    const data = JSON.parse(raw);
    fabricTemplatesCache = {
      nextId: data.nextId ?? 1,
      templates: data.templates ?? [],
    };
    return fabricTemplatesCache;
  } catch {
    fabricTemplatesCache = { nextId: 1, templates: [] };
    return fabricTemplatesCache;
  }
}

export function saveFabricTemplate({ id = null, name, json, backgroundDataUrl }) {
  const data = getFabricTemplates();
  const template = { id: id ?? `fabric-${data.nextId}`, name, json, backgroundDataUrl: backgroundDataUrl || null };
  if (id) {
    const idx = data.templates.findIndex((t) => t.id === id);
    if (idx >= 0) data.templates[idx] = template;
    else data.templates.push(template);
  } else {
    template.id = `fabric-${data.nextId}`;
    data.templates.push(template);
    data.nextId += 1;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  fabricTemplatesCache = data;
  return template.id;
}

export function getFabricTemplateById(id) {
  const { templates } = getFabricTemplates();
  return templates.find((t) => t.id === id) || null;
}

export function deleteFabricTemplate(id) {
  const data = getFabricTemplates();
  data.templates = data.templates.filter((t) => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  fabricTemplatesCache = data;
}
