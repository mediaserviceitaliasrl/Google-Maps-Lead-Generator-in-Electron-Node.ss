const puppeteer = require("puppeteer-extra");
const cheerio = require("cheerio");
const { ipcMain } = require('electron');
const converter = require("json-2-csv");
const fs = require("fs");
const path = require("path");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const randomUseragent = require("random-useragent");
const {executablePath,DEFAULT_USER_AGENT, stopFlag, launchBrowser } = require("../utils/config")


puppeteer.use(StealthPlugin());

stopFlag.value = false; // to reset

// --- FAQ scraping logic ---
async function performFaqScraping(searchString, folderPath, win, headless, useProxy = false, customProxy = "") {
  win.webContents.send("reset-logs");
  stopFlag.value = false; // Reset stop flag at the start
  const searchQueries = searchString.split(',').map(q => q.trim()).filter(Boolean);
  let allData = [];
  for (const query of searchQueries) {
    if (stopFlag.value) {
      win.webContents.send('status', '[STOP] Scraping interrotto dall\'utente. Salvataggio dati...');
      break;
    }
    let retry = true;
    let page = null;
    while (retry) {
      try {
        win.webContents.send('status', `\n🔍 Sto cercando: ${query}`);
        let proxyToUse = null;
        if (useProxy) {
          proxyToUse = customProxy;
          win.webContents.send('status', `🧭 Proxy in uso: ${proxyToUse}`);
        }
        const browser = await launchBrowser({ headless, proxy: proxyToUse });
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
        await browser.close();
      } catch (err) {
        win.webContents.send('status', `[errore] Errore nella ricerca: ${query} - ${err.message}`);
        retry = false;
        if (page) await page.close();
      }
    }
  }
  await saveFaqData(allData, new Date(), folderPath, win);
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
  let maxToProcess = 50;
  let lastLength = -1;
  while (results.length < maxToProcess) {
    if (stopFlag.value) {
      win.webContents.send('status', '[STOP] Scraping interrotto dall\'utente. Salvataggio dati...');
      break;
    }
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

module.exports = {
    performFaqScraping,
    scrapePeopleAlsoAsk,
    checkForCaptcha,
    askUserToSolveCaptcha,
    saveFaqData
};