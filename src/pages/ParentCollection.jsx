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
} from '../api/parentCollection';
import {
  PARENT_FORM_OPTIONAL_FIELDS,
  makeInitialFieldEnabled,
} from '../data/parentCollectionFields';

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
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatLinkScope(link) {
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
  if (fields == null) return 'All optional fields';
  if (!Array.isArray(fields) || fields.length === 0) return 'Student name only';
  return `${fields.length} optional field(s)`;
}

export default function ParentCollection() {
  const [loading, setLoading] = useState(true);
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [schools, setSchools] = useState([]);
  const [schoolDetails, setSchoolDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [linkMode, setLinkMode] = useState('standalone');
  const [schoolId, setSchoolId] = useState('');
  const [classSectionId, setClassSectionId] = useState('');
  const [collectionSchoolLabel, setCollectionSchoolLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('180');
  const [fieldEnabled, setFieldEnabled] = useState(makeInitialFieldEnabled);
  const [lastCreatedLink, setLastCreatedLink] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingToken, setRevokingToken] = useState('');
  const [exporting, setExporting] = useState(false);
  const [filterClassName, setFilterClassName] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [exportingSchool, setExportingSchool] = useState(null);

  const publicOriginConfigured = isPublicParentOriginConfigured();

  const flatSections = useMemo(() => {
    const classes = schoolDetails?.data?.classes || [];
    const rows = [];
    classes.forEach((group) => {
      (group.sections || []).forEach((section) => {
        rows.push({
          classId: section._id,
          label: `${group.className} - ${section.section}`,
        });
      });
    });
    return rows;
  }, [schoolDetails]);

  const submissionFilters = useMemo(
    () => ({
      className: filterClassName.trim() || undefined,
      section: filterSection.trim() || undefined,
    }),
    [filterClassName, filterSection]
  );

  const groupedSubmissions = useMemo(() => {
    return submissions.reduce((acc, curr) => {
      const schoolName = curr.schoolName || curr.collectionSchoolLabel || 'Unknown School';
      if (!acc[schoolName]) acc[schoolName] = [];
      acc[schoolName].push(curr);
      return acc;
    }, {});
  }, [submissions]);

  const schoolFormReady =
    linkMode === 'school' &&
    Boolean(schoolId) &&
    Boolean(classSectionId);

  const standaloneReady =
    linkMode === 'standalone' &&
    Boolean(collectionSchoolLabel.trim());

  const formDisabled = linkMode === 'school' ? !schoolFormReady : !standaloneReady;

  async function loadLinks() {
    setLinksLoading(true);
    try {
      const data = await listCollectionLinks();
      setLinks(data?.links || []);
    } finally {
      setLinksLoading(false);
    }
  }

  async function loadSubmissions(nextFilters = submissionFilters) {
    setSubmissionsLoading(true);
    try {
      const data = await listCollectionSubmissions(nextFilters);
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

        if (!enabled) {
          setSchools([]);
          setLinks([]);
          setSubmissions([]);
          return;
        }

        const [schoolsRes, linksRes, submissionsRes] = await Promise.all([
          getAssignedSchoolsForCollection(),
          listCollectionLinks(),
          listCollectionSubmissions(),
        ]);

        if (cancelled) return;
        setSchools(schoolsRes?.schools || []);
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

  useEffect(() => {
    setClassSectionId('');
    setSchoolDetails(null);
    if (!schoolId || linkMode !== 'school') return;

    let cancelled = false;

    async function loadDetails() {
      setDetailsLoading(true);
      try {
        const details = await getSchoolDetailsForCollection(schoolId);
        if (!cancelled) setSchoolDetails(details);
      } catch (err) {
        if (!cancelled) {
          setFeedback({ type: 'error', message: err?.message || 'Failed to load school classes' });
        }
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    }

    loadDetails();
    return () => {
      cancelled = true;
    };
  }, [schoolId, linkMode]);

  useEffect(() => {
    setFieldEnabled(makeInitialFieldEnabled());
  }, [linkMode, classSectionId]);

  async function handleCreateLink() {
    setFeedback(null);
    setCreating(true);
    try {
      const fields = PARENT_FORM_OPTIONAL_FIELDS.filter((item) => fieldEnabled[item.key]).map(
        (item) => item.key
      );
      const payload = {
        fields,
        expiresInDays: Number.parseInt(expiresInDays, 10) || 180,
      };

      if (linkMode === 'school') {
        payload.schoolId = schoolId;
        payload.classId = classSectionId;
      } else if (linkMode === 'standalone') {
        payload.collectionSchoolLabel = collectionSchoolLabel.trim();
      }

      const result = await createCollectionLink(payload);
      const publicLink = buildParentCollectionLink(result?.token);
      console.log('publicLink', publicLink);
      setLastCreatedLink(publicLink);
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

  async function handleRevokeLink(token) {
    const approved = window.confirm(
      'Deactivate this parent form link? Parents will no longer be able to submit.'
    );
    if (!approved) return;

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

  async function handleRefreshSubmissions() {
    setFeedback(null);
    try {
      await loadSubmissions(submissionFilters);
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to refresh submissions' });
    }
  }

  async function handleExport() {
    setFeedback(null);
    setExporting(true);
    try {
      const blob = await exportCollectionSubmissions(submissionFilters);
      const filename = `parent_form_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      downloadBlob(blob, filename);
      setFeedback({
        type: 'success',
        message:
          'Excel export downloaded. Only the selected form fields are included, so the sheet stays clean and easier to use for bulk upload.',
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
      const filters = { ...submissionFilters };
      if (sample.schoolId) {
         // use the object form if populated, otherwise the string
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

  if (!featureEnabled) {
    return (
      <>
        <Header title="Parent Forms" />
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Feature disabled by admin</h2>
          <p className="text-muted">
            The admin app-wide switch is off, so photographers cannot create parent data collection links right now.
          </p>
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
            Create a private form link, send it to parents or teachers, and later export the submitted data for bulk
            upload. The admin controls whether this feature is visible to photographers.
          </p>
          {!publicOriginConfigured && (
            <div className="parent-collection-warning">
              Set <code>VITE_PUBLIC_PARENT_ORIGIN</code> to your deployed web app URL so copied links open the correct
              parent form on phones.
            </div>
          )}
          {feedback && (
            <div className={`parent-collection-feedback ${feedback.type === 'error' ? 'error' : 'success'}`}>
              {feedback.message}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>1. Link type</h3>
          <div className="parent-collection-grid two">
            <label className="parent-collection-field">
              <span className="input-label">Mode</span>
              <select
                className="input-field"
                value={linkMode}
                onChange={(e) => {
                  setLinkMode(e.target.value);
                  setLastCreatedLink('');
                  setCollectionSchoolLabel('');
                }}
              >
                <option value="standalone">Standalone (parents enter class and section)</option>
                <option value="school">School-bound class</option>
              </select>
            </label>
            {linkMode === 'standalone' && (
              <label className="parent-collection-field">
                <span className="input-label">School Name</span>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Enter School Name"
                  value={collectionSchoolLabel}
                  onChange={(e) => setCollectionSchoolLabel(e.target.value)}
                />
              </label>
            )}
          </div>
        </div>

        {linkMode === 'school' && (
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>2. Select school and class</h3>
            <div className="parent-collection-grid two">
              <label className="parent-collection-field">
                <span className="input-label">School</span>
                <select
                  className="input-field"
                  value={schoolId}
                  onChange={(e) => setSchoolId(e.target.value)}
                >
                  <option value="">Select school</option>
                  {schools.map((school) => (
                    <option key={school._id} value={school._id}>
                      {school.schoolName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="parent-collection-field">
                <span className="input-label">Class / section</span>
                <select
                  className="input-field"
                  value={classSectionId}
                  onChange={(e) => setClassSectionId(e.target.value)}
                  disabled={!schoolId || detailsLoading || flatSections.length === 0}
                >
                  <option value="">
                    {!schoolId
                      ? 'Select school first'
                      : detailsLoading
                        ? 'Loading classes...'
                        : 'Select class / section'}
                  </option>
                  {flatSections.map((item) => (
                    <option key={item.classId} value={item.classId}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        <div className="card">
          <h3 style={{ marginBottom: 8 }}>{linkMode === 'school' ? '3.' : '2.'} Select fields</h3>
          <p className="text-muted" style={{ marginBottom: 16 }}>
            Student name is always required. These are the optional fields parents will fill in the public form.
          </p>

          <div className="parent-collection-actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setFieldEnabled(makeInitialFieldEnabled())}
              disabled={formDisabled}
            >
              Select all
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setFieldEnabled(
                  Object.fromEntries(PARENT_FORM_OPTIONAL_FIELDS.map((field) => [field.key, false]))
                )
              }
              disabled={formDisabled}
            >
              Name only
            </button>
          </div>

          <div className="parent-collection-checkbox-grid">
            {PARENT_FORM_OPTIONAL_FIELDS.map((field) => (
              <label key={field.key} className="parent-collection-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(fieldEnabled[field.key])}
                  onChange={(e) =>
                    setFieldEnabled((prev) => ({
                      ...prev,
                      [field.key]: e.target.checked,
                    }))
                  }
                  disabled={formDisabled}
                />
                <span>{field.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 8 }}>{linkMode === 'school' ? '4.' : '3.'} Generate parent form link</h3>
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
                    <th>Scope</th>
                    <th>Fields</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link._id}>
                      <td>{formatLinkScope(link)}</td>
                      <td>{formatFieldsSummary(link.fields)}</td>
                      <td>
                        <span className={`badge ${link.isActive ? 'badge-approved' : 'badge-printed'}`}>
                          {link.isActive ? 'Active' : 'Revoked'}
                        </span>
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
                          {link.isActive && (
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => handleRevokeLink(link.token)}
                              disabled={revokingToken === link.token}
                            >
                              {revokingToken === link.token ? 'Stopping...' : 'Revoke'}
                            </button>
                          )}
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

          <div className="parent-collection-grid two" style={{ marginBottom: 16 }}>
            <label className="parent-collection-field">
              <span className="input-label">Filter class name</span>
              <input
                className="input-field"
                value={filterClassName}
                onChange={(e) => setFilterClassName(e.target.value)}
                placeholder="Example: 10"
              />
            </label>
            <label className="parent-collection-field">
              <span className="input-label">Filter section</span>
              <input
                className="input-field"
                value={filterSection}
                onChange={(e) => setFilterSection(e.target.value)}
                placeholder="Example: A"
              />
            </label>
          </div>

          <div className="parent-collection-actions-row">
            <button type="button" className="btn btn-secondary" onClick={handleRefreshSubmissions} disabled={submissionsLoading}>
              {submissionsLoading ? 'Refreshing...' : 'Apply filters'}
            </button>
            <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting...' : 'Export All Excel'}
            </button>
          </div>

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
                         onClick={(e) => { e.stopPropagation(); handleExportSchool(schoolGroup, groupedSubmissions[schoolGroup]); }}
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
                               <td>{item.schoolName || '—'}</td>
                               <td>{item.className || '—'}</td>
                               <td>{item.section || '—'}</td>
                               <td>{item.studentName || '—'}</td>
                               <td>{item.rollNo || '—'}</td>
                               <td>{item.admissionNo || '—'}</td>
                               <td>{item.mobile || '—'}</td>
                               <td>{formatDateTime(item.createdAt)}</td>
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

      <style>{`
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

        @media (max-width: 900px) {
          .parent-collection-grid.two,
          .parent-collection-checkbox-grid {
            grid-template-columns: 1fr;
          }

          .parent-collection-card-header {
            flex-direction: column;
          }
        }
      `}</style>
    </>
  );
}
