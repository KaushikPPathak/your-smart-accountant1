const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yourMehtaji', {
  saveCompanyFile: (company, subFolder, fileName, contents) =>
    ipcRenderer.invoke('save-company-file', { company, subFolder, fileName, contents }),
  isDesktop: true,
  version: '1.0.0',
});
