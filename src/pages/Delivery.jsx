import React, { useState, useEffect } from 'react';
import Header from '../components/Header';
import { getAssignedSchools, getClassesBySchool, updateDelivery } from '../api/dashboard';

export default function Delivery() {
  const [schools, setSchools] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [errorSchools, setErrorSchools] = useState('');
  const [errorClasses, setErrorClasses] = useState('');
  const [selectedSchool, setSelectedSchool] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingSchools(true);
    setErrorSchools('');
    getAssignedSchools()
      .then((data) => {
        if (!cancelled) {
          setSchools(data.schools ?? []);
          setLoadingSchools(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorSchools(err?.message || 'Failed to load schools');
          setLoadingSchools(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedSchool) {
      setClasses([]);
      setSelectedClass('');
      return;
    }
    let cancelled = false;
    setLoadingClasses(true);
    setErrorClasses('');
    getClassesBySchool(selectedSchool)
      .then((data) => {
        if (!cancelled) {
          setClasses(data.classes ?? []);
          setLoadingClasses(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorClasses(err?.message || 'Failed to load classes');
          setLoadingClasses(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedSchool]);

  const handleMarkDelivered = async () => {
    if (!selectedSchool || !selectedClass) {
      alert('Please select school and class.');
      return;
    }
    setSubmitting(true);
    try {
      const data = await updateDelivery(selectedSchool, selectedClass);
      const msg = data?.message || 'Done.';
      alert(msg);
    } catch (err) {
      alert(err?.message || 'Failed to update delivery.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Header title="Delivery Panel" />
      <div className="card" style={{ maxWidth: 480 }}>
        <h3 style={{ marginBottom: 20 }}>Mark Class as Delivered</h3>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>School</label>
          <select
            className="input-field"
            value={selectedSchool}
            onChange={(e) => { setSelectedSchool(e.target.value); setSelectedClass(''); }}
            disabled={loadingSchools}
          >
            <option value="">Select school</option>
            {schools.map((s) => (
              <option key={s._id} value={s._id}>{s.schoolName || s.schoolCode || s._id}</option>
            ))}
          </select>
          {loadingSchools && <p className="text-muted" style={{ marginTop: 6, fontSize: '0.9rem' }}>Loading schools…</p>}
          {errorSchools && <p className="text-danger" style={{ marginTop: 6, fontSize: '0.9rem' }}>{errorSchools}</p>}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>Class</label>
          <select
            className="input-field"
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            disabled={!selectedSchool || loadingClasses}
          >
            <option value="">Select class</option>
            {classes.map((c) => (
              <option key={c._id} value={c._id}>
                {c.className}{c.section ? ` – ${c.section}` : ''}
              </option>
            ))}
          </select>
          {loadingClasses && <p className="text-muted" style={{ marginTop: 6, fontSize: '0.9rem' }}>Loading classes…</p>}
          {errorClasses && <p className="text-danger" style={{ marginTop: 6, fontSize: '0.9rem' }}>{errorClasses}</p>}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleMarkDelivered}
          disabled={!selectedSchool || !selectedClass || submitting}
        >
          {submitting ? 'Updating…' : 'Mark Delivered'}
        </button>
      </div>
    </>
  );
}
