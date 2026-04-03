import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { getParentCollectionEnabled } from '../api/parentCollection';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  // { to: '/schools', label: 'Assigned Schools', icon: '🏫' },
  // { to: '/create-school', label: 'Create School', icon: '➕' },
  // { to: '/uploaded-photos', label: 'Uploaded Photos (Class-wise)', icon: '📷' },
  { to: '/class-id-cards', label: 'Class-wise ID Cards', icon: '🪪' },
  // { to: '/saved-id-cards', label: 'Saved ID Cards', icon: '🪪' },
  { to: '/view-template', label: 'View Template', icon: '🧩' },
  { to: '/batch-image-crop', label: 'Batch Image Crop', icon: '✂️' },
  
  // { to: '/corrections', label: 'Corrections', icon: '✏️' },
  
  // { to: '/template-editor', label: 'Template Editor', icon: '🎨' },
  // { to: '/delivery', label: 'Delivery Panel', icon: '📦' },
  // { to: '/notifications', label: 'Notifications', icon: '🔔' },
  { to: '/profile', label: 'Profile', icon: '👤' },
];

export default function Sidebar() {
  const location = useLocation();
  const path = location.pathname;
  const [parentFormsEnabled, setParentFormsEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadFeatureFlag() {
      try {
        const res = await getParentCollectionEnabled();
        if (!cancelled) setParentFormsEnabled(Boolean(res?.enabled));
      } catch {
        if (!cancelled) setParentFormsEnabled(false);
      }
    }

    loadFeatureFlag();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const navLinks = useMemo(() => {
    if (!parentFormsEnabled) return links;
    const nextLinks = [...links];
    nextLinks.splice(nextLinks.length - 1, 0, {
      to: '/parent-collection',
      label: 'Parent Forms',
      icon: '🔗',
    });
    return nextLinks;
  }, [parentFormsEnabled]);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">ID Card App</div>
      <nav className="sidebar-nav">
        {navLinks.map(({ to, label, icon }) => {
          const isActive = path === to || (to !== '/dashboard' && path.startsWith(to));
          return (
            <NavLink
              key={to}
              to={to}
              className={`sidebar-link ${isActive ? 'active' : ''}`}
            >
              <span className="sidebar-icon">{icon}</span>
              <span>{label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
