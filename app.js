const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const converter = require('json-2-csv');
const fs = require("node:fs");
const path = require('path'); // Importa il modulo 'path' per gestire i percorsi
const readline = require('readline'); // Importa il modulo readline per leggere l'input da console

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Crea un'interfaccia readline per l'input da console
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

(async () => {
    console.clear();
    console.log(`Ciao Morena\n------------------------`);

    // Chiedi all'utente cosa vuole cercare
    rl.question('Cosa vuoi cercare oggi? ', async (searchString) => {
        
        console.log(`Sto cercando per: ${searchString}`);

        // Verifica se la cartella ./data esiste, altrimenti la crea
        const dataDir = './data';
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }

        const browser = await puppeteer.launch({ headless: true });

        const page = await browser.newPage();
        const start_time = new Date();

        // Vai alla pagina dei risultati di ricerca
        await page.goto(`https://www.google.com/localservices/prolist?hl=en-GB&gl=it&ssta=1&q=${encodeURIComponent(searchString)}&oq=${encodeURIComponent(searchString)}&src=2`);

        // Accetta tutti i cookie, se il pulsante appare
        const acceptAllButton = await page.$('button[aria-label="Accept all"]');
        if (acceptAllButton) {
            await acceptAllButton.click();
        }

        await page.waitForTimeout(3000);

        let scrapeData = [];
        const getPageData = async () => {
            // Estrai i dati dalle carte delle attività sulla pagina
            let cards = await page.evaluate(async () => {
                const organicCards = Array.from(document.querySelectorAll('div[data-test-id="organic-list-card"]'));

                let cardData = [];
                for (const card of organicCards) {
                    try {
                        // Clicca sulla carta per caricare i dettagli aggiuntivi
                        await card.querySelector('div[role="button"] > div:first-of-type').click();
                        await new Promise(resolve => setTimeout(() => resolve(), 1000));

                        // Estrai i dati come nome, numero di telefono, sito web, ecc.
                        const name = document.querySelector(".tZPcob") ? document.querySelector(".tZPcob").innerText : "NONE";
                        const phoneNumber = document.querySelector('[data-phone-number][role="button"][class*=" "]') ? document.querySelector('[data-phone-number][role="button"][class*=" "]').querySelector("div:last-of-type").innerHTML : "NONE";
                        const website = document.querySelector(".iPF7ob > div:last-of-type") ? document.querySelector(".iPF7ob > div:last-of-type").innerHTML : "NONE";
                        const address = document.querySelector(".fccl3c") ? document.querySelector(".fccl3c").innerText : "NONE";
                        const rating = document.querySelector(".pNFZHb .rGaJuf").innerHTML ? document.querySelector(".pNFZHb .rGaJuf").innerHTML : "NONE";
                        const ratingNumber = document.querySelector(".QwSaG .leIgTe").innerHTML.replace(/\(|\)/g, "");
                        cardData.push({
                            name,
                            address,
                            phone: phoneNumber == "NONE" ? phoneNumber : phoneNumber,
                            website,
                            rating,
                            ratingNumber
                        });
                    } catch (e) {
                        // Gestione degli errori durante l'estrazione dei dati
                        console.log(e);
                    }
                }

                return cardData;
            });

            // Sezione commentata per l'estrazione dell'anno di copyright dai siti web
            /*
            // Elabora i dati estratti e estrai l'anno di copyright dai siti web
            cards = await Promise.all(await cards.map(async c => {
                if (c.website == "NONE" || !c.website) return c;  // Se non c'è un sito web, non fare nulla

                try {
                    // Aggiungi "https://" se il sito non include il protocollo
                    let websiteURL = c.website.includes("http") ? c.website : `https://${c.website}`;

                    // Fai una richiesta HTTP per ottenere il contenuto del sito
                    const websiteContent = await fetch(websiteURL);
                    const websiteHTML = await websiteContent.text();

                    // Estrai l'anno di copyright dal sito
                    const copyrightYears = extractCopyrightYear(websiteHTML);

                    // Aggiungi l'anno di copyright all'oggetto dei dati dell'attività
                    c.copyright_year = copyrightYears.length > 0 ? copyrightYears[0] : null;
                    return c;
                } catch (e) {
                    // Se il sito web non è accessibile o c'è un errore, imposta l'anno di copyright su null
                    c.copyright_year = null;
                    return c;
                }
            }));
            */

            // Log delle informazioni sui dati estratti
            console.log(`[data] Scritti con successo ${cards.length} record, continuando alla prossima pagina se disponibile`);

            // Aggiungi i dati estratti alla lista finale
            scrapeData = scrapeData.concat(cards);

            // Cerca il pulsante "Next" per la paginazione
            const nextButton = await page.$('button[aria-label="Next"]');
            if (nextButton) {
                try {
                    // Se c'è un pulsante "Next", cliccalo per caricare la pagina successiva
                    await nextButton.click();
                    await page.waitForTimeout(5000);
                    await getPageData();
                } catch (e) {
                    // Se la paginazione non è disponibile, salva i dati in un file CSV
                    const csv = await converter.json2csv(scrapeData);
                    fs.writeFileSync(path.join(dataDir, `output-${searchString}-${(Math.random() + 1).toString(36).substring(7)}.csv`), csv, "utf-8");

                    console.log(`[+] Record salvati nel file CSV`);
                    console.log(`[success] Scritti ${scrapeData.length} record in ${(Date.now() - start_time.getTime()) / 1000}s`);
                }
            } else {
                // Se non ci sono altre pagine, salva i dati in un file CSV
                const csv = await converter.json2csv(scrapeData);
                fs.writeFileSync(path.join(dataDir, `output-${searchString}-${(Math.random() + 1).toString(36).substring(7)}.csv`), csv, "utf-8");

                console.log(`[+] Record salvati nel file CSV`);
                console.log(`[success] Scritti ${scrapeData.length} record in ${(Date.now() - start_time.getTime()) / 1000}s`);
            }
        };

        await getPageData();

        await page.close();
        await browser.close();

        // Chiudi l'interfaccia readline dopo aver completato l'operazione
        rl.close();
    });
})();

// Funzione per estrarre l'anno di copyright dal contenuto HTML di una pagina web
// La funzione `extractCopyrightYear` non verrà più utilizzata, quindi puoi anche commentarla completamente, se vuoi:
// function extractCopyrightYear(html) {
//     const $ = cheerio.load(html);

//     const copyrightDivs = $('div').filter((index, element) => {
//         const divText = $(element).text();
//         return /Copyright|©/.test(divText);  // Cerca il testo "Copyright" o "©"
//     });

//     const copyrightYears = [];
//     copyrightDivs.each((index, element) => {
//         const divText = $(element).text();
//         if (divText.length > 400) return;  // Ignora i div troppo lunghi
//         if (!divText.toLowerCase().includes("copyright") && !divText.toLowerCase().includes("©")) return;
//         const years = divText.match(/\b\d{4}\b/g);  // Estrai gli anni in formato YYYY
//         if (years) {
//             years.forEach((year) => {
//                 const yearInt = parseInt(year);
//                 if (!isNaN(yearInt)) {
//                     copyrightYears.push(yearInt);
//                 }
//             });
//         }
//     });

//     return copyrightYears;
// }
