const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_URL = 'https://your-smart-accountant.lovable.app';

// Per-company root: %USERPROFILE%\Documents\YourMehtaji\Exports\<Company>\<subFolder>\
function dataRoot() {
  return path.join(os.homedir(), 'Documents', 'YourMehtaji', 'Exports');
}
function safe(s) { return String(s || 'company').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'company'; }

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Your Mehtaji',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.loadURL(APP_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { label: 'Open Exports Folder', click: () => { fs.mkdirSync(dataRoot(), { recursive: true }); shell.openPath(dataRoot()); } },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    {
      label: 'Help',
      submenu: [
        { label: 'Open Web Version', click: () => shell.openExternal(APP_URL) },
        { label: 'About', click: () => shell.openExternal(APP_URL + '/about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Save a file under <Documents>\YourMehtaji\Exports\<Company>\<subFolder>\<fileName>
// Auto-opens the file in the OS default app. Returns the saved absolute path.
// `contents` is either a UTF-8 string OR a Uint8Array (for binary files like .xlsx / .pdf).
ipcMain.handle('save-company-file', async (_evt, payload) => {
  try {
    const { company, subFolder, fileName, contents, encoding } = payload || {};
    const dir = path.join(dataRoot(), safe(company), safe(subFolder || 'files'));
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, fileName);
    if (encoding === 'binary' && contents != null) {
      let buf;
      if (Buffer.isBuffer(contents)) buf = contents;
      else if (contents instanceof Uint8Array) buf = Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength);
      else if (contents instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(contents));
      else if (ArrayBuffer.isView(contents)) buf = Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength);
      else buf = Buffer.from(contents);
      fs.writeFileSync(target, buf);
    } else {
      fs.writeFileSync(target, String(contents ?? ''), 'utf8');
    }
    // Auto-open in default app (silent — toast in the UI handles "show in folder").
    shell.openPath(target);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('show-in-folder', async (_evt, target) => {
  try { shell.showItemInFolder(String(target)); return { ok: true }; }
  catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
});

ipcMain.handle('open-path', async (_evt, target) => {
  try { await shell.openPath(String(target)); return { ok: true }; }
  catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
