import React, { useState, useRef, useEffect } from 'react';
import { createSchool, bulkUploadStudentsXls } from '../api/dashboard';

const MM_PER_UNIT = {
  mm: 1,
  cm: 10,
  inch: 25.4,
  px: 0.264583,
};

function convertDimensionValue(value, fromUnit, toUnit) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const numeric = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(numeric)) return value;

  const fromFactor = MM_PER_UNIT[fromUnit] || 1;
  const toFactor = MM_PER_UNIT[toUnit] || 1;
  const valueInMm = numeric * fromFactor;
  const converted = valueInMm / toFactor;
  // Keep UI value stable on round-trips (mm -> inch -> mm etc.)
  if (toUnit === 'mm') {
    const roundedMm = Math.round(converted);
    if (Math.abs(converted - roundedMm) < 0.02) {
      return String(roundedMm);
    }
  }
  return String(Number(converted.toFixed(3)));
}

export default function CreateSchoolForm({ onSuccess, onCancel, onExcelSuccess, onExcelUploadDone, rightOfExcel, showCancel = true, labelAsProject = false, externalExcelFile = null, projectFolderField = null }) {
  const nameLabel = labelAsProject ? 'Project Name' : 'School Name';
  const btnLabel = labelAsProject ? 'Create Project' : 'Create School';
  const desc = labelAsProject
    ? 'Enter project details and upload an Excel (XLS/XLSX) file with student data. Project will be created first, then student data will be uploaded.'
    : 'Enter school details and upload an Excel (XLS/XLSX) file with student data. School will be created first, then student data will be uploaded.';
  const nameRequiredMsg = labelAsProject ? 'Project name is required.' : 'School name is required.';
  const creatingMsg = labelAsProject ? 'Creating project…' : 'Creating school…';
  const [schoolName, setSchoolName] = useState('');
  const [address, setAddress] = useState('');
  const [dimensionHeight, setDimensionHeight] = useState('56');
  const [dimensionWidth, setDimensionWidth] = useState('88');
  const [dimensionUnit, setDimensionUnit] = useState('mm');
  const [allowedMobilesStr, setAllowedMobilesStr] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [xlsFile, setXlsFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState('');
  const [excelUploadPercent, setExcelUploadPercent] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const xlsInputRef = useRef(null);
  const projectNameInputRef = useRef(null);

  useEffect(() => {
    if (!labelAsProject) return undefined;

    const ensureInputReady = () => {
      const input = projectNameInputRef.current;
      if (!input) return;
      input.disabled = false;
      input.readOnly = false;
    };

    const focusInput = () => {
      ensureInputReady();
      const input = projectNameInputRef.current;
      if (!input) return;
      input.focus();
    };

    const rafId = requestAnimationFrame(() => {
      focusInput();
    });
    const timer = window.setTimeout(() => {
      focusInput();
    }, 120);
    window.addEventListener('focus', focusInput);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
      window.removeEventListener('focus', focusInput);
    };
  }, [labelAsProject]);

  const allowedMobiles = allowedMobilesStr
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const handleDimensionUnitChange = (nextUnit) => {
    if (nextUnit === dimensionUnit) return;
    setDimensionHeight((prev) => convertDimensionValue(prev, dimensionUnit, nextUnit));
    setDimensionWidth((prev) => convertDimensionValue(prev, dimensionUnit, nextUnit));
    setDimensionUnit(nextUnit);
  };

  const handleSwapDimensions = () => {
    const h = dimensionHeight;
    const w = dimensionWidth;
    setDimensionHeight(w);
    setDimensionWidth(h);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const name = schoolName.trim();
    if (!name) {
      setError(nameRequiredMsg);
      return;
    }
    const excelToUse = externalExcelFile || xlsFile;
    if (!excelToUse) {
      setError(labelAsProject ? 'Please select a project folder that contains an Excel file.' : 'Please select an Excel (XLS/XLSX) file with student data.');
      return;
    }
    setSubmitting(true);
    setExcelUploadPercent(null);
    try {
      setStep('school');
      const res = await createSchool({
        schoolName: name,
        address: address.trim(),
        dimensionHeight: dimensionHeight.trim() || undefined,
        dimensionWidth: dimensionWidth.trim() || undefined,
        dimensionUnit: dimensionUnit,
        allowedMobiles,
        logo: logoFile || null,
      });
      const schoolId = res.schoolId;
      console.log("school responce", res);
      if (!schoolId) throw new Error('Server did not return school id.');

      setStep('upload');
      setExcelUploadPercent(0);
      const displayRef = { current: 0 };
      const targetRef = { current: 0 };
      /** False only after XHR settles (so we can creep past the 99% byte cap while the server responds). */
      const requestPendingRef = { current: true };
      const CREEP_MAX_WHILE_PENDING = 99.86;
      const CREEP_STEP = 0.032;
      let progressRafId = null;
      const stopSmoothedProgress = () => {
        if (progressRafId != null) {
          cancelAnimationFrame(progressRafId);
          progressRafId = null;
        }
      };
      const pushDisplay = (d) => {
        displayRef.current = d;
        const rounded = Math.round(d * 10) / 10;
        setExcelUploadPercent(rounded >= 100 ? 100 : rounded);
      };
      const runSmoothedProgress = () => {
        const tick = () => {
          const t = targetRef.current;
          let d = displayRef.current;
          const pending = requestPendingRef.current;

          if (d < t) {
            const gap = t - d;
            const speed = pending
              ? Math.min(2, Math.max(0.35, gap * 0.15))
              : Math.min(2.5, Math.max(0.4, gap * 0.2));
            d = Math.min(t, d + speed);
          } else if (
            pending &&
            t >= 95 &&
            d >= t - 0.02 &&
            d < CREEP_MAX_WHILE_PENDING
          ) {
            // At API cap (99) but server still processing: creep slowly until XHR completes.
            d = Math.min(CREEP_MAX_WHILE_PENDING, d + CREEP_STEP);
          }

          pushDisplay(d);
          progressRafId = requestAnimationFrame(tick);
        };
        progressRafId = requestAnimationFrame(tick);
      };
      runSmoothedProgress();

      await new Promise((resolve, reject) => {
        bulkUploadStudentsXls(schoolId, excelToUse, {
          onUploadProgress: (pct) => {
            targetRef.current = Math.max(targetRef.current, pct);
          },
        })
          .then((data) => {
            requestPendingRef.current = false;
            targetRef.current = 100;
            const waitUntilBarFull = () => {
              if (displayRef.current >= 99.98) {
                setExcelUploadPercent(100);
                stopSmoothedProgress();
                resolve(data);
              } else {
                requestAnimationFrame(waitUntilBarFull);
              }
            };
            waitUntilBarFull();
          })
          .catch((err) => {
            requestPendingRef.current = false;
            stopSmoothedProgress();
            reject(err);
          });
      });

      setExcelUploadPercent(null);
      if (onExcelUploadDone) {
        setStep('photos');
        try {
          await Promise.resolve(onExcelUploadDone(schoolId));
        } finally {
          setStep('');
        }
        onSuccess?.();
      } else if (onExcelSuccess) {
        setTimeout(() => onExcelSuccess(schoolId), 0);
      } else {
        onSuccess?.();
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setExcelUploadPercent(null);
      setSubmitting(false);
      setStep('');
    }
  };

  return (
    <>
      <p className="text-muted" style={{ marginBottom: 24 }}>
        {desc}
      </p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label className="input-label">{nameLabel} *</label>
          <input
            ref={projectNameInputRef}
            type="text"
            className="input-field"
            data-project-name-input="true"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            onFocus={(e) => {
              e.currentTarget.disabled = false;
              e.currentTarget.readOnly = false;
            }}
            placeholder={labelAsProject ? 'e.g. My Project' : 'e.g. Green Valley School'}
            autoFocus={labelAsProject}
            required
          />
        </div>
        {/* School code not collected — API assigns or omits (validation: A-Z, 0-9, -, _ only). */}
        {!labelAsProject && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label className="input-label">Address</label>
              <textarea
                className="input-field"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Sector 14, Gurgaon"
                rows={2}
              />
            </div>
          </>
        )}
        {/* Dimension (Height & Width) - shown for Create Project */}
        {labelAsProject && (
          <div className="create-form-dimension-row" style={{ marginBottom: 16 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: 8 }}>Dimension (optional)</label>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label className="text-muted" style={{ fontSize: '0.85rem', marginRight: 6 }}>Height</label>
                <input
                  type="text"
                  className="input-field"
                  value={dimensionHeight}
                  onChange={(e) => setDimensionHeight(e.target.value)}
                  placeholder="5.5"
                  style={{ width: 100 }}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSwapDimensions}
                title="Swap height and width"
                aria-label="Swap height and width"
                style={{ padding: '6px 10px', marginBottom: 2 }}
              >
                ⇄
              </button>
              <div>
                <label className="text-muted" style={{ fontSize: '0.85rem', marginRight: 6 }}>Width</label>
                <input
                  type="text"
                  className="input-field"
                  value={dimensionWidth}
                  onChange={(e) => setDimensionWidth(e.target.value)}
                  placeholder="9"
                  style={{ width: 100 }}
                />
              </div>
              <div>
                <label className="text-muted" style={{ fontSize: '0.85rem', marginRight: 6 }}>Unit</label>
                <select
                  className="input-field"
                  value={dimensionUnit}
                  onChange={(e) => handleDimensionUnitChange(e.target.value)}
                  style={{ width: 80 }}
                >
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="inch">inch</option>
                  <option value="px">px</option>
                </select>
              </div>
            </div>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label className="input-label">Allowed mobiles (optional)</label>
          <input
            type="text"
            className="input-field"
            value={allowedMobilesStr}
            onChange={(e) => setAllowedMobilesStr(e.target.value)}
            placeholder="Comma or space separated, e.g. 9876543210, 9876543211"
          />
        </div>
        {/* Logo section hidden for Create Project modal */}
        {!labelAsProject && (
          <div style={{ marginBottom: 16 }}>
            <label className="input-label">Logo (optional)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              style={{ display: 'block', marginTop: 4 }}
            />
          </div>
        )}
        <div className="create-form-excel-row" style={{ marginBottom: 16 }}>
          <div className="create-form-excel-left">
            {projectFolderField ? (
              <>
                <label className="input-label">Project folder *</label>
                <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: 8 }}>
                  Select the project folder. Put the Excel file (XLS/XLSX) and all student photos in that same folder (no separate images subfolder). Photo filenames should match Student ID / photo number (e.g. 1193.JPG, 1194.png).
                </p>
                {projectFolderField}
              </>
            ) : (
              <>
                <label className="input-label">Student data (Excel file) *</label>
                <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: 8 }}>
                  XLS/XLSX with columns: SrNo, Photo, StudentName, Gender, BirthDate, STD, Division, RegNo, BloodGroup, Address, Mobile
                </p>
                <input
                  ref={xlsInputRef}
                  type="file"
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => setXlsFile(e.target.files?.[0] || null)}
                  style={{ display: 'block', marginTop: 4 }}
                />
                {xlsFile && <p className="text-muted" style={{ marginTop: 6, fontSize: '0.9rem' }}>Selected: {xlsFile.name}</p>}
              </>
            )}
          </div>
          {rightOfExcel && !projectFolderField && <div className="create-form-excel-right">{rightOfExcel}</div>}
        </div>
        {error && <p className="text-danger" style={{ marginBottom: 16 }}>{error}</p>}
        {submitting && step === 'school' && (
          <p className="text-muted" style={{ marginBottom: 16 }}>{creatingMsg}</p>
        )}
        {submitting && step === 'upload' && excelUploadPercent !== null && (
          <div style={{ marginBottom: 16 }}>
            <p className="text-muted" style={{ marginBottom: 8 }}>
              {labelAsProject ? 'Uploading Excel file…' : 'Uploading student data (Excel)…'}{' '}
              <strong style={{ color: 'var(--text)' }}>
                {excelUploadPercent >= 100
                  ? '100'
                  : excelUploadPercent === 0
                    ? '0'
                    : excelUploadPercent.toFixed(1)}
                %
              </strong>
            </p>
            <div
              role="progressbar"
              aria-valuenow={Math.min(100, Math.round(excelUploadPercent))}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: 10,
                background: 'var(--bg-card)',
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${excelUploadPercent}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
          </div>
        )}
        {submitting && step === 'photos' && (
          <p className="text-muted" style={{ marginBottom: 16 }}>
            {labelAsProject ? 'Matching folder photos and starting background upload…' : 'Uploading photos…'}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Please wait…' : btnLabel}
          </button>
          {showCancel && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
      <style>{`
        .create-form-excel-row { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
        .create-form-excel-left { flex: 1; min-width: 200px; }
        .create-form-excel-right { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; min-height: 80px; }
      `}</style>
    </>
  );
}
