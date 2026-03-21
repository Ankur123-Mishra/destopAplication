import React, { useState } from 'react';
import StatusBadge from './StatusBadge';

export default function StudentTable({
  students,
  onCapture,
  onUpload,
  onRowClick,
  showActions = true,
}) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const filtered = students.filter((s) => {
    const matchName = s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.studentId && s.studentId.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = !filterStatus || s.status === filterStatus;
    return matchName && matchStatus;
  });

  return (
    <div className="student-table-wrap">
      <div className="table-toolbar">
        <input
          type="text"
          className="input-field"
          placeholder="Search by name or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <select
          className="input-field"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ maxWidth: 180 }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="photo_uploaded">Photo Uploaded</option>
          <option value="correction_required">Correction Required</option>
          <option value="approved">Approved</option>
        </select>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Student ID</th>
              <th>Student Name</th>
              <th>Photo Status</th>
              {/* {showActions && <th>Action</th>} */}
            </tr>
          </thead>
          <tbody>
            {filtered.map((student) => (
              <tr
                key={student.id}
                // onClick={() => onRowClick && onRowClick(student)}
                style={onRowClick ? { cursor: 'pointer' } : {}}
              >
                <td>{student.studentId}</td>
                <td>{student.name}</td>
                <td><StatusBadge status={student.status} /></td>
                {showActions && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {/* {onCapture && (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => onCapture(student)}
                        >
                          Camera
                        </button>
                        {' '}
                      </>
                    )} */}
                    {/* <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onUpload(student)}
                    >
                      Upload
                    </button> */}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
