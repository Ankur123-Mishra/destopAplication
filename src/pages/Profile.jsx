import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import { getToken } from '../api/authStorage';
import { API_BASE_URL } from '../api/config';

export default function Profile() {
  const navigate = useNavigate();
  const { user, logout } = useApp();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    const fetchProfile = async () => {
      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`${API_BASE_URL}/api/photographer/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await response.json();
        setProfile(data.photographer);
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);
  
  if (loading) {
    return (
      <>
        <Header title="Profile" />
        <div className="card" style={{ maxWidth: 600, textAlign: 'center' }}>
          <p>Loading profile...</p>
        </div>
      </>
    );
  }
  
  return (
    <>
      <Header title="Profile" />
      <div className="card" style={{ maxWidth: 800, padding: '32px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ 
            width: 120, 
            height: 120, 
            borderRadius: '50%', 
            background: 'linear-gradient(135deg, var(--accent), var(--bg-card))', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            fontSize: '4rem', 
            margin: '0 auto 20px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>👤</div>
          <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 'bold' }}>{profile?.name || user?.name || 'Photographer'}</h1>
          <p style={{ color: 'var(--text-muted)', margin: '8px 0 0' }}>Professional Photographer</p>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div>
            <h3 style={{ marginBottom: 20, color: 'var(--accent)', fontSize: '1.5rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8 }}>Personal Information</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ 
                flex: '1 1 300px', 
                background: 'var(--bg-secondary)', 
                borderRadius: '12px', 
                padding: '20px', 
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 16
              }}>
                <div style={{ fontSize: '2rem' }}>📱</div>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: 4, color: 'var(--text)' }}>Mobile Number</div>
                  <div style={{ color: 'var(--text-muted)' }}>{profile?.mobile || user?.mobile || 'Not provided'}</div>
                </div>
              </div>
              <div style={{ 
                flex: '1 1 300px', 
                background: 'var(--bg-secondary)', 
                borderRadius: '12px', 
                padding: '20px', 
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 16
              }}>
                <div style={{ fontSize: '2rem' }}>✉️</div>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: 4, color: 'var(--text)' }}>Email Address</div>
                  <div style={{ color: 'var(--text-muted)' }}>{profile?.email || user?.email || 'Not provided'}</div>
                </div>
              </div>
            </div>
          </div>
          
          {profile && (
            <div>
              <h3 style={{ marginBottom: 20, color: 'var(--accent)', fontSize: '1.5rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8 }}>Account Details</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                <div style={{ 
                  flex: '1 1 300px', 
                  background: 'var(--bg-secondary)', 
                  borderRadius: '12px', 
                  padding: '20px', 
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16
                }}>
                  <div style={{ fontSize: '2rem' }}>👨‍👩‍👧‍👦</div>
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: 4, color: 'var(--text)' }}>Parent Collection</div>
                    <div style={{ color: 'var(--text-muted)' }}>{profile.parentCollectionEnabled ? 'Enabled' : 'Disabled'}</div>
                  </div>
                </div>
                <div style={{ 
                  flex: '1 1 300px', 
                  background: 'var(--bg-secondary)', 
                  borderRadius: '12px', 
                  padding: '20px', 
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16
                }}>
                  <div style={{ fontSize: '2rem' }}>⏱️</div>
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: 4, color: 'var(--text)' }}>Access Duration</div>
                    <div style={{ color: 'var(--text-muted)' }}>{profile.accessDurationValue} {profile.accessDurationUnit}</div>
                  </div>
                </div>
                <div style={{ 
                  flex: '1 1 300px', 
                  background: 'var(--bg-secondary)', 
                  borderRadius: '12px', 
                  padding: '20px', 
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16
                }}>
                  <div style={{ fontSize: '2rem' }}>📅</div>
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: 4, color: 'var(--text)' }}>Access Expires</div>
                    <div style={{ color: 'var(--text-muted)' }}>{new Date(profile.accessExpiresAt).toLocaleDateString('en-IN', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div style={{ marginTop: 40, textAlign: 'center' }}>
          <button type="button" className="btn btn-secondary" style={{ padding: '12px 24px', fontSize: '1rem' }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
