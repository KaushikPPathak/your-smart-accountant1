// Smart Accountant — Electron 22 legacy main process
// Runs on Windows 7 SP1, 8, 8.1, 10, 11 (32-bit + 64-bit).
// Loads the built web app (copied into ./app) from file:// — fully offline.

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

// Windows 7 GPU quirks: software rendering is safer on very old drivers.
// Users can force GPU by deleting this line; kept for max compatibility.
app.disableHardwareAcceleration();

app.commandLine.appendSwitch('disable-features', 'TranslateUI');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d10',
    icon: path.join(__dirname, 'assets', 'app.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // IndexedDB / localStorage persist in the per-user Electron userData
      // folder, so client accounting data survives upgrades & reinstalls.
    },
  });

  // Hide default menu — the app draws its own top menu bar.
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // External links open in the OS default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  const indexPath = path.join(__dirname, 'app', 'index.html');
  mainWindow.loadFile(indexPath).catch((err) => {
    dialog.showErrorBox(
      'Smart Accountant',
      'Failed to load app bundle:\n\n' + err.message +
      '\n\nExpected: ' + indexPath
    );
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Standard Windows behaviour — quit fully when the last window closes.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
