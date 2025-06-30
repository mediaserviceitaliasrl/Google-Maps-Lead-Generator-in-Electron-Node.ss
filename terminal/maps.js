const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const converter = require('json-2-csv');
const axios = require('axios');
const fs = require("node:fs");
const path = require('path');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

(async () => {
    console.clear();
    console.log(`Ciao Morena\n------------------------`);

    rl.question('Cosa vuoi cercare oggi? (separa con virgola per più query) ', async (input) => {
        const searchQueries = input.split(',').map(q => q.trim()).filter(Boolean);

        const browser = await puppeteer.launch({ headless: false });
        const start_time = new Date();
        let allData = [];

        for (const searchString of searchQueries) {
            try {
                console.log(`\n🔍 Sto cercando: ${searchString}`);
                const data = await scrapeGoogle(searchString, browser);
                allData = allData.concat(data.map(d => ({ ...d, searchQuery: searchString })));
            } catch (err) {
                console.error(`[errore] Errore nella ricerca: ${searchString}`, err.message);
            }
        }

        await browser.close();
        rl.close();

        if (!fs.existsSync('./data')) fs.mkdirSync('./data');
        await saveData(allData, start_time);
    });
})();

async function scrapeGoogle(searchString, browser) {
    const page = await browser.newPage();
    let scrapeData = [];

    const url = `https://www.google.com/localservices/prolist?hl=en-GB&gl=it&ssta=1&q=${encodeURIComponent(searchString)}&oq=${encodeURIComponent(searchString)}&src=2`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const acceptAllButton = await page.$('button[aria-label="Accept all"]');
    if (acceptAllButton) await acceptAllButton.click();
    await page.waitForTimeout(3000);

    const getPageData = async () => {
        let cards = await page.evaluate(async () => {
            const organicCards = Array.from(document.querySelectorAll('div[data-test-id="organic-list-card"]'));
            let cardData = [];

            for (const card of organicCards) {
                try {
                    await card.querySelector('div[role="button"] > div:first-of-type').click();
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    const name = document.querySelector(".tZPcob")?.innerText || "NONE";
                    const phoneNumber = document.querySelector('[data-phone-number][role="button"][class*=" "]')?.querySelector("div:last-of-type")?.innerHTML || "NONE";
                    const website = document.querySelector(".iPF7ob > div:last-of-type")?.innerHTML || "NONE";
                    const address = document.querySelector(".fccl3c")?.innerText || "NONE";
                    const rating = document.querySelector(".pNFZHb .rGaJuf")?.innerHTML || "NONE";
                    const ratingNumber = document.querySelector(".QwSaG .leIgTe")?.innerHTML.replace(/\(|\)/g, "") || "NONE";

                    cardData.push({ name, address, phone: phoneNumber, website, rating, ratingNumber });
                } catch (e) {
                    // Non bloccare il ciclo in caso di errori su singola scheda
                    console.log(e);
                }
            }
            return cardData;
        });

        cards = await Promise.all(cards.map(async c => {
            if (c.website === "NONE" || !c.website) return c;
            try {
                const websiteURL = c.website.startsWith("http") ? c.website : `https://${c.website}`;
                const response = await axios.get(websiteURL);
                c.mail = extractMail(response.data) || null;
                return c;
            } catch (e) {
                c.mail = null;
                return c;
            }
        }));

        scrapeData = scrapeData.concat(cards);
        console.log(`[data] Scritti ${cards.length} record, continuando alla prossima pagina se disponibile`);

        const nextButton = await page.$('button[aria-label="Next"]');
        if (nextButton) {
            try {
                await nextButton.click();
                await page.waitForTimeout(5000);
                await getPageData();
            } catch (e) {
                console.error('[!] Errore clic su pagina successiva:', e.message);
            }
        }
    };

    await getPageData();
    await page.close();
    return scrapeData;
}

async function saveData(data, start_time) {
    if (data.length === 0) {
        console.log('[!] Nessun dato da salvare.');
        return;
    }
    const csv = await converter.json2csv(data);
    const filename = `output-${(Math.random() + 1).toString(36).substring(7)}.csv`;
    fs.writeFileSync(path.join('./data', filename), csv, "utf-8");
    console.log(`[+] Record salvati nel file CSV (${filename})`);
    console.log(`[success] Scritti ${data.length} record in ${(Date.now() - start_time.getTime()) / 1000}s`);
}

function extractMail(html) {
    const $ = cheerio.load(html);
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    let email = null;
    $('body *').each((index, element) => {
        const text = $(element).text();
        const matches = text.match(emailRegex);
        if (matches && matches.length > 0) {
            email = matches[0];
            return false; // break each loop
        }
    });
    return email;
}
