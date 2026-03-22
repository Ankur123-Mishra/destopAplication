import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import {
  getAssignedSchools,
  getClassesBySchool,
  getStudentsBySchoolAndClass,
  uploadStudentPhoto,
} from '../api/dashboard';
import { API_BASE_URL } from '../api/config';
import { compressImageForUpload } from '../utils/imageUpload';

function mapApiStudent(s) {
  return {
    id: s._id,
    name: s.studentName,
    studentId: s.admissionNo || s.rollNo || s.uniqueCode || '—',
    admissionNo: s.admissionNo || '',
    rollNo: s.rollNo != null ? String(s.rollNo).trim() : '',
    uniqueCode: s.uniqueCode || '',
    dateOfBirth: s.dateOfBirth || s.dob || '',
    phone: s.phone || s.mobile || s.contactNo || '',
    email: s.email || '',
    address: s?.address || '',
    status: s.status,
    dimension: s?.schoolId?.dimension,
    dimensionUnit: s?.schoolId?.dimensionUnit ?? 'mm',
    photoUrl: s.photoUrl,
  };
}

const VIEW = { SCHOOLS: 'schools', CLASSES: 'classes', STUDENTS: 'students' };

/**
 * Uploaded Photos (Class-wise):
 * 1) School list (API: /api/photographer/schools/assigned)
 * 2) On school click → Class list (API: /api/photographer/classes/:schoolId)
 * 3) On class click → Students list with Upload, View, Upload all, Create ID card
 */
export default function ClassWiseUploadedPhotos() {
  const navigate = useNavigate();
  const [view, setView] = useState(VIEW.SCHOOLS);
  const [schools, setSchools] = useState([]);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [selectedClass, setSelectedClass] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadedPhotos, setUploadedPhotos] = useState({}); // local override: { [studentId]: objectUrl }
  const [bulkUploadMessage, setBulkUploadMessage] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [uploadingStudentId, setUploadingStudentId] = useState(null); // loading state for single upload
  const fileInputRefs = useRef({});
  const bulkUploadInputRef = useRef(null);

  // Load schools on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await getAssignedSchools();
        if (cancelled) return;
        setSchools(res.schools ?? []);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load schools');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Load classes when school selected
  useEffect(() => {
    if (!selectedSchool) return;
    let cancelled = false;
    setView(VIEW.CLASSES);
    setLoading(true);
    setError('');
    getClassesBySchool(selectedSchool._id)
      .then((res) => {
        if (!cancelled) {
          setClasses(res.classes ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load classes');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedSchool]);

  // Load students when class selected
  useEffect(() => {
    if (!selectedSchool || !selectedClass) return;
    let cancelled = false;
    setView(VIEW.STUDENTS);
    setLoading(true);
    setError('');
    setUploadedPhotos({});
    setBulkUploadMessage(null);
    getStudentsBySchoolAndClass(selectedSchool._id, selectedClass._id)
      .then((res) => {
        if (!cancelled) {
          setStudents((res.students ?? []).map(mapApiStudent));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load students');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedSchool, selectedClass]);

  const goBackToSchools = () => {
    setView(VIEW.SCHOOLS);
    setSelectedSchool(null);
    setSelectedClass(null);
    setClasses([]);
    setStudents([]);
    setError('');
  };

  const goBackToClasses = () => {
    setView(VIEW.CLASSES);
    setSelectedClass(null);
    setStudents([]);
    setError('');
  };

  const goBackToStudents = () => {
    setView(VIEW.STUDENTS);
    setError('');
  };

  const triggerFileInput = (studentId) => {
    const el = fileInputRefs.current[studentId];
    if (el) el.click();
  };

  const handlePhotoUpload = async (e, studentId) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      e.target.value = '';
      return;
    }
    setUploadingStudentId(studentId);
    try {
      const fileToUpload = await compressImageForUpload(file);
      const deviceInfo = 'Photographer Desktop App';
      const res = await uploadStudentPhoto(studentId, fileToUpload, deviceInfo);
      const photoUrl = res?.photoUrl;
      const fullUrl = photoUrl
        ? (photoUrl.startsWith('http') ? photoUrl : `${API_BASE_URL.replace(/\/$/, '')}${photoUrl.startsWith('/') ? photoUrl : '/' + photoUrl}`)
        : URL.createObjectURL(fileToUpload);
      setUploadedPhotos((prev) => ({ ...prev, [studentId]: fullUrl }));
      setStudents((prev) => prev.map((s) => (s.id === studentId ? { ...s, photoUrl: fullUrl } : s)));
      alert('Successfully uploaded!');
    } catch (err) {
      alert(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingStudentId(null);
      e.target.value = '';
    }
  };

  const triggerBulkFolderUpload = () => {
    if (bulkUploadInputRef.current) bulkUploadInputRef.current.click();
  };

  const handleBulkFolderSelect = async (e) => {
    const files = e.target.files;
    if (!files?.length || !selectedClass) {
      e.target.value = '';
      return;
    }
    // Folder images named by Student ID (e.g. 100012.jpeg) — match by studentId. Upload one-by-one to avoid 413 Payload Too Large.
    const fileMap = {};
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      const baseName = (file.name || '').split(/[/\\]/).pop() || file.name || '';
      const nameWithoutExt = baseName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
      if (nameWithoutExt) fileMap[nameWithoutExt] = file;
    }
    const pairs = []; // { student, file }
    const noMatch = [];
    students.forEach((student) => {
      const idKey = String(student.studentId ?? '').trim().toLowerCase();
      const file = idKey ? fileMap[idKey] : null;
      if (file) {
        pairs.push({ student, file });
      } else {
        noMatch.push(student.studentId || student.name);
      }
    });
    if (pairs.length === 0) {
      alert('No matching photos found. Folder images should be named by Student ID (e.g. 100012.jpeg, 100013.webp).');
      e.target.value = '';
      return;
    }
    setBulkUploading(true);
    setError('');
    try {
      for (const { student, file } of pairs) {
        await uploadStudentPhoto(student.id, file, 'Bulk folder upload');
      }
      // Refetch students so photoUrls update from server
      const res = await getStudentsBySchoolAndClass(selectedSchool._id, selectedClass._id);
      setStudents((res.students ?? []).map(mapApiStudent));
      setUploadedPhotos({});
      setBulkUploadMessage({
        uploaded: pairs.length,
        total: students.length,
        noMatch: noMatch.slice(0, 5),
        noMatchTotal: noMatch.length,
      });
    } catch (err) {
      setError(err?.message || 'Bulk upload failed. Please try again.');
      alert(err?.message || 'Bulk upload failed. Please try again.');
    } finally {
      setBulkUploading(false);
      e.target.value = '';
    }
  };

  const getStudentPhotoUrl = (student) => {
    const raw = uploadedPhotos[student.id] ?? student.photoUrl ?? null;
    if (!raw) return null;
    if (typeof raw === 'string' && (raw.startsWith('http') || raw.startsWith('blob:'))) return raw;
    const base = API_BASE_URL.replace(/\/$/, '');
    return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
  };

  const openView = (student) => {
    const photoUrl = getStudentPhotoUrl(student);
    navigate(
      `/schools/${selectedSchool._id}/classes/${selectedClass._id}/students/${student.id}/detail`,
      {
        state: {
          from: 'uploaded-photos',
          student: { ...student, photoUrl },
          school: selectedSchool,
          class: selectedClass,
        },
      }
    );
  };

  const openCreateIdCard = () => {
    navigate(
      `/class-id-cards/students/${selectedSchool._id}/${selectedClass._id}`,
      {
        state: {
          fromUploadedPhotos: true,
          school: selectedSchool,
          class: selectedClass,
          students: students.map((s) => ({ ...s, photoUrl: getStudentPhotoUrl(s) })),
        },
      }
    );
  };

  const classLabel = selectedClass
    ? `Class ${selectedClass.className}${selectedClass.section ? ` – ${selectedClass.section}` : ''}`
    : '';

  // —— View: Schools list ——
  if (view === VIEW.SCHOOLS) {
    return (
      <>
        <Header title="Uploaded Photos (Class-wise)" />
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Select a school to see its classes, then select a class to upload or view photos.
        </p>
        {error && <p className="text-danger" style={{ marginBottom: 16 }}>{error}</p>}
        {loading ? (
          <p className="text-muted">Loading schools...</p>
        ) : schools.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <p className="text-muted">No schools assigned yet.</p>
          </div>
        ) : (
          <div className="school-list-upload">
            {schools.map((school) => (
              <div
                key={school._id}
                className="card school-item-upload"
                onClick={() => setSelectedSchool(school)}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedSchool(school)}
                role="button"
                tabIndex={0}
              >
                <strong>{school.schoolName}</strong>
                <p className="text-muted" style={{ fontSize: '0.9rem', marginTop: 4, marginBottom: 0 }}>
                  {school.address}
                  {school.schoolCode && ` · ${school.schoolCode}`}
                </p>
              </div>
            ))}
          </div>
        )}
        <style>{`
          .school-list-upload { display: flex; flex-direction: column; gap: 12px; }
          .school-item-upload { cursor: pointer; padding: 16px 20px; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; border: 1px solid rgba(255,255,255,0.08); }
          .school-item-upload:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.25); border-color: var(--accent); }
        `}</style>
      </>
    );
  }

  // —— View: Classes list ——
  if (view === VIEW.CLASSES) {
    return (
      <>
        <Header title="Uploaded Photos (Class-wise)" showBack backTo="/uploaded-photos" />
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={goBackToSchools}>
            ← Back to schools
          </button>
          {selectedSchool && (
            <span className="text-muted">
              School: <strong>{selectedSchool.schoolName}</strong>
            </span>
          )}
        </div>
        {error && <p className="text-danger" style={{ marginBottom: 16 }}>{error}</p>}
        {loading ? (
          <p className="text-muted">Loading classes...</p>
        ) : classes.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <p className="text-muted">No classes in this school.</p>
          </div>
        ) : (
          <div className="class-list-for-upload">
            {classes.map((cls) => (
              <button
                key={cls._id}
                type="button"
                className="card class-list-card"
                onClick={() => setSelectedClass(cls)}
              >
                <span className="class-list-card-name">
                  Class {cls.className}{cls.section ? ` – ${cls.section}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
        <style>{`
          .class-list-for-upload { display: flex; flex-direction: column; gap: 12px; }
          .class-list-card {
            display: flex; flex-direction: column; align-items: flex-start;
            padding: 16px 20px; text-align: left; cursor: pointer;
            border: 1px solid rgba(255,255,255,0.08);
            transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
            color: var(--text); background: var(--card-bg, rgba(255,255,255,0.03));
          }
          .class-list-card:hover {
            transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.25);
            border-color: var(--accent);
          }
          .class-list-card-name { font-weight: 600; font-size: 1.1rem; }
        `}</style>
      </>
    );
  }

  // —— View: Students list (Upload, View, Upload all, Create ID card) ——
  return (
    <>
      <Header title="Uploaded Photos (Class-wise)" showBack backTo="/uploaded-photos" />
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={goBackToClasses}>
          ← Back to classes
        </button>
        {selectedSchool && selectedClass && (
          <span className="text-muted">
            {selectedSchool.schoolName} → <strong>{classLabel}</strong> — {students.length} student(s)
          </span>
        )}
      </div>
      {error && <p className="text-danger" style={{ marginBottom: 16 }}>{error}</p>}
      {loading ? (
        <p className="text-muted">Loading students...</p>
      ) : (
        <div className="uploaded-class-section card">
          <input
            ref={bulkUploadInputRef}
            type="file"
            accept="image/*"
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: 'none' }}
            onChange={handleBulkFolderSelect}
          />
          <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={bulkUploading}
              onClick={triggerBulkFolderUpload}
              title="Select folder where images are named by Student ID (e.g. 100012.jpeg, 100013.webp)"
            >
              {bulkUploading ? '⏳ Uploading…' : "📁 Upload all students' photos at once (from folder)"}
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreateIdCard}>
              Create ID card for this class
            </button>
          </div>
          {bulkUploadMessage && (
            <div className="bulk-upload-result">
              <strong>{bulkUploadMessage.uploaded}</strong> photo(s) uploaded (of {bulkUploadMessage.total} students).
              {bulkUploadMessage.noMatchTotal > 0 && (
                <span className="text-muted">
                  {' '}No matching photo for {bulkUploadMessage.noMatchTotal} student(s)
                  {bulkUploadMessage.noMatch.length > 0 && ` (e.g. ${bulkUploadMessage.noMatch.join(', ')})`}.
                  Filename should match Student ID.
                </span>
              )}
              <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 8 }} onClick={() => setBulkUploadMessage(null)}>Dismiss</button>
            </div>
          )}
          <div className="uploaded-students-grid">
            {students.map((student) => {
              console.log("student", student);
              const photoUrl = getStudentPhotoUrl(student);
              console.log("photoUrl", photoUrl);
              const hasPhoto = !!photoUrl;
              return (
                <div key={student.id} className="uploaded-student-card">
                  <input
                    ref={(el) => { fileInputRefs.current[student.id] = el; }}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => handlePhotoUpload(e, student.id)}
                  />
                  <div
                    className="uploaded-student-photo-wrap clickable-photo"
                    onClick={() => triggerFileInput(student.id)}
                    onKeyDown={(e) => e.key === 'Enter' && triggerFileInput(student.id)}
                    role="button"
                    tabIndex={0}
                    title={hasPhoto ? 'Change photo' : 'Upload photo'}
                  >
                    {photoUrl ? (
                      <img
                        key={`photo-${student.id}-${String(photoUrl).slice(-24)}`}
                        src={photoUrl}
                        alt={student.name}
                        className="uploaded-student-photo"
                      />
                    ) : (
                      <div className="uploaded-student-placeholder">
                        <span>📷</span>
                        <span className="upload-hint">Upload</span>
                      </div>
                    )}
                  </div>
                  <div className="uploaded-student-info">
                    <span className="uploaded-student-name">{student.name}</span>
                    <span className="uploaded-student-id">{student.studentId}</span>
                  </div>
                  <div className="uploaded-student-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary btn-upload-inline"
                      disabled={uploadingStudentId === student.id}
                      onClick={(e) => { e.stopPropagation(); triggerFileInput(student.id); }}
                    >
                      {uploadingStudentId === student.id ? 'Uploading…' : (hasPhoto ? 'Change' : 'Upload')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary btn-detail-inline"
                      onClick={(e) => { e.stopPropagation(); openView(student); }}
                    >
                      View
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}



      <style>{`
        .uploaded-class-section { padding: 20px; }
        .uploaded-students-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }
        .uploaded-student-card {
          display: flex; flex-direction: column; align-items: center; padding: 10px;
          border-radius: 10px; background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
        }
        .uploaded-student-card:hover {
          transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.25);
          border-color: var(--accent);
        }
        .uploaded-student-photo-wrap {
          width: 56px; height: 56px; border-radius: 50%; overflow: hidden; margin-bottom: 6px; flex-shrink: 0;
        }
        .uploaded-student-photo { width: 100%; height: 100%; object-fit: cover; }
        .uploaded-student-placeholder {
          width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.08); font-size: 1.2rem; gap: 2px;
        }
        .uploaded-student-placeholder .upload-hint { font-size: 0.6rem; opacity: 0.9; }
        .clickable-photo { cursor: pointer; }
        .uploaded-student-info { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }
        .uploaded-student-name { font-weight: 600; font-size: 0.8rem; line-height: 1.2; }
        .uploaded-student-id { font-size: 0.7rem; color: var(--text-muted); }
        .uploaded-student-actions {
          display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; width: 100%;
          justify-content: center; align-items: center;
        }
        .uploaded-student-actions .btn { padding: 6px 10px; font-size: 0.8rem; }
        .btn-upload-inline, .btn-detail-inline { flex: 0 0 auto; }
        .bulk-upload-result {
          padding: 12px 16px; margin-bottom: 16px;
          background: rgba(76, 175, 80, 0.12); border: 1px solid rgba(76, 175, 80, 0.3);
          border-radius: 8px; font-size: 0.9rem; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
        }
      `}</style>
    </>
  );
}
