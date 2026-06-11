export const PARENT_FORM_OPTIONAL_FIELDS = [
  { key: 'schoolName', label: 'School Name' },
  { key: 'className', label: 'Class Name' },
  { key: 'section', label: 'Section' },
  { key: 'fatherName', label: 'Father Name' },
  { key: 'motherName', label: 'Mother Name' },
  { key: 'admissionNo', label: 'Admission No' },
  { key: 'rollNo', label: 'Roll No' },
  { key: 'gender', label: 'Gender' },
  { key: 'dob', label: 'Date of Birth' },
  { key: 'bloodGroup', label: 'Blood Group' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'address', label: 'Address' },
  { key: 'photoNo', label: 'Photo No.' },
];

export function makeInitialFieldEnabled() {
  return Object.fromEntries(PARENT_FORM_OPTIONAL_FIELDS.map((field) => [field.key, true]));
}
