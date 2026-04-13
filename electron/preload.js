const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  saveJpegExportFolder: (payload) =>
    ipcRenderer.invoke('save-jpeg-export-folder', payload),
  ensureJpegExportDir: (payload) =>
    ipcRenderer.invoke('ensure-jpeg-export-dir', payload),
  writeJpegFile: (payload) => ipcRenderer.invoke('write-jpeg-file', payload),
  savePdfExportFile: (payload) =>
    ipcRenderer.invoke('save-pdf-export-file', payload),
  savePngExportFolder: (payload) =>
    ipcRenderer.invoke('save-png-export-folder', payload),
  ensurePngExportDir: (payload) =>
    ipcRenderer.invoke('ensure-png-export-dir', payload),
  writePngFile: (payload) => ipcRenderer.invoke('write-png-file', payload),
  createCropOutputFolder: (sourceFolderPath) => ipcRenderer.invoke('create-crop-output-folder', sourceFolderPath),
  cropImages: (data) => ipcRenderer.invoke('crop-images', data),
  cropImagesIndividually: (data) => ipcRenderer.invoke('crop-images-individually', data),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  onCropProgress: (callback) => {
    ipcRenderer.on('crop-progress', (event, data) => callback(data));
  }
});
