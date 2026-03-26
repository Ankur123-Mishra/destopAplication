import React from 'react';
import './IdCardRenderer.css';
import { getTemplateById, getInternalTemplateId } from '../data/idCardTemplates';

/**
 * Renders an ID card with given template and data.
 * data: { studentImage, name, studentId, className, schoolName, dateOfBirth, address, email, phone, academyName, schoolLogo, signature }
 * templateId can be internal (navy-design) or API format (template-navy) – both render correctly.
 * template: optional override { image, elements } for uploaded/custom image templates.
 */
export default function IdCardRenderer({ templateId, data, size = 'normal', template: templateOverride }) {
  const { studentImage, name, studentId, className, schoolName, dateOfBirth, address, email, phone, academyName, schoolLogo, signature, elements } = data || {};
  const sizeClass = size === 'small' ? 'idcard--small' : size === 'preview' ? 'idcard--preview' : '';
  const effectiveTemplateId = getInternalTemplateId(templateId);
  const template = templateOverride || getTemplateById(effectiveTemplateId);

  if (!templateId && !templateOverride) return null;

  /* Image template with custom canvas layout (saved from Canva-style editor or uploaded template) */
  const layoutElements = template?.elements ?? elements;
  if (template?.image && layoutElements?.length) {
    return (
      <div className={`idcard idcard-image-template idcard-image-template-canvas ${sizeClass}`} style={{ backgroundImage: `url(${template.image})` }}>
        {layoutElements.map((el) => {
          if (el.type === 'photo') {
            return (
              <div
                key={el.id}
                className="idcard-canvas-el idcard-canvas-photo idcard-render-only"
                style={{
                  left: `${el.x}%`,
                  top: `${el.y}%`,
                  width: `${el.width}%`,
                  height: `${el.height}%`,
                }}
              >
                {studentImage && <img src={studentImage} alt="" />}
              </div>
            );
          }
          const textContent = el.dataField && (data || {})[el.dataField] != null
            ? String((data || {})[el.dataField])
            : (el.content ?? '');
          const wrapMultiline = el.dataField === 'address';
          return (
            <div
              key={el.id}
              className={`idcard-canvas-el idcard-canvas-text idcard-render-only${wrapMultiline ? ' idcard-canvas-text--wrap' : ''}`}
              style={{
                left: `${el.x}%`,
                top: `${el.y}%`,
                fontSize: `${el.fontSize || 12}px`,
                fontWeight: el.fontWeight || '400',
                ...(el.color ? { color: el.color } : {}),
              }}
            >
              {textContent}
            </div>
          );
        })}
      </div>
    );
  }

  /* Image-based template – fixed overlay (no custom layout) */
  if (template?.image) {
    return (
      <div className={`idcard idcard-image-template ${sizeClass}`} style={{ backgroundImage: `url(${template.image})` }}>
        <div className="idcard-image-template-overlay">
          {studentImage && (
            <div className="idcard-image-template-photo">
              <img src={studentImage} alt={name} />
            </div>
          )}
          <div className="idcard-image-template-details">
            {name && <div className="idcard-image-template-name">{name}</div>}
            {studentId && <div className="idcard-image-template-id">ID: {studentId}</div>}
            {className && <div className="idcard-image-template-class">{className}</div>}
            {schoolName && <div className="idcard-image-template-school">{schoolName}</div>}
          </div>
        </div>
      </div>
    );
  }

  const commonContent = (
    <>
      {studentImage && (
        <div className="idcard-photo-wrap">
          <img src={studentImage} alt={name} className="idcard-photo" />
        </div>
      )}
      <div className="idcard-details">
        {name && <div className="idcard-name">{name}</div>}
        {studentId && <div className="idcard-id">ID: {studentId}</div>}
        {className && <div className="idcard-class">Class: {className}</div>}
        {schoolName && <div className="idcard-school">{schoolName}</div>}
      </div>
    </>
  );

  if (effectiveTemplateId === 'classic') {
    return (
      <div className={`idcard idcard-classic ${sizeClass}`}>
        <div className="idcard-inner idcard-classic-inner">
          {studentImage && (
            <div className="idcard-photo-wrap idcard-classic-photo">
              <img src={studentImage} alt={name} className="idcard-photo" />
            </div>
          )}
          <div className="idcard-details idcard-classic-details">
            <div className="idcard-title">STUDENT ID CARD</div>
            {name && <div className="idcard-name">{name}</div>}
            {studentId && <div className="idcard-id">ID: {studentId}</div>}
            {className && <div className="idcard-class">Class: {className}</div>}
            {schoolName && <div className="idcard-school">{schoolName}</div>}
          </div>
        </div>
      </div>
    );
  }

  if (effectiveTemplateId === 'modern') {
    return (
      <div className={`idcard idcard-modern ${sizeClass}`}>
        <div className="idcard-inner idcard-modern-inner">
          {studentImage && (
            <div className="idcard-modern-photo-wrap">
              <img src={studentImage} alt={name} className="idcard-photo" />
            </div>
          )}
          <div className="idcard-details idcard-modern-details">
            {name && <div className="idcard-name">{name}</div>}
            {studentId && <div className="idcard-id">{studentId}</div>}
            {className && <div className="idcard-class">{className}</div>}
            {schoolName && <div className="idcard-school">{schoolName}</div>}
          </div>
        </div>
      </div>
    );
  }

  if (effectiveTemplateId === 'minimal') {
    return (
      <div className={`idcard idcard-minimal ${sizeClass}`}>
        <div className="idcard-inner idcard-minimal-inner">
          <div className="idcard-minimal-top">
            {studentImage && (
              <div className="idcard-minimal-photo-wrap">
                <img src={studentImage} alt={name} className="idcard-photo" />
              </div>
            )}
            <div className="idcard-minimal-main">
              {name && <div className="idcard-name idcard-name--large">{name}</div>}
              {studentId && <div className="idcard-id">ID: {studentId}</div>}
            </div>
          </div>
          {schoolName && <div className="idcard-school idcard-minimal-school">{schoolName}</div>}
          {className && <div className="idcard-class">Class: {className}</div>}
        </div>
      </div>
    );
  }

  if (effectiveTemplateId === 'card-style') {
    return (
      <div className={`idcard idcard-cardstyle ${sizeClass}`}>
        <div className="idcard-inner idcard-cardstyle-inner">
          {studentImage && (
            <div className="idcard-cardstyle-photo">
              <img src={studentImage} alt={name} className="idcard-photo" />
            </div>
          )}
          <div className="idcard-details idcard-cardstyle-details">
            <div className="idcard-name">{name}</div>
            <div className="idcard-id">ID: {studentId}</div>
            <div className="idcard-class">{className}</div>
            <div className="idcard-school">{schoolName}</div>
          </div>
        </div>
      </div>
    );
  }

  if (effectiveTemplateId === 'horizontal') {
    return (
      <div className={`idcard idcard-horizontal ${sizeClass}`}>
        <div className="idcard-inner idcard-horizontal-inner">
          {studentImage && (
            <div className="idcard-horizontal-photo">
              <img src={studentImage} alt={name} className="idcard-photo" />
            </div>
          )}
          <div className="idcard-horizontal-details">
            <div className="idcard-name">{name}</div>
            <div className="idcard-id">ID: {studentId} · {className}</div>
            <div className="idcard-school">{schoolName}</div>
          </div>
        </div>
      </div>
    );
  }

  const schoolCardLayout = (prefix) => (
    <>
      <div className={`idcard-${prefix}-header`}>
        <div className={`idcard-${prefix}-header-left`}>
          <span className={`idcard-${prefix}-badge`}>STUDENT IDENTITY CARD</span>
          {schoolName && <span className={`idcard-${prefix}-school-name`}>{schoolName}</span>}
        </div>
        <div className={`idcard-${prefix}-header-right`}>
          {schoolLogo ? <img src={schoolLogo} alt="School logo" className={`idcard-${prefix}-logo`} /> : null}
        </div>
      </div>
      <div className={`idcard-${prefix}-body`}>
        <div className={`idcard-${prefix}-photo-section`}>
          <div className={`idcard-${prefix}-photo-wrap`}>
            {studentImage ? (
              <img src={studentImage} alt={name} className={`idcard-photo idcard-${prefix}-photo`} />
            ) : (
              <div className={`idcard-${prefix}-photo-placeholder`}>
                <span className={`idcard-${prefix}-photo-placeholder-text`}>PHOTO</span>
              </div>
            )}
          </div>
          <span className={`idcard-${prefix}-valid`}>Valid for current session</span>
        </div>
        <div className={`idcard-${prefix}-details`}>
          {name && <div className={`idcard-${prefix}-name`}>{name}</div>}
          {studentId && (
            <div className={`idcard-${prefix}-id-row`}>
              <span className={`idcard-${prefix}-id-label`}>ID No.</span>
              <span className={`idcard-${prefix}-id-value`}>{studentId}</span>
            </div>
          )}
          {className && (
            <div className={`idcard-${prefix}-class-row`}>
              <span className={`idcard-${prefix}-class-label`}>Class</span>
              <span className={`idcard-${prefix}-class-value`}>{className}</span>
            </div>
          )}
          <div className={`idcard-${prefix}-divider`} />
          {schoolName && <div className={`idcard-${prefix}-school-text`}>{schoolName}</div>}
          {address && <div className={`idcard-${prefix}-address-text`}>{address}</div>}
        </div>
      </div>
      <div className={`idcard-${prefix}-footer`}>
        <div className={`idcard-${prefix}-signature-line`}>
          <div className={`idcard-${prefix}-signature-block`}>
            <span className={`idcard-${prefix}-signature-label`}>Authorised Signatory</span>
            {signature && <img src={signature} alt="Signature" className={`idcard-${prefix}-signature-img`} />}
          </div>
          {studentId && <span className={`idcard-${prefix}-barcode`}>{studentId.replace(/\s/g, '')}</span>}
        </div>
      </div>
    </>
  );

  if (effectiveTemplateId === 'navy-design') {
    return (
      <div className={`idcard idcard-navy-design ${sizeClass}`}>
        <div className="idcard-navy-inner">{schoolCardLayout('navy')}</div>
      </div>
    );
  }

  /* Green design: details LEFT, photo RIGHT; header = badge + logo only */
  if (effectiveTemplateId === 'green-design') {
    return (
      <div className={`idcard idcard-green-design ${sizeClass}`}>
        <div className="idcard-green-inner">
          <div className="idcard-green-header">
            <span className="idcard-green-badge">STUDENT IDENTITY CARD</span>
            <div className="idcard-green-header-right">
              {schoolLogo ? <img src={schoolLogo} alt="School logo" className="idcard-green-logo" /> : null}
            </div>
          </div>
          <div className="idcard-green-body idcard-green-body-swap">
            <div className="idcard-green-details">
              {schoolName && <div className="idcard-green-school-text idcard-green-school-top">{schoolName}</div>}
              {name && <div className="idcard-green-name">{name}</div>}
              {studentId && (
                <div className="idcard-green-id-row">
                  <span className="idcard-green-id-label">ID No.</span>
                  <span className="idcard-green-id-value">{studentId}</span>
                </div>
              )}
              {className && (
                <div className="idcard-green-class-row">
                  <span className="idcard-green-class-label">Class</span>
                  <span className="idcard-green-class-value">{className}</span>
                </div>
              )}
              <div className="idcard-green-divider" />
              {address && <div className="idcard-green-address-text">{address}</div>}
            </div>
            <div className="idcard-green-photo-section">
              <div className="idcard-green-photo-wrap">
                {studentImage ? (
                  <img src={studentImage} alt={name} className="idcard-photo idcard-green-photo" />
                ) : (
                  <div className="idcard-green-photo-placeholder">
                    <span className="idcard-green-photo-placeholder-text">PHOTO</span>
                  </div>
                )}
              </div>
              <span className="idcard-green-valid">Valid for current session</span>
            </div>
          </div>
          <div className="idcard-green-footer">
            <div className="idcard-green-signature-line">
              <div className="idcard-green-signature-block">
                <span className="idcard-green-signature-label">Authorised Signatory</span>
                {signature && <img src={signature} alt="Signature" className="idcard-green-signature-img" />}
              </div>
              {studentId && <span className="idcard-green-barcode">{studentId.replace(/\s/g, '')}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* Maroon design: same layout as Navy (first card), only color changes */
  if (effectiveTemplateId === 'maroon-design') {
    return (
      <div className={`idcard idcard-maroon-design ${sizeClass}`}>
        <div className="idcard-maroon-inner">{schoolCardLayout('maroon')}</div>
      </div>
    );
  }

  /* Cambridge design: yellow bands with diagonal cuts, hexagon logo, icons strip, Principal */
  if (effectiveTemplateId === 'cambridge-design') {
    return (
      <div className={`idcard idcard-cambridge-design ${sizeClass}`}>
        <div className="idcard-cambridge-inner">
          <div className="idcard-cambridge-top-band">
            <div className="idcard-cambridge-hexagon">
              {schoolLogo ? <img src={schoolLogo} alt="Logo" className="idcard-cambridge-logo-img" /> : null}
            </div>
            <span className="idcard-cambridge-school-name">{schoolName || 'CAMBRIDGE SCHOOL'}</span>
          </div>
          <div className="idcard-cambridge-body">
            <div className="idcard-cambridge-icons-strip">
              <div className="idcard-cambridge-icon-circle" title="ID / Details">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              </div>
              <div className="idcard-cambridge-icon-circle" title="Date of Birth">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M12 14v4"/><path d="M9 18h6"/></svg>
              </div>
              <div className="idcard-cambridge-icon-circle" title="Phone">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </div>
              <div className="idcard-cambridge-icon-circle" title="Address">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </div>
            </div>
            <div className="idcard-cambridge-content">
              {studentImage && (
                <div className="idcard-cambridge-photo-wrap">
                  <img src={studentImage} alt={name} className="idcard-photo idcard-cambridge-photo" />
                </div>
              )}
              <div className="idcard-cambridge-details">
                {name && <div className="idcard-cambridge-name">{name}</div>}
                {studentId && <div className="idcard-cambridge-id">ID: {studentId}</div>}
                {className && <div className="idcard-cambridge-class">{className}</div>}
                {dateOfBirth && <div className="idcard-cambridge-dob">{dateOfBirth}</div>}
                {phone && <div className="idcard-cambridge-phone">{phone}</div>}
                {address && <div className="idcard-cambridge-address">{address}</div>}
              </div>
            </div>
          </div>
          <div className="idcard-cambridge-bottom-band">
            <span className="idcard-cambridge-principal">Principal</span>
          </div>
        </div>
      </div>
    );
  }

  /* Elegant Blue design: light blue header, clean body, blue footer */
  if (effectiveTemplateId === 'elegant-blue-design') {
    return (
      <div className={`idcard idcard-elegant-blue-design ${sizeClass}`}>
        <div className="idcard-elegant-blue-inner">
          <div className="idcard-elegant-blue-header">
            {schoolLogo && <img src={schoolLogo} alt="Logo" className="idcard-elegant-blue-logo" />}
            <span className="idcard-elegant-blue-school-name">{schoolName || 'School Name'}</span>
          </div>
          <div className="idcard-elegant-blue-body">
            <div className="idcard-elegant-blue-photo-section">
              {studentImage ? (
                <img src={studentImage} alt={name} className="idcard-photo idcard-elegant-blue-photo" />
              ) : (
                <div className="idcard-elegant-blue-photo-placeholder">PHOTO</div>
              )}
            </div>
            <div className="idcard-elegant-blue-details">
              {name && <div className="idcard-elegant-blue-name">{name}</div>}
              {studentId && <div className="idcard-elegant-blue-id">ID: {studentId}</div>}
              {className && <div className="idcard-elegant-blue-class">{className}</div>}
              {address && <div className="idcard-elegant-blue-address">{address}</div>}
            </div>
          </div>
          <div className="idcard-elegant-blue-footer">
            <span className="idcard-elegant-blue-valid">Valid for current session</span>
            {signature && <img src={signature} alt="Signature" className="idcard-elegant-blue-signature" />}
          </div>
        </div>
      </div>
    );
  }

  if (effectiveTemplateId === 'academy') {
    return (
      <div className={`idcard idcard-academy ${sizeClass}`}>
        <div className="idcard-academy-bands" />
        <div className="idcard-inner idcard-academy-inner">
          <div className="idcard-academy-header">
            <div className="idcard-academy-logo" />
            <span className="idcard-academy-title">{academyName || schoolName || 'Academy'}</span>
          </div>
          <div className="idcard-academy-body">
            {studentImage && (
              <div className="idcard-academy-photo-wrap">
                <img src={studentImage} alt={name} className="idcard-photo" />
              </div>
            )}
            <div className="idcard-academy-fields">
              {studentId && <div className="idcard-academy-row"><span className="idcard-academy-label">ID NO:</span> {studentId}</div>}
              {name && <div className="idcard-academy-row"><span className="idcard-academy-label">NAME:</span> {name}</div>}
              {dateOfBirth && <div className="idcard-academy-row"><span className="idcard-academy-label">DATE OF BIRTH:</span> {dateOfBirth}</div>}
              {address && <div className="idcard-academy-row"><span className="idcard-academy-label">ADDRESS:</span> {address}</div>}
              {email && <div className="idcard-academy-row"><span className="idcard-academy-label">EMAIL:</span> {email}</div>}
              {phone && <div className="idcard-academy-row"><span className="idcard-academy-label">PHONE:</span> {phone}</div>}
            </div>
          </div>
          <div className="idcard-academy-footer">
            <span className="idcard-academy-signature">Chief of Faculty</span>
            <div className="idcard-academy-barcode">||| || ||| | || |||</div>
          </div>
        </div>
        <div className="idcard-academy-bands idcard-academy-bands-bottom" />
      </div>
    );
  }

  return (
    <div className={`idcard ${sizeClass}`}>
      <div className="idcard-inner">{commonContent}</div>
    </div>
  );
}
