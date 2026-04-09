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

function getImageOutputMeta(shape, inputExt) {
  const lowerExt = String(inputExt || '').toLowerCase();
  if (shape !== 'rectangle') {
    return { ext: '.png', mime: 'image/png' };
  }
  if (lowerExt === '.png') return { ext: '.png', mime: 'image/png' };
  if (lowerExt === '.webp') return { ext: '.jpg', mime: 'image/jpeg' };
  return { ext: lowerExt || '.jpg', mime: 'image/jpeg' };
}

/** JPEG export: no chroma subsampling keeps edges/colour cleaner at a modest size cost vs default 4:2:0. */
const CROP_JPEG_QUALITY = 0.98;

function canvasBufferFast(canvas, mime) {
  if (mime === 'image/png') {
    // Favor speed over compression size for instant next-image UX.
    return canvas.toBuffer('image/png', { compressionLevel: 0 });
  }

  return canvas.toBuffer('image/jpeg', {
    quality: CROP_JPEG_QUALITY,
    progressive: false,
    chromaSubsampling: false
  });
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
        const dataUrl = String(f.dataUrl || '');
        const comma = dataUrl.indexOf(',');
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const buffer = Buffer.from(base64, 'base64');
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
      const { directoryPath, filename, dataUrl } = payload || {};
      if (!directoryPath || !dataUrl) {
        return { success: false, error: 'Invalid file payload' };
      }
      let name = path
        .basename(String(filename || 'card.jpg'))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      if (!name.toLowerCase().endsWith('.jpg') && !name.toLowerCase().endsWith('.jpeg')) {
        name += '.jpg';
      }
      const dataUrlStr = String(dataUrl);
      const comma = dataUrlStr.indexOf(',');
      const base64 = comma >= 0 ? dataUrlStr.slice(comma + 1) : dataUrlStr;
      const buffer = Buffer.from(base64, 'base64');
      await fs.writeFile(path.join(directoryPath, name), buffer);
      return { success: true };
    } catch (error) {
      console.error('write-jpeg-file:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-pdf-export-file', async (event, payload) => {
    try {
      const { parentFolderPath, subfolderName, filename, dataBase64 } = payload || {};
      if (!parentFolderPath || !subfolderName || !dataBase64) {
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
      const buffer = Buffer.from(String(dataBase64), 'base64');
      const filePath = path.join(dir, safeName);
      await fs.writeFile(filePath, buffer);
      return { success: true, folderPath: dir, filePath };
    } catch (error) {
      console.error('save-pdf-export-file:', error);
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
      const { ext: outputExt, mime: outputMime } = getImageOutputMeta(shape, inputExt);
      const outputPath = path.join(outputFolder, `${normalizedFileName}${outputExt}`);
      const legacyOutputPath = path.join(outputFolder, `${fileName}${outputExt}`);
      if (legacyOutputPath !== outputPath) {
        try {
          await fs.unlink(legacyOutputPath);
        } catch (_) {}
      }

      // Write a valid tiny file immediately so output appears instantly in folder.
      await fs.writeFile(outputPath, getPlaceholderBufferForMime(outputMime));
      
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
      
      const buffer = canvasBufferFast(canvas, outputMime);
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
  const { images, outputFolder, shape, svgPath, outputSize } = data;
  
  try {
    let processedCount = 0;
    
    for (let i = 0; i < images.length; i++) {
      const imageData = images[i];
      const imagePath = imageData.imagePath;
      const crop = imageData.crop;
      
      const inputExt = path.extname(imagePath);
      const fileName = path.basename(imagePath, inputExt);
      const normalizedFileName = fileName.replace(/_cropped$/i, '');
      const { ext: outputExt, mime: outputMime } = getImageOutputMeta(shape, inputExt);
      const outputPath = path.join(outputFolder, `${normalizedFileName}${outputExt}`);
      const legacyOutputPath = path.join(outputFolder, `${fileName}${outputExt}`);
      if (legacyOutputPath !== outputPath) {
        try {
          await fs.unlink(legacyOutputPath);
        } catch (_) {}
      }

      // Write a valid tiny file immediately so output appears instantly in folder.
      await fs.writeFile(outputPath, getPlaceholderBufferForMime(outputMime));
      
      const image = await loadImage(imagePath);
      
      const { cropX, cropY, cropWidth, cropHeight } = computeIntegralCropRect(
        image.width,
        image.height,
        crop
      );
      
      const requestedOutputWidth = Number(outputSize?.width);
      const requestedOutputHeight = Number(outputSize?.height);
      const outputWidth = Number.isFinite(requestedOutputWidth) && requestedOutputWidth > 0
        ? Math.max(1, Math.round(requestedOutputWidth))
        : Math.max(1, Math.round(cropWidth));
      const outputHeight = Number.isFinite(requestedOutputHeight) && requestedOutputHeight > 0
        ? Math.max(1, Math.round(requestedOutputHeight))
        : Math.max(1, Math.round(cropHeight));

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
      
      const buffer = canvasBufferFast(canvas, outputMime);
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
