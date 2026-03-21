import React from 'react';
import SavedIdCardsList from './SavedIdCardsList';

export default function ViewTemplate() {
  return (
    <SavedIdCardsList
      title="View Template"
      basePath="/view-template"
      previewBasePath="/view-template/preview"
      backTo="/dashboard"
    />
  );
}

