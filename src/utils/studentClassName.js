/** Strip erroneous trailing unicode en-dash "– A" from bad imports (not hyphenated grades like "1-A"). */
export function normalizeClassNameForDisplay(label) {
  if (!label || typeof label !== 'string') return label;
  return label.replace(/\s*–\s*A\s*$/i, '').trim();
}

/** Class + section for ID card preview without duplicating section or a stray leading " - …". */
export function formatStudentClassForIdCard(cls) {
  if (!cls) return '';
  const name = String(cls.className ?? '').trim();
  const sec = String(cls.section ?? '').trim();
  if (!name && !sec) return '';
  let combined;
  if (name && sec) {
    const nl = name.toLowerCase();
    const sl = sec.toLowerCase();
    const alreadyHasSection =
      nl.endsWith(`-${sl}`) ||
      nl.endsWith(` - ${sl}`) ||
      nl.endsWith(` ${sl}`);
    combined = alreadyHasSection ? name : `${name} - ${sec}`;
  } else {
    combined = name || sec;
  }
  return combined;
}

function classIdStringFromStudent(student) {
  if (!student || typeof student !== 'object') return '';
  if (typeof student.classId === 'string' && student.classId.trim()) {
    return student.classId.trim();
  }
  if (student.classId && typeof student.classId === 'object') {
    const id = student.classId._id ?? student.classId.id;
    if (id != null && String(id).trim()) return String(id).trim();
  }
  return '';
}

/**
 * Resolved class label for ID card canvas (preview / print).
 * Prefer row-level `student.className` (Excel "Class" column, e.g. "Class - L KG - A"),
 * then populated class/classId objects, then school classes list lookup by id.
 */
export function resolveClassNameForIdCard(student, classesList) {
  if (!student || typeof student !== 'object') return '';

  if (typeof student.className === 'string' && student.className.trim() !== '') {
    return student.className.trim();
  }

  if (student.class && typeof student.class === 'object') {
    const fromClass = formatStudentClassForIdCard(student.class);
    if (fromClass) return fromClass;
  }

  if (student.classId && typeof student.classId === 'object') {
    const fromClassId = formatStudentClassForIdCard(student.classId);
    if (fromClassId) return fromClassId;
  }

  const classIdStr = classIdStringFromStudent(student);
  if (classIdStr && Array.isArray(classesList)) {
    const cls = classesList.find(
      (c) => c && (String(c._id) === classIdStr || String(c.id) === classIdStr),
    );
    const fromLookup = formatStudentClassForIdCard(cls);
    if (fromLookup) return fromLookup;
  }

  const ex =
    student.extraFields && typeof student.extraFields === 'object'
      ? student.extraFields
      : null;
  if (ex) {
    for (const key of ['className', 'class', 'Class', 'STD', 'std', 'course', 'courseName']) {
      const v = ex[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }

  return formatStudentClassForIdCard(student.class);
}
