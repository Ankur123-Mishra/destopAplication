import React, { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import StatusBadge from '../components/StatusBadge';
import { getTemplateById } from '../data/idCardTemplates';
import { uploadStudentPhoto } from '../api/dashboard';
import { API_BASE_URL } from '../api/config';
import { compressImageForUpload } from '../utils/imageUpload';

export default function StudentDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { schoolId, classId, studentId } = useParams();
  const { getStudents, getIdCardsForStudent, updateStudentStatus, schools, classes } = useApp();
  const [isUploading, setIsUploading] = useState(false);
  const [localPhotoUrl, setLocalPhotoUrl] = useState(null);
  const fromUploadedPhotos = location.state?.from === 'uploaded-photos';
  const fromCorrections = location.state?.from === 'corrections';
  const stateStudent = location.state?.student;
  const stateSchool = location.state?.school;
  const stateClass = location.state?.class;
  const useStateData = (fromUploadedPhotos || fromCorrections) && stateStudent;

  const students = getStudents(classId) || [];
  const contextStudent = students.find((s) => s.id === studentId);
  const student = useStateData ? stateStudent : contextStudent;
  const cls = useStateData && stateClass
    ? { id: stateClass._id, name: `Class ${stateClass.className}${stateClass.section ? ` – ${stateClass.section}` : ''}` }
    : classes.find((c) => c.id === classId);
  const school = useStateData && stateSchool
    ? { id: stateSchool._id, name: stateSchool.schoolName, address: stateSchool.address }
    : schools.find((s) => s.id === schoolId);
  const savedIdCards = getIdCardsForStudent(studentId) || [];
  const backTo = fromCorrections ? '/corrections' : (fromUploadedPhotos ? '/uploaded-photos' : `/schools/${schoolId}/classes/${classId}/students`);

  if (!student) {
    return (
      <>
        <Header title="Student not found" showBack backTo={backTo} />
        <p className="text-muted">Student not found.</p>
      </>
    );
  }

  const openIdCardPreview = (idCardId) => {
    navigate(`/schools/${schoolId}/classes/${classId}/students/${studentId}/id-card/preview/${idCardId}`);
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      e.target.value = '';
      return;
    }
    setIsUploading(true);
    try {
      const fileToUpload = await compressImageForUpload(file);
      const res = await uploadStudentPhoto(student.id, fileToUpload, 'Photographer Desktop App');
      const photoUrl = res?.photoUrl;
      const fullUrl = photoUrl
        ? (photoUrl.startsWith('http') ? photoUrl : `${API_BASE_URL.replace(/\/$/, '')}${photoUrl.startsWith('/') ? photoUrl : '/' + photoUrl}`)
        : URL.createObjectURL(fileToUpload);
      setLocalPhotoUrl(fullUrl);
      if (!fromUploadedPhotos && !fromCorrections) {
        updateStudentStatus(classId, studentId, 'photo_uploaded', fullUrl);
      }
      alert('Successfully uploaded!');
    } catch (err) {
      alert(err?.message || 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const displayPhotoUrl = localPhotoUrl ?? student.photoUrl;

  return (
    <>
      <Header title="Student Details" showBack backTo={backTo} />
      <div className="student-detail-layout">
        <div className="card student-detail-card">
          <h3 style={{ marginBottom: 16 }}>Uploaded Photo</h3>
          {displayPhotoUrl ? (
            <div className="student-detail-photo-wrap">
              <img
                src={displayPhotoUrl}
                alt={student.name}
                className="student-detail-photo"
              />
            </div>
          ) : (
            <div className="student-detail-no-photo">
              <span className="upload-icon">📷</span>
              <p>No photo uploaded yet</p>
            </div>
          )}
        </div>
        <div className="card student-detail-info">
          <h3 style={{ marginBottom: 16 }}>Details</h3>
          <dl className="detail-list">
            <dt>Name</dt>
            <dd>{student.name}</dd>
            <dt>Student ID</dt>
            <dd>{student.studentId}</dd>
            <dt>Class</dt>
            <dd>{cls?.name || classId}</dd>
            <dt>School</dt>
            <dd>{school?.name || schoolId}</dd>
            <dt>Photo Status</dt>
            <dd><StatusBadge status={student.status} /></dd>
          </dl>
          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label
              className="btn btn-primary"
              style={{ cursor: isUploading ? 'wait' : 'pointer', marginBottom: 0 }}
            >
              {isUploading ? 'Uploading…' : (displayPhotoUrl ? 'Change Photo' : 'Upload Photo')}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                disabled={isUploading}
                onChange={handlePhotoUpload}
              />
            </label>
          </div>
        </div>
      </div>

      {savedIdCards.length > 0 && (
        <div className="card" style={{ marginTop: 24, maxWidth: 960 }}>
          <h3 style={{ marginBottom: 12 }}>Saved ID Cards</h3>
          <p className="text-muted" style={{ marginBottom: 16, fontSize: '0.9rem' }}>
            Click on any ID card to view its preview.
          </p>
          <ul className="saved-idcards-list">
            {savedIdCards.map((card) => {
              const template = getTemplateById(card.templateId);
              return (
                <li key={card.id}>
                  <button
                    type="button"
                    className="saved-idcard-item"
                    onClick={() => openIdCardPreview(card.id)}
                  >
                    <span className="saved-idcard-name">{card.name}</span>
                    <span className="text-muted saved-idcard-meta">
                      {template?.name || card.templateId} · {card.savedAt ? new Date(card.savedAt).toLocaleDateString() : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
