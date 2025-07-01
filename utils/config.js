// Aggiungi il percorso dell'eseguibile di Chromium/Chrome
const executablePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; // Sostituisci con il percorso corretto

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const stopFlag = { value: false };

const puppeteer = require("puppeteer-extra");
const randomizingProxy = require("./randomProxy").randomizingProxy;

function launchBrowser({ headless = true, proxy = true } = {}) {
  const args = [
    `--user-agent=${DEFAULT_USER_AGENT}`,
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
  ];
  if (proxy) {
    args.unshift(`--proxy-server=${proxy}`);
  }
  return puppeteer.launch({
    executablePath,
    headless,
    args,
  });
}

module.exports = {
  executablePath,
  DEFAULT_USER_AGENT,
  stopFlag,
  launchBrowser,
  randomizingProxy
};