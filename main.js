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
const { randomizingProxy } = require("./randomProxy");
const dns = require("dns").promises;
puppeteer.use(StealthPlugin());

// Aggiungi il percorso dell'eseguibile di Chromium/Chrome
const executablePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; // Sostituisci con il percorso corretto

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

let stopRequested = false;
ipcMain.on('stop-scraping', () => {
  stopRequested = true;
});

// Funzione per eseguire lo scraping
async function performScraping(
  searchString,
  scrapingType,
  folderPath,
  win,
  headless,
  dnsRecordTypes,
  doAMail
) {
  if (scrapingType === "maps") {
    await performMapsScraping(searchString, folderPath, win, headless);
  } else if (scrapingType === "faq") {
    await performFaqScraping(searchString, folderPath, win, headless);
  } else if (scrapingType === "dns") {
    await performDnsScraping(searchString, folderPath, win, dnsRecordTypes, doAMail);
  } else {
    win.webContents.send("status", "Tipo di scraping non valido.");
  }
}

// Gestisci l'evento per avviare lo scraping tramite IPC (Inter-Process Communication)
ipcMain.handle(
  "start-scraping",
  async (event, searchString, scrapingType, folderPath, headless, dnsRecordTypes, doAMail) => {
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
      doAMail
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

// --- Maps scraping logic ---
async function performMapsScraping(searchString, folderPath, win, headless) {
  win.webContents.send("reset-logs");
  stopRequested = false;
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
   const currentProxy = randomizingProxy();
  const searchQueries = searchString
    .split(",")
    .map((q) => q.trim())
    .filter(Boolean);
  const browser = await puppeteer.launch({
    executablePath: executablePath,
    headless: headless,
    args: [
    //   `--proxy-server=143.110.217.153:1080`,
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
  const start_time = new Date();
  let allData = [];
  for (const query of searchQueries) {
    if (stopRequested) {
      win.webContents.send('status', '[STOP] Scraping interrotto dall\'utente. Salvataggio dati...');
      break;
    }
    try {
        const currentProxy = randomizingProxy();
        win.webContents.send("status", `\n🔍 Sto cercando: ${query}`);
           // Proxy in uso
            win.webContents.send('status', `🧭 Proxy in uso: ${currentProxy}`);
       

      const data = await scrapeGoogleMaps(query, browser, win);
      allData = allData.concat(data.map((d) => ({ ...d, searchQuery: query })));
    } catch (err) {
      win.webContents.send(
        "status",
        `[errore] Errore nella ricerca: ${query} - ${err.message}`
      );
    }
  }
  await browser.close();
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  // Remove duplicates before saving
  const beforeDedup = allData.length;
  allData = removeDuplicates(allData);
  const afterDedup = allData.length;
  const removed = beforeDedup - afterDedup;
  win.webContents.send('status', `[info] Rimossi ${removed} duplicati prima del salvataggio.`);
  await saveMapsData(allData, start_time, folderPath, win, searchQueries);
}

async function scrapeGoogleMaps(searchString, browser, win) {
  const page = await browser.newPage();
  let scrapeData = [];
  const url = `https://www.google.com/localservices/prolist?hl=en-GB&gl=it&ssta=1&q=${encodeURIComponent(
    searchString
  )}&oq=${encodeURIComponent(searchString)}&src=2`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const acceptAllButton = await page.$(
    'button[aria-label="Accept all"], button[aria-label="Accetta tutto"]'
  );
  if (acceptAllButton) {
    await acceptAllButton.click();
    await page.waitForTimeout(3000);
  }
  const getPageData = async () => {
    let cards = await page.evaluate(async () => {
      const organicCards = Array.from(
        document.querySelectorAll('div[data-test-id="organic-list-card"]')
      );
      let cardData = [];
      for (const card of organicCards) {
        try {
          await card
            .querySelector('div[role="button"] > div:first-of-type')
            .click();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const name = document.querySelector(".tZPcob")?.innerText || "NONE";
          const phoneNumber =
            document
              .querySelector('[data-phone-number][role="button"][class*=" "]')
              ?.querySelector("div:last-of-type")?.innerHTML || "NONE";
          const website =
            document.querySelector(".iPF7ob > div:last-of-type")?.innerHTML ||
            "NONE";
          const address =
            document.querySelector(".fccl3c")?.innerText || "NONE";
          const rating =
            document.querySelector(".pNFZHb .rGaJuf")?.innerHTML || "NONE";
          const ratingNumber =
            document
              .querySelector(".QwSaG .leIgTe")
              ?.innerHTML.replace(/\(|\)/g, "") || "NONE";
          cardData.push({
            name,
            address,
            phone: phoneNumber,
            website,
            rating,
            ratingNumber,
          });
        } catch (e) {
          // Non bloccare il ciclo in caso di errori su singola scheda
        }
      }
      return cardData;
    });
    cards = await Promise.all(
      cards.map(async (c) => {
        if (c.website === "Nessun Sito" || !c.website) return c;
        try {
          const websiteURL = c.website.startsWith("http")
            ? c.website
            : `https://${c.website}`;
          const response = await axios.get(websiteURL);
          c.mail = extractMail(response.data) || null;
          return c;
        } catch (e) {
          c.mail = null;
          return c;
        }
      })
    );
    scrapeData = scrapeData.concat(cards);
    win.webContents.send(
      "status",
      `[data] Scritti ${cards.length} record, continuando alla prossima pagina se disponibile`
    );
    const nextButton = await page.$('button[aria-label="Next"]');
    if (nextButton) {
      try {
        await nextButton.click();
        await page.waitForTimeout(5000);
        await getPageData();
      } catch (e) {
        win.webContents.send(
          "status",
          `[!] Errore clic su pagina successiva: ${e.message}`
        );
      }
    }
  };
  await getPageData();
  await page.close();
  return scrapeData;
}

function extractMail(html) {
  const $ = cheerio.load(html);
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let email = null;
  $("body *").each((index, element) => {
    const text = $(element).text();
    const matches = text.match(emailRegex);
    if (matches && matches.length > 0) {
      email = matches[0];
      return false;
    }
  });
  return email;
}

async function saveMapsData(data, start_time, folderPath, win, searchQueries) {
  if (data.length === 0) {
    win.webContents.send("status", "[!] Nessun dato da salvare.");
    return;
  }
  const csv = await converter.json2csv(data);
  // Sanitize and join queries for filename
  let queriesStr = searchQueries
    .join("_")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "");
  if (queriesStr.length > 40) queriesStr = queriesStr.slice(0, 40) + "...";
  const filename = `maps_output-${queriesStr}-${(Math.random() + 1)
    .toString(36)
    .substring(7)}.csv`;
  fs.writeFileSync(path.join(folderPath, filename), csv, "utf-8");
  win.webContents.send(
    "status",
    `[+] Record salvati nel file CSV (${filename})`
  );
  win.webContents.send(
    "status",
    `[success] Scritti ${data.length} record in ${
      (Date.now() - start_time.getTime()) / 1000
    }s`
  );
}

// Utility function to remove duplicates by name and address
function removeDuplicates(data) {
  const seen = new Set();
  return data.filter(item => {
    const key = `${item.name}|${item.address}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// --- FAQ scraping logic ---
async function performFaqScraping(searchString, folderPath, win, headless) {
  win.webContents.send("reset-logs");
  stopRequested = false;
  const searchQueries = searchString.split(',').map(q => q.trim()).filter(Boolean);
  const browser = await puppeteer.launch({
    executablePath: executablePath,
    headless: headless,
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
  const start_time = new Date();
  let allData = [];
  for (const query of searchQueries) {
    if (stopRequested) {
      win.webContents.send('status', '[STOP] Scraping interrotto dall\'utente. Salvataggio dati...');
      break;
    }
    let retry = true;
    let page = null;
    while (retry) {
      try {
        win.webContents.send('status', `\n🔍 Sto cercando: ${query}`);
        const result = await scrapePeopleAlsoAsk(query, browser, win, page);
        if (result && result.captcha) {
          // Wait for user confirmation from frontend
          await new Promise(resolve => {
            ipcMain.once('user-action-confirmed', () => resolve());
          });
          // After confirmation, retry the same query with the same page
          page = result.page;
        } else {
          allData = allData.concat(result.map(d => ({ ...d, searchQuery: query })));
          retry = false;
          if (result && result.page) await result.page.close();
        }
      } catch (err) {
        win.webContents.send('status', `[errore] Errore nella ricerca: ${query} - ${err.message}`);
        retry = false;
        if (page) await page.close();
      }
    }
  }
  await browser.close();
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  await saveFaqData(allData, start_time, folderPath, win);
}

async function scrapePeopleAlsoAsk(
  searchString,
  browser,
  win,
  existingPage = null
) {
  const page = existingPage || (await browser.newPage());
  if (!existingPage) {
    const url = `https://www.google.com/search?hl=it&gl=it&ie=UTF-8&oe=UTF-8&q=${encodeURIComponent(
      searchString
    )}`;
    await page.goto(url, { waitUntil: "networkidle2" });
  }
  // CAPTCHA
  if (await checkForCaptcha(page)) {
    win.webContents.send(
      "user-action-required",
      "[!] CAPTCHA rilevato! Risolvilo manualmente nel browser, poi clicca 'Continua' per proseguire."
    );
    // Do NOT close the page; return it for reuse
    return { captcha: true, page };
  }
  // Accetta i cookie, se presenti
  const acceptButton = await page.$(
    'button[aria-label="Accetta tutto"], button[aria-label="Accept all"]'
  );
  if (acceptButton) {
    win.webContents.send("status", "[info] Accetto cookie...");
    await acceptButton.click();
    await page.waitForTimeout(2000);
  }
  await page.waitForSelector("div.related-question-pair[data-q]", {
    timeout: 5000,
  });
  let results = [];
  let processedQuestions = new Set();
  let maxToProcess = 100;
  let lastLength = -1;
  while (results.length < maxToProcess) {
    const faqContainers = await page.$$("div.related-question-pair[data-q]");
    if (faqContainers.length === lastLength) break;
    lastLength = faqContainers.length;
    for (let i = 0; i < faqContainers.length; i++) {
      const container = faqContainers[i];
      const question = await container.evaluate((el) =>
        el.getAttribute("data-q")
      );
      if (processedQuestions.has(question)) continue;
      processedQuestions.add(question);
      win.webContents.send(
        "status",
        `\n[process] Domanda #${results.length + 1}: "${question}"`
      );
      try {
        await container.click();
        await page.waitForTimeout(1200);
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
          let node,
            text = "";
          while ((node = walker.nextNode())) {
            text += node.nodeValue.trim() + " ";
          }
          return text.trim();
        }, question);
        win.webContents.send(
          "status",
          `[success] Descrizione trovata: ${
            description ? description.slice(0, 80) + "..." : "[vuota]"
          }`
        );
        results.push({ question, description });
        if (results.length >= maxToProcess) break;
      } catch (e) {
        win.webContents.send(
          "status",
          `[error] Errore nella domanda "${question}": ${e.message}`
        );
      }
    }
    await page.waitForTimeout(1500);
  }
  return results;
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

function askUserToSolveCaptcha() {
  return new Promise((resolve) => {
    // For Electron, you may want to show a dialog or just wait for user action in the browser
    // Here, we just resolve after a short delay for demo
    setTimeout(resolve, 10000); // Wait 10 seconds for manual captcha
  });
}

async function saveFaqData(data, start_time, folderPath, win) {
  if (data.length === 0) {
    win.webContents.send("status", "[!] Nessun dato da salvare.");
    return;
  }
  const csv = await converter.json2csv(data);
  const filename = `people_also_ask-${(Math.random() + 1)
    .toString(36)
    .substring(7)}.csv`;
  fs.writeFileSync(path.join(folderPath, filename), csv, "utf-8");
  win.webContents.send(
    "status",
    `[+] Record salvati nel file CSV (${filename})`
  );
  win.webContents.send(
    "status",
    `[success] Scritti ${data.length} record in ${
      (Date.now() - start_time.getTime()) / 1000
    }s`
  );
}

// --- DNS scraping logic ---
async function performDnsScraping(searchString, folderPath, win, dnsRecordTypes, doAMail) {
  win.webContents.send("reset-logs");
  stopRequested = false;
  const domains = searchString
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const start_time = new Date();
  let allData = [];
  for (const domain of domains) {
    if (stopRequested) {
      win.webContents.send('status', '[STOP] Scraping interrotto dall\'utente. Salvataggio dati...');
      break;
    }
    win.webContents.send("status", `\n🔍 Controllo DNS per: ${domain}`);
    let record = { domain };
    for (const type of dnsRecordTypes) {
      try {
        let result = await dns.resolve(domain, type);
        record[type] = JSON.stringify(result);
        win.webContents.send("status", `[success] ${type} trovato per ${domain}: ${JSON.stringify(result)}`);
      } catch (e) {
        record[type] = null;
        win.webContents.send("status", `[info] Nessun record ${type} per ${domain} (${e.code || e.message})`);
      }
    }
    // Lookup mail.domain A record if requested
    if (doAMail) {
      const mailDomain = `mail.${domain}`;
      try {
        let mailA = await dns.resolve(mailDomain, 'A');
        record['mail_A'] = JSON.stringify(mailA);
        win.webContents.send("status", `[success] A record trovato per ${mailDomain}: ${JSON.stringify(mailA)}`);
      } catch (e) {
        record['mail_A'] = null;
        win.webContents.send("status", `[info] Nessun A record per ${mailDomain} (${e.code || e.message})`);
      }
    }
    allData.push(record);
  }
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  await saveDnsData(allData, start_time, folderPath, win, dnsRecordTypes, doAMail);
}

async function saveDnsData(data, start_time, folderPath, win, dnsRecordTypes, doAMail) {
  if (data.length === 0) {
    win.webContents.send("status", "[!] Nessun dato da salvare.");
    return;
  }
  const csv = await converter.json2csv(data);
  let queriesStr = `dns_${dnsRecordTypes.join("_")}${doAMail ? '_A_MAIL' : ''}`;
  const filename = `dns_output-${queriesStr}-${(Math.random() + 1)
    .toString(36)
    .substring(7)}.csv`;
  fs.writeFileSync(path.join(folderPath, filename), csv, "utf-8");
  win.webContents.send(
    "status",
    `[+] Record salvati nel file CSV (${filename})`
  );
  win.webContents.send(
    "status",
    `[success] Scritti ${data.length} record in ${
      (Date.now() - start_time.getTime()) / 1000
    }s`
  );
  win.webContents.send(
    "status",
    `[log] CSV DNS salvato: ${filename}`
  );
}
