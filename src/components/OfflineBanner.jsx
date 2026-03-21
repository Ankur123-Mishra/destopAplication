import React from 'react';
import { useApp } from '../context/AppContext';

export default function OfflineBanner() {
  const { offlineMode, pendingUploads, clearPendingUploads } = useApp();
  if (!offlineMode && pendingUploads.length === 0) return null;

  return (
    <div className="offline-banner">
      <span className="offline-status">
        {offlineMode ? '📴 Offline - Pending Sync' : `⏳ ${pendingUploads.length} Pending Upload(s)`}
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => {}}>
        Sync Now
      </button>
      {pendingUploads.length > 0 && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={clearPendingUploads}>
          Clear
        </button>
      )}
    </div>
  );
}
