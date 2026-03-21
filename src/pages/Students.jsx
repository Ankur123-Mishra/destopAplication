import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import StudentTable from '../components/StudentTable';
import { getStudentsBySchoolAndClass, getAssignedSchools, getClassesBySchool } from '../api/dashboard';

function mapApiStudent(apiStudent) {
  return {
    id: apiStudent._id,
    name: apiStudent.studentName,
    studentId: apiStudent.admissionNo || apiStudent.rollNo || apiStudent.uniqueCode || '—',
    status: apiStudent.status,
    photoUrl: apiStudent.photoUrl,
  };
}

export default function Students() {
  const navigate = useNavigate();
  const { schoolId, classId } = useParams();
  const [students, setStudents] = useState([]);
  const [headerTitle, setHeaderTitle] = useState('Students');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!schoolId || !classId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [studentsRes, schoolsRes, classesRes] = await Promise.all([
          getStudentsBySchoolAndClass(schoolId, classId),
          getAssignedSchools(),
          getClassesBySchool(schoolId),
        ]);
        if (cancelled) return;
        setStudents((studentsRes.students ?? []).map(mapApiStudent));
        const school = (schoolsRes.schools ?? []).find((s) => s._id === schoolId);
        const cls = (classesRes.classes ?? []).find((c) => c._id === classId);
        const schoolName = school?.schoolName ?? 'School';
        const classLabel = cls ? `Class ${cls.className}${cls.section ? ` – ${cls.section}` : ''}` : 'Class';
        setHeaderTitle(`${schoolName} – ${classLabel}`);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load students');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [schoolId, classId]);

  // const openCamera = (student) => {
  //   navigate(`/schools/${schoolId}/classes/${classId}/students/${student.id}/camera`);
  // };

  const openUpload = (student) => {
    navigate(`/schools/${schoolId}/classes/${classId}/students/${student.id}/id-card`);
  };

  return (
    <>
      <Header title={headerTitle} showBack backTo={`/schools/${schoolId}/classes`} />
      {error && <p className="text-danger" style={{ marginBottom: 16 }}>{error}</p>}
      {loading ? (
        <p className="text-muted">Loading students...</p>
      ) : (
        <>
          <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/schools/${schoolId}/classes/${classId}/correction`)}
            >
              Correction List
            </button>
          </div>

          <h3 style={{ marginBottom: 12 }}>All students</h3>
          <StudentTable
            students={students}
            onUpload={openUpload}
            onRowClick={openUpload}
          />
        </>
      )}
    </>
  );
}
