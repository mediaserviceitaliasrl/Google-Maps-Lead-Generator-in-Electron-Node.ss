const { contextBridge, ipcRenderer } = require('electron');

// Esponi in modo sicuro l'API nel processo renderer
contextBridge.exposeInMainWorld('electron', {
    startScraping: (searchString) => ipcRenderer.invoke('start-scraping', searchString),
    onStatus: (callback) => ipcRenderer.on('status', (event, message) => callback(message)), // Passa il callback direttamente

    // Fetch username from main process
    getUsername: () => ipcRenderer.invoke('get-username')
});
