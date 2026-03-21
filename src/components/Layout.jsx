import React from 'react';
import Sidebar from './Sidebar';
import './components.css';

export default function Layout({ children }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
