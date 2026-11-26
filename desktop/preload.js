const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('videodyneDesktop', {
  current: () => ipcRenderer.invoke('server:get'),
  connect: (address) => ipcRenderer.invoke('server:set', address),
});
