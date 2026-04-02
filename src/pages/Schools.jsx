import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { getAssignedSchools } from '../api/dashboard';

export default function Schools() {
  const navigate = useNavigate();
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
 
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await getAssignedSchools();
        if (!cancelled) setSchools(res.schools ?? []);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load schools');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <Header title="Assigned Schools" showBack backTo="/dashboard" />
      {error && <p className="text-danger" style={{ marginBottom: 16 }}>{error}</p>}
      {loading ? (
        <p className="text-muted">Loading schools...</p>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>School Name</th>
                <th>Address</th>
                <th>School Code</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schools.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted" style={{ padding: 24, textAlign: 'center' }}>No schools assigned yet.</td>
                </tr>
              ) : (
                schools.map((school) => (
                  <tr
                    key={school._id}
                    onClick={() => navigate(`/schools/${school._id}/classes`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td><strong>{school.schoolName}</strong></td>
                    <td>{school.address}</td>
                    <td>{school.schoolCode ?? '—'}</td>
                    <td><button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/schools/${school._id}/classes`); }}>Open Classes</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
