# 🔨 Come compilare l'.EXE di Gama Consuntivi

Guida passo-passo per creare il file installer `.exe` da distribuire ai PC della rete.

> ⏱ **Tempo necessario**: ~15 minuti la prima volta, ~3 minuti le volte successive.

---

## ✅ Cosa ti serve

1. Un PC con **Windows** (questo guida è per Windows; per Mac/Linux dimmelo)
2. Connessione Internet (per scaricare Node.js e Electron la prima volta)
3. Permessi di amministratore sul PC (per installare Node.js)

---

## 📥 Passo 1 — Installa Node.js (solo la prima volta)

1. Vai su https://nodejs.org/
2. Scarica la versione **LTS** (quella con il riquadro verde "Recommended For Most Users")
3. Apri il file scaricato (`node-vXX.X.X-x64.msi`)
4. Clicca **Next** → **Accetta i termini** → **Next** → **Next** → **Next** → **Install**
5. A fine installazione, **chiudi e riapri** tutte le finestre di PowerShell/Prompt aperte

**Verifica che sia installato**:
- Apri il menu Start → cerca **PowerShell** → invio
- Scrivi: `node -v` → premi Invio
- Devi vedere qualcosa tipo `v20.18.0` o simile

---

## ⚙️ Passo 2 — Configura Firebase (solo la prima volta)

Se non l'hai già fatto, segui la guida del file `README-app.md`:
- Crea progetto Firebase
- Attiva Firestore + regole
- Copia le credenziali nel file `src/firebase-config.js`

⚠️ **Importante**: senza queste credenziali compilate, l'app funzionerà ma non si collegherà al database, e quindi i numeri non si sincronizzeranno tra PC.

---

## 🛠️ Passo 3 — Compila l'`.exe`

### Modo facile (raccomandato): doppio click

1. Doppio click su **`COMPILA-EXE.bat`** (nella cartella principale)
2. Si apre una finestra nera, parte il processo
3. Aspetta 5-10 minuti la prima volta (deve scaricare Electron, ~150 MB)
4. A fine processo trovi l'`.exe` nella cartella **`dist/`**
5. Il file si chiama **`Gama-Consuntivi-Setup-2.1.0.exe`**

### Modo manuale (se preferisci comandi)

1. Apri **PowerShell** nella cartella `electron-app` (Shift + tasto destro nella cartella → "Apri finestra PowerShell qui")
2. Lancia in ordine:

```powershell
npm install
npm run build:win
```

3. A fine processo trovi l'`.exe` in `dist/`

---

## 📦 Passo 4 — Distribuisci l'`.exe`

Il file `Gama-Consuntivi-Setup-2.1.0.exe` è l'installer wizard classico.

**Cosa fa quando viene lanciato sui PC degli operatori**:
1. Apre il wizard di installazione (in italiano)
2. L'utente può scegliere dove installare (default: `C:\Users\NomeUtente\AppData\Local\Programs\Gama Consuntivi`)
3. Crea icona sul **desktop** + voce nel **menu Start**
4. A fine installazione lancia subito l'app

**Come distribuirlo**:
- Condividi il file via OneDrive / Google Drive / chiavetta USB / email (se < 25 MB)
- L'installer è ~80-150 MB, quindi probabilmente non passa per email
- Consiglio: caricalo su una cartella condivisa di rete o OneDrive, mandi il link agli operatori

---

## 🔄 Quando aggiorno l'app: cosa fare

1. Sostituisci i file modificati (es. `src/app.js`)
2. Cambia la `"version"` in `package.json` (es. da `2.1.0` a `2.1.1`)
3. Doppio click su **`COMPILA-EXE.bat`**
4. Distribuisci il nuovo installer ai PC

Quando gli utenti reinstallano sopra una versione esistente, l'installer aggiorna direttamente senza problemi.

---

## 🆘 Problemi comuni

### "npm non riconosciuto come comando"
Hai dimenticato di chiudere e riaprire PowerShell dopo aver installato Node.js, oppure Node.js non si è installato correttamente.

### "Errore durante npm install"
Probabilmente la rete blocca i download. Verifica:
- Connessione Internet attiva
- Antivirus/firewall non bloccano npm
- Prova: `npm config set registry https://registry.npmjs.org/`

### "Errore durante electron-builder"
Verifica di avere abbastanza spazio su disco (almeno 2 GB liberi).
Se errore tipo "EBUSY" o "EPERM": chiudi tutte le istanze dell'app Gama Consuntivi prima di compilare.

### L'`.exe` non parte sui PC degli operatori
- Verifica che siano su Windows 10 o superiore (64 bit)
- Antivirus aziendale potrebbe bloccare il file (non è firmato digitalmente)
- Soluzione: aggiungi l'`.exe` alle eccezioni dell'antivirus

### Firma digitale (avviso "Editore sconosciuto")
La prima volta che si apre l'`.exe`, Windows mostra "Editore sconosciuto - SmartScreen ha impedito l'avvio". È normale per app non firmate.

L'utente deve:
1. Cliccare **"Ulteriori informazioni"**
2. Cliccare **"Esegui comunque"**

Per togliere completamente questo avviso serve un certificato di firma digitale (~150-400€/anno, non strettamente necessario per uso interno).

---

## 📁 Struttura cartella

```
electron-app/
├── main.js                  ← processo principale Electron
├── package.json             ← config dipendenze + build
├── icon.png / icon.ico      ← icone dell'app
├── COMPILA-EXE.bat          ← doppio click per compilare
├── COME_COMPILARE.md        ← questo file
├── README-app.md            ← documentazione dell'app
├── .gitignore
├── src/                     ← codice della web app
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── firebase-config.js   ← ⚠️ MODIFICARE con credenziali
│   └── assets/
├── node_modules/            ← creato da npm install (non toccare)
└── dist/                    ← creato da npm run build (qui c'è l'.exe finale)
```
