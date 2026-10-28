# MemoDeck — flashcard locali su GitHub Pages

Un sito gratuito senza backend. Crei mazzi, aggiungi carte, ripassi ed esporti i contenuti in file JSON.

## Pubblicazione su GitHub Pages

1. Crea un **nuovo repository pubblico** (es. `memodeck`).
2. Carica `index.html`, `styles.css`, `app.js` e `.nojekyll` nella radice del repository.
3. In **Settings → Pages**, seleziona **Deploy from a branch**, branch `main`, folder `/(root)`, quindi **Save**.
4. Visita `https://TUO-USERNAME.github.io/memodeck/`.

Per provarlo senza pubblicarlo, apri `index.html` in un browser. Alcuni browser applicano limitazioni a `localStorage` sui file `file://`; l'esperienza raccomandata è dal sito GitHub Pages, oppure da un server locale (`python -m http.server 8000`).

## Dove finiscono le flashcard?

- **Salvataggio automatico:** `localStorage` del browser, su questo dispositivo e per questo indirizzo web.
- **Backup su disco:** pulsante **Scarica backup completo** (tutti i mazzi) oppure **Esporta JSON** (singolo mazzo). Il browser scarica un file nella cartella Download o nella destinazione scelta da te.
- **Riapertura:** pulsante **Importa file JSON**, anche su un altro computer. Per sicurezza l'importazione aggiunge i mazzi, senza cancellare quelli esistenti.

Il file JSON contiene le domande, le risposte e le statistiche base delle carte. Le carte **non** vengono caricate sui server GitHub; GitHub ospita solo il codice del sito. Non c'è sincronizzazione automatica tra dispositivi. Eliminare i dati del browser può eliminare le flashcard non esportate.

## Tasti durante il ripasso

- `Spazio`: gira la carta.
- `1`: da rivedere (quando è visibile la risposta).
- `2`: la so (quando è visibile la risposta).
- `Esc`: esci dalla modalità ripasso.

## Tecnologie

Solo HTML, CSS, JavaScript. Nessuna libreria, nessun account, nessun tracker, nessun backend.
