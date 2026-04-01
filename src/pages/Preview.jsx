import React from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';

export default function Preview() {
  const navigate = useNavigate();
  const { schoolId, classId, studentId } = useParams();
  const location = useLocation();
  const imageUrl = location.state?.imageUrl;
  const { getStudents } = useApp();
  const students = getStudents(classId) || [];
  const student = students.find((s) => s.id === studentId);
  const backTo = `/schools/${schoolId}/classes/${classId}/students`;
  if (!imageUrl) {
    navigate(backTo);
    return null;
  }
  
  const handleRetake = () => {
    navigate(`/schools/${schoolId}/classes/${classId}/students/${studentId}/camera`);
  };
  
  const handleConfirm = () => {
    navigate(backTo);
  };
  
  return (
    <>
      <Header title="Photo Preview" showBack backTo={backTo} />
      {student && <p className="text-muted" style={{ marginBottom: 16 }}>{student.name} – {student.studentId}</p>}
      <div className="card" style={{ maxWidth: 640 }}>
        <img src={imageUrl} alt="Preview" style={{ width: '100%', maxHeight: 480, objectFit: 'contain', borderRadius: 8 }} />
        <div className="camera-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={handleRetake}>Retake</button>
          <button type="button" className="btn btn-primary" onClick={handleConfirm}>Confirm Upload</button>
        </div>
      </div>
      <p className="text-muted" style={{ marginTop: 12 }}>Status will show as Photo Uploaded on student list.</p>
    </>
  );
}
