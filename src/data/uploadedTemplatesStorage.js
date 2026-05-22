import { db } from './db';

/** Legacy key — migrated once into Dexie, then removed to free quota. */
const LEGACY_LOCAL_STORAGE_KEY = 'uploadedIdCardTemplates';
const BUNDLE_ROW_ID = 'default';

/** Avoid re-reading IndexedDB on every getUploadedTemplateById (preview renders many cards). */
let uploadedTemplatesCache = null;

let readyPromise = null;

function emptyBundle() {
  return { nextId: 1, templates: [] };
}

/**
 * Load uploaded-template bundle from IndexedDB (and migrate from localStorage once).
 * Call from app bootstrap before rendering so synchronous getters see real data.
 */
export async function ensureUploadedTemplatesReady() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    try {
      await db.open();
      let row = await db.uploadedTemplatesBundle.get(BUNDLE_ROW_ID);
      if (!row) {
        try {
          const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
          if (raw) {
            const data = JSON.parse(raw);
            row = {
              id: BUNDLE_ROW_ID,
              nextId: data.nextId ?? 1,
              templates: Array.isArray(data.templates) ? data.templates : [],
            };
            await db.uploadedTemplatesBundle.put(row);
            try {
              localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore corrupt legacy */
        }
      }
      if (row && row.id === BUNDLE_ROW_ID) {
        uploadedTemplatesCache = {
          nextId: row.nextId ?? 1,
          templates: row.templates ?? [],
        };
      } else {
        uploadedTemplatesCache = emptyBundle();
      }
    } catch (e) {
      console.error('uploadedTemplatesStorage: failed to load bundle', e);
      uploadedTemplatesCache = emptyBundle();
    }
  })();
  return readyPromise;
}

async function persistBundle() {
  if (!uploadedTemplatesCache) return;
  await db.uploadedTemplatesBundle.put({
    id: BUNDLE_ROW_ID,
    nextId: uploadedTemplatesCache.nextId,
    templates: uploadedTemplatesCache.templates,
  });
}

export function getUploadedTemplates() {
  return uploadedTemplatesCache ?? emptyBundle();
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
  await ensureUploadedTemplatesReady();
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
  try {
    await persistBundle();
  } catch (e) {
    const msg = e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '')
      ? 'Storage is full. Free some browser storage or remove old uploaded templates and try again.'
      : e?.message || 'Failed to save uploaded template.';
    throw new Error(msg);
  }
  uploadedTemplatesCache = data;
  return template.id;
}

export function getUploadedTemplateById(id) {
  const { templates } = getUploadedTemplates();
  return templates.find((t) => t.id === id) || null;
}

export async function deleteUploadedTemplate(id) {
  await ensureUploadedTemplatesReady();
  const data = getUploadedTemplates();
  data.templates = data.templates.filter((t) => t.id !== id);
  await persistBundle();
  uploadedTemplatesCache = data;
}
