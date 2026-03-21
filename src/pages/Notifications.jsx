import React from 'react';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';

export default function Notifications() {
  const { notifications, markNotificationRead } = useApp();

  return (
    <>
      <Header title="Notifications" />
      <div className="notification-list">
        {notifications.length === 0 ? (
          <div className="card">
            <p className="text-muted">No notifications.</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`card notification-item ${n.read ? 'read' : ''}`}
              onClick={() => markNotificationRead(n.id)}
              onKeyDown={(e) => e.key === 'Enter' && markNotificationRead(n.id)}
              role="button"
              tabIndex={0}
            >
              <div className="notification-content">
                <strong>{n.title}</strong>
                <p className="text-muted" style={{ marginTop: 4 }}>{n.message}</p>
                <span className="notification-time">{n.time}</span>
              </div>
              {!n.read && <span className="badge badge-pending">New</span>}
            </div>
          ))
        )}
      </div>
      <style>{`
        .notification-list { display: flex; flex-direction: column; gap: 12px; }
        .notification-item { display: flex; justify-content: space-between; align-items: flex-start; cursor: pointer; transition: background 0.2s; }
        .notification-item:hover { background: var(--bg-card); }
        .notification-item.read { opacity: 0.85; }
        .notification-time { font-size: 0.8rem; color: var(--text-muted); margin-top: 8px; display: block; }
      `}</style>
    </>
  );
}
