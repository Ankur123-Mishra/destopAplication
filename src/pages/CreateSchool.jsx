import React from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import CreateSchoolForm from '../components/CreateSchoolForm';

export default function CreateSchool() {
  const navigate = useNavigate();

  return (
    <>
      <Header title="Create School" showBack backTo="/dashboard" />
      <div className="card" style={{ maxWidth: 560 }}>
        <CreateSchoolForm
          onSuccess={() => navigate('/schools', { replace: true })}
          onCancel={() => navigate('/dashboard')}
          showCancel
        />
      </div>
    </>
  );
}
