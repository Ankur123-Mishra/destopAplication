import React, { useState, useRef, useId, useLayoutEffect, useCallback, useMemo } from 'react';
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
    /* Unit square in 0–100 space; mask transform matches other frames so dim/overlay look identical */
    svgPath: 'M 0 0 L 100 0 L 100 100 L 0 100 Z'
  },
  {
    id: 'rounded-rectangle',
    name: 'Rounded Rectangle',
    icon: '▢',
    description: 'Rectangle with smooth rounded corners',
    shape: 'rounded-rectangle',
    aspectRatio: 4 / 5,
    crop: { unit: '%', width: 45, height: 56, x: 27.5, y: 22 },
    // Keep frame boundary near crop-selection bounds so resize handles stay visually attached.
    svgPath: 'M 12 0 H 88 Q 100 0 100 12 V 88 Q 100 100 88 100 H 12 Q 0 100 0 88 V 12 Q 0 0 12 0 Z'
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

const PX_PER_INCH_REF = 96;

const FRAME_SIZE_UNITS = [
  { value: 'mm', label: 'mm' },
  { value: 'px', label: 'px (pixels)' },
  { value: 'cm', label: 'cm' },
  { value: 'inch', label: 'inch' }
];

function pxToInch(px) {
  return px / PX_PER_INCH_REF;
}

function inchToPx(inch) {
  return inch * PX_PER_INCH_REF;
}

function pxToMm(px) {
  return pxToInch(px) * 25.4;
}

function mmToPx(mm) {
  return inchToPx(mm / 25.4);
}

function pxToCm(px) {
  return pxToMm(px) / 10;
}

function cmToPx(cm) {
  return mmToPx(cm * 10);
}

function roundForUnitDisplay(val, unit) {
  if (!Number.isFinite(val)) return 0;
  switch (unit) {
    case 'px':
      return Math.round(val * 10) / 10;
    case 'mm':
      return Math.round(val * 100) / 100;
    case 'cm':
      return Math.round(val * 1000) / 1000;
    case 'inch':
      return Math.round(val * 10000) / 10000;
    default:
      return val;
  }
}

function getFrameSizeStep(unit) {
  switch (unit) {
    case 'px':
      return 1;
    case 'mm':
      return 0.1;
    case 'cm':
      return 0.01;
    case 'inch':
      return 0.001;
    default:
      return 0.1;
  }
}

export default function BatchImageCrop() {
  const navigate = useNavigate();
  const isElectronAvailable = Boolean(window.electron);
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
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [croppedImages, setCroppedImages] = useState([]);
  const imgRef = useRef(null);
  const cropMediaWrapperRef = useRef(null);
  const outputFolderPromiseRef = useRef(null);
  const saveBufferRef = useRef(new Map());
  const saveDrainTimeoutRef = useRef(null);
  const activeSavesRef = useRef(0);
  const saveCompletionResolversRef = useRef([]);
  const preloadedImageUrlsRef = useRef(new Set());
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [displayedImageSize, setDisplayedImageSize] = useState({ width: 0, height: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [fixedOutputSizePx, setFixedOutputSizePx] = useState({ width: 0, height: 0 });
  const [frameSizeUnit, setFrameSizeUnit] = useState('mm');
  const [frameWidthInputDraft, setFrameWidthInputDraft] = useState(null);
  const [frameHeightInputDraft, setFrameHeightInputDraft] = useState(null);
  const [lockedPixelAspect, setLockedPixelAspect] = useState(null);
  /** manual: one image at a time (C / Next). auto: same crop applied to all images immediately. */
  const [cropMode, setCropMode] = useState('manual');
  const autoBatchStartedRef = useRef(false);
  const autoCropCancelledRef = useRef(false);
  const cropRef = useRef(crop);
  const displayedImageSizeRef = useRef(displayedImageSize);
  const shapeDimMaskId = `sdm-${useId().replace(/:/g, '')}`;

  cropRef.current = crop;
  displayedImageSizeRef.current = displayedImageSize;

  const computePixelAspect = useCallback((c, disp) => {
    if (!c || c.width <= 0 || c.height <= 0 || !disp?.width || !disp?.height) return undefined;
    return (c.width / c.height) * (disp.width / disp.height);
  }, []);

  const MIN_CROP_PCT = 0.5;
  const RESTORE_CROP_PCT = 12;

  const sanitizePercentCrop = useCallback((percentCrop) => {
    if (!percentCrop || percentCrop.unit !== '%') {
      return percentCrop;
    }
    let w = Number(percentCrop.width);
    let h = Number(percentCrop.height);
    let x = Number(percentCrop.x);
    let y = Number(percentCrop.y);
    if (!Number.isFinite(w)) w = 0;
    if (!Number.isFinite(h)) h = 0;
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;

    if (w <= 0 && h <= 0) {
      const size = Math.min(100, Math.max(MIN_CROP_PCT, RESTORE_CROP_PCT));
      return {
        unit: '%',
        width: size,
        height: size,
        x: (100 - size) / 2,
        y: (100 - size) / 2
      };
    }
    if (w <= 0) w = MIN_CROP_PCT;
    if (h <= 0) h = MIN_CROP_PCT;

    w = Math.min(100, Math.max(MIN_CROP_PCT, w));
    h = Math.min(100, Math.max(MIN_CROP_PCT, h));
    x = Math.max(0, Math.min(x, 100 - w));
    y = Math.max(0, Math.min(y, 100 - h));
    return { unit: '%', width: w, height: h, x, y };
  }, []);

  const updateDisplayedImageSize = useCallback(() => {
    const el = cropMediaWrapperRef.current || imgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      setDisplayedImageSize({ width: r.width, height: r.height });
    }
  }, []);

  useLayoutEffect(() => {
    if (step !== STEPS.DEFINE_CROP) return undefined;
    const el = cropMediaWrapperRef.current || imgRef.current;
    if (!el) return undefined;
    updateDisplayedImageSize();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const ro = new ResizeObserver(() => updateDisplayedImageSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, previewImage, updateDisplayedImageSize]);

  React.useEffect(() => {
    setImageNaturalSize({ width: 0, height: 0 });
  }, [previewImage]);

  useLayoutEffect(() => {
    if (step !== STEPS.DEFINE_CROP || !previewImage) return;
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
      setImageNaturalSize({ width: el.naturalWidth, height: el.naturalHeight });
    }
  }, [previewImage, step]);

  React.useEffect(() => {
    setFrameWidthInputDraft(null);
    setFrameHeightInputDraft(null);
  }, [frameSizeUnit, previewImage]);

  React.useEffect(() => {
    if (step !== STEPS.DEFINE_CROP) return;
    if (!imageNaturalSize.width || !imageNaturalSize.height) return;
    if (fixedOutputSizePx.width > 0 && fixedOutputSizePx.height > 0) return;

    const defaultWidthPx = (crop.width / 100) * imageNaturalSize.width;
    const defaultHeightPx = (crop.height / 100) * imageNaturalSize.height;
    if (!Number.isFinite(defaultWidthPx) || !Number.isFinite(defaultHeightPx)) return;
    if (defaultWidthPx <= 0 || defaultHeightPx <= 0) return;

    setFixedOutputSizePx({ width: defaultWidthPx, height: defaultHeightPx });
  }, [step, imageNaturalSize, crop.width, crop.height, fixedOutputSizePx.width, fixedOutputSizePx.height]);

  const frameDisplayDims = useMemo(() => {
    const wPx = fixedOutputSizePx.width;
    const hPx = fixedOutputSizePx.height;
    if (!wPx || !hPx) {
      return { w: 0, h: 0 };
    }
    switch (frameSizeUnit) {
      case 'px':
        return { w: wPx, h: hPx };
      case 'mm':
        return { w: pxToMm(wPx), h: pxToMm(hPx) };
      case 'cm':
        return { w: pxToCm(wPx), h: pxToCm(hPx) };
      case 'inch':
        return { w: pxToInch(wPx), h: pxToInch(hPx) };
      default:
        return { w: pxToMm(wPx), h: pxToMm(hPx) };
    }
  }, [fixedOutputSizePx.width, fixedOutputSizePx.height, frameSizeUnit]);

  const frameUnitLabel = frameSizeUnit === 'inch' ? 'in' : frameSizeUnit;

  const handleCropDragStart = useCallback(() => {
    const ar = computePixelAspect(cropRef.current, displayedImageSizeRef.current);
    setLockedPixelAspect(typeof ar === 'number' && Number.isFinite(ar) ? ar : null);
  }, [computePixelAspect]);

  const handleCropDragEnd = useCallback(() => {
    setLockedPixelAspect(null);
  }, []);

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
        alert('This tool only works inside the desktop app window. Open it from Electron, not from the browser tab.');
      }
    } catch (err) {
      console.error('Error selecting folder:', err);
      alert('Failed to select folder. Please try again.');
    }
  };

  const handleSelectFrame = (frame) => {
    autoCropCancelledRef.current = false;
    autoBatchStartedRef.current = false;
    setSelectedFrame(frame);
    setCrop(frame.crop);
    setCompletedCrop(frame.crop);
    setAspectRatioLocked(false);
    setCurrentImageIndex(0);
    
    const firstImagePath = images[0];
    const imageUrl = `file://${firstImagePath}`;
    setPreviewImage(imageUrl);
    
    setStep(STEPS.DEFINE_CROP);
  };

  const handleCropChange = (_pixelCrop, percentCrop) => {
    const next = sanitizePercentCrop(percentCrop);
    setCrop(next);
  };

  const handleCropComplete = (_pixelCrop, percentCrop) => {
    const next = sanitizePercentCrop(percentCrop);
    setCompletedCrop(next);
    setCrop(next);
  };

  const applyCropBoxSize = useCallback((prevCrop, width, height) => {
    const w = Math.min(100, Math.max(0.5, width));
    const h = Math.min(100, Math.max(0.5, height));
    const cx = prevCrop.x + prevCrop.width / 2;
    const cy = prevCrop.y + prevCrop.height / 2;
    let x = cx - w / 2;
    let y = cy - h / 2;
    x = Math.max(0, Math.min(x, 100 - w));
    y = Math.max(0, Math.min(y, 100 - h));
    return { unit: '%', width: w, height: h, x, y };
  }, []);

  const syncCropBoxToFixedOutputSize = useCallback((nextSizePx) => {
    if (!imageNaturalSize.width || !imageNaturalSize.height) return;
    const widthPx = Number(nextSizePx?.width);
    const heightPx = Number(nextSizePx?.height);
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) return;

    let widthPct = (widthPx / imageNaturalSize.width) * 100;
    let heightPct = (heightPx / imageNaturalSize.height) * 100;
    if (!Number.isFinite(widthPct) || !Number.isFinite(heightPct) || widthPct <= 0 || heightPct <= 0) return;

    // Keep requested ratio and fit inside image bounds.
    const fitScale = Math.min(100 / widthPct, 100 / heightPct, 1);
    widthPct *= fitScale;
    heightPct *= fitScale;

    const nextCrop = applyCropBoxSize(cropRef.current, widthPct, heightPct);
    setCrop(nextCrop);
    setCompletedCrop(nextCrop);
  }, [imageNaturalSize.width, imageNaturalSize.height, applyCropBoxSize]);

  const convertDisplaySizeToPx = (value, unit) => {
    switch (unit) {
      case 'px':
        return value;
      case 'mm':
        return mmToPx(value);
      case 'cm':
        return cmToPx(value);
      case 'inch':
        return inchToPx(value);
      default:
        return null;
    }
  };

  const handleFrameWidthChange = (raw) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    const widthPx = convertDisplaySizeToPx(v, frameSizeUnit);
    if (!Number.isFinite(widthPx) || widthPx <= 0) return;
    const nextSize = { width: widthPx, height: fixedOutputSizePx.height };
    setFixedOutputSizePx(nextSize);
    syncCropBoxToFixedOutputSize(nextSize);
  };

  const handleFrameHeightChange = (raw) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    const heightPx = convertDisplaySizeToPx(v, frameSizeUnit);
    if (!Number.isFinite(heightPx) || heightPx <= 0) return;
    const nextSize = { width: fixedOutputSizePx.width, height: heightPx };
    setFixedOutputSizePx(nextSize);
    syncCropBoxToFixedOutputSize(nextSize);
  };

  const bumpFrameWidth = (direction) => {
    if (!imageNaturalSize.width) return;
    const step = getFrameSizeStep(frameSizeUnit);
    const raw =
      frameWidthInputDraft !== null
        ? frameWidthInputDraft
        : String(roundForUnitDisplay(frameDisplayDims.w, frameSizeUnit));
    let n = parseFloat(raw);
    if (!Number.isFinite(n)) n = step;
    n += direction * step;
    const floor = Math.max(step / 1000, 1e-9);
    if (n <= 0) n = floor;
    n = roundForUnitDisplay(n, frameSizeUnit);
    handleFrameWidthChange(String(n));
    setFrameWidthInputDraft(null);
  };

  const bumpFrameHeight = (direction) => {
    if (!imageNaturalSize.height) return;
    const step = getFrameSizeStep(frameSizeUnit);
    const raw =
      frameHeightInputDraft !== null
        ? frameHeightInputDraft
        : String(roundForUnitDisplay(frameDisplayDims.h, frameSizeUnit));
    let n = parseFloat(raw);
    if (!Number.isFinite(n)) n = step;
    n += direction * step;
    const floor = Math.max(step / 1000, 1e-9);
    if (n <= 0) n = floor;
    n = roundForUnitDisplay(n, frameSizeUnit);
    handleFrameHeightChange(String(n));
    setFrameHeightInputDraft(null);
  };

  const fixedOutputAspect = useMemo(() => {
    if (!fixedOutputSizePx.width || !fixedOutputSizePx.height) return null;
    if (!displayedImageSize.width || !displayedImageSize.height) return null;
    if (!imageNaturalSize.width || !imageNaturalSize.height) return null;
    const sourceAspect = fixedOutputSizePx.width / fixedOutputSizePx.height;
    return sourceAspect
      * (displayedImageSize.width / displayedImageSize.height)
      * (imageNaturalSize.height / imageNaturalSize.width);
  }, [fixedOutputSizePx.width, fixedOutputSizePx.height, displayedImageSize.width, displayedImageSize.height, imageNaturalSize.width, imageNaturalSize.height]);

  const reactCropAspect = lockedPixelAspect ?? fixedOutputAspect ?? computePixelAspect(crop, displayedImageSize);

  const frameWidthFieldValue =
    frameWidthInputDraft !== null
      ? frameWidthInputDraft
      : String(roundForUnitDisplay(frameDisplayDims.w, frameSizeUnit));
  const frameHeightFieldValue =
    frameHeightInputDraft !== null
      ? frameHeightInputDraft
      : String(roundForUnitDisplay(frameDisplayDims.h, frameSizeUnit));

  const ensureOutputFolderReady = async () => {
    if (outputFolder) return outputFolder;
    if (outputFolderPromiseRef.current) {
      return outputFolderPromiseRef.current;
    }
    if (!(window.electron && window.electron.createCropOutputFolder)) {
      throw new Error('This tool only works inside the desktop app window.');
    }
    outputFolderPromiseRef.current = (async () => {
      const result = await window.electron.createCropOutputFolder(sourceFolder);
      if (!result.success || !result.folderPath) {
        throw new Error(result.error || 'Failed to create output folder');
      }
      setOutputFolder(result.folderPath);
      return result.folderPath;
    })();
    try {
      return await outputFolderPromiseRef.current;
    } catch (error) {
      outputFolderPromiseRef.current = null;
      throw error;
    }
  };

  const saveCroppedImageAtIndex = async (imageIndex, cropData) => {
    const imagePath = images[imageIndex];
    if (!imagePath || !cropData || cropData.width === 0 || cropData.height === 0) {
      throw new Error('Invalid image or crop area.');
    }

    const outputPath = await ensureOutputFolderReady();
    const result = await window.electron.cropImagesIndividually({
      images: [{ imagePath, crop: cropData }],
      outputFolder: outputPath,
      shape: selectedFrame?.shape || 'rectangle',
      svgPath: selectedFrame?.svgPath || null,
      outputSize: fixedOutputSizePx
    });
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to save cropped image.');
    }
  };

  const saveCroppedImageBatch = async (batchItems) => {
    if (!batchItems || batchItems.length === 0) return;
    const outputPath = await ensureOutputFolderReady();
    const payloadImages = [];
    for (const item of batchItems) {
      const imagePath = images[item.imageIndex];
      const cropData = item.cropData;
      if (!imagePath || !cropData || cropData.width === 0 || cropData.height === 0) {
        continue;
      }
      payloadImages.push({ imagePath, crop: cropData });
    }
    if (payloadImages.length === 0) return;

    const result = await window.electron.cropImagesIndividually({
      images: payloadImages,
      outputFolder: outputPath,
      shape: selectedFrame?.shape || 'rectangle',
      svgPath: selectedFrame?.svgPath || null,
      outputSize: fixedOutputSizePx
    });
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to save cropped images.');
    }
  };

  const resolveSaveWaitersIfIdle = () => {
    if (activeSavesRef.current !== 0 || saveBufferRef.current.size !== 0) return;
    const waiters = saveCompletionResolversRef.current;
    saveCompletionResolversRef.current = [];
    waiters.forEach((resolve) => resolve());
  };

  const waitForAllSaves = () => new Promise((resolve) => {
    if (activeSavesRef.current === 0 && saveBufferRef.current.size === 0) {
      resolve();
      return;
    }
    saveCompletionResolversRef.current.push(resolve);
  });

  const runSaveDrain = () => {
    saveDrainTimeoutRef.current = null;
    const maxParallelSaves = selectedFrame?.shape === 'rectangle' ? 4 : 3;
    const batchSize = selectedFrame?.shape === 'rectangle' ? 3 : 2;

    while (activeSavesRef.current < maxParallelSaves && saveBufferRef.current.size > 0) {
      const batchItems = [];
      const pendingEntries = Array.from(saveBufferRef.current.entries()).slice(0, batchSize);
      if (pendingEntries.length === 0) break;
      pendingEntries.forEach(([imageIndex, cropData]) => {
        saveBufferRef.current.delete(imageIndex);
        batchItems.push({ imageIndex, cropData });
      });

      activeSavesRef.current += 1;
      setPendingSaveCount((count) => count + 1);
      saveCroppedImageBatch(batchItems)
        .catch((error) => {
          console.error('Failed to save cropped image batch:', error);
        })
        .finally(() => {
          activeSavesRef.current = Math.max(0, activeSavesRef.current - 1);
          setPendingSaveCount((count) => Math.max(0, count - 1));
          if (saveBufferRef.current.size > 0 && !saveDrainTimeoutRef.current) {
            saveDrainTimeoutRef.current = window.setTimeout(runSaveDrain, 10);
          }
          resolveSaveWaitersIfIdle();
        });
    }

    if (saveBufferRef.current.size > 0 && !saveDrainTimeoutRef.current) {
      saveDrainTimeoutRef.current = window.setTimeout(runSaveDrain, 10);
    }
    resolveSaveWaitersIfIdle();
  };

  const scheduleImageSave = (imageIndex, cropData) => {
    saveBufferRef.current.set(imageIndex, cropData);
    if (saveDrainTimeoutRef.current) return;
    const launchDelayMs = 0;
    saveDrainTimeoutRef.current = window.setTimeout(runSaveDrain, launchDelayMs);
  };

  const preloadImageAtIndex = React.useCallback((index) => {
    const imagePath = images[index];
    if (!imagePath) return;
    const imageUrl = `file://${imagePath}`;
    if (preloadedImageUrlsRef.current.has(imageUrl)) return;
    const img = new Image();
    preloadedImageUrlsRef.current.add(imageUrl);
    img.src = imageUrl;
  }, [images]);

  React.useEffect(() => {
    if (step !== STEPS.DEFINE_CROP || images.length === 0) return;
    preloadImageAtIndex(currentImageIndex + 1);
  }, [step, currentImageIndex, images.length, preloadImageAtIndex]);

  React.useEffect(() => {
    if (step !== STEPS.DEFINE_CROP || !sourceFolder || outputFolder) return;
    ensureOutputFolderReady().catch((error) => {
      console.error('Failed to pre-create output folder:', error);
    });
  }, [step, sourceFolder, outputFolder]);

  React.useEffect(() => {
    if (cropMode !== 'auto' || step !== STEPS.DEFINE_CROP) return;
    if (autoBatchStartedRef.current) return;
    if (!completedCrop || completedCrop.width === 0 || completedCrop.height === 0) return;
    if (!imageNaturalSize.width || !imageNaturalSize.height) return;
    if (!fixedOutputSizePx.width || !fixedOutputSizePx.height) return;
    if (images.length === 0) return;

    autoBatchStartedRef.current = true;

    const cropSnapshot = {
      unit: '%',
      width: completedCrop.width,
      height: completedCrop.height,
      x: completedCrop.x,
      y: completedCrop.y
    };

    const allCropped = images.map((imagePath) => ({ imagePath, crop: cropSnapshot }));
    setCroppedImages(allCropped);
    setProcessing(true);

    (async () => {
      try {
        if (saveDrainTimeoutRef.current) {
          window.clearTimeout(saveDrainTimeoutRef.current);
          saveDrainTimeoutRef.current = null;
        }
        // Visually step through images while we queue all saves.
        for (let i = 0; i < images.length; i += 1) {
          if (autoCropCancelledRef.current) return;

          // Update UI to show current image.
          setCurrentImageIndex(i);
          const imagePath = images[i];
          if (imagePath) {
            setPreviewImage(`file://${imagePath}`);
          }

          // Queue save for this image.
          scheduleImageSave(i, cropSnapshot);

          // Small delay so the user can see images change.
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        runSaveDrain();
        await waitForAllSaves();
        if (autoCropCancelledRef.current) return;
        setProcessedCount(images.length);
        setProgress(100);
        setStep(STEPS.COMPLETE);
      } catch (err) {
        console.error('Auto batch crop failed:', err);
        if (!autoCropCancelledRef.current) {
          autoBatchStartedRef.current = false;
          alert(err?.message || 'Auto crop failed. Please try again.');
        }
      } finally {
        setProcessing(false);
      }
    })();
  }, [
    cropMode,
    step,
    completedCrop,
    imageNaturalSize.width,
    imageNaturalSize.height,
    fixedOutputSizePx.width,
    fixedOutputSizePx.height,
    images,
    selectedFrame?.id,
    previewImage
  ]);

  const handleNextImage = async () => {
    if (!completedCrop || completedCrop.width === 0 || completedCrop.height === 0) {
      alert('Please define a crop area for this image first.');
      return;
    }

    const updatedCroppedImages = [...croppedImages];
    const cropSnapshot = {
      unit: '%',
      width: completedCrop.width,
      height: completedCrop.height,
      x: completedCrop.x,
      y: completedCrop.y
    };
    updatedCroppedImages[currentImageIndex] = {
      imagePath: images[currentImageIndex],
      crop: cropSnapshot
    };
    setCroppedImages(updatedCroppedImages);

    if (currentImageIndex < images.length - 1) {
      const nextIndex = currentImageIndex + 1;
      setCurrentImageIndex(nextIndex);
      
      const nextImagePath = images[nextIndex];
      const imageUrl = `file://${nextImagePath}`;
      setPreviewImage(imageUrl);
      
      if (updatedCroppedImages[nextIndex]) {
        setCrop(updatedCroppedImages[nextIndex].crop);
        setCompletedCrop(updatedCroppedImages[nextIndex].crop);
      } else {
        const newCrop = {
          unit: '%',
          width: cropSnapshot.width,
          height: cropSnapshot.height,
          x: cropSnapshot.x,
          y: cropSnapshot.y
        };
        setCrop(newCrop);
        setCompletedCrop(newCrop);
      }
      scheduleImageSave(currentImageIndex, cropSnapshot);
    } else {
      scheduleImageSave(currentImageIndex, cropSnapshot);
      alert('All images have been cropped. Please click Save & Finish to complete.');
    }
  };

  const handlePreviousImage = () => {
    if (currentImageIndex > 0) {
      const prevIndex = currentImageIndex - 1;
      setCurrentImageIndex(prevIndex);
      
      const prevImagePath = images[prevIndex];
      const imageUrl = `file://${prevImagePath}`;
      setPreviewImage(imageUrl);
      
      if (croppedImages[prevIndex]) {
        setCrop(croppedImages[prevIndex].crop);
        setCompletedCrop(croppedImages[prevIndex].crop);
      }
    }
  };

  const handleSkipImage = () => {
    if (currentImageIndex < images.length - 1) {
      const nextIndex = currentImageIndex + 1;
      setCurrentImageIndex(nextIndex);
      
      const nextImagePath = images[nextIndex];
      const imageUrl = `file://${nextImagePath}`;
      setPreviewImage(imageUrl);
      
      if (croppedImages[nextIndex]) {
        setCrop(croppedImages[nextIndex].crop);
        setCompletedCrop(croppedImages[nextIndex].crop);
      } else {
        const newCrop = {
          ...completedCrop,
          width: completedCrop.width,
          height: completedCrop.height
        };
        setCrop(newCrop);
        setCompletedCrop(newCrop);
      }
    }
  };

  const handleSelectOutputFolder = async () => {
    if (!completedCrop || completedCrop.width === 0 || completedCrop.height === 0) {
      alert('Please define a crop area for this image first.');
      return;
    }

    setProcessing(true);

    const updatedCroppedImages = [...croppedImages];
    const cropSnapshot = {
      unit: '%',
      width: completedCrop.width,
      height: completedCrop.height,
      x: completedCrop.x,
      y: completedCrop.y
    };
    updatedCroppedImages[currentImageIndex] = {
      imagePath: images[currentImageIndex],
      crop: cropSnapshot
    };
    setCroppedImages(updatedCroppedImages);
    try {
      if (saveDrainTimeoutRef.current) {
        window.clearTimeout(saveDrainTimeoutRef.current);
        saveDrainTimeoutRef.current = null;
      }
      scheduleImageSave(currentImageIndex, cropSnapshot);
      runSaveDrain();
      await waitForAllSaves();
      const totalSaved = updatedCroppedImages.filter(img => img).length;
      setProcessedCount(totalSaved);
      setProgress(100);
      setStep(STEPS.COMPLETE);
    } catch (err) {
      console.error('Error saving final cropped image:', err);
      alert(err?.message || 'Failed to save image. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  React.useEffect(() => {
    if (step !== STEPS.DEFINE_CROP || cropMode !== 'manual') return undefined;
    const onKeyDown = (e) => {
      const targetTag = e.target?.tagName;
      const isTypingTarget =
        targetTag === 'INPUT' ||
        targetTag === 'TEXTAREA' ||
        targetTag === 'SELECT' ||
        e.target?.isContentEditable;
      if (isTypingTarget) return;
      if (e.key?.toLowerCase() !== 'c') return;
      if (processing) return;
      e.preventDefault();
      handleNextImage();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cropMode, step, processing, currentImageIndex, images.length, completedCrop, croppedImages, outputFolder, selectedFrame, sourceFolder]);

  const processBatchCrop = async (outputPath, imagesToCrop) => {
    setStep(STEPS.PROCESSING);
    setProcessing(true);
    setProgress(0);
    setProcessedCount(0);

    try {
      if (window.electron && window.electron.cropImagesIndividually) {
        const validImages = imagesToCrop.filter(img => img);
        
        const result = await window.electron.cropImagesIndividually({
          images: validImages,
          outputFolder: outputPath,
          shape: selectedFrame?.shape || 'rectangle',
          svgPath: selectedFrame?.svgPath || null,
          outputSize: fixedOutputSizePx
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
    setCurrentImageIndex(0);
    setCroppedImages([]);
    setPendingSaveCount(0);
    outputFolderPromiseRef.current = null;
    saveBufferRef.current.clear();
    if (saveDrainTimeoutRef.current) {
      window.clearTimeout(saveDrainTimeoutRef.current);
      saveDrainTimeoutRef.current = null;
    }
    activeSavesRef.current = 0;
    saveCompletionResolversRef.current = [];
    preloadedImageUrlsRef.current = new Set();
    setImageNaturalSize({ width: 0, height: 0 });
    setFixedOutputSizePx({ width: 0, height: 0 });
    setFrameSizeUnit('mm');
    setFrameWidthInputDraft(null);
    setFrameHeightInputDraft(null);
    setCropMode('manual');
    autoCropCancelledRef.current = true;
    autoBatchStartedRef.current = false;
  };

  const handleBackToFrameSelection = () => {
    autoCropCancelledRef.current = true;
    autoBatchStartedRef.current = false;
    setStep(STEPS.SELECT_FRAME);
    setSelectedFrame(null);
    setCurrentImageIndex(0);
    setCroppedImages([]);
    saveBufferRef.current.clear();
    if (saveDrainTimeoutRef.current) {
      window.clearTimeout(saveDrainTimeoutRef.current);
      saveDrainTimeoutRef.current = null;
    }
    activeSavesRef.current = 0;
    saveCompletionResolversRef.current = [];
    preloadedImageUrlsRef.current = new Set();
    setFixedOutputSizePx({ width: 0, height: 0 });
    setFrameWidthInputDraft(null);
    setFrameHeightInputDraft(null);
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
            {!isElectronAvailable && (
              <div
                style={{
                  maxWidth: 640,
                  margin: '0 auto 24px',
                  padding: 16,
                  borderRadius: 10,
                  background: 'rgba(248, 113, 113, 0.12)',
                  border: '1px solid rgba(248, 113, 113, 0.3)',
                  color: '#fecaca',
                  textAlign: 'left'
                }}
              >
                <strong style={{ display: 'block', marginBottom: 8 }}>Desktop app required</strong>
                <div style={{ fontSize: '0.95rem', lineHeight: 1.5 }}>
                  Folder selection and output-folder creation use Electron APIs, so this page will not work in a normal
                  browser tab at <code>localhost:5173</code>. Open the same screen from the Electron desktop app window.
                </div>
              </div>
            )}
            <button 
              className="btn btn-primary" 
              onClick={handleSelectFolder}
              disabled={!isElectronAvailable}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
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
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}
              >
                Crop mode
                <select
                  value={cropMode}
                  onChange={(e) => setCropMode(e.target.value)}
                  disabled={processing}
                  style={{
                    minWidth: 240,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(0,0,0,0.35)',
                    color: 'inherit',
                    opacity: processing ? 0.6 : 1
                  }}
                >
                  <option value="manual">Manual — review each image (C key or Next)</option>
                  <option value="auto">Auto — same crop for every image, save all at once</option>
                </select>
              </label>
            </div>
            {cropMode === 'auto' && (
              <p
                className="text-muted"
                style={{
                  marginBottom: 16,
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: 'rgba(46, 204, 113, 0.08)',
                  border: '1px solid rgba(46, 204, 113, 0.25)',
                  fontSize: '0.95rem'
                }}
              >
                {processing
                  ? 'Cropping and saving all images…'
                  : 'Loading the first image, then all images will be cropped with the same area automatically.'}
              </p>
            )}
            <div
              style={{
                marginBottom: 20,
                padding: '14px 16px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.12)'
              }}
            >
              <p style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 600 }}>
                Frame size
              </p>
              <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  Unit
                  <select
                    value={frameSizeUnit}
                    onChange={(e) => setFrameSizeUnit(e.target.value)}
                    disabled={cropMode === 'auto'}
                    style={{
                      minWidth: 200,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(0,0,0,0.35)',
                      color: 'inherit',
                      opacity: cropMode === 'auto' ? 0.6 : 1
                    }}
                  >
                    {FRAME_SIZE_UNITS.map((u) => (
                      <option
                        key={u.value}
                        value={u.value}
                        disabled={!imageNaturalSize.width || !imageNaturalSize.height}
                      >
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>
                {(!imageNaturalSize.width || !imageNaturalSize.height) && (
                  <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                    Loading image dimensions…
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem' }}>
                  {`Width (${frameUnitLabel})`}
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={frameWidthFieldValue}
                    onFocus={() => {
                      setFrameWidthInputDraft(
                        String(roundForUnitDisplay(frameDisplayDims.w, frameSizeUnit))
                      );
                    }}
                    onChange={(e) => setFrameWidthInputDraft(e.target.value)}
                    onBlur={() => {
                      const raw = frameWidthInputDraft;
                      setFrameWidthInputDraft(null);
                      if (raw === null) return;
                      const t = String(raw).trim();
                      if (t === '') return;
                      handleFrameWidthChange(t);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                        return;
                      }
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        bumpFrameWidth(e.key === 'ArrowUp' ? 1 : -1);
                      }
                    }}
                    disabled={cropMode === 'auto' || !imageNaturalSize.width || !imageNaturalSize.height}
                    style={{
                      width: 120,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(0,0,0,0.25)',
                      color: 'inherit',
                      outline: 'none',
                      opacity: cropMode === 'auto' || !imageNaturalSize.width || !imageNaturalSize.height ? 0.5 : 1
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem' }}>
                  {`Height (${frameUnitLabel})`}
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={frameHeightFieldValue}
                    onFocus={() => {
                      setFrameHeightInputDraft(
                        String(roundForUnitDisplay(frameDisplayDims.h, frameSizeUnit))
                      );
                    }}
                    onChange={(e) => setFrameHeightInputDraft(e.target.value)}
                    onBlur={() => {
                      const raw = frameHeightInputDraft;
                      setFrameHeightInputDraft(null);
                      if (raw === null) return;
                      const t = String(raw).trim();
                      if (t === '') return;
                      handleFrameHeightChange(t);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                        return;
                      }
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        bumpFrameHeight(e.key === 'ArrowUp' ? 1 : -1);
                      }
                    }}
                    disabled={cropMode === 'auto' || !imageNaturalSize.width || !imageNaturalSize.height}
                    style={{
                      width: 120,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(0,0,0,0.25)',
                      color: 'inherit',
                      outline: 'none',
                      opacity: cropMode === 'auto' || !imageNaturalSize.width || !imageNaturalSize.height ? 0.5 : 1
                    }}
                  />
                </label>
              </div>
            </div>
            
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
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 20,
              flexWrap: 'wrap',
              width: '100%',
              marginBottom: 24,
              background: 'rgba(0,0,0,0.3)',
              padding: 24,
              borderRadius: 12,
              overflow: 'visible',
              maxHeight: '80vh',
              position: 'relative'
            }}>
              <div style={{ flex: '1 1 auto', minWidth: 0, textAlign: 'center' }}>
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => handleCropChange(_, percentCrop)}
                  onComplete={handleCropComplete}
                  onDragStart={handleCropDragStart}
                  onDragEnd={handleCropDragEnd}
                  aspect={reactCropAspect}
                  minWidth={1}
                  minHeight={1}
                  locked={cropMode === 'auto'}
                  style={{ position: 'relative' }}
                  className={selectedFrame.svgPath ? 'shape-frame-crop' : ''}
                >
                  <div
                    ref={cropMediaWrapperRef}
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      lineHeight: 0
                    }}
                  >
                    <img
                      ref={imgRef}
                      src={previewImage}
                      alt="Preview"
                      fetchPriority="high"
                      loading="eager"
                      style={{ width: 'auto', maxWidth: '95vw', maxHeight: '74vh', display: 'block', margin: '0 auto' }}
                      onLoad={(e) => {
                        setImageNaturalSize({
                          width: e.target.naturalWidth,
                          height: e.target.naturalHeight
                        });
                        updateDisplayedImageSize();
                      }}
                      onError={(e) => {
                        console.error('Image load error');
                        e.target.src = images[0];
                      }}
                    />
                    {selectedFrame.svgPath && crop && crop.width > 0 && crop.height > 0 && (
                      <>
                        {/* Shape-only dim: dark overlay outside the selected shape (no rectangular highlight) */}
                        <svg
                          aria-hidden
                          className="shape-dim-full"
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: '100%',
                            height: '100%',
                            pointerEvents: 'none',
                            zIndex: 1
                          }}
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          <defs>
                            <mask id={shapeDimMaskId}>
                              <rect width="100" height="100" fill="white" />
                              <path
                                d={selectedFrame.svgPath}
                                fill="black"
                                transform={`translate(${crop.x}, ${crop.y}) scale(${crop.width / 100}, ${crop.height / 100})`}
                              />
                            </mask>
                          </defs>
                          <rect width="100" height="100" fill="rgba(0,0,0,0.6)" mask={`url(#${shapeDimMaskId})`} />
                        </svg>
                        <svg
                          aria-hidden
                          className="shape-frame-overlay"
                          width="100%"
                          height="100%"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          style={{
                            position: 'absolute',
                            left: `${crop.x}%`,
                            top: `${crop.y}%`,
                            width: `${crop.width}%`,
                            height: `${crop.height}%`,
                            pointerEvents: 'none',
                            zIndex: 2
                          }}
                        >
                          <defs>
                            <linearGradient id={`shape-preview-grad-${selectedFrame.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" style={{ stopColor: '#3498db', stopOpacity: 0.35 }} />
                              <stop offset="100%" style={{ stopColor: '#2ecc71', stopOpacity: 0.35 }} />
                            </linearGradient>
                          </defs>
                          <path
                            d={selectedFrame.svgPath}
                            fill={`url(#shape-preview-grad-${selectedFrame.id})`}
                            stroke="#3498db"
                            strokeWidth="2"
                          />
                        </svg>
                      </>
                    )}
                  </div>
                </ReactCrop>
              </div>
              <div
                style={{
                  flex: '0 0 auto',
                  alignSelf: 'stretch',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  minWidth: 160,
                  maxWidth: 220
                }}
              >
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'rgba(0, 0, 0, 0.58)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    textAlign: 'left',
                    lineHeight: 1.3
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: '#fff' }}>
                    Image {currentImageIndex + 1} of {images.length}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#d1d5db' }}>
                    {croppedImages.filter(img => img).length} image{croppedImages.filter(img => img).length !== 1 ? 's' : ''} cropped
                  </p>
                  {pendingSaveCount > 0 && (
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#9ca3af' }}>
                      Saving ({pendingSaveCount})
                    </p>
                  )}
                </div>
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

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={handlePreviousImage}
                  disabled={cropMode === 'auto' || currentImageIndex === 0}
                >
                  ← Previous
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={handleSkipImage}
                  disabled={cropMode === 'auto' || currentImageIndex >= images.length - 1}
                >
                  Skip →
                </button>
              </div>
              
              <div style={{ display: 'flex', gap: 12 }}>
                {currentImageIndex < images.length - 1 ? (
                  <button 
                    className="btn btn-primary" 
                    onClick={handleNextImage}
                    disabled={
                      cropMode === 'auto' ||
                      processing ||
                      !completedCrop ||
                      completedCrop.width === 0 ||
                      completedCrop.height === 0
                    }
                    style={{ fontSize: '1rem', padding: '10px 24px' }}
                  >
                    Next Image →
                  </button>
                ) : (
                  <button 
                    className="btn btn-success" 
                    onClick={handleSelectOutputFolder}
                    disabled={
                      cropMode === 'auto' ||
                      processing ||
                      !completedCrop ||
                      completedCrop.width === 0 ||
                      completedCrop.height === 0
                    }
                    style={{ fontSize: '1rem', padding: '10px 24px', background: '#2ecc71', borderColor: '#2ecc71' }}
                  >
                    💾 Save & Finish ({croppedImages.filter(img => img).length + 1})
                  </button>
                )}
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
        /* Library mask is always rectangular — hide it; dim uses SVG overlay (same for rectangle and other frames) */
        .ReactCrop__crop-mask {
          display: none !important;
        }
        /* Rectangle: same clean look as shape frames — library default marching-ants (#444) makes the crop area look too dark */
        .ReactCrop:not(.shape-frame-crop) .ReactCrop__crop-selection {
          border: 3px solid #3498db;
          box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
          animation: none !important;
          background-image: none !important;
          color: transparent !important;
        }
        .ReactCrop:not(.shape-frame-crop) .ReactCrop__crop-selection:focus {
          outline: 2px solid rgba(52, 152, 219, 0.85);
          outline-offset: 1px;
        }
        .ReactCrop:not(.shape-frame-crop) .ReactCrop__rule-of-thirds-hz,
        .ReactCrop:not(.shape-frame-crop) .ReactCrop__rule-of-thirds-vt {
          display: none !important;
        }
        /* Non-rectangle: no rectangular border on selection; shape is drawn by SVG. Selection must stay above dim layers for drag/resize */
        .ReactCrop.shape-frame-crop .ReactCrop__crop-selection {
          border: none !important;
          box-shadow: none !important;
          animation: none !important;
          background-image: none !important;
          outline: none !important;
          z-index: 20 !important;
        }
        .ReactCrop.shape-frame-crop .ReactCrop__crop-selection:focus {
          outline: none !important;
        }
        /* Visible corner handles so width/height can be changed (opacity:0 broke pointer hit on some browsers) */
        .ReactCrop.shape-frame-crop .ReactCrop__drag-handle {
          opacity: 1 !important;
          z-index: 21 !important;
          width: 14px !important;
          height: 14px !important;
          background: #fff !important;
          border: 2px solid #3498db !important;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2) !important;
        }
        .ReactCrop.shape-frame-crop .ReactCrop__drag-handle:focus {
          background: #fff !important;
          outline: 2px solid rgba(52, 152, 219, 0.8) !important;
        }
        .ReactCrop.shape-frame-crop .ReactCrop__drag-bar {
          display: none !important;
        }
        .ReactCrop.shape-frame-crop .ReactCrop__rule-of-thirds-hz,
        .ReactCrop.shape-frame-crop .ReactCrop__rule-of-thirds-vt {
          display: none !important;
        }
        .shape-frame-overlay {
          pointer-events: none;
        }
        .ReactCrop:not(.shape-frame-crop) .ReactCrop__drag-handle {
          background: #fff !important;
          border: 1px solid rgba(255, 255, 255, 0.9) !important;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
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
