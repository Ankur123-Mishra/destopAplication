import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import CreateSchoolForm from '../components/CreateSchoolForm';
import {
  getDashboard,
  getAssignedSchools,
  getClassesBySchool,
  getStudentsBySchoolAndClass,
  uploadStudentPhoto,
} from '../api/dashboard';

const defaultStats = {
  assignedSchools: 0,
  totalStudents: 0,
  photoPending: 0,
  photoUploaded: 0,
  correctionRequired: 0,
  deliveryPending: 0,
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useApp();
  const [stats, setStats] = useState(defaultStats);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState([]);
  const [projectFolderExcel, setProjectFolderExcel] = useState(null);
  const projectFolderInputRef = useRef(null);
  const pendingPhotoFilesRef = useRef([]);
  pendingPhotoFilesRef.current = pendingPhotoFiles;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [dashboardRes, schoolsRes] = await Promise.all([
          getDashboard(),
          getAssignedSchools(),
        ]);
        console.log(dashboardRes);

        if (cancelled) return;
        setStats({
          assignedSchools: dashboardRes.assignedSchools ?? 0,
          totalStudents: dashboardRes.totalStudents ?? 0,
          photoPending: dashboardRes.photoPending ?? 0,
          photoUploaded: dashboardRes.photoUploaded ?? 0,
          correctionRequired: dashboardRes.correctionsFromSchool ?? 0,
          deliveryPending: dashboardRes.deliveryPending ?? 0,
        });
        setSchools(schoolsRes.schools ?? []);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const finishCreateProject = () => {
    setCreateModalOpen(false);
    setPendingPhotoFiles([]);
    setProjectFolderExcel(null);
    navigate('/class-id-cards', { replace: true });
  };

  const triggerProjectFolderSelect = () => {
    if (projectFolderInputRef.current) projectFolderInputRef.current.click();
  };

  const handleProjectFolderSelect = (e) => {
    const files = e.target.files;
    if (files?.length) {
      const list = Array.from(files);
      const excelFile = list.find((f) => /\.(xls|xlsx)$/i.test(f.name || ''));
      const imageFiles = list.filter((f) => f.type?.startsWith('image/'));
      setProjectFolderExcel(excelFile || null);
      setPendingPhotoFiles(imageFiles);
    }
    e.target.value = '';
  };

  const uploadPhotosAfterExcel = async (schoolId) => {
    const files = pendingPhotoFilesRef.current;
    if (!files?.length) return;
    const classesRes = await getClassesBySchool(schoolId);
    const classes = classesRes.classes ?? [];
    if (classes.length === 0) return;
    const studentResList = await Promise.all(
      classes.map((cls) => getStudentsBySchoolAndClass(schoolId, cls._id))
    );
    const combined = [];
    studentResList.forEach((sr) => {
      (sr.students ?? []).forEach((s) => {
        combined.push({
          id: s._id,
          studentId: s.admissionNo || s.rollNo || s.uniqueCode || '—',
        });
      });
    });
    const fileMap = {};
    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const baseName = (file.name || '').split(/[/\\]/).pop() || file.name || '';
      const nameWithoutExt = baseName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
      if (nameWithoutExt) fileMap[nameWithoutExt] = file;
    });
    for (const student of combined) {
      const idKey = String(student.studentId ?? '').trim().toLowerCase();
      const file = idKey ? fileMap[idKey] : null;
      if (file) {
        await uploadStudentPhoto(student.id, file, 'Create Project bulk upload');
      }
    }
  };

  const cards = [
    { label: 'Assigned Schools', value: stats.assignedSchools, icon: '🏫' },
    { label: 'Total Students', value: stats.totalStudents, icon: '👥' },
    { label: 'Photo Pending', value: stats.photoPending, icon: '🟡' },
    { label: 'Photo Uploaded', value: stats.photoUploaded, icon: '🔵' },
    // { label: 'Correction From School', value: stats.correctionRequired, icon: '⚠️' },
    // { label: 'Delivery Pending', value: stats.deliveryPending, icon: '📦' },
  ];

  console.log("stats", stats);

  return (
    <>
      <Header title={`Welcome, ${user?.name || 'Photographer'}`} />
      <div className="dashboard-top-row">
        <h2 className="page-title">Dashboard</h2>
        <button
          type="button"
          className="btn btn-primary create-project-btn"
          onClick={() => {
            setCreateModalOpen(true);
            setPendingPhotoFiles([]);
            setProjectFolderExcel(null);
          }}
        >
          Create Project
        </button>
      </div>
      {error && <p className="dashboard-error">{error}</p>}
      {loading ? (
        <p className="text-muted">Loading dashboard...</p>
      ) : (
        <>
          <div className="dashboard-cards">
            {cards.map((c) => (
              <div key={c.label} className="stat-card card">
                <span className="stat-icon">{c.icon}</span>
                <span className="stat-value">{c.value}</span>
                <span className="stat-label">{c.label}</span>
              </div>
            ))}
          </div>
          <div className="card dashboard-assigned-schools">
            <h3 style={{ marginBottom: 16 }}>Assigned Schools</h3>
            <div className="school-list">
              {schools.length === 0 ? (
                <p className="text-muted" style={{ padding: 16 }}>No schools assigned yet.</p>
              ) : (
                schools.map((school) => (
                  <div
                    key={school._id}
                    className="school-item"
                    onClick={() => navigate(`/schools/${school._id}/classes`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/schools/${school._id}/classes`)}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <strong>{school.schoolName}</strong>
                      <p className="text-muted" style={{ fontSize: '0.9rem', marginTop: 4 }}>
                        {school.address}
                        {school.schoolCode && ` · ${school.schoolCode}`}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      {createModalOpen && (
        <div className="create-project-modal-overlay" onClick={() => setCreateModalOpen(false)} role="presentation">
          <div className="create-project-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="create-project-modal-title">
            <div className="create-project-modal-header">
              <h3 id="create-project-modal-title">Create Project</h3>
              <button type="button" className="create-project-modal-close" onClick={finishCreateProject} aria-label="Close">&times;</button>
            </div>
            <div className="create-project-modal-body">
              <div className="card" style={{ maxWidth: '100%' }}>
                <input
                  ref={projectFolderInputRef}
                  type="file"
                  webkitdirectory=""
                  directory=""
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleProjectFolderSelect}
                />
                <CreateSchoolForm
                  labelAsProject
                  externalExcelFile={projectFolderExcel}
                  projectFolderField={
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={triggerProjectFolderSelect}
                      >
                        📁 Select project folder
                      </button>
                      {(projectFolderExcel || pendingPhotoFiles.length > 0) && (
                        <p className="text-muted" style={{ marginTop: 8, fontSize: '0.9rem' }}>
                          {projectFolderExcel && <span>Excel: {projectFolderExcel.name}</span>}
                          {projectFolderExcel && pendingPhotoFiles.length > 0 && ' · '}
                          {pendingPhotoFiles.length > 0 && <span>{pendingPhotoFiles.length} photo(s)</span>}
                        </p>
                      )}
                    </>
                  }
                  onExcelUploadDone={uploadPhotosAfterExcel}
                  onSuccess={finishCreateProject}
                  onCancel={() => setCreateModalOpen(false)}
                  showCancel
                />
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .dashboard-top-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
        .create-project-btn { flex-shrink: 0; }
        .dashboard-error { color: var(--danger, #e74c3c); margin-bottom: 16px; }
        .dashboard-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
        .dashboard-assigned-schools { margin-top: 24px; max-width: 800px; width: 100%; box-sizing: border-box; }
        .create-project-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 24px; box-sizing: border-box; }
        .create-project-modal { background: var(--card-bg, #1e1e2e); border-radius: 12px; max-width: 600px; width: 100%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
        .create-project-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
        .create-project-modal-header h3 { margin: 0; font-size: 1.25rem; }
        .create-project-modal-close { background: none; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer; padding: 0 8px; line-height: 1; }
        .create-project-modal-close:hover { color: #fff; }
        .create-project-modal-body { padding: 20px; overflow-y: auto; flex: 1; }
        .stat-card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px; }
        .stat-icon { font-size: 2rem; }
        .stat-value { font-size: 1.75rem; font-weight: 700; color: var(--accent); }
        .stat-label { font-size: 0.9rem; color: var(--text-muted); text-align: center; }
        .school-list { display: flex; flex-direction: column; gap: 0; }
        .school-item { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.06); cursor: pointer; transition: background 0.2s; }
        .school-item:hover { background: rgba(255,255,255,0.04); }
        .school-item:last-child { border-bottom: none; }
        .create-project-photos-step { max-width: 100%; }
        .bulk-upload-result {
          padding: 12px 16px;
          background: rgba(76, 175, 80, 0.12);
          border: 1px solid rgba(76, 175, 80, 0.3);
          border-radius: 8px;
          font-size: 0.9rem;
        }
      `}</style>
    </>
  );
}
