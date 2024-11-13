const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    startScraping: (searchString) => ipcRenderer.invoke('start-scraping', searchString),
    onStatus: (callback) => ipcRenderer.on('status', callback)
});
