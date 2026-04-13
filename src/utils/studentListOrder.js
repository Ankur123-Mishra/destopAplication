/**
 * Stable list order matching Excel sheet row order after bulk upload.
 * IndexedDB and many APIs return students in arbitrary order (e.g. by id).
 */
export function sortStudentsByExcelRowOrder(studentsList) {
  if (!Array.isArray(studentsList) || studentsList.length <= 1) return studentsList;
  return [...studentsList].sort((a, b) => {
    const ao = a.excelRowOrder;
    const bo = b.excelRowOrder;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    const aid = String(a.id ?? a._id ?? '');
    const bid = String(b.id ?? b._id ?? '');
    return aid.localeCompare(bid);
  });
}
