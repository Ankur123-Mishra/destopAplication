import { db } from './db';

const LEGACY_STORAGE_KEY = 'uploadedIdCardTemplates';

/** In-memory mirror of Dexie table — keeps existing sync getters working after hydrate. */
let memory = {
  nextId: 1,
  templates: [],
  hydrated: false,
};

let hydratePromise = null;

function computeNextId(templates) {
  let max = 0;
  for (const t of templates) {
    const m = /^uploaded-(\d+)$/.exec(String(t?.id || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function normalizeSchoolIdForStore(schoolId) {
  if (schoolId == null || schoolId === '') return '';
  return String(schoolId);
}

function rowToTemplate(row) {
  if (!row?.id) return null;
  const t = {
    id: row.id,
    name: row.name || 'Uploaded Template',
    frontImage: row.frontImage ?? null,
    backImage: row.backImage ?? null,
    elements: Array.isArray(row.elements) ? row.elements : [],
  };
  if (Array.isArray(row.backElements)) t.backElements = row.backElements;
  const sid = row.schoolId;
  if (sid != null && sid !== '') t.schoolId = sid;
  return t;
}

function templateToRow(template) {
  const row = {
    id: template.id,
    name: template.name || 'Uploaded Template',
    frontImage: template.frontImage ?? null,
    backImage: template.backImage ?? null,
    elements: Array.isArray(template.elements) ? template.elements : [],
    schoolId: normalizeSchoolIdForStore(template.schoolId),
  };
  if (Array.isArray(template.backElements)) row.backElements = template.backElements;
  return row;
}

async function migrateLegacyFromLocalStorage() {
  if (typeof localStorage === 'undefined') return;
  let raw;
  try {
    raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    const templates = data.templates ?? [];
    if (!Array.isArray(templates) || templates.length === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    const rows = templates.map((t) =>
      templateToRow({
        id: t.id,
        name: t.name,
        frontImage: t.frontImage,
        backImage: t.backImage,
        elements: t.elements,
        ...(Array.isArray(t.backElements) ? { backElements: t.backElements } : {}),
        schoolId: t.schoolId,
      }),
    );
    await db.uploadedIdCardTemplates.bulkPut(rows);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (e) {
    console.warn('uploadedIdCardTemplates legacy migration failed', e);
  }
}

/**
 * Load uploaded templates from IndexedDB (and migrate legacy localStorage once).
 * Call once before React render so sync getters see data (see main.jsx).
 */
export async function hydrateUploadedTemplatesCache() {
  if (memory.hydrated) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      await migrateLegacyFromLocalStorage();
      const rows = await db.uploadedIdCardTemplates.toArray();
      memory.templates = rows.map(rowToTemplate).filter(Boolean);
      memory.nextId = computeNextId(memory.templates);
    } catch (e) {
      console.error('hydrateUploadedTemplatesCache failed', e);
      memory.templates = [];
      memory.nextId = 1;
    } finally {
      memory.hydrated = true;
    }
  })();

  return hydratePromise;
}

export function getUploadedTemplates() {
  try {
    if (!memory.hydrated) {
      return { nextId: 1, templates: [] };
    }
    return {
      nextId: memory.nextId,
      templates: memory.templates.map((t) => ({ ...t })),
    };
  } catch {
    return { nextId: 1, templates: [] };
  }
}

export async function saveUploadedTemplate({
  id = null,
  name,
  frontImage,
  backImage,
  elements,
  /** Layout for back face when front/back are separate (same shape as `elements`). */
  backElements,
  schoolId = null,
}) {
  await hydrateUploadedTemplatesCache();

  const template = {
    id: id ?? `uploaded-${memory.nextId}`,
    name: name || 'Uploaded Template',
    frontImage: frontImage || null,
    backImage: backImage || null,
    elements: elements || [],
    ...(Array.isArray(backElements) ? { backElements } : {}),
    ...(schoolId != null && schoolId !== '' ? { schoolId } : {}),
  };

  if (id) {
    const idx = memory.templates.findIndex((t) => t.id === id);
    if (idx >= 0) memory.templates[idx] = template;
    else memory.templates.push(template);
  } else {
    template.id = `uploaded-${memory.nextId}`;
    memory.nextId += 1;
    memory.templates.push(template);
  }

  await db.uploadedIdCardTemplates.put(templateToRow(template));
  return template.id;
}

export function getUploadedTemplateById(id) {
  const { templates } = getUploadedTemplates();
  return templates.find((t) => t.id === id) || null;
}

export async function deleteUploadedTemplate(id) {
  await hydrateUploadedTemplatesCache();
  memory.templates = memory.templates.filter((t) => t.id !== id);
  await db.uploadedIdCardTemplates.delete(id);
}
