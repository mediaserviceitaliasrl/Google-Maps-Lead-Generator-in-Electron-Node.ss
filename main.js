const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const os = require('os');
const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const converter = require('json-2-csv');
const fs = require('fs');
const path = require('path');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const randomUseragent = require('random-useragent');
puppeteer.use(StealthPlugin());

// Aggiungi il percorso dell'eseguibile di Chromium/Chrome
const executablePath = '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome'; // Sostituisci con il percorso corretto

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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

// IPC per inviare il nome utente
ipcMain.handle('get-username', async () => {
    return os.userInfo().username;
});

// IPC handler for 'choose-folder' to open a folder dialog
ipcMain.handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

// Funzione per eseguire lo scraping
async function performScraping(searchString, scrapingType, folderPath, win) {
    if (scrapingType === 'maps') {
        await performMapsScraping(searchString, folderPath, win);
    } else if (scrapingType === 'faq') {
        await performFaqScraping(searchString, folderPath, win);
    } else {
        win.webContents.send('status', 'Tipo di scraping non valido.');
    }
}

// Gestisci l'evento per avviare lo scraping tramite IPC (Inter-Process Communication)
ipcMain.handle('start-scraping', async (event, searchString, scrapingType, folderPath) => {
    console.log(`Avvio dello scraping per: ${searchString} (${scrapingType})`);
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('status', 'Inizio dello scraping...');
    await performScraping(searchString, scrapingType, folderPath, win);
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

// --- Maps scraping logic ---
async function performMapsScraping(searchString, folderPath, win) {
    win.webContents.send('reset-logs'); // Reset logs at the start of every new search
    const userAgent = DEFAULT_USER_AGENT;
    let browser = await puppeteer.launch({
        executablePath: executablePath, // Aggiungi il percorso qui
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--disable-infobars",
            "--window-position=0,0",
            "--ignore-certifcate-errors",
            "--ignore-certifcate-errors-spki-list",
            "--disable-features=IsolateOrigins,site-per-process",
            "--start-maximized",
        ],
    });
    let page = await browser.newPage();
    await page.setUserAgent(userAgent);
    const start_time = new Date();
    let scrapeData = [];
    const url = `https://www.google.com/localservices/prolist?hl=en-GB&gl=it&ssta=1&q=${encodeURIComponent(searchString)}&oq=${encodeURIComponent(searchString)}&src=2`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Check for cookie consent or captcha
    let manualIntervention = false;
    // Cookie consent
    try {
        await page.waitForSelector('button[aria-label="Accetta tutto"], button[aria-label="Accept all"]', { timeout: 5000 });
        const acceptButton = await page.$('button[aria-label="Accetta tutto"], button[aria-label="Accept all"]');
        if (acceptButton) {
            await acceptButton.click();
            await page.waitForTimeout(2000);
        }
    } catch {
        // Try by text
        const clickedByText = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const texts = ["Accetta", "Accetta tutto", "Accept all"];
            for (const btn of btns) {
                if (texts.some(t => btn.textContent && btn.textContent.trim() === t)) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        if (!clickedByText) {
            manualIntervention = true;
        }
    }
    // Check for captcha (simple check for iframe or div)
    const captchaPresent = await page.$('iframe[src*="captcha"], div.g-recaptcha');
    if (captchaPresent) {
        manualIntervention = true;
    }
    if (manualIntervention) {
        await browser.close();
        // Launch new browser in headful mode
        browser = await puppeteer.launch({
            executablePath: executablePath,
            headless: false,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--disable-infobars",
                "--window-position=0,0",
                "--ignore-certifcate-errors",
                "--ignore-certifcate-errors-spki-list",
                "--disable-features=IsolateOrigins,site-per-process",
                "--start-maximized",
            ],
        });
        page = await browser.newPage();
        await page.setUserAgent(userAgent);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        win.webContents.send('user-action-required', 'Intervento manuale richiesto! Accetta/rifiuta i cookie o risolvi il CAPTCHA, poi clicca Continua per proseguire.');
        await new Promise(resolve => {
            ipcMain.once('user-action-confirmed', () => resolve());
        });
    }
    // ... continue with scraping logic ...
}

// --- FAQ scraping logic ---
let lastSearchId = 0;
function sendStatus(win, message, searchId) {
    if (searchId !== lastSearchId) {
        win.webContents.send('reset-logs');
        lastSearchId = searchId;
    }
    win.webContents.send('status', message);
}

async function performFaqScraping(searchString, folderPath, win) {
    const searchId = Date.now();
    const userAgent = DEFAULT_USER_AGENT;
    const width = 1280 + Math.floor(Math.random() * 400);
    const height = 800 + Math.floor(Math.random() * 200);
    // Proxy support
    let proxyArg = [];
    if (process.env.HTTP_PROXY) {
        proxyArg = [`--proxy-server=${process.env.HTTP_PROXY}`];
    }
    const browser = await puppeteer.launch({
        executablePath: executablePath,
        headless: false, // headful mode is less likely to trigger CAPTCHA
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--disable-infobars",
            "--window-position=0,0",
            "--ignore-certifcate-errors",
            "--ignore-certifcate-errors-spki-list",
            "--disable-features=IsolateOrigins,site-per-process",
            "--start-maximized",
            ...proxyArg
        ],
    });
    const start_time = new Date();
    let allData = [];
    try {
        sendStatus(win, `\n🔍 Sto cercando: ${searchString}`, searchId);
        const data = await scrapePeopleAlsoAsk(searchString, browser, win, userAgent, width, height, searchId);
        allData = allData.concat(data.map((d) => ({ ...d, searchQuery: searchString })));
    } catch (err) {
        sendStatus(win, `[errore] Errore nella ricerca: ${searchString} - ${err.message}`, searchId);
    }
    await browser.close();
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    await saveFaqData(allData, start_time, folderPath, win, searchId);
}

async function checkForCaptcha(page) {
    const captchaSelector = '#captcha, iframe[src*="captcha"], div.g-recaptcha';
    try {
        await page.waitForSelector(captchaSelector, { timeout: 3000 });
        return true;
    } catch {
        return false;
    }
}

// Add a helper to wait for user confirmation from the frontend
async function waitForUserConfirmation(win, message) {
    win.webContents.send('user-action-required', message);
    await new Promise(resolve => {
        ipcMain.once('user-action-confirmed', () => resolve());
    });
}

async function scrapePeopleAlsoAsk(searchString, browser, win, userAgent, width, height, searchId) {
    let page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport({ width, height });
   
    const url = `https://www.google.com/search?q=${encodeURIComponent(searchString)}&rlz=1C5CHFA_enIT1100IT1101&oq=${encodeURIComponent(searchString)}&gs_lcrp=EgZjaHJvbWUqBggAEEUYOzIGCAAQRRg7MgYIARBFGDsyBggCEEUYOTIGCAMQRRg7MgYIBBBFGDzSAQc3MzRqMGo5qAIDsAIB&sourceid=chrome&ie=UTF-8`;
    await page.goto(url, { waitUntil: "networkidle2" });
    // CAPTCHA
    if (await checkForCaptcha(page)) {
        // Close headless browser
        await browser.close();
        // Launch new browser in headful mode
        const browser2 = await puppeteer.launch({
            executablePath: executablePath,
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--disable-infobars",
                "--window-position=0,0",
                "--ignore-certifcate-errors",
                "--ignore-certifcate-errors-spki-list",
                "--disable-features=IsolateOrigins,site-per-process",
                "--start-maximized",
            ],
        });
        page = await browser2.newPage();
        await page.setUserAgent(userAgent);
        await page.setViewport({ width, height });
        await page.goto(url, { waitUntil: "networkidle2" });
        await waitForUserConfirmation(win, 'CAPTCHA rilevato! Risolvilo manualmente nel browser, poi conferma per continuare.');
        // Continue with the new browser/page
        browser = browser2;
    }
    // Cookie consent
    let cookieClicked = false;
    try {
        await page.waitForSelector('button[aria-label="Accetta tutto"], button[aria-label="Accept all"]', { timeout: 5000 });
        const acceptButton = await page.$('button[aria-label="Accetta tutto"], button[aria-label="Accept all"]');
        if (acceptButton) {
            sendStatus(win, "[info] Accetto cookie...", searchId);
            await acceptButton.click();
            await page.waitForTimeout(2000);
            cookieClicked = true;
        }
    } catch {
        // No aria-label button found, try by text
    }
    if (!cookieClicked) {
        // Try to find and click by button text
        const clickedByText = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const texts = ["Accetta", "Accetta tutto", "Accept all"];
            for (const btn of btns) {
                if (texts.some(t => btn.textContent && btn.textContent.trim() === t)) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        if (clickedByText) {
            sendStatus(win, "[info] Accetto cookie (testo)...", searchId);
            await page.waitForTimeout(2000);
        } else {
            // If still not handled, ask the user to do it manually
            await waitForUserConfirmation(win, 'Per favore accetta o rifiuta i cookie manualmente nel browser, poi conferma per continuare.');
        }
    }
    try {
        await page.waitForSelector("div.related-question-pair[data-q]", { timeout: 5000 });
    } catch {
        sendStatus(win, '[!] Nessuna domanda trovata.', searchId);
        await page.close();
        return [];
    }
    let results = [];
    let processedQuestions = new Set();
    let maxToProcess = 50;
    let lastLength = -1;
    // Add random delay helper
    function randomDelay(min = 1000, max = 2500) {
        return new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));
    }
    while (results.length < maxToProcess) {
        const faqContainers = await page.$$("div.related-question-pair[data-q]");
        if (faqContainers.length === lastLength) break;
        lastLength = faqContainers.length;
        for (let i = 0; i < faqContainers.length; i++) {
            const container = faqContainers[i];
            const question = await container.evaluate((el) => el.getAttribute("data-q"));
            if (processedQuestions.has(question)) continue;
            processedQuestions.add(question);
            await randomDelay(1200, 2500);
            sendStatus(win, `[process] Domanda #${results.length + 1}: "${question}"`, searchId);
            try {
                await container.click();
                await randomDelay(1200, 2500);
                const description = await page.evaluate((question) => {
                    const pairNode = Array.from(
                        document.querySelectorAll("div.related-question-pair[data-q]")
                    ).find((el) => el.getAttribute("data-q") === question);
                    if (!pairNode) return "";
                    const parent = pairNode.parentElement;
                    if (!parent) return "";
                    const walker = document.createNodeIterator(
                        parent,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: (node) => {
                                const tagName = node.parentElement?.tagName;
                                if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(tagName))
                                    return NodeFilter.FILTER_SKIP;
                                return node.nodeValue.trim()
                                    ? NodeFilter.FILTER_ACCEPT
                                    : NodeFilter.FILTER_SKIP;
                            },
                        }
                    );
                    let node, text = "";
                    while ((node = walker.nextNode())) {
                        text += node.nodeValue.trim() + " ";
                    }
                    return text.trim();
                }, question);
                sendStatus(win, `[success] Descrizione trovata: ${description ? description.slice(0, 80) + "..." : "[vuota]"}`, searchId);
                results.push({ question, description });
                if (results.length >= maxToProcess) break;
            } catch (e) {
                sendStatus(win, `[error] Errore nella domanda "${question}": ${e.message}`, searchId);
            }
        }
        await randomDelay(1500, 3000);
    }
    await page.close();
    return results;
}

async function saveFaqData(data, start_time, folderPath, win, searchId) {
    if (data.length === 0) {
        sendStatus(win, "[!] Nessun dato da salvare.", searchId);
        return;
    }
    const csv = await converter.json2csv(data);
    const filename = `people_also_ask-${(Math.random() + 1).toString(36).substring(7)}.csv`;
    const outputPath = path.join(folderPath, filename);
    fs.writeFileSync(outputPath, csv, "utf-8");
    sendStatus(win, `[+] Record salvati nel file CSV (${filename})`, searchId);
    sendStatus(win, `[success] Scritti ${data.length} record in ${(Date.now() - start_time.getTime()) / 1000}s`, searchId);
}
