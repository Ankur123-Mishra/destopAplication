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

/** Apply {@link slimStudentTemplateField} to each row in an API payload with `students[]`. */
export function slimStudentsPayloadForClient(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.students)) return data;
  return {
    ...data,
    students: data.students.map((s) => {
      if (!s?.template) return s;
      const slim = slimStudentTemplateField(s.template);
      return { ...s, template: slim };
    }),
  };
}
