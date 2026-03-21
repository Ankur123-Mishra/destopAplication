import React, { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import CameraView from '../components/CameraView';

export default function BulkMode() {
  const navigate = useNavigate();
  const { schoolId, classId } = useParams();
  const { getStudents, updateStudentStatus, classes, schools } = useApp();
  const allStudents = getStudents(classId) || [];
  const pendingStudents = useMemo(() => allStudents.filter((s) => s.status === 'pending'), [allStudents]);
  const [index, setIndex] = useState(0);
  const current = pendingStudents[index];
  const school = schools.find((s) => s.id === schoolId);
  const cls = classes.find((c) => c.id === classId);

  const handleCapture = (blob) => {
    if (!current) return;
    const url = URL.createObjectURL(blob);
    updateStudentStatus(classId, current.id, 'photo_uploaded', url);
    if (index < pendingStudents.length - 1) setIndex((i) => i + 1);
    else navigate(`/schools/${schoolId}/classes/${classId}/students`);
  };

  const backTo = `/schools/${schoolId}/classes/${classId}/students`;

  if (pendingStudents.length === 0) {
    return (
      <>
        <Header title="Bulk Photo Mode" showBack backTo={backTo} />
        <div className="card">
          <p>No pending students in this class. All photos uploaded.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate(backTo)}>Back to Students</button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={`Bulk Mode – ${school?.name} – ${cls?.name}`} showBack backTo={backTo} />
      <div className="bulk-mode-layout">
        <div className="card bulk-progress">
          <h3>Student {index + 1} of {pendingStudents.length}</h3>
          <p><strong>{current?.name}</strong> – {current?.studentId}</p>
          <div className="bulk-queue">
            {pendingStudents.map((s, i) => (
              <span key={s.id} className={`bulk-dot ${i === index ? 'active' : ''} ${i < index ? 'done' : ''}`} title={s.name} />
            ))}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(backTo)}>Exit Bulk Mode</button>
        </div>
        <div className="bulk-camera">
          <CameraView onCapture={handleCapture} />
        </div>
      </div>
      <style>{`
        .bulk-mode-layout { display: grid; grid-template-columns: 280px 1fr; gap: 24px; }
        @media (max-width: 900px) { .bulk-mode-layout { grid-template-columns: 1fr; } }
        .bulk-progress h3 { margin-bottom: 8px; }
        .bulk-queue { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0; }
        .bulk-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--bg-card); }
        .bulk-dot.active { background: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
        .bulk-dot.done { background: var(--approved); }
      `}</style>
    </>
  );
}
