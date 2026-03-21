import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import { getCorrections } from '../api/dashboard';

function formatDate(str) {
  if (!str) return '–';
  try {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? str : d.toLocaleString();
  } catch {
    return str;
  }
}

export default function Corrections() {
  useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getCorrections()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load corrections');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const summary = data?.summary ?? {};
  const schools = data?.schools ?? [];

  return (
    <>
      <Header title="Corrections" />
      <h2 className="page-title">Corrections</h2>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger, #e74c3c)' }}>
          <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading corrections...</p>
      ) : (
        <>
          {/* Summary */}
          <div className="corrections-summary card" style={{ marginBottom: 24 }}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Summary</h3>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="summary-value">{summary.totalSchools ?? 0}</span>
                <span className="summary-label">Schools</span>
              </div>
              <div className="summary-item">
                <span className="summary-value">{summary.totalClasses ?? 0}</span>
                <span className="summary-label">Classes</span>
              </div>
              <div className="summary-item">
                <span className="summary-value">{summary.totalCorrections ?? 0}</span>
                <span className="summary-label">Total Corrections</span>
              </div>
            </div>
          </div>

          {schools.length === 0 ? (
            <div className="card">
              <p className="text-muted" style={{ margin: 0 }}>No corrections found.</p>
            </div>
          ) : (
            <div className="corrections-schools">
              {schools.map((school) => (
                <div key={school._id} className="card corrections-school" style={{ marginBottom: 24 }}>
                  <div className="school-header">
                    <h3 style={{ margin: '0 0 8px 0' }}>{school.schoolName}</h3>
                    {school.schoolCode && (
                      <span className="text-muted" style={{ fontSize: '0.9rem' }}>Code: {school.schoolCode}</span>
                    )}
                    {school.address && (
                      <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>{school.address}</p>
                    )}
                    <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>
                      {school.totalCorrections ?? 0} correction(s) in {school.totalClasses ?? 0} class(es)
                    </p>
                  </div>

                  {(school.classes ?? []).map((cls) => (
                    <div key={cls._id} className="corrections-class" style={{ marginTop: 20 }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>
                        Class {cls.className} – Section {cls.section}
                        <span className="badge" style={{ marginLeft: 8 }}>{cls.correctionCount ?? 0} correction(s)</span>
                      </h4>

                      <div className="table-container">
                        <table className="corrections-table">
                          <thead>
                            <tr>
                              <th>Student Name</th>
                              <th>Admission No</th>
                              <th>Roll No</th>
                              <th>Father Name</th>
                              <th>Mobile</th>
                              <th>Status</th>
                              <th>Corrections</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(cls.students ?? []).map((student) => {
                              const goToUploadPhoto = () => {
                                navigate(
                                  `/schools/${school._id}/classes/${cls._id}/students/${student._id}/detail`,
                                  {
                                    state: {
                                      from: 'corrections',
                                      student: {
                                        id: student._id,
                                        name: student.studentName ?? '–',
                                        studentId: student.admissionNo || student.rollNo || student._id,
                                        photoUrl: student.photoUrl ?? null,
                                        status: student.status ?? 'correction_required',
                                      },
                                      school,
                                      class: cls,
                                    },
                                  }
                                );
                              };
                              return (
                                <tr
                                  key={student._id}
                                  className="corrections-student-row"
                                  onClick={goToUploadPhoto}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => e.key === 'Enter' && goToUploadPhoto()}
                                >
                                  <td>{student.studentName ?? '–'}</td>
                                  <td>{student.admissionNo ?? '–'}</td>
                                  <td>{student.rollNo ?? '–'}</td>
                                  <td>{student.fatherName ?? '–'}</td>
                                  <td>{student.mobile ?? '–'}</td>
                                  <td>
                                    <span className={`status-badge status-${(student.status || '').replace('_', '-')}`}>
                                      {student.status ?? '–'}
                                    </span>
                                  </td>
                                  <td>
                                    <div className="corrections-list">
                                      {(student.corrections ?? []).map((cor) => (
                                        <div key={cor._id} className="correction-item">
                                          <span className="correction-comment">{cor.comment ?? '–'}</span>
                                          <span className="correction-meta">
                                            {cor.status ?? 'pending'} · {formatDate(cor.createdAt)}
                                          </span>
                                        </div>
                                      ))}
                                      {(!student.corrections || student.corrections.length === 0) && '–'}
                                    </div>
                                  </td>
                                  <td onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      onClick={goToUploadPhoto}
                                    >
                                      Upload Photo
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <style>{`
        .corrections-summary .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 16px;
        }
        .corrections-summary .summary-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .corrections-summary .summary-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--accent, #3498db);
        }
        .corrections-summary .summary-label {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .corrections-school .school-header {
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          background: rgba(231, 76, 60, 0.2);
          color: var(--danger, #e74c3c);
          font-size: 0.8rem;
          font-weight: 600;
        }
        .corrections-table { width: 100%; border-collapse: collapse; }
        .corrections-table th,
        .corrections-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .corrections-student-row { cursor: pointer; }
        .corrections-student-row:hover { background: rgba(255,255,255,0.04); }
        .corrections-table th { font-weight: 600; color: var(--text-muted); font-size: 0.85rem; }
        .corrections-table td { font-size: 0.9rem; }
        .corrections-list { display: flex; flex-direction: column; gap: 6px; }
        .correction-item { display: flex; flex-direction: column; gap: 2px; }
        .correction-comment { font-weight: 500; }
        .correction-meta { font-size: 0.8rem; color: var(--text-muted); }
        .status-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.8rem;
        }
        .status-correction-pending { background: rgba(241, 196, 15, 0.2); color: #f1c40f; }
        .status-pending { background: rgba(241, 196, 15, 0.2); color: #f1c40f; }
      `}</style>
    </>
  );
}
