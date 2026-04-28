import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import IdCardRenderer from '../components/IdCardRenderer';
import IdCardCanvasEditor from '../components/IdCardCanvasEditor';
import FabricIdCardGenerator from '../components/FabricIdCardGenerator';
import { exportFabricCanvasToPNG } from '../components/FabricIdCardGenerator';
import { getTemplateById, SCHOOL_CARD_TEMPLATE_IDS } from '../data/idCardTemplates';
import { getFabricTemplateById } from '../data/fabricTemplatesStorage';

export default function IdCardFill() {
  const navigate = useNavigate();
  const { schoolId, classId, studentId, templateId } = useParams();
  const { getStudents, addSavedIdCard, schools, classes } = useApp();
  const fabricCanvasRef = useRef(null);

  const students = getStudents(classId) || [];
  const student = students.find((s) => s.id === studentId);
  const cls = classes.find((c) => c.id === classId);
  const school = schools.find((s) => s.id === schoolId);
  const template = getTemplateById(templateId) || getFabricTemplateById(templateId);
  const isFabricTemplate = templateId.startsWith('fabric-');
  const isAcademy = templateId === 'academy';
  const isCanvasTemplate = !isFabricTemplate && template?.image;

  /* Editable fields – form-based (non-canvas templates) */
  const [form, setForm] = useState({
    name: '',
    studentId: '',
    className: '',
    schoolName: '',
    address: '',
    studentImage: null,
    schoolLogo: null,
    signature: null,
  });

  const [academyExtra, setAcademyExtra] = useState({
    dateOfBirth: '',
    address: '',
    email: '',
    phone: '',
    academyName: '',
  });

  useEffect(() => {
    if (student && !isCanvasTemplate) {
      setForm((p) => ({
        ...p,
        name: student.name || '',
        studentId: student.studentId || '',
        className: student?.className || cls?.name || '',
        schoolName: school?.name || '',
        address: school?.address || p.address || '',
        studentImage: student.photoUrl || null,
      }));
    }
  }, [student?.id, student?.name, student?.studentId, student?.photoUrl, cls?.name, school?.name, school?.address, isCanvasTemplate, isFabricTemplate]);

  useEffect(() => {
    if (isAcademy && school) {
      setAcademyExtra((p) => ({ ...p, academyName: school.name || 'Academy' }));
    }
  }, [isAcademy, school?.name]);

  const backTo = `/schools/${schoolId}/classes/${classId}/students/${studentId}/id-card`;
  const detailTo = `/schools/${schoolId}/classes/${classId}/students/${studentId}/detail`;

  const fillData = {
    ...form,
    ...(isAcademy ? academyExtra : {}),
    address: form.address,
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setForm((p) => ({ ...p, studentImage: reader.result }));
    reader.readAsDataURL(file);
  };

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setForm((p) => ({ ...p, schoolLogo: reader.result }));
    reader.readAsDataURL(file);
  };

  const handleSignatureChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setForm((p) => ({ ...p, signature: reader.result }));
    reader.readAsDataURL(file);
  };

  const handleCanvasSave = (payload) => {
    addSavedIdCard(
      studentId,
      {
        templateId,
        studentImage: payload.studentImage,
        name: payload.name,
        studentId: payload.studentId,
        className: payload.className,
        schoolName: payload.schoolName,
        elements: payload.elements,
      },
      { schoolId, classId }
    );
    navigate(`/schools/${schoolId}/classes/${classId}/students/${studentId}/detail`);
  };

  const handleSave = () => {
    addSavedIdCard(
      studentId,
      {
        templateId,
        studentImage: form.studentImage,
        name: form.name,
        studentId: form.studentId,
        className: form.className,
        schoolName: form.schoolName,
        address: form.address,
        schoolLogo: form.schoolLogo,
        signature: form.signature,
        ...(isAcademy ? academyExtra : {}),
      },
      { schoolId, classId }
    );
    navigate(`/schools/${schoolId}/classes/${classId}/students/${studentId}/detail`);
  };

  if (!student) {
    return (
      <>
        <Header title="Student not found" showBack backTo={detailTo} />
        <p className="text-muted">Student not found.</p>
      </>
    );
  }

  if (!template) {
    return (
      <>
        <Header title="Template not found" showBack backTo={backTo} />
        <p className="text-muted">Invalid template.</p>
      </>
    );
  }

  /* Fabric.js template: load JSON, fill student data, export PNG */
  if (isFabricTemplate && template.json) {
    const studentData = {
      name: form.name,
      studentId: form.studentId,
      className: form.className,
      schoolName: form.schoolName,
      studentImage: form.studentImage,
    };
    const handleExportPNG = () => {
      const dataUrl = exportFabricCanvasToPNG(fabricCanvasRef.current);
      if (!dataUrl) return;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `idcard-${form.studentId || 'student'}.png`;
      a.click();
    };
    return (
      <>
        <Header title={`ID Card – ${template.name}`} showBack backTo={backTo} />
        <p className="text-muted" style={{ marginBottom: 20 }}>
          Fill in the student data. Use Export PNG to download the card.
        </p>
        
        <div className="idcard-fill-layout">
          <div className="card idcard-fill-preview-card">
            <h3 style={{ marginBottom: 16 }}>Preview</h3>
            <FabricIdCardGenerator
              templateJson={template.json}
              backgroundDataUrl={template.backgroundDataUrl}
              studentData={studentData}
              onReady={(canvas) => { fabricCanvasRef.current = canvas; }}
            />
          </div>
          <div className="card idcard-fill-actions">
            <h3 style={{ marginBottom: 16 }}>Editable content</h3>
            <div style={{ marginBottom: 14 }}>
              <label className="input-label">Photo</label>
              <label className="btn btn-secondary" style={{ marginBottom: 0, cursor: 'pointer' }}>
                {form.studentImage ? 'Change photo' : 'Upload photo'}
                <input type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: 'none' }} />
              </label>
              {form.studentImage && (
                <img src={form.studentImage} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, marginTop: 8 }} />
              )}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label className="input-label">Name</label>
              <input type="text" className="input-field" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label className="input-label">Student ID</label>
              <input type="text" className="input-field" value={form.studentId} onChange={(e) => setForm((p) => ({ ...p, studentId: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label className="input-label">Class</label>
              <input type="text" className="input-field" value={form.className} onChange={(e) => setForm((p) => ({ ...p, className: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="input-label">School</label>
              <input type="text" className="input-field" value={form.schoolName} onChange={(e) => setForm((p) => ({ ...p, schoolName: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={handleSave}>Save ID Card</button>
              <button type="button" className="btn btn-secondary" onClick={handleExportPNG}>Export PNG</button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate(backTo)}>Cancel</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* Canva-style canvas editor for image templates */
  if (isCanvasTemplate) {
    return (
      <>
        <Header title={`Customize – ${template.name}`} showBack backTo={backTo} />
        <p className="text-muted" style={{ marginBottom: 20 }}>
          Drag, resize, and edit the photo and text on the template — customize like in Canva.
        </p>
        <IdCardCanvasEditor
          templateImage={template.image}
          studentImage={student?.photoUrl || null}
          colorCodeImage={student?.colorCodeImageUrl || null}
          initialElements={undefined}
          dimension={student?.dimension}
          dimensionUnit={student?.dimensionUnit}
          schoolId={schoolId}
          schoolPutPayload={{
            schoolName: school?.name || '',
            schoolCode: school?.schoolCode || '',
            address: school?.address || '',
            allowedMobiles: school?.allowedMobiles || [],
          }}
          initialData={{
            name: student?.name || student?.studentName || '',
            studentId: student?.studentId || student?.admissionNo || student?.rollNo || student?.uniqueCode || '',
            admissionNo: student?.admissionNo || '',
            rollNo: student?.rollNo || '',
            uniqueCode: student?.uniqueCode || '',
            className: student?.className || cls?.name || '',
            section: student?.section || '',
            schoolName: school?.name || '',
            address: student?.address || school?.address || '',
            phone: student?.mobile || student?.phone || '',
            email: student?.email || '',
            dateOfBirth: student?.dateOfBirth || student?.dob || student?.birthDate || '',
            fatherName: student?.fatherName || '',
            fatherPrimaryContact: student?.fatherPrimaryContact || student?.fatherPhone || '',
            motherName: student?.motherName || '',
            motherPrimaryContact: student?.motherPrimaryContact || student?.motherPhone || '',
            gender: student?.gender || '',
            bloodGroup: student?.bloodGroup || '',
            house: student?.house || '',
            marking: student?.marking || '',
            photoNo: student?.photoNo || '',
            uploadedVia: student?.uploadedVia || '',
            extraFields: student?.extraFields || {},
          }}
          onSave={handleCanvasSave}
          onCancel={() => navigate(backTo)}
        />
      </>
    );
  }

  return (
    <>
      <Header title={`Fill ID Card – ${template.name}`} showBack backTo={backTo} />
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Edit the image and content as needed. The preview updates live.
      </p>

       <div className="idcard-fill-layout">
        <div className="card idcard-fill-preview-card">
          <h3 style={{ marginBottom: 16 }}>Preview</h3>
          <IdCardRenderer templateId={templateId} data={fillData} size="normal" />
        </div>
        <div className="card idcard-fill-actions">
          <h3 style={{ marginBottom: 16 }}>Editable content</h3>

          <div style={{ marginBottom: 14 }}>
            <label className="input-label">Photo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {form.studentImage && (
                <img
                  src={form.studentImage}
                  alt="Preview"
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }}
                />
              )}
              <label className="btn btn-secondary" style={{ marginBottom: 0, cursor: 'pointer' }}>
                {form.studentImage ? 'Change photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  style={{ display: 'none' }}
                />
              </label>
              {form.studentImage && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.85rem' }}
                  onClick={() => setForm((p) => ({ ...p, studentImage: student?.photoUrl || null }))}
                >
                  Reset to student photo
                </button>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label className="input-label">Name</label>
            <input
              type="text"
              className="input-field"
              placeholder="Student name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="input-label">Student ID</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. STU1001"
              value={form.studentId}
              onChange={(e) => setForm((p) => ({ ...p, studentId: e.target.value }))}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="input-label">Class</label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. Class 10A"
              value={form.className}
              onChange={(e) => setForm((p) => ({ ...p, className: e.target.value }))}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="input-label">School</label>
            <input
              type="text"
              className="input-field"
              placeholder="School name"
              value={form.schoolName}
              onChange={(e) => setForm((p) => ({ ...p, schoolName: e.target.value }))}
            />
          </div>
          {SCHOOL_CARD_TEMPLATE_IDS.includes(templateId) && (
            <>
              <div style={{ marginBottom: 10 }}>
                <label className="input-label">Address</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="School address"
                  value={form.address}
                  onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="input-label">School logo</label>
                <label className="btn btn-secondary" style={{ marginBottom: 0, cursor: 'pointer', display: 'inline-block' }}>
                  {form.schoolLogo ? 'Change logo' : 'Upload logo'}
                  <input type="file" accept="image/*" onChange={handleLogoChange} style={{ display: 'none' }} />
                </label>
                {form.schoolLogo && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={form.schoolLogo} alt="School logo" style={{ width: 48, height: 48, objectFit: 'contain', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6 }} />
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => setForm((p) => ({ ...p, schoolLogo: null }))}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 16 }}>
                <label className="input-label">Signature (Authorised Signatory)</label>
                <label className="btn btn-secondary" style={{ marginBottom: 0, cursor: 'pointer', display: 'inline-block' }}>
                  {form.signature ? 'Change signature' : 'Upload signature'}
                  <input type="file" accept="image/*" onChange={handleSignatureChange} style={{ display: 'none' }} />
                </label>
                {form.signature && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={form.signature} alt="Signature" style={{ height: 32, maxWidth: 120, objectFit: 'contain', borderBottom: '1px solid var(--text-muted)', borderRadius: 0 }} />
                    <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => setForm((p) => ({ ...p, signature: null }))}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {isAcademy && (
            <div className="idcard-fill-academy-fields">
              <div style={{ marginBottom: 10 }}>
                <label className="input-label">Academy / School name</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Thynk Academy"
                  value={academyExtra.academyName}
                  onChange={(e) => setAcademyExtra((p) => ({ ...p, academyName: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="input-label">Date of birth</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 24/09/1998"
                  value={academyExtra.dateOfBirth}
                  onChange={(e) => setAcademyExtra((p) => ({ ...p, dateOfBirth: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="input-label">Address</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 123 Anywhere St."
                  value={academyExtra.address}
                  onChange={(e) => setAcademyExtra((p) => ({ ...p, address: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="input-label">Email</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="email@example.com"
                  value={academyExtra.email}
                  onChange={(e) => setAcademyExtra((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label className="input-label">Phone</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 123-456-7890"
                  value={academyExtra.phone}
                  onChange={(e) => setAcademyExtra((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={handleSave}>
              Save ID Card
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate(backTo)}>
              Cancel
            </button>
          </div>
        </div>
       </div>
    </>
  );
}
