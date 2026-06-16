import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ensureUploadedTemplatesReady } from './data/uploadedTemplatesStorage';
import './index.css';
import './styles/idCardFonts.css';

const rootEl = document.getElementById('root');

function mountApp() {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>,
  );
}

if (rootEl) {
  ensureUploadedTemplatesReady().then(mountApp, mountApp);
} else {
  mountApp();
}
