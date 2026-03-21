import React, { useRef, useState, useEffect } from 'react';

export default function CameraView({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [capturedBlob, setCapturedBlob] = useState(null);

  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480 } })
      .then((stream) => {
        if (!mounted || !videoRef.current) return;
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
      })
      .catch((err) => {
        setError('Webcam access denied or not available. Use Upload instead.');
      });
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const capture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) setCapturedBlob(blob);
    }, 'image/jpeg', 0.9);
  };

  const confirm = () => {
    if (capturedBlob) onCapture(capturedBlob);
  };

  const retake = () => setCapturedBlob(null);

  return (
    <div className="camera-view card">
      {onClose && (
        <button type="button" className="btn btn-secondary" style={{ marginBottom: 12 }} onClick={onClose}>
          ← Back
        </button>
      )}
      {error ? (
        <p className="text-muted">{error}</p>
      ) : (
        <>
          {!capturedBlob ? (
            <div className="camera-preview-wrap">
              <video ref={videoRef} autoPlay playsInline muted className="camera-preview" />
              <button type="button" className="btn btn-primary btn-capture" onClick={capture}>
                Capture Photo
              </button>
            </div>
          ) : (
            <div className="camera-preview-wrap">
              <img src={URL.createObjectURL(capturedBlob)} alt="Captured" className="camera-preview img-preview" />
              <div className="camera-actions">
                <button type="button" className="btn btn-secondary" onClick={retake}>Retake</button>
                <button type="button" className="btn btn-primary" onClick={confirm}>Confirm</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
