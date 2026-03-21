const { app, BrowserWindow } = require('electron');
const path = require('path');

/** Dev server only when explicitly requested — otherwise load `dist/` (Windows, macOS, Linux). */
const isDev = process.argv.includes('--dev');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // In dev, allow cross-origin requests to API (avoids CORS block when origin is localhost:5173)
      ...(isDev && { webSecurity: false }),
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    // DevTools auto-open off — "Failed to fetch" devtools error avoid. Open manually: Cmd+Option+I (Mac) / F12 (Windows)
    // win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
