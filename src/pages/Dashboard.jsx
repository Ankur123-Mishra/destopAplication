import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import CreateSchoolForm from '../components/CreateSchoolForm';
import { addPhotoFileToMap, studentPhotoMatchKey, compressImageForUpload } from '../utils/imageUpload';
import {
  registerProjectBulkLocalPreviews,
  setProjectBulkPreviewServerUrl,
} from '../utils/projectBulkPhotoPreview';
import {
  getDashboard as getOfflineDashboard,
  getAssignedSchools as getOfflineSchools,
  getClassesBySchool,
  getStudentsBySchoolAndClass,
  uploadStudentPhoto,
  deletePhotographerSchool as deleteOfflineSchool,
  createSchool,
  bulkUploadStudentsXls,
} from '../api/dashboard';

import {
  getDashboard as getOnlineDashboard,
  getAssignedSchools as getOnlineSchools,
  deletePhotographerSchool as deleteOnlineSchool,
} from '../api/network_backend';

const defaultStats = {
  assignedSchools: 0,
  totalStudents: 0,
  photoPending: 0,
  photoUploaded: 0,
  correctionRequired: 0,
  deliveryPending: 0,
};

export default function Dashboard() {
  const { user, isSyncing, syncMessage, startGlobalSync } = useApp();
  const navigate = useNavigate();
  const DASH_CACHE_VERSION = 1;
  const makeCacheKey = (mode) => `dashboard_cache_v${DASH_CACHE_VERSION}:${mode}`;
  const readCache = (mode) => {
    try {
      const raw = sessionStorage.getItem(makeCacheKey(mode));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.stats || !Array.isArray(parsed.schools)) return null;
      return parsed;
    } catch {
      return null;
    }
  };
  const writeCache = (mode, payload) => {
    try {
      sessionStorage.setItem(makeCacheKey(mode), JSON.stringify(payload));
    } catch {
      // ignore cache write failures (storage full / private mode)
    }
  };

  const [viewMode, setViewMode] = useState('offline'); // online | offline
  const initialCache = readCache('offline');
  const [stats, setStats] = useState(initialCache?.stats ?? defaultStats);
  const [schools, setSchools] = useState(initialCache?.schools ?? []);
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalVersion, setCreateModalVersion] = useState(0);
  const [deletingSchoolId, setDeletingSchoolId] = useState(null);
  const [deleteConfirmTargetId, setDeleteConfirmTargetId] = useState(null);
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState([]);
  const [projectFolderExcel, setProjectFolderExcel] = useState(null);
  const projectFolderInputRef = useRef(null);
  const pendingPhotoFilesRef = useRef([]);
  pendingPhotoFilesRef.current = pendingPhotoFiles;

  const focusProjectNameInput = () => {
    const modal = document.querySelector('.create-project-modal');
    const projectNameInput = modal?.querySelector('input[data-project-name-input="true"]');
    if (!projectNameInput) return;
    projectNameInput.disabled = false;
    projectNameInput.readOnly = false;
    projectNameInput.focus();
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cached = readCache(viewMode);
      if (cached) {
        setStats(cached.stats);
        setSchools(cached.schools);
      }
      setLoading(!cached);
      setError('');
      try {
        const fetchDash = viewMode === 'online' ? getOnlineDashboard() : getOfflineDashboard();
        const fetchSchools = viewMode === 'online' ? getOnlineSchools() : getOfflineSchools();

        const [dashboardRes, schoolsRes] = await Promise.all([
          fetchDash,
          fetchSchools,
        ]);

        if (cancelled) return;
        const nextStats = {
          assignedSchools: dashboardRes.assignedSchools ?? 0,
          totalStudents: dashboardRes.totalStudents ?? 0,
          photoPending: dashboardRes.photoPending ?? 0,
          photoUploaded: dashboardRes.photoUploaded ?? 0,
          correctionRequired: dashboardRes.correctionsFromSchool ?? 0,
          deliveryPending: dashboardRes.deliveryPending ?? 0,
        };
        const nextSchools = schoolsRes.schools ?? [];
        setStats(nextStats);
        setSchools(nextSchools);
        writeCache(viewMode, { stats: nextStats, schools: nextSchools, cachedAt: Date.now() });
      } catch (err) {
        if (!cancelled) setError(err?.message || `Failed to load ${viewMode} dashboard`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [viewMode]);

  useEffect(() => {
    if (!createModalOpen) return undefined;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focusProjectNameInput();
      });
    });
    const timer = window.setTimeout(() => {
      focusProjectNameInput();
    }, 120);
    const onWindowFocus = () => {
      focusProjectNameInput();
    };
    window.addEventListener('focus', onWindowFocus);
    return () => {
      cancelAnimationFrame(outer);
      window.clearTimeout(timer);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [createModalOpen]);

  const closeCreateProjectModal = () => {
    setCreateModalOpen(false);
    setPendingPhotoFiles([]);
    setProjectFolderExcel(null);
  };

  const openCreateProjectModal = () => {
    setPendingPhotoFiles([]);
    setProjectFolderExcel(null);
    setCreateModalVersion((prev) => prev + 1);
    setCreateModalOpen(true);
  };

  const finishCreateProject = () => {
    closeCreateProjectModal();
    navigate('/view-template', { replace: true });
  };

  const triggerProjectFolderSelect = () => {
    if (projectFolderInputRef.current) projectFolderInputRef.current.click();
  };

  const isExcelFile = (f) => /\.(xls|xlsx)$/i.test(f.name || '');
  const isImageFile = (f) => {
    const name = f.name || '';
    if (f.type?.startsWith('image/')) return true;
    return /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(name);
  };

  const handleProjectFolderSelect = (e) => {
    const files = e.target.files;
    if (files?.length) {
      const list = Array.from(files);
      const excelFile = list.find(isExcelFile);
      const imageFiles = list.filter((f) => !isExcelFile(f) && isImageFile(f));
      setProjectFolderExcel(excelFile || null);
      setPendingPhotoFiles(imageFiles);
    }
    e.target.value = '';
    requestAnimationFrame(() => {
      focusProjectNameInput();
    });
  };

  // Excel ke baad: students se files match karke local blob previews register karo, phir uploads background mein.
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
          studentId: studentPhotoMatchKey(s),
        });
      });
    });
    const fileMap = {};
    files.forEach((file) => {
      addPhotoFileToMap(fileMap, file);
    });
    const pairs = [];
    for (const student of combined) {
      const idKey = String(student.studentId ?? '').trim().toLowerCase();
      const file = idKey ? fileMap[idKey] : null;
      if (file) {
        pairs.push({ studentId: student.id, file });
      }
    }
    if (pairs.length === 0) return;
    registerProjectBulkLocalPreviews(schoolId, pairs);

    void (async () => {
      for (const { studentId, file } of pairs) {
        try {
          const fileToUpload = await compressImageForUpload(file);
          const res = await uploadStudentPhoto(studentId, fileToUpload, 'Create Project bulk upload');
          if (res?.photoUrl) {
            setProjectBulkPreviewServerUrl(schoolId, studentId, res.photoUrl);
          }
        } catch (err) {
          console.error('Create Project bulk photo upload failed', studentId, err);
        }
      }
    })();
  };

  const handleDeleteSchool = (id, e) => {
    if (e) e.stopPropagation();
    setDeleteConfirmTargetId(id);
  };

  const cancelDeleteSchool = () => {
    setDeleteConfirmTargetId(null);
  };

  const confirmDeleteSchool = async () => {
    const id = deleteConfirmTargetId;
    if (!id) return;
    setDeleteConfirmTargetId(null);
    setError('');
    setDeletingSchoolId(id);
    try {
      if (viewMode === 'online') {
        await deleteOnlineSchool(id);
      } else {
        await deleteOfflineSchool(id);
      }
      setSchools((prev) => prev.filter((s) => s._id !== id && s.id !== id));
      const dash =
        viewMode === 'online' ? await getOnlineDashboard() : await getOfflineDashboard();
      setStats({
        assignedSchools: dash.assignedSchools ?? 0,
        totalStudents: dash.totalStudents ?? 0,
        photoPending: dash.photoPending ?? 0,
        photoUploaded: dash.photoUploaded ?? 0,
        correctionRequired: dash.correctionsFromSchool ?? 0,
        deliveryPending: dash.deliveryPending ?? 0,
      });
    } catch (err) {
      setError(err?.message || 'Failed to delete school');
    } finally {
      setDeletingSchoolId(null);
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

  return (
    <>
      <Header title={`Welcome, ${user?.name || 'Photographer'}`} />
      <div className="dashboard-top-row">
        <h2 className="page-title">Dashboard</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* isSyncing local display removed as it's now in the global Header, but keep button */}
          {user?.id !== 'offline-user' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={startGlobalSync}
              disabled={isSyncing}
            >
              {isSyncing ? "Syncing in Background..." : "Sync Data"}
            </button>
          )}
          <button
            id="dashboard-create-project-btn"
            type="button"
            className="btn btn-primary create-project-btn"
            disabled={isSyncing}
            onClick={openCreateProjectModal}
          >
            Create Project
          </button>
        </div>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Assigned Projects</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  className={`btn ${viewMode === 'offline' ? 'btn-primary' : 'btn-secondary'}`} 
                  onClick={() => setViewMode('offline')}
                  style={{ padding: '6px 14px', fontSize: '13px' }}>
                  Offline Projects
                </button>
                {user?.id !== 'offline-user' && (
                  <button 
                    className={`btn ${viewMode === 'online' ? 'btn-primary' : 'btn-secondary'}`} 
                    onClick={() => setViewMode('online')}
                    style={{ padding: '6px 14px', fontSize: '13px' }}>
                    Online Projects
                  </button>
                )}
              </div>
            </div>
            <div className="school-list">
              {schools.length === 0 ? (
                <p className="text-muted" style={{ padding: 16 }}>No schools assigned yet.</p>
              ) : (
                schools.map((school) => (
                  <div
                    key={school._id || school.id}
                    className="school-item"
                  >
                    <div>
                      <strong>{school.schoolName}</strong>
                      <p className="text-muted" style={{ fontSize: '0.9rem', marginTop: 4 }}>
                        {school.address}
                        {school.schoolCode && ` · ${school.schoolCode}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm school-delete-btn"
                      disabled={deletingSchoolId === (school._id || school.id)}
                      onClick={(e) => handleDeleteSchool(school._id || school.id, e)}
                      title="Delete School"
                    >
                      {deletingSchoolId === (school._id || school.id) ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      {createModalOpen && (
        <div className="create-project-modal-overlay" role="presentation">
          <div className="create-project-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="create-project-modal-title">
            <div className="create-project-modal-header">
              <h3 id="create-project-modal-title">Create Project</h3>
              <button type="button" className="create-project-modal-close" onClick={closeCreateProjectModal} aria-label="Close">&times;</button>
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
                  key={createModalVersion}
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
                  onCancel={closeCreateProjectModal}
                  showCancel
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmTargetId && (
        <div className="delete-confirm-overlay" role="presentation" onClick={cancelDeleteSchool}>
          <div
            className="delete-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-project-title" style={{ margin: 0, marginBottom: 10 }}>Delete Project</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              Are you sure you want to delete this project?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={cancelDeleteSchool}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmDeleteSchool}>
                Delete
              </button>
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
        .create-project-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10050; padding: 24px; box-sizing: border-box; }
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
        .school-item { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.06); cursor: default; }
        .school-item:last-child { border-bottom: none; }
        .school-delete-btn {
          margin-left: 12px;
          color: #ffb3b3;
          border-color: rgba(231, 76, 60, 0.55);
          background: rgba(231, 76, 60, 0.14);
        }
        .school-delete-btn:hover:not(:disabled) {
          color: #fff;
          background: rgba(231, 76, 60, 0.25);
          border-color: rgba(231, 76, 60, 0.8);
        }
        .create-project-photos-step { max-width: 100%; }
        .delete-confirm-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10060;
          padding: 24px;
          box-sizing: border-box;
        }
        .delete-confirm-modal {
          width: 100%;
          max-width: 420px;
          background: var(--card-bg, #1e1e2e);
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          padding: 18px;
        }
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
