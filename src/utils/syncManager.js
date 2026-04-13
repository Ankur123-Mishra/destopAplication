import * as XLSX from 'xlsx';
import { db } from '../data/db';
import * as net from '../api/network_backend';
import { sortStudentsByExcelRowOrder } from './studentListOrder';

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

export async function syncAllBackgroundData(onProgress) {
  // Graceful fallback callback
  const reportProgress = typeof onProgress === 'function' ? onProgress : console.log;

  reportProgress("Preparing to sync local projects to remote server...");

  // Select only projects that are not synced yet.
  // Some legacy rows may not have syncStatus, so mongoId acts as a durable synced marker.
  const pendingSchools = await db.schools
    .filter((s) => s.syncStatus !== 'synced' && !s.mongoId)
    .toArray();
  
  if (pendingSchools.length === 0) {
    reportProgress("All local projects are successfully synchronized!");
    return;
  }

  for (let s = 0; s < pendingSchools.length; s++) {
      const school = pendingSchools[s];
      const localSchoolId = school.id || school._id;
    reportProgress(`Syncing project [${s + 1}/${pendingSchools.length}]: ${school.schoolName}`);
    
    try {
      // 1. Create Remote School
      const createRes = await net.createSchool({
         schoolName: school.schoolName,
         address: school.address,
         dimensionHeight: school.dimension?.height,
         dimensionWidth: school.dimension?.width,
         dimensionUnit: school.dimensionUnit,
         allowedMobiles: school.allowedMobiles,
      });
      
      const mongoSchoolId = createRes.schoolId;
      
      // 2. Re-create the standard Excel Workbook from local DB chunks (same row order as original Excel)
      const localStudents = sortStudentsByExcelRowOrder(
        await db.students.where('schoolId').equals(localSchoolId).toArray(),
      );
      const localClasses = await db.classes.where('schoolId').equals(localSchoolId).toArray();
      
      const classMap = {};
      localClasses.forEach(c => { classMap[c.id] = c; });
      
      const excelRows = localStudents.map(student => {
         const cls = classMap[student.classId];
         return {
           "STD": cls ? cls.className : "",
           "Division": cls ? cls.section : "",
           "Photo.No": student.photoNo || student.studentId || "",
           "Student Name": student.studentName || "",
           "RegNo": student.admissionNo || "",
           "RollNo": student.rollNo || "",
           "DOB": student.dateOfBirth || "",
           "Mobil.No": student.phone || "",
           "Gender": student.gender || "",
           "BloodGroup": student.bloodGroup || "",
           "Address": student.address || "",
           "Fathers Name": student.fatherName || ""
         };
      });
      
      if (excelRows.length === 0) {
         // Mark as synced immediately if empty
         await db.schools.update(localSchoolId, {
           syncStatus: 'synced',
           mongoId: mongoSchoolId,
           lastSyncedAt: new Date().toISOString(),
         });
         continue;
      }
      
      reportProgress(`Building bulk-upload packet for ${school.schoolName}...`);
      const worksheet = XLSX.utils.json_to_sheet(excelRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Dataset");
      
      const xlsxArrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const xlsxBlob = new Blob([xlsxArrayBuffer], { type: 'application/octet-stream' });
      const xlsxFile = new File([xlsxBlob], `${school.schoolName.replace(/[^a-z0-9]/gi, '_')}_offline_sync.xlsx`);
      
      // 3. Initiate Bulk Upload XHR Wrapper
      reportProgress(`Pushing dataset to remote mapping engine...`);
      await net.bulkUploadStudentsXls(mongoSchoolId, xlsxFile);
      
      // 4. Download processed Mongo structure to pair ObjectIDs
      reportProgress(`Aligning synchronized targets...`);
      const remoteData = await net.getStudentsBySchool(mongoSchoolId);
      const remoteStudentsArr = remoteData.students || [];
      
      const remotePhotoMap = {}; 
      remoteStudentsArr.forEach(rs => {
         const backendKey = rs.photoNo || rs.studentId; 
         if (backendKey) remotePhotoMap[backendKey] = rs._id;
      });
      
      // 5. Upload Bound Photos & Aggregate Templates
      reportProgress(`Transferring photos and template overrides for ${school.schoolName}...`);
      
      const templatePayloadGrps = {}; 
      
      for (let i = 0; i < localStudents.length; i++) {
         const ls = localStudents[i];
         const localKey = ls.photoNo || ls.studentId;
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
    }
  }

  reportProgress("Complete!");
}
