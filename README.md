# Google Maps Scraper di -io

Questo Google Maps Scraper è uno strumento Node.js che utilizza Puppeteer, Cheerio e altre librerie per estrarre informazioni sulle attività commerciali dai Servizi Locali di Google. Raccoglie dati come nome dell'attività, indirizzo, numero di telefono, sito web, valutazioni e altro, e esporta i risultati in formato CSV.  
È disponibile anche come applicazione per Windows, Mac OS o Linux grazie a Electron.

## Funzionalità

- **Scraping Automatizzato**: Naviga automaticamente nei Servizi Locali di Google, accettando i cookie, cliccando sulle schede delle attività e raccogliendo le informazioni pertinenti.
- **Estrazione dei Dati**: Estrae dettagli essenziali delle attività commerciali, come nome, indirizzo, numero di telefono, sito web e valutazioni.
- **Esportazione in CSV**: Esporta i dati estratti in formato CSV per un'analisi facile e immediata.
- **Modalità Stealth**: Utilizza il plugin Stealth di Puppeteer per evitare di essere rilevato da Google.

## Utilizzo

1. Installa le dipendenze:
    ```bash
    npm i
    ```

2. Esegui lo scraper da terminale:
    ```bash
    node app.js
    ```

3. Avvia l'app: con GUI
    ```bash
    npm start
    ```

4. Compila l'app:
    ```bash
    npm run build
    ```

## Casi d'Uso

- **Generazione di Lead**: Raccogli informazioni di contatto e dettagli aziendali di potenziali clienti in un'area specifica.
- **Ricerca di Mercato**: Analizza i dati dei concorrenti raccogliendo informazioni aziendali in regioni mirate.
- **Aggregazione di Dati**: Raccogli dati per costruire directory aziendali complete.
- **Analisi SEO**: Estrai e valuta le valutazioni e le recensioni aziendali per strategie SEO locali.

## Disclaimer

Questo strumento è destinato esclusivamente a scopi educativi. Effettuare scraping su Google Maps o altre piattaforme potrebbe violare i loro termini di servizio. Utilizza questo strumento in modo responsabile.

## Licenza

Questo progetto è distribuito sotto licenza MIT. Per maggiori dettagli, consulta il file `LICENSE`.

```bash
Realizzato con amore da Antonio Galluccio Mezio
```
