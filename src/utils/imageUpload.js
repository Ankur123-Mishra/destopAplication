const MAX_UPLOAD_DIM = 1200;
const UPLOAD_JPEG_QUALITY = 0.82;

/** Resize/compress image so upload stays under server limit (avoids 413). Returns a new File (JPEG). */
export function compressImageForUpload(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (w <= MAX_UPLOAD_DIM && h <= MAX_UPLOAD_DIM && file.size <= 800 * 1024) {
        resolve(file);
        return;
      }
      if (w > MAX_UPLOAD_DIM || h > MAX_UPLOAD_DIM) {
        if (w > h) {
          h = Math.round((h * MAX_UPLOAD_DIM) / w);
          w = MAX_UPLOAD_DIM;
        } else {
          w = Math.round((w * MAX_UPLOAD_DIM) / h);
          h = MAX_UPLOAD_DIM;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const name = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        UPLOAD_JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Invalid image'));
    };
    img.src = url;
  });
}

/**
 * API student object → string used to match folder filenames (photoNo, else admissionNo / rollNo / uniqueCode).
 */
export function studentPhotoMatchKey(s) {
  if (s == null) return '—';
  const p = s.photoNo;
  if (p != null && String(p).trim() !== '') return String(p).trim();
  return String(s.admissionNo || s.rollNo || s.uniqueCode || '—').trim();
}

/**
 * Register an image file under basename keys so e.g. 240_cropped.png matches student photoNo "240".
 */
const IMAGE_FILENAME_EXT = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i;

export function addPhotoFileToMap(fileMap, file) {
  const looksLikeImage =
    file?.type?.startsWith('image/') || IMAGE_FILENAME_EXT.test(file?.name || '');
  if (!looksLikeImage) return;
  const baseName = (file.name || '').split(/[/\\]/).pop() || file.name || '';
  const nameWithoutExt = baseName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
  if (!nameWithoutExt) return;
  fileMap[nameWithoutExt] = file;
  const withoutCropped = nameWithoutExt.replace(/_cropped$/i, '');
  if (withoutCropped && withoutCropped !== nameWithoutExt) {
    fileMap[withoutCropped] = file;
  }
}
