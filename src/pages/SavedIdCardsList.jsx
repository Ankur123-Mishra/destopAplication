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

// A4 size (mm). Preview and print show as many cards per page as fit on one A4.
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PRINT_PAGE_MARGIN_MM = 12;
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

  // Compute A4 layout: how many cards fit per page based on card dimension (first card or default)
  const printLayout = React.useMemo(() => {
    const first = cardsToPrint[0];
    let cardWidthMm = DEFAULT_CARD_WIDTH_MM;
    let cardHeightMm = DEFAULT_CARD_HEIGHT_MM;
    if (first?.dimension && typeof first.dimension.width === 'number' && typeof first.dimension.height === 'number') {
      const unit = first.dimensionUnit || 'mm';
      cardWidthMm = convertToMm(first.dimension.width, unit);
      console.log('cardWidthMm', cardWidthMm, 'unit:', unit);
      cardHeightMm = convertToMm(first.dimension.height, unit);
      console.log('cardHeightMm', cardHeightMm, 'unit:', unit);
    }
    const usableW = A4_WIDTH_MM - 2 * PRINT_PAGE_MARGIN_MM;
    const usableH = A4_HEIGHT_MM - 2 * PRINT_PAGE_MARGIN_MM;
    const cols = Math.max(1, Math.floor((usableW + PRINT_GAP_MM) / (cardWidthMm + PRINT_GAP_MM)));
    const rows = Math.max(1, Math.floor((usableH + PRINT_GAP_MM) / (cardHeightMm + PRINT_GAP_MM)));
    const cardsPerPage = cols * rows;
    const totalPages = cardsToPrint.length ? Math.ceil(cardsToPrint.length / cardsPerPage) : 0;
    return { cardWidthMm, cardHeightMm, cols, rows, cardsPerPage, totalPages };
  }, [cardsToPrint]);

  const { cardWidthMm, cardHeightMm, cols, rows, cardsPerPage, totalPages } = printLayout;

  // Preview layout: each slot = front + back stacked (same size each), so row height = 2 * card height
  const previewLayout = React.useMemo(() => {
    const usableH = A4_HEIGHT_MM - 2 * PRINT_PAGE_MARGIN_MM;
    const previewRowHeightMm = 2 * cardHeightMm + PRINT_GAP_MM;
    const previewRows = Math.max(1, Math.floor((usableH + PRINT_GAP_MM) / previewRowHeightMm));
    const previewCardsPerPage = cols * previewRows;
    const previewTotalPages = cardsToPrint.length ? Math.ceil(cardsToPrint.length / previewCardsPerPage) : 0;
    return { previewRowHeightMm, previewRows, previewCardsPerPage, previewTotalPages };
  }, [cardHeightMm, cols, cardsToPrint.length]);

  const { previewRowHeightMm, previewRows, previewCardsPerPage, previewTotalPages } = previewLayout;

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

  // Renders one card as front (full size) + back (same size) stacked vertically (for preview view)
  const renderCardWithBackForPreview = (card, useGridSize = false) => {
    console.log("card data with back for preview", card);
    const cellStyle = useGridSize ? undefined : cardCellStyle(card);
    return (
      <div key={`${card._id}-${card.id}`} className="print-card-cell preview-card-with-back" style={cellStyle}>
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
          <div style={{ marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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

      {showPrintView && cardsToPrint.length > 0 && previewTotalPages > 0 && (
        <div className="print-overlay" aria-hidden="true">
          <div ref={printContentRef} className="print-pages-wrap">
            {Array.from({ length: previewTotalPages }, (_, pageIndex) => {
              const start = pageIndex * previewCardsPerPage;
              const pageCards = cardsToPrint.slice(start, start + previewCardsPerPage);
              return (
                <div
                  key={pageIndex}
                  className="print-page print-page-with-back"
                  style={{
                    width: `${A4_WIDTH_MM}mm`,
                    height: `${A4_HEIGHT_MM}mm`,
                    ['--card-w-mm']: cardWidthMm,
                    ['--card-h-mm']: cardHeightMm,
                    ['--print-row-h-mm']: previewRowHeightMm,
                    ['--cols']: cols,
                    ['--rows']: previewRows,
                  }}
                >
                  <div
                    className="print-cards-grid preview-cards-grid-with-back"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, ${cardWidthMm}mm)`,
                      gridTemplateRows: `repeat(${previewRows}, ${previewRowHeightMm}mm)`,
                    }}
                  >
                    {pageCards.map((card) => renderCardWithBackForPreview(card, true))}
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

      {showPreviewView && cardsToPrint.length > 0 && previewTotalPages > 0 && (
        <div className="preview-overlay" aria-hidden="true">
          <div className="preview-overlay-header">
            <h3 style={{ margin: 0 }}>ID Cards Preview – A4 ({previewTotalPages} page{previewTotalPages !== 1 ? 's' : ''})</h3>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowPreviewView(false)}
            >
              Close
            </button>
          </div>
          <div className="preview-cards-scroll">
            <div className="preview-pages-wrap">
              {Array.from({ length: previewTotalPages }, (_, pageIndex) => {
                console.log("pageIndex", pageIndex);
                const start = pageIndex * previewCardsPerPage;
                const pageCards = cardsToPrint.slice(start, start + previewCardsPerPage);
                // console.log("pageCards", pageCards);
                return (
                  <div
                    key={pageIndex}
                    className="print-page preview-page"
                    style={{
                      width: `${A4_WIDTH_MM}mm`,
                      height: `${A4_HEIGHT_MM}mm`,
                      ['--card-w-mm']: cardWidthMm,
                      ['--card-h-mm']: cardHeightMm,
                      ['--cols']: cols,
                      ['--rows']: previewRows,
                    }}
                  >
                    <div
                      className="print-cards-grid preview-cards-grid-with-back"
                      style={{
                        gridTemplateColumns: `repeat(${cols}, ${cardWidthMm}mm)`,
                        gridTemplateRows: `repeat(${previewRows}, ${previewRowHeightMm}mm)`,
                      }}
                    >
                      {pageCards.map((card) => renderCardWithBackForPreview(card, true))}
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
          padding: 20px;
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
        .preview-card-with-back {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          min-height: 0;
          gap: 10px;
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
        .preview-cards-grid-with-back .print-card-cell.preview-card-with-back {
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
          @page { size: A4; margin: 0; }
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
            width: ${A4_WIDTH_MM}mm !important;
            height: ${A4_HEIGHT_MM}mm !important;
            min-width: ${A4_WIDTH_MM}mm;
            min-height: ${A4_HEIGHT_MM}mm;
            max-width: ${A4_WIDTH_MM}mm;
            max-height: ${A4_HEIGHT_MM}mm;
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
          .print-page.print-page-with-back .print-cards-grid.preview-cards-grid-with-back {
            grid-template-rows: repeat(var(--rows), calc(var(--print-row-h-mm, 118) * 1mm));
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
          .print-page.print-page-with-back .print-card-cell.preview-card-with-back {
            height: calc(var(--print-row-h-mm, 118) * 1mm) !important;
            min-height: calc(var(--print-row-h-mm, 118) * 1mm);
            max-height: calc(var(--print-row-h-mm, 118) * 1mm);
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
