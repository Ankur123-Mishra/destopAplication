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

/**
 * Rectangle crops stay JPEG for speed and smaller size.
 * Shape crops use PNG so clipped regions remain transparent.
 */
function getCropExportMeta(shape) {
  if (shape && shape !== 'rectangle') {
    return { ext: '.png', mime: 'image/png' };
  }
  return { ext: '.jpg', mime: 'image/jpeg' };
}

/**
 * Encode cropped bitmap for disk. PNG: zlib level 6 (good balance of speed vs size).
 * JPEG quality is intentionally moderate to keep cropped file sizes lower.
 */
function canvasBufferFast(canvas, mime) {
  if (mime === 'image/png') {
    // Balanced PNG compression (faster than level 9, still reasonably compact).
    return canvas.toBuffer('image/png', { compressionLevel: 6 });
  }
  return canvas.toBuffer('image/jpeg', {
    quality: 0.86,
    progressive: true,
    chromaSubsampling: true,
  });
}

function resolveOutputRasterSize(outputSize, fallbackWidth, fallbackHeight) {
  const requestedWidth = Number(outputSize?.width);
  const requestedHeight = Number(outputSize?.height);
  const width =
    Number.isFinite(requestedWidth) && requestedWidth > 0
      ? Math.max(1, Math.round(requestedWidth))
      : Math.max(1, Math.round(fallbackWidth));
  const height =
    Number.isFinite(requestedHeight) && requestedHeight > 0
      ? Math.max(1, Math.round(requestedHeight))
      : Math.max(1, Math.round(fallbackHeight));
  return { width, height };
}

function setJpegDpiMetadata(buffer, dpi) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) return buffer;
  const density = Math.max(1, Math.min(65535, Math.round(Number(dpi) || 300)));
  let offset = 2; // skip SOI marker
  while (offset + 9 < buffer.length && buffer[offset] === 0xff) {
    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // SOS or EOI
    if (offset + 4 > buffer.length) break;
    const segmentLength = (buffer[offset + 2] << 8) | buffer[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) break;
    if (
      marker === 0xe0 &&
      buffer[offset + 4] === 0x4a &&
      buffer[offset + 5] === 0x46 &&
      buffer[offset + 6] === 0x49 &&
      buffer[offset + 7] === 0x46 &&
      buffer[offset + 8] === 0x00
    ) {
      const out = Buffer.from(buffer);
      out[offset + 11] = 0x01; // units: dots per inch
      out[offset + 12] = (density >> 8) & 0xff; // X density
      out[offset + 13] = density & 0xff;
      out[offset + 14] = (density >> 8) & 0xff; // Y density
      out[offset + 15] = density & 0xff;
      return out;
    }
    offset += 2 + segmentLength;
  }
  return buffer;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeAscii, data) {
  const type = Buffer.from(typeAscii, 'ascii');
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  const crcInput = Buffer.concat([type, data]);
  chunk.writeUInt32BE(crc32(crcInput), 8 + len);
  return chunk;
}

function setPngDpiMetadata(buffer, dpi) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33) return buffer;
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(pngSig)) return buffer;
  const densityPpm = Math.max(1, Math.round((Number(dpi) || 300) * 39.37007874));
  const pHYsData = Buffer.alloc(9);
  pHYsData.writeUInt32BE(densityPpm, 0);
  pHYsData.writeUInt32BE(densityPpm, 4);
  pHYsData[8] = 1; // unit: meter
  const pHYsChunk = makePngChunk('pHYs', pHYsData);

  const chunks = [buffer.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset + 12 <= buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const total = 12 + len;
    if (offset + total > buffer.length) break;
    if (type === 'pHYs') {
      if (!inserted) {
        chunks.push(pHYsChunk);
        inserted = true;
      }
    } else {
      chunks.push(buffer.subarray(offset, offset + total));
      if (type === 'IHDR' && !inserted) {
        chunks.push(pHYsChunk);
        inserted = true;
      }
    }
    offset += total;
  }
  if (offset < buffer.length) {
    chunks.push(buffer.subarray(offset));
  }
  return Buffer.concat(chunks);
}

function setImageDpiMetadata(buffer, mime, dpi = 300) {
  if (mime === 'image/png') return setPngDpiMetadata(buffer, dpi);
  if (mime === 'image/jpeg') return setJpegDpiMetadata(buffer, dpi);
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
  const { images, crop, outputFolder, shape, svgPath, outputSize } = data;
  
  try {
    let processedCount = 0;
    
    for (let i = 0; i < images.length; i++) {
      const imagePath = images[i];
      const inputExt = path.extname(imagePath);
      const fileName = path.basename(imagePath, inputExt);
      const normalizedFileName = fileName.replace(/_cropped$/i, '');
      const { ext: outputExt, mime: outputMime } = getCropExportMeta(shape);
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
      
      const { width: outputWidth, height: outputHeight } = resolveOutputRasterSize(
        outputSize,
        cropWidth,
        cropHeight
      );
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
      
      const rasterBuffer = canvasBufferFast(canvas, outputMime);
      const buffer = setImageDpiMetadata(rasterBuffer, outputMime, 300);
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
      const { ext: outputExt, mime: outputMime } = getCropExportMeta(shape);
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

      const { width: outputWidth, height: outputHeight } = resolveOutputRasterSize(
        outputSize,
        cropWidth,
        cropHeight
      );

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
      
      const rasterBuffer = canvasBufferFast(canvas, outputMime);
      const buffer = setImageDpiMetadata(rasterBuffer, outputMime, 300);
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
