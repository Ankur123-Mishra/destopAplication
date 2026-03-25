import { API_BASE_URL, PUBLIC_PARENT_ORIGIN } from './config';
import { getToken } from './authStorage';

function authHeaders() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

function authHeadersForBlob() {
  const token = getToken();
  return {
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

async function parseJsonOrThrow(res, fallbackMessage) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || fallbackMessage;
    throw new Error(msg);
  }
  return data;
}

export function getParentCollectionEnabled() {
  return fetch(`${API_BASE_URL}/api/photographer/parent-collection/enabled`, {
    method: 'GET',
    headers: authHeaders(),
  }).then((res) => parseJsonOrThrow(res, 'Failed to load parent-form status'));
}

export function getAssignedSchoolsForCollection() {
  return fetch(`${API_BASE_URL}/api/photographer/schools/assigned`, {
    method: 'GET',
    headers: authHeaders(),
  }).then((res) => parseJsonOrThrow(res, 'Failed to load assigned schools'));
}

export function getSchoolDetailsForCollection(schoolId) {
  return fetch(`${API_BASE_URL}/api/photographer/schools/${schoolId}/details`, {
    method: 'GET',
    headers: authHeaders(),
  }).then((res) => parseJsonOrThrow(res, 'Failed to load school details'));
}

export function createCollectionLink(body) {
  return fetch(`${API_BASE_URL}/api/photographer/collection-links`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  }).then((res) => parseJsonOrThrow(res, 'Failed to create link'));
}

export function listCollectionLinks(filters = {}) {
  const params = new URLSearchParams();
  if (filters.schoolId) params.set('schoolId', filters.schoolId);
  if (filters.classId) params.set('classId', filters.classId);
  const query = params.toString();

  return fetch(`${API_BASE_URL}/api/photographer/collection-links${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: authHeaders(),
  }).then((res) => parseJsonOrThrow(res, 'Failed to load links'));
}

export function revokeCollectionLink(token) {
  return fetch(`${API_BASE_URL}/api/photographer/collection-links/${encodeURIComponent(token)}/revoke`, {
    method: 'PATCH',
    headers: authHeaders(),
  }).then((res) => parseJsonOrThrow(res, 'Failed to revoke link'));
}

export function listCollectionSubmissions(filters = {}) {
  const params = new URLSearchParams();
  if (filters.schoolId) params.set('schoolId', filters.schoolId);
  if (filters.classId) params.set('classId', filters.classId);
  if (filters.className) params.set('className', filters.className);
  if (filters.section) params.set('section', filters.section);
  const query = params.toString();

  return fetch(`${API_BASE_URL}/api/photographer/collection-submissions${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: authHeaders(),
  }).then((res) => parseJsonOrThrow(res, 'Failed to load submissions'));
}

export async function exportCollectionSubmissions(filters = {}) {
  const params = new URLSearchParams();
  if (filters.schoolId) params.set('schoolId', filters.schoolId);
  if (filters.classId) params.set('classId', filters.classId);
  if (filters.className) params.set('className', filters.className);
  if (filters.section) params.set('section', filters.section);
  const query = params.toString();

  const res = await fetch(
    `${API_BASE_URL}/api/photographer/collection-submissions/export${query ? `?${query}` : ''}`,
    {
      method: 'GET',
      headers: authHeadersForBlob(),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    try {
      const data = JSON.parse(text);
      throw new Error(data?.message || 'Failed to export submissions');
    } catch {
      throw new Error(text || 'Failed to export submissions');
    }
  }

  return res.blob();
}

export function getPublicParentOrigin() {
  if (PUBLIC_PARENT_ORIGIN) return PUBLIC_PARENT_ORIGIN;

  try {
    const apiUrl = new URL("http://72.61.240.84:8080");
    const localHosts = new Set(['localhost', '127.0.0.1']);

    // Local development: suite frontend runs on Vite port 8080.
    if (localHosts.has(apiUrl.hostname) && apiUrl.port === '5000') {
      return `${apiUrl.protocol}//${apiUrl.hostname}:8080`;
    }

    // Common production shape: https://host/.../api -> https://host/...
    if (apiUrl.pathname.endsWith('/api')) {
      const trimmedPath = apiUrl.pathname.replace(/\/api\/?$/, '');
      return `${apiUrl.origin}${trimmedPath}`.replace(/\/+$/, '');
    }

    return apiUrl.origin;
  } catch {
    return API_BASE_URL.replace(/\/api\/?$/, '');
  }
}

export function isPublicParentOriginConfigured() {
  return Boolean(PUBLIC_PARENT_ORIGIN);
}

export function buildParentCollectionLink(token) {
  const base = getPublicParentOrigin();
  console.log('base', base);
  return `${base}/c/${token}`;
}
