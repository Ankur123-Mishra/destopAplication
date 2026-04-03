import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import IdCardRenderer from '../components/IdCardRenderer';
import IdCardBackPreview from '../components/IdCardBackPreview';
import IdCardCanvasEditor, { mapTemplateElementsToNameDobAddress } from '../components/IdCardCanvasEditor';
import { ID_CARD_TEMPLATES } from '../data/idCardTemplates';
import { getFabricTemplates } from '../data/fabricTemplatesStorage';
import { getUploadedTemplates, saveUploadedTemplate, getUploadedTemplateById } from '../data/uploadedTemplatesStorage';
import { getTemplateById, getApiTemplateId } from '../data/idCardTemplates';
import { getFabricTemplateById } from '../data/fabricTemplatesStorage';
import {
  getAssignedSchools,
  getClassesBySchool,
  getStudentsBySchool,
  getStudentsBySchoolAndClass,
  uploadStudentPhoto,
  bulkSaveTemplates,
  uploadTemplate,
} from '../api/dashboard';
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
function uploadedTemplateDefaultElements(name = '', dateOfBirth = '', address = '') {
  return [
    { type: 'photo', id: 'photo', x: 8, y: 22, width: 30, height: 48 },
    { type: 'text', id: 'name', dataField: 'name', x: 45, y: 24, fontSize: 14, content: name, fontWeight: '700' },
    { type: 'text', id: 'dob', dataField: 'dateOfBirth', x: 45, y: 36, fontSize: 11, content: dateOfBirth },
    { type: 'text', id: 'address', dataField: 'address', x: 45, y: 48, fontSize: 10, content: address },
  ];
}

const LAYOUT_DRAFT_STORAGE_PREFIX = 'classIdCardsWizard.layoutDraft.v1:';

function dataUrlFingerprint(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  return `${dataUrl.length}:${dataUrl.slice(0, 160)}`;
}

function layoutDraftSubKey(uploadedTpl) {
  if (!uploadedTpl?.frontImage) return '';
  if (uploadedTpl.templateId != null && String(uploadedTpl.templateId).length > 0) {
    return `api:${String(uploadedTpl.templateId)}`;
  }
  const f = dataUrlFingerprint(uploadedTpl.frontImage);
  const b = uploadedTpl.backImage ? dataUrlFingerprint(uploadedTpl.backImage) : '';
  return `u:${f}|${b}`;
}

function layoutDraftStorageKey(schoolId, classId, subKey) {
  return `${LAYOUT_DRAFT_STORAGE_PREFIX}${String(schoolId)}:${String(classId)}:${encodeURIComponent(subKey)}`;
}

function readLayoutDraft(schoolId, classId, subKey) {
  if (schoolId == null || classId == null || !subKey) return null;
  try {
    const raw = localStorage.getItem(layoutDraftStorageKey(schoolId, classId, subKey));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.elements)) return null;
    return o;
  } catch {
    return null;
  }
}

function writeLayoutDraft(schoolId, classId, subKey, payload) {
  if (schoolId == null || classId == null || !subKey) return;
  try {
    localStorage.setItem(layoutDraftStorageKey(schoolId, classId, subKey), JSON.stringify(payload));
  } catch (e) {
    console.warn('classIdCards layout draft save failed', e);
  }
}

function clearLayoutDraft(schoolId, classId, subKey) {
  if (schoolId == null || classId == null || !subKey) return;
  try {
    localStorage.removeItem(layoutDraftStorageKey(schoolId, classId, subKey));
  } catch {
    /* ignore */
  }
}

function mergeUploadedTemplateWithDraft(base, schoolId, classId) {
  const subKey = layoutDraftSubKey(base);
  if (!subKey || schoolId == null || classId == null) return base;
  const draft = readLayoutDraft(schoolId, classId, subKey);
  const fpF = dataUrlFingerprint(base.frontImage);
  const fpB = base.backImage ? dataUrlFingerprint(base.backImage) : null;
  if (
    draft?.elements?.length &&
    draft.fpFront === fpF &&
    (draft.fpBack ?? null) === fpB
  ) {
    return { ...base, elements: draft.elements };
  }
  return base;
}

function fullPhotoUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http')) return url;
  const base = API_BASE_URL.replace(/\/$/, '');

  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

function normalizeClassNameForDisplay(label) {
  if (!label || typeof label !== 'string') return label;
  // Data is currently appending "– A" to all class/section labels; strip that suffix for display.
  return label.replace(/\s*[–-]\s*A\s*$/i, '').trim();
}

/** For template upload API (expects data URLs); fetch http(s) / blob URLs into data URL */
async function imageRefToDataUrlForUpload(ref) {
  if (!ref || typeof ref !== 'string') return ref;
  if (ref.startsWith('data:')) return ref;
  try {
    const res = await fetch(ref);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Failed to read image'));
      r.readAsDataURL(blob);
    });
  } catch {
    return ref;
  }
}

function mapApiStudent(s) {
  const popClass = s.classId && typeof s.classId === 'object' ? s.classId : null;
  const classLabel = popClass
    ? `${popClass.className || ''}${popClass.section ? ` – ${popClass.section}` : ''}`.trim()
    : '';
  return {
    id: s._id,
    name: s.studentName,
    studentId: s.studentId || s.admissionNo || s.rollNo || s.uniqueCode || '',
    admissionNo: s.admissionNo || '',
    rollNo: s.rollNo || '',
    uniqueCode: s.uniqueCode || '',
    dateOfBirth: s.dateOfBirth || s.dob || '',
    phone: s.phone || s.mobile || s.contactNo || '',
    email: s.email || '',
    address: s?.address || '',
    className: s.className || classLabel || '',
    fatherName: s.fatherName || '',
    photoNo: s.photoNo || '',
    status: s.status,
    uploadedVia: s.uploadedVia || '',
    extraFields: (s.extraFields && typeof s.extraFields === 'object') ? s.extraFields : {},
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
  /** 'single' = front only (back mirrors front); 'both' = separate front + back uploads */
  const [templateUploadMode, setTemplateUploadMode] = useState('single');
  const [arrangingUploaded, setArrangingUploaded] = useState(false); // true when user clicked "Arrange elements" for uploaded template
  /** Template object from GET /api/photographer/students (same response as students list) */
  const [apiClassTemplate, setApiClassTemplate] = useState(null);
  const [editorOpenedFromApiClassTemplate, setEditorOpenedFromApiClassTemplate] = useState(false);
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
      setApiClassTemplate(null);
      setApiSchool({
        id: stateSchool._id,
        name: stateSchool.schoolName,
        address: stateSchool.address,
        schoolCode: stateSchool.schoolCode || '',
        allowedMobiles: Array.isArray(stateSchool.allowedMobiles) ? stateSchool.allowedMobiles : [],
      });
      setApiClass({ id: stateClass._id, name: `Class ${stateClass.className}` });
      setApiStudents(stateStudents);
      setApiDataLoaded(true);
      return;
    }
    let cancelled = false;
    setApiDataLoaded(false);
    setApiClassTemplate(null);

    const applySchoolStudentsPayload = (schoolsList, studentsRes) => {
      const studentsList = (studentsRes.students ?? []).map(mapApiStudent);
      const tpl = studentsRes.template;
      setApiClassTemplate(
        tpl && typeof tpl === 'object' && tpl.frontImage && Array.isArray(tpl.elements) && tpl.elements.length
          ? tpl
          : null,
      );
      const school = schoolsList.find((s) => s._id === schoolIdFromUrl);
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
      setApiStudents(studentsList);
      setApiDataLoaded(true);
    };

    if (classIdFromUrl === 'all') {
      const isValidApiTemplate = (t) =>
        t &&
        typeof t === 'object' &&
        t.frontImage &&
        Array.isArray(t.elements) &&
        t.elements.length > 0;

      Promise.all([
        getAssignedSchools(),
        getStudentsBySchool(schoolIdFromUrl),
        getClassesBySchool(schoolIdFromUrl).catch(() => ({ classes: [] })),
      ])
        .then(async ([schoolsRes, studentsRes, classesRes]) => {
          if (cancelled) return;
          const schoolsList = schoolsRes.schools ?? [];
          const classesList = classesRes.classes ?? [];
          setApiClass({ id: 'all', name: 'All students' });

          let payload = studentsRes;
          if (!isValidApiTemplate(studentsRes.template) && classesList.length > 0) {
            try {
              const byClass = await getStudentsBySchoolAndClass(
                schoolIdFromUrl,
                classesList[0]._id,
              );
              if (!cancelled && isValidApiTemplate(byClass.template)) {
                payload = { ...studentsRes, template: byClass.template };
              }
            } catch {
              // use school list without template
            }
          }
          if (cancelled) return;
          applySchoolStudentsPayload(schoolsList, payload);
        })
        .catch(() => {
          if (!cancelled) setApiDataLoaded(true);
        });
    } else {
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
          const tpl = studentsRes.template;
          setApiClassTemplate(
            tpl && typeof tpl === 'object' && tpl.frontImage && Array.isArray(tpl.elements) && tpl.elements.length
              ? tpl
              : null,
          );
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
          setApiClass(cls ? { id: cls._id, name: `Class ${cls.className}` } : null);
          setApiStudents(studentsList);
          setApiDataLoaded(true);
        })
        .catch(() => {
          if (!cancelled) setApiDataLoaded(true);
        });
    }
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

  console.log('cls', cls);
  const students = useMemo(() => {
    if (apiDataLoaded && (effectiveClassId === classIdFromUrl || effectiveClassId === cls?.id)) {
      return apiStudents;
    }
    if (cls && cls.id !== 'all') return getStudents(cls.id) || [];
    return [];
  }, [cls, getStudents, apiStudents, apiDataLoaded, effectiveClassId, classIdFromUrl]);

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

  const arrangeEditorElements = useMemo(() => {
    if (!uploadedTemplate?.frontImage || !Array.isArray(uploadedTemplate.elements)) {
      return uploadedTemplate?.elements ?? null;
    }
    const subKey = layoutDraftSubKey(uploadedTemplate);
    if (!subKey || effectiveSchoolId == null || effectiveClassId == null) {
      return uploadedTemplate.elements;
    }
    const draft = readLayoutDraft(effectiveSchoolId, effectiveClassId, subKey);
    const fpF = dataUrlFingerprint(uploadedTemplate.frontImage);
    const fpB = uploadedTemplate.backImage ? dataUrlFingerprint(uploadedTemplate.backImage) : null;
    if (
      draft?.elements?.length &&
      draft.fpFront === fpF &&
      (draft.fpBack ?? null) === fpB
    ) {
      return draft.elements;
    }
    return uploadedTemplate.elements;
  }, [uploadedTemplate, effectiveSchoolId, effectiveClassId]);

  const handleArrangeElementsPersist = useCallback(
    (elements) => {
      setUploadedTemplate((prev) => {
        if (!prev?.frontImage || effectiveSchoolId == null || effectiveClassId == null) return prev;
        const subKey = layoutDraftSubKey(prev);
        if (subKey) {
          writeLayoutDraft(effectiveSchoolId, effectiveClassId, subKey, {
            v: 1,
            elements,
            templateUploadMode,
            fpFront: dataUrlFingerprint(prev.frontImage),
            fpBack: prev.backImage ? dataUrlFingerprint(prev.backImage) : null,
          });
        }
        return { ...prev, elements };
      });
    },
    [effectiveSchoolId, effectiveClassId, templateUploadMode],
  );

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
    if (selectedStudents.length === 0) return false;
    const firstSelected = selectedStudents[0];
    return Boolean(getImageForStudent(firstSelected));
  }, [selectedStudents, studentImages, bulkPreviewEpoch, bulkSchoolId]);

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
          className: normalizeClassNameForDisplay(student.className || cls.name),
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

  /** Open IdCardCanvasEditor with template + elements from getStudentsBySchoolAndClass response */
  const openClassTemplateEditor = useCallback(() => {
    const t = apiClassTemplate;
    if (!t?.frontImage || !Array.isArray(t.elements) || t.elements.length === 0) return;
    const front = fullPhotoUrl(t.frontImage);
    const back = t.backImage ? fullPhotoUrl(t.backImage) : front;
    setUploadedTemplate({
      frontImage: front,
      backImage: back,
      elements: mapTemplateElementsToNameDobAddress(t.elements),
      name: t.name || t.title || 'Uploaded Template',
      templateId: t.templateId,
    });
    setEditorOpenedFromApiClassTemplate(true);
    setArrangingUploaded(true);
    setStep(STEPS.SELECT_TEMPLATE);
    navigate(`/class-id-cards/template/${effectiveSchoolId}/${effectiveClassId}`, { replace: true });
  }, [apiClassTemplate, effectiveSchoolId, effectiveClassId, navigate]);

  const selectTemplate = (tid) => {
    setSelectedTemplateId(tid);
    setUploadedTemplate(null);
    setStep(STEPS.REVIEW_SAVE);
    navigate(`/class-id-cards/review/${effectiveSchoolId}/${effectiveClassId}/${tid}`, { replace: true });
  };

  const handleTemplateUploadModeChange = (e) => {
    const next = e.target.value === 'single' ? 'single' : 'both';
    setTemplateUploadMode(next);
    setUploadedTemplate((prev) => {
      if (!prev) return prev;
      if (next === 'single') {
        // Single-side mode: user uploads ONLY front PNG.
        // We must not auto-populate backImage (otherwise save/upload sends it).
        return { ...prev, backImage: null };
      }
      if (prev.frontImage && prev.backImage && prev.backImage === prev.frontImage) {
        return { ...prev, backImage: null };
      }
      return prev;
    });
  };

  const handleFrontTemplateFile = (e) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const previewStudent = students.find((s) => getImageForStudent(s)) || students[0];
      const name = previewStudent?.name ?? 'Student Name';
      const dateOfBirth = previewStudent?.dateOfBirth ?? '';
      const address = String(previewStudent?.address || school?.address || '').trim();
      setUploadedTemplate((prev) => {
        const result = reader.result;
        const next = mergeUploadedTemplateWithDraft(
          {
            ...prev,
            frontImage: result,
            name: 'Uploaded Template',
            elements: prev?.elements ?? uploadedTemplateDefaultElements(name, dateOfBirth, address),
          },
          effectiveSchoolId,
          effectiveClassId,
        );
        return next;
      });
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
      const dateOfBirth = previewStudent?.dateOfBirth ?? '';
      const address = String(previewStudent?.address || school?.address || '').trim();
      setUploadedTemplate((prev) =>
        mergeUploadedTemplateWithDraft(
          {
            ...prev,
            backImage: reader.result,
            elements: prev?.elements ?? uploadedTemplateDefaultElements(name, dateOfBirth, address),
          },
          effectiveSchoolId,
          effectiveClassId,
        ),
      );
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUseUploadedTemplate = async (payload) => {
    setEditorOpenedFromApiClassTemplate(false);
    const draftSub = uploadedTemplate ? layoutDraftSubKey(uploadedTemplate) : '';
    if (draftSub) clearLayoutDraft(effectiveSchoolId, effectiveClassId, draftSub);
    const front = uploadedTemplate?.frontImage;
    // Single-side mode: do not upload/save back image unless user explicitly selected it.
    const back =
      templateUploadMode === 'single'
        ? uploadedTemplate?.backImage ?? null
        : uploadedTemplate?.backImage;
    const toSave = {
      name: uploadedTemplate?.name || 'Uploaded Template',
      frontImage: front,
      backImage: back,
      schoolId: effectiveSchoolId,
      elements: payload.elements,
    };
    const savedId = saveUploadedTemplate(toSave);

    try {
      const frontData = await imageRefToDataUrlForUpload(toSave.frontImage);
      const backData = await imageRefToDataUrlForUpload(toSave.backImage);
      await uploadTemplate({
        name: toSave.name,
        schoolId: effectiveSchoolId,
        frontImage: frontData,
        backImage: backData,
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
    const backToStudents = editorOpenedFromApiClassTemplate;
    setEditorOpenedFromApiClassTemplate(false);
    setUploadedTemplate(null);
    setArrangingUploaded(false);
    setSelectedTemplateId(null);
    if (backToStudents) {
      setStep(STEPS.STUDENTS_IMAGES);
      navigate(`/class-id-cards/students/${effectiveSchoolId}/${effectiveClassId}`, { replace: true });
    }
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: 0 }}>Select class</h3>
            {schoolIdForClasses && !loadingClasses ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => selectClass(schoolIdForClasses, 'all')}
              >
                See all students
              </button>
            ) : null}
          </div>
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
  if (step === STEPS.STUDENTS_IMAGES) {
    if (hasUrlIds && !hasStateData && !apiDataLoaded) {
      return (
        <>
          <Header
            title="Students & photos"
            showBack
            backTo={effectiveSchoolId ? `/class-id-cards/school/${effectiveSchoolId}` : '/class-id-cards'}
          />
          <p className="text-muted">Loading students…</p>
        </>
      );
    }
    if (!cls) {
      return (
        <>
          <Header title="Class-wise ID Cards" showBack backTo="/class-id-cards" />
          <p className="text-muted">Invalid step. <button type="button" className="btn btn-secondary" onClick={() => navigate('/class-id-cards')}>Start over</button></p>
        </>
      );
    }
    const showApiClassTemplateBar =
      Boolean(
        apiClassTemplate?.frontImage &&
          Array.isArray(apiClassTemplate.elements) &&
          apiClassTemplate.elements.length > 0,
      );
    return (
      <>
        <Header
          title={`Students & Photos – ${normalizeClassNameForDisplay(cls.name)}`}
          showBack
          backTo={effectiveSchoolId ? `/class-id-cards/school/${effectiveSchoolId}` : '/class-id-cards'}
        />
        <div
          className={`class-idcards-students-step-body${showApiClassTemplateBar ? ' class-idcards-students-step-body--with-template-bar' : ''}`}
        >
        <p className="text-muted" style={{ marginBottom: 16 }}>
          Select which students to include. To continue, the first selected student (top of the list among checked rows) must have a photo; others can be added before save.
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
                    {student.className ? (
                      <span className="text-muted" style={{ fontSize: '0.8rem' }}>{normalizeClassNameForDisplay(student.className)}</span>
                    ) : null}
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
        </div>
        </div>
        <div
          className="class-idcards-students-sticky-footer"
          role="region"
          aria-label={showApiClassTemplateBar ? 'Template and next step' : 'Continue to next step'}
        >
          {showApiClassTemplateBar ? (
            <div className="class-idcards-students-sticky-footer-template">
              <div className="class-idcards-students-sticky-footer-inner class-idcards-students-sticky-footer-template-inner">
                <button type="button" className="btn btn-secondary" onClick={openClassTemplateEditor}>
                  Edit template layout
                </button>
              </div>
            </div>
          ) : null}
          <div className="class-idcards-students-sticky-footer-next">
            <div className="class-idcards-students-sticky-footer-inner">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canProceedFromStudents}
                onClick={goToTemplate}
              >
                Next step – Select template
              </button>
              <span className="text-muted class-idcards-students-sticky-footer-hint">
                First selected needs a photo to continue
                {selectedStudents.length > 0
                  ? ` (${getImageForStudent(selectedStudents[0]) ? 'done' : 'missing'}) · ${selectedStudents.filter((s) => getImageForStudent(s)).length} / ${selectedStudents.length} with photos overall`
                  : ''}
              </span>
            </div>
          </div>
        </div>
        <style>{`
          .class-idcards-students-step-body {
            padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));
            max-width: 100%;
          }
          .class-idcards-students-step-body.class-idcards-students-step-body--with-template-bar {
            padding-bottom: calc(168px + env(safe-area-inset-bottom, 0px));
          }
          .class-idcards-students-sticky-footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 50;
            display: flex;
            flex-direction: column;
            gap: 0;
            padding: 0;
            padding-bottom: max(0px, env(safe-area-inset-bottom, 0px));
            background: var(--bg-secondary);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.35);
          }
          .class-idcards-students-sticky-footer-template {
            padding: 12px 16px 10px;
            background: rgba(52, 152, 219, 0.1);
            border-bottom: 1px solid rgba(52, 152, 219, 0.22);
          }
          .class-idcards-students-sticky-footer-template-inner {
            align-items: center;
            justify-content: flex-start;
          }
          .class-idcards-students-sticky-footer-next {
            padding: 12px 16px;
            padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
          }
          .class-idcards-students-sticky-footer-inner {
            max-width: 900px;
            margin: 0 auto;
            display: flex;
            gap: 12px;
            align-items: center;
            flex-wrap: wrap;
          }
          .class-idcards-students-sticky-footer-hint {
            font-size: 0.9rem;
            flex: 1;
            min-width: 200px;
          }
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
  const uploadedReadyForArrange =
    uploadedTemplate?.frontImage &&
    uploadedTemplate?.elements &&
    (templateUploadMode === 'single' || uploadedTemplate?.backImage);
  const showArrangeUploaded =
    step === STEPS.SELECT_TEMPLATE && cls && arrangingUploaded && uploadedReadyForArrange;
  if (showArrangeUploaded) {
    const previewStudent = students.find((s) => getImageForStudent(s)) || students[0];
    const initialData = previewStudent
      ? {
          name: previewStudent.name || '',
          studentId: previewStudent.studentId || '',
          admissionNo: previewStudent.admissionNo || '',
          rollNo: previewStudent.rollNo || '',
          uniqueCode: previewStudent.uniqueCode || '',
          dateOfBirth: previewStudent.dateOfBirth || '',
          phone: previewStudent.phone || '',
          email: previewStudent.email || '',
          address: previewStudent.address || '',
          className: previewStudent.className || cls?.name || '',
          schoolName: school?.name || '',
          extraFields: previewStudent.extraFields || {},
        }
      : {
          name: '',
          studentId: '',
          className: cls?.name || '',
          schoolName: school?.name || '',
          dateOfBirth: '',
          address: school?.address || '',
          extraFields: {},
        };
    const backFromArrange = () => {
      setEditorOpenedFromApiClassTemplate(false);
      setArrangingUploaded(false);
      navigate(`/class-id-cards/template/${effectiveSchoolId}/${effectiveClassId}`, { replace: true });
    };
    return (
      <>
        <Header
          title={`Arrange elements – ${normalizeClassNameForDisplay(cls.name)}`}
          showBack
          backTo={`/class-id-cards/template/${effectiveSchoolId}/${effectiveClassId}`}
          onBackClick={backFromArrange}
        />
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Drag elements to position, resize photo from corner, and change font size in the sidebar. Then click &quot;Use this template&quot; to continue.
        </p>
        <IdCardCanvasEditor
          key={`class-idcards-arrange-${effectiveSchoolId}-${effectiveClassId}-${encodeURIComponent(layoutDraftSubKey(uploadedTemplate) || 'draft')}`}
          templateImage={uploadedTemplate.frontImage}
          studentImage={getImageForStudent(previewStudent)}
          initialElements={arrangeEditorElements ?? uploadedTemplate.elements}
          initialData={initialData}
          onElementsChange={handleArrangeElementsPersist}
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
          title={`Select template – ${normalizeClassNameForDisplay(cls.name)}`}
          showBack
          backTo={`/class-id-cards/students/${effectiveSchoolId}/${effectiveClassId}`}
        />
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Choose one template or upload your own (PNG/JPG/JPEG). Pick whether your design is single-sided (front only) or both sides. Uploaded templates are saved at school level, so once created they can be reused across all classes.
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
              <div style={{ marginBottom: 16 }}>
                <label htmlFor="class-idcards-template-sides" style={{ display: 'block', fontSize: '0.9rem', marginBottom: 8 }}>
                  Template sides
                </label>
                <select
                  id="class-idcards-template-sides"
                  className="input-field"
                  style={{ maxWidth: 320 }}
                  value={templateUploadMode}
                  onChange={handleTemplateUploadModeChange}
                >
                  <option value="single">Single side (front only)</option>
                  <option value="both">Both sides (front + back)</option>
                </select>
              </div>
              <div
                className="idcard-template-upload-wrap"
                style={
                  templateUploadMode === 'single'
                    ? { display: 'grid', gridTemplateColumns: '1fr', gap: 12 }
                    : undefined
                }
              >
                <div className="idcard-template-side">
                  <span className="idcard-template-side-label">Front (PNG/JPG)</span>
                  <label className="idcard-template-upload-area">
                    <input
                      ref={frontFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,.png,.jpg,.jpeg"
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
                {templateUploadMode === 'both' ? (
                  <div className="idcard-template-side">
                    <span className="idcard-template-side-label">Back (PNG/JPG)</span>
                    <label className="idcard-template-upload-area">
                      <input
                        ref={backFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
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
                ) : (
                  <p className="text-muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                    Single-side mode: only the front image is required. Back image upload is not included (back preview/print will be skipped).
                  </p>
                )}
              </div>
              <div className="idcard-template-info">
                <strong>Upload Template</strong>
                <span className="text-muted">
                  {uploadedReadyForArrange
                    ? 'Ready. Arrange elements below.'
                    : templateUploadMode === 'single'
                      ? 'Select the front PNG, then arrange photo, name, etc.'
                      : 'Select front and back PNG, then arrange photo, name, etc.'}
                </span>
              </div>
              {uploadedReadyForArrange && (
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
            ID cards for <strong>{readyCount}</strong> selected student{readyCount !== 1 ? 's' : ''} in <strong>{normalizeClassNameForDisplay(cls.name)}</strong> will be created and saved.
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
