import React, { useRef, useState } from 'react';

export default function UploadBox({ onFileSelect, accept = 'image/*' }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);

  const handleChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
    onFileSelect?.(f);
  };

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="upload-box card">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      {!preview ? (
        <div
          className="upload-dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f && f.type.startsWith('image/')) {
              setFile(f);
              setPreview(URL.createObjectURL(f));
              onFileSelect?.(f);
            }
          }}
        >
          <span className="upload-icon">📁</span>
          <p>Click or drag image here</p>
          <p className="text-muted" style={{ fontSize: '0.9rem' }}>JPG, PNG</p>
        </div>
      ) : (
        <div className="upload-preview-wrap">
          <img src={preview} alt="Preview" className="upload-preview-img" />
          <div className="upload-preview-actions">
            <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()}>
              Change
            </button>
            <button type="button" className="btn btn-secondary" onClick={clear}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}
