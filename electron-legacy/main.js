// Smart Accountant — Electron 22 legacy main process
// Runs on Windows 7 SP1, 8, 8.1, 10, 11 (32-bit + 64-bit).
// Loads the built web app (copied into ./app) from file:// — fully offline.

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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

  // Clean exit: drop the reference and remove IPC-visible state so no
  // renderer process or timer is left dangling after close.
  mainWindow.on('closed', () => { mainWindow = null; });


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

// ---------- IPC bridge for the renderer (window.yourMehtaji) ----------

function safeSeg(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_\-. ]+/g, '_').slice(0, 80) || 'Default';
}
function safeFileName(s) {
  const cleaned = String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 180) || 'file';
}
function exportRoot() {
  // %USERPROFILE%\Documents\SmartAccountant\Exports on Windows.
  return path.join(app.getPath('documents'), 'SmartAccountant', 'Exports');
}

ipcMain.handle('sa:saveCompanyFile', async (_e, args) => {
  try {
    const { company, subFolder, fileName, contents } = args || {};
    const dir = path.join(exportRoot(), safeSeg(company), safeSeg(subFolder));
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, safeFileName(fileName));
    let buf;
    if (typeof contents === 'string') buf = Buffer.from(contents, 'utf8');
    else if (contents instanceof Uint8Array) buf = Buffer.from(contents);
    else if (contents && contents.byteLength != null) buf = Buffer.from(new Uint8Array(contents));
    else buf = Buffer.from(String(contents || ''), 'utf8');
    fs.writeFileSync(full, buf);
    return { ok: true, path: full };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
});

// Windows shell does NOT expand %VAR% for us — do it here, otherwise
// "open folder" fails with 'Windows cannot find %LOCALAPPDATA%\\...'.
function expandPath(p) {
  let out = String(p || '').trim();
  out = out.replace(/%([^%]+)%/g, (m, name) => process.env[name] || process.env[name.toUpperCase()] || m);
  out = out.replace(/^~(?=[\\/]|$)/, app.getPath('home'));
  return out;
}

ipcMain.handle('sa:showInFolder', async (_e, filePath) => {
  try {
    const target = expandPath(filePath);
    if (!fs.existsSync(target)) return { ok: false, error: 'Folder does not exist yet: ' + target };
    shell.showItemInFolder(target);
    return { ok: true };
  }
  catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('sa:openPath', async (_e, filePath) => {
  try {
    const target = expandPath(filePath);
    // Create the folder on demand so "Open" never shows a Windows error box.
    if (!fs.existsSync(target) && !path.extname(target)) {
      try { fs.mkdirSync(target, { recursive: true }); } catch { /* ignore */ }
    }
    if (!fs.existsSync(target)) return { ok: false, error: 'Path not found: ' + target };
    const r = await shell.openPath(target);
    return r ? { ok: false, error: r } : { ok: true };
  }
  catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('sa:closeApp', async () => { app.quit(); return { ok: true }; });

function toBuffer(contents) {
  if (typeof contents === 'string') return Buffer.from(contents, 'utf8');
  if (contents instanceof Uint8Array) return Buffer.from(contents);
  if (contents && contents.byteLength != null) return Buffer.from(new Uint8Array(contents));
  return Buffer.from(String(contents || ''), 'utf8');
}

ipcMain.handle('sa:pickFolder', async (_e, defaultPath) => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath || undefined,
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
    return { ok: true, path: r.filePaths[0] };
  } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('sa:pickFile', async (_e, args) => {
  try {
    const { defaultPath, filters } = args || {};
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      defaultPath: defaultPath || undefined,
      filters: filters || undefined,
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
    return { ok: true, path: r.filePaths[0] };
  } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('sa:saveWithPicker', async (_e, args) => {
  try {
    const { defaultFileName, contents, filters } = args || {};
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFileName || undefined,
      filters: filters || undefined,
    });
    if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
    fs.writeFileSync(r.filePath, toBuffer(contents));
    return { ok: true, path: r.filePath };
  } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('sa:readTextFile', async (_e, absPath) => {
  try { return { ok: true, text: fs.readFileSync(String(absPath), 'utf8') }; }
  catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('sa:writeAbsoluteFile', async (_e, args) => {
  try {
    const { absDir, subFolder, fileName, contents } = args || {};
    const segs = String(subFolder || '')
      .split(/[\\/]+/)
      .map((x) => x.trim())
      .filter((x) => x && x !== '.' && x !== '..')
      .map(safeSeg);
    const dir = segs.length ? path.join(absDir, ...segs) : absDir;
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, safeFileName(fileName));
    fs.writeFileSync(full, toBuffer(contents));
    return { ok: true, path: full };
  } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('sa:getDataRoot', async () => {
  try {
    const root = path.join(app.getPath('userData'), 'Data');
    fs.mkdirSync(root, { recursive: true });
    for (const sub of ['mirror', 'exports', 'backups', 'state', 'logs']) {
      fs.mkdirSync(path.join(root, sub), { recursive: true });
    }
    return { ok: true, path: root };
  }
  catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Standard Windows behaviour — quit fully when the last window closes.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

