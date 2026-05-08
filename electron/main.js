const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { createCanvas, loadImage } = require('canvas');
const placeholderPngBuffer = (() => {
  const canvas = createCanvas(4, 4);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 4, 4);
  return canvas.toBuffer('image/png', { compressionLevel: 0 });
})();
const placeholderJpegBuffer = (() => {
  const canvas = createCanvas(4, 4);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 4, 4);
  return canvas.toBuffer('image/jpeg', { quality: 0.8, progressive: false, chromaSubsampling: false });
})();

function getCropExportMeta() {
  return { ext: '.png', mime: 'image/png' };
}

/**
 * Encode cropped bitmap for disk. PNG: zlib level 6 (good balance of speed vs size). JPEG: high quality if used later.
 */
function canvasBufferFast(canvas, mime) {
  if (mime === 'image/png') {
    return canvas.toBuffer('image/png', { compressionLevel: 9 });
  }
  return canvas.toBuffer('image/jpeg', {
    quality: 0.94,
    progressive: true,
    chromaSubsampling: false,
  });
}

const CROP_MAX_OUTPUT_BYTES = 200 * 1024;
const CROP_TARGET_OUTPUT_BYTES = 160 * 1024;
const CROP_MAX_PNG_OUTPUT_BYTES = 260 * 1024;
const CROP_MIN_PNG_OUTPUT_BYTES = 90 * 1024;
const CROP_RELATIVE_SIZE_MULTIPLIER = 1.5;
const CROP_RELATIVE_SIZE_PADDING_BYTES = 8 * 1024;
const CROP_RELATIVE_SIZE_HARD_LIMIT_BYTES = 120 * 1024;
const CROP_MIN_JPEG_QUALITY = 0.45;
const CROP_MAX_DIMENSION = 1600;

function clampJpegQuality(quality) {
  return Math.min(0.92, Math.max(CROP_MIN_JPEG_QUALITY, Number(quality) || 0.8));
}

function encodeJpegWithQuality(canvas, quality) {
  return canvas.toBuffer('image/jpeg', {
    quality: clampJpegQuality(quality),
    progressive: true,
    chromaSubsampling: true,
  });
}

function resizeCanvas(sourceCanvas, width, height) {
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  const resizedCanvas = createCanvas(nextWidth, nextHeight);
  const resizedCtx = resizedCanvas.getContext('2d');
  configureHighQualityRasterContext(resizedCtx);
  resizedCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, nextWidth, nextHeight);
  return resizedCanvas;
}

function resolveDynamicCropSizeCap(inputBytes, fallbackCap) {
  const sourceSize = Number(inputBytes);
  if (!Number.isFinite(sourceSize) || sourceSize <= 0) return fallbackCap;
  const relativeCap = Math.round((sourceSize * CROP_RELATIVE_SIZE_MULTIPLIER) + CROP_RELATIVE_SIZE_PADDING_BYTES);
  return Math.max(CROP_MIN_PNG_OUTPUT_BYTES, Math.min(CROP_RELATIVE_SIZE_HARD_LIMIT_BYTES, relativeCap));
}

function makeCappedCropBuffer(canvas, mime, options = {}) {
  const maxOutputBytes = Number(options.maxOutputBytes) || CROP_MAX_OUTPUT_BYTES;
  if (mime === 'image/png') {
    let workingCanvas = canvas;
    if (workingCanvas.width > CROP_MAX_DIMENSION || workingCanvas.height > CROP_MAX_DIMENSION) {
      const scale = Math.min(
        CROP_MAX_DIMENSION / workingCanvas.width,
        CROP_MAX_DIMENSION / workingCanvas.height
      );
      workingCanvas = resizeCanvas(workingCanvas, workingCanvas.width * scale, workingCanvas.height * scale);
    }

    let buffer = canvasBufferFast(workingCanvas, mime);
    let attempts = 0;
    while (buffer.length > maxOutputBytes && attempts < 7) {
      const downscaleRatio = 0.87;
      workingCanvas = resizeCanvas(
        workingCanvas,
        workingCanvas.width * downscaleRatio,
        workingCanvas.height * downscaleRatio
      );
      buffer = canvasBufferFast(workingCanvas, mime);
      attempts++;
    }
    return buffer;
  }

  if (mime !== 'image/jpeg') {
    return canvasBufferFast(canvas, mime);
  }

  let workingCanvas = canvas;
  if (workingCanvas.width > CROP_MAX_DIMENSION || workingCanvas.height > CROP_MAX_DIMENSION) {
    const scale = Math.min(
      CROP_MAX_DIMENSION / workingCanvas.width,
      CROP_MAX_DIMENSION / workingCanvas.height
    );
    workingCanvas = resizeCanvas(workingCanvas, workingCanvas.width * scale, workingCanvas.height * scale);
  }

  let quality = 0.86;
  let buffer = encodeJpegWithQuality(workingCanvas, quality);

  for (let i = 0; i < 8 && buffer.length > maxOutputBytes; i++) {
    quality = clampJpegQuality(quality - 0.07);
    buffer = encodeJpegWithQuality(workingCanvas, quality);
    if (quality <= CROP_MIN_JPEG_QUALITY + 0.005) break;
  }

  let attempts = 0;
  while (buffer.length > maxOutputBytes && attempts < 4) {
    const downscaleRatio = 0.88;
    workingCanvas = resizeCanvas(
      workingCanvas,
      workingCanvas.width * downscaleRatio,
      workingCanvas.height * downscaleRatio
    );
    buffer = encodeJpegWithQuality(workingCanvas, quality);
    attempts++;
  }

  if (buffer.length < CROP_TARGET_OUTPUT_BYTES) {
    let raiseQuality = quality;
    let bestBuffer = buffer;
    for (let i = 0; i < 4; i++) {
      raiseQuality = clampJpegQuality(raiseQuality + 0.04);
      const candidate = encodeJpegWithQuality(workingCanvas, raiseQuality);
      if (candidate.length <= maxOutputBytes) {
        bestBuffer = candidate;
      } else {
        break;
      }
    }
    buffer = bestBuffer;
  }

  return buffer;
}

/**
 * Snap crop to whole source pixels so drawImage does not sample between pixels (reduces blur).
 */
function computeIntegralCropRect(imageWidth, imageHeight, crop) {
  const x = Number(crop?.x);
  const y = Number(crop?.y);
  const w = Number(crop?.width);
  const h = Number(crop?.height);
  let cropX = Math.round((x / 100) * imageWidth);
  let cropY = Math.round((y / 100) * imageHeight);
  let cropWidth = Math.round((w / 100) * imageWidth);
  let cropHeight = Math.round((h / 100) * imageHeight);

  cropX = Math.max(0, Math.min(cropX, Math.max(0, imageWidth - 1)));
  cropY = Math.max(0, Math.min(cropY, Math.max(0, imageHeight - 1)));
  cropWidth = Math.max(1, cropWidth);
  cropHeight = Math.max(1, cropHeight);
  if (cropX + cropWidth > imageWidth) {
    cropWidth = Math.max(1, imageWidth - cropX);
  }
  if (cropY + cropHeight > imageHeight) {
    cropHeight = Math.max(1, imageHeight - cropY);
  }
  return { cropX, cropY, cropWidth, cropHeight };
}

/** node-canvas / Cairo: use highest-quality filters when scaling crops to output size. */
function configureHighQualityRasterContext(ctx) {
  ctx.imageSmoothingEnabled = true;
  ctx.patternQuality = 'best';
  ctx.quality = 'best';
}

function getPlaceholderBufferForMime(mime) {
  return mime === 'image/png' ? placeholderPngBuffer : placeholderJpegBuffer;
}

/** Dev server only when explicitly requested — otherwise load `dist/` (Windows, macOS, Linux). */
const isDev = process.argv.includes('--dev');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // In dev, allow cross-origin requests to API (avoids CORS block when origin is localhost:5173)
      ...(isDev && { webSecurity: false }),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // DevTools auto-open off — "Failed to fetch" devtools error avoid. Open manually: Cmd+Option+I (Mac) / F12 (Windows)
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

/**
 * Register JPEG export IPC before the window loads so invoke() never hits "No handler registered".
 */
function registerJpegExportIpcHandlers() {
  try {
    ipcMain.removeHandler('save-jpeg-export-folder');
  } catch (_) {}
  try {
    ipcMain.removeHandler('ensure-jpeg-export-dir');
  } catch (_) {}
  try {
    ipcMain.removeHandler('write-jpeg-file');
  } catch (_) {}
  try {
    ipcMain.removeHandler('save-pdf-export-file');
  } catch (_) {}
  try {
    ipcMain.removeHandler('save-png-export-folder');
  } catch (_) {}
  try {
    ipcMain.removeHandler('ensure-png-export-dir');
  } catch (_) {}
  try {
    ipcMain.removeHandler('write-png-file');
  } catch (_) {}
  try {
    ipcMain.removeHandler('capture-view-rect');
  } catch (_) {}
  try {
    ipcMain.removeHandler('print-to-pdf');
  } catch (_) {}

  ipcMain.handle('save-jpeg-export-folder', async (event, payload) => {
    try {
      const { parentFolderPath, subfolderName, files } = payload || {};
      if (!parentFolderPath || !subfolderName || !Array.isArray(files)) {
        return { success: false, error: 'Invalid save payload' };
      }
      const safeSub = String(subfolderName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'id-cards-jpeg';
      const dir = path.join(parentFolderPath, safeSub);
      await fs.mkdir(dir, { recursive: true });
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        let name = path
          .basename(String(f.filename || `card-${i + 1}.jpg`))
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        if (!name.toLowerCase().endsWith('.jpg') && !name.toLowerCase().endsWith('.jpeg')) {
          name += '.jpg';
        }
        let buffer;
        if (f.dataBytes instanceof Uint8Array) {
          buffer = Buffer.from(
            f.dataBytes.buffer,
            f.dataBytes.byteOffset,
            f.dataBytes.byteLength,
          );
        } else {
          const dataUrl = String(f.dataUrl || '');
          const comma = dataUrl.indexOf(',');
          const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
          buffer = Buffer.from(base64, 'base64');
        }
        await fs.writeFile(path.join(dir, name), buffer);
      }
      return { success: true, folderPath: dir };
    } catch (error) {
      console.error('save-jpeg-export-folder:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ensure-jpeg-export-dir', async (event, payload) => {
    try {
      const { parentFolderPath, subfolderName } = payload || {};
      if (!parentFolderPath || !subfolderName) {
        return { success: false, error: 'Invalid folder payload' };
      }
      const safeSub = String(subfolderName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'id-cards-jpeg';
      const dir = path.join(parentFolderPath, safeSub);
      await fs.mkdir(dir, { recursive: true });
      return { success: true, folderPath: dir };
    } catch (error) {
      console.error('ensure-jpeg-export-dir:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-jpeg-file', async (event, payload) => {
    try {
      const { directoryPath, filename, dataUrl, dataBytes } = payload || {};
      if (!directoryPath || (!dataUrl && !(dataBytes instanceof Uint8Array))) {
        return { success: false, error: 'Invalid file payload' };
      }
      let name = path
        .basename(String(filename || 'card.jpg'))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      if (!name.toLowerCase().endsWith('.jpg') && !name.toLowerCase().endsWith('.jpeg')) {
        name += '.jpg';
      }
      let buffer;
      if (dataBytes instanceof Uint8Array) {
        buffer = Buffer.from(
          dataBytes.buffer,
          dataBytes.byteOffset,
          dataBytes.byteLength,
        );
      } else {
        const dataUrlStr = String(dataUrl);
        const comma = dataUrlStr.indexOf(',');
        const base64 = comma >= 0 ? dataUrlStr.slice(comma + 1) : dataUrlStr;
        buffer = Buffer.from(base64, 'base64');
      }
      await fs.writeFile(path.join(directoryPath, name), buffer);
      return { success: true };
    } catch (error) {
      console.error('write-jpeg-file:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-pdf-export-file', async (event, payload) => {
    try {
      const { parentFolderPath, subfolderName, filename, dataBase64, dataBytes } =
        payload || {};
      if (!parentFolderPath || !subfolderName) {
        return { success: false, error: 'Invalid PDF payload' };
      }
      let buffer;
      if (dataBytes instanceof Uint8Array) {
        buffer = Buffer.from(
          dataBytes.buffer,
          dataBytes.byteOffset,
          dataBytes.byteLength,
        );
      } else if (dataBase64) {
        buffer = Buffer.from(String(dataBase64), 'base64');
      } else {
        return { success: false, error: 'Invalid PDF payload' };
      }
      const safeSub = String(subfolderName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'id-cards-pdf';
      const dir = path.join(parentFolderPath, safeSub);
      await fs.mkdir(dir, { recursive: true });
      let safeName = path
        .basename(String(filename || `${safeSub}.pdf`))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      if (!safeName.toLowerCase().endsWith('.pdf')) {
        safeName += '.pdf';
      }
      const filePath = path.join(dir, safeName);
      await fs.writeFile(filePath, buffer);
      return { success: true, folderPath: dir, filePath };
    } catch (error) {
      console.error('save-pdf-export-file:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-png-export-folder', async (event, payload) => {
    try {
      const { parentFolderPath, subfolderName, files } = payload || {};
      if (!parentFolderPath || !subfolderName || !Array.isArray(files)) {
        return { success: false, error: 'Invalid save payload' };
      }
      const safeSub = String(subfolderName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'id-cards-png';
      const dir = path.join(parentFolderPath, safeSub);
      await fs.mkdir(dir, { recursive: true });
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        let name = path
          .basename(String(f.filename || `page-${i + 1}.png`))
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        if (!name.toLowerCase().endsWith('.png')) {
          name += '.png';
        }
        let buffer;
        if (f.dataBytes instanceof Uint8Array) {
          buffer = Buffer.from(
            f.dataBytes.buffer,
            f.dataBytes.byteOffset,
            f.dataBytes.byteLength,
          );
        } else {
          const dataUrl = String(f.dataUrl || '');
          const comma = dataUrl.indexOf(',');
          const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
          buffer = Buffer.from(base64, 'base64');
        }
        await fs.writeFile(path.join(dir, name), buffer);
      }
      return { success: true, folderPath: dir };
    } catch (error) {
      console.error('save-png-export-folder:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ensure-png-export-dir', async (event, payload) => {
    try {
      const { parentFolderPath, subfolderName } = payload || {};
      if (!parentFolderPath || !subfolderName) {
        return { success: false, error: 'Invalid folder payload' };
      }
      const safeSub = String(subfolderName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'id-cards-png';
      const dir = path.join(parentFolderPath, safeSub);
      await fs.mkdir(dir, { recursive: true });
      return { success: true, folderPath: dir };
    } catch (error) {
      console.error('ensure-png-export-dir:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('write-png-file', async (event, payload) => {
    try {
      const { directoryPath, filename, dataUrl, dataBytes } = payload || {};
      if (!directoryPath || (!dataUrl && !(dataBytes instanceof Uint8Array))) {
        return { success: false, error: 'Invalid file payload' };
      }
      let name = path
        .basename(String(filename || 'page.png'))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      if (!name.toLowerCase().endsWith('.png')) {
        name += '.png';
      }
      let buffer;
      if (dataBytes instanceof Uint8Array) {
        buffer = Buffer.from(
          dataBytes.buffer,
          dataBytes.byteOffset,
          dataBytes.byteLength,
        );
      } else {
        const dataUrlStr = String(dataUrl);
        const comma = dataUrlStr.indexOf(',');
        const base64 = comma >= 0 ? dataUrlStr.slice(comma + 1) : dataUrlStr;
        buffer = Buffer.from(base64, 'base64');
      }
      await fs.writeFile(path.join(directoryPath, name), buffer);
      return { success: true };
    } catch (error) {
      console.error('write-png-file:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Rasterize a viewport rectangle using Chromium compositor (faster than html2canvas for complex DOM/canvas).
   * Rect is in physical pixels; renderer supplies getBoundingClientRect × devicePixelRatio.
   */
  ipcMain.handle('capture-view-rect', async (event, payload) => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { success: false, error: 'No window' };
      }
      const {
        x = 0,
        y = 0,
        width = 1,
        height = 1,
        format = 'png',
        jpegQuality,
      } = payload || {};
      const rect = {
        x: Math.round(Number(x) || 0),
        y: Math.round(Number(y) || 0),
        width: Math.max(1, Math.round(Number(width) || 1)),
        height: Math.max(1, Math.round(Number(height) || 1)),
      };
      const image = await mainWindow.webContents.capturePage(rect);
      const qRaw = Number(jpegQuality);
      const q =
        Number.isFinite(qRaw) && qRaw > 0
          ? Math.min(100, Math.max(1, Math.round(qRaw <= 1 ? qRaw * 100 : qRaw)))
          : 92;
      const wantJpeg = format === 'jpeg' || format === 'jpg';
      const buffer = wantJpeg ? image.toJPEG(q) : image.toPNG();
      const mime = wantJpeg ? 'image/jpeg' : 'image/png';
      return {
        success: true,
        mime,
        dataBase64: buffer.toString('base64'),
      };
    } catch (error) {
      console.error('capture-view-rect:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Multi-page PDF from the live DOM using Chromium print (respects @media print / @page; no html2canvas).
   */
  ipcMain.handle('print-to-pdf', async (event, payload) => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { success: false, error: 'No window' };
      }
      const {
        printBackground = true,
        preferCSSPageSize = true,
        pageWidthMicrons,
        pageHeightMicrons,
      } = payload || {};
      const options = {
        printBackground,
        preferCSSPageSize,
        marginsType: 0,
      };
      if (
        typeof pageWidthMicrons === 'number' &&
        typeof pageHeightMicrons === 'number' &&
        pageWidthMicrons > 0 &&
        pageHeightMicrons > 0
      ) {
        options.pageSize = {
          width: Math.round(pageWidthMicrons),
          height: Math.round(pageHeightMicrons),
        };
      }
      const pdfBuffer = await mainWindow.webContents.printToPDF(options);
      return {
        success: true,
        dataBytes: new Uint8Array(pdfBuffer),
      };
    } catch (error) {
      console.error('print-to-pdf:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[main] JPEG export IPC handlers registered');
}

app.whenReady().then(() => {
  registerJpegExportIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('select-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });

    if (result.canceled) {
      return { success: false, images: [] };
    }

    const folderPath = result.filePaths[0];
    const files = await fs.readdir(folderPath);
    
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
    const images = files
      .filter(file => imageExtensions.includes(path.extname(file).toLowerCase()))
      .map(file => path.join(folderPath, file));

    return {
      success: true,
      folderPath,
      images
    };
  } catch (error) {
    console.error('Error selecting folder:', error);
    return { success: false, error: error.message, images: [] };
  }
});

ipcMain.handle('select-output-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled) {
      return { success: false };
    }

    return {
      success: true,
      folderPath: result.filePaths[0]
    };
  } catch (error) {
    console.error('Error selecting output folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-crop-output-folder', async (event, sourceFolderPath) => {
  try {
    const cropFolderPath = path.join(sourceFolderPath, 'crop image');
    
    try {
      await fs.access(cropFolderPath);
    } catch {
      await fs.mkdir(cropFolderPath, { recursive: true });
    }

    return {
      success: true,
      folderPath: cropFolderPath
    };
  } catch (error) {
    console.error('Error creating crop output folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-folder', async (event, folderPath) => {
  try {
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error) {
    console.error('Error opening folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('crop-images', async (event, data) => {
  const { images, crop, outputFolder, shape, svgPath } = data;
  
  try {
    let processedCount = 0;
    
    for (let i = 0; i < images.length; i++) {
      const imagePath = images[i];
      const inputExt = path.extname(imagePath);
      const fileName = path.basename(imagePath, inputExt);
      const normalizedFileName = fileName.replace(/_cropped$/i, '');
      const { ext: outputExt, mime: outputMime } = getCropExportMeta();
      const outputPath = path.join(outputFolder, `${normalizedFileName}${outputExt}`);
      const legacyOutputPath = path.join(outputFolder, `${fileName}${outputExt}`);
      if (legacyOutputPath !== outputPath) {
        try {
          await fs.unlink(legacyOutputPath);
        } catch (_) {}
      }

      // Write a valid tiny file immediately so output appears instantly in folder.
      await fs.writeFile(outputPath, getPlaceholderBufferForMime(outputMime));
      const sourceStat = await fs.stat(imagePath).catch(() => null);
      const dynamicSizeCap = resolveDynamicCropSizeCap(sourceStat?.size, CROP_MAX_PNG_OUTPUT_BYTES);
      
      const image = await loadImage(imagePath);
      
      const { cropX, cropY, cropWidth, cropHeight } = computeIntegralCropRect(
        image.width,
        image.height,
        crop
      );
      
      const canvas = createCanvas(cropWidth, cropHeight);
      const ctx = canvas.getContext('2d');
      configureHighQualityRasterContext(ctx);
      
      if (shape && shape !== 'rectangle') {
        applyShapeClipping(ctx, shape, cropWidth, cropHeight);
      }
      
      ctx.drawImage(
        image,
        cropX, cropY, cropWidth, cropHeight,
        0, 0, cropWidth, cropHeight
      );
      
      const buffer = makeCappedCropBuffer(canvas, outputMime, { maxOutputBytes: dynamicSizeCap });
      await fs.writeFile(outputPath, buffer);
      
      processedCount++;
      const progress = Math.round((processedCount / images.length) * 100);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('crop-progress', {
          progress,
          processedCount
        });
      }
    }
    
    return {
      success: true,
      processedCount
    };
  } catch (error) {
    console.error('Error cropping images:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('crop-images-individually', async (event, data) => {
  const { images, outputFolder, shape, svgPath } = data;

  try {
    if (!Array.isArray(images) || images.length === 0) {
      return { success: false, error: 'No images provided for crop.' };
    }
    if (!outputFolder || typeof outputFolder !== 'string') {
      return { success: false, error: 'Invalid crop output folder.' };
    }
    await fs.mkdir(outputFolder, { recursive: true });
    let processedCount = 0;

    for (let i = 0; i < images.length; i++) {
      const imageData = images[i];
      const imagePath = imageData.imagePath;
      const crop = imageData.crop;

      const inputExt = path.extname(imagePath);
      const fileName = path.basename(imagePath, inputExt);
      const normalizedFileName = fileName.replace(/_cropped$/i, '');
      const { ext: outputExt, mime: outputMime } = getCropExportMeta();
      const outputPath = path.join(outputFolder, `${normalizedFileName}${outputExt}`);
      const legacyOutputPath = path.join(outputFolder, `${fileName}${outputExt}`);
      if (legacyOutputPath !== outputPath) {
        try {
          await fs.unlink(legacyOutputPath);
        } catch (_) {}
      }

      // Write a valid tiny file immediately so output appears instantly in folder.
      await fs.writeFile(outputPath, getPlaceholderBufferForMime(outputMime));
      const sourceStat = await fs.stat(imagePath).catch(() => null);
      const dynamicSizeCap = resolveDynamicCropSizeCap(sourceStat?.size, CROP_MAX_PNG_OUTPUT_BYTES);

      const image = await loadImage(imagePath);

      const { cropX, cropY, cropWidth, cropHeight } = computeIntegralCropRect(
        image.width,
        image.height,
        crop
      );

      // Always write at native crop pixel size so aspect ratio matches the selection
      // (no stretching from a shared outputSize across different images or crop edits).
      const outputWidth = Math.max(1, Math.round(cropWidth));
      const outputHeight = Math.max(1, Math.round(cropHeight));

      const canvas = createCanvas(outputWidth, outputHeight);
      const ctx = canvas.getContext('2d');
      configureHighQualityRasterContext(ctx);

      if (shape && shape !== 'rectangle') {
        applyShapeClipping(ctx, shape, outputWidth, outputHeight);
      }

      ctx.drawImage(
        image,
        cropX, cropY, cropWidth, cropHeight,
        0, 0, outputWidth, outputHeight
      );
      
      const buffer = makeCappedCropBuffer(canvas, outputMime, { maxOutputBytes: dynamicSizeCap });
      await fs.writeFile(outputPath, buffer);
      
      processedCount++;
    }
    
    return {
      success: true,
      processedCount
    };
  } catch (error) {
    console.error('Error cropping images individually:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

function applyShapeClipping(ctx, shape, width, height) {
  ctx.beginPath();
  
  const centerX = width / 2;
  const centerY = height / 2;
  
  switch (shape) {
    case 'circle':
      const radius = Math.min(width, height) / 2;
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      break;
      
    case 'star':
      drawStar(ctx, centerX, centerY, 5, Math.min(width, height) / 2, Math.min(width, height) / 4);
      break;
      
    case 'pentagon':
      drawPolygon(ctx, centerX, centerY, 5, Math.min(width, height) / 2);
      break;
      
    case 'hexagon':
      drawPolygon(ctx, centerX, centerY, 6, Math.min(width, height) / 2);
      break;
      
    case 'octagon':
      drawPolygon(ctx, centerX, centerY, 8, Math.min(width, height) / 2);
      break;
      
    case 'triangle':
      drawPolygon(ctx, centerX, centerY, 3, Math.min(width, height) / 2);
      break;
      
    case 'heart':
      drawHeart(ctx, centerX, centerY, Math.min(width, height) / 2);
      break;

    case 'rounded-rectangle':
      // Keep corners clearly visible even on smaller crops.
      drawRoundedRect(ctx, 0, 0, width, height, Math.min(width, height) * 0.2);
      break;
      
    default:
      ctx.rect(0, 0, width, height);
  }
  
  ctx.closePath();
  ctx.clip();
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = Math.PI / 2 * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
}

function drawPolygon(ctx, cx, cy, sides, radius) {
  const angle = (Math.PI * 2) / sides;
  const startAngle = -Math.PI / 2;
  
  ctx.moveTo(
    cx + radius * Math.cos(startAngle),
    cy + radius * Math.sin(startAngle)
  );
  
  for (let i = 1; i <= sides; i++) {
    ctx.lineTo(
      cx + radius * Math.cos(startAngle + angle * i),
      cy + radius * Math.sin(startAngle + angle * i)
    );
  }
}

function drawHeart(ctx, cx, cy, size) {
  const topCurveHeight = size * 0.3;
  ctx.moveTo(cx, cy + size * 0.3);
  
  ctx.bezierCurveTo(
    cx, cy,
    cx - size * 0.5, cy - topCurveHeight,
    cx - size * 0.5, cy + topCurveHeight * 0.5
  );
  
  ctx.bezierCurveTo(
    cx - size * 0.5, cy + topCurveHeight * 1.5,
    cx, cy + topCurveHeight * 2.5,
    cx, cy + size
  );
  
  ctx.bezierCurveTo(
    cx, cy + topCurveHeight * 2.5,
    cx + size * 0.5, cy + topCurveHeight * 1.5,
    cx + size * 0.5, cy + topCurveHeight * 0.5
  );
  
  ctx.bezierCurveTo(
    cx + size * 0.5, cy - topCurveHeight,
    cx, cy,
    cx, cy + size * 0.3
  );
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}
