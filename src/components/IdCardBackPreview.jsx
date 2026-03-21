import React from 'react';
import { getInternalTemplateId } from '../data/idCardTemplates';
import './IdCardRenderer.css';

/** Maps template id to back-theme variant (matches front design colors) */
export function getBackThemeVariant(templateId) {
  if (!templateId) return 'default';
  if (String(templateId).startsWith('fabric-')) return 'fabric';
  const internal = getInternalTemplateId(templateId);
  const themed = ['navy-design', 'green-design', 'maroon-design', 'cambridge-design', 'elegant-blue-design'];
  return themed.includes(internal) ? internal : 'default';
}

/** Renders ID card back; design and colors match the front template. size: 'small' | 'preview'. backImage: optional custom PNG for uploaded template. */
export default function IdCardBackPreview({ schoolName, address, templateId, size = 'small', backImage }) {
  const sizeClass = size === 'small' ? 'idcard--small' : size === 'preview' ? 'idcard--preview' : '';
  const variant = getBackThemeVariant(templateId);
  if (backImage) {
    return (
      <div
        className={`idcard idcard-back-preview idcard-back-preview--custom ${sizeClass}`}
        style={{ position: 'relative', width: '100%', height: '100%',}}
      >
        <img
          src={backImage}
          alt="ID card back"
          style={{
            // position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            // Force exact same box size as front (no auto scaling)
            objectFit: 'fill',
            objectPosition: 'center',
            display: 'block',
          }}
        />
        <div className="idcard-back-inner idcard-back-inner--image-only" style={{ position: 'relative', zIndex: 1 }} />
      </div>
    );
  }
  return (
    <div
      className={`idcard idcard-back-preview idcard-back-preview--${variant} ${sizeClass}`}
    >
      <div className="idcard-back-inner">
        <div className="idcard-back-school">{schoolName || 'School Name'}</div>
        <div className="idcard-back-address">{address || 'Address'}</div>
        <div className="idcard-back-valid">Valid for current session</div>
        <div className="idcard-back-rules">
          This card is non-transferable. Must be produced on demand.
        </div>
        <div className="idcard-back-barcode">|||| |||| | || ||||</div>
      </div>
    </div>
  );
}
