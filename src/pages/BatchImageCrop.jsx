import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import Header from '../components/Header';

const STEPS = {
  SELECT_FOLDER: 1,
  SELECT_FRAME: 2,
  DEFINE_CROP: 3,
  PROCESSING: 4,
  COMPLETE: 5
};

const CROP_FRAMES = [
  {
    id: 'rectangle',
    name: 'Rectangle',
    icon: '▭',
    description: 'Standard rectangular frame',
    shape: 'rectangle',
    aspectRatio: 4 / 5,
    crop: { unit: '%', width: 45, height: 56, x: 27.5, y: 22 },
    svgPath: null
  },
  {
    id: 'circle',
    name: 'Circle',
    icon: '⭕',
    description: 'Perfect circular frame',
    shape: 'circle',
    aspectRatio: 1,
    crop: { unit: '%', width: 50, height: 50, x: 25, y: 25 },
    svgPath: 'M 50 0 A 50 50 0 1 1 50 100 A 50 50 0 1 1 50 0 Z'
  },
  {
    id: 'star',
    name: 'Star',
    icon: '⭐',
    description: 'Five-pointed star shape',
    shape: 'star',
    aspectRatio: 1,
    crop: { unit: '%', width: 50, height: 50, x: 25, y: 25 },
    svgPath: 'M 50 5 L 61 38 L 95 38 L 68 58 L 79 91 L 50 71 L 21 91 L 32 58 L 5 38 L 39 38 Z'
  },
  {
    id: 'pentagon',
    name: 'Pentagon',
    icon: '⬟',
    description: 'Five-sided polygon frame',
    shape: 'pentagon',
    aspectRatio: 1,
    crop: { unit: '%', width: 50, height: 50, x: 25, y: 25 },
    svgPath: 'M 50 5 L 95 40 L 78 90 L 22 90 L 5 40 Z'
  },
  {
    id: 'hexagon',
    name: 'Hexagon',
    icon: '⬡',
    description: 'Six-sided polygon frame',
    shape: 'hexagon',
    aspectRatio: 1,
    crop: { unit: '%', width: 50, height: 50, x: 25, y: 25 },
    svgPath: 'M 50 5 L 90 27.5 L 90 72.5 L 50 95 L 10 72.5 L 10 27.5 Z'
  },
  {
    id: 'triangle',
    name: 'Triangle',
    icon: '▲',
    description: 'Triangular frame',
    shape: 'triangle',
    aspectRatio: 1.15,
    crop: { unit: '%', width: 50, height: 43.5, x: 25, y: 28 },
    svgPath: 'M 50 10 L 90 90 L 10 90 Z'
  },
  {
    id: 'heart',
    name: 'Heart',
    icon: '❤️',
    description: 'Heart-shaped frame',
    shape: 'heart',
    aspectRatio: 1,
    crop: { unit: '%', width: 50, height: 50, x: 25, y: 25 },
    svgPath: 'M 50 85 C 20 60, 5 40, 5 25 C 5 10, 15 5, 25 5 C 35 5, 45 15, 50 25 C 55 15, 65 5, 75 5 C 85 5, 95 10, 95 25 C 95 40, 80 60, 50 85 Z'
  },
  {
    id: 'octagon',
    name: 'Octagon',
    icon: '⯃',
    description: 'Eight-sided polygon frame',
    shape: 'octagon',
    aspectRatio: 1,
    crop: { unit: '%', width: 50, height: 50, x: 25, y: 25 },
    svgPath: 'M 30 5 L 70 5 L 95 30 L 95 70 L 70 95 L 30 95 L 5 70 L 5 30 Z'
  }
];

export default function BatchImageCrop() {
  const navigate = useNavigate();
  const [step, setStep] = useState(STEPS.SELECT_FOLDER);
  const [sourceFolder, setSourceFolder] = useState('');
  const [images, setImages] = useState([]);
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [crop, setCrop] = useState({
    unit: '%',
    width: 50,
    height: 50,
    x: 25,
    y: 25
  });
  const [completedCrop, setCompletedCrop] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outputFolder, setOutputFolder] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [processedCount, setProcessedCount] = useState(0);
  const [aspectRatioLocked, setAspectRatioLocked] = useState(false);
  const imgRef = useRef(null);

  React.useEffect(() => {
    if (window.electron && window.electron.onCropProgress) {
      window.electron.onCropProgress((data) => {
        setProgress(data.progress);
        setProcessedCount(data.processedCount);
      });
    }
  }, []);

  const handleSelectFolder = async () => {
    try {
      if (window.electron && window.electron.selectFolder) {
        const result = await window.electron.selectFolder();
        if (result.success && result.images.length > 0) {
          setSourceFolder(result.folderPath);
          setImages(result.images);
          
          const firstImagePath = result.images[0];
          const imageUrl = `file://${firstImagePath}`;
          setPreviewImage(imageUrl);
          setStep(STEPS.SELECT_FRAME);
        } else if (result.images.length === 0) {
          alert('No images found in selected folder. Please select a folder with images (jpg, jpeg, png, gif, bmp).');
        }
      } else {
        alert('Electron API not available. Please ensure you are running in Electron environment.');
      }
    } catch (err) {
      console.error('Error selecting folder:', err);
      alert('Failed to select folder. Please try again.');
    }
  };

  const handleSelectFrame = (frame) => {
    setSelectedFrame(frame);
    setCrop(frame.crop);
    setCompletedCrop(frame.crop);
    setAspectRatioLocked(frame.aspectRatio !== null);
    
    if (frame.id === 'custom') {
      setStep(STEPS.DEFINE_CROP);
    } else {
      setStep(STEPS.DEFINE_CROP);
    }
  };

  const handleCropComplete = (crop, percentCrop) => {
    setCompletedCrop(percentCrop);
  };

  const handleSelectOutputFolder = async () => {
    if (!completedCrop || completedCrop.width === 0 || completedCrop.height === 0) {
      alert('Please define a crop area first.');
      return;
    }

    try {
      if (window.electron && window.electron.selectOutputFolder) {
        const result = await window.electron.selectOutputFolder();
        if (result.success) {
          setOutputFolder(result.folderPath);
          await processBatchCrop(result.folderPath);
        }
      } else {
        alert('Electron API not available.');
      }
    } catch (err) {
      console.error('Error selecting output folder:', err);
      alert('Failed to select output folder. Please try again.');
    }
  };

  const processBatchCrop = async (outputPath) => {
    setStep(STEPS.PROCESSING);
    setProcessing(true);
    setProgress(0);
    setProcessedCount(0);

    try {
      if (window.electron && window.electron.cropImages) {
        const result = await window.electron.cropImages({
          images,
          crop: completedCrop,
          outputFolder: outputPath,
          shape: selectedFrame?.shape || 'rectangle',
          svgPath: selectedFrame?.svgPath || null
        });

        if (result.success) {
          setProcessedCount(result.processedCount);
          setProgress(100);
          setStep(STEPS.COMPLETE);
        } else {
          alert(`Crop failed: ${result.error || 'Unknown error'}`);
          setStep(STEPS.DEFINE_CROP);
        }
      }
    } catch (err) {
      console.error('Error processing batch crop:', err);
      alert('Failed to process images. Please try again.');
      setStep(STEPS.DEFINE_CROP);
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setStep(STEPS.SELECT_FOLDER);
    setSourceFolder('');
    setImages([]);
    setSelectedFrame(null);
    setCrop({ unit: '%', width: 50, height: 50, x: 25, y: 25 });
    setCompletedCrop(null);
    setProcessing(false);
    setProgress(0);
    setOutputFolder('');
    setPreviewImage(null);
    setProcessedCount(0);
    setAspectRatioLocked(false);
  };

  const handleBackToFrameSelection = () => {
    setStep(STEPS.SELECT_FRAME);
    setSelectedFrame(null);
  };

  const handleOpenOutputFolder = async () => {
    if (window.electron && window.electron.openFolder) {
      await window.electron.openFolder(outputFolder);
    }
  };

  return (
    <>
      <Header title="Batch Image Crop" showBack backTo="/dashboard" />
      
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Step 1: Select Folder */}
        {step === STEPS.SELECT_FOLDER && (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: '4rem', marginBottom: 24 }}>✂️</div>
            <h2 style={{ marginBottom: 16 }}>Batch Image Crop</h2>
            <p className="text-muted" style={{ marginBottom: 32, fontSize: '1.1rem' }}>
              Select a folder containing images to crop them all at once with the same crop frame.
            </p>
            <button 
              className="btn btn-primary" 
              onClick={handleSelectFolder}
              style={{ fontSize: '1.1rem', padding: '12px 32px' }}
            >
              📁 Select Image Folder
            </button>
          </div>
        )}

        {/* Step 2: Select Crop Frame */}
        {step === STEPS.SELECT_FRAME && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Select Crop Frame</h3>
            <p className="text-muted" style={{ marginBottom: 24 }}>
              {images.length} image{images.length !== 1 ? 's' : ''} found in <strong>{sourceFolder.split('/').pop()}</strong>. 
              Choose a predefined crop frame or create a custom one.
            </p>

            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: 20,
              marginBottom: 24
            }}>
              {CROP_FRAMES.map((frame) => (
                <button
                  key={frame.id}
                  type="button"
                  className="crop-frame-card card"
                  onClick={() => handleSelectFrame(frame)}
                >
                  <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>{frame.icon}</div>
                  
                  <div style={{
                    width: 100,
                    height: 100,
                    margin: '0 auto 16px',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <svg
                      width="100"
                      height="100"
                      viewBox="0 0 100 100"
                      style={{ filter: 'drop-shadow(0 4px 8px rgba(52, 152, 219, 0.4))' }}
                    >
                      <defs>
                        <linearGradient id={`grad-${frame.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style={{ stopColor: '#3498db', stopOpacity: 0.8 }} />
                          <stop offset="100%" style={{ stopColor: '#2ecc71', stopOpacity: 0.8 }} />
                        </linearGradient>
                      </defs>
                      {frame.svgPath ? (
                        <path
                          d={frame.svgPath}
                          fill={`url(#grad-${frame.id})`}
                          stroke="#3498db"
                          strokeWidth="2"
                        />
                      ) : (
                        <rect
                          x="10"
                          y="10"
                          width="80"
                          height={80 / (frame.aspectRatio || 1)}
                          rx="4"
                          fill={`url(#grad-${frame.id})`}
                          stroke="#3498db"
                          strokeWidth="2"
                        />
                      )}
                    </svg>
                  </div>

                  <h4 style={{ marginBottom: 8, fontSize: '1.05rem', fontWeight: '600' }}>
                    {frame.name}
                  </h4>
                  <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0, lineHeight: 1.3 }}>
                    {frame.description}
                  </p>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button 
                className="btn btn-secondary" 
                onClick={handleReset}
              >
                ← Back to Folder Selection
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Define Crop Area */}
        {step === STEPS.DEFINE_CROP && previewImage && selectedFrame && (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Define Crop Area</h3>
              <span style={{ 
                background: 'rgba(52, 152, 219, 0.2)', 
                color: 'var(--accent)',
                padding: '4px 12px',
                borderRadius: 16,
                fontSize: '0.85rem',
                fontWeight: '600'
              }}>
                {selectedFrame.icon} {selectedFrame.name}
              </span>
            </div>
            <p className="text-muted" style={{ marginBottom: 16 }}>
              {images.length} image{images.length !== 1 ? 's' : ''} found in folder. 
              {selectedFrame.id === 'custom' 
                ? ' Drag and resize the crop box to define your custom area.' 
                : ' Adjust the crop box position if needed. The aspect ratio is locked for this frame.'}
            </p>
            
            {selectedFrame.shape !== 'rectangle' && (
              <div style={{
                background: 'rgba(52, 152, 219, 0.15)',
                border: '1px solid rgba(52, 152, 219, 0.4)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 10
              }}>
                <span style={{ fontSize: '1.5rem' }}>{selectedFrame.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: 'var(--accent)' }}>
                    Shape Preview Active
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    The {selectedFrame.name.toLowerCase()} shape outline is shown on the crop area. 
                    This is how your images will be cropped.
                  </p>
                </div>
              </div>
            )}
            
            {selectedFrame.id === 'custom' && (
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: 'fit-content' }}>
                  <input
                    type="checkbox"
                    checked={aspectRatioLocked}
                    onChange={(e) => setAspectRatioLocked(e.target.checked)}
                  />
                  <span>Lock aspect ratio</span>
                </label>
              </div>
            )}

            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              marginBottom: 24,
              background: 'rgba(0,0,0,0.3)',
              padding: 24,
              borderRadius: 12,
              overflow: 'visible',
              maxHeight: '60vh',
              position: 'relative'
            }}>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  onComplete={handleCropComplete}
                  aspect={selectedFrame.aspectRatio || (aspectRatioLocked ? (crop.width / crop.height) : undefined)}
                  style={{ position: 'relative' }}
                >
                  <img
                    ref={imgRef}
                    src={previewImage}
                    alt="Preview"
                    style={{ maxWidth: '100%', maxHeight: '50vh', display: 'block' }}
                    onLoad={() => {
                      if (imgRef.current) {
                        imgRef.current.dataset.loaded = 'true';
                      }
                    }}
                    onError={(e) => {
                      console.error('Image load error');
                      e.target.src = images[0];
                    }}
                  />
                </ReactCrop>
                
                {selectedFrame.shape !== 'rectangle' && imgRef.current && imgRef.current.dataset.loaded && crop && crop.width > 0 && (
                  <div
                    className="shape-overlay"
                    style={{
                      position: 'absolute',
                      left: `${crop.x}%`,
                      top: `${crop.y}%`,
                      width: `${crop.width}%`,
                      height: `${crop.height}%`,
                      pointerEvents: 'none',
                      zIndex: 1000,
                      transform: 'translate(0, 0)'
                    }}
                  >
                    <svg
                      width="100%"
                      height="100%"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="xMidYMid meet"
                      style={{ 
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        overflow: 'visible'
                      }}
                    >
                      <defs>
                        <linearGradient id="shape-preview-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style={{ stopColor: '#3498db', stopOpacity: 0.4 }} />
                          <stop offset="100%" style={{ stopColor: '#2ecc71', stopOpacity: 0.4 }} />
                        </linearGradient>
                        <filter id="glow">
                          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                          <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                          </feMerge>
                        </filter>
                      </defs>
                      {selectedFrame.svgPath && (
                        <>
                          <path
                            d={selectedFrame.svgPath}
                            fill="url(#shape-preview-grad)"
                            stroke="#3498db"
                            strokeWidth="2"
                            strokeDasharray="8,4"
                            filter="url(#glow)"
                            style={{ 
                              animation: 'dash 20s linear infinite, pulse-glow 3s ease-in-out infinite'
                            }}
                          />
                          <text
                            x="50"
                            y="50"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="#fff"
                            fontSize="12"
                            fontWeight="bold"
                            style={{ 
                              textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                              pointerEvents: 'none'
                            }}
                          >
                            {selectedFrame.icon}
                          </text>
                        </>
                      )}
                    </svg>
                  </div>
                )}
              </div>
            </div>

            {completedCrop && (
              <div style={{ 
                background: 'rgba(52, 152, 219, 0.1)', 
                padding: 16, 
                borderRadius: 8, 
                marginBottom: 24,
                border: '1px solid rgba(52, 152, 219, 0.3)'
              }}>
                <p style={{ margin: 0, fontSize: '0.9rem', marginBottom: 8 }}>
                  <strong>Crop Area:</strong> {Math.round(completedCrop.width)}% × {Math.round(completedCrop.height)}% 
                  (Position: {Math.round(completedCrop.x)}%, {Math.round(completedCrop.y)}%)
                </p>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--accent)' }}>
                  <strong>Shape:</strong> {selectedFrame.icon} {selectedFrame.name}
                  {selectedFrame.shape !== 'rectangle' && ' (with transparent background)'}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button 
                className="btn btn-primary" 
                onClick={handleSelectOutputFolder}
                disabled={!completedCrop || completedCrop.width === 0 || completedCrop.height === 0}
                style={{ fontSize: '1rem', padding: '10px 24px' }}
              >
                ✂️ Crop All Images ({images.length})
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={handleBackToFrameSelection}
              >
                ← Change Frame
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={handleReset}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Processing */}
        {step === STEPS.PROCESSING && (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: 24 }}>⏳</div>
            <h3 style={{ marginBottom: 16 }}>Processing Images...</h3>
            <p className="text-muted" style={{ marginBottom: 24 }}>
              Please wait while we crop all images. This may take a few moments.
            </p>
            
            <div style={{ 
              width: '100%', 
              height: 32, 
              background: 'rgba(255,255,255,0.1)', 
              borderRadius: 16,
              overflow: 'hidden',
              marginBottom: 16
            }}>
              <div 
                style={{ 
                  width: `${progress}%`, 
                  height: '100%', 
                  background: 'linear-gradient(90deg, #3498db, #2ecc71)',
                  transition: 'width 0.3s ease',
                  borderRadius: 16
                }}
              />
            </div>
            
            <p style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--accent)' }}>
              {progress}% Complete
            </p>
            <p className="text-muted">
              {processedCount} of {images.length} images processed
            </p>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === STEPS.COMPLETE && (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: '4rem', marginBottom: 24 }}>✅</div>
            <h2 style={{ marginBottom: 16, color: '#2ecc71' }}>Crop Complete!</h2>
            <p className="text-muted" style={{ marginBottom: 8, fontSize: '1.1rem' }}>
              Successfully cropped <strong>{processedCount}</strong> image{processedCount !== 1 ? 's' : ''} 
              in <strong>{selectedFrame?.icon} {selectedFrame?.name}</strong> shape.
            </p>
            <p className="text-muted" style={{ marginBottom: 8 }}>
              Output folder: <strong>{outputFolder.split('/').pop()}</strong>
            </p>
            {selectedFrame?.shape !== 'rectangle' && (
              <p style={{ 
                marginBottom: 32, 
                fontSize: '0.9rem',
                color: 'var(--accent)',
                fontWeight: '600'
              }}>
                ℹ️ Images saved as PNG with transparent background
              </p>
            )}
            
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button 
                className="btn btn-primary" 
                onClick={handleOpenOutputFolder}
                style={{ fontSize: '1rem', padding: '10px 24px' }}
              >
                📂 Open Output Folder
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={handleReset}
                style={{ fontSize: '1rem', padding: '10px 24px' }}
              >
                ✂️ Crop More Images
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => navigate('/dashboard')}
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .ReactCrop {
          max-width: 100%;
        }
        .ReactCrop__crop-selection {
          border: 3px solid #3498db;
          box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
        }
        
        @keyframes dash {
          to {
            stroke-dashoffset: -100;
          }
        }
        
        @keyframes pulse-glow {
          0%, 100% {
            filter: drop-shadow(0 0 8px rgba(52, 152, 219, 0.6));
          }
          50% {
            filter: drop-shadow(0 0 16px rgba(52, 152, 219, 0.9));
          }
        }
        
        .crop-frame-card {
          text-align: center;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          border: 2px solid rgba(255,255,255,0.15);
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
          padding: 24px 20px;
          position: relative;
          overflow: hidden;
          backdrop-filter: blur(10px);
        }
        .crop-frame-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(52, 152, 219, 0.3), transparent);
          transition: left 0.6s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .crop-frame-card:hover::before {
          left: 100%;
        }
        .crop-frame-card::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 2px;
          background: linear-gradient(135deg, rgba(52, 152, 219, 0.5), rgba(46, 204, 113, 0.5));
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.3s;
        }
        .crop-frame-card:hover::after {
          opacity: 1;
        }
        .crop-frame-card:hover {
          transform: translateY(-8px) scale(1.03);
          border-color: rgba(52, 152, 219, 0.8);
          background: linear-gradient(135deg, rgba(52, 152, 219, 0.15) 0%, rgba(46, 204, 113, 0.1) 100%);
          box-shadow: 0 16px 32px rgba(52, 152, 219, 0.4), 0 0 40px rgba(52, 152, 219, 0.2);
        }
        .crop-frame-card:active {
          transform: translateY(-4px) scale(1.01);
        }
        .crop-frame-card svg {
          transition: transform 0.3s ease;
        }
        .crop-frame-card:hover svg {
          transform: scale(1.1) rotate(5deg);
        }
      `}</style>
    </>
  );
}
