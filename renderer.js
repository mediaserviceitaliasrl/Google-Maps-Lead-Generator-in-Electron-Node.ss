const { contextBridge, ipcRenderer } = require('electron');

// Esponi le funzionalità in modo sicuro nel renderer
contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  onStatus: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
});
