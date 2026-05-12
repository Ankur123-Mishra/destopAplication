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
 * Replace heavy `photoUrl` / color-badge URLs (`colorCodeImageUrl`, `colorCodePhotoUrl`) with flags
 * so list screens stay under memory limits. Preview / print load full rows on demand
 * ({@link retainPhotos} on API helpers).
 */
export function stripStudentRowMediaForListView(s) {
  if (!s || typeof s !== "object") return s;
  const photoRaw = s.photoUrl;
  const cuImg =
    typeof s.colorCodeImageUrl === "string" ? s.colorCodeImageUrl.trim() : "";
  const cuPhoto =
    typeof s.colorCodePhotoUrl === "string" ? s.colorCodePhotoUrl.trim() : "";
  const hasPhoto = typeof photoRaw === "string" && photoRaw.trim() !== "";
  const hasColorCodeImage = cuImg !== "" || cuPhoto !== "";
  const stripPhoto = hasPhoto && isHeavyInlineMediaUrl(photoRaw);
  const stripColorImg =
    cuImg !== "" && isHeavyInlineMediaUrl(s.colorCodeImageUrl);
  const stripColorPhoto =
    cuPhoto !== "" && isHeavyInlineMediaUrl(s.colorCodePhotoUrl);
  if (!stripPhoto && !stripColorImg && !stripColorPhoto) {
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
  if (stripColorImg) delete next.colorCodeImageUrl;
  if (stripColorPhoto) delete next.colorCodePhotoUrl;
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

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Resolve API/template quirks (`image` vs `frontImage`, snake_case, JSON strings) and validate the
 * shape SavedIdCardsList / ClassIdCardsWizard require for canvas preview (`frontImage` + elements).
 */
function normalizePhotographerCanvasTemplate(t) {
  if (!t || typeof t !== 'object') return null;
  const frontCandidate =
    t.frontImage ??
    t.image ??
    t.front_image ??
    t.templateImageUrl;
  const frontImage =
    typeof frontCandidate === 'string' && frontCandidate.trim() !== ''
      ? frontCandidate.trim()
      : null;

  let elements = t.elements;
  if (typeof elements === 'string') {
    try {
      const parsed = JSON.parse(elements);
      if (Array.isArray(parsed)) elements = parsed;
    } catch {
      /* ignore */
    }
  }

  if (!frontImage || !Array.isArray(elements) || elements.length === 0) {
    return null;
  }

  const backCandidate = t.backImage ?? t.back_image ?? null;
  const backImage =
    typeof backCandidate === 'string' && backCandidate.trim() !== ''
      ? backCandidate.trim()
      : null;

  let backElements = t.backElements;
  const parsedBack = parseMaybeJsonArray(backElements);
  if (parsedBack) backElements = parsedBack;

  const base = {
    ...t,
    frontImage,
    elements,
  };
  if (backImage) base.backImage = backImage;
  if (Array.isArray(backElements) && backElements.length > 0) {
    base.backElements = backElements;
  }
  return base;
}

/**
 * Some backends repeat full canvas art on every student row but send only metadata on the root
 * `template`. We strip row artwork for memory — promote one full row onto the root before slimming
 * so preview/merge logic still sees {@link normalizePhotographerCanvasTemplate a renderable layout}.
 */
function resolveEffectiveRootTemplate(data) {
  const fromRoot = normalizePhotographerCanvasTemplate(data.template);
  if (fromRoot) return fromRoot;

  const students = data.students;
  const meta =
    data.template && typeof data.template === 'object' ? data.template : {};
  if (!Array.isArray(students)) {
    return data.template ?? null;
  }
  for (const s of students) {
    const cand = normalizePhotographerCanvasTemplate(s?.template);
    if (cand) {
      return { ...meta, ...cand };
    }
  }
  return data.template ?? null;
}

/**
 * Apply {@link slimStudentTemplateField} and optional {@link stripStudentRowMediaForListView}.
 */
export function slimStudentsPayloadForClient(data, options = {}) {
  const { stripInlinePhotos = true } = options;
  if (!data || typeof data !== 'object' || !Array.isArray(data.students)) return data;

  const effectiveRootTemplate = resolveEffectiveRootTemplate(data);

  return {
    ...data,
    ...(effectiveRootTemplate != null ? { template: effectiveRootTemplate } : {}),
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
