import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../components/Header';
import IdCardRenderer from '../components/IdCardRenderer';
import { ID_CARD_TEMPLATES } from '../data/idCardTemplates';
import { getFabricTemplates } from '../data/fabricTemplatesStorage';
import '../components/IdCardRenderer.css';

export default function IdCardSelectTemplate() {
  const navigate = useNavigate();
  const { schoolId, classId, studentId } = useParams();
  const backTo = `/schools/${schoolId}/classes/${classId}/students/${studentId}/detail`;
  const { templates: fabricTemplates } = getFabricTemplates();

  const onSelectTemplate = (templateId) => {
    navigate(`/schools/${schoolId}/classes/${classId}/students/${studentId}/id-card/fill/${templateId}`);
  };

  const hasImage = ID_CARD_TEMPLATES.length > 0;
  const hasFabric = fabricTemplates.length > 0;
  const hasAny = hasImage || hasFabric;

  return (
    <>
      <Header title="Select ID Card Template" showBack backTo={backTo} />
      <p className="text-muted" style={{ marginBottom: 24 }}>
        First select an ID card template. Then you will add the student&apos;s photo and details.
      </p>
      {!hasAny ? (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p className="text-muted" style={{ margin: 0 }}>No ID card templates yet. You can create one in the Template Editor.</p>
        </div>
      ) : (
        <>
          {hasFabric && (
            <>
              <h3 style={{ marginBottom: 12 }}>Fabric templates (editable)</h3>
              <div className="idcard-template-grid" style={{ marginBottom: 24 }}>
                {fabricTemplates.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className="idcard-template-card card"
                    onClick={() => onSelectTemplate(t.id)}
                  >
                    <div className="idcard-template-preview">
                      {t.backgroundDataUrl ? (
                        <img src={t.backgroundDataUrl} alt={t.name} className="idcard-template-preview-img" />
                      ) : (
                        <span className="text-muted">Canvas template</span>
                      )}
                    </div>
                    <div className="idcard-template-info">
                      <strong>{t.name}</strong>
                      <span className="text-muted">Fabric · Text, Photo, QR</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {hasImage && (
            <>
              <h3 style={{ marginBottom: 12 }}>Image templates</h3>
              <div className="idcard-template-grid">
                {ID_CARD_TEMPLATES.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className="idcard-template-card card"
                    onClick={() => onSelectTemplate(t.id)}
                  >
                    <div className="idcard-template-preview">
                      {t.image ? (
                        <img src={t.image} alt={t.name} className="idcard-template-preview-img" />
                      ) : (
                        <IdCardRenderer
                          templateId={t.id}
                          data={{
                            schoolName: 'School Name',
                            className: 'Class 10-A',
                            address: 'Address',
                            name: 'Student Name',
                            studentId: 'STU001',
                          }}
                          size="small"
                        />
                      )}
                    </div>
                    <div className="idcard-template-info">
                      <strong>{t.name}</strong>
                      {t.description && <span className="text-muted">{t.description}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
