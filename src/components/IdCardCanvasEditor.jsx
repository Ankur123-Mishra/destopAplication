import React, { useState, useRef, useCallback, useEffect } from 'react';
import { updatePhotographerSchool } from '../api/dashboard';
import './IdCardCanvasEditor.css';

const FIELD_DEFS = [
  { key: 'name', label: 'Name' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'admissionNo', label: 'Admission No' },
  { key: 'rollNo', label: 'Roll No' },
  { key: 'uniqueCode', label: 'Unique Code' },
  { key: 'className', label: 'Class' },
  { key: 'schoolName', label: 'School' },
  { key: 'dateOfBirth', label: 'DOB' },
  { key: 'phone', label: 'Mobile' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
];

const DEFAULT_ELEMENTS = () => [
  { type: 'photo', id: 'photo', x: 8, y: 22, width: 30, height: 48 },
  { type: 'text', id: 'name', dataField: 'name', x: 45, y: 24, fontSize: 14, content: '', fontWeight: '700' },
  { type: 'text', id: 'studentId', dataField: 'studentId', x: 45, y: 36, fontSize: 11, content: '' },
  { type: 'text', id: 'class', dataField: 'className', x: 45, y: 46, fontSize: 11, content: '' },
  { type: 'text', id: 'school', dataField: 'schoolName', x: 45, y: 56, fontSize: 10, content: '' },
];

function formatDateDMY(input) {
  if (!input) return '';
  // Accept Date
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const dd = String(input.getDate()).padStart(2, '0');
    const mm = String(input.getMonth() + 1).padStart(2, '0');
    const yy = String(input.getFullYear());
    return `${dd}/${mm}/${yy}`;
  }
  const s = String(input).trim();
  if (!s) return '';
  // ISO like 2026-03-18T... or yyyy-mm-dd
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // Already d/m/y or dd/mm/yyyy
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    const dd = String(m2[1]).padStart(2, '0');
    const mm = String(m2[2]).padStart(2, '0');
    return `${dd}/${mm}/${m2[3]}`;
  }
  return s;
}

function normalizeValue(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Backend unit → valid CSS length unit for width/height */
const DEFAULT_TEXT_COLOR = '#111111';

/** Normalize to #rrggbb for <input type="color"> */
function toHexColorForInput(value) {
  if (!value || typeof value !== 'string') return DEFAULT_TEXT_COLOR;
  const s = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/i.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return DEFAULT_TEXT_COLOR;
}

const TEXT_COLOR_PRESETS = [
  { label: 'Black', value: '#111111' },
  { label: 'White', value: '#ffffff' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Maroon', value: '#7f1d1d' },
  { label: 'Green', value: '#166534' },
  { label: 'Gold', value: '#b45309' },
];

/** Canvas snap positions (percent-based stage). */
const CANVAS_ALIGN_OPTIONS = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-right', label: 'Top right' },
  { value: 'middle-left', label: 'Middle left' },
  { value: 'center', label: 'Center' },
  { value: 'middle-right', label: 'Middle right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
];

function getElementBoxPercentForAlign(el) {
  if (el.type === 'photo') {
    return {
      w: typeof el.width === 'number' ? el.width : 30,
      h: typeof el.height === 'number' ? el.height : 48,
    };
  }
  const multiline = el.dataField === 'address';
  return {
    w: 42,
    h: multiline ? 20 : 8,
  };
}

function computeAlignedXY(el, alignValue) {
  const { w, h } = getElementBoxPercentForAlign(el);
  const maxX = Math.max(0, 100 - w);
  const maxY = Math.max(0, 100 - h);
  let x = 0;
  let y = 0;
  switch (alignValue) {
    case 'top-left':
      x = 0;
      y = 0;
      break;
    case 'top-center':
      x = maxX / 2;
      y = 0;
      break;
    case 'top-right':
      x = maxX;
      y = 0;
      break;
    case 'middle-left':
      x = 0;
      y = maxY / 2;
      break;
    case 'center':
      x = maxX / 2;
      y = maxY / 2;
      break;
    case 'middle-right':
      x = maxX;
      y = maxY / 2;
      break;
    case 'bottom-left':
      x = 0;
      y = maxY;
      break;
    case 'bottom-center':
      x = maxX / 2;
      y = maxY;
      break;
    case 'bottom-right':
      x = maxX;
      y = maxY;
      break;
    default:
      return null;
  }
  return {
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(maxY, y)),
  };
}

function normalizeCssDimensionUnit(unit) {
  if (!unit || typeof unit !== 'string') return 'mm';
  const u = unit.trim().toLowerCase();
  if (u === 'inch' || u === 'inches') return 'in';
  if (['mm', 'cm', 'in', 'px', 'pt'].includes(u)) return u;
  return 'mm';
}

/** When set, the stage renders at real card size (e.g. 88mm × 56mm). */
function getPhysicalStageSizeStyle(dimension, dimensionUnit) {
  if (!dimension || typeof dimension.width !== 'number' || typeof dimension.height !== 'number') return null;
  if (dimension.width <= 0 || dimension.height <= 0) return null;
  const unit = normalizeCssDimensionUnit(dimensionUnit);
  return {
    width: `${dimension.width}${unit}`,
    height: `${dimension.height}${unit}`,
    maxWidth: 'none',
    minHeight: 0,
    aspectRatio: 'auto',
  };
}

export default function IdCardCanvasEditor({
  templateImage,
  studentImage,
  initialElements,
  initialData = {},
  /** Physical card size from API (e.g. school dimension) — stage matches this size in the given unit */
  dimension,
  dimensionUnit,
  /** When set with schoolPutPayload, shows “Edit dimension” and PUTs school on save */
  schoolId,
  schoolPutPayload,
  onDimensionUpdated,
  onSave,
  onCancel,
  saveLabel = 'Save ID Card',
  cancelLabel = 'Cancel',
}) {
  const canvasRef = useRef(null);
  const [elements, setElements] = useState(() => initialElements || DEFAULT_ELEMENTS());
  const [selectedId, setSelectedId] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [resizeState, setResizeState] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(studentImage);
  const [colorHexDraft, setColorHexDraft] = useState('');
  const [alignMenuOpen, setAlignMenuOpen] = useState(false);
  const alignMenuRef = useRef(null);
  const didInitAddAllRef = useRef(false);
  const [dimensionLocal, setDimensionLocal] = useState(null);
  const [dimensionFormOpen, setDimensionFormOpen] = useState(false);
  const [dimHeightDraft, setDimHeightDraft] = useState('56');
  const [dimWidthDraft, setDimWidthDraft] = useState('88');
  const [dimUnitDraft, setDimUnitDraft] = useState('mm');
  const [dimensionSaving, setDimensionSaving] = useState(false);
  const [dimensionError, setDimensionError] = useState('');

  useEffect(() => {
    setDimensionLocal(null);
  }, [dimension?.height, dimension?.width, dimensionUnit, schoolId]);

  const effectiveDimension = dimensionLocal?.dimension ?? dimension;
  const effectiveDimensionUnit = dimensionLocal?.dimensionUnit ?? dimensionUnit;

  useEffect(() => {
    setPhotoUrl(studentImage);
  }, [studentImage]);

  useEffect(() => {
    if (!alignMenuOpen) return;
    const onDocDown = (e) => {
      if (alignMenuRef.current && !alignMenuRef.current.contains(e.target)) {
        setAlignMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocDown, true);
    return () => document.removeEventListener('pointerdown', onDocDown, true);
  }, [alignMenuOpen]);

  useEffect(() => {
    if (!selectedId) setAlignMenuOpen(false);
  }, [selectedId]);

  const getFieldValue = useCallback((key) => {
    const raw = normalizeValue((initialData || {})[key]);
    if (key === 'dateOfBirth') return formatDateDMY(raw);
    return raw;
  }, [initialData]);

  const elementHasField = useCallback((fieldKey) => {
    return elements.some((el) => el.type === 'text' && el.dataField === fieldKey);
  }, [elements]);

  const nextAutoPosition = useCallback(() => {
    const textEls = elements.filter((e) => e.type === 'text');
    const maxY = textEls.reduce((m, e) => (typeof e.y === 'number' ? Math.max(m, e.y) : m), 18);
    const y = Math.min(92, maxY + 7);
    return { x: 45, y };
  }, [elements]);

  const addFieldElement = useCallback((fieldKey) => {
    const def = FIELD_DEFS.find((d) => d.key === fieldKey);
    const label = def?.label || fieldKey;
    const { x, y } = nextAutoPosition();
    setElements((prev) => {
      const existing = prev.find((el) => el.type === 'text' && el.dataField === fieldKey);
      if (existing) return prev;
      // ensure unique id
      const baseId = `field-${fieldKey}`;
      let id = baseId;
      let n = 2;
      while (prev.some((e) => e.id === id)) {
        id = `${baseId}-${n}`;
        n += 1;
      }
      return [
        ...prev,
        { type: 'text', id, dataField: fieldKey, x, y, fontSize: 10, content: '', fontWeight: fieldKey === 'name' ? '700' : '400', label },
      ];
    });
  }, [nextAutoPosition]);

  const removeFieldElement = useCallback((fieldKey) => {
    setElements((prev) => prev.filter((el) => !(el.type === 'text' && el.dataField === fieldKey)));
    setSelectedId((cur) => {
      const curEl = elements.find((e) => e.id === cur);
      if (curEl?.type === 'text' && curEl.dataField === fieldKey) return null;
      return cur;
    });
  }, [elements]);

  const addAllFields = useCallback(() => {
    FIELD_DEFS.forEach((f) => {
      const val = getFieldValue(f.key);
      if (val) addFieldElement(f.key);
    });
  }, [addFieldElement, getFieldValue]);

  // Auto-add all available fields once when arranging/uploading templates, so user can remove before upload.
  useEffect(() => {
    if (didInitAddAllRef.current) return;
    if (initialElements) return; // do not override a provided template layout
    didInitAddAllRef.current = true;
    addAllFields();
  }, [addAllFields, initialElements]);

  const getCanvasRect = useCallback(() => canvasRef.current?.getBoundingClientRect() || null);

  const pxToPercent = useCallback((pxVal, isX) => {
    const rect = getCanvasRect();
    if (!rect) return 0;
    return (pxVal / (isX ? rect.width : rect.height)) * 100;
  }, [getCanvasRect]);

  const handlePointerDown = (e, id, isResizeHandle) => {
    e.preventDefault();
    const rect = getCanvasRect();
    if (!rect) return;
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    setSelectedId(id);
    if (el.type === 'photo' && isResizeHandle) {
      setResizeState({
        id,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: el.width,
        startHeight: el.height,
      });
    } else {
      setDragState({
        id,
        startX: e.clientX,
        startY: e.clientY,
        startElX: el.x,
        startElY: el.y,
      });
    }
  };

  useEffect(() => {
    if (!dragState && !resizeState) return;
    const rect = getCanvasRect();
    const handleMove = (e) => {
      if (resizeState) {
        const dx = pxToPercent(e.clientX - resizeState.startX, true);
        const dy = pxToPercent(e.clientY - resizeState.startY, false);
        setElements((prev) =>
          prev.map((el) =>
            el.id === resizeState.id
              ? {
                  ...el,
                  width: Math.max(15, Math.min(50, resizeState.startWidth + dx)),
                  height: Math.max(20, Math.min(70, resizeState.startHeight + dy)),
                }
              : el
          )
        );
      } else if (dragState) {
        const dx = pxToPercent(e.clientX - dragState.startX, true);
        const dy = pxToPercent(e.clientY - dragState.startY, false);
        setElements((prev) =>
          prev.map((el) =>
            el.id === dragState.id
              ? {
                  ...el,
                  x: Math.max(0, Math.min(100 - (el.width || 30), dragState.startElX + dx)),
                  y: Math.max(0, Math.min(100 - (el.height || 10), dragState.startElY + dy)),
                }
              : el
          )
        );
      }
    };
    const handleUp = () => {
      setDragState(null);
      setResizeState(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragState, resizeState, getCanvasRect, pxToPercent]);

  const updateElementContent = (id, content) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, content } : el))
    );
  };

  const setSelectedTextColor = useCallback((hex) => {
    if (!selectedId) return;
    setElements((prev) =>
      prev.map((x) => (x.id === selectedId ? { ...x, color: hex } : x))
    );
  }, [selectedId]);

  const updateElementDataField = (id, dataField) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, dataField: dataField || undefined } : el))
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setElements((prev) => prev.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(reader.result);
    reader.readAsDataURL(file);
  };

  const selectedEl = elements.find((e) => e.id === selectedId);
  const isPhoto = selectedEl?.type === 'photo';
  const physicalStageStyle = getPhysicalStageSizeStyle(effectiveDimension, effectiveDimensionUnit);

  const openDimensionForm = useCallback(() => {
    const h =
      effectiveDimension && typeof effectiveDimension.height === 'number'
        ? effectiveDimension.height
        : 56;
    const w =
      effectiveDimension && typeof effectiveDimension.width === 'number'
        ? effectiveDimension.width
        : 88;
    const u = normalizeCssDimensionUnit(effectiveDimensionUnit);
    setDimHeightDraft(String(h));
    setDimWidthDraft(String(w));
    setDimUnitDraft(u);
    setDimensionError('');
    setDimensionFormOpen(true);
  }, [effectiveDimension, effectiveDimensionUnit]);

  const handleDimensionUpdate = async () => {
    if (!schoolId || !schoolPutPayload) return;
    const h = Number(String(dimHeightDraft).trim());
    const w = Number(String(dimWidthDraft).trim());
    if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) {
      setDimensionError('Enter valid height and width (positive numbers).');
      return;
    }
    const unit = normalizeCssDimensionUnit(dimUnitDraft);
    const { schoolName, schoolCode = '', address = '', allowedMobiles = [] } = schoolPutPayload;
    const nameTrim = String(schoolName || '').trim();
    if (!nameTrim) {
      setDimensionError('School name is required to update.');
      return;
    }
    let addrTrim = String(address || '').trim();
    if (!addrTrim) addrTrim = 'Not specified';
    setDimensionSaving(true);
    setDimensionError('');
    try {
      await updatePhotographerSchool(schoolId, {
        schoolName: nameTrim,
        schoolCode: String(schoolCode || '').trim(),
        address: addrTrim,
        dimension: { height: h, width: w },
        dimensionUnit: unit,
        allowedMobiles: Array.isArray(allowedMobiles) ? allowedMobiles.map((x) => String(x).trim()).filter(Boolean) : [],
      });
      const next = { dimension: { height: h, width: w }, dimensionUnit: unit };
      setDimensionLocal(next);
      onDimensionUpdated?.(next);
      setDimensionFormOpen(false);
    } catch (err) {
      setDimensionError(err?.message || 'Update failed');
    } finally {
      setDimensionSaving(false);
    }
  };

  useEffect(() => {
    if (selectedEl?.type === 'text') {
      setColorHexDraft(selectedEl.color ? toHexColorForInput(selectedEl.color) : '');
    } else {
      setColorHexDraft('');
    }
  }, [selectedId, selectedEl?.type, selectedEl?.color]);

  const applyCanvasAlignment = useCallback(
    (alignValue) => {
      if (!selectedId) return;
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== selectedId) return el;
          const next = computeAlignedXY(el, alignValue);
          if (!next) return el;
          return { ...el, x: next.x, y: next.y };
        })
      );
      setAlignMenuOpen(false);
    },
    [selectedId]
  );

  const handleSaveClick = () => {
    onSave({
      elements,
      studentImage: photoUrl,
      name: (getFieldValue('name') || (elements.find((e) => e.id === 'name')?.content ?? '')),
      studentId: (getFieldValue('studentId') || (elements.find((e) => e.id === 'studentId')?.content ?? '')),
      className: (getFieldValue('className') || (elements.find((e) => e.id === 'class')?.content ?? '')),
      schoolName: (getFieldValue('schoolName') || (elements.find((e) => e.id === 'school')?.content ?? '')),
    });
  };

  return (
    <div className="idcard-canvas-editor">
      <div className="idcard-canvas-toolbar">
        <span className="idcard-canvas-hint">Drag elements to move · Select photo & drag corner to resize · Click text to edit below</span>
        <div className="idcard-canvas-toolbar-center">
          {selectedId && selectedEl && (
            <div className="idcard-canvas-align" ref={alignMenuRef}>
              <button
                type="button"
                className="btn btn-secondary idcard-canvas-align-trigger"
                aria-expanded={alignMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setAlignMenuOpen((o) => !o)}
              >
                Align on card
                <span className="idcard-canvas-align-chevron" aria-hidden>
                  {alignMenuOpen ? '▲' : '▼'}
                </span>
              </button>
              {alignMenuOpen && (
                <ul className="idcard-canvas-align-menu" role="listbox">
                  {CANVAS_ALIGN_OPTIONS.map((opt) => (
                    <li key={opt.value} role="none">
                      <button
                        type="button"
                        role="option"
                        className="idcard-canvas-align-item"
                        onClick={() => applyCanvasAlignment(opt.value)}
                      >
                        {opt.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="idcard-canvas-actions">
          {schoolId && schoolPutPayload && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => (dimensionFormOpen ? setDimensionFormOpen(false) : openDimensionForm())}
            >
              {dimensionFormOpen ? 'Close dimension' : 'Edit dimension'}
            </button>
          )}
          <label className="btn btn-secondary" style={{ marginBottom: 0, cursor: 'pointer' }}>
            Upload photo
            <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
          </label>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="btn btn-primary" onClick={handleSaveClick}>{saveLabel}</button>
        </div>
      </div>

      <div className="idcard-canvas-layout">
        <div className="idcard-canvas-stage-outer">
          <div
            ref={canvasRef}
            className={`idcard-canvas-stage ${physicalStageStyle ? 'idcard-canvas-stage--physical' : ''}`}
            style={{
              backgroundImage: templateImage ? `url(${templateImage})` : undefined,
              ...physicalStageStyle,
            }}
            onClick={(e) => e.target === e.currentTarget && setSelectedId(null)}
          >
          {elements.map((el) => {
            if (el.type === 'photo') {
              return (
                <div
                  key={el.id}
                  className={`idcard-canvas-el idcard-canvas-photo ${selectedId === el.id ? 'selected' : ''}`}
                  style={{
                    left: `${el.x}%`,
                    top: `${el.y}%`,
                    width: `${el.width}%`,
                    height: `${el.height}%`,
                  }}
                  onPointerDown={(e) => handlePointerDown(e, el.id, false)}
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="" />
                  ) : (
                    <div className="idcard-canvas-photo-placeholder">Photo</div>
                  )}
                  {selectedId === el.id && (
                    <div
                      className="idcard-canvas-resize-handle"
                      onPointerDown={(e) => handlePointerDown(e, el.id, true)}
                    />
                  )}
                </div>
              );
            }
            const boundVal = el.dataField ? getFieldValue(el.dataField) : '';
            const textToShow = boundVal || el.content || '';
            const wrapMultiline = el.dataField === 'address';
            return (
              <div
                key={el.id}
                className={`idcard-canvas-el idcard-canvas-text ${selectedId === el.id ? 'selected' : ''}${wrapMultiline ? ' idcard-canvas-text--wrap' : ''}`}
                style={{
                  left: `${el.x}%`,
                  top: `${el.y}%`,
                  fontSize: `${el.fontSize || 12}px`,
                  fontWeight: el.fontWeight || '400',
                  ...(el.color ? { color: el.color } : {}),
                }}
                onPointerDown={(e) => handlePointerDown(e, el.id, false)}
              >
                {textToShow || <span className="placeholder">{el.label || el.dataField || el.id}</span>}
              </div>
            );
          })}
          </div>
        </div>

        <div className="idcard-canvas-sidebar card">
          {schoolId && schoolPutPayload && dimensionFormOpen && (
            <div className="idcard-canvas-dimension-panel">
              <label className="input-label idcard-canvas-dimension-heading">Dimension (optional)</label>
              <div className="idcard-canvas-dimension-row">
                <div>
                  <span className="text-muted idcard-canvas-dimension-field-label">Height</span>
                  <input
                    type="text"
                    className="input-field idcard-canvas-dimension-input"
                    value={dimHeightDraft}
                    onChange={(e) => setDimHeightDraft(e.target.value)}
                    inputMode="decimal"
                    aria-label="Card height"
                  />
                </div>
                <div>
                  <span className="text-muted idcard-canvas-dimension-field-label">Width</span>
                  <input
                    type="text"
                    className="input-field idcard-canvas-dimension-input"
                    value={dimWidthDraft}
                    onChange={(e) => setDimWidthDraft(e.target.value)}
                    inputMode="decimal"
                    aria-label="Card width"
                  />
                </div>
                <div>
                  <span className="text-muted idcard-canvas-dimension-field-label">Unit</span>
                  <select
                    className="input-field idcard-canvas-dimension-unit"
                    value={dimUnitDraft}
                    onChange={(e) => setDimUnitDraft(e.target.value)}
                    aria-label="Dimension unit"
                  >
                    <option value="mm">mm</option>
                    <option value="cm">cm</option>
                    <option value="in">in</option>
                    <option value="px">px</option>
                    <option value="pt">pt</option>
                  </select>
                </div>
              </div>
              {dimensionError ? (
                <p className="idcard-canvas-dimension-error" role="alert">
                  {dimensionError}
                </p>
              ) : null}
              <div className="idcard-canvas-dimension-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={dimensionSaving}
                  onClick={handleDimensionUpdate}
                >
                  {dimensionSaving ? 'Saving…' : 'Update dimensions'}
                </button>
              </div>
              <p className="text-muted idcard-canvas-dimension-hint">
                Card preview size updates after a successful save. This updates the school on the server.
              </p>
            </div>
          )}

        <h3 style={{ marginBottom: 12 }}>Edit selected</h3>
          {selectedId && selectedEl && (
            <>
              {selectedEl.type === 'text' ? (
                <div>
                  <div style={{ marginTop: 8 }}>
                    <label className="input-label">Font size</label>
                    <input
                      type="range"
                      min="8"
                      max="24"
                      value={selectedEl.fontSize || 12}
                      onChange={(e) =>
                        setElements((prev) =>
                          prev.map((x) =>
                            x.id === selectedEl.id ? { ...x, fontSize: Number(e.target.value) } : x
                          )
                        )
                      }
                    />
                    <span style={{ marginLeft: 8, fontSize: '0.9rem' }}>{selectedEl.fontSize || 12}px</span>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <span className="input-label">Text color</span>
                    <div className="idcard-canvas-color-row">
                      <label className="idcard-canvas-color-picker-hit" title="Open color picker — click to choose">
                        <input
                          type="color"
                          className="idcard-canvas-color-input"
                          aria-label="Open color picker"
                          value={toHexColorForInput(selectedEl.color)}
                          onInput={(e) => setSelectedTextColor(e.target.value)}
                          onChange={(e) => setSelectedTextColor(e.target.value)}
                        />
                        <span className="idcard-canvas-color-picker-hint">Color picker</span>
                      </label>
                      <input
                        type="text"
                        className="input-field idcard-canvas-color-hex"
                        aria-label="Hex color (#rrggbb)"
                        placeholder="Default"
                        maxLength={7}
                        value={colorHexDraft}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setColorHexDraft(raw);
                          const t = raw.trim();
                          if (!t) return;
                          const h = t.startsWith('#') ? t : `#${t}`;
                          if (/^#[0-9A-Fa-f]{6}$/i.test(h)) {
                            setSelectedTextColor(h.toLowerCase());
                          }
                        }}
                        onBlur={() => {
                          const t = colorHexDraft.trim();
                          if (!t) {
                            setElements((prev) =>
                              prev.map((x) => {
                                if (x.id !== selectedEl.id) return x;
                                const next = { ...x };
                                delete next.color;
                                return next;
                              })
                            );
                            setColorHexDraft('');
                            return;
                          }
                          const h = t.startsWith('#') ? t : `#${t}`;
                          if (/^#[0-9A-Fa-f]{6}$/i.test(h)) {
                            const hex = h.toLowerCase();
                            setSelectedTextColor(hex);
                            setColorHexDraft(hex);
                          } else {
                            setColorHexDraft(
                              selectedEl.color ? toHexColorForInput(selectedEl.color) : ''
                            );
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          setElements((prev) =>
                            prev.map((x) => {
                              if (x.id !== selectedEl.id) return x;
                              const next = { ...x };
                              delete next.color;
                              return next;
                            })
                          )
                        }
                      >
                        Default
                      </button>
                    </div>
                    <div className="idcard-canvas-color-swatches" role="group" aria-label="Preset colors">
                      {TEXT_COLOR_PRESETS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          className="idcard-canvas-color-swatch"
                          title={p.label}
                          aria-label={p.label}
                          style={{ backgroundColor: p.value }}
                          onClick={() => setSelectedTextColor(p.value)}
                        />
                      ))}
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label className="input-label">Bind to student field</label>
                    <select
                      className="input-field"
                      value={selectedEl.dataField || ''}
                      onChange={(e) => updateElementDataField(selectedEl.id, e.target.value)}
                    >
                      <option value="">Static text</option>
                      {FIELD_DEFS.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </select>
                    {selectedEl.dataField ? (
                      <p className="text-muted" style={{ marginTop: 8, marginBottom: 0 }}>
                        Showing: <strong>{getFieldValue(selectedEl.dataField) || '—'}</strong>
                      </p>
                    ) : (
                      <div style={{ marginTop: 10 }}>
                        <label className="input-label">Text</label>
                        <input
                          type="text"
                          className="input-field"
                          value={selectedEl.content || ''}
                          onChange={(e) => updateElementContent(selectedEl.id, e.target.value)}
                          placeholder="Enter text"
                        />
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {/* <button type="button" className="btn btn-secondary btn-sm" onClick={deleteSelected}>
                      Remove element
                    </button> */}
                  </div>
                </div>
              ) : (
                <p className="text-muted">Photo selected. Drag on canvas to move; drag corner to resize.</p>
              )}
            </>
          )}
          {!selectedId && (
            <p className="text-muted">Click any element on the card to select and edit here.</p>
          )}
          <h3 style={{ marginBottom: 12 }}>Template fields</h3>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addAllFields}>
                Add all student fields
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedId(null)}>
                Deselect
              </button>
            </div>
            <p className="text-muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Select which student details should appear on the template. Uncheck to remove before uploading.
            </p>
          </div>

          <div style={{ marginBottom: 18 }}>
            {FIELD_DEFS.map((f) => {
              const checked = elementHasField(f.key)
                || (f.key === 'name' && elements.some((e) => e.id === 'name'))
                || (f.key === 'studentId' && elements.some((e) => e.id === 'studentId'))
                || (f.key === 'className' && elements.some((e) => e.id === 'class'))
                || (f.key === 'schoolName' && elements.some((e) => e.id === 'school'));
              const val = getFieldValue(f.key);
              return (
                <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (next) addFieldElement(f.key);
                      else removeFieldElement(f.key);
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '0.95rem' }}>{f.label}</strong>
                    <span className="text-muted" style={{ display: 'block', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {val ? val : '—'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

       
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_ELEMENTS };
