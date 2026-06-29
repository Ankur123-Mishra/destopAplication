export const PARENT_FORM_OPTIONAL_FIELDS = [
  { key: 'className', label: 'Class Name' },
  { key: 'section', label: 'Section' },
  { key: 'fatherName', label: 'Father Name' },
  { key: 'motherName', label: 'Mother Name' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'address', label: 'Address' },
  { key: 'dob', label: 'Date of Birth' },
  { key: 'photoNo', label: 'Photo No.' },
  { key: 'admissionNo', label: 'Admission No' },
  // { key: 'rollNo', label: 'Roll No' },
  // { key: 'gender', label: 'Gender' },
  // { key: 'bloodGroup', label: 'Blood Group' },
];

export function makeInitialFieldEnabled() {
  return Object.fromEntries(PARENT_FORM_OPTIONAL_FIELDS.map((field) => [field.key, true]));
}
