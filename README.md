# 🍽️ NutriPWA

**Scatta una foto al piatto, ottieni una stima di calorie, proteine, carboidrati, grassi e fibre.**
App web installabile (PWA), in italiano, pensata per il telefono. **Gratuita, senza account, senza backend obbligatorio: i tuoi dati restano sul tuo dispositivo.**

> ⚠️ **Disclaimer.** Le stime sono generate da un’intelligenza artificiale e sono **approssimative**: le porzioni sono valutate a occhio dalla foto e l’errore può essere anche grande. **Non sostituiscono la bilancia né il parere di un medico o di un nutrizionista.** Chi ha diabete, allergie, intolleranze, disturbi alimentari o segue una terapia non deve basarsi su queste stime.

## Come si usa (3 passi)

1. **Chiave** – la prima volta incolli la tua chiave gratuita Gemini (vedi sotto). Resta solo sul tuo dispositivo.
2. **Foto** – tocca *Scatta una foto* (o *Scegli dalla galleria*). Puoi aggiungere un dettaglio, ad esempio “pasta al pomodoro, porzione piccola”.
3. **Risultato** – vedi totale e singoli alimenti. Se la porzione non è giusta cambia i grammi con **+ / −**: i valori si ricalcolano. Poi **Salva nel diario**.

Altre funzioni:
- **Diario** giornaliero con barre di avanzamento rispetto ai tuoi obiettivi (kcal, proteine, carboidrati, grassi, fibre), navigazione tra i giorni, miniature delle foto.
- **Barcode**: scanner con la fotocamera (`BarcodeDetector` se disponibile, altrimenti ZXing) o numero scritto a mano → dati da **Open Food Facts**.
- **Confronto con Open Food Facts** per ogni alimento riconosciuto dall’AI, e aggiunta manuale di alimenti.
- **Esporta / importa** tutti i dati in JSON (le chiavi non vengono mai esportate).
- Tema chiaro/scuro/automatico e **testo grande** per una lettura più comoda.
- Funziona offline per consultare il diario (l’analisi richiede internet).

## Come ottenere una chiave Gemini gratuita

1. Vai su <https://aistudio.google.com/apikey> e accedi con un account Google.
2. Clicca **Create API key** (Crea chiave API).
3. Copia la chiave (inizia con `AIza…`) e incollala in NutriPWA al passo 1.

**Modello:** NutriPWA non usa un nome di modello fisso. Quando salvi la chiave (e se un modello sparisce) chiede a Google l’elenco dei modelli disponibili *per la tua chiave* e sceglie il migliore: il più recente della famiglia “Flash”, preferendo quelli stabili e non “lite”. In **Opzioni → Modello Gemini** puoi vedere l’elenco, aggiornarlo o sceglierne uno a mano.

Il piano gratuito ha limiti giornalieri e al minuto; per uso personale bastano. Se li superi l’app lo dice in italiano: aspetta un po’ o configura un provider alternativo. Nota: sul piano gratuito Google può usare i contenuti inviati per migliorare i propri servizi – leggi le condizioni del tuo piano e non inviare foto con persone o dati personali.

### Provider alternativi (OpenAI-compatibili)
In **Opzioni → Provider alternativo** puoi usare OpenRouter, Groq o un qualsiasi endpoint compatibile con `/chat/completions` che legga le immagini (indirizzo base + modello + chiave). Viene usato come **ripiego automatico** se Gemini è saturo o non risponde.

## Privacy

- Nessun account, nessun database, nessun cookie di tracciamento, nessuna statistica.
- Diario e foto (miniature compresse) in **IndexedDB**, impostazioni e chiavi in **localStorage**.
- La foto compressa (max 1024 px) va **direttamente dal browser** al provider AI scelto, con la tua chiave (header `x-goog-api-key`, mai nell’URL).
- Open Food Facts riceve solo il codice a barre o il nome dell’alimento cercato.
- Vedi le pagine `privacy.html`, `termini.html`, `cookie.html`.

## Self-hosting

È un sito **completamente statico** (HTML + CSS + JS, nessuna build). Basta servire la cartella con HTTPS (necessario per fotocamera, service worker e installazione):

```bash
git clone https://github.com/gheocapaula1000-code/nutripwa.git
cd nutripwa
python3 -m http.server 8080        # prova in locale: http://localhost:8080
```

Per pubblicarla copia i file su un qualsiasi hosting statico (GitHub Pages, Lovable, Cloudflare Pages, Vercel, Nginx…). I percorsi sono tutti relativi, quindi funziona anche in una sottocartella.

### Test automatici
```bash
pip install playwright && python3 -m http.server 8765 &
python3 tests/e2e.py     # Chrome headless, rete AI simulata: 40+ controlli (flusso, errori, PWA, offline, footer…)
```

## Proxy facoltativo (chiave sul server)

Se non vuoi tenere la chiave nel browser (ad esempio per un’installazione per famiglia/clienti), puoi usare un proxy. **Non è obbligatorio.**
Esempio pronto: [`supabase/functions/ai-proxy/index.ts`](supabase/functions/ai-proxy/index.ts) (Supabase Edge Function, la chiave Gemini sta nei *secrets*):

```bash
supabase functions deploy ai-proxy --no-verify-jwt
supabase secrets set GEMINI_API_KEY=la_tua_chiave ALLOWED_ORIGIN=https://il-tuo-sito
```

Poi in NutriPWA: **Opzioni → Proxy personale** → incolla `https://<progetto>.supabase.co/functions/v1/ai-proxy`. Con il proxy attivo la chiave nel browser non serve.
Contratto: `POST` con il corpo di Gemini `generateContent` più un campo `model`; risposta = risposta di Gemini. Qualsiasi servizio con lo stesso contratto va bene (anche **Free AI Hub**/Pi.Gi Service, un Cloudflare Worker, ecc.). In produzione limita `ALLOWED_ORIGIN` al tuo dominio e metti un limite di richieste, altrimenti chiunque potrebbe consumare la tua quota.

## Idee future
- **Sincronizzazione con Supabase** (facoltativa, con cifratura lato client) per avere il diario su più dispositivi. Non implementata: oggi i dati sono solo locali.
- Importazione da Apple Salute / Google Fit.

## Alternativa: openplate

Valutazione di <https://github.com/LowCarbCheck/openplate> (verificata il 30/10/2026):
- Esiste, licenza **MIT**, TypeScript, attivo (ultimo push 29/10/2026), ~68 stelle, creato ad agosto 2026 (progetto giovane).
- PWA “local-first” con identificazione del piatto BYOK (OpenRouter, Mistral, Anthropic o endpoint OpenAI-compatibile), diario su IndexedDB, 6 lingue **tra cui italiano**, sync cifrata opzionale, modalità “managed” con account/inviti/quote, inferenza self-hosted; si installa con Docker.
- Punta soprattutto al **conteggio carboidrati** (low-carb) ed è più complesso da installare (Node 24, container, opzionalmente Postgres).

**Raccomandazione:** per un uso personale/familiare immediato, semplice e senza server, **NutriPWA** (questo progetto) è più leggera, ha onboarding guidato per ogni età e funziona su qualsiasi hosting statico. Se ti servono **account multipli, sync tra dispositivi cifrata, quote per utente o inferenza su hardware proprio**, valuta **openplate** come base più completa.

## Licenza
MIT – vedi [LICENSE](LICENSE). Dati prodotti: Open Food Facts (ODbL).

---
**Pi.Gi Service** · Via Guido Reni 8, 35133 Padova (PD) · P.IVA 05770260288 · info@pigiservice.com · PEC pigiservice@pec.it · Tel. +39 352 0966114
