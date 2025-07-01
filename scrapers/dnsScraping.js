const converter = require("json-2-csv");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const { stopFlag } = require("../utils/config");



// --- DNS scraping logic ---
async function performDnsScraping(searchString, folderPath, win, dnsRecordTypes, doAMail) {
  win.webContents.send("reset-logs");
  stopFlag.value = false;
  const domains = searchString
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const start_time = new Date();
  let allData = [];
  for (const domain of domains) {
    if (stopFlag.value) {
      win.webContents.send('status', '[STOP] Scraping interrotto dall\'utente. Salvataggio dati...');
      break;
    }
    win.webContents.send("status", `\n🔍 Controllo DNS per: ${domain}`);
    let record = { domain };
    for (const type of dnsRecordTypes) {
      if (stopFlag.value) {
        win.webContents.send('status', '[STOP] Scraping interrotto dall\'utente. Salvataggio dati...');
        break;
      }
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

module.exports = {
    performDnsScraping,
    saveDnsData
};