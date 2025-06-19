const puppeteer = require("puppeteer-extra");
const converter = require("json-2-csv");
const fs = require("node:fs");
const path = require("path");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async () => {
  console.clear();
  console.log(`Ciao Morena\n------------------------`);

  rl.question(
    "Cosa vuoi cercare oggi? (separa con virgola per più query) ",
    async (input) => {
      const searchQueries = input
        .split(",")
        .map((q) => q.trim())
        .filter(Boolean);

      const browser = await puppeteer.launch({
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
      }); // metto false per debug
      const start_time = new Date();
      let allData = [];

      for (const searchString of searchQueries) {
        try {
          console.log(`\n🔍 Sto cercando: ${searchString}`);
          const data = await scrapePeopleAlsoAsk(searchString, browser);
          allData = allData.concat(
            data.map((d) => ({ ...d, searchQuery: searchString }))
          );
        } catch (err) {
          console.error(
            `[errore] Errore nella ricerca: ${searchString}`,
            err.message
          );
        }
      }

      await browser.close();
      rl.close();

      if (!fs.existsSync("./data")) fs.mkdirSync("./data");
      await saveData(allData, start_time);
    }
  );
})();

function askUserToSolveCaptcha() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(
      "\n[!] CAPTCHA rilevato. Risolvilo manualmente nel browser, poi premi INVIO per continuare...",
      () => {
        rl.close();
        resolve();
      }
    );
  });
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

async function scrapePeopleAlsoAsk(searchString, browser) {
  const page = await browser.newPage();

  const url = `https://www.google.com/search?hl=it&gl=it&ie=UTF-8&oe=UTF-8&q=${encodeURIComponent(
    searchString
  )}`;
  await page.goto(url, { waitUntil: "networkidle2" });

  // CAPTCHA
  if (await checkForCaptcha(page)) {
    console.log("[!] CAPTCHA rilevato!");
    await askUserToSolveCaptcha();
  }

  // Accetta i cookie, se presenti
  const acceptButton = await page.$(
    'button[aria-label="Accetta tutto"], button[aria-label="Accept all"]'
  );
  if (acceptButton) {
    console.log("[info] Accetto cookie...");
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

      console.log(`\n[process] Domanda #${results.length + 1}: "${question}"`);

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
                // Scarta testi da <script>, <style> o elementi non visibili
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

        console.log(
          `[success] Descrizione trovata: ${
            description ? description.slice(0, 80) + "..." : "[vuota]"
          }`
        );

        results.push({ question, description });

        if (results.length >= maxToProcess) break;
      } catch (e) {
        console.log(`[error] Errore nella domanda "${question}": ${e.message}`);
      }
    }

    await page.waitForTimeout(1500);
  }

  await page.close();
  return results;
}

async function saveData(data, start_time) {
  if (data.length === 0) {
    console.log("[!] Nessun dato da salvare.");
    return;
  }
  const csv = await converter.json2csv(data);
  const filename = `people_also_ask-${(Math.random() + 1)
    .toString(36)
    .substring(7)}.csv`;
  fs.writeFileSync(path.join("./data", filename), csv, "utf-8");
  console.log(`[+] Record salvati nel file CSV (${filename})`);
  console.log(
    `[success] Scritti ${data.length} record in ${
      (Date.now() - start_time.getTime()) / 1000
    }s`
  );
}
