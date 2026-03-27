import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import IdCardRenderer from '../components/IdCardRenderer';
import IdCardBackPreview from '../components/IdCardBackPreview';
import IdCardCanvasEditor from '../components/IdCardCanvasEditor';
import { ID_CARD_TEMPLATES } from '../data/idCardTemplates';
import { getFabricTemplates } from '../data/fabricTemplatesStorage';
import { getUploadedTemplates, saveUploadedTemplate, getUploadedTemplateById } from '../data/uploadedTemplatesStorage';
import { getTemplateById, getApiTemplateId } from '../data/idCardTemplates';
import { getFabricTemplateById } from '../data/fabricTemplatesStorage';
import { getAssignedSchools, getClassesBySchool, getStudentsBySchoolAndClass, uploadStudentPhoto, bulkSaveTemplates, uploadTemplate } from '../api/dashboard';
import { API_BASE_URL } from '../api/config';
import { compressImageForUpload } from '../utils/imageUpload';
import {
  getProjectBulkPreviewUrl,
  subscribeProjectBulkPhotoPreview,
} from '../utils/projectBulkPhotoPreview';
import '../components/IdCardRenderer.css';
import '../components/IdCardCanvasEditor.css';

const STEPS = { SELECT_SCHOOL: 1, SELECT_CLASS: 2, STUDENTS_IMAGES: 3, SELECT_TEMPLATE: 4, REVIEW_SAVE: 5 };

/** Default elements for uploaded template – with dataField so IdCardRenderer can fill from data */
function uploadedTemplateDefaultElements(name = '', studentId = '', className = '', schoolName = '') {
  return [
    { type: 'photo', id: 'photo', x: 8, y: 22, width: 30, height: 48 },
    { type: 'text', id: 'name', dataField: 'name', x: 45, y: 24, fontSize: 14, content: name, fontWeight: '700' },
    { type: 'text', id: 'studentId', dataField: 'studentId', x: 45, y: 36, fontSize: 11, content: studentId },
    { type: 'text', id: 'class', dataField: 'className', x: 45, y: 46, fontSize: 11, content: className },
    { type: 'text', id: 'school', dataField: 'schoolName', x: 45, y: 56, fontSize: 10, content: schoolName },
  ];
}

function fullPhotoUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http')) return url;
  const base = API_BASE_URL.replace(/\/$/, '');

  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

function mapApiStudent(s) {
  return {
    id: s._id,
    name: s.studentName,
    studentId: s.admissionNo || s.rollNo || s.uniqueCode || '—',
    admissionNo: s.admissionNo || '',
    rollNo: s.rollNo || '',
    uniqueCode: s.uniqueCode || '',
    dateOfBirth: s.dateOfBirth || s.dob || '',
    phone: s.phone || s.mobile || s.contactNo || '',
    email: s.email || '',
    address: s?.address || '',
    status: s.status,
    dimension: s?.schoolId?.dimension,
    dimensionUnit: s?.schoolId?.dimensionUnit ?? 'mm',
    photoUrl: fullPhotoUrl(s.photoUrl),
  };
}

/**
 * Class-wise ID card wizard:
 * 1) Select class (all students of that class are selected)
 * 2) Select/confirm image for each student
 * 3) Select one template
 * 4) Save → ID cards for all students in the class are saved; you can preview them later
 * When opened from Uploaded Photos with URL /class-id-cards/students/:schoolId/:classId and state, uses API data.
 */
export default function ClassIdCardsWizard() {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const { schools: contextSchools, classes: classList, getStudents, addSavedIdCard } = useApp();

  const schoolIdFromUrl = params.schoolId;
  const classIdFromUrl = params.classId;
  const templateIdFromUrl = params.templateId;
  const path = location.pathname;
  const fromUploadedPhotos = location.state?.fromUploadedPhotos;
  const stateSchool = location.state?.school;
  const stateClass = location.state?.class;
  const stateStudents = location.state?.students;

  const stepFromPath = useMemo(() => {
    if (path.includes('/review/') && templateIdFromUrl && classIdFromUrl && schoolIdFromUrl) return STEPS.REVIEW_SAVE;
    if (path.includes('/template/') && classIdFromUrl && schoolIdFromUrl) return STEPS.SELECT_TEMPLATE;
    if (path.includes('/students/') && classIdFromUrl && schoolIdFromUrl) return STEPS.STUDENTS_IMAGES;
    if (path.includes('/school/') && schoolIdFromUrl) return STEPS.SELECT_CLASS;
    return STEPS.SELECT_SCHOOL;
  }, [path, templateIdFromUrl, classIdFromUrl, schoolIdFromUrl]);

  const [step, setStep] = useState(stepFromPath);
  const [apiSchool, setApiSchool] = useState(null);
  const [apiClass, setApiClass] = useState(null);
  const [apiStudents, setApiStudents] = useState([]);
  const [apiDataLoaded, setApiDataLoaded] = useState(false);
  const [apiSchools, setApiSchools] = useState([]);
  const [apiClasses, setApiClasses] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [errorSchools, setErrorSchools] = useState('');
  const [errorClasses, setErrorClasses] = useState('');
  const [selectedSchoolId, setSelectedSchoolId] = useState(schoolIdFromUrl || contextSchools[0]?.id || null);
  const [selectedClassId, setSelectedClassId] = useState(classIdFromUrl || null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templateIdFromUrl || null);
  const [studentImages, setStudentImages] = useState({}); // { [studentId]: dataUrl }
  const [uploadingStudentId, setUploadingStudentId] = useState(null);
  const [bulkPreviewEpoch, setBulkPreviewEpoch] = useState(0);
  const [savingAll, setSavingAll] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]); // IDs of students to include in ID cards
  const [uploadedTemplate, setUploadedTemplate] = useState(null); // { frontImage, backImage, elements, name } when user uploads PNG templates
  const [arrangingUploaded, setArrangingUploaded] = useState(false); // true when user clicked "Arrange elements" for uploaded template
  const frontFileInputRef = useRef(null);
  const backFileInputRef = useRef(null);

  useEffect(() => {
    setStep(stepFromPath);
  }, [stepFromPath]);

  useEffect(() => {
    return subscribeProjectBulkPhotoPreview(() => {
      setBulkPreviewEpoch((n) => n + 1);
    });
  }, []);

  const prevClassKeyRef = useRef('');
  const selectionResetRef = useRef(false);

  // Fetch schools when on SELECT_SCHOOL step (path is /class-id-cards)
  useEffect(() => {
    if (step !== STEPS.SELECT_SCHOOL) return;
    let cancelled = false;
    setLoadingSchools(true);
    setErrorSchools('');
    getAssignedSchools()
      .then((res) => {
        if (!cancelled) {
          setApiSchools(res.schools ?? []);
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
  }, [step]);

  // Fetch classes when on SELECT_CLASS step (path is /class-id-cards/school/:schoolId)
  const schoolIdForClasses = schoolIdFromUrl || selectedSchoolId;
  useEffect(() => {
    if (step !== STEPS.SELECT_CLASS || !schoolIdForClasses) return;
    let cancelled = false;
    setLoadingClasses(true);
    setErrorClasses('');
    getClassesBySchool(schoolIdForClasses)
      .then((res) => {
        if (!cancelled) {
          setApiClasses(res.classes ?? []);
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
  }, [step, schoolIdForClasses]);

  const hasUrlIds = schoolIdFromUrl && classIdFromUrl;
  const hasStateData = fromUploadedPhotos && stateSchool && stateClass && stateStudents?.length;

  useEffect(() => {
    if (!hasUrlIds) return;
    if (hasStateData) {
      setApiSchool({
        id: stateSchool._id,
        name: stateSchool.schoolName,
        address: stateSchool.address,
        schoolCode: stateSchool.schoolCode || '',
        allowedMobiles: Array.isArray(stateSchool.allowedMobiles) ? stateSchool.allowedMobiles : [],
      });
      setApiClass({ id: stateClass._id, name: `Class ${stateClass.className}${stateClass.section ? ` – ${stateClass.section}` : ''}` });
      setApiStudents(stateStudents);
      setApiDataLoaded(true);
      return;
    }
    let cancelled = false;
    setApiDataLoaded(false);
    Promise.all([
      getAssignedSchools(),
      getClassesBySchool(schoolIdFromUrl),
      getStudentsBySchoolAndClass(schoolIdFromUrl, classIdFromUrl),
    ])
      .then(([schoolsRes, classesRes, studentsRes]) => {
        if (cancelled) return;
        const schoolsList = schoolsRes.schools ?? [];
        const classesList = classesRes.classes ?? [];
        const studentsList = (studentsRes.students ?? []).map(mapApiStudent);
        console.log('studentsList', studentsList);
        const school = schoolsList.find((s) => s._id === schoolIdFromUrl);
        const cls = classesList.find((c) => c._id === classIdFromUrl);
        setApiSchool(
          school
            ? {
                id: school._id,
                name: school.schoolName,
                address: school.address,
                schoolCode: school.schoolCode || '',
                allowedMobiles: Array.isArray(school.allowedMobiles) ? school.allowedMobiles : [],
              }
            : null,
        );
        setApiClass(cls ? { id: cls._id, name: `Class ${cls.className}${cls.section ? ` – ${cls.section}` : ''}` } : null);
        setApiStudents(studentsList);
        setApiDataLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setApiDataLoaded(true);
      });
    return () => { cancelled = true; };
  }, [hasUrlIds, hasStateData, schoolIdFromUrl, classIdFromUrl, stateSchool, stateClass, stateStudents]);

  const effectiveSchoolId = selectedSchoolId || schoolIdFromUrl || contextSchools[0]?.id;
  const effectiveClassId = selectedClassId || classIdFromUrl;

  const school = useMemo(() => {
    if (apiDataLoaded && apiSchool && (effectiveSchoolId === apiSchool.id || effectiveSchoolId === schoolIdFromUrl)) return apiSchool;
    return contextSchools.find((s) => s.id === effectiveSchoolId) || contextSchools[0] || apiSchool;
  }, [contextSchools, effectiveSchoolId, apiSchool, apiDataLoaded, schoolIdFromUrl]);

  const cls = useMemo(() => {
    if (apiDataLoaded && apiClass && (effectiveClassId === apiClass.id || effectiveClassId === classIdFromUrl)) return apiClass;
    return classList.find((c) => c.id === effectiveClassId) || apiClass;
  }, [classList, effectiveClassId, apiClass, apiDataLoaded, classIdFromUrl]);

  const students = useMemo(() => {
    if (apiDataLoaded && apiStudents.length && (effectiveClassId === classIdFromUrl || effectiveClassId === cls?.id)) return apiStudents;
    return (cls ? getStudents(cls.id) || [] : []);
  }, [cls, getStudents, apiStudents, apiDataLoaded, effectiveClassId, classIdFromUrl]);

  console.log("students", students);

  // When school/class changes, default selection = all students in that class
  useEffect(() => {
    const key = `${effectiveSchoolId}-${effectiveClassId}`;
    if (key !== prevClassKeyRef.current) {
      prevClassKeyRef.current = key;
      selectionResetRef.current = true;
      setSelectedStudentIds(students.length ? students.map((s) => s.id) : []);
    } else if (selectionResetRef.current && students.length > 0) {
      selectionResetRef.current = false;
      setSelectedStudentIds(students.map((s) => s.id));
    }
  }, [effectiveSchoolId, effectiveClassId, students]);

  const { templates: fabricTemplates } = useMemo(() => getFabricTemplates(), []);
  const { templates: savedUploadedTemplates } = useMemo(() => getUploadedTemplates(), []);

  const allTemplates = useMemo(() => [
    // ...fabricTemplates.map((t) => ({ id: t.id, name: t.name, isFabric: true, isUploaded: false })),
    // ...savedUploadedTemplates.map((t) => ({ id: t.id, name: t.name, isFabric: false, isUploaded: true, frontImage: t.frontImage, backImage: t.backImage, elements: t.elements })),
    ...ID_CARD_TEMPLATES.map((t) => ({ id: t.id, name: t.name, isFabric: false, isUploaded: false })),
  ], [fabricTemplates, savedUploadedTemplates]);

  const bulkSchoolId = school?.id || schoolIdFromUrl || null;
  const getImageForStudent = (student) => {
    const fromPicker = studentImages[student.id];
    if (fromPicker) return fromPicker;
    if (bulkSchoolId) {
      const bulk = getProjectBulkPreviewUrl(bulkSchoolId, student.id);
      if (bulk) return bulk;
    }
    return student.photoUrl ?? null;
  };
  const setImageForStudent = (studentId, dataUrl) => {
    setStudentImages((prev) => ({ ...prev, [studentId]: dataUrl }));
  };

  const selectedStudents = useMemo(
    () => students.filter((s) => selectedStudentIds.includes(s.id)),
    [students, selectedStudentIds]
  );

  const canProceedFromStudents = useMemo(() => {
    return selectedStudents.length > 0 && selectedStudents.every((s) => getImageForStudent(s));
  }, [selectedStudents, studentImages, bulkPreviewEpoch, bulkSchoolId, students]);

  const toggleStudentSelection = (studentId) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };
  const selectAllStudents = () => setSelectedStudentIds(students.map((s) => s.id));
  const deselectAllStudents = () => setSelectedStudentIds([]);

  const handleSaveAll = async () => {
    if (!cls || !school || !selectedTemplateId) return;
    const isUploaded = selectedTemplateId === 'uploaded-custom' || (typeof selectedTemplateId === 'string' && selectedTemplateId.startsWith('uploaded-'));
    const effectiveUploadedTemplate = getUploadedTemplateById(selectedTemplateId) || (selectedTemplateId === 'uploaded-custom' ? uploadedTemplate : null);
    const template = isUploaded ? (effectiveUploadedTemplate && { name: effectiveUploadedTemplate.name }) : (getTemplateById(selectedTemplateId) || getFabricTemplateById(selectedTemplateId));
    if (!template && !isUploaded) return;
    if (isUploaded && !effectiveUploadedTemplate?.elements) return;
    const studentIds = selectedStudents
      .filter((s) => getImageForStudent(s))
      .map((s) => s.id);
    if (studentIds.length === 0) return;

    setSavingAll(true);
    try {
      if (!isUploaded) {
        const apiTemplateId = getApiTemplateId(selectedTemplateId);
        await bulkSaveTemplates(apiTemplateId, studentIds);
      }
      selectedStudents.forEach((student) => {
        const image = getImageForStudent(student);
        if (!image) return;
        const cardData = {
          templateId: selectedTemplateId,
          studentImage: image,
          name: student.name,
          studentId: student.studentId,
          className: cls.name,
          schoolName: school.name,
          address: school.address,
        };
        if (isUploaded && effectiveUploadedTemplate) {
          cardData.uploadedTemplate = {
            frontImage: effectiveUploadedTemplate.frontImage,
            backImage: effectiveUploadedTemplate.backImage,
            elements: effectiveUploadedTemplate.elements,
            name: effectiveUploadedTemplate.name,
          };
        }
        addSavedIdCard(student.id, cardData, { schoolId: school.id, classId: cls.id });
      });
      navigate('/saved-id-cards', { replace: true });
    } catch (err) {
      alert(err?.message || 'Failed to save ID cards. Please try again.');
    } finally {
      setSavingAll(false);
    }
  };

  const selectSchool = (schoolId) => {
    setSelectedSchoolId(schoolId);
    setStep(STEPS.SELECT_CLASS);
    navigate(`/class-id-cards/school/${schoolId}`, { replace: true });
  };

  const selectClass = (sid, cid) => {
    setSelectedSchoolId(sid);
    setSelectedClassId(cid);
    setStep(STEPS.STUDENTS_IMAGES);
    navigate(`/class-id-cards/students/${sid}/${cid}`, { replace: true });
  };
  const goToTemplate = () => {
    setStep(STEPS.SELECT_TEMPLATE);
    navigate(`/class-id-cards/template/${effectiveSchoolId}/${effectiveClassId}`, { replace: true });
  };

  const selectTemplate = (tid) => {
    setSelectedTemplateId(tid);
    setUploadedTemplate(null);
    setStep(STEPS.REVIEW_SAVE);
    navigate(`/class-id-cards/review/${effectiveSchoolId}/${effectiveClassId}/${tid}`, { replace: true });
  };

  const handleFrontTemplateFile = (e) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedTemplate((prev) => ({
        ...prev,
        frontImage: reader.result,
        name: 'Uploaded Template',
      }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleBackTemplateFile = (e) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const previewStudent = students.find((s) => getImageForStudent(s)) || students[0];
      const name = previewStudent?.name ?? 'Student Name';
      const studentId = previewStudent?.studentId ?? '—';
      const className = cls?.name ?? 'Class';
      const schoolName = school?.name ?? 'School Name';
      setUploadedTemplate((prev) => ({
        ...prev,
        backImage: reader.result,
        elements: prev?.elements ?? uploadedTemplateDefaultElements(name, studentId, className, schoolName),
      }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  
  const handleUseUploadedTemplate = async (payload) => {
    const toSave = {
      name: uploadedTemplate?.name || 'Uploaded Template',
      frontImage: uploadedTemplate?.frontImage,
      backImage: uploadedTemplate?.backImage,
      schoolId: effectiveSchoolId,     
      // classId: effectiveClassId,
      elements: payload.elements,
    };
    console.log('toSave data', toSave);
    const savedId = saveUploadedTemplate(toSave);


    try {
      await uploadTemplate({
        name: toSave.name,
        schoolId: effectiveSchoolId,
        frontImage: toSave.frontImage,
        backImage: toSave.backImage,
        // classId: effectiveClassId,
        elements: toSave.elements,
      });
    } catch (err) {
      console.error('Template upload to API failed:', err);
      alert(err?.message || 'Template saved locally but upload to server failed. You can still use it for ID cards.');
    }

    setUploadedTemplate(null);
    setArrangingUploaded(false);
    setSelectedTemplateId(savedId);
    setStep(STEPS.REVIEW_SAVE);
    navigate(`/class-id-cards/review/${effectiveSchoolId}/${effectiveClassId}/${savedId}`, { replace: true });
  };




  const handleCancelUploadedTemplate = () => {
    setUploadedTemplate(null);
    setArrangingUploaded(false);
    setSelectedTemplateId(null);
  };

  const backTo = '/uploaded-photos';
  const selectedSchoolForClassStep = apiSchools.find((s) => s._id === schoolIdForClasses);

  // Step 1: Select school
  if (step === STEPS.SELECT_SCHOOL) {
    return (
      <>
        <Header title="Class-wise ID Cards" showBack backTo={backTo} />
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Select a school. Then choose a class to create ID cards for all students in that class.
        </p>
        <div className="card" style={{ maxWidth: 720 }}>
          <h3 style={{ marginBottom: 16 }}>Select school</h3>
          {errorSchools && <p className="text-danger" style={{ marginBottom: 16 }}>{errorSchools}</p>}
          {loadingSchools ? (
            <p className="text-muted">Loading schools…</p>
          ) : apiSchools.length === 0 ? (
            <p className="text-muted">No schools assigned.</p>
          ) : (
            <div className="class-idcards-school-grid">
              {apiSchools.map((s) => (
                <button
                  type="button"
                  key={s._id}
                  className="card class-idcards-school-card"
                  onClick={() => selectSchool(s._id)}
                >
                  <span className="class-idcards-school-name">{s.schoolName}</span>
                  {s.schoolCode && <span className="text-muted class-idcards-school-code">{s.schoolCode}</span>}
                  {/* {s.address && <span className="text-muted class-idcards-school-address">{s.address}</span>} */}
                </button>
              ))}
            </div>
          )}
        </div>
        <style>{`
          .class-idcards-school-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
          .class-idcards-school-card {
            text-align: left; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
            color: var(--text); background: var(--bg-secondary);
          }
          .class-idcards-school-card:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(0,0,0,0.25); }
          .class-idcards-school-name { font-weight: 600; font-size: 1.1rem; display: block; margin-bottom: 4px; color: var(--text); }
          .class-idcards-school-code, .class-idcards-school-address { font-size: 0.9rem; color: var(--text-muted); display: block; margin-top: 2px; }
        `}</style>
      </>
    );
  }

  // Step 2: Select class (for selected school)
  if (step === STEPS.SELECT_CLASS) {
    return (
      <>
        <Header
          title="Select class"
          showBack
          backTo="/class-id-cards"
        />
        <p className="text-muted" style={{ marginBottom: 24 }}>
          {selectedSchoolForClassStep ? `Classes for ${selectedSchoolForClassStep.schoolName}` : 'Select a class'}
        </p>
        <div className="card" style={{ maxWidth: 720 }}>
          <h3 style={{ marginBottom: 16 }}>Select class</h3>
          {errorClasses && <p className="text-danger" style={{ marginBottom: 16 }}>{errorClasses}</p>}
          {loadingClasses ? (
            <p className="text-muted">Loading classes…</p>
          ) : apiClasses.length === 0 ? (
            <p className="text-muted">No classes in this school.</p>
          ) : (
            <div className="class-idcards-class-grid">
              {apiClasses.map((c) => (
                <button
                  type="button"
                  key={c._id}
                  className="card class-idcards-class-card"
                  onClick={() => selectClass(schoolIdForClasses, c._id)}
                >
                  <span className="class-idcards-class-name">
                    {c.className}{c.section ? `` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <style>{`
          .class-idcards-class-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
          .class-idcards-class-card {
            text-align: left; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
            color: var(--text); background: var(--bg-secondary);
          }
          .class-idcards-class-card:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(0,0,0,0.25); }
          .class-idcards-class-name { font-weight: 600; font-size: 1.1rem; display: block; color: var(--text); }
        `}</style>
      </>
    );
  }

  // Step 2: Students & images (ensure we have class selected)
  if (step === STEPS.STUDENTS_IMAGES && cls) {
    return (
      <>
        <Header
          title={`Students & Photos – ${cls.name}`}
          showBack
          backTo={effectiveSchoolId ? `/class-id-cards/school/${effectiveSchoolId}` : '/class-id-cards'}
        />
        <p className="text-muted" style={{ marginBottom: 16 }}>
          Select which students to include, then confirm or select a photo for each. Only selected students need a photo.
        </p>
        <div className="card" style={{ maxWidth: 900 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <span className="text-muted" style={{ fontSize: '0.9rem' }}>
              {selectedStudentIds.length} of {students.length} selected
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={selectAllStudents}>
              Select all
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={deselectAllStudents}>
              Deselect all
            </button>
          </div>
          <div className="class-idcards-students-grid">
            {students.map((student) => {
              console.log('student data in students images step', student);
              const img = getImageForStudent(student);
              const isSelected = selectedStudentIds.includes(student.id);
              return (
                <div key={student.id} className={`class-idcards-student-row ${isSelected ? 'class-idcards-student-row-selected' : ''}`}>
                  <label className="class-idcards-student-checkbox-wrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleStudentSelection(student.id)}
                    />
                    <span className="class-idcards-student-checkbox-label">Include</span>
                  </label>
                  <div className="class-idcards-student-photo-wrap">
                    {img ? (
                      <img src={img} alt={student.name} className="class-idcards-student-photo" />
                    ) : (
                      <div className="class-idcards-student-placeholder">📷</div>
                    )}
                  </div>
                  <div className="class-idcards-student-info">
                    <span className="class-idcards-student-name">{student.name}</span>
                    <span className="text-muted class-idcards-student-id">{student.studentId}</span>
                  </div>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: uploadingStudentId === student.id ? 'wait' : 'pointer', marginLeft: 'auto' }}>
                    {uploadingStudentId === student.id ? 'Uploading…' : (img ? 'Change photo' : 'Select photo')}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      disabled={uploadingStudentId === student.id}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file?.type.startsWith('image/')) {
                          e.target.value = '';
                          return;
                        }
                        setUploadingStudentId(student.id);
                        try {
                          const fileToUpload = await compressImageForUpload(file);
                          const res = await uploadStudentPhoto(student.id, fileToUpload, 'Photographer Desktop App');
                          const photoUrl = res?.photoUrl;
                          const displayUrl = photoUrl
                            ? (photoUrl.startsWith('http') ? photoUrl : `${API_BASE_URL.replace(/\/$/, '')}${photoUrl.startsWith('/') ? photoUrl : '/' + photoUrl}`)
                            : URL.createObjectURL(fileToUpload);
                          setImageForStudent(student.id, displayUrl);
                          alert('Successfully uploaded!');
                        } catch (err) {
                          alert(err?.message || 'Upload failed. Please try again.');
                        } finally {
                          setUploadingStudentId(null);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canProceedFromStudents}
              onClick={goToTemplate}
            >
              Next step – Select template
            </button>
            <span className="text-muted" style={{ fontSize: '0.9rem' }}>
              {selectedStudents.filter((s) => getImageForStudent(s)).length} / {selectedStudents.length} selected students have a photo
            </span>
          </div>
        </div>
        <style>{`
          .class-idcards-students-grid { display: flex; flex-direction: column; gap: 12px; }
          .class-idcards-student-row {
            display: flex; align-items: center; gap: 16px;
            padding: 12px; background: rgba(255,255,255,0.04); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);
          }
          .class-idcards-student-row-selected { border-color: rgba(52, 152, 219, 0.4); background: rgba(52, 152, 219, 0.06); }
          .class-idcards-student-checkbox-wrap {
            display: flex; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0;
          }
          .class-idcards-student-checkbox-wrap input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
          .class-idcards-student-checkbox-label { font-size: 0.9rem; color: var(--text-muted); user-select: none; }
          .class-idcards-student-photo-wrap { width: 56px; height: 56px; border-radius: 50%; overflow: hidden; flex-shrink: 0; }
          .class-idcards-student-photo { width: 100%; height: 100%; object-fit: cover; }
          .class-idcards-student-placeholder {
            width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
            background: rgba(255,255,255,0.08); font-size: 1.5rem;
          }
          .class-idcards-student-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
          .class-idcards-student-name { font-weight: 600; }
          .class-idcards-student-id { font-size: 0.85rem; }
        `}</style>
      </>
    );
  }

  // Step 3: Select template – sub-view: Arrange uploaded template (drag/resize/font)
  const showArrangeUploaded = step === STEPS.SELECT_TEMPLATE && cls && arrangingUploaded && uploadedTemplate?.frontImage && uploadedTemplate?.backImage && uploadedTemplate?.elements;
  if (showArrangeUploaded) {
    const previewStudent = students.find((s) => getImageForStudent(s)) || students[0];
    const initialData = previewStudent
      ? {
          name: previewStudent.name || 'Student Name',
          studentId: previewStudent.studentId || '—',
          admissionNo: previewStudent.admissionNo || '',
          rollNo: previewStudent.rollNo || '',
          uniqueCode: previewStudent.uniqueCode || '',
          dateOfBirth: previewStudent.dateOfBirth || '',
          phone: previewStudent.phone || '',
          email: previewStudent.email || '',
          address: previewStudent.address || '',
          className: cls?.name || 'Class',
          schoolName: school?.name || 'School Name',
        }
      : { name: 'Student Name', studentId: '—', className: cls?.name || 'Class', schoolName: school?.name || 'School Name' };
    const backFromArrange = () => {
      setArrangingUploaded(false);
      navigate(`/class-id-cards/template/${effectiveSchoolId}/${effectiveClassId}`, { replace: true });
    };
    return (
      <>
        <Header
          title={`Arrange elements – ${cls.name}`}
          showBack
          backTo={`/class-id-cards/template/${effectiveSchoolId}/${effectiveClassId}`}
          onBackClick={backFromArrange}
        />
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Drag elements to position, resize photo from corner, and change font size in the sidebar. Then click &quot;Use this template&quot; to continue.
        </p>
        <IdCardCanvasEditor
          templateImage={uploadedTemplate.frontImage}
          studentImage={getImageForStudent(previewStudent)}
          initialElements={uploadedTemplate.elements}
          initialData={initialData}
          dimension={previewStudent?.dimension}
          dimensionUnit={previewStudent?.dimensionUnit}
          schoolId={schoolIdFromUrl || effectiveSchoolId}
          schoolPutPayload={{
            schoolName: school?.name || '',
            schoolCode: school?.schoolCode || '',
            address: school?.address || '',
            allowedMobiles: school?.allowedMobiles || [],
          }}
          onDimensionUpdated={(next) => {
            setApiStudents((prev) =>
              prev.map((s) => ({ ...s, dimension: next.dimension, dimensionUnit: next.dimensionUnit })),
            );
          }}
          onSave={handleUseUploadedTemplate}
          onCancel={handleCancelUploadedTemplate}
          saveLabel="Use this template"
          cancelLabel="Cancel"
        />
      </>
    );
  }

  // Step 3: Select template (grid + Upload Template option)
  if (step === STEPS.SELECT_TEMPLATE && cls) {
    return (
      <>
        <Header
          title={`Select template – ${cls.name}`}
          showBack
          backTo={`/class-id-cards/students/${effectiveSchoolId}/${effectiveClassId}`}
        />
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Choose one template or upload your own (PNG). Front and back of the ID card are shown below. Uploaded templates are saved at school level, so once created they can be reused across all classes.
        </p>
        {allTemplates.length === 0 && !uploadedTemplate?.frontImage ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <p className="text-muted">No templates yet. Upload your own template below or create one in the Template Editor.</p>
          </div>
        ) : null}
        {(allTemplates.length > 0 || uploadedTemplate?.frontImage) && (
          <div className="idcard-template-grid idcard-template-grid-with-back" style={{ maxWidth: 960 }}>
            {/* Upload Template card */}
            <div className="idcard-template-card idcard-template-card-with-back card idcard-template-card-upload">
              <div className="idcard-template-upload-wrap">
                <div className="idcard-template-side">
                  <span className="idcard-template-side-label">Front (PNG)</span>
                  <label className="idcard-template-upload-area">
                    <input
                      ref={frontFileInputRef}
                      type="file"
                      accept="image/png,.png"
                      style={{ display: 'none' }}
                      onChange={handleFrontTemplateFile}
                    />
                    {uploadedTemplate?.frontImage ? (
                      <img src={uploadedTemplate.frontImage} alt="Front" className="idcard-template-preview-img" />
                    ) : (
                      <span className="idcard-template-upload-text">Click to select front template</span>
                    )}
                  </label>
                </div>
                <div className="idcard-template-side">
                  <span className="idcard-template-side-label">Back (PNG)</span>
                  <label className="idcard-template-upload-area">
                    <input
                      ref={backFileInputRef}
                      type="file"
                      accept="image/png,.png"
                      style={{ display: 'none' }}
                      onChange={handleBackTemplateFile}
                    />
                    {uploadedTemplate?.backImage ? (
                      <img src={uploadedTemplate.backImage} alt="Back" className="idcard-template-preview-img" />
                    ) : (
                      <span className="idcard-template-upload-text">Click to select back template</span>
                    )}
                  </label>
                </div>
              </div>
              <div className="idcard-template-info">
                <strong>Upload Template</strong>
                <span className="text-muted">
                  {uploadedTemplate?.frontImage && uploadedTemplate?.backImage
                    ? 'Both selected. Arrange elements below.'
                    : 'Select front and back PNG, then arrange photo, name, etc.'}
                </span>
              </div>
              {uploadedTemplate?.frontImage && uploadedTemplate?.backImage && (
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-primary" onClick={() => setArrangingUploaded(true)}>
                    Arrange elements (position, size, font)
                  </button>
                </div>
              )}
            </div>

            {/* {allTemplates.map((t) => {
              // console.log('template name', t);
              const fabricTemplate = t.isFabric ? getFabricTemplateById(t.id) : null;
              const previewStudent = students.find((s) => getImageForStudent(s)) || students[0];
              const sampleData = previewStudent
                ? {
                    schoolName: school?.name || 'School Name',
                    className: cls?.name || 'Class',
                    address: previewStudent.address || school?.address || 'Address',
                    name: previewStudent.name || 'Student Name',
                    studentId: previewStudent.studentId || '—',
                    studentImage: getImageForStudent(previewStudent),
                  }
                : {
                    schoolName: school?.name || 'School Name',
                    className: cls?.name || 'Class',
                    address: school?.address || 'Address',
                    name: 'Student Name',
                    studentId: '—',
                    studentImage: undefined,
                  };

              // console.log('sampleData', sampleData);
              return (
                <button
                  type="button"
                  key={t.id}
                  className="idcard-template-card idcard-template-card-with-back card"
                  onClick={() => selectTemplate(t.id)}
                >
                  <div className="idcard-template-front-back-wrap">
                    <div className="idcard-template-side">
                      <span className="idcard-template-side-label">Front</span>
                      <div className="idcard-template-preview">
                        {t.isUploaded && t.frontImage ? (
                          <IdCardRenderer
                            templateId={t.id}
                            data={sampleData}
                            size="small"
                            template={{ image: t.frontImage, elements: t.elements }}
                          />
                        ) : 
                        t.isFabric ? (
                          fabricTemplate?.backgroundDataUrl ? (
                            <img src={fabricTemplate.backgroundDataUrl} alt={t.name} className="idcard-template-preview-img" />
                          ) : (
                            <span className="text-muted">Canvas template</span>
                          )
                        ) : (
                          <IdCardRenderer
                            templateId={t.id}
                            data={sampleData}
                            size="small"
                          />
                        )}
                      </div>
                    </div>
                    <div className="idcard-template-side">
                      <span className="idcard-template-side-label">Back</span>
                      <div className="idcard-template-preview idcard-template-preview-back">
                        {t.isUploaded && t.backImage ? (
                          <IdCardBackPreview schoolName={school?.name} address={sampleData.address} templateId={t.id} size="small" backImage={t.backImage} />
                        ) : (
                          <IdCardBackPreview schoolName={school?.name} address={sampleData.address} templateId={t.id} size="small" />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="idcard-template-info">
                    <strong>{t.name}</strong>
                    <span className="text-muted">{t.isUploaded ? 'Uploaded' : t.isFabric ? 'Fabric' : 'Image'} template · Front + Back</span>
                  </div>
                </button>
              );
            })} */}

            
          </div>
        )}
        <style>{`
          .idcard-template-grid-with-back { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
          .idcard-template-card-with-back { text-align: left; }
          .idcard-template-front-back-wrap {
            display: flex; gap: 12px; margin-bottom: 12px; min-height: 120px; align-items: stretch;
          }
          .idcard-template-side {
            flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0;
          }
          .idcard-template-side-label {
            font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;
          }
          .idcard-template-card-with-back .idcard-template-preview {
            flex: 0 0 auto; display: flex; align-items: center; justify-content: center; min-height: 0; padding: 0;
            width: 200px; min-width: 200px; height: calc(200px / 1.72); min-height: calc(200px / 1.72);
          }
          .idcard-template-card-with-back .idcard-template-preview .idcard {
            width: 200px !important; max-width: 200px !important; height: calc(200px / 1.72) !important; min-height: calc(200px / 1.72) !important;
          }
          .idcard-template-card-with-back .idcard-template-preview .idcard-template-preview-img {
            width: 200px; height: calc(200px / 1.72); max-width: 200px; max-height: calc(200px / 1.72); object-fit: contain;
          }
          .idcard-template-card-with-back .idcard-template-preview-back {
            flex: 0 0 auto; padding: 0;
            width: 200px; min-width: 200px; height: calc(200px / 1.72); min-height: calc(200px / 1.72);
            display: flex; align-items: stretch; justify-content: center;
          }
          .idcard-template-preview-back .idcard { margin: 0; }
          .idcard-template-preview-back .idcard-back-preview {
            width: 200px !important; min-width: 200px !important; max-width: 200px !important;
            height: calc(200px / 1.72) !important; min-height: calc(200px / 1.72) !important;
            flex-shrink: 0; display: flex; flex-direction: column; box-sizing: border-box;
          }
          .idcard-template-preview-back .idcard-back-preview .idcard-back-inner {
            flex: 1; min-height: 0; overflow: hidden;
          }
          .idcard-template-card-upload { text-align: left; cursor: default; }
          .idcard-template-card-upload:not(button) { display: block; }
          .idcard-template-upload-wrap {
            display: flex; gap: 12px; margin-bottom: 12px; min-height: 120px; align-items: stretch;
          }
          .idcard-template-upload-area {
            flex: 1; display: flex; align-items: center; justify-content: center;
            min-height: calc(200px / 1.72); border: 2px dashed rgba(255,255,255,0.25);
            border-radius: 8px; cursor: pointer; overflow: hidden;
            transition: border-color 0.2s, background 0.2s;
          }
          .idcard-template-upload-area:hover { border-color: var(--accent); background: rgba(52, 152, 219, 0.08); }
          .idcard-template-upload-area .idcard-template-preview-img {
            width: 100%; height: 100%; object-fit: contain; max-width: 200px; max-height: calc(200px / 1.72);
          }
          .idcard-template-upload-text { font-size: 0.85rem; color: var(--text-muted); }
        `}</style>
      </>
    );
  }

  // Step 4: Review & Save
  if (step === STEPS.REVIEW_SAVE && cls && school && selectedTemplateId) {
    const isUploadedTemplate = selectedTemplateId === 'uploaded-custom' || (typeof selectedTemplateId === 'string' && selectedTemplateId.startsWith('uploaded-'));
    const reviewUploadedTemplate = getUploadedTemplateById(selectedTemplateId) || (selectedTemplateId === 'uploaded-custom' ? uploadedTemplate : null);
    const template = isUploadedTemplate
      ? (reviewUploadedTemplate ? { name: reviewUploadedTemplate.name || 'Uploaded Template' } : null)
      : (getTemplateById(selectedTemplateId) || getFabricTemplateById(selectedTemplateId));
    const readyCount = selectedStudents.filter((s) => getImageForStudent(s)).length;
    return (
      <>
        <Header
          title="Review & Save"
          showBack
          backTo={`/class-id-cards/template/${effectiveSchoolId}/${effectiveClassId}`}
        />
        <div className="card" style={{ maxWidth: 560 }}>
          <h3 style={{ marginBottom: 16 }}>Confirm</h3>
          <p className="text-muted" style={{ marginBottom: 8 }}>
            ID cards for <strong>{readyCount}</strong> selected student{readyCount !== 1 ? 's' : ''} in <strong>{cls.name}</strong> will be created and saved.
          </p>
          <p className="text-muted" style={{ marginBottom: 20 }}>
            Template: <strong>{template?.name || selectedTemplateId}</strong>
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingAll}
              onClick={handleSaveAll}
            >
              {savingAll ? 'Saving…' : 'Save all ID cards'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/class-id-cards/template/${effectiveSchoolId}/${effectiveClassId}`)}
            >
              Back to template
            </button>
          </div>
          <p className="text-muted" style={{ marginTop: 20, fontSize: '0.9rem' }}>
            After saving, you can view each card&apos;s preview from &quot;Saved ID Cards&quot;.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Class-wise ID Cards" showBack backTo={backTo} />
      <p className="text-muted">Invalid step. <button type="button" className="btn btn-secondary" onClick={() => navigate('/class-id-cards')}>Start over</button></p>
    </>
  );
}
