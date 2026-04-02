import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';

export default function Profile() {
  const navigate = useNavigate();
  const { user, logout } = useApp();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };
  
  return (
    <>
      <Header title="Profile" />
      <div className="card" style={{ maxWidth: 400 }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', marginBottom: 16 }}>👤</div>
          <h2>{user?.name || 'Photographer'}</h2>
          {user?.mobile && <p className="text-muted">{user.mobile}</p>}
          {user?.email && <p className="text-muted">{user.email}</p>}
          {!user?.mobile && !user?.email && <p className="text-muted">—</p>}
        </div>
        <button type="button" className="btn btn-secondary" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </>
  );
}
