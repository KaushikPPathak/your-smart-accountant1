// Exposes a minimal, safe bridge to the renderer so the web app detects
// desktop runtime (window.yourMehtaji.isDesktop === true) and can save
// exports to the per-user company folder. contextIsolation stays enabled;
// no Node APIs leak to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yourMehtaji', {
  isDesktop: true,
  saveCompanyFile: (company, subFolder, fileName, contents) =>
    ipcRenderer.invoke('sa:saveCompanyFile', { company, subFolder, fileName, contents }),
  showInFolder: (filePath) => ipcRenderer.invoke('sa:showInFolder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('sa:openPath', filePath),
  closeApp: () => ipcRenderer.invoke('sa:closeApp'),
  getDataRoot: () => ipcRenderer.invoke('sa:getDataRoot'),
});
