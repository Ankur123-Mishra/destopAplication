const STORAGE_KEY = 'fabricIdCardTemplates';

export function getFabricTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nextId: 1, templates: [] };
    const data = JSON.parse(raw);
    return { nextId: data.nextId ?? 1, templates: data.templates ?? [] };
  } catch {
    return { nextId: 1, templates: [] };
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
}
