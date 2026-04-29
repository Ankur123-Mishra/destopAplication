/**
 * Photographer dashboard APIs - original online authenticated calls
 */
import { API_BASE_URL } from "./config";
import { getToken } from "./authStorage";
import { sortStudentsByExcelRowOrder } from "../utils/studentListOrder";
import { slimStudentsPayloadForClient } from "../utils/slimStudentTemplateForClient";

function authHeaders() {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

function authHeadersForm() {
  const token = getToken();
  return {
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

export async function getDashboard() {
  const res = await fetch(`${API_BASE_URL}/api/photographer/dashboard`, {
    method: "GET",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || res.statusText || "Failed");
  return data;
}

export async function getAssignedSchools() {
  const res = await fetch(`${API_BASE_URL}/api/photographer/schools/assigned`, {
    method: "GET",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || res.statusText || "Failed");
  return data;
}

export async function deletePhotographerSchool(schoolId) {
  const res = await fetch(`${API_BASE_URL}/api/photographer/schools/${encodeURIComponent(schoolId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || res.statusText || "Failed to delete school");
  return data;
}

export async function getClassesBySchool(schoolId) {
  const res = await fetch(`${API_BASE_URL}/api/photographer/classes/${schoolId}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || 'Failed to load classes';
    throw new Error(msg);
  }
  return data;
}

export async function getStudentsBySchoolAndClass(schoolId, classId, options = {}) {
  const retainPhotos = options.retainPhotos !== false;
  const params = new URLSearchParams({ schoolId, classId });
  const res = await fetch(`${API_BASE_URL}/api/photographer/students?${params}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || 'Failed to load students';
    throw new Error(msg);
  }
  return slimStudentsPayloadForClient(
    {
      ...data,
      students: sortStudentsByExcelRowOrder(data.students ?? []),
    },
    { stripInlinePhotos: !retainPhotos },
  );
}

export async function updateStudent(studentId, data) {
  const res = await fetch(`${API_BASE_URL}/api/photographer/students/${studentId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data)
  });
  const resData = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = resData?.message || resData?.error || res.statusText || 'Failed to update student';
    throw new Error(msg);
  }
  return resData;
}

function formatSchoolCreateErrors(data) {
  const base = data?.message || data?.error || "School create failed";
  const arr = data?.errors;
  if (!Array.isArray(arr) || arr.length === 0) return base;
  return `${base} — ${arr.join("; ")}`;
}

export async function createSchool({
  schoolName,
  address,
  dimensionHeight,
  dimensionWidth,
  dimensionUnit,
  projectType,
  allowedMobiles = [],
  logo = null,
}) {
  const form = new FormData();
  form.append("schoolName", String(schoolName || "").trim());
  let addrTrim = String(address || "").trim();
  if (!addrTrim) addrTrim = "Not specified";
  form.append("address", addrTrim);

  const h = dimensionHeight != null && String(dimensionHeight).trim() !== "" ? Number(String(dimensionHeight).trim()) : null;
  const w = dimensionWidth != null && String(dimensionWidth).trim() !== "" ? Number(String(dimensionWidth).trim()) : null;
  const unit = dimensionUnit != null && String(dimensionUnit).trim() !== "" ? String(dimensionUnit).trim() : null;
  
  if ((h != null && !Number.isNaN(h)) || (w != null && !Number.isNaN(w))) {
    const dim = { height: h != null && !Number.isNaN(h) ? h : 0, width: w != null && !Number.isNaN(w) ? w : 0 };
    if (unit) dim.unit = unit;
    form.append("dimension", JSON.stringify(dim));
  }
  const normalizedProjectType = String(projectType || "").trim().toLowerCase() === "badge" ? "badge" : "idCard";
  form.append("projectType", normalizedProjectType);
  if (Array.isArray(allowedMobiles)) {
    allowedMobiles.forEach((m) => form.append("allowedMobiles[]", String(m).trim()));
  }
  if (logo && logo instanceof File) {
    form.append("logo", logo, logo.name || "logo.png");
  } else if (logo && logo instanceof Blob) {
    form.append("logo", logo, "logo.png");
  }

  const res = await fetch(`${API_BASE_URL}/api/photographer/schools`, {
    method: "POST",
    headers: authHeadersForm(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatSchoolCreateErrors(data));
  const schoolId = data?.school?._id ?? data?.data?._id ?? data?._id ?? null;
  if (!schoolId) throw new Error("Server did not return school id");
  return { ...data, schoolId };
}

export function bulkUploadStudentsXls(schoolId, file) {
  const form = new FormData();
  form.append("schoolId", String(schoolId));
  form.append("file", file, file.name || "students.xlsx");

  const url = `${API_BASE_URL}/api/photographer/students/bulk-upload`;
  const token = getToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch { }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.message || data?.error || xhr.statusText || "Bulk upload failed"));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

export async function getStudentsBySchool(schoolId, options = {}) {
  const retainPhotos = options.retainPhotos !== false;
  const slimOpts = { stripInlinePhotos: !retainPhotos };
  const res = await fetch(`${API_BASE_URL}/api/photographer/schools/${encodeURIComponent(schoolId)}/students`, {
    method: "GET",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || "Failed");
  const schoolStudents = Array.isArray(data.students) ? data.students : [];
  if (schoolStudents.length > 0) {
    return slimStudentsPayloadForClient(
      {
        ...data,
        students: sortStudentsByExcelRowOrder(schoolStudents),
      },
      slimOpts,
    );
  }

  // Some projects occasionally return an empty school-level list even though
  // class-level student endpoints still have data. Recover from that case.
  try {
    const classesRes = await getClassesBySchool(schoolId);
    const classes = Array.isArray(classesRes?.classes) ? classesRes.classes : [];
    if (classes.length === 0) {
      return {
        ...data,
        students: [],
      };
    }

    const classResults = await Promise.allSettled(
      classes
        .map((cls) => cls?._id || cls?.id)
        .filter((id) => typeof id === "string" && id.trim() !== "")
        .map((cid) => getStudentsBySchoolAndClass(schoolId, cid, options)),
    );

    const deduped = new Map();
    let fallbackTemplate = null;
    classResults.forEach((result) => {
      if (result.status !== "fulfilled") return;
      const payload = result.value;
      const rows = Array.isArray(payload?.students) ? payload.students : [];
      rows.forEach((student) => {
        const id = student?._id || student?.id;
        if (typeof id === "string" && id.trim() !== "" && !deduped.has(id)) {
          deduped.set(id, student);
        }
      });
      if (!fallbackTemplate && payload?.template) {
        fallbackTemplate = payload.template;
      }
    });

    const mergedStudents = sortStudentsByExcelRowOrder(Array.from(deduped.values()));
    return slimStudentsPayloadForClient(
      {
        ...data,
        ...(data?.template ? {} : fallbackTemplate ? { template: fallbackTemplate } : {}),
        students: mergedStudents,
      },
      slimOpts,
    );
  } catch {
    // Keep original response shape when fallback probing fails.
  }

  return slimStudentsPayloadForClient(
    {
      ...data,
      students: sortStudentsByExcelRowOrder(schoolStudents),
    },
    slimOpts,
  );
}

/** Resolve one student with photos for preview (list rows may omit heavy inline URLs). */
export async function getStudentRecordForPreview(studentId, schoolId, classId) {
  if (!studentId || !schoolId) return null;
  if (classId && String(classId).trim() !== "" && classId !== "all") {
    const res = await getStudentsBySchoolAndClass(schoolId, classId, {
      retainPhotos: true,
    });
    return (
      (res.students ?? []).find(
        (x) => (x._id || x.id) === studentId,
      ) ?? null
    );
  }
  const res = await getStudentsBySchool(schoolId, { retainPhotos: true });
  return (
    (res.students ?? []).find((x) => (x._id || x.id) === studentId) ?? null
  );
}

export async function uploadStudentPhoto(studentId, file, deviceInfo = "Web") {
  const form = new FormData();
  if (file instanceof Blob) {
    form.append("photo", file, file.name || "photo.png");
  }
  form.append("studentId", String(studentId));
  form.append("deviceInfo", String(deviceInfo));

  const res = await fetch(`${API_BASE_URL}/api/photographer/photos/upload`, {
    method: "POST",
    headers: authHeadersForm(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || res.statusText || "Upload failed");
  return data;
}

function dataURLtoBlob(dataURL) {
  if (!dataURL || typeof dataURL !== "string" || !dataURL.startsWith("data:")) return null;
  const arr = dataURL.split(",");
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const bstr = atob(arr[1] || "");
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
  return new Blob([u8arr], { type: mime });
}

export async function uploadTemplate({ name, schoolId, classId, frontImage, backImage, elements, backElements }) {
  const form = new FormData();
  form.append("name", String(name || "Uploaded Template").trim());
  if (schoolId) form.append("schoolId", String(schoolId).trim());
  if (classId) form.append("classId", String(classId).trim());
  
  const frontBlob = dataURLtoBlob(frontImage);
  const backBlob = dataURLtoBlob(backImage);
  if (frontBlob) form.append("frontImage", frontBlob, "front.png");
  if (backBlob) form.append("backImage", backBlob, "back.png");
  form.append("elements", JSON.stringify(Array.isArray(elements) ? elements : []));
  if (backElements != null) {
    form.append("backElements", JSON.stringify(Array.isArray(backElements) ? backElements : []));
  }

  const res = await fetch(`${API_BASE_URL}/api/photographer/templates/upload`, {
    method: "POST",
    headers: authHeadersForm(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || "Template upload failed");
  return data;
}

export async function bulkSaveTemplates(templateId, studentIds) {
  const res = await fetch(`${API_BASE_URL}/api/photographer/templates/bulk-save`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ templateId, studentIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || "Bulk save failed");
  return data;
}
