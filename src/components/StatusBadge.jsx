import React from 'react';

const statusMap = {
  pending: { label: 'Pending', class: 'badge-pending' },
  photo_uploaded: { label: 'Photo Uploaded', class: 'badge-uploaded' },
  correction_required: { label: 'Correction Required', class: 'badge-correction' },
  approved: { label: 'Approved', class: 'badge-approved' },
  printed: { label: 'Printed', class: 'badge-printed' },
  delivered: { label: 'Delivered', class: 'badge-delivered' },
};

export default function StatusBadge({ status }) {
  const config = statusMap[status] || statusMap.pending;
  return <span className={`badge ${config.class}`}>{config.label}</span>;
}
