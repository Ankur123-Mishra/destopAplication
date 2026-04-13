import { db } from '../data/db';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';
import { getUploadedTemplates } from '../data/uploadedTemplatesStorage';
import { sortStudentsByExcelRowOrder } from '../utils/studentListOrder';

export { sortStudentsByExcelRowOrder };

function isValidPhotographerTemplateShape(t) {
  return (
    t &&
    typeof t === 'object' &&
    t.frontImage &&
    Array.isArray(t.elements) &&
    t.elements.length > 0
  );
}

/** Template from a student row after bulk save (full front/back/elements). */
function templateFromStudentRecord(st) {
  const t = st?.template;
  if (!isValidPhotographerTemplateShape(t)) return null;
  return {
    frontImage: t.frontImage,
    backImage: t.backImage ?? null,
    elements: t.elements,
    ...(Array.isArray(t.backElements) ? { backElements: t.backElements } : {}),
    name: t.name || 'Template',
    templateId: t.templateId,
  };
}

/**
 * Uploaded templates from localStorage (wizard "Use this template"), keyed by school when available.
 * Legacy entries may omit schoolId — if none match by school, the last valid legacy template is used.
 */
function templateFromUploadedStorage(schoolId) {
  const { templates } = getUploadedTemplates();
  const forSchool = templates.filter((t) => t.schoolId === schoolId && isValidPhotographerTemplateShape(t));
  if (forSchool.length > 0) {
    const t = forSchool[forSchool.length - 1];
    return {
      frontImage: t.frontImage,
      backImage: t.backImage ?? null,
      elements: t.elements,
      ...(Array.isArray(t.backElements) ? { backElements: t.backElements } : {}),
      name: t.name || 'Uploaded Template',
      templateId: t.id,
    };
  }
  const legacy = templates.filter(
    (t) => (t.schoolId == null || t.schoolId === '') && isValidPhotographerTemplateShape(t),
  );
  if (legacy.length > 0) {
    const t = legacy[legacy.length - 1];
    return {
      frontImage: t.frontImage,
      backImage: t.backImage ?? null,
      elements: t.elements,
      ...(Array.isArray(t.backElements) ? { backElements: t.backElements } : {}),
      name: t.name || 'Uploaded Template',
      templateId: t.id,
    };
  }
  return null;
}

/**
 * School-level uploaded template only: stored on the school record or in localStorage for this school.
 * Does not consider per-student template rows (those can exist without the school having uploaded a design).
 */
export function resolveSchoolUploadedPhotographerTemplate(schoolId, schoolDoc = null) {
  if (!schoolId) return null;
  const fromSchool = schoolDoc?.offlineIdCardTemplate;
  if (isValidPhotographerTemplateShape(fromSchool)) {
    return {
      frontImage: fromSchool.frontImage,
      backImage: fromSchool.backImage ?? null,
      elements: fromSchool.elements,
      ...(Array.isArray(fromSchool.backElements) ? { backElements: fromSchool.backElements } : {}),
      name: fromSchool.name || 'Uploaded Template',
      templateId: fromSchool.templateId ?? 'offline-school-template',
    };
  }
  return templateFromUploadedStorage(schoolId);
}

/** Same shape as online GET /students `template` field — used by ClassIdCardsWizard (Edit template). */
export function resolveOfflinePhotographerTemplate(schoolId, studentsRaw, schoolDoc = null) {
  if (!schoolId) return null;
  for (const st of studentsRaw) {
    const tpl = templateFromStudentRecord(st);
    if (tpl) return tpl;
  }
  const fromSchool = schoolDoc?.offlineIdCardTemplate;
  if (isValidPhotographerTemplateShape(fromSchool)) {
    return {
      frontImage: fromSchool.frontImage,
      backImage: fromSchool.backImage ?? null,
      elements: fromSchool.elements,
      ...(Array.isArray(fromSchool.backElements) ? { backElements: fromSchool.backElements } : {}),
      name: fromSchool.name || 'Uploaded Template',
      templateId: fromSchool.templateId ?? 'offline-school-template',
    };
  }
  return templateFromUploadedStorage(schoolId);
}

// --- Mocks to replace the previous API tokens ---
export async function getDashboard() {
  const schoolsList = await db.schools.toArray();
  const assignedSchools = schoolsList.length;
  const schoolIds = schoolsList.map((s) => s.id);
  const totalStudents =
    schoolIds.length === 0
      ? 0
      : await db.students.where('schoolId').anyOf(schoolIds).count();

  return {
    assignedSchools,
    totalStudents,
    photoPending: 0,
    photoUploaded: 0,
    correctionRequired: 0,
    deliveryPending: 0,
  };
}

export async function getAssignedSchools() {
  const schoolsList = await db.schools.toArray();
  // Map internal `id` to `_id` so UI components (which expect Mongo ObjectId strings) still work seamlessly.
  return { schools: schoolsList.map(s => ({ ...s, _id: s.id })) };
}

export async function updatePhotographerSchool(schoolId, body) {
  await db.schools.update(schoolId, body);
  return { message: "School updated locally" };
}

export async function deletePhotographerSchool(schoolId) {
  await db.schools.delete(schoolId);
  // Also cascade delete classes and students if needed
  await db.classes.where('schoolId').equals(schoolId).delete();
  await db.students.where('schoolId').equals(schoolId).delete();
  return { message: "School deleted successfully" };
}

export async function getClassesBySchool(schoolId) {
  const classesList = await db.classes.where('schoolId').equals(schoolId).toArray();
  return { classes: classesList.map(c => ({ ...c, _id: c.id })) };
}

export async function getTemplatesStatus(schoolId, classId) {
  const studentsList = sortStudentsByExcelRowOrder(
    await db.students.where({ schoolId, classId }).toArray(),
  );
  const schoolDoc = await db.schools.get(schoolId);
  const withTemplates = studentsList.filter(s => s.hasTemplate).length;
  const withoutTemplates = studentsList.length - withTemplates;
  return { 
    message: "Offline statistics", 
    total: studentsList.length, 
    withTemplates, 
    withoutTemplates, 
    students: studentsList.map(s => ({ ...s, _id: s.id, school: schoolDoc, schoolId: schoolDoc })),
    summary: { withTemplates, withoutTemplates }
  };
}

export async function getStudentsBySchoolAndClass(schoolId, classId) {
  const studentsList = sortStudentsByExcelRowOrder(
    await db.students.where({ schoolId, classId }).toArray(),
  );
  const schoolDoc = await db.schools.get(schoolId);
  const template = resolveOfflinePhotographerTemplate(schoolId, studentsList, schoolDoc);
  return {
    students: studentsList.map((s) => ({ ...s, _id: s.id, school: schoolDoc, schoolId: schoolDoc })),
    ...(template ? { template } : {}),
  };
}

export async function updateStudent(studentId, data) {
  await db.students.update(studentId, data);
  return { message: "Student updated locally", studentId };
}

export async function getStudentsBySchool(schoolId) {
  const studentsList = sortStudentsByExcelRowOrder(
    await db.students.where('schoolId').equals(schoolId).toArray(),
  );
  const schoolDoc = await db.schools.get(schoolId);
  const template = resolveOfflinePhotographerTemplate(schoolId, studentsList, schoolDoc);
  return {
    students: studentsList.map((s) => ({ ...s, _id: s.id, school: schoolDoc, schoolId: schoolDoc })),
    ...(template ? { template } : {}),
  };
}

export async function bulkSaveTemplates(templateId, studentIds) {
  // Keeping this for backward compatibility if ever called without full template data
  await db.transaction('rw', db.students, async () => {
    for (const sid of studentIds) {
      await db.students.update(sid, {
        hasTemplate: true,
        template: { templateId }
      });
    }
  });
  return { message: "Templates saved locally" };
}

export async function bulkSaveFullOfflineTemplates(updates) {
  await db.transaction('rw', db.students, async () => {
    for (const update of updates) {
      await db.students.update(update.id, {
        hasTemplate: true,
        template: update.template
      });
    }
  });
  return { message: "Detailed Templates saved locally" };
}

export async function deductTemplateDownloadPoints(studentIds) {
  return { message: "Local mock: points not required", pointsDebited: 0, rateApplied: 0, balanceAfter: 999999 };
}

export async function getPhotographerPointsBalance() {
  return { pointsBalance: 999999, perStudentTemplateCost: 0 };
}

export async function uploadTemplate(data) {
  const schoolId = data?.schoolId;
  if (schoolId) {
    await db.schools.update(schoolId, {
      offlineIdCardTemplate: {
        frontImage: data.frontImage,
        backImage: data.backImage ?? null,
        elements: data.elements,
        ...(Array.isArray(data.backElements) ? { backElements: data.backElements } : {}),
        name: data.name || 'Uploaded Template',
        templateId: data.templateId,
      },
    });
  }
  return { message: "Uploaded successfully (mock)", templateId: "mock-template" };
}

export async function uploadStudentPhoto(studentId, file, deviceInfo = "Web") {
  // Convert file (Blob/File) to data URL to store in Dexie directly.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      await db.students.update(studentId, { photoUrl: dataUrl });
      resolve({ message: "Photo uploaded locally", photoUrl: dataUrl });
    };
    reader.onerror = () => reject(new Error("Failed to read photo file"));
    reader.readAsDataURL(file);
  });
}

export async function bulkUploadPhotos(classId, files) {
  return { message: "Bulk upload mocked", uploadedCount: files.length };
}

export async function updateDelivery(schoolId, classId) {
  return { message: "Updated local delivery status" };
}

// Emulate backend school creation using Dexie
export async function createSchool({
  schoolName,
  address,
  dimensionHeight,
  dimensionWidth,
  dimensionUnit,
  allowedMobiles = [],
  logo = null,
}) {
  const newSchool = {
    id: nanoid(),
    schoolName: String(schoolName || "").trim(),
    address: String(address || "").trim() || "Not specified",
    dimension: { height: Number(dimensionHeight) || 57, width: Number(dimensionWidth) || 90 },
    dimensionUnit: dimensionUnit || "mm",
    allowedMobiles,
    syncStatus: 'pending',
    mongoId: null,
  };
  await db.schools.add(newSchool);
  return { message: "School created offline", schoolId: newSchool.id, school: newSchool };
}

// Bulk Upload students: Parse Excel locally -> db.classes & db.students
export async function bulkUploadStudentsXls(schoolId, file, options = {}) {
  const { onUploadProgress } = options;
  if (typeof onUploadProgress === 'function') onUploadProgress(10);
  const toExtraFieldKey = (header) => {
    const raw = String(header || '').trim();
    if (!raw) return '';
    const cleaned = raw.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
    if (!cleaned) return '';
    const parts = cleaned.split(/\s+/);
    if (parts.length === 0) return '';
    const first = parts[0].toLowerCase();
    const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
    return `${first}${rest.join('')}`;
  };
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        if (typeof onUploadProgress === 'function') onUploadProgress(40);
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        
        if (typeof onUploadProgress === 'function') onUploadProgress(60);

        // Map parsed rows to classes and students
        // Supports both Class/STD and Course-based sheets.
        const classMap = {}; // key: "STD_Division" -> class object
        const newClasses = [];
        const newStudents = [];

        // Helper to find a matching column ignoring case/spaces
        const getCol = (row, ...names) => {
          for (const key of Object.keys(row)) {
            const normKey = key.replace(/[\s.]+/g, '').toLowerCase();
            for (const name of names) {
              if (normKey === name.replace(/[\s.]+/g, '').toLowerCase()) {
                return row[key];
              }
            }
          }
          return "";
        };
        const knownColumnNorms = new Set([
          'srno',
          'sr.no',
          'sirial',
          'serial',
          'photo',
          'photo.no',
          'photono',
          'studentname',
          'student name',
          'gender',
          'birthdate',
          'dob',
          'class',
          'std',
          'course',
          'coursename',
          'program',
          'programname',
          'stream',
          'division',
          'section',
          'regno',
          'admissionno',
          'rollno',
          'bloodgroup',
          'address',
          'mobil.no',
          'mobile',
          'mobileno',
          'phone',
          'fathersname',
          "father'sname",
          'fathername',
          'fatherprimarycontact',
          'fathercontact',
          'fathermobile',
          'fatherphone',
          'mothername',
          "mother'sname",
          'motherprimarycontact',
          'mothercontact',
          'mothermobile',
          'motherphone',
          'house',
          'marking',
        ].map((x) => String(x).replace(/[\s.]+/g, '').toLowerCase()));

        for (let sheetRowIndex = 0; sheetRowIndex < json.length; sheetRowIndex++) {
          const row = json[sheetRowIndex];
          const clsStr = String(getCol(row, "Class", "STD", "Course", "Course Name", "Program", "Program Name", "Stream")).trim();
          const divStr = String(getCol(row, "Division", "Section")).trim();
          
          if (!clsStr && !divStr && !getCol(row, "Student Name")) continue; // Skip empty rows
          
          const className = clsStr || "Class"; // ensure we don't completely fail
          const section = divStr;

          let classNameKey = `${className}`;
          if (section) classNameKey += `_${section}`;

          let classRecord = classMap[classNameKey];
          if (!classRecord) {
            classRecord = {
              id: nanoid(),
              schoolId,
              className,
              section,
            };
            classMap[classNameKey] = classRecord;
            newClasses.push(classRecord);
          }

          const photoNo = String(getCol(row, "Photo.No", "PhotoNo", "Photo")).trim();
          const extraFields = {};
          Object.entries(row).forEach(([header, value]) => {
            const norm = String(header || '').replace(/[\s.]+/g, '').toLowerCase();
            if (!norm || knownColumnNorms.has(norm)) return;
            if (value == null) return;
            const stringValue = String(value).trim();
            if (!stringValue) return;
            const fieldKey = toExtraFieldKey(header);
            if (!fieldKey) return;
            extraFields[fieldKey] = value;
          });
          const student = {
            id: nanoid(),
            schoolId,
            classId: classRecord.id,
            className,
            section,
            /** 0-based index in parsed sheet (XLSX row order) — used to preserve Excel sequence in UI */
            excelRowOrder: sheetRowIndex,
            studentName: getCol(row, "Student Name", "StudentName"),
            admissionNo: String(getCol(row, "RegNo", "AdmissionNo", "Sr.No")),
            rollNo: String(getCol(row, "RollNo", "SrNo", "Sirial", "Serial")),
            studentId: photoNo,
            photoNo: photoNo, 
            dateOfBirth: getCol(row, "DOB", "BirthDate"),
            phone: getCol(row, "Mobil.No", "Mobile", "MobileNo", "Phone"),
            address: getCol(row, "Address"),
            gender: getCol(row, "Gender"),
            bloodGroup: getCol(row, "BloodGroup"),
            fatherName: getCol(row, "Fathers Name", "FatherName", "Father's Name"),
            fatherPrimaryContact: getCol(row, "Father Primary Contact", "FatherContact", "Father Mobile", "Father Phone"),
            motherName: getCol(row, "Mother Name", "MotherName", "Mother's Name"),
            motherPrimaryContact: getCol(row, "Mother Primary Contact", "MotherContact", "Mother Mobile", "Mother Phone"),
            house: getCol(row, "House"),
            marking: getCol(row, "Marking"),
            extraFields,
            status: 'Active',
            photoUrl: null
          };
          newStudents.push(student);
        }

        if (typeof onUploadProgress === 'function') onUploadProgress(80);

        // Bulk insert locally
        await db.transaction('rw', db.classes, db.students, async () => {
          if (newClasses.length > 0) {
            await db.classes.bulkAdd(newClasses);
          }
          if (newStudents.length > 0) {
            await db.students.bulkAdd(newStudents);
          }
        });

        if (typeof onUploadProgress === 'function') onUploadProgress(100);
        resolve({ message: "Parsed Excel and populated db successfully", insertedStudents: newStudents.length });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read Excel file."));
    reader.readAsArrayBuffer(file);
  });
}

export async function getCorrections() {
  return { message: "No local corrections", schools: [], summary: {} };
}
