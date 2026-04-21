const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_URL = 'https://the-ledger-buddy.lovable.app';

// Per-company root: %USERPROFILE%\Documents\YourMehtaji\<Company>\<subFolder>\
function dataRoot() {
  return path.join(os.homedir(), 'Documents', 'YourMehtaji');
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
        { label: 'Open Data Folder', click: () => { fs.mkdirSync(dataRoot(), { recursive: true }); shell.openPath(dataRoot()); } },
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

// Save a file under <Documents>\YourMehtaji\<Company>\<subFolder>\<fileName>
// Then prompt user to Open or Save (Save As).
ipcMain.handle('save-company-file', async (_evt, payload) => {
  try {
    const { company, subFolder, fileName, contents } = payload || {};
    const dir = path.join(dataRoot(), safe(company), safe(subFolder || 'files'));
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, fileName);
    fs.writeFileSync(target, contents, 'utf8');

    // Show non-blocking dialog with Open / Save As / Done choices.
    const win = BrowserWindow.getFocusedWindow();
    const choice = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'File saved',
      message: 'File saved to your company folder.',
      detail: target,
      buttons: ['Open file', 'Open folder', 'Save a copy as…', 'Done'],
      defaultId: 0,
      cancelId: 3,
    });
    if (choice.response === 0) shell.openPath(target);
    else if (choice.response === 1) shell.showItemInFolder(target);
    else if (choice.response === 2) {
      const res = await dialog.showSaveDialog(win, { defaultPath: fileName });
      if (!res.canceled && res.filePath) fs.writeFileSync(res.filePath, contents, 'utf8');
    }
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
