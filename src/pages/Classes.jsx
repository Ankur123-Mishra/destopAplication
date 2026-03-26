import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { getClassesBySchool, getAssignedSchools } from '../api/dashboard';

export default function Classes() {
  const navigate = useNavigate();
  const { schoolId } = useParams();
  const [classes, setClasses] = useState([]);
  const [schoolName, setSchoolName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [classesRes, schoolsRes] = await Promise.all([
          getClassesBySchool(schoolId),
          getAssignedSchools(),
        ]);
        if (cancelled) return;
        setClasses(classesRes.classes ?? []);
        const school = (schoolsRes.schools ?? []).find((s) => s._id === schoolId);
        setSchoolName(school?.schoolName ?? 'School');
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load classes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [schoolId]);

  const firstClassId = classes[0]?._id;

  return (
    <>
      <Header title={`${schoolName} – Classes`} showBack backTo="/schools" />
      {error && <p className="text-danger" style={{ marginBottom: 16 }}>{error}</p>}
      {loading ? (
        <p className="text-muted">Loading classes...</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            {/* <button
              type="button"
              className="btn btn-secondary"
              onClick={() => firstClassId && navigate(`/schools/${schoolId}/classes/${firstClassId}/correction`)}
              disabled={!firstClassId}
            >
              Correction List
            </button> */}
          </div>
          <div className="class-grid">
            {classes.length === 0 ? (
              <p className="text-muted">No classes in this school.</p>
            ) : (
              classes.map((cls) => (
                <div
                  key={cls._id}
                  className="card class-card"
                  onClick={() => navigate(`/schools/${schoolId}/classes/${cls._id}/students`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/schools/${schoolId}/classes/${cls._id}/students`)}
                  role="button"
                  tabIndex={0}
                >
                  <h3>Class {cls.className}{cls.section ? ` – ${cls.section}` : ''}</h3>
                  <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={(e) => { e.stopPropagation(); navigate(`/schools/${schoolId}/classes/${cls._id}/students`); }}
                    >
                      Student List
                    </button>
                    {/* <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => { e.stopPropagation(); navigate(`/schools/${schoolId}/classes/${cls._id}/bulk`); }}
                    >
                      Bulk Mode
                    </button> */}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
      <style>{`
        .class-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
        .class-card { cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
        .class-card:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(0,0,0,0.3); }
      `}</style>
    </>
  );
}
