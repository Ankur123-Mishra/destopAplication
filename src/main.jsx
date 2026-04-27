import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { hydrateUploadedTemplatesCache } from './data/uploadedTemplatesStorage';
import './index.css';

const rootEl = document.getElementById('root');

(async () => {
  try {
    await hydrateUploadedTemplatesCache();
  } catch (e) {
    console.error('Uploaded templates preload failed', e);
  }

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>,
  );
})();
