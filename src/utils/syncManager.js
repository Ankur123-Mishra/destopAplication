import * as XLSX from 'xlsx';
import { db } from '../data/db';
import * as net from '../api/network_backend';
import { sortStudentsByExcelRowOrder } from './studentListOrder';

function normalizeStudentMatchKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function extractRemoteStudents(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.students)) return payload.students;
  if (Array.isArray(payload.data?.students)) return payload.data.students;
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

function isUploadableTemplate(tpl) {
  return Boolean(
    tpl &&
    typeof tpl === 'object' &&
    typeof tpl.frontImage === 'string' &&
    tpl.frontImage.startsWith('data:') &&
    Array.isArray(tpl.elements) &&
    tpl.elements.length > 0,
  );
}

/** Dexie / offline rows keep many Excel columns on the student root; only `extraFields` was synced — merge the rest into the bulk XLSX. */
const SYNC_STUDENT_META_KEYS = new Set([
  'id',
  '_id',
  'schoolId',
  'classId',
  'className',
  'section',
  'template',
  'hasTemplate',
  'photoUrl',
  'colorCodeImageUrl',
  'colorCodePhotoUrl',
  'status',
  'excelRowOrder',
  'createdAt',
  'updatedAt',
  '__v',
  'extraFields',
  'uploadedVia',
]);

/** Root keys already written to fixed columns (see {@link bulkUploadStudentsXls} in dashboard.js). */
const SYNC_STUDENT_ROOT_KEYS_IN_BASE_COLUMNS = new Set([
  'studentName',
  'admissionNo',
  'rollNo',
  'studentId',
  'photoNo',
  'dateOfBirth',
  'phone',
  'email',
  'address',
  'gender',
  'bloodGroup',
  'uniqueCode',
  'fatherName',
  'fatherPrimaryContact',
  'fatherPhone',
  'motherName',
  'motherPrimaryContact',
  'motherPhone',
  'house',
  'bus',
  'marking',
  'colorCodeKey',
]);

function scalarToCell(value) {
  if (value == null) return '';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return String(value).trim();
  return '';
}

/** Any other primitive root fields (custom Excel columns stored only on the row) become extra columns again on upload. */
function appendRemainingTopLevelFields(row, student) {
  for (const [key, value] of Object.entries(student)) {
    if (SYNC_STUDENT_META_KEYS.has(key) || SYNC_STUDENT_ROOT_KEYS_IN_BASE_COLUMNS.has(key)) {
      continue;
    }
    const cell = scalarToCell(value);
    if (!cell) continue;
    if (Object.prototype.hasOwnProperty.call(row, key)) continue;
    row[key] = cell;
  }
}

export function isSchoolPendingSync(school) {
  return Boolean(school && school.syncStatus !== 'synced' && !school.mongoId);
}

export async function syncSingleSchool(localSchoolId, onProgress) {
  const reportProgress = typeof onProgress === 'function' ? onProgress : console.log;

  const school = await db.schools.get(localSchoolId);
  if (!school) {
    throw new Error('Project not found locally');
  }

  const resolvedLocalSchoolId = school.id || school._id || localSchoolId;

  if (!isSchoolPendingSync(school)) {
    reportProgress(`${school.schoolName} is already synchronized`);
    return { success: true, alreadySynced: true };
  }

  reportProgress(`Syncing project: ${school.schoolName}`);

  try {
    const createRes = await net.createSchool({
      schoolName: school.schoolName,
      address: school.address,
      dimensionHeight: school.dimension?.height,
      dimensionWidth: school.dimension?.width,
      dimensionUnit: school.dimensionUnit,
      projectType: school.projectType,
      allowedMobiles: school.allowedMobiles,
    });

    const mongoSchoolId = createRes.schoolId;

    const localStudents = sortStudentsByExcelRowOrder(
      await db.students.where('schoolId').equals(resolvedLocalSchoolId).toArray(),
    );
    const localClasses = await db.classes.where('schoolId').equals(resolvedLocalSchoolId).toArray();

    const classMap = {};
    localClasses.forEach((c) => { classMap[c.id] = c; });

    const excelRows = localStudents.map((student) => {
      const cls = classMap[student.classId];
      const extraRaw =
        student.extraFields && typeof student.extraFields === 'object' ? student.extraFields : {};
      const extra = { ...extraRaw };
      delete extra.fatherPrimaryContact;
      delete extra.fatherPhone;
      delete extra.motherPrimaryContact;
      delete extra.motherPhone;
      const fatherContact =
        String(student.fatherPrimaryContact || student.fatherPhone || '').trim() ||
        String(extraRaw.fatherPrimaryContact || extraRaw.fatherPhone || '').trim();
      const motherContact =
        String(student.motherPrimaryContact || student.motherPhone || '').trim() ||
        String(extraRaw.motherPrimaryContact || extraRaw.motherPhone || '').trim();
      const colorKey = student.colorCodeKey != null ? String(student.colorCodeKey).trim() : '';
      const row = {
        ...extra,
        STD: cls ? cls.className : '',
        Division: cls ? cls.section : '',
        'Student Id': student.studentId || '',
        'Photo.No': student.photoNo || '',
        'Student Name': student.studentName || '',
        RegNo: student.admissionNo || '',
        RollNo: student.rollNo || '',
        DOB: student.dateOfBirth || '',
        'Mobil.No': student.phone || '',
        Email: student.email || '',
        Gender: student.gender || '',
        BloodGroup: student.bloodGroup || '',
        Address: student.address || '',
        'Fathers Name': student.fatherName || '',
        'Father Primary Contact': fatherContact,
        'Mother Name': student.motherName || '',
        'Mother Primary Contact': motherContact,
        House: student.house || '',
        Bus: student.bus || '',
        Marking: student.marking || '',
        UniqueCode: student.uniqueCode || '',
        ...(colorKey ? { 'Color Code': colorKey } : {}),
      };
      appendRemainingTopLevelFields(row, student);
      return row;
    });

    if (excelRows.length === 0) {
      await db.schools.update(resolvedLocalSchoolId, {
        syncStatus: 'synced',
        mongoId: mongoSchoolId,
        lastSyncedAt: new Date().toISOString(),
      });
      reportProgress(`Successfully synced: ${school.schoolName}`);
      return { success: true, mongoSchoolId };
    }

    reportProgress(`Building bulk-upload packet for ${school.schoolName}...`);
    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Dataset');

    const xlsxArrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const xlsxBlob = new Blob([xlsxArrayBuffer], { type: xlsxMime });
    const xlsxFile = new File(
      [xlsxBlob],
      `${school.schoolName.replace(/[^a-z0-9]/gi, '_')}_offline_sync.xlsx`,
      { type: xlsxMime },
    );

    reportProgress(`Pushing dataset to remote mapping engine...`);
    const bulkUploadRes = await net.bulkUploadStudentsXls(mongoSchoolId, xlsxFile);

    reportProgress('Aligning synchronized targets...');
    const remoteData = await net.getStudentsBySchool(mongoSchoolId);
    let remoteStudentsArr = extractRemoteStudents(remoteData);
    if (remoteStudentsArr.length === 0) {
      remoteStudentsArr = extractRemoteStudents(bulkUploadRes);
    }
    if (remoteStudentsArr.length === 0) {
      throw new Error('Students were not found online after Excel upload');
    }

    const remotePhotoMap = {};
    remoteStudentsArr.forEach((rs) => {
      const backendKey = normalizeStudentMatchKey(rs.photoNo || rs.studentId);
      if (backendKey) remotePhotoMap[backendKey] = rs._id;
    });

    const totalStudents = localStudents.length;
    reportProgress(`Transferring photos and template overrides for ${school.schoolName} (0/${totalStudents})...`);

    const templatePayloadGrps = {};
    const schoolTemplateFallback = isUploadableTemplate(school.offlineIdCardTemplate)
      ? school.offlineIdCardTemplate
      : null;

    const MAX_CONCURRENT_UPLOADS = 5;
    let completedCount = 0;

    const uploadStudentAssets = async (ls) => {
      const localKey = normalizeStudentMatchKey(ls.photoNo || ls.studentId);
      const mongoStudentId = remotePhotoMap[localKey];

      if (mongoStudentId) {
        if (ls.photoUrl && ls.photoUrl.startsWith('data:')) {
          const blob = extractDataURLBlob(ls.photoUrl);
          if (blob) {
            const photoFile = new File([blob], `${localKey}.jpeg`, { type: blob.type });
            try {
              await net.uploadStudentPhoto(mongoStudentId, photoFile);
            } catch (e) {
              console.warn('Photo upload failed:', e);
            }
          }
        }

        if (ls.colorCodeImageUrl && ls.colorCodeImageUrl.startsWith('data:')) {
          const blob = extractDataURLBlob(ls.colorCodeImageUrl);
          if (blob) {
            const colorCodeFile = new File([blob], `${localKey}_color.png`, { type: blob.type });
            try {
              await net.uploadStudentColorCodeImage(mongoStudentId, colorCodeFile);
            } catch (e) {
              console.warn('Color code upload failed:', e);
            }
          }
        }

        const hasAnyTemplateMarker = Boolean(
          ls.hasTemplate || (ls.template && (ls.template.templateId || ls.template.name)),
        );
        if (hasAnyTemplateMarker) {
          const candidateTemplate = isUploadableTemplate(ls.template)
            ? ls.template
            : schoolTemplateFallback;
          const templateKey = ls.template?.name || ls.template?.templateId || candidateTemplate?.name || 'offline-template';

          if (!templatePayloadGrps[templateKey]) {
            templatePayloadGrps[templateKey] = {
              templateObj: candidateTemplate || ls.template || null,
              studentMongoIds: [],
            };
          }
          templatePayloadGrps[templateKey].studentMongoIds.push(mongoStudentId);
        }
      }

      completedCount++;
      if (completedCount % 10 === 0 || completedCount === totalStudents) {
        reportProgress(`Syncing media: ${completedCount}/${totalStudents} students processed...`);
      }
    };

    const queue = [...localStudents];
    const workers = [];

    const worker = async () => {
      while (queue.length > 0) {
        const student = queue.shift();
        await uploadStudentAssets(student);
      }
    };

    for (let w = 0; w < Math.min(MAX_CONCURRENT_UPLOADS, totalStudents); w++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    reportProgress('Finalizing graphical bindings...');
    const tKeys = Object.keys(templatePayloadGrps);
    for (let k = 0; k < tKeys.length; k++) {
      const grp = templatePayloadGrps[tKeys[k]];
      const localTpl = grp.templateObj;
      let liveTemplateId = localTpl.templateId;

      if (isUploadableTemplate(localTpl)) {
        try {
          const res = await net.uploadTemplate({
            name: tKeys[k],
            schoolId: mongoSchoolId,
            frontImage: localTpl.frontImage,
            backImage: localTpl.backImage,
            elements: localTpl.elements,
            backElements: Array.isArray(localTpl.backElements) ? localTpl.backElements : undefined,
          });
          liveTemplateId = res.templateId || res.data?._id || res.template?._id || liveTemplateId;
        } catch (e) {
          console.warn('Template upload failed, using standard fallback', e);
        }
      }

      if (liveTemplateId && grp.studentMongoIds.length > 0) {
        try {
          await net.bulkSaveTemplates(liveTemplateId, grp.studentMongoIds);
        } catch (e) {
          console.warn('Template mapping failed', e);
        }
      }
    }

    await db.schools.update(resolvedLocalSchoolId, {
      syncStatus: 'synced',
      mongoId: mongoSchoolId,
      lastSyncedAt: new Date().toISOString(),
    });
    reportProgress(`Successfully synced: ${school.schoolName}`);
    return { success: true, mongoSchoolId };
  } catch (error) {
    console.error(`Sync error on school ${school.schoolName}: ${error?.message || error}`);
    reportProgress(`Failed to completely sync ${school.schoolName}: ${error?.message || error}`);
    return { success: false, error: error?.message || String(error) };
  }
}

export async function syncAllBackgroundData(onProgress) {
  const reportProgress = typeof onProgress === 'function' ? onProgress : console.log;

  reportProgress('Preparing to sync local projects to remote server...');

  const pendingSchools = await db.schools
    .filter((s) => isSchoolPendingSync(s))
    .toArray();

  if (pendingSchools.length === 0) {
    reportProgress('All local projects are successfully synchronized!');
    return;
  }

  for (let s = 0; s < pendingSchools.length; s++) {
    const school = pendingSchools[s];
    const localSchoolId = school.id || school._id;
    reportProgress(`Syncing project [${s + 1}/${pendingSchools.length}]: ${school.schoolName}`);
    await syncSingleSchool(localSchoolId, reportProgress);
  }

  reportProgress('Complete!');
}
