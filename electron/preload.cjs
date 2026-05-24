const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yourMehtaji', {
  isDesktop: true,
  version: '1.1.0',
  // contents: string (UTF-8) OR ArrayBuffer / Uint8Array (binary)
  saveCompanyFile: (company, subFolder, fileName, contents) => {
    const isBinary = contents && typeof contents !== 'string';
    const payload = {
      company, subFolder, fileName,
      contents: isBinary ? new Uint8Array(contents) : contents,
      encoding: isBinary ? 'binary' : 'utf8',
    };
    return ipcRenderer.invoke('save-company-file', payload);
  },
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  closeApp: () => ipcRenderer.invoke('close-app'),
  getDataRoot: () => ipcRenderer.invoke('get-data-root'),
});
