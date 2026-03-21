import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import StatusBadge from '../components/StatusBadge';

export default function CorrectionList() {
  const navigate = useNavigate();
  const { schoolId, classId } = useParams();
  const { getStudents, schools, classes } = useApp();
  const students = (getStudents(classId) || []).filter((s) => s.status === 'correction_required');
  const school = schools.find((s) => s.id === schoolId);
  const cls = classes.find((c) => c.id === classId);
  const backTo = `/schools/${schoolId}/classes/${classId}/students`;

  return (
    <>
      <Header title="Correction List" showBack backTo={backTo} />
      <p className="text-muted" style={{ marginBottom: 16 }}>
        {school?.name} – {cls?.name}. Re-capture or upload new photo for these students.
      </p>
      {students.length === 0 ? (
        <div className="card">
          <p>No students with correction required in this class.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate(backTo)}>Back to Students</button>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Student Name</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>{s.studentId}</td>
                  <td>{s.name}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => navigate(`/schools/${schoolId}/classes/${classId}/students/${s.id}/camera`)}
                    >
                      Re-capture / Upload
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
