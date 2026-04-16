import * as XLSX from 'xlsx';
import { db } from '../data/db';
import * as net from '../api/network_backend';
import { sortStudentsByExcelRowOrder } from './studentListOrder';

function normalizeStudentMatchKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function extractRemoteStudents(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.students)) return payload.students;
  if (Array.isArray(payload.data?.students)) return payload.data.students;
  if (Array.isArray(payload.result?.students)) return payload.result.students;
  if (Array.isArray(payload.insertedStudents)) return payload.insertedStudents;
  if (Array.isArray(payload.createdStudents)) return payload.createdStudents;
  if (Array.isArray(payload.data?.insertedStudents)) return payload.data.insertedStudents;
  if (Array.isArray(payload.data?.createdStudents)) return payload.data.createdStudents;
  if (Array.isArray(payload.docs)) return payload.docs;
  if (Array.isArray(payload.data?.docs)) return payload.data.docs;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  if (Array.isArray(payload.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function extractRemoteClasses(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.classes)) return payload.classes;
  if (Array.isArray(payload.data?.classes)) return payload.data.classes;
  if (Array.isArray(payload.result?.classes)) return payload.result.classes;
  if (Array.isArray(payload.docs)) return payload.docs;
  if (Array.isArray(payload.data?.docs)) return payload.data.docs;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  if (Array.isArray(payload.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function extractDataURLBlob(dataURL) {
  if (!dataURL || typeof dataURL !== "string" || !dataURL.startsWith("data:")) return null;
  const arr = dataURL.split(",");
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const bstr = atob(arr[1] || "");
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
  return new Blob([u8arr], { type: mime });
}

function buildSyncExcelRow(student, cls) {
  const className = cls ? cls.className : "";
  const division = cls ? cls.section : "";
  const photoNo = student.photoNo || student.studentId || "";
  const studentName = student.studentName || "";
  const regNo = student.admissionNo || "";
  const rollNo = student.rollNo || "";
  const birthDate = student.dateOfBirth || "";
  const mobile = student.phone || "";
  const gender = student.gender || "";
  const bloodGroup = student.bloodGroup || "";
  const address = student.address || "";
  const fatherName = student.fatherName || "";

  // Keep both legacy and canonical headers so server parser can map regardless of naming variant.
  return {
    // Legacy variants (already used in exports)
    "STD": className,
    "Division": division,
    "Photo.No": photoNo,
    "Student Name": studentName,
    "RegNo": regNo,
    "RollNo": rollNo,
    "DOB": birthDate,
    "Mobil.No": mobile,
    "Gender": gender,
    "BloodGroup": bloodGroup,
    "Address": address,
    "Fathers Name": fatherName,

    // Canonical variants commonly accepted by backend bulk upload parser
    "Class": className,
    "Photo": photoNo,
    "StudentName": studentName,
    "BirthDate": birthDate,
    "Mobile": mobile,
    "FatherName": fatherName,
  };
}

async function fetchRemoteStudentsWithRetry(mongoSchoolId, maxAttempts = 8) {
  let lastPayload = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const payload = await net.getStudentsBySchool(mongoSchoolId);
    lastPayload = payload;
    const students = extractRemoteStudents(payload);
    if (students.length > 0) return students;
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  return extractRemoteStudents(lastPayload);
}

async function fetchRemoteStudentsViaClasses(mongoSchoolId) {
  const classesPayload = await net.getClassesBySchool(mongoSchoolId);
  const classes = extractRemoteClasses(classesPayload);
  if (classes.length === 0) return [];

  const perClassPayloads = await Promise.all(
    classes.map((cls) => net.getStudentsBySchoolAndClass(mongoSchoolId, cls._id || cls.id)),
  );

  const merged = [];
  const seen = new Set();
  perClassPayloads.forEach((payload) => {
    extractRemoteStudents(payload).forEach((st) => {
      const id = st?._id || st?.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push(st);
    });
  });
  return merged;
}

function buildSchoolSyncExcelFile(school, excelRows) {
  const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const cached = school?.sourceExcelUpload;
  if (cached?.arrayBuffer) {
    return new File(
      [cached.arrayBuffer],
      cached.name || `${school.schoolName.replace(/[^a-z0-9]/gi, '_')}_offline_sync.xlsx`,
      { type: cached.type || xlsxMime },
    );
  }

  const worksheet = XLSX.utils.json_to_sheet(excelRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dataset");
  const xlsxArrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File(
    [new Blob([xlsxArrayBuffer], { type: xlsxMime })],
    `${school.schoolName.replace(/[^a-z0-9]/gi, '_')}_offline_sync.xlsx`,
    { type: xlsxMime },
  );
}

function summarizeBulkUploadResponse(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const studentsFromPayload = extractRemoteStudents(payload);
  const classCount =
    extractRemoteClasses(payload).length ||
    (Array.isArray(payload?.data?.classes) ? payload.data.classes.length : 0);
  const insertedCount =
    payload?.insertedStudents ??
    payload?.data?.insertedStudents ??
    payload?.createdCount ??
    payload?.data?.createdCount ??
    payload?.total ??
    payload?.data?.total ??
    null;
  const message = payload?.message || payload?.error || '';
  const attempt = payload?._uploadAttempt ? `attempt=${payload._uploadAttempt}` : '';
  const parts = [];
  if (message) parts.push(`message=${String(message)}`);
  if (insertedCount != null) parts.push(`inserted=${String(insertedCount)}`);
  parts.push(`studentsInResponse=${studentsFromPayload.length}`);
  if (classCount > 0) parts.push(`classesInResponse=${classCount}`);
  if (attempt) parts.push(attempt);
  return parts.join(', ');
}

export async function syncAllBackgroundData(onProgress) {
  // Graceful fallback callback
  const reportProgress = typeof onProgress === 'function' ? onProgress : console.log;

  reportProgress("Preparing to sync local projects to remote server...");

  // Keep all local projects in consideration; each project is verified/resumed safely below.
  const pendingSchools = await db.schools.toArray();
  
  if (pendingSchools.length === 0) {
    reportProgress("All local projects are successfully synchronized!");
    return;
  }
  const failedSchools = [];

  for (let s = 0; s < pendingSchools.length; s++) {
      const school = pendingSchools[s];
      const localSchoolId = school.id || school._id;
    reportProgress(`Syncing project [${s + 1}/${pendingSchools.length}]: ${school.schoolName}`);
    
    try {
      const candidateSchoolIds = Array.from(
        new Set(
          [school.id, school._id, localSchoolId]
            .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
            .map((v) => String(v)),
        ),
      );
      const localStudentsRaw =
        candidateSchoolIds.length > 0
          ? await db.students.where('schoolId').anyOf(candidateSchoolIds).toArray()
          : [];
      const localStudents = sortStudentsByExcelRowOrder(localStudentsRaw);
      const localClasses =
        candidateSchoolIds.length > 0
          ? await db.classes.where('schoolId').anyOf(candidateSchoolIds).toArray()
          : [];

      if (localStudents.length === 0) {
        reportProgress(
          `Skipped ${school.schoolName}: no local students found for sync (project kept pending).`,
        );
        continue;
      }

      let mongoSchoolId = school.mongoId || null;
      let remoteStudentsArr = [];
      let shouldUploadExcel = true;

      // Resume support: if a previous sync already created the remote school, continue there.
      if (mongoSchoolId) {
        try {
          remoteStudentsArr = await fetchRemoteStudentsWithRetry(mongoSchoolId, 2);
          if (
            school.syncStatus === 'synced' &&
            remoteStudentsArr.length >= localStudents.length
          ) {
            reportProgress(`Skipping ${school.schoolName}: already synced.`);
            continue;
          }
          if (remoteStudentsArr.length > 0) {
            shouldUploadExcel = false;
            reportProgress(
              `Resuming ${school.schoolName}: using existing online students (${remoteStudentsArr.length}).`,
            );
          } else {
            reportProgress(
              `Resuming ${school.schoolName}: online school exists but students missing; re-uploading Excel.`,
            );
          }
        } catch (resumeErr) {
          console.warn(
            `Resume check failed for ${school.schoolName}, creating new school:`,
            resumeErr,
          );
          mongoSchoolId = null;
          remoteStudentsArr = [];
          shouldUploadExcel = true;
        }
      }

      // 1. Create Remote School (only when not already created in previous run)
      if (!mongoSchoolId) {
        const createRes = await net.createSchool({
          schoolName: school.schoolName,
          address: school.address,
          dimensionHeight: school.dimension?.height,
          dimensionWidth: school.dimension?.width,
          dimensionUnit: school.dimensionUnit,
          allowedMobiles: school.allowedMobiles,
        });
        mongoSchoolId = createRes.schoolId;
      }
      
      // 2. Re-create the standard Excel Workbook from local DB chunks (same row order as original Excel)
      const classMap = {};
      localClasses.forEach((c) => {
        classMap[String(c.id)] = c;
      });
      
      const excelRows = localStudents.map((student) => {
        const cls = classMap[String(student.classId)];
        return buildSyncExcelRow(student, cls);
      });
      
      if (excelRows.length === 0) {
         throw new Error("No students found while building Excel payload");
      }
      
      let bulkUploadRes = null;
      if (shouldUploadExcel) {
        reportProgress(`Building bulk-upload packet for ${school.schoolName}...`);
        const xlsxFile = buildSchoolSyncExcelFile(school, excelRows);
        
        // 3. Initiate Bulk Upload XHR Wrapper
        reportProgress(`Pushing dataset to remote mapping engine...`);
        bulkUploadRes = await net.bulkUploadStudentsXls(mongoSchoolId, xlsxFile);
      }
      
      // 4. Download processed Mongo structure to pair ObjectIDs
      reportProgress(`Aligning synchronized targets...`);
      if (remoteStudentsArr.length === 0) {
        remoteStudentsArr = await fetchRemoteStudentsWithRetry(mongoSchoolId);
      }
      if (remoteStudentsArr.length === 0) {
        reportProgress(`School endpoint still empty, probing class endpoints for ${school.schoolName}...`);
        try {
          remoteStudentsArr = await fetchRemoteStudentsViaClasses(mongoSchoolId);
        } catch (classProbeErr) {
          console.warn(
            `Class-level probe failed for ${school.schoolName}:`,
            classProbeErr,
          );
        }
      }
      if (remoteStudentsArr.length === 0) {
        remoteStudentsArr = extractRemoteStudents(bulkUploadRes);
      }
      if (remoteStudentsArr.length === 0 && shouldUploadExcel) {
        reportProgress(
          `No students visible yet for ${school.schoolName}; retrying Excel upload once...`,
        );
        const retryFile = buildSchoolSyncExcelFile(school, excelRows);
        bulkUploadRes = await net.bulkUploadStudentsXls(mongoSchoolId, retryFile);
        remoteStudentsArr = await fetchRemoteStudentsWithRetry(mongoSchoolId, 6);
        if (remoteStudentsArr.length === 0) {
          try {
            remoteStudentsArr = await fetchRemoteStudentsViaClasses(mongoSchoolId);
          } catch (retryClassProbeErr) {
            console.warn(
              `Class-level probe failed after retry for ${school.schoolName}:`,
              retryClassProbeErr,
            );
          }
        }
        if (remoteStudentsArr.length === 0) {
          remoteStudentsArr = extractRemoteStudents(bulkUploadRes);
        }
      }
      if (remoteStudentsArr.length === 0) {
        const responseSummary = summarizeBulkUploadResponse(bulkUploadRes);
        throw new Error(
          responseSummary
            ? `Students were not found online after Excel upload (${responseSummary})`
            : "Students were not found online after Excel upload",
        );
      }
      
      const remotePhotoMap = {}; 
      remoteStudentsArr.forEach(rs => {
         const backendKey = normalizeStudentMatchKey(rs.photoNo || rs.studentId);
         if (backendKey) remotePhotoMap[backendKey] = rs._id;
      });
      
      // 5. Upload Bound Photos & Aggregate Templates
      reportProgress(`Transferring photos and template overrides for ${school.schoolName}...`);
      
      const templatePayloadGrps = {}; 
      
      for (let i = 0; i < localStudents.length; i++) {
         const ls = localStudents[i];
         const localKey = normalizeStudentMatchKey(ls.photoNo || ls.studentId);
         const mongoStudentId = remotePhotoMap[localKey];
         
         if (!mongoStudentId) continue;
         
         // a) Transfer Base64 locally cropped photo binary 
         if (ls.photoUrl && ls.photoUrl.startsWith('data:')) {
            const blob = extractDataURLBlob(ls.photoUrl);
            if (blob) {
               const photoFile = new File([blob], `${localKey}.jpeg`, { type: blob.type });
               try {
                 await net.uploadStudentPhoto(mongoStudentId, photoFile);
               } catch (e) {
                 console.warn("Photo upload skipped/failed:", e);
               }
            }
         }
         
         // b) Template grouping logic
         if (ls.hasTemplate && ls.template) {
            const tName = ls.template.name || ls.template.templateId;
            if (!templatePayloadGrps[tName]) {
               templatePayloadGrps[tName] = { templateObj: ls.template, studentMongoIds: [] }; 
            }
            templatePayloadGrps[tName].studentMongoIds.push(mongoStudentId);
         }
      }
      
      // 6. Push Batch Templates Network Layout
      reportProgress(`Finalizing graphical bindings...`);
      const tKeys = Object.keys(templatePayloadGrps);
      for (let k = 0; k < tKeys.length; k++) {
         const grp = templatePayloadGrps[tKeys[k]];
         const localTpl = grp.templateObj;
         let liveTemplateId = localTpl.templateId;
         
         if (localTpl.frontImage && Array.isArray(localTpl.elements)) {
            try {
              const res = await net.uploadTemplate({
                 name: tKeys[k],
                 schoolId: mongoSchoolId,
                 frontImage: localTpl.frontImage,
                 backImage: localTpl.backImage,
                 elements: localTpl.elements
              });
              liveTemplateId = res.templateId || res.data?._id || res.template?._id || liveTemplateId;
            } catch (e) {
              console.warn("Template upload failed, using standard fallback", e);
            }
         }
         
         if (liveTemplateId && grp.studentMongoIds.length > 0) {
            try {
              await net.bulkSaveTemplates(liveTemplateId, grp.studentMongoIds);
            } catch (e) {
              console.warn("Template mapping failed", e);
            }
         }
      }
      
      // 7. Success state saved permanently!
      await db.schools.update(localSchoolId, {
        syncStatus: 'synced',
        mongoId: mongoSchoolId,
        lastSyncedAt: new Date().toISOString(),
      });
      reportProgress(`Successfully synced: ${school.schoolName}`);
      
    } catch (error) {
      console.error(`Sync error on school ${school.schoolName}: ${error?.message || error}`);
      reportProgress(`Failed to completely sync ${school.schoolName}: ${error?.message || error}`);
      failedSchools.push({
        schoolName: school.schoolName,
        message: error?.message || String(error),
      });
    }
  }

  if (failedSchools.length > 0) {
    const first = failedSchools[0];
    reportProgress(
      `Sync finished with ${failedSchools.length} failure(s). First: ${first.schoolName} - ${first.message}`,
    );
  } else {
    reportProgress("Complete!");
  }
}
