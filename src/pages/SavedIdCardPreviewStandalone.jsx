import React from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import IdCardRenderer from '../components/IdCardRenderer';
import FabricIdCardGenerator from '../components/FabricIdCardGenerator';
import { getFabricTemplateById } from '../data/fabricTemplatesStorage';

export default function SavedIdCardPreviewStandalone() {
  const { studentId, idCardId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const classId = searchParams.get('classId');
  const listBasePath = location.pathname.startsWith('/view-template') ? '/view-template' : '/saved-id-cards';
  const backToUrl = classId ? `${listBasePath}?classId=${encodeURIComponent(classId)}` : listBasePath;
  const { getSavedIdCard } = useApp();
  const card = getSavedIdCard(studentId, idCardId);

  if (!card) {
    return (
      <>
        <Header title="ID Card not found" showBack backTo={backToUrl} />
        <p className="text-muted">Saved ID card not found.</p>
      </>
    );
  }

  const isFabric = card.templateId.startsWith('fabric-');
  const fabricTemplate = isFabric ? getFabricTemplateById(card.templateId) : null;

  if (isFabric && fabricTemplate?.json) {
    const studentData = {
      name: card.name,
      studentId: card.studentId,
      className: card.className,
      schoolName: card.schoolName,
      studentImage: card.studentImage,
    };
    return (
      <>
        <Header title="ID Card Preview" showBack backTo={backToUrl} />
        <div className="idcard-preview-page">
          <p className="text-muted" style={{ marginBottom: 20 }}>Saved ID card — click Back to return to list.</p>
          <FabricIdCardGenerator
            templateJson={fabricTemplate.json}
            backgroundDataUrl={fabricTemplate.backgroundDataUrl}
            studentData={studentData}
          />
        </div>
      </>
    );
  }

  const data = {
    studentImage: card.studentImage,
    ...(card.colorCodeImage ? { colorCodeImage: card.colorCodeImage } : {}),
    name: card.name,
    studentId: card.studentId,
    ...(card.rollNo != null && card.rollNo !== '' ? { rollNo: card.rollNo } : {}),
    ...(card.admissionNo != null && card.admissionNo !== ''
      ? { admissionNo: card.admissionNo }
      : {}),
    ...(card.uniqueCode != null && card.uniqueCode !== ''
      ? { uniqueCode: card.uniqueCode }
      : {}),
    ...(card.section != null && card.section !== '' ? { section: card.section } : {}),
    className: card.className,
    schoolName: card.schoolName,
    extraFields: card.extraFields && typeof card.extraFields === 'object' ? card.extraFields : {},
    ...(card.elements && { elements: card.elements }),
    ...(card.dateOfBirth && { dateOfBirth: card.dateOfBirth }),
    ...(card.address && { address: card.address }),
    ...(card.email && { email: card.email }),
    ...(card.phone && { phone: card.phone }),
    ...(card.academyName && { academyName: card.academyName }),
    ...(card.schoolLogo && { schoolLogo: card.schoolLogo }),
    ...(card.signature && { signature: card.signature }),
    ...(card.fatherName && { fatherName: card.fatherName }),
    ...(card.fatherPrimaryContact && { fatherPrimaryContact: card.fatherPrimaryContact }),
    ...(card.motherName && { motherName: card.motherName }),
    ...(card.motherPrimaryContact && { motherPrimaryContact: card.motherPrimaryContact }),
    ...(card.gender && { gender: card.gender }),
    ...(card.bloodGroup && { bloodGroup: card.bloodGroup }),
    ...(card.house && { house: card.house }),
    ...(card.marking && { marking: card.marking }),
    ...(card.photoNo != null && card.photoNo !== '' ? { photoNo: card.photoNo } : {}),
  };

  return (
    <>
      <Header title="ID Card Preview" showBack backTo={backToUrl} />
      <div className="idcard-preview-page">
        <p className="text-muted" style={{ marginBottom: 20 }}>Saved ID card — click Back to return to list.</p>
        <IdCardRenderer templateId={card.templateId} data={data} size="preview" />
      </div>
    </>
  );
}
