const { app, BrowserWindow, ipcMain } = require('electron');
const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const converter = require('json-2-csv');
const fs = require('fs');
const path = require('path');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Aggiungi il percorso dell'eseguibile di Chromium/Chrome
const executablePath = '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome'; // Sostituisci con il percorso corretto

// Crea la finestra principale di Electron
function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, 'assets', 'icon.icns'), // Aggiungi qui l'icona per la finestra
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false, // Evita il rischio di vulnerabilità XSS
        },
    });

    win.loadFile('index.html'); // Carica l'HTML di base
}

// Funzione per eseguire lo scraping
async function performScraping(searchString, win) {
    const browser = await puppeteer.launch({
        executablePath: executablePath, // Aggiungi il percorso qui
        headless: true,
    });
    const page = await browser.newPage();
    const start_time = new Date();

    console.log('Navigando alla pagina...');
    win.webContents.send('status', 'Navigando alla pagina...');
    await page.goto(`https://www.google.com/localservices/prolist?hl=en-GB&gl=it&ssta=1&q=${encodeURIComponent(searchString)}&oq=${encodeURIComponent(searchString)}&src=2`, { waitUntil: 'domcontentloaded' });
    console.log(`Pagina caricata per la ricerca: ${searchString}`);
    win.webContents.send('status', `Pagina caricata per la ricerca: ${searchString}`);

    // Gestisce l'accettazione dei cookie
    const acceptAllButton = await page.$('button[aria-label="Accept all"]');
    if (acceptAllButton) {
        console.log('Cliccando sul pulsante "Accetta tutto"...');
        win.webContents.send('status', 'Cliccando sul pulsante "Accetta tutto"...');
        await acceptAllButton.click();
        await page.waitForTimeout(3000);
    } else {
        console.log('Nessun pulsante "Accetta tutto" trovato');
        win.webContents.send('status', 'Nessun pulsante "Accetta tutto" trovato');
    }

    let scrapeData = [];

    // Funzione per raccogliere i dati
    const getPageData = async () => {
        console.log('Inizio della raccolta dei dati...');
        win.webContents.send('status', 'Inizio della raccolta dei dati...');
        let cards = await page.evaluate(async () => {
            const organicCards = Array.from(document.querySelectorAll('div[data-test-id="organic-list-card"]'));
            console.log(`Trovate ${organicCards.length} schede su questa pagina.`);
            let cardData = [];
            for (const card of organicCards) {
                try {
                    const button = card.querySelector('div[role="button"] > div:first-of-type');
                    if (button && button.offsetParent !== null) {
                        console.log('Cliccando sulla scheda...');
                        button.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        const nome = document.querySelector(".tZPcob") ? document.querySelector(".tZPcob").innerText : "NESSUNO";
                        const phoneNumber = document.querySelector('[data-phone-number][role="button"][class*=" "]') ? document.querySelector('[data-phone-number][role="button"][class*=" "]').querySelector("div:last-of-type").innerHTML : "NESSUNO";
                        const website = document.querySelector(".iPF7ob > div:last-of-type") ? document.querySelector(".iPF7ob > div:last-of-type").innerHTML : "NESSUNO";
                        const indirizzo = document.querySelector(".fccl3c") ? document.querySelector(".fccl3c").innerText : "NESSUNO";
                        const recensioni = document.querySelector(".pNFZHb .rGaJuf") ? document.querySelector(".pNFZHb .rGaJuf").innerHTML : "NESSUNO";
                        const numeroRecensioni = document.querySelector(".QwSaG .leIgTe") ? document.querySelector(".QwSaG .leIgTe").innerHTML.replace(/\(|\)/g, "") : "NESSUNO";

                        cardData.push({
                            nome,
                            indirizzo,
                            telefono: phoneNumber === "NESSUNO" ? phoneNumber : phoneNumber,
                            website,
                            recensioni,
                            numeroRecensioni
                        });
                    }
                } catch (e) {
                    console.log('Errore durante l\'estrazione dei dati:', e);
                }
            }
            return cardData;
        });

        console.log(`Raccolte ${cards.length} schede.`);
        win.webContents.send('status', `Raccolte ${cards.length} schede.`);
        scrapeData = scrapeData.concat(cards);

        const nextButton = await page.$('button[aria-label="Next"]');
        if (nextButton) {
            try {
                console.log('Navigando alla pagina successiva...');
                win.webContents.send('status', 'Navigando alla pagina successiva...');
                await nextButton.click();
                await page.waitForTimeout(5000);
                await getPageData();
            } catch (e) {
                console.log('Errore nella navigazione, salvataggio dei dati...');
                win.webContents.send('status', 'Errore durante la navigazione, salvataggio dei dati...');
                await saveDataToCSV(win);
            }
        } else {
            console.log('Nessuna pagina successiva trovata, salvataggio dei dati...');
            win.webContents.send('status', 'Nessuna pagina successiva trovata, salvataggio dei dati...');
            await saveDataToCSV(win);
        }
    };

    const saveDataToCSV = async (win) => {
        try {
            console.log('Convertendo i dati in CSV...');
            win.webContents.send('status', 'Convertendo i dati in CSV...');
            const csv = await converter.json2csv(scrapeData);
            
            // Ottieni il percorso del Desktop dell'utente
            const desktopPath = app.getPath('desktop');
            // Percorso della cartella scrapingData
            const scrapingDataPath = path.join(desktopPath, 'scrapingData');
            
            // Crea la cartella se non esiste
            if (!fs.existsSync(scrapingDataPath)) {
                console.log('La cartella "scrapingData" non esiste, creandola...');
                win.webContents.send('status', 'Creando la cartella "scrapingData"...');
                fs.mkdirSync(scrapingDataPath);
            }

            // Percorso completo del file CSV
            const outputPath = path.join(scrapingDataPath, `output-${searchString}-${(Math.random() + 1).toString(36).substring(7)}.csv`);
            fs.writeFileSync(outputPath, csv, "utf-8");

            console.log(`[+] Record salvati nel file CSV.`);
            win.webContents.send('status', '[+] Dati salvati nel file CSV');
            console.log(`[successo] Scritti ${scrapeData.length} record in ${(Date.now() - start_time.getTime()) / 1000}s`);
            win.webContents.send('status', `[successo] Scritti ${scrapeData.length} record in ${(Date.now() - start_time.getTime()) / 1000}s`);
        } catch (error) {
            console.error('Errore durante il salvataggio del file CSV:', error);
            win.webContents.send('status', 'Errore durante il salvataggio del CSV');
        }
    };

    await getPageData();

    await page.close();
    await browser.close();
}

// Gestisci l'evento per avviare lo scraping tramite IPC (Inter-Process Communication)
ipcMain.handle('start-scraping', async (event, searchString) => {
    console.log(`Avvio dello scraping per: ${searchString}`);
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('status', 'Inizio dello scraping...');
    await performScraping(searchString, win);
});

// Avvia Electron
app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Chiudi quando tutte le finestre sono chiuse
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
