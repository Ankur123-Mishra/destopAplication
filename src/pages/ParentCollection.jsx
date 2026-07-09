import React, { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import {
  buildParentCollectionLink,
  createCollectionLink,
  exportCollectionSubmissions,
  getAssignedSchoolsForCollection,
  getParentCollectionEnabled,
  getSchoolDetailsForCollection,
  isPublicParentOriginConfigured,
  listCollectionLinks,
  listCollectionSubmissions,
  revokeCollectionLink,
  activateCollectionLink,
  deleteCollectionLink,
} from '../api/parentCollection';
import {
  PARENT_FORM_OPTIONAL_FIELDS,
  makeInitialFieldEnabled,
} from '../data/parentCollectionFields';
import * as XLSX from 'xlsx';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  if (!text) return false;

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }

  try {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', 'true');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    const day = String(parsed.getDate()).padStart(2, "0");
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const year = String(parsed.getFullYear());
    const h = String(parsed.getHours()).padStart(2, "0");
    const m = String(parsed.getMinutes()).padStart(2, "0");
    const sec = String(parsed.getSeconds()).padStart(2, "0");
    return `${day}-${month}-${year} ${h}:${m}:${sec}`;
  } catch {
    return value;
  }
}

function formatLinkScope(link) {
  if (link?.projectName) return link.projectName;
  if (!link?.schoolId) return link?.collectionSchoolLabel ? `Standalone - ${link.collectionSchoolLabel}` : 'Standalone (parents enter class and section)';
  const school = typeof link.schoolId === 'object' ? link.schoolId : null;
  const classInfo = typeof link.classId === 'object' ? link.classId : null;
  const schoolName = school?.schoolName || 'School';
  const classLabel =
    classInfo?.className && classInfo?.section
      ? `${classInfo.className} - ${classInfo.section}`
      : 'Class not available';
  return `${schoolName} - ${classLabel}`;
}

function formatFieldsSummary(fields) {
  if (fields == null) return 'All optional (legacy)';
  if (!Array.isArray(fields) || fields.length === 0) return 'Student name only';
  return `${fields.length} dynamic field(s)`;
}

/** Title-case each word for field labels (e.g. "mother name" → "Mother Name"). Preserves leading/trailing spaces so spaces work while typing. */
function toTitleCaseLabel(str) {
  if (str == null || typeof str !== 'string') return '';
  const lead = str.match(/^\s*/)?.[0] ?? '';
  const trail = str.match(/\s*$/)?.[0] ?? '';
  const core = str.slice(lead.length, trail.length ? str.length - trail.length : undefined);
  const trimmedCore = core.trim();
  if (!trimmedCore) return lead + trail;
  const titled = trimmedCore
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return lead + titled + trail;
}

export default function ParentCollection() {
  const [loading, setLoading] = useState(true);
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [collectionSchoolLabel, setCollectionSchoolLabel] = useState('');
  const [projectName, setProjectName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('180');
  const [lastCreatedLink, setLastCreatedLink] = useState('');
  const [lastCreatedTemplateInfo, setLastCreatedTemplateInfo] = useState(null);
  const [creating, setCreating] = useState(false);
  const [revokingToken, setRevokingToken] = useState('');
  const [togglingToken, setTogglingToken] = useState('');
  const [deletingToken, setDeletingToken] = useState('');
  const [exporting, setExporting] = useState(false);
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [exportingSchool, setExportingSchool] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const [activeFields, setActiveFields] = useState(
    PARENT_FORM_OPTIONAL_FIELDS.map(f => ({
      key: f.key,
      label: f.label,
      isRequired: false,
      fieldType: f.key === 'dob' ? 'date' : (['mobile', 'photoNo', 'admissionNo', 'rollNo'].includes(f.key) ? 'number' : 'text'),
      enabled: false
    }))
  );

  const addCustomField = () => {
    const newField = {
      key: `custom_${Date.now()}`,
      label: "New Field",
      isRequired: false,
      fieldType: "text",
      enabled: true,
      isCustom: true
    };
    // Add custom fields to the beginning of the list for better visibility
    setActiveFields([newField, ...activeFields]);

    // Smooth scroll to config section
    setTimeout(() => {
      const configSection = document.querySelector('.active-config-section');
      if (configSection) {
        configSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  };

  const toggleField = (key) => {
    setActiveFields(prev => prev.map(f => f.key === key ? { ...f, enabled: !f.enabled } : f));
  };

  const updateField = (key, updates) => {
    setActiveFields(prev => prev.map(f => f.key === key ? { ...f, ...updates } : f));
  };

  const removeField = (key) => {
    setActiveFields(prev => prev.filter(f => f.key !== key));
  };

  const publicOriginConfigured = isPublicParentOriginConfigured();



  const groupedSubmissions = useMemo(() => {
    return submissions.reduce((acc, curr) => {
      const schoolName = curr.schoolName || curr.collectionSchoolLabel || 'Unknown School';
      if (!acc[schoolName]) acc[schoolName] = [];
      acc[schoolName].push(curr);
      return acc;
    }, {});
  }, [submissions]);

  const standaloneReady = Boolean(projectName.trim());

  const formDisabled = !standaloneReady;

  const showAdminNotice = () => {
    setConfirmDialog({
      title: 'Action Not Allowed',
      message: 'Please contact admin to allow this button.',
      hideCancel: true,
      confirmLabel: 'OK',
      onConfirm: () => { },
    });
  };

  async function loadLinks() {
    setLinksLoading(true);
    try {
      const data = await listCollectionLinks();
      setLinks(data?.links || []);
    } finally {
      setLinksLoading(false);
    }
  }

  async function loadSubmissions() {
    setSubmissionsLoading(true);
    try {
      const data = await listCollectionSubmissions();
      setSubmissions(data?.submissions || []);
    } finally {
      setSubmissionsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const enabledRes = await getParentCollectionEnabled();
        if (cancelled) return;

        const enabled = Boolean(enabledRes?.enabled);
        setFeatureEnabled(enabled);

        const [linksRes, submissionsRes] = await Promise.all([
          listCollectionLinks(),
          listCollectionSubmissions(),
        ]);

        if (cancelled) return;
        setLinks(linksRes?.links || []);
        setSubmissions(submissionsRes?.submissions || []);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load parent-form setup');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);



  async function handleCreateLink() {
    setFeedback(null);
    setCreating(true);
    try {
      const fields = activeFields
        .filter((f) => f.enabled)
        .map(({ key, label, isRequired, fieldType }) => ({
          key,
          label: toTitleCaseLabel(label).trim(),
          isRequired,
          fieldType
        }));
      const payload = {
        projectName: toTitleCaseLabel(projectName).trim(),
        fields,
        expiresInDays: Number.parseInt(expiresInDays, 10) || 180,
        collectionSchoolLabel: toTitleCaseLabel(collectionSchoolLabel).trim() || undefined,
      };

      const result = await createCollectionLink(payload);
      const publicLink = buildParentCollectionLink(result?.token);
      console.log('publicLink', publicLink);
      setLastCreatedLink(publicLink);
      setLastCreatedTemplateInfo({
        fields,
        projectName: payload.projectName || payload.collectionSchoolLabel || 'Project'
      });
      setFeedback({
        type: 'success',
        message:
          'Private link created. Send it to parents or teachers, then export the submitted data later.',
      });
      await loadLinks();
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to create link' });
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyLink(link) {
    const ok = await copyText(link);
    setFeedback({
      type: ok ? 'success' : 'error',
      message: ok ? 'Link copied. You can paste it into WhatsApp or SMS.' : 'Could not copy the link.',
    });
  }

  function handleRevokeLink(token) {
    setConfirmDialog({
      title: 'Deactivate Link',
      message: 'Deactivate this parent form link? Parents will no longer be able to submit.',
      onConfirm: async () => {
        setFeedback(null);
        setRevokingToken(token);
        try {
          await revokeCollectionLink(token);
          setFeedback({ type: 'success', message: 'Link deactivated successfully.' });
          await loadLinks();
        } catch (err) {
          setFeedback({ type: 'error', message: err?.message || 'Failed to deactivate link' });
        } finally {
          setRevokingToken('');
        }
      }
    });
  }

  function handleToggleLinkStatus(link) {
    if (!link?.token) return;
    const willActivate = !link.isActive;

    const proceed = async () => {
      setFeedback(null);
      setTogglingToken(link.token);

      setLinks((prev) =>
        prev.map((l) => (l.token === link.token ? { ...l, isActive: willActivate } : l))
      );

      try {
        if (willActivate) {
          await activateCollectionLink(link.token);
          setFeedback({ type: 'success', message: 'Link activated. Parents can submit again.' });
        } else {
          await revokeCollectionLink(link.token);
          setFeedback({ type: 'success', message: 'Link deactivated successfully.' });
        }
        await loadLinks();
      } catch (err) {
        setLinks((prev) =>
          prev.map((l) => (l.token === link.token ? { ...l, isActive: !willActivate } : l))
        );
        setFeedback({
          type: 'error',
          message: err?.message || (willActivate ? 'Failed to activate link' : 'Failed to deactivate link'),
        });
      } finally {
        setTogglingToken('');
      }
    };

    if (!willActivate) {
      setConfirmDialog({
        title: 'Deactivate Link',
        message: 'Deactivate this parent form link? Parents will no longer be able to submit.',
        onConfirm: proceed
      });
      return;
    }

    proceed();
  }

  function handleDeleteLink(token) {
    setConfirmDialog({
      title: 'Delete Project',
      message: 'PERMANENTLY DELETE this school and all its submitted data? This cannot be undone.',
      onConfirm: async () => {
        setFeedback(null);
        setDeletingToken(token);
        try {
          await deleteCollectionLink(token);
          setFeedback({ type: 'success', message: 'School and submissions deleted successfully.' });
          await loadLinks();
          // Also refresh submissions if any were deleted
          await loadSubmissions();
        } catch (err) {
          setFeedback({ type: 'error', message: err?.message || 'Failed to delete school' });
        } finally {
          setDeletingToken('');
        }
      }
    });
  }

  async function handleRefreshSubmissions() {
    setFeedback(null);
    try {
      await loadSubmissions();
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to refresh submissions' });
    }
  }

  function handleDownloadTemplate(fields, projectName) {
    const headers = ['Student Name'];
    if (Array.isArray(fields)) {
      fields.forEach(f => headers.push(f.label));
    }
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const safeName = (projectName || 'school').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadBlob(blob, `template_${safeName}.xlsx`);
  }

  async function handleExport() {
    setFeedback(null);
    setExporting(true);
    try {
      const blob = await exportCollectionSubmissions();
      const filename = `parent_form_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      downloadBlob(blob, filename);
      setFeedback({
        type: 'success',
        message:
          'Excel export downloaded. Only the selected form fields are included.',
      });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to export submissions' });
    } finally {
      setExporting(false);
    }
  }

  async function handleExportSchool(schoolName, items) {
    setFeedback(null);
    setExportingSchool(schoolName);
    try {
      const sample = items[0];
      const filters = {};
      if (sample.schoolId) {
        filters.schoolId = typeof sample.schoolId === 'object' ? sample.schoolId._id : sample.schoolId;
      } else {
        filters.collectionSchoolLabel = schoolName;
      }
      const blob = await exportCollectionSubmissions(filters);
      const safeName = schoolName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filename = `parent_form_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      downloadBlob(blob, filename);
      setFeedback({
        type: 'success',
        message: `Excel export downloaded for ${schoolName}.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to export submissions' });
    } finally {
      setExportingSchool(null);
    }
  }

  if (loading) {
    return (
      <>
        <Header title="Parent Forms" />
        <div className="card">
          <p className="text-muted">Loading parent-form settings...</p>
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <Header title="Parent Forms" />
        <div className="card">
          <p style={{ color: '#f87171', marginBottom: 12 }}>{loadError}</p>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </>
    );
  }


  return (
    <>
      <Header title="Parent Forms" />

      <div className="parent-collection-page">
        <div className="card parent-collection-intro">
          <h2>Collect student data from parents</h2>
          <p className="text-muted">
            Create a private form link, share it with parents, and export the collected data as Excel.
          </p>

          <div className="how-it-works">
            <div className="step">
              <div className="step-number">1</div>
              <div className="step-content">
                <strong>Setup Form</strong>
                <span>Enter school details and select fields you want to collect.</span>
              </div>
            </div>
            <div className="step">
              <div className="step-number">2</div>
              <div className="step-content">
                <strong>Share Link</strong>
                <span>Generate a link and send it via WhatsApp/SMS to parents.</span>
              </div>
            </div>
            <div className="step">
              <div className="step-number">3</div>
              <div className="step-content">
                <strong>Download Data</strong>
                <span>Once parents submit, export the data to Excel for bulk upload.</span>
              </div>
            </div>
          </div>

          {/* {!publicOriginConfigured && (
            <div className="parent-collection-warning">
              Set <code>VITE_PUBLIC_PARENT_ORIGIN</code> to your deployed web app URL so copied links open the correct
              parent form on phones.
            </div>
          )} */}
          {feedback && (
            <div className={`parent-collection-feedback ${feedback.type === 'error' ? 'error' : 'success'}`}>
              {feedback.message}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>1. School Details</h3>
          <div className="parent-collection-grid two">
            <label className="parent-collection-field">
              <span className="input-label">School Name (for your reference)</span>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Delhi Public School"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={() => setProjectName(toTitleCaseLabel(projectName))}
                style={{ textTransform: 'capitalize' }}
                autoComplete="off"
              />
            </label>
            <label className="parent-collection-field">
              <span className="input-label">School Name (shown to parents)</span>
              <input
                type="text"
                className="input-field"
                placeholder="Enter School Name"
                value={collectionSchoolLabel}
                onChange={(e) => setCollectionSchoolLabel(e.target.value)}
                onBlur={() => setCollectionSchoolLabel(toTitleCaseLabel(collectionSchoolLabel))}
                style={{ textTransform: 'capitalize' }}
                autoComplete="off"
              />
            </label>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 8 }}>2. Select fields</h3>
          <p className="text-muted" style={{ marginBottom: 16 }}>
            Student name is always required. These are the optional fields parents will fill in the public form.
          </p>



          <div className="field-builder-v2">
            <div className="field-repository-section">
              <span className="section-subtitle">Available Fields (Click to enable)</span>
              <div className="repository-grid">
                <div className="repository-item mandatory">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  <span>Student Name</span>
                </div>
                {activeFields.map((field) => (
                  <div
                    key={field.key}
                    className={`repository-item ${field.enabled ? 'is-enabled' : ''}`}
                    onClick={() => toggleField(field.key)}
                  >
                    <div className="repo-checkbox">
                      {field.enabled && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                    </div>
                    <span>{field.label}</span>
                    {field.isCustom && (
                      <div className="repo-remove" onClick={(e) => { e.stopPropagation(); removeField(field.key); }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </div>
                    )}
                  </div>
                ))}
                <button type="button" className="add-custom-pill" onClick={addCustomField}>
                  + Add Custom
                </button>
              </div>
            </div>

            <div className="active-config-section" id="active-config-section">
              <span className="section-subtitle">Field Configuration ({activeFields.filter(f => f.enabled).length} active)</span>
              {activeFields.filter(f => f.enabled).length === 0 ? (
                <div className="no-active-fields">
                  Only Student Name will be collected. Select fields above or add custom ones to customize the form.
                </div>
              ) : (
                <div className="config-list">
                  {activeFields.filter(f => f.enabled).map((field) => (
                    <div key={field.key} className="config-card-compact animate-in">
                      <div className="config-card-header">
                        <span className="config-card-title">{field.label}</span>
                        <div className="config-card-badges" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {field.isRequired && <span className="badge-mini req">Required</span>}
                          <span className="badge-mini type">{field.fieldType}</span>
                          <div
                            onClick={() => field.isCustom ? removeField(field.key) : toggleField(field.key)}
                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#94a3b8', padding: '2px', transition: 'color 0.2s' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                            onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
                            title="Remove field"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                          </div>
                        </div>
                      </div>
                      <div className="config-card-body">
                        <div className="config-input-group">
                          <label>Form Label</label>
                          <input
                            type="text"
                            value={field.label}
                            placeholder="Label shown to parents"
                            onChange={(e) =>
                              updateField(field.key, { label: e.target.value })
                            }
                            onBlur={() =>
                              updateField(field.key, { label: toTitleCaseLabel(field.label) })
                            }
                            className="config-input"
                            style={{ textTransform: 'capitalize' }}
                            autoComplete="off"
                          />
                        </div>
                        <div className="config-input-group">
                          <label>Type</label>
                          <select
                            value={field.fieldType}
                            onChange={(e) => updateField(field.key, { fieldType: e.target.value })}
                            className="config-select"
                          >
                            <option value="text">Text</option>
                            <option value="date">Date</option>
                            <option value="number">Number</option>
                          </select>
                        </div>
                        <div
                          className={`config-toggle-req ${field.isRequired ? 'active' : ''}`}
                          onClick={() => updateField(field.key, { isRequired: !field.isRequired })}
                        >
                          {field.isRequired ? '✓ Required' : 'Mark Required'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 8 }}>3. Generate parent form link</h3>
          <p className="text-muted" style={{ marginBottom: 16 }}>
            Parents or teachers open this link in the web app, fill the form, and the data is saved for export.
          </p>

          <div className="parent-collection-grid two">
            <label className="parent-collection-field">
              <span className="input-label">Link valid for</span>
              <select className="input-field" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)}>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">365 days</option>
              </select>
            </label>
          </div>

          <div className="parent-collection-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateLink}
              disabled={creating || formDisabled}
            >
              {creating ? 'Creating link...' : 'Generate new link'}
            </button>
            {lastCreatedLink && (
              <button type="button" className="btn btn-secondary" onClick={() => handleCopyLink(lastCreatedLink)}>
                Copy latest link
              </button>
            )}
            {lastCreatedTemplateInfo && (
              <button type="button" className="btn btn-secondary" onClick={() => {
                handleDownloadTemplate(lastCreatedTemplateInfo.fields, lastCreatedTemplateInfo.projectName);
              }}>
                Download Excel Format
              </button>
            )}
          </div>

          {lastCreatedLink ? (
            <div className="parent-collection-link-box">{lastCreatedLink}</div>
          ) : (
            <p className="text-muted" style={{ marginTop: 16 }}>
              Generate a link, then copy and send it to parents or teachers.
            </p>
          )}
        </div>

        <div className="card">
          <div className="parent-collection-card-header">
            <div>
              <h3>Active and past links</h3>
              <p className="text-muted">You can copy any link again or revoke it when collection should stop.</p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={loadLinks} disabled={linksLoading}>
              {linksLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {linksLoading ? (
            <p className="text-muted">Loading links...</p>
          ) : links.length === 0 ? (
            <p className="text-muted">No links created yet.</p>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>School Name / Scope</th>
                    <th>Details</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link._id}>
                      <td>
                        <div style={{ fontWeight: '500' }}>{link.projectName || 'Unnamed School'}</div>
                        <div className="text-muted" style={{ fontSize: '11px' }}>{formatLinkScope(link)}</div>
                      </td>
                      <td>{formatFieldsSummary(link.fields)}</td>
                      <td>
                        <div className="status-toggle-wrap">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={link.isActive ? 'true' : 'false'}
                            aria-label={link.isActive ? 'Deactivate link' : 'Activate link'}
                            title={link.isActive ? 'Click to deactivate' : 'Click to activate'}
                            className={`status-toggle ${link.isActive ? 'is-on' : 'is-off'}`}
                            onClick={() => handleToggleLinkStatus(link)}
                            disabled={togglingToken === link.token}
                          >
                            <span className="status-toggle-knob" />
                          </button>
                          <span className={`status-toggle-label ${link.isActive ? 'on' : 'off'}`}>
                            {togglingToken === link.token
                              ? 'Updating...'
                              : link.isActive
                                ? 'Active'
                                : 'Inactive'}
                          </span>
                        </div>
                      </td>
                      <td>{formatDateTime(link.createdAt)}</td>
                      <td>
                        <div className="parent-collection-table-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleCopyLink(buildParentCollectionLink(link.token))}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDownloadTemplate(link.fields, link.projectName)}
                          >
                            Download Excel Format
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteLink(link.token)}
                            disabled={deletingToken === link.token}
                          >
                            {deletingToken === link.token ? '...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="parent-collection-card-header">
            <div>
              <h3>Submissions and export</h3>
              <p className="text-muted">
                Filter by class and section if needed, then export Excel. The file includes only the fields selected on the parent form link.
              </p>
            </div>
          </div>



          {/* <div className="parent-collection-actions-row">
            <button type="button" className="btn btn-secondary" onClick={handleRefreshSubmissions} disabled={submissionsLoading}>
              {submissionsLoading ? 'Refreshing...' : 'Apply filters'}
            </button>
            <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting || !featureEnabled}>
              {exporting ? 'Exporting...' : 'Export All Excel'}
            </button>
          </div> */}

          {submissionsLoading ? (
            <p className="text-muted" style={{ marginTop: 16 }}>Loading submissions...</p>
          ) : Object.keys(groupedSubmissions).length === 0 ? (
            <p className="text-muted" style={{ marginTop: 16 }}>No submitted parent data yet.</p>
          ) : (
            <div className="school-list" style={{ marginTop: 16 }}>
              {Object.keys(groupedSubmissions).map((schoolGroup) => (
                <div key={schoolGroup} className="school-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setExpandedSchool(expandedSchool === schoolGroup ? null : schoolGroup)}
                  >
                    <div>
                      <strong>{schoolGroup}</strong>
                      <p className="text-muted" style={{ fontSize: '0.9rem', marginTop: 4 }}>
                        {groupedSubmissions[schoolGroup].length} submission(s)
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!featureEnabled) {
                            showAdminNotice();
                            return;
                          }
                          handleExportSchool(schoolGroup, groupedSubmissions[schoolGroup]);
                        }}
                        disabled={exportingSchool === schoolGroup}
                      >
                        {exportingSchool === schoolGroup ? 'Exporting...' : 'Export Excel'}
                      </button>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {expandedSchool === schoolGroup ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>
                  {expandedSchool === schoolGroup && (
                    <div className="table-container" style={{ marginTop: 16 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>School</th>
                            <th>Class</th>
                            <th>Section</th>
                            <th>Student</th>
                            <th>Roll</th>
                            <th>Admission</th>
                            <th>Mobile</th>
                            <th>Submitted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupedSubmissions[schoolGroup].map((item) => (
                            <tr key={item._id}>
                              <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{item.schoolName || '—'}</td>
                              <td><span className="table-data-cell">{item.className || '—'}</span></td>
                              <td><span className="table-data-cell">{item.section || '—'}</span></td>
                              <td style={{ fontWeight: '600', color: 'var(--accent)' }}>{item.studentName || '—'}</td>
                              <td>{item.rollNo || '—'}</td>
                              <td>{item.admissionNo || '—'}</td>
                              <td style={{ color: 'var(--uploaded)', fontSize: '0.9rem' }}>{item.mobile || '—'}</td>
                              <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formatDateTime(item.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmDialog && (
        <div className="delete-confirm-overlay" role="presentation" onClick={() => setConfirmDialog(null)}>
          <div
            className="delete-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-dialog-title" style={{ margin: 0, marginBottom: 10 }}>{confirmDialog.title}</h3>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              {confirmDialog.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              {!confirmDialog.hideCancel && (
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmDialog(null)}>
                  Cancel
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => {
                const action = confirmDialog.onConfirm;
                setConfirmDialog(null);
                if (action) action();
              }}>
                {confirmDialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .delete-confirm-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10060;
          padding: 24px;
          box-sizing: border-box;
        }
        .delete-confirm-modal {
          width: 100%;
          max-width: 420px;
          background: var(--card-bg, #1e1e2e);
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          padding: 18px;
        }
        .parent-collection-page {
          display: grid;
          gap: 20px;
        }

        .parent-collection-intro h2,
        .parent-collection-card-header h3,
        .card h3 {
          margin-bottom: 6px;
        }

        .parent-collection-grid {
          display: grid;
          gap: 16px;
        }

        .parent-collection-grid.two {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .parent-collection-field {
          display: flex;
          flex-direction: column;
        }

        .parent-collection-actions-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 12px;
          margin-top: 20px;
        }

        .parent-collection-checkbox-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .parent-collection-checkbox {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .parent-collection-checkbox input {
          width: 16px;
          height: 16px;
        }

        .parent-collection-link-box {
          margin-top: 16px;
          padding: 14px;
          background: var(--bg-primary);
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          word-break: break-all;
          font-family: Consolas, Monaco, monospace;
        }

        .parent-collection-warning,
        .parent-collection-feedback {
          margin-top: 16px;
          padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .parent-collection-warning {
          background: rgba(251, 191, 36, 0.12);
          color: #fde68a;
          border-color: rgba(251, 191, 36, 0.25);
        }

        .parent-collection-feedback.success {
          background: rgba(52, 211, 153, 0.12);
          color: #86efac;
          border-color: rgba(52, 211, 153, 0.25);
        }

        .parent-collection-feedback.error {
          background: rgba(248, 113, 113, 0.12);
          color: #fca5a5;
          border-color: rgba(248, 113, 113, 0.25);
        }

        .how-it-works {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .step {
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }

        .step-number {
          background: var(--accent);
          color: var(--bg-primary);
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          flex-shrink: 0;
          font-size: 0.9rem;
        }

        .step-content {
          display: flex;
          flex-direction: column;
        }

        .step-content strong {
          font-size: 0.95rem;
          color: var(--text);
          margin-bottom: 2px;
        }

        .step-content span {
          font-size: 0.85rem;
          color: var(--text-muted);
          line-height: 1.4;
        }

        .field-builder-v2 {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        .section-subtitle {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 12px;
        }

        .repository-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 10px;
        }

        .repository-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: var(--bg-card);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
          position: relative;
        }

        .repository-item:hover {
          border-color: rgba(255, 255, 255, 0.15);
          background: rgba(255, 255, 255, 0.02);
        }

        .repository-item.is-enabled {
          border-color: var(--accent);
          background: rgba(56, 189, 248, 0.05);
          color: var(--accent);
        }

        .repository-item.mandatory {
          border-color: rgba(56, 189, 248, 0.3);
          background: rgba(56, 189, 248, 0.1);
          color: var(--accent);
          cursor: default;
          opacity: 0.8;
        }

        .repo-checkbox {
          width: 16px;
          height: 16px;
          border: 1.5px solid rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .is-enabled .repo-checkbox {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--bg-primary);
        }

        .repo-remove {
          position: absolute;
          right: 4px;
          top: 4px;
          color: var(--correction);
          opacity: 0;
          padding: 2px;
          transition: opacity 0.2s;
        }

        .repository-item:hover .repo-remove {
          opacity: 0.6;
        }

        .repo-remove:hover {
          opacity: 1 !important;
        }

        .add-custom-pill {
          background: transparent;
          border: 1px dashed var(--accent);
          color: var(--accent);
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .add-custom-pill:hover {
          background: rgba(56, 189, 248, 0.1);
        }

        /* Config Cards */
        .config-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 16px;
        }

        .config-card-compact {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .config-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .config-card-title {
          font-weight: 600;
          color: var(--text);
          font-size: 0.95rem;
        }

        .config-card-badges {
          display: flex;
          gap: 6px;
        }

        .badge-mini {
          font-size: 0.65rem;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          font-weight: 700;
        }

        .badge-mini.req { background: rgba(248, 113, 113, 0.15); color: var(--correction); }
        .badge-mini.type { background: rgba(56, 189, 248, 0.15); color: var(--accent); }

        .config-card-body {
          display: grid;
          grid-template-columns: 1fr 80px;
          gap: 10px;
          align-items: flex-end;
        }

        .config-input-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .config-input-group label {
          font-size: 0.7rem;
          color: var(--text-muted);
        }

        .config-input-group input, .config-input-group select {
          background: var(--bg-secondary);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 6px 10px;
          color: var(--text);
          font-size: 0.85rem;
        }

        .config-toggle-req {
          grid-column: span 2;
          font-size: 0.75rem;
          padding: 6px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          text-align: center;
          cursor: pointer;
          color: var(--text-muted);
          transition: all 0.2s;
        }

        .config-toggle-req.active {
          background: rgba(248, 113, 113, 0.15);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.3);
        }

        .no-active-fields {
          padding: 32px;
          text-align: center;
          background: rgba(255, 255, 255, 0.02);
          border: 1px dashed rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          color: var(--text-muted);
          font-style: italic;
          font-size: 0.9rem;
        }

        .animate-in {
          animation: slideUp 0.3s ease-out;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .config-input:focus, .config-select:focus {
          border-color: var(--accent);
          outline: none;
          box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
        }

        .school-item {
          background: var(--bg-card);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 12px;
          transition: transform 0.2s;
        }

        .school-item:hover {
          border-color: rgba(255, 255, 255, 0.1);
        }

        .parent-collection-link-box {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid var(--accent);
          padding: 12px 16px;
          border-radius: 8px;
          font-family: monospace;
          word-break: break-all;
          color: var(--accent);
          margin-top: 16px;
        }

        .parent-collection-warning {
          background: rgba(251, 191, 36, 0.1);
          border-left: 4px solid var(--pending);
          padding: 12px 16px;
          border-radius: 4px;
          font-size: 0.9rem;
          color: var(--pending);
          margin-top: 16px;
        }

        .parent-collection-card-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: 16px;
        }

        .parent-collection-table-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .btn-warning {
          background: #f59e0b;
          color: white;
        }

        .btn-warning:hover {
          background: #d97706;
        }

        .status-toggle-wrap {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }

        .status-toggle {
          position: relative;
          width: 40px;
          height: 22px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.08);
          padding: 0;
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
          flex-shrink: 0;
        }

        .status-toggle:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .status-toggle.is-on {
          background: #16a34a;
          border-color: #15803d;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }

        .status-toggle.is-off {
          background: rgba(248, 113, 113, 0.25);
          border-color: rgba(248, 113, 113, 0.45);
        }

        .status-toggle-knob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          transition: transform 0.2s ease;
        }

        .status-toggle.is-on .status-toggle-knob {
          transform: translateX(18px);
        }

        .status-toggle-label {
          font-size: 0.8rem;
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        .status-toggle-label.on {
          color: #4ade80;
        }

        .status-toggle-label.off {
          color: #fca5a5;
        }

        @media (max-width: 900px) {
          .parent-collection-grid.two,
          .parent-collection-checkbox-grid {
            grid-template-columns: 1fr;
          }

          .parent-collection-card-header {
            flex-direction: column;
          }
        }
        .table-data-cell {
          background: rgba(255, 255, 255, 0.05);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.85rem;
        }

        /* Animations */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .parent-collection-page {
          animation: fadeIn 0.4s ease-out;
        }
      `}</style>
    </>
  );
}
