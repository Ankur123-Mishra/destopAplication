/**
 * Photographer dashboard APIs - token se authenticated calls
 */
import { API_BASE_URL } from "./config";
import { getToken } from "./authStorage";

function authHeaders() {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

function authHeadersForm() {
  const token = getToken();
  console.log("authHeadersForm", token);
  return {
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

/**
 * GET /api/photographer/dashboard
 * Response: { assignedSchools, totalStudents, photoPending, photoUploaded, correctionRequired, deliveryPending }
 */
export async function getDashboard() {
  const res = await fetch(`${API_BASE_URL}/api/photographer/dashboard`, {
    method: "GET",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Failed to load dashboard";
    throw new Error(msg);
  }
  return data;
}

/**
 * GET /api/photographer/schools/assigned
 * Response: { schools: [{ _id, schoolName, schoolCode, address }] }
 */
export async function getAssignedSchools() {
  const res = await fetch(`${API_BASE_URL}/api/photographer/schools/assigned`, {
    method: "GET",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Failed to load schools";
    throw new Error(msg);
  }
  return data;
}

/**
 * PUT /api/photographer/schools/:schoolId
 * Body: { schoolName, schoolCode, address, dimension: { height, width }, dimensionUnit, allowedMobiles }
 */
export async function updatePhotographerSchool(schoolId, body) {
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/schools/${encodeURIComponent(schoolId)}`,
    {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      formatSchoolCreateErrors(data) ||
      res.statusText ||
      "Failed to update school";
    throw new Error(msg);
  }
  return data;
}

/**
 * DELETE /api/photographer/schools/:schoolId
 * Response: { message?: string }
 */
export async function deletePhotographerSchool(schoolId) {
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/schools/${encodeURIComponent(schoolId)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Failed to delete school";
    throw new Error(msg);
  }
  return data;
}

/**
 * GET /api/photographer/classes/:schoolId
 * Response: { classes: [{ _id, className, section }] }
 */
export async function getClassesBySchool(schoolId) {
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/classes/${schoolId}`,
    {
      method: "GET",
      headers: authHeaders(),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Failed to load classes";
    throw new Error(msg);
  }
  return data;
}

/**
 * GET /api/photographer/templates/status?schoolId=xxx&classId=yyy
 * Response: { message, total, withTemplates, withoutTemplates, students: [...], summary: { withTemplates, withoutTemplates } }
 * Students with saved ID cards (hasTemplate: true) with templateId, status, etc.
 */
export async function getTemplatesStatus(schoolId, classId) {
  const params = new URLSearchParams({ schoolId, classId });
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/templates/status?${params}`,
    {
      method: "GET",
      headers: authHeaders(),
    },
  );
  const data = await res.json().catch(() => ({}));
  console.log("getTemplatesStatus", data);
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Failed to load template status";
    throw new Error(msg);
  }
  return data;
}

/**
 * GET /api/photographer/students?schoolId=xxx&classId=yyy
 * Response: { students: [...], template?: { frontImage, backImage, elements, templateId, name, title, ... } }
 */
export async function getStudentsBySchoolAndClass(schoolId, classId) {
  const params = new URLSearchParams({ schoolId, classId });
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/students?${params}`,
    {
      method: "GET",
      headers: authHeaders(),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Failed to load students";
    throw new Error(msg);
  }
  return data;
}

/**
 * GET /api/photographer/schools/:schoolId/students
 * All students in the school (not filtered by class).
 * Response shape aligned with class list: { students: [...], template?: { ... } }
 */
export async function getStudentsBySchool(schoolId) {
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/schools/${encodeURIComponent(schoolId)}/students`,
    {
      method: "GET",
      headers: authHeaders(),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Failed to load students";
    throw new Error(msg);
  }
  return data;
}

/**
 * POST /api/photographer/templates/bulk-save
 * Body: { templateId: string, studentIds: string[] }
 * Response: API response (e.g. { message?, ... })
 */
export async function bulkSaveTemplates(templateId, studentIds) {
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/templates/bulk-save`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ templateId, studentIds }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message || data?.error || res.statusText || "Bulk save failed";
    throw new Error(msg);
  }
  return data;
}

/**
 * POST /api/photographer/templates/deduct-download-points
 * Body: { studentIds: string[] }
 * Response: { message, pointsDebited, rateApplied, balanceAfter }
 */
export async function deductTemplateDownloadPoints(studentIds) {
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/templates/deduct-download-points`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ studentIds }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Points deduction failed";
    const err = new Error(msg);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

/**
 * Reads points info for header display. Uses dashboard payload so backend can return
 * either top-level points fields or nested photographer fields.
 */
export async function getPhotographerPointsBalance() {
  const pickNumber = (...values) => {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
  };

  const extractPoints = (data) => ({
    pointsBalance: pickNumber(
      data?.pointsBalance,
      data?.photographer?.pointsBalance,
      data?.data?.pointsBalance,
      data?.data?.photographer?.pointsBalance,
      data?.user?.pointsBalance,
      data?.data?.user?.pointsBalance,
    ),
    perStudentTemplateCost: pickNumber(
      data?.perStudentTemplateCost,
      data?.photographer?.perStudentTemplateCost,
      data?.data?.perStudentTemplateCost,
      data?.data?.photographer?.perStudentTemplateCost,
      data?.user?.perStudentTemplateCost,
      data?.data?.user?.perStudentTemplateCost,
    ),
  });

  const dashboardData = await getDashboard();
  const dashboardPoints = extractPoints(dashboardData);
  if (dashboardPoints.pointsBalance != null) return dashboardPoints;

  const fallbackEndpoints = [
    `${API_BASE_URL}/api/photographer/profile`,
    `${API_BASE_URL}/api/photographer/me`,
  ];

  for (const url of fallbackEndpoints) {
    try {
      const res = await fetch(url, { method: "GET", headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) continue;
      const extracted = extractPoints(data);
      if (extracted.pointsBalance != null) {
        return extracted;
      }
    } catch {
      // Silently continue to next fallback endpoint.
    }
  }

  return {
    pointsBalance: null,
    perStudentTemplateCost: null,
  };
}

/**
 * Convert data URL (e.g. from canvas/FileReader) to Blob for FormData upload.
 */
function dataURLtoBlob(dataURL) {
  if (!dataURL || typeof dataURL !== "string") return null;
  const arr = dataURL.split(",");
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const bstr = atob(arr[1] || "");
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
  return new Blob([u8arr], { type: mime });
}

/**
 * POST /api/photographer/templates/upload (multipart/form-data)
 * Body: name (string), schoolId (string), classId (string), frontImage (file), backImage (file), elements (JSON string)
 * Response: API response (e.g. { message?, templateId?, ... })
 */

export async function uploadTemplate({
  name,
  schoolId,
  classId,
  frontImage,
  backImage,
  elements,
}) {
  const form = new FormData();
  form.append("name", String(name || "Uploaded Template").trim());
  if (schoolId != null && String(schoolId).trim() !== "")
    form.append("schoolId", String(schoolId).trim());
  if (classId != null && String(classId).trim() !== "")
    form.append("classId", String(classId).trim());
  const frontBlob = dataURLtoBlob(frontImage);
  const backBlob = dataURLtoBlob(backImage);
  if (frontBlob) form.append("frontImage", frontBlob, "front.png");
  if (backBlob) form.append("backImage", backBlob, "back.png");
  form.append(
    "elements",
    JSON.stringify(Array.isArray(elements) ? elements : []),
  );
  console.log("form", form);

  const res = await fetch(`${API_BASE_URL}/api/photographer/templates/upload`, {
    method: "POST",
    headers: authHeadersForm(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  console.log("uploadTemplate", data);
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Template upload failed";
    throw new Error(msg);
  }
  return data;
}

/**
 * POST /api/photographer/photos/upload (multipart/form-data)
 * Body: photo (file), studentId (string), deviceInfo (string)
 * Response: { message?, photoUrl? }
 * In Electron, File may not serialize correctly in FormData — we read to Blob and append with filename.
 */

export async function uploadStudentPhoto(studentId, file, deviceInfo = "Web") {
  console.log("Student Photo Uploading Single File");
  const form = new FormData();
  // Read file to ArrayBuffer then append as Blob so multipart body has actual bytes (works in Electron)
  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: file.type || "image/png" });
  form.append("photo", blob, file.name || "photo.png");
  form.append("studentId", String(studentId));
  form.append("deviceInfo", String(deviceInfo));

  const res = await fetch(`${API_BASE_URL}/api/photographer/photos/upload`, {
    method: "POST",
    headers: authHeadersForm(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message || data?.error || res.statusText || "Upload failed";
    throw new Error(msg);
  }
  return data;
}

/**
 * POST /api/photographer/photos/bulk-upload (multipart/form-data)
 * Body: classId (string), photos (multiple files)
 * Folder images should be named by student ID (e.g. 100012.jpeg, 100013.webp).
 * Response: { message?, uploadedCount?, photoUrls? }
 */
export async function bulkUploadPhotos(classId, files) {
  console.log("Student Photo Uploading Bulk Files");
  const form = new FormData();
  form.append("classId", String(classId));
  for (let i = 0; i < files.length; i++) {
    console.log("Student Photo Uploading", files[i].name);
    const file = files[i];
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type || "image/png" });
    form.append("photos", blob, file.name || `photo-${i}.png`);
  }

  const res = await fetch(
    `${API_BASE_URL}/api/photographer/photos/bulk-upload`,
    {
      method: "POST",
      headers: authHeadersForm(),
      body: form,
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message || data?.error || res.statusText || "Bulk upload failed";
    throw new Error(msg);
  }
  return data;
}

/**
 * PUT /api/photographer/deliveries/update
 * Body: { schoolId: string, classId: string }
 * Response: { message: string }
 */
export async function updateDelivery(schoolId, classId) {
  const res = await fetch(
    `${API_BASE_URL}/api/photographer/deliveries/update`,
    {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ schoolId, classId }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Delivery update failed";
    throw new Error(msg);
  }
  return data;
}

/** Backend validation errors → readable string (express-validator style, etc.) */
function formatSchoolCreateErrors(data) {
  const base = data?.message || data?.error || "School create failed";
  const arr = data?.errors;
  if (!Array.isArray(arr) || arr.length === 0) return base;
  const parts = arr.map((e) => {
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const loc = e.path ?? e.field ?? e.param;
      const m = e.msg ?? e.message;
      if (loc && m) return `${loc}: ${m}`;
      return m || loc || JSON.stringify(e);
    }
    return String(e);
  });
  return `${base} — ${parts.join("; ")}`;
}

/**
 * POST /api/photographer/schools (multipart/form-data)
 * Body: schoolName, address, dimension (optional), allowedMobiles[] (optional), logo (file, optional)
 * schoolCode is not appended — API expects [A-Z0-9_-]+ only; server can assign if omitted.
 * Response: { school?: { _id }, _id?, data?: { _id } } — use returned id for bulk-upload
 *
 * Empty address gets a placeholder so Create Project (hidden address) still passes required checks.
 */
export async function createSchool({
  schoolName,
  address,
  dimensionHeight,
  dimensionWidth,
  dimensionUnit,
  allowedMobiles = [],
  logo = null,
}) {
  const form = new FormData();
  const nameTrim = String(schoolName || "").trim();
  form.append("schoolName", nameTrim);

  // schoolCode not sent (backend: uppercase letters, numbers, hyphens, underscores only — client skipped)

  let addrTrim = String(address || "").trim();
  if (!addrTrim) {
    addrTrim = "Not specified";
  }
  form.append("address", addrTrim);

  const h =
    dimensionHeight != null && String(dimensionHeight).trim() !== ""
      ? Number(String(dimensionHeight).trim())
      : null;
  const w =
    dimensionWidth != null && String(dimensionWidth).trim() !== ""
      ? Number(String(dimensionWidth).trim())
      : null;
  const unit =
    dimensionUnit != null && String(dimensionUnit).trim() !== ""
      ? String(dimensionUnit).trim()
      : null;
  if ((h != null && !Number.isNaN(h)) || (w != null && !Number.isNaN(w))) {
    const dim = {
      height: h != null && !Number.isNaN(h) ? h : 0,
      width: w != null && !Number.isNaN(w) ? w : 0,
    };
    if (unit) dim.unit = unit;
    form.append("dimension", JSON.stringify(dim));
  }
  if (Array.isArray(allowedMobiles)) {
    allowedMobiles.forEach((m) =>
      form.append("allowedMobiles[]", String(m).trim()),
    );
  }
  if (logo && logo instanceof File) {
    const arrayBuffer = await logo.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: logo.type || "image/png" });
    form.append("logo", blob, logo.name || "logo.png");
  }

  const res = await fetch(`${API_BASE_URL}/api/photographer/schools`, {
    method: "POST",
    headers: authHeadersForm(),
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  console.log("createSchool", data);
  if (!res.ok) {
    throw new Error(formatSchoolCreateErrors(data));
  }
  const schoolId = data?.school?._id ?? data?.data?._id ?? data?._id ?? null;
  if (!schoolId) throw new Error("Server did not return school id");
  return { ...data, schoolId };
}

/**
 * POST /api/photographer/students/bulk-upload (multipart/form-data)
 * Body: schoolId (string), file (XLS/XLSX file)
 * Response: { message?, ... }
 * @param {{ onUploadProgress?: (percent: number) => void }} [options] — percent 0–100 while request body is sent (XHR; fetch has no upload progress)
 */
export function bulkUploadStudentsXls(schoolId, file, options = {}) {
  const { onUploadProgress } = options;
  const form = new FormData();
  form.append("schoolId", String(schoolId));
  form.append("file", file, file.name || "students.xlsx");

  const url = `${API_BASE_URL}/api/photographer/students/bulk-upload`;
  const token = getToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    if (typeof onUploadProgress === "function" && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          const pct = Math.min(100, Math.round((100 * e.loaded) / e.total));
          // Cap at 99 until the request finishes so UI can show bytes uploading, not "done" before response.
          onUploadProgress(Math.min(99, pct));
        }
      };
    }

    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }
      console.log("bulkUploadStudentsXls", data);
      if (xhr.status >= 200 && xhr.status < 300) {
        if (typeof onUploadProgress === "function") {
          onUploadProgress(100);
        }
        resolve(data);
      } else {
        const msg =
          data?.message ||
          data?.error ||
          xhr.statusText ||
          "Bulk upload failed";
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during upload"));
    };

    xhr.send(form);
  });
}

/**
 * GET /api/photographer/corrections
 * Response: { message, schools: [{ _id, schoolName, schoolCode, address, logoUrl, classes: [{ _id, className, section, correctionCount, students: [{ _id, studentName, admissionNo, rollNo, corrections: [...] }] }], totalCorrections, totalClasses }], summary: { totalSchools, totalClasses, totalCorrections } }
 */
export async function getCorrections() {
  const res = await fetch(`${API_BASE_URL}/api/photographer/corrections`, {
    method: "GET",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.error ||
      res.statusText ||
      "Failed to load corrections";
    throw new Error(msg);
  }
  return data;
}
