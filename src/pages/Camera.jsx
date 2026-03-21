import React, { useState, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import CameraView from '../components/CameraView';
import UploadBox from '../components/UploadBox';

export default function Camera() {
  const navigate = useNavigate();
  const { schoolId, classId, studentId } = useParams();
  const [searchParams] = useSearchParams();
  const uploadMode = searchParams.get('upload') === '1';
  const { getStudents, updateStudentStatus } = useApp();
  const students = getStudents(classId) || [];
  const student = useMemo(() => students.find((s) => s.id === studentId), [students, studentId]);

  const [selectedFile, setSelectedFile] = useState(null);

  const handleCapture = (blob) => {
    const url = URL.createObjectURL(blob);
    updateStudentStatus(classId, studentId, 'photo_uploaded', url);
    navigate(`/schools/${schoolId}/classes/${classId}/students/${studentId}/preview`, { state: { imageUrl: url, fromBlob: true } });
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSelectedFile({ file, url });
  };

  const handleConfirmUpload = () => {
    if (!selectedFile) return;
    updateStudentStatus(classId, studentId, 'photo_uploaded', selectedFile.url);
    navigate(`/schools/${schoolId}/classes/${classId}/students/${studentId}/preview`, { state: { imageUrl: selectedFile.url } });
  };

  const backTo = `/schools/${schoolId}/classes/${classId}/students`;

  if (!student) {
    return (
      <>
        <Header title="Student not found" showBack backTo={backTo} />
        <p className="text-muted">Student not found.</p>
      </>
    );
  }

  return (
    <>
      <Header title={`Photo – ${student.name}`} showBack backTo={backTo} />
      <p className="text-muted" style={{ marginBottom: 16 }}>Student ID: {student.studentId}</p>
      {uploadMode ? (
        <div className="camera-upload-layout">
          <UploadBox onFileSelect={handleFileSelect} />
          {selectedFile && (
            <div className="card" style={{ marginTop: 16, maxWidth: 400 }}>
              <p style={{ marginBottom: 8 }}>Preview & confirm</p>
              <img src={selectedFile.url} alt="Preview" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8 }} />
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary" onClick={handleConfirmUpload}>Confirm Upload</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <CameraView
          onCapture={handleCapture}
          onClose={() => navigate(backTo)}
        />
      )}
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate(uploadMode ? `/schools/${schoolId}/classes/${classId}/students/${studentId}/camera` : `/schools/${schoolId}/classes/${classId}/students/${studentId}/camera?upload=1`)}
        >
          {uploadMode ? 'Use Webcam instead' : 'Upload from computer instead'}
        </button>
      </div>
    </>
  );
}
