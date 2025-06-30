const { contextBridge, ipcRenderer } = require('electron');

// Esponi in modo sicuro l'API nel processo renderer
contextBridge.exposeInMainWorld('electron', {
    startScraping: (searchString, scrapingType, folderPath, headless, dnsRecordTypes, doAMail) => ipcRenderer.invoke('start-scraping', searchString, scrapingType, folderPath, headless, dnsRecordTypes, doAMail),
    chooseFolder: () => ipcRenderer.invoke('choose-folder'),
    onStatus: (callback) => ipcRenderer.on('status', (event, message) => callback(message)), // Passa il callback direttamente

    // Fetch username from main process
    getUsername: () => ipcRenderer.invoke('get-username'),

    onResetLogs: (callback) => ipcRenderer.on('reset-logs', () => callback()),

    onUserActionRequired: (callback) => ipcRenderer.on('user-action-required', (event, message) => callback(message)),
    confirmUserAction: () => ipcRenderer.send('user-action-confirmed'),
    stopScraping: () => ipcRenderer.send('stop-scraping')
});
