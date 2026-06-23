# 🔄 GUIDA AUTO-UPDATE via GitHub

Questa guida spiega come configurare gli aggiornamenti automatici dell'app.
Una volta configurato, quando pubblichi una nuova versione, TUTTI i PC si
aggiornano da soli al riavvio dell'app.

---

## ⚙️ CONFIGURAZIONE INIZIALE (una volta sola)

### Passo 1 — Crea il repository delle release su GitHub

1. Vai su https://github.com e accedi
2. Clicca il "+" in alto a destra → "New repository"
3. Nome repository: **gama-consuntivi-releases**
4. Scegli **Public** (pubblico - serve per gli aggiornamenti automatici senza token)
5. NON aggiungere README, .gitignore o licenza
6. Clicca "Create repository"

### Passo 2 — Nome utente nell'app (GIÀ FATTO)

Nel file `package.json` il tuo username GitHub "ServiziDc" è GIÀ stato
inserito nella sezione "publish". Non devi fare niente per questo passo.

### Passo 3 — Crea un token GitHub (per pubblicare)

Serve UNA volta per permettere a te (non agli utenti) di pubblicare le versioni.

1. Su GitHub: clicca la tua foto in alto a destra → Settings
2. In fondo a sinistra: "Developer settings"
3. "Personal access tokens" → "Tokens (classic)" → "Generate new token (classic)"
4. Nome: "pubblicazione gama consuntivi"
5. Scadenza: "No expiration" (o 1 anno)
6. Spunta la casella **repo** (tutta)
7. Clicca "Generate token"
8. COPIA il token (inizia con ghp_...) e salvalo - non lo rivedrai più!

### Passo 4 — Imposta il token sul tuo PC (quello da cui pubblichi)

Apri il Prompt dei comandi (cmd) e scrivi:

    setx GH_TOKEN "ghp_il_tuo_token_qui"

Poi CHIUDI e riapri il prompt (serve per applicare la variabile).

---

## 🚀 COME PUBBLICARE UN AGGIORNAMENTO (ogni volta che c'è una nuova versione)

Quando io ti preparo una nuova versione dell'app:

1. Sostituisci i file della cartella `electron-app` con quelli nuovi
2. Verifica che in `package.json` il numero "version" sia AUMENTATO
   (es. da 2.9.1 a 3.0.0). IMPORTANTE: l'auto-update scatta solo se il
   numero è più alto di quello installato sui PC.
3. Apri il prompt dei comandi nella cartella `electron-app`
4. Scrivi:

       npm install
       npm run publish

5. electron-builder compila e carica automaticamente la release su GitHub
6. FATTO! Gli altri PC, al prossimo avvio, scaricano e installano da soli

---

## 👥 COSA VEDONO GLI UTENTI (segretaria, operai)

- Aprono l'app normalmente
- Se c'è un aggiornamento, vedono in alto una barra blu:
  "Nuova versione trovata, scarico in corso..."
- Poi: "Aggiornamento pronto! L'app si riavvia tra pochi secondi..."
- L'app si chiude e riapre da sola, aggiornata
- NON devono fare niente

---

## ❓ NOTE

- Gli utenti devono avere INTERNET per ricevere gli aggiornamenti (il controllo
  è verso GitHub, non verso il NAS).
- La prima volta che installano l'app, lo fanno comunque a mano (con l'installer).
  Dopo, gli aggiornamenti sono automatici.
- L'avviso di Windows "editore sconosciuto" può apparire: è normale (app non
  firmata), basta cliccare "Ulteriori informazioni" → "Esegui comunque".
- Se un PC è spento quando pubblichi, si aggiornerà al primo avvio successivo.
