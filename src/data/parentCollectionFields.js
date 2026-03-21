export const PARENT_FORM_OPTIONAL_FIELDS = [
  { key: 'schoolName', label: 'School name' },
  { key: 'className', label: 'Class name' },
  { key: 'section', label: 'Section' },
  { key: 'fatherName', label: 'Father name' },
  { key: 'parentName', label: 'Parent name' },
  { key: 'admissionNo', label: 'Admission no' },
  { key: 'rollNo', label: 'Roll no' },
  { key: 'gender', label: 'Gender' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'bloodGroup', label: 'Blood group' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'address', label: 'Address' },
];

export function makeInitialFieldEnabled() {
  return Object.fromEntries(PARENT_FORM_OPTIONAL_FIELDS.map((field) => [field.key, true]));
}
