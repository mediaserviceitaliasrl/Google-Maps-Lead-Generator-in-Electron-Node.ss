const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const os = require("os");
const puppeteer = require("puppeteer-extra");
const cheerio = require("cheerio");
const converter = require("json-2-csv");
const fs = require("fs");
const path = require("path");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const randomUseragent = require("random-useragent");
const axios = require("axios");
const { performMapsScraping } = require("./scrapers/mapsScraping");
const { performFaqScraping } = require("./scrapers/askScraping");
const { performDnsScraping } = require("./scrapers/dnsScraping");
const dns = require("dns").promises;
puppeteer.use(StealthPlugin());
const {executablePath,DEFAULT_USER_AGENT, stopFlag } = require("./utils/config")

// Crea la finestra principale di Electron
function createWindow() {
  const win = new BrowserWindow({
    width: 1140,
    height: 800,
    icon: path.join(__dirname, "assets", "icon.icns"), // Aggiungi qui l'icona per la finestra
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false, // Evita il rischio di vulnerabilità XSS
    },
  });

  win.loadFile("index.html"); // Carica l'HTML di base
}

// IPC per inviare il nome utente
ipcMain.handle("get-username", async () => {
  return os.userInfo().username;
});

// IPC handler for 'choose-folder' to open a folder dialog
ipcMain.handle("choose-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.on('stop-scraping', () => {
  stopFlag.value = true;
});

// Funzione per eseguire lo scraping
async function performScraping(
  searchString,
  scrapingType,
  folderPath,
  win,
  headless,
  dnsRecordTypes,
  doAMail,
  useProxy,
  customProxy
) {
  if (scrapingType === "maps") {
    await performMapsScraping(searchString, folderPath, win, headless, useProxy, customProxy);
  } else if (scrapingType === "faq") {
    await performFaqScraping(searchString, folderPath, win, headless, useProxy, customProxy);
  } else if (scrapingType === "dns") {
    await performDnsScraping(searchString, folderPath, win, dnsRecordTypes, doAMail, useProxy, customProxy);
  } else {
    win.webContents.send("status", "Tipo di scraping non valido.");
  }
}

// Gestisci l'evento per avviare lo scraping tramite IPC (Inter-Process Communication)
ipcMain.handle(
  "start-scraping",
  async (event, searchString, scrapingType, folderPath, headless, dnsRecordTypes, doAMail, useProxy, customProxy) => {
    console.log(
      `Avvio dello scraping per: ${searchString} (${scrapingType}), headless: ${headless}`
    );
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send("status", "Inizio dello scraping...");
    await performScraping(
      searchString,
      scrapingType,
      folderPath,
      win,
      headless,
      dnsRecordTypes,
      doAMail,
      useProxy,
      customProxy
    );
  }
);

// Avvia Electron
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Chiudi quando tutte le finestre sono chiuse
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

