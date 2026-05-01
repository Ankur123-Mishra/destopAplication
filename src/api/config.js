/**
 * API base URL - aage aur endpoints isi base se add karenge.
 * Parent-form public links should point to the deployed web app, not Electron.
 */
// export const API_BASE_URL = 'http://45.194.116.147/print-api';
// export const API_BASE_URL = 'https://slect.in/print-api/';
// export const API_BASE_URL = 'http://72.61.240.84:5050';
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
export const PUBLIC_PARENT_ORIGIN = String(import.meta.env.VITE_PUBLIC_PARENT_ORIGIN || '')
  .trim()
  .replace(/\/+$/, '');
