import Dexie from 'dexie';

export const db = new Dexie('PhotographerDatabase');

// Define database schema
db.version(1).stores({
  schools: 'id, schoolName', // Primary key and indexed props
  classes: 'id, schoolId, className',
  students: 'id, schoolId, classId, studentId, studentName',
});

// Upgrade database schema for syncing
// IMPORTANT:
// Dexie expects each .stores() call to describe the full schema for that version.
// If we only declare `schools` in a higher version, Dexie may drop other tables on upgrade.
db.version(2).stores({
  schools: 'id, schoolName, syncStatus, mongoId, lastSyncedAt',
  classes: 'id, schoolId, className, section',
  students: 'id, schoolId, classId, studentId, photoNo, excelRowOrder, studentName, hasTemplate',
});

// Force a safe upgrade for users who already reached v2 with an incomplete schema.
db.version(3).stores({
  schools: 'id, schoolName, syncStatus, mongoId, lastSyncedAt',
  classes: 'id, schoolId, className, section',
  students: 'id, schoolId, classId, studentId, photoNo, excelRowOrder, studentName, hasTemplate',
});

// Add compound indexes used by the heaviest offline list queries so large
// school/class payloads can stream in Excel order without full scans/sorts.
db.version(4).stores({
  schools: 'id, schoolName, syncStatus, mongoId, lastSyncedAt',
  classes: 'id, schoolId, className, section',
  students: [
    'id',
    'schoolId',
    'classId',
    'studentId',
    'photoNo',
    'excelRowOrder',
    'studentName',
    'hasTemplate',
    '[schoolId+excelRowOrder]',
    '[schoolId+classId]',
    '[schoolId+classId+excelRowOrder]',
  ].join(', '),
});

// Compact legacy student template rows that used to duplicate full uploaded
// layout payloads per student. Keeping only template metadata prevents renderer
// OOM on large saved-project screens while school-level/root templates still
// provide the shared artwork.
db.version(5)
  .stores({
    schools: 'id, schoolName, syncStatus, mongoId, lastSyncedAt',
    classes: 'id, schoolId, className, section',
    students: [
      'id',
      'schoolId',
      'classId',
      'studentId',
      'photoNo',
      'excelRowOrder',
      'studentName',
      'hasTemplate',
      '[schoolId+excelRowOrder]',
      '[schoolId+classId]',
      '[schoolId+classId+excelRowOrder]',
    ].join(', '),
  })
  .upgrade(async (tx) => {
    await tx.table('students').toCollection().modify((student) => {
      const tpl = student?.template;
      if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) return;
      const nextTemplate = {
        ...(tpl.templateId != null ? { templateId: tpl.templateId } : {}),
        ...(tpl.name ? { name: tpl.name } : {}),
        ...(tpl.status ? { status: tpl.status } : {}),
      };
      student.template =
        Object.keys(nextTemplate).length > 0 ? nextTemplate : undefined;
    });
  });
