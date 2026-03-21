import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';

import Splash from './pages/Splash';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Schools from './pages/Schools';
import Classes from './pages/Classes';
import Students from './pages/Students';
import Camera from './pages/Camera';
import Preview from './pages/Preview';
import StudentDetail from './pages/StudentDetail';
import BulkMode from './pages/BulkMode';
import CorrectionList from './pages/CorrectionList';
import Corrections from './pages/Corrections';
import Delivery from './pages/Delivery';
import Notifications from './pages/Notifications';
import Profile from './pages/Profile';
import IdCardSelectTemplate from './pages/IdCardSelectTemplate';
import IdCardFill from './pages/IdCardFill';
import IdCardPreview from './pages/IdCardPreview';
import SavedIdCardsList from './pages/SavedIdCardsList';
import SavedIdCardPreviewStandalone from './pages/SavedIdCardPreviewStandalone';
import ViewTemplate from './pages/ViewTemplate';
import ClassWiseUploadedPhotos from './pages/ClassWiseUploadedPhotos';
import ClassIdCardsWizard from './pages/ClassIdCardsWizard';
import CreateSchool from './pages/CreateSchool';
import TemplateEditor from './pages/TemplateEditor';
import BatchImageCrop from './pages/BatchImageCrop';
import ParentCollection from './pages/ParentCollection';
import Layout from './components/Layout';
import OfflineBanner from './components/OfflineBanner';

function PrivateRoute({ children }) {
  const { user, authReady } = useApp();
  if (!authReady) {
    return (
      <div className="splash">
        <div className="splash-content">
          <div className="spinner" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <>
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<Splash />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Layout><Dashboard /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools"
          element={
            <PrivateRoute>
              <Layout><Schools /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/create-school"
          element={
            <PrivateRoute>
              <Layout><CreateSchool /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes"
          element={
            <PrivateRoute>
              <Layout><Classes /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/students"
          element={
            <PrivateRoute>
              <Layout><Students /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/students/:studentId/camera"
          element={
            <PrivateRoute>
              <Layout><Camera /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/students/:studentId/preview"
          element={
            <PrivateRoute>
              <Layout><Preview /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/students/:studentId/detail"
          element={
            <PrivateRoute>
              <Layout><StudentDetail /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/students/:studentId/id-card"
          element={
            <PrivateRoute>
              <Layout><IdCardSelectTemplate /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/students/:studentId/id-card/fill/:templateId"
          element={
            <PrivateRoute>
              <Layout><IdCardFill /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/students/:studentId/id-card/preview/:idCardId"
          element={
            <PrivateRoute>
              <Layout><IdCardPreview /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/bulk"
          element={
            <PrivateRoute>
              <Layout><BulkMode /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/schools/:schoolId/classes/:classId/correction"
          element={
            <PrivateRoute>
              <Layout><CorrectionList /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/corrections"
          element={
            <PrivateRoute>
              <Layout><Corrections /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/delivery"
          element={
            <PrivateRoute>
              <Layout><Delivery /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <PrivateRoute>
              <Layout><Notifications /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <Layout><Profile /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/uploaded-photos"
          element={
            <PrivateRoute>
              <Layout><ClassWiseUploadedPhotos /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/class-id-cards"
          element={
            <PrivateRoute>
              <Layout><ClassIdCardsWizard /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/class-id-cards/school/:schoolId"
          element={
            <PrivateRoute>
              <Layout><ClassIdCardsWizard /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/class-id-cards/students/:schoolId/:classId"
          element={
            <PrivateRoute>
              <Layout><ClassIdCardsWizard /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/class-id-cards/template/:schoolId/:classId"
          element={
            <PrivateRoute>
              <Layout><ClassIdCardsWizard /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/class-id-cards/review/:schoolId/:classId/:templateId"
          element={
            <PrivateRoute>
              <Layout><ClassIdCardsWizard /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/saved-id-cards/school/:schoolId/class/:classId"
          element={
            <PrivateRoute>
              <Layout><SavedIdCardsList /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/saved-id-cards/school/:schoolId"
          element={
            <PrivateRoute>
              <Layout><SavedIdCardsList /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/saved-id-cards"
          element={
            <PrivateRoute>
              <Layout><SavedIdCardsList /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/saved-id-cards/preview/:studentId/:idCardId"
          element={
            <PrivateRoute>
              <Layout><SavedIdCardPreviewStandalone /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/view-template/school/:schoolId/class/:classId"
          element={
            <PrivateRoute>
              <Layout><ViewTemplate /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/view-template/school/:schoolId"
          element={
            <PrivateRoute>
              <Layout><ViewTemplate /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/view-template"
          element={
            <PrivateRoute>
              <Layout><ViewTemplate /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/view-template/preview/:studentId/:idCardId"
          element={
            <PrivateRoute>
              <Layout><SavedIdCardPreviewStandalone /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/parent-collection"
          element={
            <PrivateRoute>
              <Layout><ParentCollection /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/template-editor"
          element={
            <PrivateRoute>
              <Layout><TemplateEditor /></Layout>
            </PrivateRoute>
          }
        />
        <Route
          path="/batch-image-crop"
          element={
            <PrivateRoute>
              <Layout><BatchImageCrop /></Layout>
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppRoutes />
    </AppProvider>
  );
}
