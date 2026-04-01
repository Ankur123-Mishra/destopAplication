import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export default function Splash() {
  const navigate = useNavigate();
  const { user, authReady } = useApp();
  
  useEffect(() => {
    if (!authReady) return undefined;
    const t = setTimeout(() => navigate(user ? '/dashboard' : '/login', { replace: true }), 1200);
    return () => clearTimeout(t);
  }, [authReady, navigate, user]);
  
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
