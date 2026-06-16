import React from 'react';

export default function BatchCropIcon({ size = '1.2rem', className, style }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, ...style }}
    >
      <path d="M3 7V3h4" />
      <path d="M17 3h4v4" />
      <path d="M3 17v4h4" />
      <path d="M17 21h4v-4" />
      <rect x="8.5" y="10.5" width="7" height="5.5" rx="1" />
      <rect x="10" y="9" width="4" height="1.5" rx="0.4" />
      <rect x="9" y="8.2" width="1.6" height="1" rx="0.25" />
      <circle cx="14.5" cy="8.7" r="0.55" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13.2" r="2" />
      <circle cx="12" cy="13.2" r="1" />
    </svg>
  );
}
