const puppeteer = require("puppeteer-extra");
const cheerio = require("cheerio");
const converter = require("json-2-csv");
const fs = require("fs");
const path = require("path");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const randomUseragent = require("random-useragent");
const axios = require("axios");
const removeDuplicates = require("../utils/removeDuplicates").removeDuplicates;
const {executablePath,DEFAULT_USER_AGENT, stopFlag, launchBrowser } = require("../utils/config")


puppeteer.use(StealthPlugin());
stopFlag.value = false; // to reset


// --- Maps scraping logic ---
async function performMapsScraping(searchString, folderPath, win, headless, useProxy = false, customProxy = "") {
  win.webContents.send("reset-logs");
  stopRequested = false;
  const searchQueries = searchString
    .split(",")
    .map((q) => q.trim())
    .filter(Boolean);
  let allData = [];
  for (const query of searchQueries) {
    if (stopFlag.value) {
      win.webContents.send('status', '[STOP] Scraping interrotto dall\'utente. Salvataggio dati...');
      break;
    }
    try {
      let proxyToUse = null;
      if (useProxy) {
        proxyToUse = customProxy;
        win.webContents.send('status', `🧭 Proxy in uso: ${proxyToUse}`);
      }
      win.webContents.send("status", `\n🔍 Sto cercando: ${query}`);
      const browser = await launchBrowser({ headless, proxy: proxyToUse });
      const data = await scrapeGoogleMaps(query, browser, win);
      allData = allData.concat(data.map((d) => ({ ...d, searchQuery: query })));
      await browser.close();
    } catch (err) {
      win.webContents.send(
        "status",
        `[errore] Errore nella ricerca: ${query} - ${err.message}`
      );
    }
  }
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  // Remove duplicates before saving
  const beforeDedup = allData.length;
  allData = removeDuplicates(allData);
  const afterDedup = allData.length;
  const removed = beforeDedup - afterDedup;
  win.webContents.send('status', `[info] Rimossi ${removed} duplicati prima del salvataggio.`);
  await saveMapsData(allData, new Date(), folderPath, win, searchQueries);
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
        if (window.stopFlagValue) break;
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

module.exports = {
    performMapsScraping,
    scrapeGoogleMaps,
    extractMail,
    saveMapsData,
};