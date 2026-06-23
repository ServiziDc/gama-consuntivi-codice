# 📋 Generatore Consuntivi CBRE + CREVAL - Gama Service

App web per generare consuntivi CBRE e CREVAL in automatico, con numerazioni progressive separate e sincronizzate in tempo reale tra più PC.

## ✨ Cosa fa

- ✅ Genera consuntivi `.docx` con template Gama Service (logo, intestazione, timbro)
- ✅ **Due tipi**: CBRE e CREVAL, con **numerazioni indipendenti** (CBRE 304→305..., CREVAL 1→2...)
- ✅ Sincronizzazione in tempo reale via Firebase: se un operatore prende il 304, l'altro vede già 305
- ✅ Anti-conflitto con transazione atomica Firestore (impossibile avere doppioni)
- ✅ **Salvataggio automatico in cartelle organizzate**: scegli una cartella sul PC, e l'app crea da sola la struttura `MM_MESE_ANNO/CBRE/` e `MM_MESE_ANNO/CREVAL/`
- ✅ Archivio completo su Firestore: puoi sempre riscaricare qualunque consuntivo o l'intero ZIP di un mese
- ✅ Aggiorna il file Excel CBRE del mese inserendo le righe nelle sezioni giuste
- ✅ Niente login: accesso libero via link

## 📂 Struttura cartelle generata

Quando scegli una cartella di lavoro (es. `Consuntivi Gama`), l'app crea automaticamente:

```
Consuntivi Gama/
├── 05_MAGGIO_2026/
│   ├── CBRE/
│   │   ├── CONSUNTIVO NR 304 BNL VIA EMILIA VOGHERA.docx
│   │   └── CONSUNTIVO NR 305 CEVA PERO.docx
│   └── CREVAL/
│       └── CONSUNTIVO NR 50 CREVAL VIA FELTRE MILANO.docx
└── 06_GIUGNO_2026/
    ├── CBRE/
    └── CREVAL/
```

## 🚀 Setup iniziale (1 volta sola)

### 1) Crea progetto Firebase

1. Vai su https://console.firebase.google.com/
2. Clicca **"Aggiungi progetto"** → nome es. `gama-consuntivi`
3. Disattiva Google Analytics se non serve
4. Dalla home → clicca **"</>"** (web) per aggiungere una web app
5. Dai un nickname, **NON** spuntare Hosting
6. Copia le credenziali che ti mostra

### 2) Attiva Firestore

1. Menu sinistra → **"Firestore Database"** → **"Crea database"**
2. Modalità: **"Produzione"**, Località: `europe-west1` (o eur3)
3. Tab **"Regole"** → incolla:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```

4. Clicca **"Pubblica"**

### 3) Configura l'app

Apri `firebase-config.js` e incolla le credenziali al posto di `INSERISCI_QUI`.

### 4) Hosting

#### A) GitHub Pages
1. Carica i file in un repo GitHub
2. Settings → Pages → Source: main / root
3. Ti dà l'URL pubblico da condividere

#### B) Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

#### C) Locale per test
```bash
cd app
python3 -m http.server 8000
# apri http://localhost:8000
```

## 📖 Come si usa

### Al primo avvio (o ogni nuova sessione browser)
1. Apri l'app
2. Clicca **"📂 Scegli cartella"** in alto
3. Seleziona dove vuoi salvare (es. `Documenti/Consuntivi Gama`)
4. Concedi i permessi di scrittura quando il browser te lo chiede

> ⚠️ Su **Firefox/Safari** il salvataggio automatico non funziona: i file finiscono nella cartella Download standard. Usa **Chrome o Edge** per il pieno automatismo.

### Imposta i numeri di partenza (1 sola volta)
1. Tab **"⚙️ Impostazioni"**
2. Imposta **prossimo numero CBRE** (es. 304) → "Imposta CBRE"
3. Imposta **prossimo numero CREVAL** (es. 1 o quello che è) → "Imposta CREVAL"

### Inizio mese (1 volta al mese)
1. Tab **"📊 File Excel"**
2. Carica il file Excel CBRE vuoto del nuovo mese
3. Premi **"Salva template"**

### Per ogni nuovo consuntivo
1. Tab **"➕ Nuovo Consuntivo"**
2. **Seleziona tipo: CBRE o CREVAL** → vedi subito il numero che verrà assegnato
3. Seleziona categoria (BNL, CEVA, ecc.)
4. Compila tutti i campi
5. Premi **"Genera consuntivo"**
6. Il `.docx` viene salvato automaticamente nella cartella giusta!

### Storico e archivio
- Tab **"📚 Storico Mese"**
- Filtri: per mese, per tipo (CBRE / CREVAL)
- Bottoni: riscarica singolo `.docx`, elimina, oppure **scarica ZIP di tutto il mese**

### File Excel CBRE
- Tab **"📊 File Excel"** → **"Scarica Excel mese"**
- Solo i consuntivi **CBRE** vanno in questo file (i CREVAL sono separati, faremo il loro Excel quando integriamo CREVAL completamente)

## 🆘 Problemi comuni

**"Firebase non configurato"** → Compila `firebase-config.js`

**Il bottone "Scegli cartella" non c'è** → Stai usando Firefox o Safari. Apri con Chrome o Edge per avere il salvataggio automatico.

**I numeri partono da 1 invece che da 304/etc** → Vai in Impostazioni e forza i numeri corretti

**Le sezioni nell'Excel non si trovano** → Il template deve avere i titoli con parole chiave (BNL, CEVA, MEDIOBANCA, KELLER, ecc.)

**Quando riapro il browser, la cartella è "non selezionata"** → Comportamento normale del browser per sicurezza. Riselezionala dal bottone.

## 📁 File del progetto

```
app/
├── index.html
├── style.css
├── app.js
├── firebase-config.js      ← ⚠️ MODIFICARE
├── assets/
│   ├── images.js
│   ├── logo.jpeg
│   └── timbro.png
└── README.md
```

## 🔧 Cose ancora da fare insieme

- **CREVAL completo**: per ora la numerazione CREVAL funziona ma il `.docx` è generico. Quando vuoi, mi mandi i dettagli del template CREVAL (destinatario, formato specifico) e lo integriamo
- **File Excel CREVAL del mese**: anche qui da fare quando integri CREVAL completo
- Conversione automatica `.docx` → `.pdf`
- Login utenti (se serve)
