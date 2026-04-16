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
