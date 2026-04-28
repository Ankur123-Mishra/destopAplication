import { API_BASE_URL } from '../api/config';

function toFullPhotoUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http') || url.startsWith('blob:')) return url;
  if (url.startsWith('data:')) return url;
  const base = API_BASE_URL.replace(/\/$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

/** schoolId (API _id) → Map(studentId → display url: blob: or https) */
const previewBySchool = new Map();

/** House / color-badge PNG — same immediate-blob pattern as student photos (Dexie write can lag). */
const colorPreviewBySchool = new Map();

const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

export function subscribeProjectBulkPhotoPreview(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProjectBulkPreviewUrl(schoolId, studentId) {
  if (!schoolId || !studentId) return null;
  return previewBySchool.get(schoolId)?.get(studentId) ?? null;
}

export function getProjectBulkColorCodePreviewUrl(schoolId, studentId) {
  if (!schoolId || !studentId) return null;
  return colorPreviewBySchool.get(schoolId)?.get(studentId) ?? null;
}

/**
 * Register local file previews for many students (one notify).
 * @param {string} schoolId
 * @param {{ studentId: string, file: File }[]} pairs
 */
export function registerProjectBulkLocalPreviews(schoolId, pairs) {
  if (!schoolId || !pairs?.length) return;
  let schoolMap = previewBySchool.get(schoolId);
  if (!schoolMap) {
    schoolMap = new Map();
    previewBySchool.set(schoolId, schoolMap);
  }
  for (const { studentId, file } of pairs) {
    if (!studentId || !file) continue;
    const url = URL.createObjectURL(file);
    const prev = schoolMap.get(studentId);
    if (typeof prev === 'string' && prev.startsWith('blob:')) {
      URL.revokeObjectURL(prev);
    }
    schoolMap.set(studentId, url);
  }
  notify();
}

/**
 * Register blob previews for color/house PNG files from project folder (parallel to student photos).
 */
export function registerProjectBulkLocalColorPreviews(schoolId, pairs) {
  if (!schoolId || !pairs?.length) return;
  let schoolMap = colorPreviewBySchool.get(schoolId);
  if (!schoolMap) {
    schoolMap = new Map();
    colorPreviewBySchool.set(schoolId, schoolMap);
  }
  for (const { studentId, file } of pairs) {
    if (!studentId || !file) continue;
    const url = URL.createObjectURL(file);
    const prev = schoolMap.get(studentId);
    if (typeof prev === 'string' && prev.startsWith('blob:')) {
      URL.revokeObjectURL(prev);
    }
    schoolMap.set(studentId, url);
  }
  notify();
}

/** After color PNG is stored locally (data URL), replace blob preview. */
export function setProjectBulkColorPreviewServerUrl(schoolId, studentId, dataUrl) {
  if (!schoolId || !studentId || !dataUrl) return;
  let schoolMap = colorPreviewBySchool.get(schoolId);
  if (!schoolMap) {
    schoolMap = new Map();
    colorPreviewBySchool.set(schoolId, schoolMap);
  }
  const prev = schoolMap.get(studentId);
  if (typeof prev === 'string' && prev.startsWith('blob:')) {
    URL.revokeObjectURL(prev);
  }
  schoolMap.set(studentId, toFullPhotoUrl(dataUrl));
  notify();
}

/** After a single upload succeeds — replace blob with server URL and revoke blob. */
export function setProjectBulkPreviewServerUrl(schoolId, studentId, photoUrlFromApi) {
  if (!schoolId || !studentId || !photoUrlFromApi) return;
  let schoolMap = previewBySchool.get(schoolId);
  if (!schoolMap) {
    schoolMap = new Map();
    previewBySchool.set(schoolId, schoolMap);
  }
  const prev = schoolMap.get(studentId);
  if (typeof prev === 'string' && prev.startsWith('blob:')) {
    URL.revokeObjectURL(prev);
  }
  schoolMap.set(studentId, toFullPhotoUrl(photoUrlFromApi));
  notify();
}

export function revokeProjectBulkPreviewsForSchool(schoolId) {
  const schoolMap = previewBySchool.get(schoolId);
  if (schoolMap) {
    for (const url of schoolMap.values()) {
      if (typeof url === 'string' && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
    previewBySchool.delete(schoolId);
  }
  const colorMap = colorPreviewBySchool.get(schoolId);
  if (colorMap) {
    for (const url of colorMap.values()) {
      if (typeof url === 'string' && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
    colorPreviewBySchool.delete(schoolId);
  }
  notify();
}
