import Dexie from 'dexie';

export const db = new Dexie('PhotographerDatabase');

// Define database schema
db.version(1).stores({
  schools: 'id, schoolName', // Primary key and indexed props
  classes: 'id, schoolId, className',
  students: 'id, schoolId, classId, studentId, studentName',
});

// Upgrade database schema for syncing
db.version(2).stores({
  schools: 'id, schoolName, syncStatus',
});
