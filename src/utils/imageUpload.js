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
