import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export default function Header({ title, showBack, backTo, onBackClick }) {
  const navigate = useNavigate();
  const { user, logout } = useApp();
  const handleBack = () => {
    if (onBackClick) onBackClick();
    else navigate(backTo || -1);
  };
  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="header">
      <div className="header-left">
        {showBack && (
          <button type="button" className="btn btn-secondary" onClick={handleBack}>
            ← Back
          </button>
        )}
        {title && <h1 className="header-title">{title}</h1>}
      </div>
      {user && (
        <div className="header-right">
          <span className="header-user">{user.name || user.mobile || user.email}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>
            Logout
          </button>
        </div>
      )}
    </header>
  );
}
