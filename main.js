const { app, BrowserWindow, ipcMain } = require('electron');
const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const converter = require('json-2-csv');
const fs = require('fs');
const path = require('path');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const start_time = new Date();

    console.log('Navigating to the page...');
    await page.goto(`https://www.google.com/localservices/prolist?hl=en-GB&gl=it&ssta=1&q=${encodeURIComponent(searchString)}&oq=${encodeURIComponent(searchString)}&src=2`, { waitUntil: 'domcontentloaded' });
    console.log(`Page loaded for search: ${searchString}`);

    // Gestisce l'accettazione dei cookie
    const acceptAllButton = await page.$('button[aria-label="Accept all"]');
    if (acceptAllButton) {
        console.log('Clicking "Accept All" button...');
        await acceptAllButton.click();
        await page.waitForTimeout(3000);
    } else {
        console.log('No "Accept All" button found');
    }

    let scrapeData = [];

    // Funzione per raccogliere i dati
    const getPageData = async () => {
        console.log('Starting data collection...');
        let cards = await page.evaluate(async () => {
            const organicCards = Array.from(document.querySelectorAll('div[data-test-id="organic-list-card"]'));
            console.log(`Found ${organicCards.length} cards on this page.`);
            let cardData = [];
            for (const card of organicCards) {
                try {
                    const button = card.querySelector('div[role="button"] > div:first-of-type');
                    if (button && button.offsetParent !== null) {
                        console.log('Clicking on the card...');
                        button.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        const name = document.querySelector(".tZPcob") ? document.querySelector(".tZPcob").innerText : "NONE";
                        const phoneNumber = document.querySelector('[data-phone-number][role="button"][class*=" "]') ? document.querySelector('[data-phone-number][role="button"][class*=" "]').querySelector("div:last-of-type").innerHTML : "NONE";
                        const website = document.querySelector(".iPF7ob > div:last-of-type") ? document.querySelector(".iPF7ob > div:last-of-type").innerHTML : "NONE";
                        const address = document.querySelector(".fccl3c") ? document.querySelector(".fccl3c").innerText : "NONE";
                        const rating = document.querySelector(".pNFZHb .rGaJuf") ? document.querySelector(".pNFZHb .rGaJuf").innerHTML : "NONE";
                        const ratingNumber = document.querySelector(".QwSaG .leIgTe") ? document.querySelector(".QwSaG .leIgTe").innerHTML.replace(/\(|\)/g, "") : "NONE";

                        cardData.push({
                            name,
                            address,
                            phone: phoneNumber === "NONE" ? phoneNumber : phoneNumber,
                            website,
                            rating,
                            ratingNumber
                        });
                    }
                } catch (e) {
                    console.log('Errore durante l\'estrazione dei dati:', e);
                }
            }
            return cardData;
        });

        console.log(`Collected ${cards.length} cards.`);
        scrapeData = scrapeData.concat(cards);

        const nextButton = await page.$('button[aria-label="Next"]');
        if (nextButton) {
            try {
                console.log('Navigating to next page...');
                await nextButton.click();
                await page.waitForTimeout(5000);
                await getPageData();
            } catch (e) {
                console.log('Errore nella navigazione, salvataggio dei dati...');
                await saveDataToCSV(win);
            }
        } else {
            console.log('Nessuna pagina successiva trovata, salvataggio dei dati...');
            await saveDataToCSV(win);
        }
    };

    const saveDataToCSV = async (win) => {
        try {
            console.log('Converting data to CSV...');
            const csv = await converter.json2csv(scrapeData);
            // Ottieni il percorso del Desktop dell'utente
            const desktopPath = app.getPath('desktop');
            const outputPath = path.join(desktopPath, `output-${searchString}-${(Math.random() + 1).toString(36).substring(7)}.csv`);
            fs.writeFileSync(outputPath, csv, "utf-8");
            console.log(`[+] Record salvati nel file CSV.`);
            console.log(`[success] Scritti ${scrapeData.length} record in ${(Date.now() - start_time.getTime()) / 1000}s`);
            win.webContents.send('status', 'Scraping completato');
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
    console.log(`Starting scraping for: ${searchString}`);
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
