import { db } from '../data/db';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';

// --- Mocks to replace the previous API tokens ---
export async function getDashboard() {
  const assignedSchools = await db.schools.count();
  const totalStudents = await db.students.count();

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
  const studentsList = await db.students.where({ schoolId, classId }).toArray();
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
  const studentsList = await db.students.where({ schoolId, classId }).toArray();
  const schoolDoc = await db.schools.get(schoolId);
  return { students: studentsList.map(s => ({ ...s, _id: s.id, school: schoolDoc, schoolId: schoolDoc })) };
}

export async function getStudentsBySchool(schoolId) {
  const studentsList = await db.students.where('schoolId').equals(schoolId).toArray();
  const schoolDoc = await db.schools.get(schoolId);
  return { students: studentsList.map(s => ({ ...s, _id: s.id, school: schoolDoc, schoolId: schoolDoc })) };
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
  };
  await db.schools.add(newSchool);
  return { message: "School created offline", schoolId: newSchool.id, school: newSchool };
}

// Bulk Upload students: Parse Excel locally -> db.classes & db.students
export async function bulkUploadStudentsXls(schoolId, file, options = {}) {
  const { onUploadProgress } = options;
  if (typeof onUploadProgress === 'function') onUploadProgress(10);
  
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
        // Expected Xls Columns: SrNo, Photo, StudentName, Gender, BirthDate, STD, Division, RegNo, BloodGroup, Address, Mobile
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

        for (const row of json) {
          const clsStr = String(getCol(row, "Class", "STD")).trim();
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
          const student = {
            id: nanoid(),
            schoolId,
            classId: classRecord.id,
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
