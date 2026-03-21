import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import IdCardRenderer from '../components/IdCardRenderer';
import IdCardBackPreview from '../components/IdCardBackPreview';
import FabricIdCardGenerator from '../components/FabricIdCardGenerator';
import { getTemplateById, getInternalTemplateId } from '../data/idCardTemplates';
import { getFabricTemplateById } from '../data/fabricTemplatesStorage';
import { getUploadedTemplateById } from '../data/uploadedTemplatesStorage';
import { getAssignedSchools, getClassesBySchool, getTemplatesStatus } from '../api/dashboard';
import { API_BASE_URL } from '../api/config';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// A4 size (mm). Preview and print show as many cards per page as fit on one A4.
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PRINT_PAGE_MARGIN_MM = 4;
const PRINT_GAP_MM = 4;
const DEFAULT_CARD_WIDTH_MM = 90;
const DEFAULT_CARD_HEIGHT_MM = 57;

function fullPhotoUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http')) return url;
  const base = API_BASE_URL.replace(/\/$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

function formatDateDMY(input) {
  if (!input) return '';
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const dd = String(input.getDate()).padStart(2, '0');
    const mm = String(input.getMonth() + 1).padStart(2, '0');
    const yy = String(input.getFullYear());
    return `${dd}/${mm}/${yy}`;
  }
  const s = String(input).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    const dd = String(m2[1]).padStart(2, '0');
    const mm = String(m2[2]).padStart(2, '0');
    return `${dd}/${mm}/${m2[3]}`;
  }
  return s;
}

function convertToMm(value, unit) {
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return value;
  
  switch (unit) {
    case 'cm':
      return numValue * 10;
    case 'inch':
      return numValue * 25.4;
    case 'px':
      return numValue * 0.264583;
    case 'mm':
    default:
      return numValue;
  }
}

const MIN_PAGE_CM = 5;
const MAX_PAGE_CM = 120;

function parseCmInput(value) {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
}

/** Clamps user-entered page dimension in cm; invalid input uses fallbackCm. */
function clampPageCm(value, fallbackCm) {
  const n = parseCmInput(value);
  const cm = Number.isFinite(n) ? n : fallbackCm;
  return Math.min(MAX_PAGE_CM, Math.max(MIN_PAGE_CM, cm));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Captures preview page DOM nodes to JPG/PNG (one file per page) or a single multi-page PDF. */
async function exportPreviewPagesAsFiles(pageElements, format, pageWidthMm, pageHeightMm, fileBaseName) {
  if (!pageElements?.length) return;
  const scale = 2;
  const opts = { scale, useCORS: true, logging: false, backgroundColor: '#ffffff' };

  if (format === 'pdf') {
    const pdf = new jsPDF({
      unit: 'mm',
      format: [pageWidthMm, pageHeightMm],
      orientation: pageHeightMm >= pageWidthMm ? 'portrait' : 'landscape',
    });
    for (let i = 0; i < pageElements.length; i++) {
      const canvas = await html2canvas(pageElements[i], opts);
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage([pageWidthMm, pageHeightMm], 'p');
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
    }
    pdf.save(`${fileBaseName}.pdf`);
    return;
  }

  const ext = format === 'png' ? 'png' : 'jpg';
  for (let i = 0; i < pageElements.length; i++) {
    const canvas = await html2canvas(pageElements[i], opts);
    const url = format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBaseName}-page-${i + 1}.${ext}`;
    a.click();
    await delay(300);
  }
}

export default function SavedIdCardsList({
  title = 'Saved ID Cards',
  basePath = '/saved-id-cards',
  previewBasePath = '/saved-id-cards/preview',
  backTo = '/dashboard',
} = {}) {
  const navigate = useNavigate();
  const { schoolId, classId } = useParams();
  useApp(); // auth/context available if needed
  const isViewTemplateFlow = basePath === '/view-template';
  const [showPrintView, setShowPrintView] = useState(false);
  const [showPreviewView, setShowPreviewView] = useState(false);
  const [singleCardPreview, setSingleCardPreview] = useState(null); // card object when viewing one student's card
  const printContentRef = useRef(null);
  const previewPagesWrapRef = useRef(null);

  const [showDownloadMenuList, setShowDownloadMenuList] = useState(false);
  const [showDownloadMenuPreview, setShowDownloadMenuPreview] = useState(false);
  const [pendingExportFormat, setPendingExportFormat] = useState(null); // 'jpg' | 'png' | 'pdf'
  const [exporting, setExporting] = useState(false);

  const [pageSizeMode, setPageSizeMode] = useState('a4'); // 'a4' | 'custom'
  const [customPageWidthCm, setCustomPageWidthCm] = useState('21');
  const [customPageHeightCm, setCustomPageHeightCm] = useState('29.7');

  const pageWidthMm = React.useMemo(
    () => (pageSizeMode === 'a4' ? A4_WIDTH_MM : clampPageCm(customPageWidthCm, 21) * 10),
    [pageSizeMode, customPageWidthCm],
  );
  const pageHeightMm = React.useMemo(
    () => (pageSizeMode === 'a4' ? A4_HEIGHT_MM : clampPageCm(customPageHeightCm, 29.7) * 10),
    [pageSizeMode, customPageHeightCm],
  );

  // Level 1: Schools
  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [errorSchools, setErrorSchools] = useState('');

  // Level 2: Classes
  const [classes, setClasses] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [errorClasses, setErrorClasses] = useState('');
  const [selectedSchool, setSelectedSchool] = useState(null);

  // Level 3: Students (with saved ID cards)
  const [templateStatus, setTemplateStatus] = useState(null);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [errorStudents, setErrorStudents] = useState('');
  const [selectedClass, setSelectedClass] = useState(null);

  // Fetch schools when on root saved-id-cards
  useEffect(() => {
    if (schoolId != null) return;
    let cancelled = false;
    setLoadingSchools(true);
    setErrorSchools('');
    getAssignedSchools()
      .then((res) => {
        if (!cancelled) {
          console.log('res schools', res.schools);
          setSchools(res.schools ?? []);
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
  }, [schoolId]);

  // Fetch classes when schoolId is in URL
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    setLoadingClasses(true);
    setErrorClasses('');
    setTemplateStatus(null);
    getAssignedSchools()
      .then((res) => {
        const school = (res.schools ?? []).find((s) => s._id === schoolId);
        if (!cancelled) setSelectedSchool(school || { _id: schoolId, schoolName: schoolId });
      })
      .catch(() => {});
    getClassesBySchool(schoolId)
      .then((res) => {
        if (!cancelled) {
          setClasses(res.classes ?? []);
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
  }, [schoolId]);

  // Fetch students (template status) when both schoolId and classId are in URL
  useEffect(() => {
    if (!schoolId || !classId) return;
    let cancelled = false;
    setLoadingStudents(true);
    setErrorStudents('');
    getClassesBySchool(schoolId)
      .then((res) => {
        const cls = (res.classes ?? []).find((c) => c._id === classId);
        if (!cancelled) setSelectedClass(cls || { _id: classId, className: classId, section: '' });
      })
      .catch(() => {});
    getTemplatesStatus(schoolId, classId)
      .then((data) => {
        if (!cancelled) {
          setTemplateStatus(data);
          setLoadingStudents(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorStudents(err?.message || 'Failed to load students');
          setLoadingStudents(false);
        }
      });
    return () => { cancelled = true; };
  }, [schoolId, classId]);

  const studentsWithTemplates = templateStatus?.students?.filter((s) => s.hasTemplate) ?? templateStatus?.summary?.withTemplates ?? [];

  console.log("studentsWithTemplates", studentsWithTemplates);

  const getTemplateName = (templateId, card = null) => {
    if (templateId === 'uploaded-custom' && card?.uploadedTemplate?.name) return card.uploadedTemplate.name;
    if (templateId === 'uploaded-custom') return 'Uploaded Template';
    if (templateId && String(templateId).startsWith('uploaded-')) {
      return getUploadedTemplateById(templateId)?.name || card?.uploadedTemplate?.name || 'Uploaded Template';
    }
    const internalId = templateId ? getInternalTemplateId(templateId) : null;
    const t = getTemplateById(internalId || templateId) || getFabricTemplateById(templateId);
    return t?.name || templateId;
  };

  // Build card-like object from API student for preview/print
  // Include address, name, photoUrl, studentId, dimension (from school) so ID card preview shows full data and size
  const studentToCard = (student) => {
    const apiTemplate = student?.template ?? null;
    const isApiTemplateRenderable = Boolean(apiTemplate?.frontImage && Array.isArray(apiTemplate?.elements));

    // In "View Template" flow, render the template coming from API (frontImage/backImage/elements).
    // We pass it as uploadedTemplate override so existing IdCardRenderer + back preview can render it.
    const templateId = isViewTemplateFlow && isApiTemplateRenderable ? 'uploaded-custom' : apiTemplate?.templateId;

    return {
      _id: student._id,
      id: apiTemplate?.templateId || student._id,
      studentId: student.admissionNo ?? student.rollNo ?? student.uniqueCode ?? '',
      name: student.studentName ?? '',
      templateId,
      uploadedTemplate: isViewTemplateFlow && isApiTemplateRenderable
        ? {
          name: apiTemplate?.name || 'Uploaded Template',
          frontImage: fullPhotoUrl(apiTemplate.frontImage),
          backImage: fullPhotoUrl(apiTemplate.backImage),
          elements: apiTemplate.elements,
        }
        : null,
      studentImage: fullPhotoUrl(student.photoUrl),
      className: student.class ? `${student.class.className}${student.class.section ? ` - ${student.class.section}` : ''}` : '',
      schoolName: student.school?.schoolName || '',
      address: student.address ?? '',
      dateOfBirth: student.dateOfBirth ?? student.birthDate ?? student.dob ?? undefined,
      phone: student.mobile ?? student.phone ?? undefined,
      email: student.email ?? undefined,
      dimension: student.school?.dimension ?? null,
      dimensionUnit: student.school?.dimensionUnit?? 'mm',
    };
  };

  const getPreviewUrl = (student) => {
    const templateId = student.template?.templateId || student._id;
    let base = `${previewBasePath}/${student._id}/${templateId}`;
    if (schoolId && classId) base += `?schoolId=${encodeURIComponent(schoolId)}&classId=${encodeURIComponent(classId)}`;
    return base;
  };

  const cardsToPrint = studentsWithTemplates.map(studentToCard);
  const hasFabricCards = cardsToPrint.some((c) => c.templateId?.startsWith('fabric-'));

  // How many cards fit per page from current page size (A4 or custom) and card dimensions
  const printLayout = React.useMemo(() => {
    const first = cardsToPrint[0];
    let cardWidthMm = DEFAULT_CARD_WIDTH_MM;
    let cardHeightMm = DEFAULT_CARD_HEIGHT_MM;
    if (first?.dimension && typeof first.dimension.width === 'number' && typeof first.dimension.height === 'number') {
      const unit = first.dimensionUnit || 'mm';
      cardWidthMm = convertToMm(first.dimension.width, unit);
      cardHeightMm = convertToMm(first.dimension.height, unit);
    }
    const usableW = pageWidthMm - 2 * PRINT_PAGE_MARGIN_MM;
    const usableH = pageHeightMm - 2 * PRINT_PAGE_MARGIN_MM;
    const cols = Math.max(1, Math.floor((usableW + PRINT_GAP_MM) / (cardWidthMm + PRINT_GAP_MM)));
    const rows = Math.max(1, Math.floor((usableH + PRINT_GAP_MM) / (cardHeightMm + PRINT_GAP_MM)));
    const cardsPerPage = cols * rows;
    const totalPages = cardsToPrint.length ? Math.ceil(cardsToPrint.length / cardsPerPage) : 0;
    return { cardWidthMm, cardHeightMm, cols, rows, cardsPerPage, totalPages };
  }, [cardsToPrint, pageWidthMm, pageHeightMm]);

  const { cardWidthMm, cardHeightMm, cols, rows, cardsPerPage, totalPages } = printLayout;

  // One A4 page = fronts only, next A4 page = backs for the same students (same grid positions)
  const spreadPagesCount = totalPages > 0 ? totalPages * 2 : 0;

  const pageSizeSummary =
    pageSizeMode === 'a4'
      ? `A4 (${A4_WIDTH_MM}×${A4_HEIGHT_MM} mm)`
      : `Custom (${(pageWidthMm / 10).toFixed(1)}×${(pageHeightMm / 10).toFixed(1)} cm)`;

  const pageSizeControlStyle = {
    background: '#2a2a2a',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
  };

  const renderPageSizeControls = (idPrefix = 'page') => (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      <label htmlFor={`${idPrefix}-size-mode`} style={{ color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
        Page size
      </label>
      <select
        id={`${idPrefix}-size-mode`}
        value={pageSizeMode}
        onChange={(e) => setPageSizeMode(e.target.value)}
        style={{ ...pageSizeControlStyle, minWidth: 140 }}
      >
        <option value="a4">A4 (21×29.7 cm)</option>
        <option value="custom">Custom (cm)</option>
      </select>
      {pageSizeMode === 'custom' && (
        <>
          <label htmlFor={`${idPrefix}-w-cm`} style={{ color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Width (cm)
            <input
              id={`${idPrefix}-w-cm`}
              type="number"
              min={MIN_PAGE_CM}
              max={MAX_PAGE_CM}
              step={0.1}
              value={customPageWidthCm}
              onChange={(e) => setCustomPageWidthCm(e.target.value)}
              style={{ ...pageSizeControlStyle, width: 88 }}
            />
          </label>
          <label htmlFor={`${idPrefix}-h-cm`} style={{ color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Height (cm)
            <input
              id={`${idPrefix}-h-cm`}
              type="number"
              min={MIN_PAGE_CM}
              max={MAX_PAGE_CM}
              step={0.1}
              value={customPageHeightCm}
              onChange={(e) => setCustomPageHeightCm(e.target.value)}
              style={{ ...pageSizeControlStyle, width: 88 }}
            />
          </label>
        </>
      )}
    </div>
  );

  useEffect(() => {
    if (!showPrintView || !printContentRef.current) return;
    const timer = setTimeout(() => window.print(), hasFabricCards ? 2200 : 800);
    return () => clearTimeout(timer);
  }, [showPrintView, hasFabricCards]);

  useEffect(() => {
    const onAfterPrint = () => setShowPrintView(false);
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, []);

  useEffect(() => {
    if (!showDownloadMenuList && !showDownloadMenuPreview) return;
    const close = (e) => {
      if (!e.target.closest('.download-dropdown-wrap')) {
        setShowDownloadMenuList(false);
        setShowDownloadMenuPreview(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showDownloadMenuList, showDownloadMenuPreview]);

  useEffect(() => {
    if (!pendingExportFormat || !showPreviewView) return;
    const format = pendingExportFormat;
    let cancelled = false;
    const run = async () => {
      setExporting(true);
      const fileBaseName = `id-cards-${classId || schoolId || 'export'}-${Date.now()}`;
      let captured = false;
      try {
        for (let attempt = 0; attempt < 80; attempt++) {
          await delay(100);
          if (cancelled) return;
          const wrap = previewPagesWrapRef.current;
          if (!wrap) continue;
          const nodes = wrap.querySelectorAll('.print-page.preview-page');
          if (nodes.length > 0 && spreadPagesCount > 0 && nodes.length === spreadPagesCount) {
            await exportPreviewPagesAsFiles(
              Array.from(nodes),
              format,
              pageWidthMm,
              pageHeightMm,
              fileBaseName,
            );
            captured = true;
            break;
          }
        }
        if (!captured && !cancelled) {
          window.alert('Could not capture the preview. Open Preview, wait for cards to load, then try Download again.');
        }
      } catch (err) {
        console.error(err);
        window.alert('Download failed. Wait for the preview to finish loading, then try again.');
      } finally {
        if (!cancelled) {
          setExporting(false);
          setPendingExportFormat(null);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [pendingExportFormat, showPreviewView, spreadPagesCount, pageWidthMm, pageHeightMm, classId, schoolId]);

  const triggerExport = (fmt) => {
    if (exporting) return;
    setShowDownloadMenuList(false);
    setShowDownloadMenuPreview(false);
    if (!showPreviewView) {
      setShowPreviewView(true);
    }
    setPendingExportFormat(fmt);
  };

  const cardCellStyle = (card) => {
    const dim = card.dimension;
    const unit = card.dimensionUnit || 'mm';
    if (dim && typeof dim.width === 'number' && typeof dim.height === 'number') {
      return { width: `${dim.width}${unit}`, height: `${dim.height}${unit}`, minWidth: `${dim.width}${unit}`, minHeight: `${dim.height}${unit}` };
    }
    return undefined;
  };

  const renderCardForPrint = (card, useGridSize = false) => {
    const isFabric = card.templateId?.startsWith('fabric-');
    const fabricTemplate = isFabric ? getFabricTemplateById(card.templateId) : null;
    const cellStyle = useGridSize ? undefined : cardCellStyle(card);
    if (isFabric && fabricTemplate?.json) {
      const studentData = {
        name: card.name,
        studentId: card.studentId,
        className: card.className,
        schoolName: card.schoolName,
        studentImage: card.studentImage,
        ...(card.address != null && card.address !== '' && { address: card.address }),
      };
      return (
        <div key={`${card._id}-${card.id}`} className="print-card-cell fabric-card" style={cellStyle}>
          <FabricIdCardGenerator
            templateJson={fabricTemplate.json}
            backgroundDataUrl={fabricTemplate.backgroundDataUrl}
            studentData={studentData}
          />
        </div>
      );
    }
    const data = {
      studentImage: card.studentImage,
      name: card.name,
      studentId: card.studentId,
      className: card.className,
      schoolName: card.schoolName,
      ...(card.address != null && card.address !== '' && { address: card.address }),
      ...(card.dateOfBirth && { dateOfBirth: formatDateDMY(card.dateOfBirth) }),
      ...(card.phone && { phone: card.phone }),
      ...(card.email && { email: card.email }),
      ...(card.schoolLogo && { schoolLogo: card.schoolLogo }),
      ...(card.signature && { signature: card.signature }),
    };
    const uploadedT = card.uploadedTemplate || (card.templateId?.startsWith('uploaded-') ? getUploadedTemplateById(card.templateId) : null);
    const templateOverride = uploadedT ? { image: uploadedT.frontImage, elements: uploadedT.elements } : null;
    return (
      <div key={`${card._id}-${card.id}`} className="print-card-cell idcard-card" style={cellStyle}>
        <IdCardRenderer templateId={card.templateId} data={data} size="preview" template={templateOverride} />
      </div>
    );
  };

  const renderBackOnlyForPrint = (card, useGridSize = false) => {
    const cellStyle = useGridSize ? undefined : cardCellStyle(card);
    const uploadedBack = card.uploadedTemplate?.backImage
      ?? (card.templateId?.startsWith('uploaded-') ? getUploadedTemplateById(card.templateId)?.backImage : undefined);
    return (
      <div key={`back-${card._id}-${card.id}`} className="print-card-cell idcard-card" style={cellStyle}>
        <IdCardBackPreview
          schoolName={card.schoolName}
          address={card.address}
          templateId={card.templateId}
          size="preview"
          backImage={uploadedBack}
        />
      </div>
    );
  };

  // Renders one card as front (full size) + back (same size) stacked vertically (single-student modal only)
  const renderCardWithBackForPreview = (card, useGridSize = false) => {
    const cellStyle = useGridSize ? undefined : cardCellStyle(card);
    return (
      <div key={`${card._id}-${card.id}`} className="preview-card-stack preview-card-with-back" style={cellStyle}>
        <div className="preview-card-half preview-card-front">
          {renderCardForPrint(card, true)}
        </div>
        <div className="preview-card-half preview-card-back">
          <div className="print-card-cell idcard-card" style={{ width: '100%', height: '100%' }}>
            <IdCardBackPreview
              schoolName={card.schoolName}
              address={card.address}
              templateId={card.templateId}
              size="preview"
              backImage={card.uploadedTemplate?.backImage ?? (card.templateId?.startsWith('uploaded-') ? getUploadedTemplateById(card.templateId)?.backImage : undefined)}
            />
          </div>
        </div>
      </div>
    );
  };

  // —— View: Schools list (no schoolId)
  const renderSchoolsList = () => (
    <>
      <h3 style={{ marginBottom: 8 }}>Select school</h3>
      <p className="text-muted" style={{ marginBottom: 20, fontSize: '0.9rem' }}>
        {isViewTemplateFlow
          ? 'Click on a school to see its classes.'
          : 'Click on a school to see its classes with saved ID cards.'}
      </p>
      {loadingSchools && <p className="text-muted">Loading schools…</p>}
      {errorSchools && <p className="text-danger">{errorSchools}</p>}
      {!loadingSchools && !errorSchools && schools.length === 0 && (
        <p className="text-muted">No schools assigned.</p>
      )}
      {!loadingSchools && !errorSchools && schools.length > 0 && (
        <ul className="saved-idcards-list">
          {schools.map((school) => (
            <li key={school._id}>
              <button
                type="button"
                className="saved-idcard-item saved-idcard-class-item"
                onClick={() => navigate(`${basePath}/school/${school._id}`)}
              >
                <span className="saved-idcard-name">{school.schoolName || school.schoolCode || school._id}</span>
                <span className="text-muted saved-idcard-meta">{school.schoolCode || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // —— View: Classes list (schoolId, no classId)
  const renderClassesList = () => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate(basePath)}
          style={{ padding: '6px 12px' }}
        >
          ← Back to schools
        </button>
        <h3 style={{ margin: 0 }}>
          {selectedSchool?.schoolName || selectedSchool?.schoolCode || schoolId} – Select class
        </h3>
      </div>
      <p className="text-muted" style={{ marginBottom: 20, fontSize: '0.9rem' }}>
        {isViewTemplateFlow
          ? 'Click on a class to see its students.'
          : 'Click on a class to see students who have saved ID cards.'}
      </p>
      {loadingClasses && <p className="text-muted">Loading classes…</p>}
      {errorClasses && <p className="text-danger">{errorClasses}</p>}
      {!loadingClasses && !errorClasses && classes.length === 0 && (
        <p className="text-muted">No classes found.</p>
      )}
      {!loadingClasses && !errorClasses && classes.length > 0 && (
        <ul className="saved-idcards-list">
          {classes.map((cls) => (
            <li key={cls._id}>
              <button
                type="button"
                className="saved-idcard-item saved-idcard-class-item"
                onClick={() => navigate(`${basePath}/school/${schoolId}/class/${cls._id}`)}
              >
                <span className="saved-idcard-name">
                  {cls.className}{cls.section ? ` - ${cls.section}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // —— View: Students list (schoolId + classId)
  const renderStudentsList = () => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate(`${basePath}/school/${schoolId}`)}
          style={{ padding: '6px 12px' }}
        >
          ← Back to classes
        </button>
        <h3 style={{ margin: 0 }}>
          {selectedClass ? `${selectedClass.className}${selectedClass.section ? ` - ${selectedClass.section}` : ''}` : classId}
          {isViewTemplateFlow ? ' – Templates' : ' – Saved ID cards'}
        </h3>
      </div>
      <p className="text-muted" style={{ marginBottom: 20, fontSize: '0.9rem' }}>
        {isViewTemplateFlow
          ? 'Students with templates. Click to open preview.'
          : 'Students with saved ID cards. Click to open preview.'}
      </p>
      {loadingStudents && <p className="text-muted">Loading students…</p>}
      {errorStudents && <p className="text-danger">{errorStudents}</p>}
      {!loadingStudents && !errorStudents && studentsWithTemplates.length === 0 && (
        <p className="text-muted">{isViewTemplateFlow ? 'No templates in this class.' : 'No saved ID cards in this class.'}</p>
      )}
      {!loadingStudents && !errorStudents && studentsWithTemplates.length > 0 && (
        <>
          <div style={{ marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowPreviewView(true)}
            >
              👁️ Preview ID Cards
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowPrintView(true)}
            >
              🖨️ Print Cards
            </button>
            <div className="download-dropdown-wrap" style={{ position: 'relative', display: 'inline-block' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={exporting}
                onClick={() => setShowDownloadMenuList((v) => !v)}
              >
                {exporting ? 'Downloading…' : '⬇ Download'} ▾
              </button>
              {showDownloadMenuList && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 6,
                    zIndex: 20,
                    minWidth: 160,
                    background: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: 8,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                    overflow: 'hidden',
                  }}
                >
                  {['jpg', 'png', 'pdf'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      role="menuitem"
                      disabled={exporting}
                      onClick={() => triggerExport(fmt)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 14px',
                        border: 'none',
                        background: 'transparent',
                        cursor: exporting ? 'not-allowed' : 'pointer',
                        fontSize: '0.95rem',
                        textTransform: 'uppercase',
                      }}
                      onMouseEnter={(e) => {
                        if (!exporting) e.currentTarget.style.background = '#f3f4f6';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <ul className="saved-idcards-list">
            {studentsWithTemplates.map((student) => {
              // console.log('student', student);
              const card = studentToCard(student);
              return (
                <li key={student._id}>
                  <button
                    type="button"
                    className="saved-idcard-item"
                    onClick={() => setSingleCardPreview(card)}
                  >
                    <span className="saved-idcard-name">{student.studentName}</span>
                    <span className="text-muted saved-idcard-meta">
                      {getTemplateName(card.templateId, card)} · {student.admissionNo || student.rollNo || ''} ·{' '}
                      {student.template?.status || ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );

  const showSchools = schoolId == null;
  const showClasses = schoolId != null && classId == null;
  const showStudents = schoolId != null && classId != null;

  return (
    <>
      <Header title={title} showBack backTo={backTo} />
      <div className="card" style={{ maxWidth: 960 }}>
        {showSchools && renderSchoolsList()}
        {showClasses && renderClassesList()}
        {showStudents && renderStudentsList()}
      </div>

      {showPrintView && cardsToPrint.length > 0 && spreadPagesCount > 0 && (
        <div className="print-overlay" aria-hidden="true">
          <div
            className="print-overlay-toolbar"
            style={{
              position: 'fixed',
              top: 16,
              left: 16,
              zIndex: 10001,
              maxWidth: 'min(720px, calc(100vw - 120px))',
            }}
          >
            {renderPageSizeControls('print')}
          </div>
          <div ref={printContentRef} className="print-pages-wrap">
            {Array.from({ length: spreadPagesCount }, (_, pageIndex) => {
              const batchIndex = Math.floor(pageIndex / 2);
              const isBackPage = pageIndex % 2 === 1;
              const start = batchIndex * cardsPerPage;
              const pageCards = cardsToPrint.slice(start, start + cardsPerPage);
              return (
                <div
                  key={pageIndex}
                  className="print-page print-page-spread"
                  style={{
                    width: `${pageWidthMm}mm`,
                    height: `${pageHeightMm}mm`,
                    ['--card-w-mm']: cardWidthMm,
                    ['--card-h-mm']: cardHeightMm,
                    ['--cols']: cols,
                    ['--rows']: rows,
                  }}
                >
                  <div
                    className="print-cards-grid"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, ${cardWidthMm}mm)`,
                      gridTemplateRows: `repeat(${rows}, ${cardHeightMm}mm)`,
                    }}
                  >
                    {pageCards.map((card) => (isBackPage ? renderBackOnlyForPrint(card, true) : renderCardForPrint(card, true)))}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-secondary print-cancel-btn"
            onClick={() => setShowPrintView(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {showPreviewView && cardsToPrint.length > 0 && spreadPagesCount > 0 && (
        <div className="preview-overlay" aria-hidden="true">
          <div className="preview-overlay-header" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>
                ID Cards Preview – {pageSizeSummary} ({spreadPagesCount} page{spreadPagesCount !== 1 ? 's' : ''}; each batch: fronts, then backs)
              </h3>
              <div style={{ marginTop: 12 }}>{renderPageSizeControls('preview')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0 }}>
              <div className="download-dropdown-wrap" style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={exporting}
                  onClick={() => setShowDownloadMenuPreview((v) => !v)}
                >
                  {exporting ? 'Downloading…' : '⬇ Download'} ▾
                </button>
                {showDownloadMenuPreview && (
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: 6,
                      zIndex: 20,
                      minWidth: 160,
                      background: '#2a2a2a',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                      overflow: 'hidden',
                    }}
                  >
                    {['jpg', 'png', 'pdf'].map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        role="menuitem"
                        disabled={exporting}
                        onClick={() => triggerExport(fmt)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 14px',
                          border: 'none',
                          background: 'transparent',
                          color: '#fff',
                          cursor: exporting ? 'not-allowed' : 'pointer',
                          fontSize: '0.95rem',
                          textTransform: 'uppercase',
                        }}
                        onMouseEnter={(e) => {
                          if (!exporting) e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowPreviewView(false)}
                style={{ flexShrink: 0 }}
              >
                Close
              </button>
            </div>
          </div>
          <div className="preview-cards-scroll">
            <div className="preview-pages-wrap" ref={previewPagesWrapRef}>
              {Array.from({ length: spreadPagesCount }, (_, pageIndex) => {
                const batchIndex = Math.floor(pageIndex / 2);
                const isBackPage = pageIndex % 2 === 1;
                const start = batchIndex * cardsPerPage;
                const pageCards = cardsToPrint.slice(start, start + cardsPerPage);
                return (
                  <div
                    key={pageIndex}
                    className="print-page preview-page print-page-spread"
                    style={{
                      width: `${pageWidthMm}mm`,
                      height: `${pageHeightMm}mm`,
                      ['--card-w-mm']: cardWidthMm,
                      ['--card-h-mm']: cardHeightMm,
                      ['--cols']: cols,
                      ['--rows']: rows,
                    }}
                  >
                    <div
                      className="print-cards-grid"
                      style={{
                        gridTemplateColumns: `repeat(${cols}, ${cardWidthMm}mm)`,
                        gridTemplateRows: `repeat(${rows}, ${cardHeightMm}mm)`,
                      }}
                    >
                      {pageCards.map((card) => (isBackPage ? renderBackOnlyForPrint(card, true) : renderCardForPrint(card, true)))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {singleCardPreview && (
        <div className="single-card-preview-overlay" aria-hidden="true" onClick={() => setSingleCardPreview(null)}>
          <div className="single-card-preview-content" onClick={(e) => e.stopPropagation()}>
            <div className="single-card-preview-header">
              <h3 style={{ margin: 0 }}>{singleCardPreview.name} – ID Card Preview</h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSingleCardPreview(null)}
              >
                Close
              </button>
            </div>
            <div className="single-card-preview-card-wrap">
              {renderCardWithBackForPreview(singleCardPreview)}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .print-overlay {
          position: fixed;
          inset: 0;
          background: #1a1a1a;
          z-index: 9999;
          overflow: auto;
          padding: 72px 20px 20px;
        }
        .print-cancel-btn {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 10000;
        }
        .preview-overlay {
          position: fixed;
          inset: 0;
          background: #1a1a1a;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .preview-overlay-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          flex-shrink: 0;
        }
        .preview-cards-scroll {
          flex: 1;
          overflow: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }
        .preview-pages-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }
        .print-page.preview-page {
          flex-shrink: 0;
          box-shadow: 0 4px 24px rgba(0,0,0,0.4);
          background: #fff;
          border-radius: 2px;
          overflow: hidden;
          box-sizing: border-box;
        }
        .print-pages-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }
        .single-card-preview-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.75);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          box-sizing: border-box;
        }
        .single-card-preview-content {
          background: #1a1a1a;
          border-radius: 12px;
          max-width: 100%;
          max-height: 100%;
          overflow: auto;
          display: flex;
          flex-direction: column;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .single-card-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          flex-shrink: 0;
        }
        .single-card-preview-card-wrap {
          padding: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 280px;
        }
        .preview-card-stack {
          break-inside: avoid;
          page-break-inside: avoid;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          width: calc(var(--card-w-mm, 90) * 1mm);
          min-width: calc(var(--card-w-mm, 90) * 1mm);
          max-width: calc(var(--card-w-mm, 90) * 1mm);
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }
        .preview-card-with-back {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          min-height: 0;
          gap: ${PRINT_GAP_MM}mm;
        }
        .preview-cards-grid-with-back .preview-card-half {
          flex: 0 0 calc(var(--card-h-mm, 57) * 1mm);
          height: calc(var(--card-h-mm, 57) * 1mm);
          min-height: 0;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 10px;
        }
        .preview-card-half {
          flex: 1;
          min-height: 0;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 10px;
        }
        .preview-card-half .print-card-cell {
          width: 100% !important;
          height: 100% !important;
          min-width: 0;
          min-height: 0;
          max-width: 100%;
          max-height: 100%;
          border-radius: 10px;
          overflow: hidden;
        }
        .preview-card-half .print-card-cell .idcard,
        .preview-card-half .idcard {
          width: 100% !important;
          height: 100% !important;
          max-width: 100% !important;
          max-height: 100% !important;
          border-radius: 10px;
        }
        .preview-cards-grid-with-back .preview-card-stack.preview-card-with-back {
          height: 100%;
          min-height: 0;
          max-height: none;
        }
        .single-card-preview-card-wrap .preview-card-with-back {
          max-width: 420px;
          width: 100%;
          height: auto;
          aspect-ratio: 1.72 / 2;
        }
        .single-card-preview-card-wrap .preview-card-stack {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          height: 100%;
        }
        .single-card-preview-card-wrap .preview-card-half {
          min-height: 0;
        }
        .single-card-preview-card-wrap .print-card-cell {
          box-shadow: 0 4px 24px rgba(0,0,0,0.35);
          border-radius: 10px;
          overflow: visible;
        }
        .single-card-preview-card-wrap .print-card-cell.idcard-card {
          padding: 0;
          display: block;
        }
        .single-card-preview-card-wrap .print-card-cell.idcard-card .idcard {
          width: 100%;
          height: 100%;
          max-width: 100%;
          transform: none;
          box-sizing: border-box;
        }
        .single-card-preview-card-wrap .print-card-cell.idcard-card[style*="width"] .idcard {
          width: 100%;
          height: 100%;
        }
        .single-card-preview-card-wrap .print-card-cell.fabric-card {
          padding: 0;
        }
        .single-card-preview-card-wrap .print-card-cell.fabric-card .fabric-idcard-generator {
          transform: scale(0.65);
          transform-origin: top center;
        }
        .print-page {
          box-sizing: border-box;
          padding: ${PRINT_PAGE_MARGIN_MM}mm;
          display: flex;
          align-items: flex-start;
          justify-content: flex-start;
        }
        .print-cards-grid {
          display: grid;
          grid-template-columns: repeat(var(--cols, 2), calc(var(--card-w-mm, 90) * 1mm));
          grid-template-rows: repeat(var(--rows, 4), calc(var(--card-h-mm, 57) * 1mm));
          gap: ${PRINT_GAP_MM}mm;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }
        .print-card-cell {
          break-inside: avoid;
          page-break-inside: avoid;
          display: flex;
          align-items: center;
          justify-content: center;
          width: calc(var(--card-w-mm, 90) * 1mm);
          height: calc(var(--card-h-mm, 57) * 1mm);
          min-width: calc(var(--card-w-mm, 90) * 1mm);
          min-height: calc(var(--card-h-mm, 57) * 1mm);
          max-width: calc(var(--card-w-mm, 90) * 1mm);
          max-height: calc(var(--card-h-mm, 57) * 1mm);
          overflow: hidden;
          box-sizing: border-box;
        }
        .print-card-cell.fabric-card {
          padding: 0;
        }
        .print-card-cell.fabric-card .fabric-idcard-generator {
          transform-origin: top left;
        }
        .print-card-cell.idcard-card {
          padding: 0;
        }
        .print-card-cell.idcard-card .idcard {
          max-width: 100%;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }
        @media print {
          @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; }
          body * { visibility: hidden; }
          .print-overlay,
          .print-overlay * { visibility: visible; }
          .print-overlay {
            position: absolute;
            inset: 0;
            left: 0;
            top: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100%;
            background: #fff;
            padding: 0;
            margin: 0;
            overflow: hidden;
          }
          .print-pages-wrap {
            padding: 0;
            margin: 0;
          }
          .print-cancel-btn { display: none !important; }
          .print-page {
            width: ${pageWidthMm}mm !important;
            height: ${pageHeightMm}mm !important;
            min-width: ${pageWidthMm}mm;
            min-height: ${pageHeightMm}mm;
            max-width: ${pageWidthMm}mm;
            max-height: ${pageHeightMm}mm;
            page-break-after: always;
            margin: 0;
            padding: ${PRINT_PAGE_MARGIN_MM}mm !important;
            box-sizing: border-box;
            overflow: hidden;
          }
          .print-page:last-child { page-break-after: auto; }
          .print-cards-grid {
            width: 100%;
            height: 100%;
            display: grid;
            grid-template-columns: repeat(var(--cols, 2), calc(var(--card-w-mm, 90) * 1mm));
            grid-template-rows: repeat(var(--rows, 4), calc(var(--card-h-mm, 57) * 1mm));
            gap: ${PRINT_GAP_MM}mm;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          .print-card-cell {
            width: calc(var(--card-w-mm, 90) * 1mm) !important;
            height: calc(var(--card-h-mm, 57) * 1mm) !important;
            min-width: calc(var(--card-w-mm, 90) * 1mm);
            min-height: calc(var(--card-h-mm, 57) * 1mm);
            max-width: calc(var(--card-w-mm, 90) * 1mm);
            max-height: calc(var(--card-h-mm, 57) * 1mm);
            box-sizing: border-box;
            overflow: hidden;
          }
          .print-card-cell.fabric-card .fabric-idcard-generator {
            transform: scale(0.178);
            transform-origin: top left;
          }
          .print-card-cell.fabric-card .fabric-idcard-canvas-wrap {
            width: 506px;
            height: 319px;
          }
          .print-card-cell.idcard-card .idcard {
            width: 100%;
            height: 100%;
            max-width: none;
            object-fit: contain;
          }
          .print-card-cell.idcard-card {
            display: block;
          }
        }
      `}</style>
    </>
  );
}
