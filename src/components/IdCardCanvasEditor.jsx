import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { updatePhotographerSchool } from '../api/dashboard';
import {
  getCanvasTextEffectiveFontSizePx,
  getTextTypographyStyle,
  ID_CARD_FONT_FAMILY_OPTIONS,
  isTextElementBold,
} from '../utils/idCardTextTypography';
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

const HIDDEN_TEMPLATE_FIELD_KEYS = new Set(['uniqueCode']);

const DEFAULT_ELEMENTS = () => [
  { type: 'photo', id: 'photo', x: 8, y: 22, width: 30, height: 48 },
  { type: 'text', id: 'name', dataField: 'name', x: 45, y: 24, fontSize: 14, content: '', fontWeight: '700' },
  { type: 'text', id: 'dob', dataField: 'dateOfBirth', x: 45, y: 36, fontSize: 11, content: '' },
  { type: 'text', id: 'address', dataField: 'address', x: 45, y: 48, fontSize: 10, content: '' },
];

/**
 * Maps legacy API/default text fields (student ID, class, school) to Name + DOB + Address
 * while keeping positions so “Edit template layout” opens with the preferred trio.
 */
function mapTemplateElementsToNameDobAddress(elements) {
  if (!Array.isArray(elements)) return elements;
  const out = [];
  for (const el of elements) {
    if (el.type !== 'text') {
      out.push(el);
      continue;
    }
    const df = el.dataField;
    if (df === 'schoolName') {
      continue;
    }
    if (df === 'studentId') {
      out.push({
        ...el,
        id: el.id === 'studentId' ? 'dob' : el.id,
        dataField: 'dateOfBirth',
        label: 'DOB',
      });
      continue;
    }
    if (df === 'className') {
      out.push({
        ...el,
        id: el.id === 'class' ? 'address' : el.id,
        dataField: 'address',
        label: 'Address',
        fontSize:
          el.fontSize != null ? Math.min(Number(el.fontSize), 11) : 10,
      });
      continue;
    }
    out.push(el);
  }
  return out;
}

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

function humanizeFieldLabel(key) {
  const s = String(key ?? '').trim();
  if (!s) return '';
  return s
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
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

/** Editor-only display scale; saved element x/y/width/height remain % of the real card size */
const EDITOR_PREVIEW_ZOOM = 1.9;

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

/** Nominal height % for bounds only. Text has no fixed box; address wraps — a large nominal h was capping y too early (e.g. max y 80%). */
function getTextElementNominalHeightPercentForBounds(el) {
  if (el.type !== 'text') return 8;
  if (typeof el.height === 'number' && el.height > 0) return el.height;
  return 8;
}

function getElementBoxPercentForAlign(el) {
  if (el.type === 'photo') {
    return {
      w: typeof el.width === 'number' ? el.width : 30,
      h: typeof el.height === 'number' ? el.height : 48,
    };
  }
  return {
    w: typeof el.width === 'number' && el.width > 0 ? el.width : 42,
    h: getTextElementNominalHeightPercentForBounds(el),
  };
}

/** Width % used for bounds (drag) — must match box width on template. */
function getElementWidthPercentForBounds(el) {
  if (el.type === 'photo') return typeof el.width === 'number' ? el.width : 30;
  if (el.type === 'text') {
    return typeof el.width === 'number' && el.width > 0 ? el.width : 42;
  }
  return 30;
}

function getTextBoxWidthPercentForRender(el) {
  if (el.type !== 'text') return 42;
  return typeof el.width === 'number' && el.width > 0 ? el.width : 42;
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
  /** Called ~300ms after element positions/size/fonts change (e.g. persist draft layout) */
  onElementsChange,
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
  const [photoUrl, setPhotoUrl] = useState(studentImage);
  const [colorHexDraft, setColorHexDraft] = useState('');
  const [alignMenuOpen, setAlignMenuOpen] = useState(false);
  const alignMenuRef = useRef(null);
  // Disabled currently: “Align on card” UI.
  const SHOW_ALIGN_ON_CARD = false;
  const didInitAddAllRef = useRef(false);
  const [dimensionLocal, setDimensionLocal] = useState(null);
  const [dimensionFormOpen, setDimensionFormOpen] = useState(false);
  const [dimHeightDraft, setDimHeightDraft] = useState('56');
  const [dimWidthDraft, setDimWidthDraft] = useState('88');
  const [dimUnitDraft, setDimUnitDraft] = useState('mm');
  const [dimensionSaving, setDimensionSaving] = useState(false);
  const [dimensionError, setDimensionError] = useState('');
  const [editorZoomPadBottom, setEditorZoomPadBottom] = useState(0);

  const onElementsChangeRef = useRef(onElementsChange);
  onElementsChangeRef.current = onElementsChange;

  useEffect(() => {
    if (!onElementsChangeRef.current) return;
    const t = setTimeout(() => onElementsChangeRef.current(elements), 300);
    return () => clearTimeout(t);
  }, [elements]);

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
    const src = initialData || {};
    let rawVal = src[key];
    if (
      rawVal == null &&
      src.extraFields &&
      typeof src.extraFields === 'object' &&
      Object.prototype.hasOwnProperty.call(src.extraFields, key)
    ) {
      rawVal = src.extraFields[key];
    }
    const raw = normalizeValue(rawVal);
    if (key === 'dateOfBirth') return formatDateDMY(raw);
    return raw;
  }, [initialData]);

  const extraFieldDefs = useMemo(() => {
    const extra = initialData?.extraFields;
    if (!extra || typeof extra !== 'object') return [];
    const baseKeys = new Set(FIELD_DEFS.map((d) => d.key));
    return Object.keys(extra)
      .filter((k) => !baseKeys.has(k))
      .map((k) => ({ key: k, label: String(k) }));
  }, [initialData]);

  const otherFieldDefs = useMemo(() => {
    const src = initialData || {};
    const baseKeys = new Set(FIELD_DEFS.map((d) => d.key));
    const exclude = new Set([
      'extraFields',
      '_id',
      '__v',
      'id',
      'template',
      'photoUrl',
      'dimension',
      'dimensionUnit',
      'schoolId',
      'classId',
      'createdAt',
      'updatedAt',
    ]);
    const out = [];
    for (const [k, v] of Object.entries(src)) {
      if (exclude.has(k) || baseKeys.has(k)) continue;
      if (HIDDEN_TEMPLATE_FIELD_KEYS.has(k)) continue;
      if (v == null) continue;
      if (v instanceof Date) {
        out.push({ key: k, label: humanizeFieldLabel(k) || k });
        continue;
      }
      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean') {
        out.push({ key: k, label: humanizeFieldLabel(k) || k });
      }
    }
    return out;
  }, [initialData]);

  const allFieldDefs = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const def of [...FIELD_DEFS, ...otherFieldDefs, ...extraFieldDefs]) {
      if (!def?.key || seen.has(def.key)) continue;
      seen.add(def.key);
      merged.push(def);
    }
    return merged;
  }, [extraFieldDefs, otherFieldDefs]);

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
    allFieldDefs.forEach((f) => {
      if (HIDDEN_TEMPLATE_FIELD_KEYS.has(f.key)) return;
      const val = String(getFieldValue(f.key) || '').trim();
      if (val) addFieldElement(f.key);
    });
  }, [addFieldElement, allFieldDefs, getFieldValue]);

  // Auto-add other fields with data when there is no initial layout; skip ID/class/school so defaults stay Name + DOB + Address.
  useEffect(() => {
    if (didInitAddAllRef.current) return;
    if (initialElements) return; // do not override a provided template layout
    didInitAddAllRef.current = true;
    const skipKeys = new Set(['studentId', 'className', 'schoolName']);
    FIELD_DEFS.forEach((f) => {
      if (skipKeys.has(f.key)) return;
      const val = getFieldValue(f.key);
      if (val) addFieldElement(f.key);
    });
  }, [addFieldElement, getFieldValue, initialElements]);

  const getCanvasRect = useCallback(() => canvasRef.current?.getBoundingClientRect() || null);

  /* Reserve space below scaled stage so layout is not clipped; drag math uses getBoundingClientRect (includes scale) */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const updatePad = () => {
      const h = el.offsetHeight;
      if (!h) return;
      setEditorZoomPadBottom(Math.ceil((EDITOR_PREVIEW_ZOOM - 1) * h));
    };
    updatePad();
    const ro = new ResizeObserver(updatePad);
    ro.observe(el);
    return () => ro.disconnect();
  }, [effectiveDimension?.width, effectiveDimension?.height, effectiveDimensionUnit, templateImage]);

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
          prev.map((el) => {
            if (el.id !== resizeState.id) return el;
            const maxW = Math.max(15, 100 - el.x);
            const maxH = Math.max(20, 100 - el.y);
            return {
              ...el,
              width: Math.max(15, Math.min(maxW, resizeState.startWidth + dx)),
              height: Math.max(20, Math.min(maxH, resizeState.startHeight + dy)),
            };
          })
        );
      } else if (dragState) {
        const dx = pxToPercent(e.clientX - dragState.startX, true);
        const dy = pxToPercent(e.clientY - dragState.startY, false);
        setElements((prev) =>
          prev.map((el) => {
            if (el.id !== dragState.id) return el;
            const wPct = getElementWidthPercentForBounds(el);
            const hPct =
              el.type === 'photo'
                ? typeof el.height === 'number'
                  ? el.height
                  : 48
                : getTextElementNominalHeightPercentForBounds(el);
            return {
              ...el,
              x: Math.max(0, Math.min(100 - wPct, dragState.startElX + dx)),
              y: Math.max(0, Math.min(100 - hPct, dragState.startElY + dy)),
            };
          })
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

  const selectedEl = elements.find((e) => e.id === selectedId);
  const isPhoto = selectedEl?.type === 'photo';
  const selectedTextBold = selectedEl?.type === 'text' ? isTextElementBold(selectedEl) : false;
  const physicalStageStyle = getPhysicalStageSizeStyle(effectiveDimension, effectiveDimensionUnit);

  const bindFieldDefs = useMemo(() => {
    const withValue = allFieldDefs.filter((f) => {
      if (HIDDEN_TEMPLATE_FIELD_KEYS.has(f.key)) return false;
      return String(getFieldValue(f.key) || '').trim() !== '';
    });
    const selectedKey = selectedEl?.type === 'text' ? selectedEl.dataField : '';
    if (selectedKey && !withValue.some((f) => f.key === selectedKey)) {
      withValue.push({ key: selectedKey, label: selectedKey });
    }
    return withValue;
  }, [allFieldDefs, getFieldValue, selectedEl?.dataField, selectedEl?.type]);

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

  const swapDimensionDrafts = useCallback(() => {
    const nextH = dimWidthDraft;
    const nextW = dimHeightDraft;
    setDimHeightDraft(nextH);
    setDimWidthDraft(nextW);
  }, [dimHeightDraft, dimWidthDraft]);

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
      dateOfBirth: (getFieldValue('dateOfBirth') || (elements.find((e) => e.id === 'dob')?.content ?? '')),
      address: (getFieldValue('address') || (elements.find((e) => e.id === 'address')?.content ?? '')),
    });
  };

  return (
    <div className="idcard-canvas-editor">
      <div className="idcard-canvas-toolbar">
        <span className="idcard-canvas-hint">
          Preview zoomed for editing — positions stay relative to your card dimensions · Drag to move · Photo: corner resize or sliders · Text: box width in sidebar
        </span>
        <div className="idcard-canvas-toolbar-center">
          {selectedId && selectedEl && SHOW_ALIGN_ON_CARD && (
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
          <button type="button" className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="btn btn-primary" onClick={handleSaveClick}>{saveLabel}</button>
        </div>
      </div>

      <div className="idcard-canvas-layout">
        <div className="idcard-canvas-stage-outer">
          <div
            className="idcard-canvas-stage-zoom-wrap"
            style={{ paddingBottom: editorZoomPadBottom }}
          >
            <div
              ref={canvasRef}
              className={`idcard-canvas-stage ${physicalStageStyle ? 'idcard-canvas-stage--physical' : ''}`}
              style={{
                backgroundImage: templateImage ? `url(${templateImage})` : undefined,
                ...physicalStageStyle,
                transform: `scale(${EDITOR_PREVIEW_ZOOM})`,
                transformOrigin: 'top center',
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
            const textBoxW = getTextBoxWidthPercentForRender(el);
            const textBoxWClamped = Math.min(textBoxW, Math.max(1, 100 - el.x));
            const fontSizePx = getCanvasTextEffectiveFontSizePx(el, textBoxWClamped);
            return (
              <div
                key={el.id}
                className={`idcard-canvas-el idcard-canvas-text ${selectedId === el.id ? 'selected' : ''}${wrapMultiline ? ' idcard-canvas-text--wrap' : ''}`}
                style={{
                  left: `${el.x}%`,
                  top: `${el.y}%`,
                  width: `${textBoxWClamped}%`,
                  maxWidth: `${textBoxWClamped}%`,
                  fontSize: `${fontSizePx}px`,
                  ...getTextTypographyStyle(el),
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
        </div>

        <div className="idcard-canvas-sidebar card">
          {schoolId && schoolPutPayload && dimensionFormOpen && (
            <div className="idcard-canvas-dimension-panel">
              <label className="input-label idcard-canvas-dimension-heading">Dimension (optional)</label>
              <div className="idcard-canvas-dimension-row">
                <div className="idcard-canvas-dimension-size-row">
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
                  <button
                    type="button"
                    className="idcard-canvas-dimension-swap"
                    onClick={swapDimensionDrafts}
                    title="Swap height and width"
                    aria-label="Swap height and width"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
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
                    <label className="input-label">Text box width (% of card)</label>
                    <input
                      type="range"
                      min={8}
                      max={Math.max(8, Math.min(100, Math.floor(100 - selectedEl.x)))}
                      value={Math.min(
                        getTextBoxWidthPercentForRender(selectedEl),
                        Math.max(8, 100 - selectedEl.x)
                      )}
                      onChange={(e) => {
                        const nw = Number(e.target.value);
                        const maxW = Math.max(8, 100 - selectedEl.x);
                        const v = Math.max(8, Math.min(maxW, nw));
                        setElements((prev) =>
                          prev.map((x) => (x.id === selectedEl.id ? { ...x, width: v } : x))
                        );
                      }}
                    />
                    <span style={{ marginLeft: 8, fontSize: '0.9rem' }}>
                      {Math.round(
                        Math.min(
                          getTextBoxWidthPercentForRender(selectedEl),
                          Math.max(8, 100 - selectedEl.x)
                        )
                      )}
                      %
                    </span>
                    <p className="text-muted" style={{ margin: '6px 0 0', fontSize: '0.75rem' }}>
                      Up to {Math.max(8, Math.floor(100 - selectedEl.x))}% (template width from this position)
                    </p>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <label className="input-label">Font size</label>
                    <input
                      type="range"
                      min="4"
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
                    <label className="input-label" htmlFor="idcard-font-family-select">
                      Font family
                    </label>
                    <select
                      id="idcard-font-family-select"
                      className="input-field"
                      value={selectedEl.fontFamily ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setElements((prev) =>
                          prev.map((x) => {
                            if (x.id !== selectedEl.id || x.type !== 'text') return x;
                            if (!v) {
                              const next = { ...x };
                              delete next.fontFamily;
                              return next;
                            }
                            return { ...x, fontFamily: v };
                          })
                        );
                      }}
                    >
                      {ID_CARD_FONT_FAMILY_OPTIONS.map((opt) => (
                        <option key={opt.value === '' ? '__default' : opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <span className="input-label">Font style</span>
                    <div className="idcard-font-style-group" role="group" aria-label="Font style">
                      <button
                        type="button"
                        className={`idcard-font-style-btn${selectedTextBold ? ' idcard-font-style-btn--active' : ''}`}
                        aria-pressed={selectedTextBold}
                        title="Bold"
                        onClick={() => {
                          setElements((prev) =>
                            prev.map((x) => {
                              if (x.id !== selectedEl.id || x.type !== 'text') return x;
                              return { ...x, fontWeight: isTextElementBold(x) ? '400' : '700' };
                            })
                          );
                        }}
                      >
                        <strong>B</strong>
                      </button>
                      <button
                        type="button"
                        className={`idcard-font-style-btn${selectedEl.fontStyle === 'italic' ? ' idcard-font-style-btn--active' : ''}`}
                        aria-pressed={selectedEl.fontStyle === 'italic'}
                        title="Italic"
                        onClick={() => {
                          setElements((prev) =>
                            prev.map((x) => {
                              if (x.id !== selectedEl.id || x.type !== 'text') return x;
                              const next = x.fontStyle === 'italic' ? 'normal' : 'italic';
                              return { ...x, fontStyle: next === 'normal' ? undefined : next };
                            })
                          );
                        }}
                      >
                        <em style={{ fontStyle: 'italic' }}>I</em>
                      </button>
                      <button
                        type="button"
                        className={`idcard-font-style-btn${selectedEl.textDecoration === 'underline' ? ' idcard-font-style-btn--active' : ''}`}
                        aria-pressed={selectedEl.textDecoration === 'underline'}
                        title="Underline"
                        onClick={() => {
                          setElements((prev) =>
                            prev.map((x) => {
                              if (x.id !== selectedEl.id || x.type !== 'text') return x;
                              const u = x.textDecoration === 'underline';
                              return { ...x, textDecoration: u ? undefined : 'underline' };
                            })
                          );
                        }}
                      >
                        <span style={{ textDecoration: 'underline' }}>U</span>
                      </button>
                    </div>
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
                      {bindFieldDefs.map((f) => (
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
                <div>
                  <p className="text-muted" style={{ marginBottom: 12 }}>
                    Drag on canvas to move; drag the corner to resize. Or use the sliders (limited to template edges).
                  </p>
                  <div style={{ marginBottom: 10 }}>
                    <label className="input-label">Photo box width (% of card)</label>
                    <input
                      type="range"
                      min={15}
                      max={Math.max(15, Math.min(100, Math.floor(100 - selectedEl.x)))}
                      value={Math.min(
                        selectedEl.width ?? 30,
                        Math.max(15, 100 - selectedEl.x)
                      )}
                      onChange={(e) => {
                        const nw = Number(e.target.value);
                        const maxW = Math.max(15, 100 - selectedEl.x);
                        const v = Math.max(15, Math.min(maxW, nw));
                        setElements((prev) =>
                          prev.map((x) => (x.id === selectedEl.id ? { ...x, width: v } : x))
                        );
                      }}
                    />
                    <span style={{ marginLeft: 8, fontSize: '0.9rem' }}>
                      {Math.round(Math.min(selectedEl.width ?? 30, Math.max(15, 100 - selectedEl.x)))}%
                    </span>
                    <p className="text-muted" style={{ margin: '6px 0 0', fontSize: '0.75rem' }}>
                      Max {Math.max(15, Math.floor(100 - selectedEl.x))}% (template width from left edge)
                    </p>
                  </div>
                  <div>
                    <label className="input-label">Photo box height (% of card)</label>
                    <input
                      type="range"
                      min={20}
                      max={Math.max(20, Math.min(100, Math.floor(100 - selectedEl.y)))}
                      value={Math.min(
                        selectedEl.height ?? 48,
                        Math.max(20, 100 - selectedEl.y)
                      )}
                      onChange={(e) => {
                        const nh = Number(e.target.value);
                        const maxH = Math.max(20, 100 - selectedEl.y);
                        const v = Math.max(20, Math.min(maxH, nh));
                        setElements((prev) =>
                          prev.map((x) => (x.id === selectedEl.id ? { ...x, height: v } : x))
                        );
                      }}
                    />
                    <span style={{ marginLeft: 8, fontSize: '0.9rem' }}>
                      {Math.round(Math.min(selectedEl.height ?? 48, Math.max(20, 100 - selectedEl.y)))}%
                    </span>
                    <p className="text-muted" style={{ margin: '6px 0 0', fontSize: '0.75rem' }}>
                      Max {Math.max(20, Math.floor(100 - selectedEl.y))}% (template height from top)
                    </p>
                  </div>
                </div>
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
            {allFieldDefs.map((f) => {
              const checked = elementHasField(f.key)
                || (f.key === 'name' && elements.some((e) => e.id === 'name'))
                || (f.key === 'studentId' && elements.some((e) => e.id === 'studentId'))
                || (f.key === 'className' && elements.some((e) => e.id === 'class'))
                || (f.key === 'schoolName' && elements.some((e) => e.id === 'school'))
                || (f.key === 'dateOfBirth' && elements.some((e) => e.id === 'dob'))
                || (f.key === 'address' && elements.some((e) => e.id === 'address'));
              if (HIDDEN_TEMPLATE_FIELD_KEYS.has(f.key) && !checked) return null;
              const val = getFieldValue(f.key);
              const hasValue = String(val || '').trim() !== '';
              if (!hasValue && !checked) return null;
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
                      {val}
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

export { DEFAULT_ELEMENTS, mapTemplateElementsToNameDobAddress };
