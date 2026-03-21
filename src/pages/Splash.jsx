import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => navigate('/login'), 2500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="splash">
      <div className="splash-content">
        <div className="splash-logo">📷</div>
        <h1 className="splash-title">Photographer Desktop App</h1>
        <p className="splash-subtitle">School ID Card Automation</p>
        <div className="splash-loader">
          <div className="spinner" />
        </div>
      </div>
    </div>
  );
}
