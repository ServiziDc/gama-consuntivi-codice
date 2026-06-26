// ============================================================
// ELECTRON MAIN PROCESS - Gama Consuntivi
// Gestione finestra + filesystem (creazione cartelle, salvataggio file)
// ============================================================

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const https = require("https");
// Carico il modulo attivazione in modo sicuro: se manca (es. build vecchia),
// il programma parte lo stesso senza attivazione invece di crashare.
let attivazione;
try {
  attivazione = require("./attivazione");
} catch (e) {
  console.error("Modulo attivazione non disponibile, avvio senza attivazione:", e.message);
  // Fallback: oggetto fittizio che considera tutto già attivato
  attivazione = {
    generaCodiceMacchina: () => "NON-DISP-ONIBILE",
    calcolaKeyPerCodice: () => "",
    validaKey: () => true,
    salvaLicenza: () => true,
    leggiLicenza: () => null,
    eAttivato: () => true   // se il modulo manca, NON blocco il programma
  };
}

// ============================================================
// CARICAMENTO DOCUMENTI SU GOOGLE DRIVE (tramite Cloud Function)
// ============================================================
const DRIVE_FUNZIONE_URL = "https://europe-west1-gama-service.cloudfunctions.net/caricaConsuntivoSuDrive";
const DRIVE_TOKEN = "158d76892c820bfc66e50db1801e2457b3ed21bf61ded634";

// Manda il file Word alla Cloud Function, che lo mette in Consuntivi/<categoria> su Drive.
// NON lancia mai errori (risolve sempre): un problema di rete non deve bloccare il salvataggio.
function caricaSuDrive(categoria, mese, fileName, buffer) {
  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({
        token: DRIVE_TOKEN,
        categoria: categoria,
        mese: mese || "",
        fileName: fileName,
        fileBase64: buffer.toString("base64"),
      });
      const u = new URL(DRIVE_FUNZIONE_URL);
      const opts = {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 60000,
      };
      const req = https.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            if (res.statusCode === 200 && j.ok) {
              resolve({ ok: true, link: j.link, fileId: j.fileId });
            } else {
              resolve({ ok: false, errore: (j && j.error) || ("HTTP " + res.statusCode) });
            }
          } catch (e) {
            resolve({ ok: false, errore: "Risposta non valida da Drive" });
          }
        });
      });
      req.on("error", (e) => resolve({ ok: false, errore: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, errore: "Timeout caricamento Drive" }); });
      req.write(payload);
      req.end();
    } catch (e) {
      resolve({ ok: false, errore: e.message });
    }
  });
}

// Cancella (cestina) un file di consuntivo su Drive tramite la Cloud Function.
const DRIVE_ELIMINA_URL = "https://europe-west1-gama-service.cloudfunctions.net/eliminaConsuntivoDrive";
function eliminaSuDrive(categoria, mese, fileName) {
  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({ token: DRIVE_TOKEN, categoria: categoria, mese: mese || "", fileName: fileName });
      const u = new URL(DRIVE_ELIMINA_URL);
      const opts = {
        hostname: u.hostname, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: 60000,
      };
      const req = https.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            if (res.statusCode === 200 && j.ok) resolve({ ok: true, eliminati: j.eliminati || 0 });
            else resolve({ ok: false, errore: (j && j.error) || ("HTTP " + res.statusCode) });
          } catch (e) { resolve({ ok: false, errore: "Risposta non valida da Drive" }); }
        });
      });
      req.on("error", (e) => resolve({ ok: false, errore: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, errore: "Timeout eliminazione Drive" }); });
      req.write(payload);
      req.end();
    } catch (e) {
      resolve({ ok: false, errore: e.message });
    }
  });
}

// Auto-updater (aggiornamento automatico da GitHub Releases)
// Il require è in try/catch così se il modulo manca (es. in sviluppo) l'app parte lo stesso
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (e) {
  console.warn("electron-updater non disponibile (normale in sviluppo):", e.message);
}

// ============================================================
// NOME APP FISSO (FONDAMENTALE per non perdere le impostazioni)
// ============================================================
// Forzo SEMPRE lo stesso nome, così la cartella userData (dove sta settings.json
// con la cartella di salvataggio scelta) NON cambia mai tra una versione e l'altra.
// Senza questo, dopo un aggiornamento l'app poteva cercare le impostazioni in una
// cartella diversa e "dimenticare" dove salvare.
app.setName("Gama Consuntivi");
try {
  app.setPath("userData", path.join(app.getPath("appData"), "Gama Consuntivi"));
} catch (e) {
  console.warn("Impossibile forzare userData:", e.message);
}

// ============================================================
// PERSISTENZA IMPOSTAZIONI (cartella scelta dall'utente)
// ============================================================
// Salvo le impostazioni in un file JSON nella userData di Electron
// (su Windows: C:\Users\Nome\AppData\Roaming\Gama Consuntivi\settings.json)
function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function leggiImpostazioni() {
  try {
    const p = getSettingsPath();
    if (!fs.existsSync(p)) {
      // MIGRAZIONE: se non trovo le impostazioni nel percorso attuale, provo a
      // recuperarle da vecchi percorsi userData (per non perderle dopo un aggiornamento
      // o un cambio nome app). Cerco in alcune cartelle note e copio il primo trovato.
      try {
        const appData = app.getPath("appData");
        const possibili = [
          path.join(appData, "gama-consuntivi", "settings.json"),
          path.join(appData, "Gama Consuntivi", "settings.json"),
          path.join(appData, "gama-consuntivi-releases", "settings.json")
        ];
        for (const vecchio of possibili) {
          if (vecchio !== p && fs.existsSync(vecchio)) {
            const dati = fs.readFileSync(vecchio, "utf-8");
            // Salvo nel percorso nuovo così la prossima volta lo trovo subito
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, dati, "utf-8");
            console.log("Impostazioni migrate da:", vecchio);
            return JSON.parse(dati);
          }
        }
      } catch (mErr) {
        console.warn("Migrazione impostazioni non riuscita:", mErr.message);
      }
      return {};
    }
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (err) {
    console.error("Errore lettura settings:", err);
    return {};
  }
}

function salvaImpostazioni(s) {
  try {
    const p = getSettingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(s, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("Errore scrittura settings:", err);
    return false;
  }
}

// ============================================================
// LOCK COOPERATIVO PER NAS MULTI-PC
// ============================================================
// Quando più PC scrivono lo stesso file Excel del mese (es. NAS condiviso),
// usiamo un file .lock accanto al file per coordinarci.
//
// Il PC che vuole scrivere:
// 1. Verifica se esiste già un file .lock recente (< 30s)
//    - Se SÌ: aspetta e ritenta (fino a maxTentativi)
//    - Se NO: procede
// 2. Crea il proprio file .lock con timestamp e identificativo PC
// 3. Scrive il file Excel
// 4. Cancella il proprio .lock
//
// I .lock vecchi (> 30s) sono considerati abbandonati (PC crashato) e ignorati.
// Questo è un lock "cooperativo": funziona perché tutti i PC eseguono lo stesso codice.

const os = require("os");
const PC_ID = `${os.hostname()}_${process.pid}`;
const LOCK_TIMEOUT_MS = 30 * 1000;  // 30 secondi
const LOCK_MAX_ATTEMPTS = 10;       // 10 tentativi
const LOCK_RETRY_DELAY_MS = 1500;   // 1.5 secondi tra un tentativo e l'altro

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Acquisisce un lock per il file specificato
// Ritorna { acquisito: true, lockPath } se OK, { acquisito: false, errore } se fallito
async function acquisisciLock(targetFilePath) {
  const lockPath = targetFilePath + ".lock";

  for (let attempt = 1; attempt <= LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      // Verifico se c'è già un lock
      let lockEsistenteDaIgnorare = false;
      if (fs.existsSync(lockPath)) {
        try {
          const lockContent = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
          const eta = Date.now() - lockContent.timestamp;

          // Se il lock è MIO (stesso PC_ID), lo riprendo (caso raro: crash precedente)
          if (lockContent.pc === PC_ID) {
            console.log(`Lock mio precedente, lo riprendo`);
            lockEsistenteDaIgnorare = true;
          }
          // Se è troppo vecchio (>30s), è abbandonato → lo ignoro
          else if (eta > LOCK_TIMEOUT_MS) {
            console.log(`Lock abbandonato (${eta}ms), lo ignoro`);
            lockEsistenteDaIgnorare = true;
          }
          // Altrimenti aspetto
          else {
            console.log(`Lock attivo di ${lockContent.pc} (${eta}ms fa), tentativo ${attempt}/${LOCK_MAX_ATTEMPTS}, attendo...`);
            await delay(LOCK_RETRY_DELAY_MS);
            continue;
          }
        } catch (err) {
          // Lock file corrotto, lo ignoro e sovrascrivo
          console.warn("Lock file corrotto, lo sovrascrivo:", err.message);
          lockEsistenteDaIgnorare = true;
        }

        // Se ho deciso di ignorare il lock vecchio/mio/corrotto, lo cancello PRIMA
        // (altrimenti la writeFile con flag 'wx' fallirebbe)
        if (lockEsistenteDaIgnorare) {
          try {
            await fsp.unlink(lockPath);
          } catch (errDel) {
            // Se non posso cancellarlo, va bene, proverò comunque con write (senza wx)
            console.warn("Non sono riuscito a cancellare il lock vecchio:", errDel.message);
          }
        }
      }

      // Scrivo il mio lock (usando wx per fallire se qualcuno l'ha appena creato)
      const lockContent = JSON.stringify({
        pc: PC_ID,
        timestamp: Date.now(),
        target: targetFilePath
      });

      try {
        // wx = fail se esiste già; questo riduce le race condition
        await fsp.writeFile(lockPath, lockContent, { flag: "wx" });
      } catch (errWx) {
        if (errWx.code === "EEXIST") {
          // Qualcun altro l'ha creato in questo microsecondo, ritento
          console.log(`Lock creato in concorrenza, ritento...`);
          await delay(LOCK_RETRY_DELAY_MS);
          continue;
        }
        // Altro errore: provo con write normale (sovrascrive)
        await fsp.writeFile(lockPath, lockContent);
      }

      return { acquisito: true, lockPath };
    } catch (err) {
      console.error(`Errore tentativo lock ${attempt}:`, err);
      if (attempt === LOCK_MAX_ATTEMPTS) {
        return { acquisito: false, errore: err.message };
      }
      await delay(LOCK_RETRY_DELAY_MS);
    }
  }

  return { acquisito: false, errore: "Timeout dopo tutti i tentativi" };
}

async function rilasciaLock(lockPath) {
  try {
    if (fs.existsSync(lockPath)) {
      await fsp.unlink(lockPath);
    }
  } catch (err) {
    console.warn("Errore rilascio lock (non grave):", err.message);
  }
}

// ============================================================
// GESTIONE CARTELLA PRINCIPALE "CONSULTIVI GAMA"
// ============================================================
// La cartella principale si chiama SEMPRE "CONSULTIVI GAMA".
// L'utente sceglie la cartella PADRE (es. NAS Z:\, OneDrive, Documenti),
// e l'app crea/usa la sottocartella "CONSULTIVI GAMA" al suo interno.
//
// Schema finale: <padre>/CONSULTIVI GAMA/05_MAGGIO_2026/CBRE/...

const NOME_CARTELLA_PRINCIPALE = "CONSULTIVI GAMA";

// Verifica se un percorso è raggiungibile (esiste + leggibile)
// Con timeout per non bloccare se il NAS è giù
async function pathEsisteRaggiungibile(p, timeoutMs = 3000) {
  // Faccio fino a 3 tentativi prima di arrendermi: il NAS può essere lento a
  // rispondere (soprattutto appena acceso il PC). Così evito di dichiararlo
  // "irraggiungibile" troppo presto e finire per salvare nella cartella offline.
  const tentativi = 3;
  for (let i = 0; i < tentativi; i++) {
    const raggiungibile = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      fsp.access(p, fs.constants.R_OK)
        .then(() => { clearTimeout(timer); resolve(true); })
        .catch(() => { clearTimeout(timer); resolve(false); });
    });
    if (raggiungibile) return true;
    // Se non è l'ultimo tentativo, aspetto un attimo e riprovo (do tempo al NAS)
    if (i < tentativi - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return false;
}

// Cartella OFFLINE temporanea (usata se NAS è giù)
function cartellaOffline() {
  return path.join(os.homedir(), "Consuntivi-OFFLINE", NOME_CARTELLA_PRINCIPALE);
}

// Verifica se la cartella root attualmente impostata è raggiungibile
// Ritorna { configurata, cartellaRoot, raggiungibile, isOffline }
async function verificaRootRaggiungibile() {
  const s = leggiImpostazioni();
  if (!s.cartellaRoot) return { configurata: false };
  const raggiungibile = await pathEsisteRaggiungibile(s.cartellaRoot, 3000);
  return {
    configurata: true,
    cartellaRoot: s.cartellaRoot,
    cartellaPadre: s.cartellaPadre || null,
    raggiungibile,
    isOffline: !raggiungibile
  };
}

// ============================================================
// FILESYSTEM HELPER
// ============================================================
const NOMI_MESI = [
  "GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO",
  "LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"
];

// Da "2026-05" → "2026/05_MAGGIO_2026" (con cartella anno come padre)
function nomeCartellaMese(yyyymm) {
  const [y, m] = yyyymm.split("-");
  const mi = parseInt(m);
  return path.join(y, `${String(mi).padStart(2, "0")}_${NOMI_MESI[mi-1]}_${y}`);
}

// "2026-05" partendo da date corrente
function meseCorrente() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

// Aggiunge N mesi a una stringa "YYYY-MM" e ritorna nuova stringa
function aggiungiMese(yyyymm, n) {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

// Crea le sottocartelle CBRE e CREVAL per un singolo mese
async function creaCartelleMese(cartellaRoot, yyyymm) {
  const meseFolder = path.join(cartellaRoot, nomeCartellaMese(yyyymm));
  await fsp.mkdir(path.join(meseFolder, "CBRE"), { recursive: true });
  await fsp.mkdir(path.join(meseFolder, "CREVAL"), { recursive: true });
  return meseFolder;
}

// Prepara cartelle di N mesi a partire dal mese corrente (incluso)
async function preparaCartelleMensili(cartellaRoot, numeroMesi = 12) {
  if (!cartellaRoot) throw new Error("Nessuna cartella root impostata");
  const created = [];
  const start = meseCorrente();
  for (let i = 0; i < numeroMesi; i++) {
    const mese = aggiungiMese(start, i);
    const folder = await creaCartelleMese(cartellaRoot, mese);
    created.push({ mese, folder });
  }
  return created;
}

// ============================================================
// FINESTRA PRINCIPALE
// ============================================================
let mainWindow = null;
let isQuittingForUpdate = false; // true quando si sta installando un aggiornamento
let avvisoDizionarioMostrato = false; // per non ripetere l'avviso "dizionario non scaricato"
// Stato del correttore (mostrato in menu "?" -> Info per diagnostica)
let statoCorrettore = { disponibili: 0, attive: [], dizionari: {} };
// Porta del server locale che fornisce i dizionari inclusi nel programma
let portaServerDizionari = null;
let finestraAttivazione = null;

// ============================================================================
//  ATTIVAZIONE: mostra la schermata che chiede la key (solo se non attivato)
// ============================================================================
function mostraFinestraAttivazione() {
  finestraAttivazione = new BrowserWindow({
    width: 560,
    height: 720,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    title: "Attivazione - Gama Consuntivi",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  finestraAttivazione.setMenuBarVisibility(false);
  finestraAttivazione.loadFile(path.join(__dirname, "attivazione.html"));

  finestraAttivazione.on("closed", () => {
    finestraAttivazione = null;
    // Se chiude la finestra di attivazione SENZA attivare, esco dal programma
    if (!attivazione.eAttivato(app) && !mainWindow) {
      app.quit();
    }
  });
}

// Handler IPC per l'attivazione
ipcMain.handle("attivazione-codice-macchina", () => {
  return attivazione.generaCodiceMacchina();
});

ipcMain.handle("attivazione-verifica-key", (event, key) => {
  const valida = attivazione.validaKey(key);
  if (valida) {
    attivazione.salvaLicenza(app, key);
  }
  return valida;
});

ipcMain.handle("attivazione-completata", () => {
  // Chiudo la finestra di attivazione e apro il programma vero
  if (finestraAttivazione) {
    finestraAttivazione.close();
    finestraAttivazione = null;
  }
  creaFinestra();
  // Avvio anche il controllo aggiornamenti (non era partito perché non attivato)
  try { configuraAutoUpdate(); } catch (e) {}
});

function creaFinestra() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, "icon.png"),
    title: "Gama Service - Generatore Consuntivi",
    backgroundColor: "#f0f2f5",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // ============================================================
  // CORRETTORE ORTOGRAFICO (italiano + inglese)
  // ============================================================
  const ses = mainWindow.webContents.session;

  // Tengo attivo SOLO l'italiano: con italiano + inglese insieme i suggerimenti
  // uscivano in inglese (es. "casaliga" -> "gigapascal"). Con solo l'italiano il
  // correttore suggerisce le parole italiane corrette.
  try {
    const disponibili = ses.availableSpellCheckerLanguages || [];
    let lingueOk;
    if (disponibili.length > 0) {
      const it = disponibili.find((l) => l === "it" || l.startsWith("it-")) || null;
      if (it) {
        lingueOk = [it]; // SOLO italiano
      } else {
        // L'italiano non è disponibile: ripiego sull'inglese per non spegnere il correttore
        const en = disponibili.includes("en-US")
          ? "en-US"
          : (disponibili.find((l) => l.startsWith("en")) || null);
        lingueOk = en ? [en] : [];
      }
    } else {
      // Fallback per sistemi che non espongono la lista (es. macOS)
      lingueOk = ["it"];
    }
    if (lingueOk.length > 0) {
      // Prima dico a Electron di prendere i dizionari dal server LOCALE incluso
      // nel programma (così l'italiano si carica sempre, senza internet né firewall).
      if (portaServerDizionari) {
        try {
          ses.setSpellCheckerDictionaryDownloadURL("http://127.0.0.1:" + portaServerDizionari + "/");
          console.log("[Correttore] Sorgente dizionari: server locale porta", portaServerDizionari);
        } catch (e) {
          console.error("[Correttore] setSpellCheckerDictionaryDownloadURL fallita:", e.message);
        }
      }
      ses.setSpellCheckerLanguages(lingueOk);
      console.log("[Correttore] Lingue attive:", lingueOk.join(", "));
    }
    // Rileggo cosa è REALMENTE attivo (per diagnostica nel menu Info)
    statoCorrettore.disponibili = disponibili.length;
    try {
      statoCorrettore.attive = ses.getSpellCheckerLanguages() || lingueOk;
    } catch (_) {
      statoCorrettore.attive = lingueOk;
    }
  } catch (e) {
    console.error("[Correttore] Errore impostazione lingue:", e);
  }

  // I dizionari vengono scaricati da Chromium la PRIMA volta (serve internet
  // una volta sola; poi restano salvati sul PC e funzionano anche offline).
  // Qui controlliamo che lo scaricamento sia andato a buon fine.
  ses.on("spellcheck-dictionary-download-success", (e, lang) => {
    console.log("[Correttore] Dizionario scaricato:", lang);
    statoCorrettore.dizionari[lang] = "scaricato";
  });
  ses.on("spellcheck-dictionary-download-failure", (e, lang) => {
    console.error("[Correttore] DOWNLOAD FALLITO:", lang);
    statoCorrettore.dizionari[lang] = "FALLITO (internet/firewall)";
    if (!avvisoDizionarioMostrato) {
      avvisoDizionarioMostrato = true;
      dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Correttore ortografico",
        message: 'Non sono riuscito a scaricare il dizionario "' + lang + '".',
        detail:
          "Serve internet la prima volta (oppure il firewall aziendale sta bloccando il download).\n\nControlla la connessione e riavvia l'app: il dizionario verrà riscaricato.",
        buttons: ["OK"]
      });
    }
  });

  // Menu col TASTO DESTRO: suggerimenti per la parola sbagliata + taglia/copia/incolla
  mainWindow.webContents.on("context-menu", (event, params) => {
    const voci = [];

    // 1) Se ho cliccato su una parola segnalata come sbagliata
    if (params.misspelledWord) {
      if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
        for (const suggerimento of params.dictionarySuggestions) {
          voci.push({
            label: suggerimento,
            click: () => mainWindow.webContents.replaceMisspelling(suggerimento)
          });
        }
      } else {
        voci.push({ label: "(nessun suggerimento)", enabled: false });
      }
      voci.push({
        label: 'Aggiungi "' + params.misspelledWord + '" al dizionario',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      voci.push({ type: "separator" });
    }

    // 2) Comandi standard di modifica testo (sempre presenti)
    voci.push(
      { label: "Taglia", role: "cut", enabled: params.editFlags.canCut },
      { label: "Copia", role: "copy", enabled: params.editFlags.canCopy },
      { label: "Incolla", role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { label: "Seleziona tutto", role: "selectAll" }
    );

    Menu.buildFromTemplate(voci).popup();
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  costruisciMenu();
}

function costruisciMenu() {
  const menuTemplate = [
    {
      label: "File",
      submenu: [
        { label: "Aggiorna pagina", accelerator: "F5", click: () => mainWindow && mainWindow.reload() },
        { label: "Apri DevTools (debug)", accelerator: "F12", click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
        { type: "separator" },
        { label: "Esci", accelerator: "Alt+F4", click: () => app.quit() }
      ]
    },
    {
      label: "Visualizza",
      submenu: [
        { label: "Zoom +", accelerator: "CmdOrCtrl+=", role: "zoomIn" },
        { label: "Zoom -", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { label: "Zoom 100%", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { type: "separator" },
        { label: "Schermo intero", accelerator: "F11", role: "togglefullscreen" }
      ]
    },
    {
      label: "Cartelle",
      submenu: [
        {
          label: "Apri cartella consuntivi",
          click: async () => {
            const s = leggiImpostazioni();
            if (s.cartellaRoot && fs.existsSync(s.cartellaRoot)) {
              shell.openPath(s.cartellaRoot);
            } else {
              dialog.showMessageBox(mainWindow, {
                type: "warning",
                title: "Cartella non impostata",
                message: "Non hai ancora scelto una cartella per i consuntivi.",
                buttons: ["OK"]
              });
            }
          }
        }
      ]
    },
    {
      label: "?",
      submenu: [
        {
          label: "Info",
          click: () => {
            // Costruisco la diagnostica del correttore (al momento del click)
            const attive = (statoCorrettore.attive && statoCorrettore.attive.length)
              ? statoCorrettore.attive.join(", ")
              : "(nessuna)";
            let statoDiz = "";
            const langs = Object.keys(statoCorrettore.dizionari);
            if (langs.length > 0) {
              statoDiz = langs.map((l) => "  - " + l + ": " + statoCorrettore.dizionari[l]).join("\n");
            } else {
              statoDiz = "  (nessun download registrato: i dizionari potrebbero essere già presenti)";
            }
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "Gama Service - Generatore Consuntivi",
              message: "Generatore Consuntivi CBRE + CREVAL",
              detail:
                `Versione: ${app.getVersion()}\n\n` +
                `App interna Gama Service S.R.L\nViale Monza 69, 20845 Sovico (MB)\nP.IVA 12048300961\n\n` +
                `--- Correttore ortografico ---\n` +
                `Lingue disponibili sul sistema: ${statoCorrettore.disponibili}\n` +
                `Lingue ATTIVE: ${attive}\n` +
                `Stato dizionari:\n${statoDiz}`,
              buttons: ["OK"]
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

// ============================================================
// IPC HANDLERS (gestori chiamate dalla web app)
// ============================================================

// La web app chiede: "qual è la cartella root?"
ipcMain.handle("get-cartella-root", async () => {
  const s = leggiImpostazioni();
  if (s.cartellaRoot && fs.existsSync(s.cartellaRoot)) {
    return { ok: true, path: s.cartellaRoot };
  }
  return { ok: false, path: null };
});

// La web app chiede di selezionare una cartella PADRE.
// L'app creerà (o riutilizzerà se esiste già) una sottocartella "CONSULTIVI GAMA"
// al suo interno. Questo è importante per il multi-PC su NAS:
// tutti i PC scelgono la stessa cartella padre (es. Z:\),
// l'app crea/condivide la stessa CONSULTIVI GAMA dentro.
ipcMain.handle("seleziona-cartella", async () => {
  const s = leggiImpostazioni();

  // Mostra dialog informativo PRIMA del file picker (solo se è la prima volta)
  if (!s.cartellaRoot) {
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Benvenuto in Gama Consuntivi",
      message: "Scegli dove salvare i consuntivi",
      detail:
        "Seleziona la CARTELLA PADRE dove vuoi salvare i consuntivi.\n\n" +
        "L'app creerà al suo interno automaticamente la cartella \"CONSULTIVI GAMA\".\n\n" +
        "💡 Per condividere tra più PC:\n" +
        "• Scegli una cartella sul NAS aziendale (es. Z:\\)\n" +
        "• Su tutti i PC scegli la STESSA cartella padre\n" +
        "• L'app userà automaticamente la stessa \"CONSULTIVI GAMA\" condivisa\n\n" +
        "Se la cartella \"CONSULTIVI GAMA\" esiste già al suo interno, l'app la userà direttamente.",
      buttons: ["OK, scegli cartella"]
    });
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli la cartella PADRE (dentro verrà creata 'CONSULTIVI GAMA')",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: app.getPath("documents")
  });

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }

  const cartellaPadre = result.filePaths[0];
  // Costruisco il path della cartella CONSULTIVI GAMA
  const cartellaRoot = path.join(cartellaPadre, NOME_CARTELLA_PRINCIPALE);

  // Verifico se esiste già
  const giaEsiste = fs.existsSync(cartellaRoot);

  // Creo la cartella CONSULTIVI GAMA se non esiste (su NAS è quello che fa il primo PC,
  // gli altri PC trovano la cartella già esistente)
  try {
    await fsp.mkdir(cartellaRoot, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      errore: `Impossibile creare la cartella '${NOME_CARTELLA_PRINCIPALE}' in ${cartellaPadre}: ${err.message}`
    };
  }

  // Salvo nelle impostazioni sia padre che root
  const settings = leggiImpostazioni();
  settings.cartellaPadre = cartellaPadre;
  settings.cartellaRoot = cartellaRoot;
  settings.cartellaImpostataIl = new Date().toISOString();
  salvaImpostazioni(settings);

  // Creo subito le cartelle dei prossimi 12 mesi (solo se non ci sono già)
  try {
    const created = await preparaCartelleMensili(cartellaRoot, 12);
    return {
      ok: true,
      path: cartellaRoot,
      pathPadre: cartellaPadre,
      giaEsisteva: giaEsiste,
      cartelleCreate: created.length,
      mesi: created.map(c => c.mese)
    };
  } catch (err) {
    console.error("Errore creazione cartelle:", err);
    return { ok: true, path: cartellaRoot, errore: err.message };
  }
});

// Handler: verifica stato cartella (raggiungibile/offline)
ipcMain.handle("verifica-stato-cartella", async () => {
  return await verificaRootRaggiungibile();
});

// Handler: ottieni cartella offline temporanea (esistente o creata)
ipcMain.handle("attiva-modalita-offline", async (event, { meseYYYYMM }) => {
  const offlineRoot = cartellaOffline();
  try {
    await fsp.mkdir(offlineRoot, { recursive: true });
    if (meseYYYYMM) {
      await creaCartelleMese(offlineRoot, meseYYYYMM);
    }
    return { ok: true, path: offlineRoot };
  } catch (err) {
    return { ok: false, errore: err.message };
  }
});

// Handler: sincronizza file dalla cartella offline al NAS (quando torna online)
ipcMain.handle("sincronizza-offline", async () => {
  const s = leggiImpostazioni();
  if (!s.cartellaRoot) return { ok: false, errore: "Nessuna cartella root configurata" };

  const offlineRoot = cartellaOffline();
  if (!fs.existsSync(offlineRoot)) {
    return { ok: true, fileSpostati: 0, motivo: "nessun file offline" };
  }

  // Verifico che il NAS sia raggiungibile
  const raggiungibile = await pathEsisteRaggiungibile(s.cartellaRoot, 3000);
  if (!raggiungibile) {
    return { ok: false, errore: "Cartella destinazione non raggiungibile" };
  }

  let fileSpostati = 0;
  let cartelleSpostate = 0;
  const errori = [];

  // Funzione ricorsiva per spostare file
  async function spostaRicorsivo(srcDir, destDir) {
    await fsp.mkdir(destDir, { recursive: true });
    const entries = await fsp.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        await spostaRicorsivo(srcPath, destPath);
        // Provo a cancellare la cartella src se è vuota
        try {
          await fsp.rmdir(srcPath);
          cartelleSpostate++;
        } catch (e) { /* non vuota, lascia */ }
      } else if (entry.isFile()) {
        // Se file di lock, lo salto
        if (entry.name.endsWith(".lock")) continue;
        // Se il file di destinazione esiste già, lo lascio (non sovrascrivo per sicurezza)
        if (fs.existsSync(destPath)) {
          // Lo rinomino con suffisso (ad es. "_offline-<timestamp>")
          const ext = path.extname(entry.name);
          const base = path.basename(entry.name, ext);
          const newName = `${base}_offline-${Date.now()}${ext}`;
          const newDest = path.join(destDir, newName);
          await fsp.rename(srcPath, newDest);
        } else {
          await fsp.rename(srcPath, destPath);
        }
        fileSpostati++;
      }
    }
  }

  try {
    await spostaRicorsivo(offlineRoot, s.cartellaRoot);
    // Provo a cancellare la cartella offline radice se è vuota
    try { await fsp.rmdir(offlineRoot); } catch (e) {}
    try { await fsp.rmdir(path.dirname(offlineRoot)); } catch (e) {}
    return { ok: true, fileSpostati, cartelleSpostate };
  } catch (err) {
    console.error("Errore sincronizzazione offline:", err);
    return { ok: false, errore: err.message, fileSpostati, errori };
  }
});

// ============================================================
// CONVERSIONE DOCX → PDF tramite Microsoft Word (background)
// ============================================================
// Usa PowerShell per pilotare Word via COM automation.
// Word viene aperto INVISIBILE (Visible = false), converte, e si chiude.
// Richiede Microsoft Word installato sul PC.

const { exec } = require("child_process");

function convertiDocxInPdf(docxPath, pdfPath) {
  return new Promise((resolve) => {

    // === MAC ===
    if (process.platform === "darwin") {
      const { execFile } = require("child_process");
      // AppleScript salvato su file per evitare problemi di escape con -e
      const docxEscaped = docxPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const pdfEscaped  = pdfPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const script = `
on run
  set inFile to POSIX file "${docxEscaped}"
  set outFile to POSIX file "${pdfEscaped}"
  tell application "Microsoft Word"
    open inFile
    set theDoc to active document
    save as theDoc file name (outFile as text) file format format PDF
    close theDoc saving no
  end tell
end run
`.trim();
      const tmpScript = path.join(app.getPath("temp"), "conv_" + Date.now() + ".scpt");
      try { fs.writeFileSync(tmpScript, script, "utf8"); } catch(e) {}
      execFile("osascript", [tmpScript], { timeout: 90000 }, async (err) => {
        try { fs.unlinkSync(tmpScript); } catch(e) {}
        if (fs.existsSync(pdfPath)) return resolve({ ok: true });
        // Fallback: LibreOffice
        const outDir = path.dirname(pdfPath);
        const libreCmd = `/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`;
        exec(libreCmd, { timeout: 60000 }, async (err2) => {
          if (err2) {
            return resolve({ ok: false, errore: "Word non disponibile e LibreOffice non trovato. Installa Microsoft Word o LibreOffice per generare PDF sul Mac." });
          }
          const docxBase = path.basename(docxPath).replace(/\.docx$/i, "");
          const generato = path.join(outDir, docxBase + ".pdf");
          try {
            if (generato !== pdfPath && fs.existsSync(generato)) {
              await fsp.rename(generato, pdfPath);
            }
            resolve({ ok: fs.existsSync(pdfPath) });
          } catch(e) {
            resolve({ ok: false, errore: e.message });
          }
        });
      });
      return;
    }

    // === LINUX (test) ===
    if (process.platform !== "win32") {
      const outDir = path.dirname(pdfPath);
      const cmd = `libreoffice --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`;
      exec(cmd, { timeout: 60000 }, async (err) => {
        if (err) return resolve({ ok: false, errore: "LibreOffice non disponibile: " + err.message });
        const docxBase = path.basename(docxPath).replace(/\.docx$/i, "");
        const generato = path.join(outDir, docxBase + ".pdf");
        try {
          if (generato !== pdfPath && fs.existsSync(generato)) await fsp.rename(generato, pdfPath);
          resolve({ ok: fs.existsSync(pdfPath) });
        } catch(e) { resolve({ ok: false, errore: e.message }); }
      });
      return;
    }

    // === WINDOWS: Word via PowerShell COM ===
    // Scrivo lo script su file .ps1 temporaneo per evitare problemi di encoding
    const tmpPs1 = path.join(os.tmpdir(), "gama_conv_" + Date.now() + ".ps1");

    const psScript = `
$ErrorActionPreference = 'Stop'
$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open('${docxPath.replace(/'/g, "''")}', $false, $true)
  $doc.SaveAs([ref]'${pdfPath.replace(/'/g, "''")}', [ref]17)
  $doc.Close($false)
  Write-Output 'OK'
} catch {
  Write-Output ('ERRORE: ' + $_.Exception.Message)
} finally {
  if ($word -ne $null) {
    try { $word.Quit() } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  }
}`.trim();

    try { fs.writeFileSync(tmpPs1, psScript, "utf8"); } catch(e) {}

    exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpPs1}"`,
      { timeout: 60000, windowsHide: true },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpPs1); } catch(e) {}
        const output = (stdout || "").trim();
        if (fs.existsSync(pdfPath)) return resolve({ ok: true });
        if (err) return resolve({ ok: false, errore: "Word errore: " + err.message });
        if (output.startsWith("ERRORE")) return resolve({ ok: false, errore: output });
        resolve({ ok: false, errore: "Conversione fallita: " + (output || stderr || "output vuoto") });
      }
    );
  });
}

// La web app chiede di salvare un consuntivo.
// NUOVA LOGICA (v2.7):
// - Il .docx viene salvato sul NAS (in CONSULTIVI GAMA/mese/CBRE o CREVAL/)
// - Il .pdf viene generato e salvato DIRETTAMENTE sul DESKTOP locale (solo CBRE/CREVAL; i DUSSMANN col Word)
// - Il docx temporaneo usato per la conversione PDF viene cancellato
ipcMain.handle("salva-consuntivo", async (event, { tipo, meseYYYYMM, filename, arrayBuffer, gruppo }) => {
  const s = leggiImpostazioni();
  if (!s.cartellaRoot) {
    return { ok: false, errore: "Cartella root non impostata" };
  }

  try {
    const meseFolder = nomeCartellaMese(meseYYYYMM);
    const tipoFolder = tipo.toUpperCase();
    const safeFilename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const buffer = Buffer.from(arrayBuffer);

    // STRUTTURA CARTELLE:
    // - CBRE/CREVAL/altri: <root> > MESE > TIPO
    // - DUSSMANN:
    //     se è impostata una cartella DUSSMANN dedicata: <cartellaDussmann> > MESE > GRUPPO
    //     altrimenti (ripiego): <root> > DUSSMANN > MESE > GRUPPO
    const gruppoSafe = gruppo ? gruppo.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") : null;
    const usaCartellaDussDedicata = (tipo === "dussmann" && gruppoSafe && s.cartellaDussmann);

    function buildSubPath(base) {
      if (tipo === "dussmann" && gruppoSafe) {
        if (s.cartellaDussmann && base === s.cartellaRoot) {
          // gestito sotto con rootDaUsare specifico
          return path.join(base, "DUSSMANN", meseFolder, gruppoSafe);
        }
        return path.join(base, "DUSSMANN", meseFolder, gruppoSafe);
      }
      return path.join(base, meseFolder, tipoFolder);
    }

    // === POSTO 1: NAS — salvo il .docx ===
    // Per i DUSSMANN con cartella dedicata, uso quella come radice (struttura: MESE > GRUPPO).
    let rootDaUsare, inOffline, nasDir;
    if (usaCartellaDussDedicata) {
      const raggiungibile = await pathEsisteRaggiungibile(s.cartellaDussmann, 3000);
      rootDaUsare = raggiungibile ? s.cartellaDussmann : path.join(cartellaOffline(), "DUSSMANN GAMA");
      inOffline = !raggiungibile;
      nasDir = path.join(rootDaUsare, meseFolder, gruppoSafe);
    } else {
      const raggiungibile = await pathEsisteRaggiungibile(s.cartellaRoot, 3000);
      rootDaUsare = raggiungibile ? s.cartellaRoot : cartellaOffline();
      inOffline = !raggiungibile;
      nasDir = buildSubPath(rootDaUsare);
    }
    await fsp.mkdir(nasDir, { recursive: true });
    const docxPathNas = path.join(nasDir, safeFilename);
    await fsp.writeFile(docxPathNas, buffer);

    // === POSTO 2: DESKTOP — genero e salvo il .pdf ===
    // Per i DUSSMANN con cartella dedicata, il PDF va NELLA STESSA cartella del
    // Word (insieme). Per CBRE/CREVAL il PDF va DIRETTAMENTE sul Desktop, senza
    // nessuna cartella (solo il file .pdf).
    const desktopDir = app.getPath("desktop");
    let pdfDir;
    if (usaCartellaDussDedicata) {
      pdfDir = nasDir; // stessa cartella del docx (Word + PDF insieme)
    } else {
      pdfDir = desktopDir; // CBRE/CREVAL: PDF direttamente sul Desktop, senza cartelle
    }
    await fsp.mkdir(pdfDir, { recursive: true });

    const pdfFilename = safeFilename.replace(/\.docx$/i, "") + ".pdf";
    const pdfPath = path.join(pdfDir, pdfFilename);

    // Per la conversione uso un docx temporaneo nella cartella temp di sistema
    const tmpDocxPath = path.join(os.tmpdir(), `gama_tmp_${Date.now()}_${safeFilename}`);
    await fsp.writeFile(tmpDocxPath, buffer);

    // Converto in PDF tramite Word
    const conv = await convertiDocxInPdf(tmpDocxPath, pdfPath);

    // Cancello il docx TEMPORANEO (NON quello sul NAS!)
    try { await fsp.unlink(tmpDocxPath); } catch (e) {}

    // Risultato
    const risultato = {
      ok: true,
      fullPath: docxPathNas,
      relativePath: path.relative(rootDaUsare, docxPathNas),
      inOffline,
      cartellaUsata: rootDaUsare,
      docxSalvato: true,
      docxPath: docxPathNas
    };

    if (conv.ok) {
      risultato.pdfSalvato = true;
      risultato.pdfPath = pdfPath;
      risultato.pdfRelative = usaCartellaDussDedicata
        ? path.relative(rootDaUsare, pdfPath)
        : path.relative(desktopDir, pdfPath);
    } else {
      risultato.pdfFallito = true;
      risultato.erroreConversione = conv.errore;
      risultato.avviso = "Word non disponibile: PDF non creato (il .docx sul NAS è comunque salvato)";
    }

    // === POSTO 3: GOOGLE DRIVE — carico il Word in Consuntivi/<TIPO> ===
    // (CBRE / CREVAL / DUSSMANN: tipoFolder è già il nome giusto)
    try {
      const drive = await caricaSuDrive(tipoFolder, meseYYYYMM, safeFilename, buffer);
      risultato.driveOk = !!drive.ok;
      if (drive.ok) risultato.driveLink = drive.link;
      else risultato.driveErrore = drive.errore;
    } catch (e) {
      risultato.driveOk = false;
      risultato.driveErrore = e.message;
    }

    return risultato;
  } catch (err) {
    console.error("Errore salva-consuntivo:", err);
    return { ok: false, errore: err.message };
  }
});

// Apre una nuova email con il PDF già allegato.
// Prova prima Thunderbird (allega da solo), poi ripiega su mailto (senza allegato).
ipcMain.handle("apri-email-con-pdf", async (event, { pdfPath, odl }) => {
  const { execFile } = require("child_process");
  const corpo = odl ? `ODL: ${odl}` : "";

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return { ok: false, errore: "PDF non trovato" };
  }

  // Percorsi tipici di installazione di Thunderbird su Windows
  const percorsiThunderbird = [
    "C:\\Program Files\\Mozilla Thunderbird\\thunderbird.exe",
    "C:\\Program Files (x86)\\Mozilla Thunderbird\\thunderbird.exe"
  ];
  const thunderbird = percorsiThunderbird.find(p => fs.existsSync(p));

  if (thunderbird) {
    // Thunderbird: -compose con attachment allega il PDF automaticamente
    // I campi sono separati da virgola: to='',subject='',body='...',attachment='percorso'
    const composeArg =
      `to='',subject='',body='${corpo.replace(/'/g, "")}',attachment='${pdfPath}'`;
    return new Promise((resolve) => {
      execFile(thunderbird, ["-compose", composeArg], (err) => {
        if (err) {
          console.error("Errore apertura Thunderbird:", err);
          resolve({ ok: false, errore: err.message, metodo: "thunderbird" });
        } else {
          resolve({ ok: true, metodo: "thunderbird" });
        }
      });
    });
  }

  // Ripiego: nessun Thunderbird trovato → apro il client mailto predefinito
  // (senza allegato, perché mailto non supporta allegati) + apro la cartella del PDF
  try {
    const mailto = `mailto:?subject=&body=${encodeURIComponent(corpo)}`;
    await shell.openExternal(mailto);
    shell.showItemInFolder(pdfPath); // apro la cartella col PDF evidenziato
    return { ok: true, metodo: "mailto", senzaAllegato: true };
  } catch (err) {
    return { ok: false, errore: err.message };
  }
});

// Crea le cartelle mensili
ipcMain.handle("prepara-cartelle-mensili", async (event, mesiAvanti) => {
  const s = leggiImpostazioni();
  if (!s.cartellaRoot) {
    return { ok: false, errore: "Cartella root non impostata" };
  }
  try {
    const created = await preparaCartelleMensili(s.cartellaRoot, mesiAvanti || 12);
    return { ok: true, count: created.length, mesi: created.map(c => c.mese) };
  } catch (err) {
    console.error("Errore preparaCartelleMensili:", err);
    return { ok: false, errore: err.message };
  }
});

// Apri una sottocartella (es. mese corrente) nel file explorer
ipcMain.handle("apri-cartella", async (event, sottoPath) => {
  const s = leggiImpostazioni();
  if (!s.cartellaRoot) return { ok: false, errore: "Cartella root non impostata" };
  const target = sottoPath ? path.join(s.cartellaRoot, sottoPath) : s.cartellaRoot;
  if (!fs.existsSync(target)) return { ok: false, errore: "Cartella non esiste: " + target };
  shell.openPath(target);
  return { ok: true, path: target };
});

// Reset cartella: cancella l'impostazione, l'utente dovrà sceglierne una nuova
ipcMain.handle("reset-cartella", async () => {
  const r = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Cambia cartella consuntivi",
    message: "Vuoi cambiare la cartella di salvataggio?",
    detail: "I file già salvati nella vecchia cartella NON verranno spostati. Devi farlo manualmente se vuoi mantenerli tutti insieme.",
    buttons: ["Annulla", "Sì, scegli nuova cartella"],
    cancelId: 0,
    defaultId: 0
  });
  if (r.response !== 1) return { ok: false, canceled: true };

  const settings = leggiImpostazioni();
  delete settings.cartellaRoot;
  salvaImpostazioni(settings);
  return { ok: true };
});

ipcMain.handle("get-versione", async () => ({ versione: app.getVersion() }));

ipcMain.handle("get-platform", async () => process.platform);

ipcMain.handle("apri-pagina-aggiornamenti-mac", async () => {
  shell.openExternal("https://github.com/ServiziDc/gama-consuntivi-releases/releases/latest");
});

// Genera un PDF dal docx e lo salva sul Desktop
ipcMain.handle("salva-anteprima-pdf-desktop", async (event, { filename, arrayBuffer, isAnteprima = true }) => {
  try {
    const desktopDir = app.getPath("desktop");
    const tmpDocx = path.join(app.getPath("temp"), "anteprima_tmp_" + Date.now() + ".docx");
    // Nome PDF sul Desktop. Se anteprima → "ANTEPRIMA - [nome].pdf", altrimenti "[nome].pdf"
    let nomePulito = filename.replace(/\.docx$/i, "").replace(/^ANTEPRIMA\s*-\s*/i, "");
    // Sanifico il nome: rimuovo caratteri vietati, newline, e accorcio se troppo lungo
    nomePulito = nomePulito
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")  // caratteri vietati nei nomi file Windows
      .replace(/[\r\n]+/g, " ")                 // newline → spazio
      .replace(/\./g, "")                       // tolgo i punti (problemi con SaveAs)
      .replace(/\s+/g, " ")                     // spazi multipli → singolo
      .trim()
      .substring(0, 100);                       // max 100 caratteri
    if (!nomePulito) nomePulito = "documento";
    const nomePdf = (isAnteprima ? "ANTEPRIMA - " : "") + nomePulito + ".pdf";
    const pdfPath = path.join(desktopDir, nomePdf);
    // arrayBuffer può essere un Array di numeri (da Array.from(Uint8Array)) o un ArrayBuffer
    const buffer = Array.isArray(arrayBuffer)
      ? Buffer.from(arrayBuffer)
      : Buffer.from(arrayBuffer);
    await fsp.writeFile(tmpDocx, buffer);
    const docxScritto = fs.existsSync(tmpDocx);
    const risultato = await convertiDocxInPdf(tmpDocx, pdfPath);
    try { await fsp.unlink(tmpDocx); } catch(e) {}
    if (risultato.ok) {
      return { ok: true, pdfPath };
    } else {
      // Mostro un popup con i dettagli dell'errore per capire cosa non va
      try {
        dialog.showMessageBox(mainWindow, {
          type: "error",
          title: "Errore generazione PDF",
          message: "Non sono riuscito a creare il PDF anteprima.",
          detail: "Dettagli tecnici:\n\n" +
            "• Cartella Desktop: " + desktopDir + "\n" +
            "• DOCX temporaneo scritto: " + (docxScritto ? "SI" : "NO") + "\n" +
            "• Percorso PDF: " + pdfPath + "\n" +
            "• Errore: " + (risultato.errore || "sconosciuto") + "\n\n" +
            "Sistema: " + process.platform
        });
      } catch(e) {}
      return { ok: false, errore: risultato.errore || "Conversione fallita" };
    }
  } catch(e) {
    try {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Errore generazione PDF",
        message: "Errore imprevisto durante la creazione del PDF.",
        detail: e.message + "\n\n" + (e.stack || "")
      });
    } catch(err) {}
    return { ok: false, errore: e.message };
  }
});
// Con lock cooperativo per evitare conflitti quando più PC scrivono insieme sul NAS
// Legge le CELLE DI TESTO da un Excel esistente, riga per riga.
// Serve per importare in Firebase le modifiche fatte a mano nell'Excel.
// Restituisce { esiste, righe: { "6": {B:"...", E:"...", ...}, ... } }
ipcMain.handle("leggi-celle-excel", async (event, { meseYYYYMM, filename }) => {
  try {
    const s = leggiImpostazioni();
    if (!s.cartellaRoot) return { esiste: false };
    const raggiungibile = await pathEsisteRaggiungibile(s.cartellaRoot, 3000);
    const rootDaUsare = raggiungibile ? s.cartellaRoot : cartellaOffline();
    const meseFolder = nomeCartellaMese(meseYYYYMM);
    const isCreval = /CREVAL/i.test(filename);
    const sottoTipo = isCreval ? "CREVAL" : "CBRE";
    const safeFilename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const fullPath = path.join(rootDaUsare, meseFolder, sottoTipo, safeFilename);

    if (!fs.existsSync(fullPath)) return { esiste: false };

    const buf = await fsp.readFile(fullPath);
    return { esiste: true, base64: buf.toString("base64") };
  } catch (err) {
    console.warn("leggi-celle-excel:", err.message);
    return { esiste: false, errore: err.message };
  }
});

// Legge un file Excel del mese GIÀ ESISTENTE dal disco e lo restituisce come base64.
// Serve per l'Opzione A: usare il file esistente (coi colori/note dell'utente) come
// base, invece del template pulito. Restituisce esiste:false se il file non c'è ancora.
ipcMain.handle("leggi-excel-esistente", async (event, { meseYYYYMM, filename }) => {
  try {
    const s = leggiImpostazioni();
    if (!s.cartellaRoot) return { esiste: false };
    const raggiungibile = await pathEsisteRaggiungibile(s.cartellaRoot, 3000);
    const rootDaUsare = raggiungibile ? s.cartellaRoot : cartellaOffline();
    const meseFolder = nomeCartellaMese(meseYYYYMM);
    const isCreval = /CREVAL/i.test(filename);
    const sottoTipo = isCreval ? "CREVAL" : "CBRE";
    const safeFilename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const fullPath = path.join(rootDaUsare, meseFolder, sottoTipo, safeFilename);

    if (!fs.existsSync(fullPath)) return { esiste: false };

    // Verifico che il file non sia aperto/bloccato (es. Excel aperto)
    // provando ad aprirlo in lettura+scrittura
    try {
      const fd = fs.openSync(fullPath, "r+");
      fs.closeSync(fd);
    } catch (e) {
      // Bloccato: probabilmente l'utente ha l'Excel aperto
      return { esiste: true, bloccato: true };
    }

    const buf = await fsp.readFile(fullPath);
    return { esiste: true, bloccato: false, base64: buf.toString("base64") };
  } catch (err) {
    console.warn("leggi-excel-esistente:", err.message);
    return { esiste: false, errore: err.message };
  }
});

ipcMain.handle("salva-excel-mese", async (event, { meseYYYYMM, filename, arrayBuffer }) => {
  const s = leggiImpostazioni();
  if (!s.cartellaRoot) {
    return { ok: false, errore: "Cartella root non impostata" };
  }
  let lockPath = null;
  try {
    // Verifico se la cartella root è raggiungibile (NAS online?)
    const raggiungibile = await pathEsisteRaggiungibile(s.cartellaRoot, 3000);
    const rootDaUsare = raggiungibile ? s.cartellaRoot : cartellaOffline();
    const inOffline = !raggiungibile;

    const meseFolder = nomeCartellaMese(meseYYYYMM);
    // Determino se è CBRE o CREVAL dal nome file, per metterlo nella sottocartella giusta
    const isCreval = /CREVAL/i.test(filename);
    const sottoTipo = isCreval ? "CREVAL" : "CBRE";
    const fullDir = path.join(rootDaUsare, meseFolder, sottoTipo);
    await fsp.mkdir(fullDir, { recursive: true });
    const safeFilename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const fullPath = path.join(fullDir, safeFilename);

    // Acquisisco il lock prima di scrivere (solo se siamo online sul NAS)
    if (!inOffline) {
      const lockResult = await acquisisciLock(fullPath);
      if (!lockResult.acquisito) {
        return { ok: false, errore: `Impossibile acquisire lock: ${lockResult.errore}` };
      }
      lockPath = lockResult.lockPath;
    }

    // Scrivo il file
    const buffer = Buffer.from(arrayBuffer);
    await fsp.writeFile(fullPath, buffer);

    // Rilascio il lock se attivo
    if (lockPath) {
      await rilasciaLock(lockPath);
      lockPath = null;
    }

    return {
      ok: true,
      fullPath,
      relativePath: path.join(meseFolder, sottoTipo, safeFilename),
      inOffline,
      cartellaUsata: rootDaUsare
    };
  } catch (err) {
    console.error("Errore salva-excel-mese:", err);
    // In caso di errore, provo comunque a rilasciare il lock
    if (lockPath) {
      await rilasciaLock(lockPath);
    }
    return { ok: false, errore: err.message };
  }
});

// Elimina i file fisici di un consuntivo: .docx dal NAS + PDF dal Desktop
ipcMain.handle("elimina-file-consuntivo", async (event, { tipo, meseYYYYMM, filenameDocx, gruppo }) => {
  const s = leggiImpostazioni();
  const risultato = { ok: true, docxEliminato: false, pdfEliminato: false, trovatoQualcosa: false };

  const safeFilename = filenameDocx.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  const pdfFilename = safeFilename.replace(/\.docx$/i, "") + ".pdf";
  const tipoFolder = tipo.toUpperCase();
  const meseFolder = nomeCartellaMese(meseYYYYMM);
  const gruppoSafe = gruppo ? gruppo.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") : null;

  // Helper: prova a cancellare un file e segna i flag
  async function prova(p, tipoFile) {
    try {
      if (fs.existsSync(p)) {
        await fsp.unlink(p);
        risultato.trovatoQualcosa = true;
        if (tipoFile === "docx") risultato.docxEliminato = true;
        if (tipoFile === "pdf") risultato.pdfEliminato = true;
        return true;
      }
    } catch (e) { console.warn("Errore unlink:", e.message); }
    return false;
  }

  // Raccolgo tutti i percorsi candidati per docx e pdf, in base al tipo
  const candidatiDocx = [];
  const candidatiPdf = [];
  const desktopDir = app.getPath("desktop");
  const pdfRootName = s.cartellaPdfNome || "PDF CONSUNTIVI";

  if (tipo === "dussmann" && gruppoSafe) {
    // DUSSMANN: Word e PDF insieme nella cartella DUSSMANN (dedicata o ripiego)
    const basi = [];
    if (s.cartellaDussmann) basi.push(s.cartellaDussmann);
    if (s.cartellaRoot) basi.push(path.join(s.cartellaRoot, "DUSSMANN"));
    basi.push(path.join(cartellaOffline(), "DUSSMANN GAMA"));
    basi.push(path.join(cartellaOffline(), "DUSSMANN"));
    for (const base of basi) {
      candidatiDocx.push(path.join(base, meseFolder, gruppoSafe, safeFilename));
      candidatiPdf.push(path.join(base, meseFolder, gruppoSafe, pdfFilename));
    }
  } else if (tipo === "preventivo") {
    // PREVENTIVO: cartella preventivi (+ accettati)
    const basiPrev = [];
    if (s.cartellaPreventivi) basiPrev.push(s.cartellaPreventivi);
    basiPrev.push(path.join(app.getPath("documents"), "PREVENTIVI GAMA"));
    if (s.cartellaAccettati) basiPrev.push(s.cartellaAccettati);
    basiPrev.push(path.join(app.getPath("documents"), "PREVENTIVI ACCETTATI"));
    basiPrev.push(path.join(cartellaOffline(), "PREVENTIVI ACCETTATI"));
    for (const base of basiPrev) {
      // i preventivi sono divisi per anno
      const anno = meseYYYYMM.split("-")[0];
      candidatiDocx.push(path.join(base, anno, safeFilename));
      candidatiDocx.push(path.join(base, safeFilename));
      // anche la versione "ACCETTATO" del nome
      const nomeAcc = safeFilename.replace(/^PREVENTIVO /, "PREVENTIVO ACCETTATO ");
      candidatiDocx.push(path.join(base, anno, nomeAcc));
      candidatiDocx.push(path.join(base, nomeAcc));
    }
  } else {
    // CBRE / CREVAL: ROOT/mese/TIPO + PDF su Desktop
    if (s.cartellaRoot) {
      candidatiDocx.push(path.join(s.cartellaRoot, meseFolder, tipoFolder, safeFilename));
      candidatiDocx.push(path.join(cartellaOffline(), meseFolder, tipoFolder, safeFilename));
    }
    // PDF direttamente sul Desktop (nuovo comportamento). Tengo anche il VECCHIO
    // percorso (PDF CONSUNTIVI/mese/tipo) per cancellare i PDF salvati dalle
    // versioni precedenti, così l'eliminazione funziona in entrambi i casi.
    candidatiPdf.push(path.join(desktopDir, pdfFilename));
    candidatiPdf.push(path.join(desktopDir, pdfRootName, meseFolder, tipoFolder, pdfFilename));
  }

  for (const p of candidatiDocx) await prova(p, "docx");
  for (const p of candidatiPdf) await prova(p, "pdf");

  // === DRIVE: cancello (cestino) anche il file su Drive ===
  // (CBRE/CREVAL/DUSSMANN usano tipoFolder; i preventivi vanno in PREVENTIVI)
  try {
    const categoriaDrive = (tipo === "preventivo") ? "PREVENTIVI" : tipoFolder;
    const driveDel = await eliminaSuDrive(categoriaDrive, meseYYYYMM, safeFilename);
    risultato.driveEliminato = !!driveDel.ok && driveDel.eliminati > 0;
  } catch (e) {
    risultato.driveEliminato = false;
  }

  return risultato;
});

// ============================================================
// BOZZA LAVORO IN CORSO (auto-save)
// ============================================================
// Salva il contenuto dei form in un file locale, così se l'app si chiude
// (anche per aggiornamento) il lavoro non va perso e viene ripristinato.
function pathBozza() {
  return path.join(app.getPath("userData"), "bozza-lavoro.json");
}

ipcMain.handle("salva-bozza", async (event, datiBozza) => {
  try {
    await fsp.writeFile(pathBozza(), JSON.stringify(datiBozza), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, errore: err.message };
  }
});

ipcMain.handle("leggi-bozza", async () => {
  try {
    const p = pathBozza();
    if (!fs.existsSync(p)) return { ok: true, bozza: null };
    const txt = await fsp.readFile(p, "utf8");
    return { ok: true, bozza: JSON.parse(txt) };
  } catch (err) {
    return { ok: false, bozza: null, errore: err.message };
  }
});

ipcMain.handle("cancella-bozza", async () => {
  try {
    const p = pathBozza();
    if (fs.existsSync(p)) await fsp.unlink(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, errore: err.message };
  }
});

// ============================================================
// PREVENTIVI: salvataggio in cartella SEPARATA
// ============================================================
// I preventivi NON vanno nella cartella dei consuntivi. Hanno una loro
// cartella scelta dall'utente (settings.cartellaPreventivi).
ipcMain.handle("seleziona-cartella-preventivi", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli la cartella dove salvare i PREVENTIVI",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: app.getPath("documents")
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  const cartellaPadre = result.filePaths[0];
  const cartellaPreventivi = path.join(cartellaPadre, "PREVENTIVI GAMA");
  try {
    await fsp.mkdir(cartellaPreventivi, { recursive: true });
  } catch (err) {
    return { ok: false, errore: err.message };
  }
  const settings = leggiImpostazioni();
  settings.cartellaPreventivi = cartellaPreventivi;
  salvaImpostazioni(settings);
  return { ok: true, path: cartellaPreventivi };
});

ipcMain.handle("get-cartella-preventivi", async () => {
  const s = leggiImpostazioni();
  return { path: s.cartellaPreventivi || null };
});

// --- Cartella DUSSMANN (separata) ---
ipcMain.handle("seleziona-cartella-dussmann", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli la cartella dove salvare i DUSSMANN",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: app.getPath("documents")
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  const cartellaPadre = result.filePaths[0];
  const cartellaDussmann = path.join(cartellaPadre, "DUSSMANN GAMA");
  try {
    await fsp.mkdir(cartellaDussmann, { recursive: true });
  } catch (err) {
    return { ok: false, errore: err.message };
  }
  const settings = leggiImpostazioni();
  settings.cartellaDussmann = cartellaDussmann;
  salvaImpostazioni(settings);
  return { ok: true, path: cartellaDussmann };
});

ipcMain.handle("get-cartella-dussmann", async () => {
  const s = leggiImpostazioni();
  return { path: s.cartellaDussmann || null };
});

// --- Cartella PREVENTIVI ACCETTATI (separata) ---
ipcMain.handle("seleziona-cartella-accettati", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Scegli la cartella dove salvare i PREVENTIVI ACCETTATI",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: app.getPath("documents")
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  const cartellaPadre = result.filePaths[0];
  const cartellaAccettati = path.join(cartellaPadre, "PREVENTIVI ACCETTATI");
  try {
    await fsp.mkdir(cartellaAccettati, { recursive: true });
  } catch (err) {
    return { ok: false, errore: err.message };
  }
  const settings = leggiImpostazioni();
  settings.cartellaAccettati = cartellaAccettati;
  salvaImpostazioni(settings);
  return { ok: true, path: cartellaAccettati };
});

ipcMain.handle("get-cartella-accettati", async () => {
  const s = leggiImpostazioni();
  return { path: s.cartellaAccettati || null };
});

// Salva il preventivo ACCETTATO (docx col timbro) nella cartella accettati
// === Salva l'ODL (PDF) di un consuntivo: NAS (stessa cartella del Word) + Drive (abbinato) ===
// Il nome dell'ODL = nome del consuntivo + " - ODL.pdf", cosi' la pagina li abbina da soli.
// Funziona anche per la SOSTITUZIONE: cancella il vecchio su Drive e ricarica.
ipcMain.handle("salva-odl", async (event, { tipo, meseYYYYMM, consuntivoFilename, pdfArray, indice }) => {
  const s = leggiImpostazioni();
  if (!s.cartellaRoot) return { ok: false, errore: "Cartella root non impostata" };
  try {
    const meseFolder = nomeCartellaMese(meseYYYYMM);
    const tipoFolder = (tipo || "").toUpperCase();
    const base = String(consuntivoFilename || "").replace(/\.docx$/i, "");
    const suffisso = (indice && indice > 1) ? ` - ODL ${indice}.pdf` : " - ODL.pdf";
    const odlName = (base + suffisso).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const buffer = Buffer.from(pdfArray);

    // NAS: stessa cartella del consuntivo (root/MESE/TIPO). Sovrascrive se gia' presente.
    const raggiungibile = await pathEsisteRaggiungibile(s.cartellaRoot, 3000);
    const rootDaUsare = raggiungibile ? s.cartellaRoot : cartellaOffline();
    const nasDir = path.join(rootDaUsare, meseFolder, tipoFolder);
    await fsp.mkdir(nasDir, { recursive: true });
    await fsp.writeFile(path.join(nasDir, odlName), buffer);

    // Drive: stessa cartella mese/tipo. Prima cancello l'eventuale vecchio (sostituzione), poi carico.
    try { await eliminaSuDrive(tipoFolder, meseYYYYMM, odlName); } catch (e) {}
    const up = await caricaSuDrive(tipoFolder, meseYYYYMM, odlName, buffer);

    return { ok: true, odlName, inOffline: !raggiungibile, driveOk: !!(up && up.ok) };
  } catch (e) {
    return { ok: false, errore: e.message };
  }
});

// === Carica su Drive i documenti GIA' ESISTENTI di un mese (CBRE/CREVAL) ===
// "Backfill": legge i .docx dal NAS (<root>/<mese>/CBRE e /CREVAL) e li carica su
// Drive uno per uno. Serve per portare su Drive i consuntivi creati PRIMA che il
// caricamento automatico fosse attivo. Riusa caricaSuDrive (stessa cartella per mese).
ipcMain.handle("carica-mese-su-drive", async (event, { meseYYYYMM, categorie }) => {
  const s = leggiImpostazioni();
  if (!s.cartellaRoot) return { ok: false, errore: "Cartella root non impostata" };
  const cats = (Array.isArray(categorie) && categorie.length) ? categorie : ["CBRE", "CREVAL"];
  const mese = meseYYYYMM || meseCorrente();
  const meseFolderRel = nomeCartellaMese(mese); // es. "2026/06_Giugno_2026"
  const risultato = { ok: true, mese, dettaglio: [], totaleTrovati: 0, totaleCaricati: 0, totaleErrori: 0 };
  try {
    const raggiungibile = await pathEsisteRaggiungibile(s.cartellaRoot, 3000);
    const rootDaUsare = raggiungibile ? s.cartellaRoot : cartellaOffline();
    for (const cat of cats) {
      const dir = path.join(rootDaUsare, meseFolderRel, cat);
      let files = [];
      try {
        const items = await fsp.readdir(dir);
        files = items.filter((n) => /\.docx$/i.test(n) && !n.startsWith("~$"));
      } catch (e) {
        risultato.dettaglio.push({ categoria: cat, trovati: 0, caricati: 0, errori: 0, nota: "cartella non trovata" });
        continue;
      }
      let caricati = 0, errori = 0;
      for (const name of files) {
        try {
          const buffer = await fsp.readFile(path.join(dir, name));
          const up = await caricaSuDrive(cat, mese, name, buffer);
          if (up && up.ok) caricati++; else errori++;
        } catch (e) { errori++; }
      }
      risultato.totaleTrovati += files.length;
      risultato.totaleCaricati += caricati;
      risultato.totaleErrori += errori;
      risultato.dettaglio.push({ categoria: cat, trovati: files.length, caricati, errori });
    }
    return risultato;
  } catch (e) {
    return { ok: false, errore: e.message };
  }
});

ipcMain.handle("salva-preventivo-accettato", async (event, { filename, arrayBuffer }) => {
  const s = leggiImpostazioni();
  // Se non è impostata la cartella accettati, uso Documenti/PREVENTIVI ACCETTATI
  let cartella = s.cartellaAccettati;
  if (!cartella) {
    cartella = path.join(app.getPath("documents"), "PREVENTIVI ACCETTATI");
  }
  try {
    // Più tentativi se il NAS è lento (riuso la stessa logica robusta)
    const raggiungibile = await pathEsisteRaggiungibile(path.dirname(cartella), 3000);
    if (!raggiungibile && s.cartellaAccettati) {
      // NAS non raggiungibile: salvo nella cartella offline per non perdere il file
      cartella = path.join(cartellaOffline(), "PREVENTIVI ACCETTATI");
    }
    await fsp.mkdir(cartella, { recursive: true });
    const safeFilename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const fullPath = path.join(cartella, safeFilename);
    await fsp.writeFile(fullPath, Buffer.from(arrayBuffer));
    const drivePrev = await caricaSuDrive("PREVENTIVI", meseCorrente(), safeFilename, Buffer.from(arrayBuffer));
    return { ok: true, path: fullPath, driveOk: !!drivePrev.ok, driveLink: drivePrev.link, driveErrore: drivePrev.errore };
  } catch (err) {
    console.error("Errore salva-preventivo-accettato:", err);
    return { ok: false, errore: err.message };
  }
});

ipcMain.handle("salva-preventivo", async (event, { filename, arrayBuffer }) => {
  const s = leggiImpostazioni();
  // Se non è stata scelta una cartella preventivi, uso Documenti/PREVENTIVI GAMA
  let cartella = s.cartellaPreventivi;
  if (!cartella) {
    cartella = path.join(app.getPath("documents"), "PREVENTIVI GAMA");
  }
  try {
    // Organizzo per anno
    const anno = new Date().getFullYear().toString();
    const dirFinale = path.join(cartella, anno);
    await fsp.mkdir(dirFinale, { recursive: true });
    const safeFilename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const fullPath = path.join(dirFinale, safeFilename);
    await fsp.writeFile(fullPath, Buffer.from(arrayBuffer));
    const drivePrev = await caricaSuDrive("PREVENTIVI", meseCorrente(), safeFilename, Buffer.from(arrayBuffer));
    return { ok: true, fullPath, path: path.join(anno, safeFilename), driveOk: !!drivePrev.ok, driveLink: drivePrev.link, driveErrore: drivePrev.errore };
  } catch (err) {
    console.error("Errore salva-preventivo:", err);
    return { ok: false, errore: err.message };
  }
});

// ============================================================
// CICLO DI VITA
// ============================================================

// ============================================================
// AUTO-UPDATE da GitHub Releases
// ============================================================
// Controlla se c'è una versione più nuova pubblicata su GitHub.
// Se la trova, la scarica e la installa automaticamente, poi riavvia.
// L'utente non deve fare niente.
function configuraAutoUpdate() {
  if (!autoUpdater) {
    console.log("Auto-update non disponibile (modulo mancante)");
    return;
  }

  // Configurazione: scarica e installa in automatico
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Forzo il download del pacchetto completo (no differenziale, più affidabile)
  autoUpdater.disableDifferentialDownload = true;
  // L'app NON è firmata digitalmente: non uso il web installer
  autoUpdater.disableWebInstaller = true;

  // Imposto il feed direttamente ai file della release su GitHub.
  // Questo evita il feed "releases.atom" che sulla rete aziendale dà
  // errori 504 (Gateway Time-out). Leggendo direttamente i file della
  // release (latest.yml + exe) il controllo è più affidabile.
  try {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: "https://github.com/ServiziDc/gama-consuntivi-releases/releases/latest/download"
    });
  } catch (e) {
    console.warn("Impossibile impostare feed URL diretto:", e.message);
  }

  // Scrivo un file di log degli aggiornamenti, utile per diagnosticare problemi.
  // Si trova in: %APPDATA%\Gama Consuntivi\logs\  (o cartella userData/logs)
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "update.log");
    autoUpdater.logger = {
      info: (m) => { try { fs.appendFileSync(logFile, `[INFO ${new Date().toISOString()}] ${m}\n`); } catch(e){} },
      warn: (m) => { try { fs.appendFileSync(logFile, `[WARN ${new Date().toISOString()}] ${m}\n`); } catch(e){} },
      error: (m) => { try { fs.appendFileSync(logFile, `[ERROR ${new Date().toISOString()}] ${m}\n`); } catch(e){} },
      debug: (m) => { try { fs.appendFileSync(logFile, `[DEBUG ${new Date().toISOString()}] ${m}\n`); } catch(e){} }
    };
  } catch (e) {
    console.warn("Impossibile creare log updater:", e.message);
  }

  // Funzione per mandare messaggi di stato alla finestra (per l'indicatore UI)
  function notificaRenderer(canale, dati) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(canale, dati);
    }
  }

  autoUpdater.on("checking-for-update", () => {
    console.log("Controllo aggiornamenti...");
    notificaRenderer("update-status", { stato: "controllo" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log("Aggiornamento disponibile:", info.version);
    notificaRenderer("update-status", { stato: "disponibile", versione: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("App già aggiornata");
    notificaRenderer("update-status", { stato: "aggiornata" });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent);
    notificaRenderer("update-status", { stato: "download", percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("Aggiornamento scaricato, verrà installato:", info.version);
    notificaRenderer("update-status", { stato: "scaricato", versione: info.version });
    // Installo e riavvio dopo 4 secondi (do tempo all'utente di vedere il messaggio).
    // Con oneClick:true l'installer NSIS si installa in silenzio e riavvia l'app.
    setTimeout(() => {
      try {
        isQuittingForUpdate = true;
        // isSilent=true (installa senza UI), isForceRunAfter=true (riapre l'app dopo)
        autoUpdater.quitAndInstall(true, true);
      } catch (e) {
        console.error("Errore quitAndInstall:", e);
        // Fallback: chiudo l'app, l'aggiornamento si installerà alla chiusura
        app.quit();
      }
    }, 4000);
  });

  autoUpdater.on("error", (err) => {
    console.error("Errore auto-update:", err);
    notificaRenderer("update-status", { stato: "errore", messaggio: String(err && err.message ? err.message : err) });
  });

  // Avvio il controllo (solo se l'app è "impacchettata", non in sviluppo)
  if (app.isPackaged) {
    // Aspetto qualche secondo dopo l'avvio per non rallentare l'apertura
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.warn("Controllo aggiornamenti fallito:", err.message);
      });
    }, 5000);
    // Ricontrollo ogni 30 minuti (se l'app resta aperta a lungo)
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 30 * 60 * 1000);
  } else {
    console.log("App in sviluppo: auto-update disattivato");
  }
}

// ============================================================
// DIZIONARI OFFLINE — copia nella cache di Electron
// ============================================================
// Electron tiene i dizionari del correttore in {userData}/Dictionaries.
// Copio lì i file inclusi nel programma (con i nomi ESATTI delle versioni),
// così il correttore li trova GIA' pronti e NON deve scaricarli da internet.
// È per questo che prima l'italiano non partiva: il download era bloccato,
// mentre l'inglese era già stato scaricato.
function preparaDizionariOffline() {
  try {
    const dictDir = path.join(app.getPath("userData"), "Dictionaries");
    fs.mkdirSync(dictDir, { recursive: true });
    const srcDir = path.join(__dirname, "src", "assets", "dictionaries");
    for (const nome of ["it-IT-3-0.bdic", "en-US-10-1.bdic"]) {
      const src = path.join(srcDir, nome);
      const dst = path.join(dictDir, nome);
      if (!fs.existsSync(src)) continue;
      let copia = true;
      try {
        if (fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size) copia = false;
      } catch (_) {}
      if (copia) fs.writeFileSync(dst, fs.readFileSync(src));
    }
    console.log("[Correttore] Dizionari pronti in", dictDir);
  } catch (e) {
    console.error("[Correttore] preparaDizionariOffline:", e.message);
  }
}

// ============================================================
// SERVER LOCALE DEI DIZIONARI (correttore ortografico offline)
// ============================================================
// I dizionari .bdic sono inclusi nel programma (src/assets/dictionaries).
// Avvio un piccolo server su 127.0.0.1 che li serve a Electron: così il
// correttore italiano funziona SEMPRE, anche senza internet o con il
// firewall aziendale che blocca i download di Google.
function avviaServerDizionari() {
  return new Promise((resolve) => {
    try {
      const dir = path.join(__dirname, "src", "assets", "dictionaries");
      const dizionari = {
        it: fs.readFileSync(path.join(dir, "it-IT-3-0.bdic")),
        en: fs.readFileSync(path.join(dir, "en-US-10-1.bdic"))
      };
      const server = http.createServer((req, res) => {
        // Electron chiede file tipo "it-IT-3-0.bdic": prendo le prime 2 lettere
        const m = (req.url || "").replace(/^\//, "").match(/^([a-zA-Z]{2})/);
        const lang = m ? m[1].toLowerCase() : "";
        const buf = dizionari[lang];
        if (buf) {
          res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": buf.length });
          res.end(buf);
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      server.on("error", (e) => {
        console.error("[Correttore] Server dizionari errore:", e.message);
        resolve();
      });
      server.listen(0, "127.0.0.1", () => {
        portaServerDizionari = server.address().port;
        console.log("[Correttore] Dizionari serviti da 127.0.0.1:" + portaServerDizionari);
        resolve();
      });
    } catch (e) {
      console.error("[Correttore] Impossibile avviare il server dizionari:", e.message);
      resolve();
    }
  });
}

app.whenReady().then(async () => {
  // Copio i dizionari nella cache di Electron (così il correttore li trova
  // già pronti) e avvio il server locale di riserva, PRIMA della finestra.
  preparaDizionariOffline();
  await avviaServerDizionari();

  // CONTROLLO ATTIVAZIONE: se il programma non è ancora attivato su questo PC,
  // mostro la schermata di attivazione. Altrimenti avvio normalmente.
  if (attivazione.eAttivato(app)) {
    creaFinestra();
    // Avvio il controllo aggiornamenti dopo che la finestra è pronta
    configuraAutoUpdate();
  } else {
    mostraFinestraAttivazione();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (attivazione.eAttivato(app)) creaFinestra();
      else mostraFinestraAttivazione();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (event, contents) => {
  contents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
});
