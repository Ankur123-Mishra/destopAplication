/**
 * Inline / huge photo strings (offline data URLs, blob refs) on thousands of rows blow Electron
 * renderer memory once held in React state. Short http(s) URLs are kept for online lists.
 */
function isHeavyInlineMediaUrl(url) {
  if (typeof url !== "string") return false;
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith("data:") || u.startsWith("blob:")) return true;
  return u.length > 4096;
}

/**
 * Replace heavy `photoUrl` / `colorCodeImageUrl` with flags so list screens stay under memory
 * limits. Preview / print load full rows on demand ({@link retainPhotos} on API helpers).
 */
export function stripStudentRowMediaForListView(s) {
  if (!s || typeof s !== "object") return s;
  const photoRaw = s.photoUrl;
  const colorRaw = s.colorCodeImageUrl;
  const hasPhoto = typeof photoRaw === "string" && photoRaw.trim() !== "";
  const hasColorCodeImage =
    typeof colorRaw === "string" && colorRaw.trim() !== "";
  const stripPhoto = hasPhoto && isHeavyInlineMediaUrl(photoRaw);
  const stripColor = hasColorCodeImage && isHeavyInlineMediaUrl(colorRaw);
  if (!stripPhoto && !stripColor) {
    return {
      ...s,
      ...(hasPhoto ? { hasPhoto: true } : { hasPhoto: false }),
      ...(hasColorCodeImage
        ? { hasColorCodeImage: true }
        : { hasColorCodeImage: false }),
    };
  }
  const next = {
    ...s,
    hasPhoto,
    hasColorCodeImage,
  };
  if (stripPhoto) next.photoUrl = "";
  if (stripColor) delete next.colorCodeImageUrl;
  return next;
}

/**
 * Strip embedded canvas artwork from a per-student `template` object. List responses include a
 * single root `template` with shared images — keeping base64 on every row duplicates memory.
 */
export function slimStudentTemplateField(t) {
  if (!t || typeof t !== 'object') return t;
  if (!t.frontImage && !t.backImage) return t;
  const { frontImage, backImage, ...rest } = t;
  return Object.keys(rest).length ? rest : undefined;
}

/**
 * Apply {@link slimStudentTemplateField} and optional {@link stripStudentRowMediaForListView}.
 */
export function slimStudentsPayloadForClient(data, options = {}) {
  const { stripInlinePhotos = true } = options;
  if (!data || typeof data !== 'object' || !Array.isArray(data.students)) return data;
  return {
    ...data,
    students: data.students.map((s) => {
      let row = { ...s };
      if (s?.template) {
        row.template = slimStudentTemplateField(s.template);
      }
      if (stripInlinePhotos) {
        row = stripStudentRowMediaForListView(row);
      }
      return row;
    }),
  };
}
