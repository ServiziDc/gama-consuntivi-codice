// ============================================================
// APP GENERATORE CONSUNTIVI CBRE + CREVAL - Gama Service
// v2: doppio tipo (CBRE/CREVAL), salvataggio automatico in cartelle
// ============================================================

let fb = null;
let firebaseReady = false;

// Categorie per tipo
const CATEGORIE = {
  cbre: [
    { value: "bnl", label: "BNL + FINDOMESTIC" },
    { value: "torre_diamante", label: "TORRE DIAMANTE / SMERALDO" },
    { value: "mediobanca", label: "MEDIOBANCA + BCC + BENETTON + RMA" },
    { value: "ceva", label: "CEVA LOGISTICS ITALIA" },
    { value: "bdb", label: "BDB" },
    { value: "padovani", label: "PADOVANI" },
    { value: "keller", label: "KELLER (MICRON / POSTE / ecc.)" }
  ],
  creval: [
    { value: "creval", label: "CREVAL (filiali)" }
  ]
};

// Copia delle categorie CBRE di base: serve per ricostruire la lista quando
// arrivano i clienti personalizzati (così non si duplicano a ogni ricarica).
const BASE_CATEGORIE_CBRE = CATEGORIE.cbre.slice();

// Trasforma il nome scritto dall'utente in una chiave valida e univoca.
// Prefisso "cst_" per non confondersi mai coi clienti fissi (bnl, keller, ...).
function slugCliente(nome) {
  const base = (nome || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 30);
  return "cst_" + (base || "cliente");
}

// Default partenza numeri
const DEFAULT_START = {
  cbre: 304,   // ultimo CBRE creato è 303, prossimo = 304
  creval: 1    // CREVAL: parte da 1, l'utente lo sistema dalle impostazioni
};

// Stato globale
const state = {
  prossimoNumeroCbre: null,
  prossimoNumeroCreval: null,
  prossimoNumeroPreventivo: null,
  prossimoNumeroDussmann: { nhood: null, edile: null, impiantistica: null, unico: null },
  modificaInCorso: null,
  modificaInCorsoDuss: null,
  modificaInCorsoPrev: null,
  modificaInCorsoRigaManuale: null,
  meseCorrente: null,            // formato "YYYY-MM"
  consuntiviMese: [],
  dussmannMese: [],
  preventiviMese: [],
  destinatariPreventivi: [],
  righeManualiMese: [],
  clientiCustom: [],             // clienti CBRE personalizzati (caricati da Firebase)
  templateExcel: null,
  cartellaRoot: null,            // handle FileSystemDirectoryHandle (browser) o path (Electron)
  cartellaRootName: null,        // nome cartella per UI
  // Rilevo l'ambiente: Electron (con API ricca) o browser puro
  isElectron: !!(window.electronAPI && window.electronAPI.isElectron),
  modalitaTest: false,
  fsApiSupported: ("showDirectoryPicker" in window),
  settings: {
    intestazione: "GAMA SERVICE S.R.L VIALE MONZA,69 20845, SOVICO (MB)",
    piva: "12048300961",
    mail: "info@gama-service.com"
  }
};

// Mappa: nome gruppo DUSSMANN -> chiave breve usata per contatore e stato
const DUSS_GRUPPO_KEY = {
  "NHOOD": "nhood",
  "SQUADRA EDILE": "edile",
  "SQUADRA IMPIANTISTICA": "impiantistica"
};
// Chiave breve -> documento contatore su Firebase
function dussContatoreDocId(key) { return `contatore_dussmann_${key}`; }

// ============================================================
function avviaQuandoPronto() {
  if (firebaseReady) return; // già avviato
  if (!window.firebaseDB) {
    console.warn("avviaQuandoPronto: firebaseDB non disponibile");
    return;
  }
  fb = window.firebaseDB;
  firebaseReady = true;
  console.log("✅ App: Firebase pronto, avvio initApp()");

  // MODALITÀ TEST: se il programma è stato avviato con TEST-GAMA.bat, blocco
  // TUTTE le scritture su Firebase. L'app funziona normalmente (genera Word/PDF,
  // mostra i dati) ma contatori, consuntivi e colori NON vengono mai salvati.
  // Così puoi provare tutto liberamente senza sporcare il database vero.
  attivaModalitaTestSeRichiesto().finally(() => {
    initApp().catch(err => {
      console.error("❌ initApp ha lanciato un errore:", err);
      showToast("Errore avvio app: " + err.message, "error", 8000);
    });
  });
  return;
}

// Controlla se siamo in modalità test e, in tal caso, "neutralizza" le scritture
// su Firebase sostituendole con versioni finte che non salvano nulla.
async function attivaModalitaTestSeRichiesto() {
  try {
    if (!(window.electronAPI && window.electronAPI.getModalitaTest)) return;
    const r = await window.electronAPI.getModalitaTest();
    if (!r || !r.test) return;

    state.modalitaTest = true;

    // Sostituisco le 4 funzioni di SCRITTURA con versioni che non fanno nulla
    // (ma restituiscono una Promise risolta, così il resto del codice non si rompe).
    // Le funzioni di LETTURA (getDoc, getDocs, onSnapshot, query...) restano vere,
    // così vedi i dati reali ma non puoi modificarli.
    const finto = async () => { return { id: "TEST-NESSUN-SALVATAGGIO" }; };
    fb.setDoc = finto;
    fb.updateDoc = finto;
    fb.deleteDoc = finto;
    fb.addDoc = finto;
    fb.runTransaction = async (db, fn) => {
      // Eseguo la transazione con un oggetto finto che non scrive
      const txFinta = {
        get: async (ref) => fb.getDoc(ref),
        set: () => {}, update: () => {}, delete: () => {}
      };
      try { return await fn(txFinta); } catch (e) { return null; }
    };

    console.log("🧪 MODALITÀ TEST attiva: nessuna scrittura su Firebase");
    mostraBannerModalitaTest();
  } catch (e) {
    console.warn("Controllo modalità test:", e);
  }
}

// Mostra una banda rossa in alto per ricordare che sei in modalità test
function mostraBannerModalitaTest() {
  if (document.getElementById("bannerModalitaTest")) return;
  const banner = document.createElement("div");
  banner.id = "bannerModalitaTest";
  banner.textContent = "🧪 MODALITÀ TEST — Niente viene salvato su Firebase (puoi provare tutto liberamente)";
  banner.style.cssText = [
    "position:fixed", "top:0", "left:0", "right:0", "z-index:99999",
    "background:#dc2626", "color:#fff", "text-align:center",
    "font-weight:bold", "font-size:14px", "padding:8px 12px",
    "box-shadow:0 2px 8px rgba(0,0,0,0.3)", "letter-spacing:0.3px"
  ].join(";");
  document.body.appendChild(banner);
  // Spingo giù il contenuto così il banner non copre nulla
  document.body.style.paddingTop = "40px";
}

// Caso A: l'evento arriverà più tardi (firebase-config caricato dopo app.js)
window.addEventListener("firebase-ready", avviaQuandoPronto);

// Caso B: firebase era già pronto quando questo script è stato eseguito
if (window.__firebaseReady) {
  avviaQuandoPronto();
}

// Fallback: provo a ricontrollare ogni 250ms per max 5 secondi
let _checkCount = 0;
const _checkInterval = setInterval(() => {
  _checkCount++;
  if (firebaseReady) {
    clearInterval(_checkInterval);
    return;
  }
  if (window.__firebaseReady && window.firebaseDB) {
    clearInterval(_checkInterval);
    avviaQuandoPronto();
    return;
  }
  if (_checkCount > 20) {
    clearInterval(_checkInterval);
    if (!firebaseReady) {
      document.getElementById("connectionStatus").textContent = "⚠️ Firebase non configurato";
      document.getElementById("connectionStatus").className = "status-disconnected";
      showToast("⚠️ Firebase non configurato. Apri firebase-config.js e inserisci le credenziali.", "error", 8000);
    }
  }
}, 250);

async function initApp() {
  state.meseCorrente = currentMonthString();
  document.getElementById("meseCorrente").textContent = formatMonthLabel(state.meseCorrente);

  // Logo nell'header
  const logoEl = document.getElementById("appLogo");
  if (logoEl && typeof LOGO_BASE64 !== "undefined") {
    logoEl.src = "data:image/png;base64," + LOGO_BASE64;
  }

  // Data documento di default = oggi
  const oggi = new Date();
  document.getElementById("dataDocumento").value = oggi.toISOString().split("T")[0];
  document.getElementById("filtroMese").value = state.meseCorrente;

  // Nome operatore da localStorage
  const nomeSalvato = localStorage.getItem("gama_operatore");
  if (nomeSalvato) document.getElementById("nomeOperatore").value = nomeSalvato;
  document.getElementById("nomeOperatore").addEventListener("input", (e) => {
    localStorage.setItem("gama_operatore", e.target.value);
  });

  // Stato cartella salvataggio (async perché in Electron legge dal disco)
  await setupCartellaUI();

  await loadSettings();
  setupTabs();
  setupForm();
  setupExcelTab();
  setupImpostazioniTab();
  setupStoricoTab();
  setupPreventivoTab();
  setupDussmannTab();
  setupRigheManualiExcel();
  setupRealtimeListeners();

  // Primo render della tabella storico (vuota all'inizio, si popola coi listener real-time)
  refreshStoricoLista([], state.meseCorrente);

  // Carico e mostro la versione dell'app
  await caricaVersioneApp();

  // Attivo il salvataggio automatico del lavoro in corso e ripristino l'eventuale bozza
  if (state.isElectron) {
    attivaAutoSaveBozza();
    await ripristinaBozza();
  }

  // Avvio monitoraggio stato NAS (banner offline + sincronizzazione automatica)
  if (state.isElectron) {
    avviaMonitoraggioNas();
    setupAutoUpdateListener();
  }
}

// Legge la versione dell'app e la mostra nel badge header + sezione info
async function caricaVersioneApp() {
  let versione = "?";
  try {
    if (state.isElectron && window.electronAPI.getVersione) {
      const r = await window.electronAPI.getVersione();
      versione = r.versione || "?";
    }
  } catch (e) { console.warn("Lettura versione:", e); }

  state.versioneApp = versione;
  const badge = document.getElementById("appVersionBadge");
  const info = document.getElementById("infoVersione");
  if (badge) badge.textContent = "v" + versione;
  if (info) info.textContent = versione;

  // Mostra pulsante aggiornamento Mac solo su Mac
  try {
    if (state.isElectron && window.electronAPI.getPlatform) {
      const platform = await window.electronAPI.getPlatform();
      if (platform === "darwin") {
        const sezione = document.getElementById("sezioneAggiornaMac");
        if (sezione) sezione.style.display = "block";
        const btn = document.getElementById("btnAggiornaMac");
        if (btn) {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "⏳ Apertura...";
            try { await window.electronAPI.apriPaginaAggiornaMac(); } catch(e) {}
            setTimeout(() => {
              btn.disabled = false;
              btn.textContent = "🔄 Controlla aggiornamenti (Mac)";
            }, 3000);
          });
        }
      }
    }
  } catch(e) { console.warn("Rilevamento piattaforma:", e); }
}

// ============================================================
// AUTO-SAVE BOZZA LAVORO IN CORSO
// ============================================================
// Salva automaticamente il contenuto dei form mentre l'utente scrive.
// Se l'app si chiude (anche per aggiornamento), al riavvio ripristina tutto.

// Elenco di tutti i campi dei form da salvare/ripristinare
const CAMPI_BOZZA = [
  // Form Consuntivo
  "tipoConsuntivo", "categoria", "sezioneExcel", "sede", "dataDocumento",
  "dataIntervento", "odl", "descrizione", "ore", "tariffaOraria",
  "oreExtra", "tariffaExtra", "oreViaggio", "tariffaViaggio", "nascondiaCorpo",
  "descrMateriale", "costoMateriale", "smaltimento", "notaExcel",
  "noloPiattaforma", "noloTrabattello", "praticaFgas", "vociManualiJson", "materialiExtraJson",
  "crevalProvincia", "crevalRegione", "crevalTicket", "crevalOdlNumero", "pagamentiTipo",
  // Form Preventivo
  "prevDestinatario", "prevData", "prevOggetto", "prevElenco", "prevImporto", "prevPagamenti",
  // Form DUSSMANN
  "dussTipo", "dussGruppo", "dussData", "dussPeriodo", "dussOggetto", "dussOre", "dussPagamenti",
  "dussRetribuzione", "dussTredicesima", "dussFestivita", "dussExFestivita", "dussTfr",
  "dussAddInail", "dussInail", "dussInps", "dussTrattenute", "dussCostoDistacco", "dussCostoPattuito"
];

let _timerBozza = null;

// Raccoglie i valori attuali di tutti i campi
function raccogliBozza() {
  const dati = {};
  for (const id of CAMPI_BOZZA) {
    const el = document.getElementById(id);
    if (el) dati[id] = el.value;
  }
  dati._salvataIl = new Date().toISOString();
  // Salvo anche se ero in modifica di un consuntivo
  if (state.modificaInCorso) dati._modificaInCorso = state.modificaInCorso;
  return dati;
}

// Salva la bozza (con piccolo ritardo per non salvare a ogni singolo tasto)
function salvaBozzaDifferita() {
  if (!state.isElectron || !window.electronAPI.salvaBozza) return;
  clearTimeout(_timerBozza);
  _timerBozza = setTimeout(async () => {
    try {
      const dati = raccogliBozza();
      // Salvo solo se c'è qualcosa di significativo scritto
      const haContenuto = dati.sede || dati.descrizione || dati.prevOggetto || dati.prevElenco;
      if (haContenuto) {
        await window.electronAPI.salvaBozza(dati);
      }
    } catch (e) { console.warn("Salvataggio bozza:", e); }
  }, 1500);
}

// Salva SUBITO la bozza (usato prima dell'aggiornamento)
async function salvaBozzaImmediata() {
  if (!state.isElectron || !window.electronAPI.salvaBozza) return;
  try {
    await window.electronAPI.salvaBozza(raccogliBozza());
  } catch (e) { console.warn("Salvataggio bozza immediato:", e); }
}

// Cancella la bozza (dopo che un documento è stato salvato con successo)
async function cancellaBozza() {
  if (!state.isElectron || !window.electronAPI.cancellaBozza) return;
  try {
    await window.electronAPI.cancellaBozza();
  } catch (e) { console.warn("Cancellazione bozza:", e); }
}

// Collega l'auto-save a tutti i campi
function attivaAutoSaveBozza() {
  if (!state.isElectron) return;
  for (const id of CAMPI_BOZZA) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", salvaBozzaDifferita);
      el.addEventListener("change", salvaBozzaDifferita);
    }
  }
}

// All'avvio, controlla se c'è una bozza salvata e la ripristina
async function ripristinaBozza() {
  if (!state.isElectron || !window.electronAPI.leggiBozza) return;
  try {
    const r = await window.electronAPI.leggiBozza();
    if (!r.ok || !r.bozza) return;
    const b = r.bozza;

    // Ripristino i valori nei campi
    let qualcosaRipristinato = false;
    for (const id of CAMPI_BOZZA) {
      const el = document.getElementById(id);
      if (el && b[id] !== undefined && b[id] !== "") {
        el.value = b[id];
        qualcosaRipristinato = true;
      }
    }

    if (qualcosaRipristinato) {
      // Aggiorno le parti dipendenti (categorie, totali, preview)
      aggiornaCategoriePerTipo();
      // Ricostruisco le voci manuali dalle bozza (campo nascosto JSON)
      try {
        const vociJson = document.getElementById("vociManualiJson");
        if (vociJson && vociJson.value) {
          impostaVociManuali(JSON.parse(vociJson.value));
        }
        const matJson = document.getElementById("materialiExtraJson");
        if (matJson && matJson.value) {
          impostaMaterialiExtra(JSON.parse(matJson.value));
        }
      } catch (e) { console.warn("Ripristino voci/materiali:", e.message); }
      ricalcolaTotale();
      // Ripristino lo stato di modifica se c'era
      if (b._modificaInCorso) {
        state.modificaInCorso = b._modificaInCorso;
        const btnAnnulla = document.getElementById("btnAnnullaModifica");
        if (btnAnnulla) btnAnnulla.classList.remove("hidden");
      }
      showToast("📝 Ripristinato il lavoro che stavi facendo prima della chiusura", "info", 5000);
    }
  } catch (e) { console.warn("Ripristino bozza:", e); }
}

// Gestisce i messaggi di stato dell'auto-update e li mostra nel banner
function setupAutoUpdateListener() {
  if (!state.isElectron || !window.electronAPI.onUpdateStatus) return;
  const banner = document.getElementById("bannerUpdate");
  const txt = document.getElementById("bannerUpdateText");
  if (!banner || !txt) return;

  window.electronAPI.onUpdateStatus((dati) => {
    const infoStato = document.getElementById("infoUpdateStato");
    switch (dati.stato) {
      case "controllo":
        if (infoStato) infoStato.textContent = "🔄 Controllo in corso...";
        break;
      case "disponibile":
        banner.classList.remove("hidden");
        banner.classList.remove("update-pronto");
        txt.textContent = `🔄 Nuova versione ${dati.versione} trovata, scarico in corso...`;
        if (infoStato) infoStato.textContent = `🔄 Nuova versione ${dati.versione} in download...`;
        break;
      case "download":
        banner.classList.remove("hidden");
        txt.textContent = `🔄 Scaricamento aggiornamento: ${dati.percent}%`;
        if (infoStato) infoStato.textContent = `🔄 Download ${dati.percent}%`;
        break;
      case "scaricato":
        banner.classList.remove("hidden");
        banner.classList.add("update-pronto");
        txt.textContent = `✅ Aggiornamento ${dati.versione} pronto! L'app si riavvia tra pochi secondi...`;
        if (infoStato) infoStato.textContent = `✅ Aggiornamento ${dati.versione} pronto, riavvio...`;
        // Salvo SUBITO il lavoro in corso prima che l'app si riavvii per aggiornarsi
        salvaBozzaImmediata();
        break;
      case "aggiornata":
        if (infoStato) infoStato.textContent = "✅ App aggiornata all'ultima versione";
        break;
      case "errore":
        console.warn("Update error:", dati.messaggio);
        if (infoStato) infoStato.textContent = "⚠️ Impossibile controllare (offline?)";
        break;
    }
  });
}

// ============================================================
// MONITORAGGIO NAS / MODALITÀ OFFLINE
// ============================================================
// Ogni 20 secondi verifica se il NAS è raggiungibile.
// Se NON è raggiungibile → mostra banner giallo "offline"
// Se torna raggiungibile dopo essere stato offline → sincronizza i file
//   dalla cartella OFFLINE temporanea al NAS e rimuove il banner.

let _statoOnlinePrecedente = true; // Assumo online all'avvio
let _intervalNasCheck = null;
const NAS_CHECK_INTERVAL_MS = 20 * 1000;

async function avviaMonitoraggioNas() {
  // Primo check immediato
  await verificaStatoNas();
  // Poi check periodici
  if (_intervalNasCheck) clearInterval(_intervalNasCheck);
  _intervalNasCheck = setInterval(verificaStatoNas, NAS_CHECK_INTERVAL_MS);

  // Bottone "Riprova" del banner
  const btnRiprova = document.getElementById("btnRiprovaNas");
  if (btnRiprova) {
    btnRiprova.addEventListener("click", async () => {
      btnRiprova.disabled = true;
      btnRiprova.textContent = "⏳ Verifico...";
      await verificaStatoNas(true); // force = true mostra toast
      btnRiprova.disabled = false;
      btnRiprova.textContent = "🔄 Riprova";
    });
  }
}

async function verificaStatoNas(mostraToast = false) {
  if (!state.isElectron) return;
  try {
    const stato = await window.electronAPI.verificaStatoCartella();
    if (!stato.configurata) return; // niente cartella scelta, niente da monitorare

    const banner = document.getElementById("bannerOffline");

    if (stato.raggiungibile) {
      // === NAS ONLINE ===
      if (banner) banner.classList.add("hidden");

      // Se prima eravamo OFFLINE → ora siamo tornati ONLINE → sincronizza
      if (!_statoOnlinePrecedente) {
        console.log("NAS tornato online! Sincronizzo i file offline...");
        if (mostraToast) showToast("✅ NAS tornato online, sincronizzazione in corso...", "success");
        const sync = await window.electronAPI.sincronizzaOffline();
        if (sync.ok && sync.fileSpostati > 0) {
          showToast(`✅ Sincronizzati ${sync.fileSpostati} file dal locale al NAS`, "success", 5000);
        } else if (sync.ok && sync.fileSpostati === 0) {
          if (mostraToast) showToast("✅ NAS online, nessun file da sincronizzare", "success");
        } else {
          showToast(`⚠️ Errore sincronizzazione: ${sync.errore}`, "warn", 6000);
        }
      } else if (mostraToast) {
        showToast("✅ NAS raggiungibile", "success");
      }

      _statoOnlinePrecedente = true;
    } else {
      // === NAS OFFLINE ===
      if (banner) banner.classList.remove("hidden");
      if (_statoOnlinePrecedente) {
        // Transizione online → offline
        showToast("⚠️ NAS non raggiungibile - modalità OFFLINE attiva", "warn", 6000);
      } else if (mostraToast) {
        showToast("⚠️ NAS ancora offline", "warn");
      }
      _statoOnlinePrecedente = false;
    }
  } catch (err) {
    console.error("Errore verifica stato NAS:", err);
  }
}

// ============================================================
// FILESYSTEM (Electron O File System Access API browser)
// ============================================================
async function setupCartellaUI() {
  const btn = document.getElementById("btnSelCartella");
  const stato = document.getElementById("cartellaStato");

  if (state.isElectron) {
    // === MODALITÀ ELECTRON ===
    // Aggiorna testo bottone
    btn.textContent = "📂 Cambia cartella";

    // Controllo se c'è già una cartella salvata
    const r = await window.electronAPI.getCartellaRoot();
    if (r.ok && r.path) {
      state.cartellaRoot = r.path;
      state.cartellaRootName = pathBasename(r.path);
      stato.textContent = `✅ ${r.path}`;
      stato.className = "cartella-stato scelta";
      // Riassicuro le cartelle dei prossimi mesi
      window.electronAPI.preparaCartelleMensili(12).then(res => {
        if (res.ok) console.log(`Cartelle mensili pronte: ${res.count}`);
      });
    } else {
      // PRIMO AVVIO: chiedo subito all'utente
      stato.textContent = "⚠️ Cartella non scelta - cliccando il bottone configuri";
      stato.className = "cartella-stato non-scelta";
      // Auto-trigger: chiedo subito dopo che la pagina è caricata
      setTimeout(() => selezionaCartellaElectron(), 800);
    }

    btn.addEventListener("click", selezionaCartellaElectron);
    return;
  }

  // === MODALITÀ BROWSER PURO ===
  if (!state.fsApiSupported) {
    btn.style.display = "none";
    stato.textContent = "❗ Browser non supporta salvataggio automatico — i file andranno nella cartella Download";
    stato.className = "cartella-stato non-supportato";
    return;
  }

  btn.addEventListener("click", async () => {
    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
        startIn: "documents"
      });
      state.cartellaRoot = handle;
      state.cartellaRootName = handle.name;
      stato.textContent = `✅ ${handle.name}`;
      stato.className = "cartella-stato scelta";
      showToast(`Cartella selezionata: ${handle.name}`, "success");
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error(err);
        showToast("Errore selezione cartella: " + err.message, "error");
      }
    }
  });
}

async function selezionaCartellaElectron() {
  const stato = document.getElementById("cartellaStato");
  try {
    const r = await window.electronAPI.selezionaCartella();
    if (r.canceled) {
      showToast("Selezione annullata. Riprova quando vuoi.", "warn");
      return;
    }
    if (r.ok) {
      state.cartellaRoot = r.path;
      state.cartellaRootName = pathBasename(r.path);
      stato.textContent = `✅ ${r.path}`;
      stato.className = "cartella-stato scelta";
      const msg = r.cartelleCreate
        ? `✅ Cartella impostata + create ${r.cartelleCreate} cartelle mensili (mese corrente + 11 successivi)`
        : `✅ Cartella impostata`;
      showToast(msg, "success", 5000);
    }
  } catch (err) {
    console.error(err);
    showToast("Errore: " + err.message, "error");
  }
}

function pathBasename(p) {
  if (!p) return "";
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() || p;
}

// Salva un blob nella cartella scelta. Crea struttura: ROOT/NN_MESE_ANNO/(CBRE|CREVAL)/file.docx
// Modalità: Electron (filesystem nativo) > File System Access API > Download standard
// Salva tutti gli ODL (PDF) allegati al consuntivo (supporta più file).
// Ogni ODL viene salvato come "[consuntivo] - ODL 1.pdf", "ODL 2.pdf", ecc.
async function gestisciOdlUpload(consuntivoFilename, tipo, meseYYYYMM) {
  if (!state.isElectron || !window.electronAPI || !window.electronAPI.salvaOdl) return;
  const inputs = document.querySelectorAll(".odl-pdf-input");
  let indice = 1;
  for (const input of inputs) {
    if (!input.files || input.files.length === 0) continue;
    const file = input.files[0];
    try {
      const buf = await file.arrayBuffer();
      const arr = Array.from(new Uint8Array(buf));
      const r = await window.electronAPI.salvaOdl(tipo, meseYYYYMM, consuntivoFilename, arr, indice);
      if (r && r.ok) {
        showToast(`📎 ODL ${indice} allegato e caricato su Drive`, "success", 4000);
      } else {
        showToast(`⚠️ ODL ${indice} non caricato: ` + ((r && r.errore) || "errore"), "warn", 5000);
      }
      indice++;
    } catch (e) {
      showToast(`⚠️ Errore ODL ${indice}: ` + e.message, "warn", 5000);
    }
    try { input.value = ""; } catch (e) {}
  }
}

async function salvaInCartella(blob, filename, tipo, meseYYYYMM) {
  // === MODALITÀ ELECTRON ===
  if (state.isElectron) {
    if (!state.cartellaRoot) {
      showToast("⚠️ Devi prima scegliere la cartella consuntivi (in alto)", "warn");
      return { saved: false, errore: "Cartella non impostata" };
    }
    try {
      const arrBuf = await blob.arrayBuffer();
      // Converto in normale Array per IPC (ArrayBuffer non viaggia bene attraverso contextBridge)
      const bytes = new Uint8Array(arrBuf);
      const arr = Array.from(bytes);
      const r = await window.electronAPI.salvaConsuntivo(tipo, meseYYYYMM, filename, arr);
      if (r.ok) {
        return {
          saved: true,
          path: r.relativePath,
          fullPath: r.fullPath,
          docxSalvato: !!r.docxSalvato,
          pdfSalvato: !!r.pdfSalvato,
          pdfRelative: r.pdfRelative,
          pdfPath: r.pdfPath,
          pdfFallito: !!r.pdfFallito,
          avviso: r.avviso,
          inOffline: !!r.inOffline
        };
      }
      // Fallback su download se Electron ha errori
      console.warn("salvaConsuntivo Electron fallito:", r.errore);
      saveAs(blob, filename);
      return { saved: false, fallback: true, path: filename, error: r.errore };
    } catch (err) {
      console.error(err);
      saveAs(blob, filename);
      return { saved: false, fallback: true, path: filename, error: err.message };
    }
  }

  // === MODALITÀ BROWSER con File System Access ===
  const subCartellaMese = nomeCartellaMese(meseYYYYMM);
  const subCartellaTipo = tipo.toUpperCase();

  if (state.cartellaRoot && state.fsApiSupported) {
    try {
      const meseDir = await state.cartellaRoot.getDirectoryHandle(subCartellaMese, { create: true });
      const tipoDir = await meseDir.getDirectoryHandle(subCartellaTipo, { create: true });
      const fileHandle = await tipoDir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true, path: `${state.cartellaRootName}/${subCartellaMese}/${subCartellaTipo}/${filename}` };
    } catch (err) {
      console.warn("Salvataggio cartella fallito:", err);
      saveAs(blob, filename);
      return { saved: false, fallback: true, path: filename, error: err.message };
    }
  }

  // === MODALITÀ BROWSER fallback: Download standard ===
  saveAs(blob, filename);
  return { saved: false, fallback: true, path: filename };
}

function nomeCartellaMese(yyyymm) {
  const [y, m] = yyyymm.split("-");
  const nomi = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
  return `${y}/${m}_${nomi[parseInt(m)-1]}_${y}`;
}

// ============================================================
// REALTIME LISTENERS
// ============================================================
function setupRealtimeListeners() {
  // Contatore CBRE
  fb.onSnapshot(fb.doc(fb.db, "config", "contatore_cbre"), (snap) => {
    document.getElementById("connectionStatus").textContent = "🟢 Connesso";
    document.getElementById("connectionStatus").className = "status-connected";

    if (snap.exists()) {
      state.prossimoNumeroCbre = (snap.data().ultimoNumero || 0) + 1;
    } else {
      state.prossimoNumeroCbre = DEFAULT_START.cbre;
    }
    aggiornaProssimiNumeriUI();
  }, (err) => {
    console.error("Errore contatore CBRE:", err);
    document.getElementById("connectionStatus").textContent = "🔴 Errore connessione";
    document.getElementById("connectionStatus").className = "status-disconnected";
  });

  // Contatore CREVAL
  fb.onSnapshot(fb.doc(fb.db, "config", "contatore_creval"), (snap) => {
    if (snap.exists()) {
      state.prossimoNumeroCreval = (snap.data().ultimoNumero || 0) + 1;
    } else {
      state.prossimoNumeroCreval = DEFAULT_START.creval;
    }
    aggiornaProssimiNumeriUI();
  });

  // Contatore PREVENTIVO
  fb.onSnapshot(fb.doc(fb.db, "config", "contatore_preventivo"), (snap) => {
    if (snap.exists()) {
      state.prossimoNumeroPreventivo = (snap.data().ultimoNumero || 0) + 1;
    } else {
      state.prossimoNumeroPreventivo = (state.settings.startPreventivo || 121);
    }
    aggiornaPrevNumeroUI();
  });

  // Contatore DUSSMANN UNICO: un solo numero progressivo per tutti i gruppi
  fb.onSnapshot(fb.doc(fb.db, "config", "contatore_dussmann_unico"), (snap) => {
    let prossimo;
    if (snap.exists()) {
      prossimo = (snap.data().ultimoNumero || 0) + 1;
    } else {
      prossimo = 1;
    }
    // Lo stesso numero vale per tutti i gruppi (numerazione condivisa)
    state.prossimoNumeroDussmann.nhood = prossimo;
    state.prossimoNumeroDussmann.edile = prossimo;
    state.prossimoNumeroDussmann.impiantistica = prossimo;
    state.prossimoNumeroDussmann.unico = prossimo;
    aggiornaDussNumeroUI();
  }, (err) => console.warn("Listener contatore dussmann unico:", err.message));

  // Clienti CBRE personalizzati (aggiunti dall'utente, condivisi su tutti i PC)
  fb.onSnapshot(fb.doc(fb.db, "config", "clienti_cbre_custom"), (snap) => {
    state.clientiCustom = (snap.exists() && Array.isArray(snap.data().clienti)) ? snap.data().clienti : [];
    applicaClientiCustom();
  }, (err) => console.warn("Listener clienti personalizzati:", err.message));

  // Consuntivi del mese corrente
  const q = fb.query(
    fb.collection(fb.db, "consuntivi"),
    fb.where("mese", "==", state.meseCorrente)
  );
  fb.onSnapshot(q, (snap) => {
    // Salvo gli stati pagamento PRECEDENTI per capire se la PWA ne ha cambiato uno
    const statiPrecedenti = {};
    (state.consuntiviMese || []).forEach(c => { statiPrecedenti[c.id] = c.statoPagamento || ""; });

    state.consuntiviMese = [];
    snap.forEach(d => state.consuntiviMese.push({ id: d.id, ...d.data() }));
    state.consuntiviMese.sort((a,b) => {
      if (a.tipo === b.tipo) return a.numero - b.numero;
      return a.tipo.localeCompare(b.tipo);
    });
    refreshStorico();
    refreshExcelStato();

    // Solo la PRIMA volta che arrivano i dati: importo le modifiche fatte
    // a mano nell'Excel verso Firebase (una sola volta per sessione)
    if (!state._importExcelFatto) {
      state._importExcelFatto = true;
      importaModificheExcelAllAvvio();
    } else {
      // Controllo se è cambiato qualche statoPagamento (es. colore messo dalla
      // PWA o dallo storico di un altro PC). Se sì, rigenero l'Excel sul NAS così
      // il colore compare anche nel file vero, non solo nella pagina web.
      // NB: se il cambio è stato fatto DA QUESTO desktop (setStatoPagamento ha già
      // rigenerato), salto per non rigenerare due volte.
      if (state._coloreCambiatoLocale) {
        state._coloreCambiatoLocale = false;
      } else {
        let coloreCambiatoCbre = false;
        let coloreCambiatoCreval = false;
        state.consuntiviMese.forEach(c => {
          const prima = statiPrecedenti[c.id];
          const ora = c.statoPagamento || "";
          // prima !== undefined: era già presente (non è una riga appena creata)
          if (prima !== undefined && prima !== ora) {
            if (c.tipo === "creval") coloreCambiatoCreval = true;
            else coloreCambiatoCbre = true;
          }
        });
        if (coloreCambiatoCbre) {
          aggiornaExcelMese(state.meseCorrente, true, true).catch(()=>{});
        }
        if (coloreCambiatoCreval) {
          aggiornaExcelCrevalMese(state.meseCorrente, true, true).catch(()=>{});
        }
      }
    }
  });

  // DUSSMANN del mese corrente
  const qDuss = fb.query(
    fb.collection(fb.db, "dussmann"),
    fb.where("mese", "==", state.meseCorrente)
  );
  fb.onSnapshot(qDuss, (snap) => {
    state.dussmannMese = [];
    snap.forEach(d => state.dussmannMese.push({ id: d.id, ...d.data() }));
    state.dussmannMese.sort((a,b) => (a.numero || 0) - (b.numero || 0));
    refreshStoricoDussmann();
  }, (err) => console.warn("Listener dussmann:", err.message));

  // PREVENTIVI del mese corrente
  const qPrev = fb.query(
    fb.collection(fb.db, "preventivi"),
    fb.where("mese", "==", state.meseCorrente)
  );
  fb.onSnapshot(qPrev, (snap) => {
    state.preventiviMese = [];
    snap.forEach(d => state.preventiviMese.push({ id: d.id, ...d.data() }));
    state.preventiviMese.sort((a,b) => (a.numero || 0) - (b.numero || 0));
    refreshStoricoPreventivi();
  }, (err) => console.warn("Listener preventivi:", err.message));

  // DESTINATARI SALVATI dei preventivi (in tempo reale, condivisi tra PC)
  fb.onSnapshot(fb.doc(fb.db, "config", "settings"), (snap) => {
    if (snap.exists()) {
      state.destinatariPreventivi = snap.data().destinatariPreventivi || [];
    } else {
      state.destinatariPreventivi = [];
    }
    aggiornaTendinaDestinatari();
  }, (err) => console.warn("Listener destinatari:", err.message));

  // RIGHE MANUALI Excel del mese corrente
  const qMan = fb.query(
    fb.collection(fb.db, "righe_excel_manuali"),
    fb.where("excelMese", "==", state.meseCorrente)
  );
  fb.onSnapshot(qMan, (snap) => {
    state.righeManualiMese = [];
    snap.forEach(d => state.righeManualiMese.push({ id: d.id, ...d.data() }));
    refreshRigheManuali();
  }, (err) => console.warn("Listener righe manuali:", err.message));
}

function aggiornaProssimiNumeriUI() {
  document.getElementById("prossimoNumeroCbre").textContent = state.prossimoNumeroCbre ?? "—";
  // CREVAL mostra "CR" davanti al numero
  const nCreval = state.prossimoNumeroCreval ?? "—";
  document.getElementById("prossimoNumeroCreval").textContent = nCreval === "—" ? "—" : `CR ${nCreval}`;
  // Aggiorno la preview se c'è un tipo selezionato
  aggiornaNumeroPreview();
}

function aggiornaNumeroPreview() {
  const tipo = document.getElementById("tipoConsuntivo").value;
  const preview = document.getElementById("numeroAssegnatoPreview");
  const btn = document.getElementById("numeroBtn");

  if (tipo === "cbre") {
    const n = state.prossimoNumeroCbre ?? "—";
    preview.value = `CBRE ${n}`;
    btn.textContent = `CBRE ${n}`;
  } else if (tipo === "creval") {
    const n = state.prossimoNumeroCreval ?? "—";
    preview.value = `CREVAL CR ${n}`;
    btn.textContent = `CREVAL CR ${n}`;
  } else {
    preview.value = "";
    btn.textContent = "—";
  }
}

// ============================================================
// TABS
// ============================================================
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${target}`).classList.add("active");
    });
  });
}

// ============================================================
// FORM CONSUNTIVO
// ============================================================
function setupForm() {
  const form = document.getElementById("formConsuntivo");
  const tipo = document.getElementById("tipoConsuntivo");
  const ore = document.getElementById("ore");
  const tariffa = document.getElementById("tariffaOraria");
  const costoMat = document.getElementById("costoMateriale");
  const smaltimento = document.getElementById("smaltimento");

  // Pulsante aggiungi ODL multipli
  const btnAggiungiOdl = document.getElementById("btnAggiungiOdl");
  if (btnAggiungiOdl) {
    btnAggiungiOdl.addEventListener("click", () => {
      const container = document.getElementById("odlListaContainer");
      if (!container) return;
      const riga = document.createElement("div");
      riga.className = "odl-riga";
      riga.style.cssText = "display:flex; align-items:center; gap:8px;";
      riga.innerHTML = `
        <input type="file" class="odl-pdf-input" accept="application/pdf,.pdf" style="flex:1;">
        <button type="button" class="btn-rimuovi-odl" style="background:#e53e3e;color:white;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:13px;" onclick="this.closest('.odl-riga').remove()">✕</button>
      `;
      container.appendChild(riga);
    });
  }

  // Quando cambia il tipo: aggiorno categorie e preview numero
  tipo.addEventListener("change", () => {
    aggiornaCategoriePerTipo();
    aggiornaNumeroPreview();
  });

  [ore, tariffa, costoMat, smaltimento].forEach(el => {
    el.addEventListener("input", ricalcolaTotale);
  });

  // Nuove voci fisse: nolo piattaforma, trabattello, F-Gas
  ["noloPiattaforma", "noloTrabattello", "praticaFgas"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", ricalcolaTotale);
  });

  // Ore extra: aggiornano l'anteprima in tempo reale SOLO per il CREVAL
  // (per il CBRE il comportamento resta esattamente com'era).
  [["oreExtra", "tariffaExtra"], ["oreViaggio", "tariffaViaggio"]].flat().forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => {
      const tipoSel = document.getElementById("tipoConsuntivo");
      if (tipoSel && tipoSel.value === "creval") ricalcolaTotale();
    });
  });

  // Bottone "+" per aggiungere voci manuali
  const btnVoce = document.getElementById("btnAggiungiVoce");
  if (btnVoce) {
    btnVoce.addEventListener("click", () => {
      aggiungiVoceManuale();
      sincronizzaVociManualiJson();
    });
  }

  // Bottone "+" per aggiungere materiali extra
  const btnMat = document.getElementById("btnAggiungiMateriale");
  if (btnMat) {
    btnMat.addEventListener("click", () => {
      aggiungiMaterialeExtra();
      sincronizzaMaterialiExtraJson();
    });
  }

  // Tendina pagamenti: mostro/nascondo campo custom
  const pagSel = document.getElementById("pagamentiTipo");
  const rowPagCustom = document.getElementById("rowPagamentiCustom");
  pagSel.addEventListener("change", () => {
    pagSel.dataset.userChanged = "1"; // l'utente ha scelto manualmente, non sovrascrivere
    if (pagSel.value === "ALTRO") {
      rowPagCustom.style.display = "";
      document.getElementById("pagamentiCustom").focus();
    } else {
      rowPagCustom.style.display = "none";
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await generaConsuntivo();
  });

  document.getElementById("btnPreview").addEventListener("click", mostraPreview);

  // Pulsante anteprima PDF consuntivo
  const btnAnteprimaCons = document.getElementById("btnAnteprimaPdfConsuntivo");
  if (btnAnteprimaCons) {
    btnAnteprimaCons.addEventListener("click", async () => {
      await salvaAnteprimaPdf("consuntivo");
    });
  }

  // Bottone "Annulla modifica"
  const btnAnnulla = document.getElementById("btnAnnullaModifica");
  if (btnAnnulla) {
    btnAnnulla.addEventListener("click", annullaModifica);
  }

  // Casella "Totale a mano": attiva/disattiva la scrittura manuale del totale
  const totManEl = document.getElementById("totaleManuale");
  if (totManEl) {
    totManEl.addEventListener("change", () => {
      const tot = document.getElementById("totale");
      if (totManEl.checked) {
        tot.readOnly = false;
        tot.classList.remove("readonly");
        tot.focus();
        tot.select();
      } else {
        tot.readOnly = true;
        tot.classList.add("readonly");
        ricalcolaTotale();
      }
    });
  }

  ricalcolaTotale();
}

function aggiornaCategoriePerTipo() {
  const tipo = document.getElementById("tipoConsuntivo").value;
  const sel = document.getElementById("categoria");
  const rowSezione = document.getElementById("rowSezioneExcel");
  const selSezione = document.getElementById("sezioneExcel");
  const rowCrevalPR = document.getElementById("rowCrevalProvinciaRegione");
  const rowCrevalTO = document.getElementById("rowCrevalTicketOdl");
  const inputProv = document.getElementById("crevalProvincia");
  const inputReg = document.getElementById("crevalRegione");
  sel.innerHTML = "";

  if (!tipo) {
    sel.innerHTML = '<option value="">— Seleziona prima il tipo —</option>';
    rowSezione.style.display = "none";
    selSezione.removeAttribute("required");
    rowCrevalPR.style.display = "none";
    rowCrevalTO.style.display = "none";
    inputProv.removeAttribute("required");
    inputReg.removeAttribute("required");
    return;
  }

  sel.innerHTML = '<option value="">— Seleziona categoria —</option>';
  (CATEGORIE[tipo] || []).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.value;
    opt.textContent = c.label;
    sel.appendChild(opt);
  });

  // CBRE: mostra tendina sezione Excel
  // CREVAL: mostra campi Provincia/Regione/Ticket/ODL numero
  if (tipo === "cbre") {
    rowSezione.style.display = "";
    selSezione.setAttribute("required", "required");
    rowCrevalPR.style.display = "none";
    rowCrevalTO.style.display = "none";
    inputProv.removeAttribute("required");
    inputReg.removeAttribute("required");
    // Default pagamenti CBRE: nessuno (a meno che non l'utente abbia già scelto qualcosa)
    const pagSel = document.getElementById("pagamentiTipo");
    if (pagSel && pagSel.value === "" && !pagSel.dataset.userChanged) {
      pagSel.value = "";
    }
  } else if (tipo === "creval") {
    rowSezione.style.display = "none";
    selSezione.removeAttribute("required");
    selSezione.value = "";
    rowCrevalPR.style.display = "";
    rowCrevalTO.style.display = "";
    inputProv.setAttribute("required", "required");
    inputReg.setAttribute("required", "required");
    // Default Regione = LOMBARDIA se vuoto
    if (!inputReg.value) inputReg.value = "LOMBARDIA";
    // Default pagamenti CREVAL: 60 giorni (se utente non ha già cambiato)
    const pagSel = document.getElementById("pagamentiTipo");
    if (pagSel && !pagSel.dataset.userChanged) {
      pagSel.value = "60";
    }
  } else {
    rowSezione.style.display = "none";
    selSezione.removeAttribute("required");
    selSezione.value = "";
    rowCrevalPR.style.display = "none";
    rowCrevalTO.style.display = "none";
    inputProv.removeAttribute("required");
    inputReg.removeAttribute("required");
  }
}

// Converte un importo scritto a mano (es. "1.500,00", "1500,5", "1500") in numero
function parseImporto(str) {
  if (str === null || str === undefined) return 0;
  let s = String(str).replace(/[€\s]/g, "").trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function ricalcolaTotale() {
  const ore = parseFloat(document.getElementById("ore").value) || 0;
  const tariffa = parseFloat(document.getElementById("tariffaOraria").value) || 0;
  const mat = parseFloat(document.getElementById("costoMateriale").value) || 0;
  const sma = parseFloat(document.getElementById("smaltimento").value) || 0;
  // Ore extra (opzionali)
  const oreExtra = parseFloat(document.getElementById("oreExtra").value) || 0;
  const tariffaExtra = parseFloat(document.getElementById("tariffaExtra").value) || 0;
  // Ore di viaggio (opzionali)
  const oreViaggio = parseFloat(document.getElementById("oreViaggio")?.value) || 0;
  const tariffaViaggio = parseFloat(document.getElementById("tariffaViaggio")?.value) || 0;
  // Nuove voci fisse
  const noloPiatt = parseFloat(document.getElementById("noloPiattaforma").value) || 0;
  const noloTrab = parseFloat(document.getElementById("noloTrabattello").value) || 0;
  const fgas = parseFloat(document.getElementById("praticaFgas").value) || 0;
  // Voci manuali
  const vociMan = leggiVociManuali();
  const totVociMan = vociMan.reduce((s, v) => s + (v.importo || 0), 0);
  // Materiali extra
  const matExtra = leggiMaterialiExtra();
  const totMatExtra = matExtra.reduce((s, m) => s + (m.costo || 0), 0);

  const costoOre = ore * tariffa;
  const costoOreExtra = oreExtra * tariffaExtra;
  const costoViaggio = oreViaggio * tariffaViaggio;
  const totale = costoOre + costoOreExtra + costoViaggio + mat + sma + noloPiatt + noloTrab + fgas + totVociMan + totMatExtra;

  document.getElementById("costoOre").value = formatEuro(costoOre);
  document.getElementById("costoOreExtra").value = formatEuro(costoOreExtra);
  const elCostoViaggio = document.getElementById("costoViaggio");
  if (elCostoViaggio) elCostoViaggio.value = formatEuro(costoViaggio);
  // Se "Totale a mano" è attivo, non sovrascrivo il totale scritto dall'utente
  const _totMan = document.getElementById("totaleManuale");
  if (!(_totMan && _totMan.checked)) {
    document.getElementById("totale").value = formatEuro(totale);
  }
}

// ============================================================
// VOCI MANUALI AGGIUNTIVE (descrizione + importo, dinamiche col +)
// ============================================================
// Legge le voci manuali dalle righe presenti nel form
function leggiVociManuali() {
  const container = document.getElementById("vociManualiContainer");
  if (!container) return [];
  const voci = [];
  container.querySelectorAll(".voce-manuale-riga").forEach(riga => {
    const descr = (riga.querySelector(".voce-descr")?.value || "").trim();
    const importo = parseFloat(riga.querySelector(".voce-importo")?.value) || 0;
    if (descr || importo !== 0) voci.push({ descr, importo });
  });
  return voci;
}

// Aggiorna il campo nascosto JSON (serve per la bozza/salva-lavoro)
function sincronizzaVociManualiJson() {
  const hidden = document.getElementById("vociManualiJson");
  if (hidden) hidden.value = JSON.stringify(leggiVociManuali());
}

// Aggiunge una riga voce manuale (vuota o coi valori passati)
function aggiungiVoceManuale(descr = "", importo = "") {
  const container = document.getElementById("vociManualiContainer");
  if (!container) return;
  const riga = document.createElement("div");
  riga.className = "voce-manuale-riga";
  riga.style.cssText = "display:flex;gap:8px;margin-bottom:6px;align-items:center";
  riga.innerHTML = `
    <input type="text" class="voce-descr" placeholder="Descrizione (es. NOLO GRU)" style="flex:2" value="${escapeHtml(String(descr))}">
    <input type="number" class="voce-importo" step="0.01" placeholder="€" style="flex:1" value="${importo !== "" ? importo : ""}">
    <button type="button" class="btn-mini danger voce-rimuovi" title="Rimuovi voce">✖</button>
  `;
  riga.querySelector(".voce-rimuovi").addEventListener("click", () => {
    riga.remove();
    sincronizzaVociManualiJson();
    ricalcolaTotale();
  });
  riga.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      sincronizzaVociManualiJson();
      ricalcolaTotale();
    });
  });
  container.appendChild(riga);
}

// Svuota e ricostruisce le voci manuali da un array (per modifica/bozza)
function impostaVociManuali(voci) {
  const container = document.getElementById("vociManualiContainer");
  if (!container) return;
  container.innerHTML = "";
  (voci || []).forEach(v => aggiungiVoceManuale(v.descr, v.importo));
  sincronizzaVociManualiJson();
}

// ============================================================
// MATERIALI EXTRA (descrizione + costo, dinamici col +)
// ============================================================
function leggiMaterialiExtra() {
  const container = document.getElementById("materialiExtraContainer");
  if (!container) return [];
  const materiali = [];
  container.querySelectorAll(".materiale-extra-riga").forEach(riga => {
    const descr = (riga.querySelector(".mat-descr")?.value || "").trim();
    const costo = parseFloat(riga.querySelector(".mat-costo")?.value) || 0;
    if (descr || costo !== 0) materiali.push({ descr, costo });
  });
  return materiali;
}

function sincronizzaMaterialiExtraJson() {
  const hidden = document.getElementById("materialiExtraJson");
  if (hidden) hidden.value = JSON.stringify(leggiMaterialiExtra());
}

function aggiungiMaterialeExtra(descr = "", costo = "") {
  const container = document.getElementById("materialiExtraContainer");
  if (!container) return;
  const riga = document.createElement("div");
  riga.className = "materiale-extra-riga";
  riga.style.cssText = "display:flex;gap:8px;margin-bottom:6px;align-items:center";
  riga.innerHTML = `
    <input type="text" class="mat-descr" placeholder="Descrizione materiale (es. Compressore)" style="flex:2" value="${escapeHtml(String(descr))}">
    <input type="number" class="mat-costo" step="0.01" placeholder="Costo €" style="flex:1" value="${costo !== "" ? costo : ""}">
    <button type="button" class="btn-mini danger mat-rimuovi" title="Rimuovi materiale">✖</button>
  `;
  riga.querySelector(".mat-rimuovi").addEventListener("click", () => {
    riga.remove();
    sincronizzaMaterialiExtraJson();
    ricalcolaTotale();
  });
  riga.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      sincronizzaMaterialiExtraJson();
      ricalcolaTotale();
    });
  });
  container.appendChild(riga);
}

function impostaMaterialiExtra(materiali) {
  const container = document.getElementById("materialiExtraContainer");
  if (!container) return;
  container.innerHTML = "";
  (materiali || []).forEach(m => aggiungiMaterialeExtra(m.descr, m.costo));
  sincronizzaMaterialiExtraJson();
}

function costruisciConsuntivoDaForm(numero, tipo) {
  const dataDoc = document.getElementById("dataDocumento").value;
  const anno = dataDoc ? dataDoc.split("-")[0] : new Date().getFullYear();
  return {
    tipo,
    numero,
    annoNumero: `${numero}/${anno}`,
    categoria: document.getElementById("categoria").value,
    // sezione del file Excel scelta dall'utente (solo per CBRE)
    sezioneExcel: tipo === "cbre" ? document.getElementById("sezioneExcel").value : null,
    sede: document.getElementById("sede").value.trim(),
    dataDocumento: dataDoc,
    dataIntervento: document.getElementById("dataIntervento").value.trim(),
    odl: document.getElementById("odl").value.trim(),
    descrizione: document.getElementById("descrizione").value.trim(),
    ore: parseFloat(document.getElementById("ore").value) || 0,
    tariffaOraria: parseFloat(document.getElementById("tariffaOraria").value) || 0,
    // Ore extra opzionali (seconda riga ore, es. tariffa diversa)
    oreExtra: parseFloat(document.getElementById("oreExtra").value) || 0,
    tariffaExtra: parseFloat(document.getElementById("tariffaExtra").value) || 0,
    // Ore di viaggio opzionali
    oreViaggio: parseFloat(document.getElementById("oreViaggio")?.value) || 0,
    tariffaViaggio: parseFloat(document.getElementById("tariffaViaggio")?.value) || 0,
    descrMateriale: document.getElementById("descrMateriale").value.trim(),
    costoMateriale: parseFloat(document.getElementById("costoMateriale").value) || 0,
    nascondiaCorpo: document.getElementById("nascondiaCorpo")?.checked || false,
    smaltimento: parseFloat(document.getElementById("smaltimento").value) || 0,
    noloPiattaforma: parseFloat(document.getElementById("noloPiattaforma").value) || 0,
    noloTrabattello: parseFloat(document.getElementById("noloTrabattello").value) || 0,
    praticaFgas: parseFloat(document.getElementById("praticaFgas").value) || 0,
    vociManuali: leggiVociManuali(),
    materialiExtra: leggiMaterialiExtra(),
    // Totale a mano: se attivo, il totale lo scrive l'utente e ignora il calcolo automatico
    totaleManuale: !!(document.getElementById("totaleManuale") && document.getElementById("totaleManuale").checked),
    totaleInserito: (document.getElementById("totaleManuale") && document.getElementById("totaleManuale").checked) ? parseImporto(document.getElementById("totale").value) : null,
    notaExcel: document.getElementById("notaExcel").value.trim(),
    // Campi specifici CREVAL (vuoti per CBRE)
    crevalProvincia: tipo === "creval" ? document.getElementById("crevalProvincia").value.trim().toUpperCase() : "",
    crevalRegione: tipo === "creval" ? document.getElementById("crevalRegione").value.trim().toUpperCase() : "",
    crevalTicket: tipo === "creval" ? document.getElementById("crevalTicket").value.trim() : "",
    crevalOdlNumero: tipo === "creval" ? document.getElementById("crevalOdlNumero").value.trim() : "",
    // Pagamenti (opzionale, vale sia per CBRE che CREVAL)
    pagamentiTipo: document.getElementById("pagamentiTipo").value,
    pagamentiCustom: document.getElementById("pagamentiCustom").value.trim(),
    operatore: document.getElementById("nomeOperatore").value.trim() || "anonimo",
    mese: getMonthFromDate(dataDoc)
  };
}

function calcolaTotaleConsuntivo(c) {
  // Se il totale è stato inserito a mano, lo uso così com'è
  if (c.totaleManuale) return c.totaleInserito || 0;
  const costoOreExtra = (c.oreExtra || 0) * (c.tariffaExtra || 0);
  const costoViaggio = (c.oreViaggio || 0) * (c.tariffaViaggio || 0);
  const extraFissi = (c.noloPiattaforma || 0) + (c.noloTrabattello || 0) + (c.praticaFgas || 0);
  const totVociMan = (c.vociManuali || []).reduce((s, v) => s + (v.importo || 0), 0);
  const totMatExtra = (c.materialiExtra || []).reduce((s, m) => s + (m.costo || 0), 0);
  return c.ore * c.tariffaOraria + costoOreExtra + costoViaggio + c.costoMateriale + c.smaltimento + extraFissi + totVociMan + totMatExtra;
}

// ============================================================
// ANTEPRIMA PDF SUL DESKTOP
// ============================================================
async function salvaAnteprimaPdf(tipo) {
  if (!state.isElectron || !window.electronAPI || !window.electronAPI.salvaAnteprima) {
    showToast("⚠️ Funzione disponibile solo nell'app desktop", "warn", 4000);
    return;
  }
  const btn = document.getElementById(tipo === "preventivo" ? "btnAnteprimaPdfPreventivo" : "btnAnteprimaPdfConsuntivo");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Generazione..."; }
  try {
    let blob, filename;
    if (tipo === "preventivo") {
      // Raccoglie dati preventivo senza salvare (stessa logica di generaPreventivo)
      const destinatario = (document.getElementById("prevDestinatario").value || "").trim();
      const dataDocumento = document.getElementById("prevData").value;
      const offerte = leggiOffertePreventivo();
      if (!dataDocumento) throw new Error("Inserisci la data del documento");
      if (!offerte.length) throw new Error("Aggiungi almeno un'offerta");
      for (let i = 0; i < offerte.length; i++) {
        const o = offerte[i];
        if (!o.oggetto || o.oggetto.trim().toUpperCase() === "OFFERTA") {
          throw new Error(`Offerta ${i + 1}: scrivi l'oggetto dopo la parola OFFERTA`);
        }
        if (!(o.importo > 0)) {
          throw new Error(`Offerta ${i + 1}: inserisci l'importo`);
        }
      }
      const primaOff = offerte[0];
      const importoTot = offerte.reduce((s, o) => s + (o.importo || 0), 0);
      const oggettoPrinc = offerte.length > 1
        ? `${primaOff.oggetto} (+${offerte.length - 1} offerte)`
        : primaOff.oggetto;
      const p = {
        tipo: "preventivo",
        numero: "ANTEPRIMA",
        destinatario, dataDocumento, offerte,
        oggetto: oggettoPrinc,
        elenco: primaOff.elenco || "",
        importo: importoTot,
        pagamenti: primaOff.pagamenti || "",
        mese: getMonthFromDate(dataDocumento)
      };
      const r = await buildPreventivoDocx(p);
      blob = r.blob;
      filename = "Preventivo " + destinatario + " " + dataDocumento + ".docx";
    } else {
      if (!validaForm()) throw new Error("Compila i campi obbligatori");
      const tipoCons = document.getElementById("tipoConsuntivo").value;
      const c = costruisciConsuntivoDaForm(0, tipoCons);
      c.numero = "ANTEPRIMA";
      const r = await buildDocx(c);
      blob = r.blob;
      filename = r.filename;
    }
    const arrayBuffer = await blob.arrayBuffer();
    // Passa come Uint8Array (il main.js lo riceve come array di numeri e lo converte con Buffer.from)
    const uint8 = Array.from(new Uint8Array(arrayBuffer));
    // Il filename NON deve contenere già "ANTEPRIMA - " perché il main.js lo aggiunge
    const filenamePerMain = filename.replace(/^ANTEPRIMA\s*-\s*/i, "");
    const r = await window.electronAPI.salvaAnteprima(filenamePerMain, uint8, true);
    if (r && r.ok) {
      showToast("📄 Anteprima PDF salvata sul Desktop!", "success", 5000);
    } else {
      showToast("⚠️ " + ((r && r.errore) || "Errore generazione PDF"), "warn", 6000);
    }
  } catch(e) {
    showToast("⚠️ Errore: " + e.message, "warn", 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📄 Salva anteprima PDF"; }
  }
}

// ============================================================
// GENERAZIONE CONSUNTIVO
// ============================================================
async function generaConsuntivo() {
  if (!validaForm()) return;

  const tipo = document.getElementById("tipoConsuntivo").value;

  // === MODALITÀ MODIFICA: aggiorno un consuntivo esistente ===
  if (state.modificaInCorso) {
    const mod = state.modificaInCorso;
    // Costruisco i dati col numero ESISTENTE (non ne prenoto uno nuovo)
    const c = costruisciConsuntivoDaForm(mod.numero, tipo);
    const totaleCalcolato = calcolaTotaleConsuntivo(c);
    // Se ore e tariffa sono 0 (consuntivo importato a mano non modificato nei prezzi),
    // mantengo il totale originale salvato per non azzerarlo
    if (totaleCalcolato === 0 && mod.totaleOriginale && mod.totaleOriginale > 0) {
      c.totale = mod.totaleOriginale;
    } else {
      c.totale = totaleCalcolato;
    }
    c.modificatoIl = new Date().toISOString();

    try {
      // Aggiorno il documento esistente (merge per non perdere campi come creatoIl)
      await fb.setDoc(fb.doc(fb.db, "consuntivi", mod.id), c, { merge: true });
    } catch (err) {
      showToast("❌ Errore salvataggio modifica: " + err.message, "error");
      return;
    }

    // Rigenero il documento e l'Excel
    try {
      const { blob, filename } = await buildDocx(c);
      const res = await salvaInCartella(blob, filename, tipo, c.mese);
      await gestisciOdlUpload(filename, tipo, c.mese);
      if (res.saved) {
        showToast(`✅ Modifiche salvate al ${tipo.toUpperCase()} ${mod.numero >= 900000 ? '(senza num)' : mod.numero}! Documento e Excel aggiornati.`, "success", 5000);
      }
      // Aggiorno l'Excel del mese
      setTimeout(async () => {
        try {
          if (tipo === "cbre") await aggiornaExcelMese(c.mese);
          else await aggiornaExcelCrevalMese(c.mese);
        } catch (e) { console.error(e); }
      }, 600);
    } catch (err) {
      showToast("⚠️ Modifica salvata su Firebase ma errore documento: " + err.message, "warn");
    }

    // Esco dalla modalità modifica
    state.modificaInCorso = null;
    const btnAnnullaMod = document.getElementById("btnAnnullaModifica");
    if (btnAnnullaMod) btnAnnullaMod.classList.add("hidden");
    aggiornaNumeroPreview(); // ripristina testo bottone
    document.getElementById("formConsuntivo").reset();
    aggiornaCategoriePerTipo();
    cancellaBozza();
    return;
  }

  // === MODALITÀ NORMALE: nuovo consuntivo ===
  let numeroPrenotato;
  try {
    numeroPrenotato = await prenotaNumero(tipo);
  } catch (err) {
    console.error(err);
    showToast("❌ Errore nel prenotare il numero: " + err.message, "error");
    return;
  }

  const c = costruisciConsuntivoDaForm(numeroPrenotato, tipo);
  c.totale = calcolaTotaleConsuntivo(c);
  c.creatoIl = new Date().toISOString();

  // Se è un CREVAL salvato con "Solo Excel", il numero non va mostrato nell'Excel
  const soloExcelCheck = document.getElementById("soloExcel") && document.getElementById("soloExcel").checked;
  if (tipo === "creval" && soloExcelCheck) {
    c.nascondiNumeroExcel = true;
  }

  // Salvo su Firestore (ID = tipo_numero così CBRE 1 e CREVAL 1 non si scontrano)
  const docId = `${tipo}_${numeroPrenotato}`;
  try {
    await fb.setDoc(fb.doc(fb.db, "consuntivi", docId), c);
  } catch (err) {
    showToast("❌ Errore salvataggio: " + err.message, "error");
    return;
  }

  // Genero il .docx (a meno che non sia attivo "Solo Excel")
  const soloExcel = document.getElementById("soloExcel") && document.getElementById("soloExcel").checked;
  try {
    if (soloExcel) {
      // Solo Excel: non genero documento, aggiorno solo l'Excel del mese
      showToast(`✅ ${tipo.toUpperCase()} ${numeroPrenotato} aggiunto SOLO all'Excel (nessun documento creato)`, "success", 5000);
    } else {
      const { blob, filename } = await buildDocx(c);
      const res = await salvaInCartella(blob, filename, tipo, c.mese);
      await gestisciOdlUpload(filename, tipo, c.mese);

      // Salvo anche una copia del PDF sul Desktop (documento finale, senza prefisso
      // ANTEPRIMA). NOTA: per CBRE/CREVAL il PDF sul Desktop è GIÀ generato da
      // salvaInCartella → salvaConsuntivo (res.pdfSalvato). Questa è una copia
      // aggiuntiva solo se quella non è andata a buon fine, per non perdere il PDF.
      if (!res.pdfSalvato) {
        try {
          if (window.electronAPI.salvaAnteprima) {
            const arrPdf = await blob.arrayBuffer();
            await window.electronAPI.salvaAnteprima(filename, Array.from(new Uint8Array(arrPdf)), false);
          }
        } catch(e) { console.warn("PDF Desktop:", e); }
      }

      if (res.saved) {
        const offTxt = res.inOffline ? " [NAS OFFLINE - si sincronizzerà]" : "";
        if (res.pdfFallito) {
          showToast(`✅ ${tipo.toUpperCase()} ${numeroPrenotato}: .docx salvato sul NAS${offTxt}. ⚠️ PDF non creato (${res.avviso || "Word non disponibile"})`, "warn", 7000);
        } else if (res.pdfSalvato) {
          showToast(`✅ ${tipo.toUpperCase()} ${numeroPrenotato} salvato! 📄 .docx sul NAS + 📕 PDF sul Desktop${offTxt}`, "success", 5000);
        } else {
          showToast(`✅ Consuntivo ${tipo.toUpperCase()} ${numeroPrenotato} salvato in ${res.path}${offTxt}`, "success", 5000);
        }

        // Se richiesto, apro una nuova email con il PDF allegato (Thunderbird)
        const inviaEmailCheck = document.getElementById("inviaEmail");
        if (inviaEmailCheck && inviaEmailCheck.checked && res.pdfSalvato && res.pdfPath && window.electronAPI.apriEmailConPdf) {
          try {
            const er = await window.electronAPI.apriEmailConPdf(res.pdfPath, c.odl || "");
            if (er.ok && er.metodo === "thunderbird") {
              showToast("📧 Email aperta col PDF allegato", "info", 4000);
            } else if (er.ok && er.metodo === "mailto") {
              showToast("📧 Email aperta (Thunderbird non trovato: allega il PDF dalla cartella aperta)", "warn", 7000);
            } else {
              showToast("⚠️ Impossibile aprire l'email: " + (er.errore || "errore"), "warn", 5000);
            }
          } catch (e) { console.warn("Apertura email:", e); }
        }
      } else {
        showToast(`✅ Consuntivo ${tipo.toUpperCase()} ${numeroPrenotato} scaricato (cartella Download)`, "success");
      }
    }

    // Se è CBRE, aggiorno automaticamente il file Excel del mese (Scenario C)
    if (tipo === "cbre" && c.sezioneExcel) {
      // Aspetto un attimo che Firestore propaghi i dati al listener real-time
      setTimeout(async () => {
        try {
          const r = await aggiornaExcelMese(c.mese);
          if (r.ok && r.path) {
            console.log("Excel CBRE mese aggiornato:", r.path);
          }
        } catch (err) {
          console.error("Errore aggiornamento Excel CBRE:", err);
        }
      }, 600);
    }

    // Se è CREVAL, aggiorno automaticamente il file Excel CREVAL del mese
    if (tipo === "creval") {
      setTimeout(async () => {
        try {
          const r = await aggiornaExcelCrevalMese(c.mese);
          if (r.ok && r.path) {
            console.log("Excel CREVAL mese aggiornato:", r.path);
          }
        } catch (err) {
          console.error("Errore aggiornamento Excel CREVAL:", err);
        }
      }, 600);
    }

    // Reset form (mantengo il tipo per facilitare consuntivi a raffica dello stesso tipo)
    const tipoMemo = document.getElementById("tipoConsuntivo").value;
    document.getElementById("formConsuntivo").reset();
    document.getElementById("tipoConsuntivo").value = tipoMemo;
    aggiornaCategoriePerTipo();
    aggiornaNumeroPreview();
    document.getElementById("dataDocumento").value = new Date().toISOString().split("T")[0];
    document.getElementById("tariffaOraria").value = 28;
    document.getElementById("costoMateriale").value = 0;
    document.getElementById("smaltimento").value = 0;
    document.getElementById("noloPiattaforma").value = "";
    document.getElementById("noloTrabattello").value = "";
    document.getElementById("praticaFgas").value = "";
    impostaVociManuali([]);
    impostaMaterialiExtra([]);
    document.getElementById("previewArea").classList.add("hidden");
    ricalcolaTotale();
    cancellaBozza();
  } catch (err) {
    console.error(err);
    showToast("⚠️ Salvato su DB ma errore generando .docx: " + err.message, "error");
  }
}

function validaForm() {
  const f = document.getElementById("formConsuntivo");
  if (!f.checkValidity()) {
    f.reportValidity();
    return false;
  }
  if (!document.getElementById("nomeOperatore").value.trim()) {
    showToast("⚠️ Inserisci il tuo nome in alto a destra", "warn");
    document.getElementById("nomeOperatore").focus();
    return false;
  }
  return true;
}

// Transazione atomica: prenoto un numero per il tipo selezionato
async function prenotaNumero(tipo) {
  if (!["cbre","creval"].includes(tipo)) {
    throw new Error("Tipo non valido: " + tipo);
  }
  // In MODALITÀ TEST restituisco un numero finto senza toccare Firebase
  if (state.modalitaTest) {
    if (tipo === "cbre") return state.prossimoNumeroCbre || 999;
    if (tipo === "creval") return state.prossimoNumeroCreval || 999;
    return 999;
  }
  const docRef = fb.doc(fb.db, "config", `contatore_${tipo}`);
  return await fb.runTransaction(fb.db, async (tx) => {
    const snap = await tx.get(docRef);
    let ultimo;
    if (snap.exists()) {
      ultimo = snap.data().ultimoNumero ?? (DEFAULT_START[tipo] - 1);
    } else {
      ultimo = DEFAULT_START[tipo] - 1;
    }
    const nuovo = ultimo + 1;
    tx.set(docRef, { ultimoNumero: nuovo, aggiornatoIl: new Date().toISOString() }, { merge: true });
    return nuovo;
  });
}

// ============================================================
// GENERAZIONE .DOCX — Usa template originale Gama Service
// Il template è incorporato in TEMPLATE_DOCX_CBRE_BASE64 con placeholder {{...}}
// che vengono sostituiti dinamicamente coi dati del consuntivo.
// Risultato: documento IDENTICO all'originale (layout, font, logo, ecc.)
// ============================================================
async function buildDocx(c) {
  const sede = (c.sede || "").toUpperCase();
  const dataDocFormat = formatDateIt(c.dataDocumento);
  const totale = calcolaTotaleConsuntivo(c);
  const anno = c.dataDocumento ? c.dataDocumento.split("-")[0] : new Date().getFullYear();
  const odlText = c.odl ? c.odl : "";

  // Oggetto: CBRE e CREVAL hanno la stessa struttura (il cliente finale è dentro la sede)
  let oggetto = `CONSUNTIVO INTERVENTO ESEGUITO IN DATA ${c.dataIntervento || ""} PRESSO ${sede}`;
  if (odlText) oggetto += ` (ODL NR. ${odlText})`;

  // Elenco voci della tabella: ore, ore extra, materiale, materiali extra, smaltimento, noli, F-Gas, voci manuali
  const righe = [];
  if (c.ore && c.ore > 0) {
    righe.push({ tit: "Manodopera Specializzata", sub: `Ore totali di intervento — tariffa oraria € ${formatEuro(c.tariffaOraria || 0)}`, qta: `${formatNumero(c.ore)} ore`, imp: c.ore * c.tariffaOraria });
  }
  if (c.oreExtra && c.oreExtra > 0 && c.tariffaExtra && c.tariffaExtra > 0) {
    righe.push({ tit: "Manodopera Tecnico Specializzato", sub: `Tariffa oraria € ${formatEuro(c.tariffaExtra)}`, qta: `${formatNumero(c.oreExtra)} ore`, imp: c.oreExtra * c.tariffaExtra });
  }
  if (c.costoMateriale && c.costoMateriale > 0) {
    righe.push({ tit: "Materiali e Consumabili", sub: c.descrMateriale || "", qta: c.nascondiaCorpo ? "—" : "A corpo", imp: c.costoMateriale });
  }
  (c.materialiExtra || []).forEach(m => {
    if ((m.descr || "").trim() || (m.costo || 0) !== 0) righe.push({ tit: (m.descr || "Materiale").trim(), sub: "", qta: c.nascondiaCorpo ? "—" : "A corpo", imp: m.costo || 0 });
  });
  if (c.smaltimento && c.smaltimento !== 0) righe.push({ tit: "Smaltimento", sub: "", qta: "—", imp: c.smaltimento });
  if ((c.noloPiattaforma || 0) !== 0) righe.push({ tit: "Nolo Piattaforma", sub: "", qta: "—", imp: c.noloPiattaforma });
  if ((c.noloTrabattello || 0) !== 0) righe.push({ tit: "Nolo Trabattello", sub: "", qta: "—", imp: c.noloTrabattello });
  if ((c.praticaFgas || 0) !== 0) righe.push({ tit: "Pratica F-Gas", sub: "", qta: "—", imp: c.praticaFgas });
  (c.vociManuali || []).forEach(v => {
    if ((v.descr || "").trim() || (v.importo || 0) !== 0) righe.push({ tit: (v.descr || "Voce").trim(), sub: "", qta: "—", imp: v.importo || 0 });
  });

  // Generatore di righe XML per la tabella (3 colonne)
  const cella = (w, par, vc = false) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${vc ? '<w:vAlign w:val="center"/>' : ''}</w:tcPr>${par}</w:tc>`;
  const par = (testo, { bold = false, sz = 20, jc = null, color = "222222", italic = false } = {}) => {
    const jcXml = jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : "";
    return `<w:p>${jcXml}<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}<w:color w:val="${color}"/><w:sz w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${testo}</w:t></w:r></w:p>`;
  };
  const righeXml = righe.map(r => {
    const impStr = (r.imp < 0 ? "-" : "") + "€ " + formatEuro(Math.abs(r.imp));
    let desc = par(escapeXml(r.tit), { bold: true, sz: 20 });
    if (r.sub) desc += par(escapeXml(r.sub), { sz: 18, color: "7F7F7F" });
    return `<w:tr>${cella(5670, desc)}${cella(1587, par(escapeXml(r.qta || "—"), { sz: 20, jc: "center" }), true)}${cella(2268, par(impStr, { sz: 20, jc: "right" }), true)}</w:tr>`;
  }).join("");

  // Termini di pagamento
  let bloccoPagamenti;
  if (["30", "60", "90", "120"].includes(c.pagamentiTipo)) bloccoPagamenti = `Termini di pagamento: ${c.pagamentiTipo} giorni data fattura.`;
  else if (c.pagamentiTipo === "ALTRO" && c.pagamentiCustom) bloccoPagamenti = `Termini di pagamento: ${c.pagamentiCustom}`;
  else bloccoPagamenti = "Termini di pagamento: come da accordi commerciali.";

  // Carico il template (nuova grafica) e riempio
  const templateBytes = base64ToBytes(TEMPLATE_DOCX_CBRE_BASE64);
  const zip = await JSZip.loadAsync(templateBytes);
  let docXml = await zip.file("word/document.xml").async("string");

  // Descrizione (multi-riga → a capo) — RAW perché contiene <w:br/>
  const descrXml = (c.descrizione || "").split("\n").map(s => escapeXml(s)).join("</w:t><w:br/><w:t>");
  docXml = docXml.split("{{DESCRIZIONE}}").join(descrXml);

  // Sostituisco la riga-segnaposto della tabella con tutte le righe generate
  const idxR = docXml.indexOf("{{RIGHE}}");
  if (idxR >= 0) {
    const trStart = docXml.lastIndexOf("<w:tr", idxR);
    const trEnd = docXml.indexOf("</w:tr>", idxR) + "</w:tr>".length;
    docXml = docXml.substring(0, trStart) + righeXml + docXml.substring(trEnd);
  }

  // Altri placeholder (valori semplici, con escape)
  const placeholders = {
    "{{DATA_DOC}}": dataDocFormat,
    "{{NUMERO}}": String(c.numero),
    "{{ANNO}}": String(anno),
    "{{OGGETTO}}": oggetto,
    "{{TOTALE}}": formatEuro(totale),
    "{{BLOCCO_PAGAMENTI}}": bloccoPagamenti
  };
  for (const [ph, val] of Object.entries(placeholders)) {
    docXml = docXml.split(ph).join(escapeXml(val));
  }

  zip.file("word/document.xml", docXml);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE"
  });

  const sedeFile = sede.replace(/[/\\?%*:|"<>]/g, "");
  const filename = `CONSUNTIVO NR ${c.numero} ${sedeFile}.docx`;
  return { blob, filename };
}

// Escape caratteri XML per evitare di rompere il documento
function escapeXml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ============================================================
// PREVENTIVI (OFFERTE)
// ============================================================
// I preventivi hanno: numerazione separata, destinatario modificabile,
// elenco voci libero, cartella di salvataggio SEPARATA, solo .docx.

// Costruisce il documento DOCX del preventivo dal template
// Costruisce l'XML di una tabella Word a 5 colonne per il preventivo:
// DESCRIZIONE | U.M. | Q.tà | P. Unitario | P. Totale, con header blu, le righe
// delle voci e la riga finale del totale. Sostituisce la vecchia tabella a 2 colonne.
function costruisciTabellaVociXml(voci, totale) {
  // Stili riutilizzabili
  const fontHeader = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr>';
  const fontCella  = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="222222"/><w:sz w:val="18"/></w:rPr>';
  const fontTot    = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="222222"/><w:sz w:val="20"/></w:rPr>';

  // Larghezze colonne (in dxa): descrizione larga, le altre strette
  const larghezze = [4600, 900, 900, 1500, 1500];

  const cellaHeader = (testo, w, jc) =>
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${w}"/><w:shd w:val="clear" w:color="auto" w:fill="1F3864"/></w:tcPr>` +
    `<w:p><w:pPr><w:jc w:val="${jc}"/><w:spacing w:after="0"/></w:pPr><w:r>${fontHeader}<w:t xml:space="preserve">${escapeXml(testo)}</w:t></w:r></w:p></w:tc>`;

  const cellaTesto = (testo, w, jc, font) =>
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${w}"/></w:tcPr>` +
    `<w:p><w:pPr><w:jc w:val="${jc}"/><w:spacing w:after="0"/></w:pPr><w:r>${font}<w:t xml:space="preserve">${escapeXml(testo)}</w:t></w:r></w:p></w:tc>`;

  // Header
  const header = '<w:tr>' +
    cellaHeader("DESCRIZIONE", larghezze[0], "left") +
    cellaHeader("U.M.", larghezze[1], "center") +
    cellaHeader("Q.tà", larghezze[2], "center") +
    cellaHeader("P. Unitario", larghezze[3], "center") +
    cellaHeader("P. Totale", larghezze[4], "center") +
    '</w:tr>';

  // Righe voci
  const righe = (voci || []).map(v => {
    const qtaStr = (v.qta != null) ? String(v.qta).replace(".", ",") : "";
    return '<w:tr>' +
      cellaTesto(v.descrizione || "", larghezze[0], "left", fontCella) +
      cellaTesto(v.um || "", larghezze[1], "center", fontCella) +
      cellaTesto(qtaStr, larghezze[2], "center", fontCella) +
      cellaTesto("€ " + formatEuro(v.pu || 0), larghezze[3], "right", fontCella) +
      cellaTesto("€ " + formatEuro(v.ptot || 0), larghezze[4], "right", fontCella) +
      '</w:tr>';
  }).join("");

  // Riga totale (le prime 4 colonne unite con etichetta, ultima col totale)
  const rigaTotale = '<w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${larghezze[0]+larghezze[1]+larghezze[2]+larghezze[3]}"/><w:gridSpan w:val="4"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:tcPr>` +
    `<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:r>${fontTot}<w:t xml:space="preserve">TOTALE IMPONIBILE OFFERTA</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${larghezze[4]}"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:tcPr>` +
    `<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:r>${fontTot}<w:t xml:space="preserve">€ ${formatEuro(totale || 0)}</w:t></w:r></w:p></w:tc>` +
    '</w:tr>';

  const gridCols = larghezze.map(w => `<w:gridCol w:w="${w}"/>`).join("");

  return '<w:tbl>' +
    '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:type="auto" w:w="0"/>' +
    '<w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/></w:tblPr>' +
    '<w:tblGrid>' + gridCols + '</w:tblGrid>' +
    header + righe + rigaTotale +
    '</w:tbl>';
}

async function buildPreventivoDocx(p, opzioni = {}) {
  const conTimbroAccettato = opzioni.conTimbroAccettato === true;
  const anno = p.dataDocumento ? p.dataDocumento.split("-")[0] : new Date().getFullYear();

  // Offerte: o array (più offerte) o singola (compatibilità coi vecchi preventivi)
  const offerte = (Array.isArray(p.offerte) && p.offerte.length)
    ? p.offerte
    : [{ oggetto: p.oggetto, elenco: p.elenco, importo: p.importo, pagamenti: p.pagamenti }];

  // Destinatario condiviso: ogni riga (\n) diventa un a-capo nel docx
  const destLines = (p.destinatario || "").split("\n").map(s => escapeXml(s.trim()));
  const destXml = destLines.join("</w:t><w:br/><w:t>");

  const templateBytes = base64ToBytes(TEMPLATE_DOCX_PREVENTIVO_BASE64);
  const zip = await JSZip.loadAsync(templateBytes);
  let docXml = await zip.file("word/document.xml").async("string");

  // Isolo il "blocco offerta" (contenuto del body prima del sectPr) per poterlo duplicare
  const bodyOpen = docXml.indexOf("<w:body");
  const bodyStart = docXml.indexOf(">", bodyOpen) + 1;
  let sectIdx = docXml.lastIndexOf("<w:sectPr");
  if (sectIdx < 0) sectIdx = docXml.lastIndexOf("</w:body>");
  const primaBody = docXml.substring(0, bodyStart);
  const bloccoTemplate = docXml.substring(bodyStart, sectIdx);
  const codaBody = docXml.substring(sectIdx);

  // Riempie una copia del blocco coi dati di UNA offerta (destinatario/data/numero uguali per tutte)
  const riempiBlocco = (off) => {
    let b = bloccoTemplate;

    // Preparo le voci (dalla tabella nuova o, se vecchio preventivo, dall'elenco testuale)
    let voci;
    if (Array.isArray(off.voci) && off.voci.length > 0) {
      voci = off.voci;
    } else {
      // Compatibilità con vecchi preventivi salvati: converto l'elenco in voci
      voci = (off.elenco || "").split("\n").map(s => s.trim()).filter(s => s.length > 0)
        .map(descr => ({ descrizione: descr, um: "", qta: null, pu: 0, ptot: 0 }));
    }
    const totaleOfferta = off.importo || voci.reduce((s, v) => s + (v.ptot || 0), 0);

    // SOSTITUISCO l'intera tabella a 2 colonne (che contiene {{ELENCO}} e {{IMPORTO}})
    // con la nuova tabella a 5 colonne (DESCRIZIONE | U.M. | Q.tà | P.Unit | P.Tot).
    const idxElenco = b.indexOf("{{ELENCO}}");
    if (idxElenco >= 0) {
      const inizioTbl = b.lastIndexOf("<w:tbl>", idxElenco);
      const fineTbl = b.indexOf("</w:tbl>", idxElenco) + "</w:tbl>".length;
      if (inizioTbl >= 0 && fineTbl > inizioTbl) {
        const nuovaTabella = costruisciTabellaVociXml(voci, totaleOfferta);
        b = b.slice(0, inizioTbl) + nuovaTabella + b.slice(fineTbl);
      }
    }

    b = b.split("{{DESTINATARIO}}").join(destXml);   // raw (contiene <w:br/>)
    b = b.split("{{DATA_DOC}}").join(escapeXml(formatDateIt(p.dataDocumento)));
    b = b.split("{{NUMERO}}").join(escapeXml(String(p.numero)));
    b = b.split("{{ANNO}}").join(escapeXml(String(anno)));
    b = b.split("{{OGGETTO}}").join(escapeXml(off.oggetto || ""));
    b = b.split("{{IMPORTO}}").join(escapeXml(formatEuro(totaleOfferta)));
    b = b.split("{{PAGAMENTI}}").join(escapeXml(off.pagamenti || ""));
    return b;
  };

  // Ogni offerta su una pagina nuova: unisco i blocchi con un'interruzione di pagina
  const interruzionePagina = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  docXml = primaBody + offerte.map(riempiBlocco).join(interruzionePagina) + codaBody;

  // Con più offerte il timbro (immagine) viene duplicato: rendo unici gli id dei disegni
  let _did = 1; docXml = docXml.replace(/(<wp:docPr\b[^>]*\bid=")\d+(")/g, (m, a, b) => a + (_did++) + b);
  let _cid = 1; docXml = docXml.replace(/(<pic:cNvPr\b[^>]*\bid=")\d+(")/g, (m, a, b) => a + (_cid++) + b);

  // Se è ACCETTATO: inserisco il timbro verde in fondo al documento
  if (conTimbroAccettato && typeof TIMBRO_ACCETTATO_BASE64 !== "undefined") {
    docXml = await inserisciTimbroAccettato(zip, docXml);
  }

  zip.file("word/document.xml", docXml);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE"
  });

  const oggettoFile = ((offerte[0] && offerte[0].oggetto) || p.oggetto || "preventivo").substring(0, 40).replace(/[/\\?%*:|"<>]/g, "");
  const prefisso = conTimbroAccettato ? "PREVENTIVO ACCETTATO" : "PREVENTIVO";
  const filename = `${prefisso} NR ${p.numero} ${oggettoFile}.docx`;
  return { blob, filename };
}

// Inserisce il timbro ACCETTATO (immagine PNG) in fondo al documento del preventivo.
// Aggiunge il media, la relazione e un paragrafo con l'immagine prima di </w:body>.
async function inserisciTimbroAccettato(zip, docXml) {
  // 1) Aggiungo l'immagine nel media
  const imgBytes = base64ToBytes(TIMBRO_ACCETTATO_BASE64);
  zip.file("word/media/timbro-accettato.png", imgBytes);

  // 2) Aggiungo la relazione nel file rels (con un rId nuovo non in conflitto)
  const relsPath = "word/_rels/document.xml.rels";
  let rels = await zip.file(relsPath).async("string");
  // Trovo un rId libero
  const idsUsati = [...rels.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1]));
  const nuovoId = "rId" + (Math.max(0, ...idsUsati) + 1);
  const nuovaRel = `<Relationship Id="${nuovoId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/timbro-accettato.png"/>`;
  rels = rels.replace("</Relationships>", nuovaRel + "</Relationships>");
  zip.file(relsPath, rels);

  // 3) Inserisco un paragrafo centrato con l'immagine prima di </w:body>
  //    (ma dopo l'ultimo contenuto, prima di <w:sectPr> se presente)
  // Dimensioni timbro: ratio ~3.16 (300x95). Larghezza ~5cm = 1800000 EMU, altezza proporzionale
  const cx = 1800000;
  const cy = Math.round(cx * 95 / 300); // mantengo proporzioni
  const drawing = `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="9001" name="TimbroAccettato"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9001" name="timbro-accettato.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${nuovoId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

  // Inserisco prima di <w:sectPr (se c'è) altrimenti prima di </w:body>
  const idxSect = docXml.lastIndexOf("<w:sectPr");
  if (idxSect >= 0) {
    docXml = docXml.substring(0, idxSect) + drawing + docXml.substring(idxSect);
  } else {
    docXml = docXml.replace("</w:body>", drawing + "</w:body>");
  }
  return docXml;
}

// Prenota un numero preventivo (contatore separato su Firebase)
async function prenotaNumeroPreventivo() {
  // In MODALITÀ TEST restituisco un numero finto senza toccare Firebase
  if (state.modalitaTest) {
    return state.prossimoNumeroPreventivo || 999;
  }
  const docRef = fb.doc(fb.db, "config", "contatore_preventivo");
  return await fb.runTransaction(fb.db, async (tx) => {
    const snap = await tx.get(docRef);
    let ultimo;
    const startPrev = (state.prossimoNumeroPreventivo != null ? state.prossimoNumeroPreventivo : 121) - 1;
    if (snap.exists()) {
      ultimo = snap.data().ultimoNumero ?? startPrev;
    } else {
      ultimo = startPrev;
    }
    const nuovo = ultimo + 1;
    tx.set(docRef, { ultimoNumero: nuovo, aggiornatoIl: new Date().toISOString() }, { merge: true });
    return nuovo;
  });
}

function setupPreventivoTab() {
  const form = document.getElementById("formPreventivo");
  if (!form) return;
  // Imposto la data di oggi di default
  const oggi = new Date().toISOString().split("T")[0];
  const dataInput = document.getElementById("prevData");
  if (dataInput && !dataInput.value) dataInput.value = oggi;

  // Prefisso fisso "OFFERTA " nel campo oggetto (non cancellabile)
  // Primo blocco offerta + collego il pulsante "Aggiungi un'altra offerta"
  if (document.getElementById("prevBlocchi") && !document.querySelector("#prevBlocchi .prev-blocco")) {
    aggiungiBloccoPreventivo();
  }
  const btnAgg = document.getElementById("btnAggiungiPreventivo");
  if (btnAgg) btnAgg.addEventListener("click", () => aggiungiBloccoPreventivo());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await generaPreventivo();
  });

  // Pulsante anteprima PDF preventivo
  const btnAnteprima = document.getElementById("btnAnteprimaPdfPreventivo");
  if (btnAnteprima) {
    btnAnteprima.addEventListener("click", async () => {
      await salvaAnteprimaPdf("preventivo");
    });
  }

  const btnAnn = document.getElementById("btnAnnullaModificaPrev");
  if (btnAnn) btnAnn.addEventListener("click", annullaModificaPreventivo);

  // Tendina destinatari salvati: quando scegli, riempie il campo
  const tendina = document.getElementById("prevDestinatariSalvati");
  if (tendina) {
    tendina.addEventListener("change", () => {
      if (tendina.value) {
        document.getElementById("prevDestinatario").value = tendina.value;
        tendina.selectedIndex = 0; // torno alla voce iniziale
      }
    });
  }
}

// Prefisso "OFFERTA " precompilato nell'oggetto di ogni offerta (vedi aggiungiBloccoPreventivo)
const PREFISSO_OFFERTA = "OFFERTA ";

// Riempie la tendina con i destinatari salvati (in ordine alfabetico)
// Destinatari pre-caricati: sempre disponibili nella tendina, senza doverli scrivere
const DESTINATARI_PREDEFINITI = [
  "DUSSMANN SERVICE SRL\nVIA SAN GREGORIO,55\n20124 MILANO (MI)\nP.IVA 00124140211",
  "GI.L.C. IMPIANTI SRL\nVIA FRATELLI DI DIO,2 B\n20063 CERNUSCO SUL NAVIGLIO (MI)\nP.IVA 11174510153"
];
function aggiornaTendinaDestinatari() {
  const lista = [...new Set([...DESTINATARI_PREDEFINITI, ...(state.destinatariPreventivi || [])])].sort((a, b) =>
    a.localeCompare(b, "it", { sensitivity: "base" })
  );
  const opzioni = `<option value="">— Scegli un destinatario salvato —</option>` +
    lista.map(d => {
      // Mostro la prima riga come etichetta (il valore completo può avere più righe)
      const etichetta = d.split("\n")[0].substring(0, 60);
      return `<option value="${escapeHtml(d)}">${escapeHtml(etichetta)}</option>`;
    }).join("");
  // Stessa lista condivisa per preventivi e DUSSMANN
  for (const id of ["prevDestinatariSalvati", "dussDestinatariSalvati"]) {
    const tendina = document.getElementById(id);
    if (tendina) tendina.innerHTML = opzioni;
  }
}

// Salva il destinatario nella lista condivisa se è nuovo (auto-salvataggio)
async function salvaDestinatarioSeNuovo(destinatario) {
  const d = (destinatario || "").trim();
  if (!d) return;
  const lista = state.destinatariPreventivi || [];
  // Confronto "normalizzato": ignoro maiuscole/minuscole e spazi extra
  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const esiste = lista.some(x => norm(x) === norm(d));
  if (esiste) return;
  try {
    const nuova = [...lista, d];
    await fb.setDoc(fb.doc(fb.db, "config", "settings"),
      { destinatariPreventivi: nuova }, { merge: true });
    // il listener aggiornerà la tendina automaticamente
  } catch (e) {
    console.warn("Salvataggio destinatario non riuscito:", e.message);
  }
}

// ============================================================
// PREVENTIVI: blocchi offerta ripetibili (più offerte in un documento)
// ============================================================
const OPZIONI_PAGAMENTI_PREV = [
  ["60 giorni data fattura", "60 giorni data fattura"],
  ["30 giorni data fattura", "30 giorni data fattura"],
  ["90 giorni data fattura", "90 giorni data fattura"],
  ["120 giorni data fattura", "120 giorni data fattura"],
  ["rimessa diretta", "Rimessa diretta"],
  ["", "Nessuno"]
];
// Unità di misura per la tabella preventivi (tendina + possibilità di scrivere)
const UNITA_MISURA_PREV = ["a corpo", "n", "c", "mt", "ml", "mq", "mc", "kg", "lt", "h", "gg", "q.li", "t"];

// Crea una riga della tabella voci del preventivo
function htmlRigaVocePreventivo() {
  const opts = UNITA_MISURA_PREV.map(u => `<option value="${u}">${u}</option>`).join("");
  return `
  <tr class="prev-voce-riga">
    <td style="border:1px solid #d1d5db;padding:2px;"><input type="text" class="voce-descrizione" placeholder="es. Tubo multistrato De 63" style="width:100%;box-sizing:border-box;border:none;padding:6px;font-size:13px;"></td>
    <td style="border:1px solid #d1d5db;padding:2px;">
      <select class="voce-um-sel" style="width:100%;box-sizing:border-box;border:none;padding:6px;font-size:13px;">${opts}<option value="__ALTRO__">Altro...</option></select>
      <input type="text" class="voce-um-altro" placeholder="scrivi U.M." style="width:100%;box-sizing:border-box;border:none;padding:6px;font-size:13px;display:none;">
    </td>
    <td style="border:1px solid #d1d5db;padding:2px;"><input type="number" class="voce-qta" step="0.01" min="0" value="1" style="width:100%;box-sizing:border-box;border:none;padding:6px;font-size:13px;text-align:right;"></td>
    <td style="border:1px solid #d1d5db;padding:2px;"><input type="number" class="voce-pu" step="0.001" min="0" placeholder="0,000" style="width:100%;box-sizing:border-box;border:none;padding:6px;font-size:13px;text-align:right;"></td>
    <td style="border:1px solid #d1d5db;padding:6px;text-align:right;" class="voce-ptot">€ 0,00</td>
    <td style="border:1px solid #d1d5db;padding:2px;text-align:center;"><button type="button" class="voce-rimuovi" style="background:#ef4444;color:white;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;" title="Togli">✖</button></td>
  </tr>`;
}

// Aggiunge una riga voce alla tabella di un blocco offerta
function aggiungiVocePreventivo(bloccoOfferta, dati) {
  const tbody = bloccoOfferta.querySelector(".prev-voci-body");
  if (!tbody) return;
  const wrap = document.createElement("tbody");
  wrap.innerHTML = htmlRigaVocePreventivo().trim();
  const riga = wrap.firstChild;
  tbody.appendChild(riga);

  const selUm = riga.querySelector(".voce-um-sel");
  const inpUmAltro = riga.querySelector(".voce-um-altro");
  const inpQta = riga.querySelector(".voce-qta");
  const inpPu = riga.querySelector(".voce-pu");

  // Precompilo se ho dati salvati
  if (dati) {
    riga.querySelector(".voce-descrizione").value = dati.descrizione || "";
    inpQta.value = (dati.qta != null && dati.qta !== "") ? dati.qta : "1";
    inpPu.value = (dati.pu != null && dati.pu !== "") ? dati.pu : "";
    // U.M.: se è tra quelle standard uso la tendina, altrimenti "Altro"
    if (dati.um && UNITA_MISURA_PREV.includes(dati.um)) {
      selUm.value = dati.um;
    } else if (dati.um) {
      selUm.value = "__ALTRO__";
      inpUmAltro.style.display = "";
      inpUmAltro.value = dati.um;
    }
  }

  // U.M.: tendina che sblocca la casella "scrivi tu" quando scelgo "Altro..."
  selUm.addEventListener("change", () => {
    if (selUm.value === "__ALTRO__") { inpUmAltro.style.display = ""; inpUmAltro.focus(); }
    else { inpUmAltro.style.display = "none"; inpUmAltro.value = ""; }
  });

  // Ricalcolo totale quando cambiano quantità o prezzo
  const ricalcola = () => ricalcolaTotaliPreventivo(bloccoOfferta);
  inpQta.addEventListener("input", ricalcola);
  inpPu.addEventListener("input", ricalcola);

  // Rimuovi riga
  riga.querySelector(".voce-rimuovi").addEventListener("click", () => {
    riga.remove();
    ricalcolaTotaliPreventivo(bloccoOfferta);
  });

  ricalcolaTotaliPreventivo(bloccoOfferta);
}

// Ricalcola il P.Totale di ogni riga e il totale generale dell'offerta
function ricalcolaTotaliPreventivo(bloccoOfferta) {
  let totale = 0;
  bloccoOfferta.querySelectorAll(".prev-voce-riga").forEach(riga => {
    const qta = parseFloat(riga.querySelector(".voce-qta").value) || 0;
    const pu = parseFloat(riga.querySelector(".voce-pu").value) || 0;
    const ptot = qta * pu;
    totale += ptot;
    riga.querySelector(".voce-ptot").textContent = "€ " + ptot.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });
  const cellaTot = bloccoOfferta.querySelector(".prev-totale-cella");
  if (cellaTot) cellaTot.textContent = "€ " + totale.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return totale;
}

// Legge le voci della tabella di un'offerta
function leggiVociPreventivo(bloccoOfferta) {
  return Array.from(bloccoOfferta.querySelectorAll(".prev-voce-riga")).map(riga => {
    const selUm = riga.querySelector(".voce-um-sel");
    const umAltro = riga.querySelector(".voce-um-altro");
    const um = (selUm.value === "__ALTRO__") ? (umAltro.value || "").trim() : selUm.value;
    const qta = parseFloat(riga.querySelector(".voce-qta").value) || 0;
    const pu = parseFloat(riga.querySelector(".voce-pu").value) || 0;
    return {
      descrizione: (riga.querySelector(".voce-descrizione").value || "").trim(),
      um: um,
      qta: qta,
      pu: pu,
      ptot: qta * pu
    };
  }).filter(v => v.descrizione || v.pu > 0);
}

function htmlBloccoPreventivo() {
  const opts = OPZIONI_PAGAMENTI_PREV.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  return `
  <div class="prev-blocco" style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <strong class="prev-blocco-titolo" style="color:#f59014">Offerta 1</strong>
      <button type="button" class="btn btn-secondary prev-rimuovi" style="background:#ef4444;color:white;padding:4px 10px" title="Togli questa offerta">✖</button>
    </div>
    <div class="form-row"><div class="form-field full-width">
      <label>Oggetto dell'offerta</label>
      <input type="text" class="prev-oggetto" placeholder="OFFERTA SISTEMAZIONE PORTA IN VETRO PRESSO BNL...">
    </div></div>
    <div class="form-row"><div class="form-field full-width">
      <label>Voci del preventivo</label>
      <table class="prev-tabella" style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:6px;border:1px solid #d1d5db;">Descrizione</th>
            <th style="padding:6px;border:1px solid #d1d5db;width:90px;">U.M.</th>
            <th style="padding:6px;border:1px solid #d1d5db;width:70px;">Q.tà</th>
            <th style="padding:6px;border:1px solid #d1d5db;width:100px;">P. Unitario</th>
            <th style="padding:6px;border:1px solid #d1d5db;width:110px;">P. Totale</th>
            <th style="padding:6px;border:1px solid #d1d5db;width:36px;"></th>
          </tr>
        </thead>
        <tbody class="prev-voci-body"></tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="text-align:right;padding:8px;font-weight:700;border:1px solid #d1d5db;">TOTALE:</td>
            <td class="prev-totale-cella" style="padding:8px;font-weight:700;color:#16a34a;border:1px solid #d1d5db;text-align:right;">€ 0,00</td>
            <td style="border:1px solid #d1d5db;"></td>
          </tr>
        </tfoot>
      </table>
      <button type="button" class="btn btn-secondary prev-aggiungi-voce" style="background:#16a34a;color:white;padding:6px 14px;">➕ Aggiungi voce</button>
    </div></div>
    <div class="form-row">
      <div class="form-field">
        <label>Pagamenti</label>
        <select class="prev-pagamenti">${opts}</select>
      </div>
    </div>
  </div>`;
}
function aggiungiBloccoPreventivo(dati) {
  const cont = document.getElementById("prevBlocchi");
  if (!cont) return null;
  const wrap = document.createElement("div");
  wrap.innerHTML = htmlBloccoPreventivo().trim();
  const blocco = wrap.firstChild;
  cont.appendChild(blocco);
  const inpOgg = blocco.querySelector(".prev-oggetto");
  if (dati) {
    inpOgg.value = dati.oggetto || "";
    if (dati.pagamenti != null) blocco.querySelector(".prev-pagamenti").value = dati.pagamenti;
    // Carico le voci salvate nella tabella
    if (Array.isArray(dati.voci) && dati.voci.length > 0) {
      dati.voci.forEach(v => aggiungiVocePreventivo(blocco, v));
    } else {
      aggiungiVocePreventivo(blocco); // almeno una riga vuota
    }
  } else {
    inpOgg.value = PREFISSO_OFFERTA; // precompilo "OFFERTA " come nel vecchio campo
    aggiungiVocePreventivo(blocco); // parto con una riga vuota
  }

  // Pulsante "+ Aggiungi voce"
  const btnAggVoce = blocco.querySelector(".prev-aggiungi-voce");
  if (btnAggVoce) btnAggVoce.addEventListener("click", () => aggiungiVocePreventivo(blocco));

  blocco.querySelector(".prev-rimuovi").addEventListener("click", () => {
    if (document.querySelectorAll("#prevBlocchi .prev-blocco").length <= 1) {
      showToast("⚠️ Deve restare almeno un'offerta", "warn");
      return;
    }
    blocco.remove();
    rinumeraBlocchiPreventivo();
  });
  rinumeraBlocchiPreventivo();
  return blocco;
}
function rinumeraBlocchiPreventivo() {
  const blocchi = document.querySelectorAll("#prevBlocchi .prev-blocco");
  blocchi.forEach((b, i) => {
    const t = b.querySelector(".prev-blocco-titolo");
    if (t) t.textContent = "Offerta " + (i + 1);
    const btn = b.querySelector(".prev-rimuovi");
    if (btn) btn.style.display = (blocchi.length <= 1) ? "none" : "";
  });
}
function leggiOffertePreventivo() {
  return Array.from(document.querySelectorAll("#prevBlocchi .prev-blocco")).map(b => {
    const voci = leggiVociPreventivo(b);
    const importo = voci.reduce((s, v) => s + (v.ptot || 0), 0);
    return {
      oggetto: (b.querySelector(".prev-oggetto").value || "").trim(),
      voci: voci,
      importo: importo,           // totale calcolato dalla somma dei P.Totali
      pagamenti: b.querySelector(".prev-pagamenti").value
    };
  });
}
function resetBlocchiPreventivo() {
  const cont = document.getElementById("prevBlocchi");
  if (cont) cont.innerHTML = "";
  aggiungiBloccoPreventivo();
}

async function generaPreventivo() {
  const destinatario = document.getElementById("prevDestinatario").value.trim();
  const dataDocumento = document.getElementById("prevData").value;
  const offerte = leggiOffertePreventivo();

  if (!dataDocumento) {
    showToast("⚠️ Inserisci la data del documento", "warn");
    return;
  }
  if (!offerte.length) {
    showToast("⚠️ Aggiungi almeno un'offerta", "warn");
    return;
  }
  // Ogni offerta deve avere oggetto (oltre a "OFFERTA") e importo
  for (let i = 0; i < offerte.length; i++) {
    const o = offerte[i];
    if (!o.oggetto || o.oggetto.trim().toUpperCase() === "OFFERTA") {
      showToast(`⚠️ Offerta ${i + 1}: scrivi l'oggetto dopo la parola OFFERTA`, "warn");
      return;
    }
    if (!(o.importo > 0)) {
      showToast(`⚠️ Offerta ${i + 1}: inserisci l'importo`, "warn");
      return;
    }
  }

  // Campi principali (per storico/compatibilità) + array offerte completo
  const primaOff = offerte[0];
  const importoTot = offerte.reduce((s, o) => s + (o.importo || 0), 0);
  const oggettoPrinc = offerte.length > 1
    ? `${primaOff.oggetto} (+${offerte.length - 1} offerte)`
    : primaOff.oggetto;
  const campiComuni = {
    destinatario, dataDocumento, offerte,
    oggetto: oggettoPrinc,
    elenco: primaOff.elenco || "",
    importo: importoTot,
    pagamenti: primaOff.pagamenti || "",
    mese: getMonthFromDate(dataDocumento)
  };

  // MODIFICA in corso?
  if (state.modificaInCorsoPrev) {
    const mod = state.modificaInCorsoPrev;
    const p = { tipo: "preventivo", numero: mod.numero, ...campiComuni, modificatoIl: new Date().toISOString() };
    try {
      await fb.setDoc(fb.doc(fb.db, "preventivi", mod.id), p, { merge: true });
      const { blob, filename } = await buildPreventivoDocx(p);
      if (state.isElectron) {
        const arr = await blob.arrayBuffer();
        await window.electronAPI.salvaPreventivo(filename, Array.from(new Uint8Array(arr)));
      } else {
        saveAs(blob, filename);
      }
      showToast(`✅ Preventivo NR ${mod.numero} modificato`, "success", 5000);
      salvaDestinatarioSeNuovo(destinatario);
    } catch (err) {
      showToast("❌ Errore modifica preventivo: " + err.message, "error");
      return;
    }
    state.modificaInCorsoPrev = null;
    const btnAnn = document.getElementById("btnAnnullaModificaPrev");
    if (btnAnn) btnAnn.classList.add("hidden");
    resetBlocchiPreventivo();
    aggiornaPrevNumeroUI();
    cancellaBozza();
    return;
  }

  let numeroPrenotato;
  try {
    numeroPrenotato = await prenotaNumeroPreventivo();
  } catch (err) {
    showToast("❌ Errore nel prenotare il numero preventivo: " + err.message, "error");
    return;
  }

  const p = { tipo: "preventivo", numero: numeroPrenotato, ...campiComuni, creatoIl: new Date().toISOString() };

  // Salvo su Firestore (collezione separata "preventivi")
  try {
    await fb.setDoc(fb.doc(fb.db, "preventivi", `preventivo_${numeroPrenotato}`), p);
  } catch (err) {
    showToast("❌ Errore salvataggio preventivo: " + err.message, "error");
    return;
  }

  // Genero il .docx (un solo file con tutte le offerte) e lo salvo nella cartella PREVENTIVI
  try {
    const { blob, filename } = await buildPreventivoDocx(p);
    if (state.isElectron) {
      const arr = await blob.arrayBuffer();
      const bytesArr = Array.from(new Uint8Array(arr));
      const r = await window.electronAPI.salvaPreventivo(filename, bytesArr);
      // Salvo anche una copia del PDF sul Desktop (riuso lo stesso array di bytes)
      let pdfOk = false, pdfErrore = "";
      try {
        if (window.electronAPI.salvaAnteprima) {
          const rpdf = await window.electronAPI.salvaAnteprima(filename, bytesArr, false);
          pdfOk = !!(rpdf && rpdf.ok);
          if (!pdfOk) pdfErrore = (rpdf && rpdf.errore) || "PDF non creato";
        } else {
          pdfErrore = "Funzione PDF non disponibile";
        }
      } catch(e) { pdfErrore = e.message; console.warn("PDF Desktop preventivo:", e); }

      if (r.ok) {
        if (pdfOk) {
          showToast(`✅ Preventivo NR ${numeroPrenotato} salvato! 📕 PDF anche sul Desktop`, "success", 6000);
        } else {
          showToast(`✅ Preventivo NR ${numeroPrenotato} salvato sul NAS. ⚠️ PDF sul Desktop non creato: ${pdfErrore}`, "warn", 8000);
        }
      } else {
        showToast(`❌ Errore salvataggio: ${r.errore}`, "error");
      }
    } else {
      saveAs(blob, filename);
      showToast(`✅ Preventivo NR ${numeroPrenotato} scaricato`, "success");
    }
  } catch (err) {
    showToast("❌ Errore generazione documento: " + err.message, "error");
    return;
  }

  // Auto-salvo il destinatario nella lista (se nuovo)
  salvaDestinatarioSeNuovo(destinatario);

  // Reset: ricomincio con un'offerta vuota
  resetBlocchiPreventivo();
  aggiornaPrevNumeroUI();
  cancellaBozza();
}

function aggiornaPrevNumeroUI() {
  const n = state.prossimoNumeroPreventivo ?? "—";
  const prev = document.getElementById("prevNumeroPreview");
  const btn = document.getElementById("prevNumeroBtn");
  if (prev) prev.textContent = n;
  if (btn) btn.textContent = `NR ${n}`;
  const card = document.getElementById("prossimoNumeroPreventivoCard");
  if (card) card.textContent = n;
}

// --- STORICO PREVENTIVI ---
function refreshStoricoPreventivi() {
  const tbody = document.getElementById("prevStoricoBody");
  const stats = document.getElementById("prevStoricoStats");
  if (!tbody) return;
  const lista = state.preventiviMese || [];

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Nessun preventivo questo mese.</td></tr>`;
    if (stats) stats.innerHTML = "";
    return;
  }

  const totEuro = lista.reduce((s, p) => s + (p.importo || 0), 0);
  if (stats) stats.innerHTML = `
    <div class="stat">Tot: <strong>${lista.length}</strong></div>
    <div class="stat">Tot importo: <strong>€ ${formatEuro(totEuro)}</strong></div>`;

  tbody.innerHTML = lista.map(p => {
    const ogg = (p.oggetto || "").substring(0, 50) + ((p.oggetto || "").length > 50 ? "…" : "");
    const giaAccettato = p.stato === "accettato";
    const badgeAcc = giaAccettato ? ` <span style="color:#059669;font-weight:700" title="Già accettato">✔</span>` : "";
    return `
    <tr>
      <td><strong>${p.numero}</strong>${badgeAcc}</td>
      <td>${formatDateIt(p.dataDocumento)}</td>
      <td>${escapeHtml(p.destinatario || "—")}</td>
      <td title="${escapeHtml(p.oggetto || "")}">${escapeHtml(ogg)}</td>
      <td>€ ${formatEuro(p.importo)}</td>
      <td>
        <button class="btn-mini" style="background:#059669;color:white" onclick="window.accettaPreventivo('${p.id}', ${p.numero})" title="${giaAccettato ? "Rigenera accettato" : "Segna come accettato"}">✅</button>
        <button class="btn-mini" onclick="window.modificaPreventivo('${p.id}')" title="Modifica">✏️</button>
        <button class="btn-mini" onclick="window.scaricaPreventivo('${p.id}')" title="Scarica">⬇️</button>
        <button class="btn-mini danger" onclick="window.eliminaPreventivo('${p.id}', ${p.numero})" title="Elimina">🗑️</button>
      </td>
    </tr>`;
  }).join("");
}

// Mostra il modal e chiede sezione Excel + mese. Risolve {sezione, mese} o null se annullato.
function chiediSezioneMeseAccetta(numero) {
  return new Promise(resolve => {
    const modal = document.getElementById("modalAccetta");
    const selSez = document.getElementById("modalAccettaSezione");
    const inpMese = document.getElementById("modalAccettaMese");
    const btnOk = document.getElementById("btnModalAccettaOk");
    const btnAnnulla = document.getElementById("btnModalAccettaAnnulla");
    if (!modal || !selSez || !inpMese) { resolve(null); return; }

    document.getElementById("modalAccettaNumero").textContent = `NR ${numero}`;
    selSez.value = "";
    inpMese.value = state.meseCorrente;
    modal.style.display = "flex";

    function chiudi(valore) {
      modal.style.display = "none";
      btnOk.removeEventListener("click", onOk);
      btnAnnulla.removeEventListener("click", onAnnulla);
      resolve(valore);
    }
    function onOk() {
      if (!selSez.value) { showToast("⚠️ Scegli la sezione del file Excel", "warn"); return; }
      if (!inpMese.value) { showToast("⚠️ Scegli il mese", "warn"); return; }
      chiudi({ sezione: selSez.value, mese: inpMese.value });
    }
    function onAnnulla() { chiudi(null); }
    btnOk.addEventListener("click", onOk);
    btnAnnulla.addEventListener("click", onAnnulla);
  });
}

// Segna il preventivo come ACCETTATO: rigenera il docx col timbro verde,
// lo salva nella cartella "Preventivi Accettati" e lo inserisce nel file
// Excel del riepilogo (sezione e mese scelti; se il file non esiste lo crea).
window.accettaPreventivo = async (id, numero) => {
  // Chiedo sezione Excel + mese col dialogo
  const scelta = await chiediSezioneMeseAccetta(numero);
  if (!scelta) return; // annullato

  try {
    const snap = await fb.getDoc(fb.doc(fb.db, "preventivi", id));
    if (!snap.exists()) { showToast("Preventivo non trovato", "error"); return; }
    const p = snap.data();

    // Genero il docx col timbro ACCETTATO
    const { blob, filename } = await buildPreventivoDocx(p, { conTimbroAccettato: true });

    if (state.isElectron && window.electronAPI.salvaPreventivoAccettato) {
      const arr = await blob.arrayBuffer();
      const r = await window.electronAPI.salvaPreventivoAccettato(filename, Array.from(new Uint8Array(arr)));
      if (!r.ok) {
        showToast("⚠️ Errore salvataggio: " + (r.errore || "sconosciuto"), "error");
        return;
      }
      showToast(`✅ Preventivo NR ${numero} ACCETTATO salvato in:\n${r.path}`, "success", 6000);
    } else {
      saveAs(blob, filename);
      showToast(`✅ Preventivo ACCETTATO scaricato`, "success");
    }

    // Segno lo stato + destinazione Excel su Firebase
    await fb.setDoc(fb.doc(fb.db, "preventivi", id), {
      stato: "accettato",
      accettatoIl: new Date().toISOString(),
      excelSezione: scelta.sezione,
      excelMese: scelta.mese
    }, { merge: true });

    // Aggiungo la riga anche nella collection "consuntivi" così appare nella PWA Excel
    const offerte = Array.isArray(p.offerte) && p.offerte.length
      ? p.offerte
      : [{ oggetto: p.oggetto, importo: p.importo }];
    const totalePreventivo = offerte.reduce((s, o) => s + (parseFloat(o.importo) || 0), 0);
    const oggettoPreventivo = (offerte[0] && offerte[0].oggetto) || p.oggetto || "";

    // Prima cancello eventuali righe già esistenti per questo preventivo (evita
    // doppioni se si accetta più volte o si cambia sezione/mese di destinazione).
    const vecchieMesi = new Set();
    try {
      const qVecchie = fb.query(fb.collection(fb.db, "consuntivi"),
                                fb.where("preventivoId", "==", id));
      const snapVecchie = await fb.getDocs(qVecchie);
      for (const d of snapVecchie.docs) {
        const m = d.data().mese;
        if (m) vecchieMesi.add(m);
        await fb.deleteDoc(fb.doc(fb.db, "consuntivi", d.id));
      }
    } catch (e) { console.warn("Pulizia righe preventivo precedenti:", e); }

    await fb.addDoc(fb.collection(fb.db, "consuntivi"), {
      tipo: "cbre",
      mese: scelta.mese,
      sezioneExcel: scelta.sezione,
      sede: p.destinatario || "",
      numero: null,
      origineManuale: true,
      daPreventivo: true,
      preventivoId: id,
      preventivoNumero: numero,
      oggetto: oggettoPreventivo,
      dataIntervento: p.dataDocumento || new Date().toISOString().split("T")[0],
      totale: totalePreventivo,
      statoPagamento: "",
      notaExcel: `PREVENTIVO NR ${numero} ACCETTATO`,
      creatoIl: new Date().toISOString(),
      operatore: state.utenteEmail || "",
    });

    // Se la destinazione è cambiata, rigenero anche il vecchio mese (da template
    // pulito) così la riga sparisce dall'Excel del mese precedente.
    for (const vm of vecchieMesi) {
      if (vm !== scelta.mese) {
        setTimeout(() => { aggiornaExcelMese(vm, true).catch(()=>{}); }, 900);
      }
    }

    // Aggiorno (o creo) il file Excel del mese scelto con la riga del preventivo
    const rExcel = await aggiornaExcelMese(scelta.mese);
    if (rExcel.ok) {
      showToast(`📊 Riga aggiunta all'Excel di ${meseAnnoLabel(scelta.mese)}`, "success", 5000);
    } else if (rExcel.motivo === "file aperto") {
      // showToast già mostrato da aggiornaExcelMese
    } else {
      showToast("⚠️ Excel non aggiornato: " + (rExcel.errore || rExcel.motivo || ""), "warn", 6000);
    }
  } catch (e) {
    showToast("⚠️ Errore: " + e.message, "error");
  }
};

// ============================================================
// RIGHE MANUALI EXCEL (scheda File Excel)
// ============================================================
const NOMI_SEZIONI_EXCEL = {
  bnl: "BNL + FINDOMESTIC",
  torre_diamante: "TORRE DIAMANTE/SMERALDO",
  mediobanca: "MEDIOBANCA + BCC + BENETTON + RMA",
  ceva: "CEVA LOGISTICS",
  bdb: "BDB",
  padovani: "PADOVANI",
  keller: "KELLER"
};

// Copia dei nomi sezione di base (per ricostruire la mappa coi clienti personalizzati)
const BASE_NOMI_SEZIONI_EXCEL = { ...NOMI_SEZIONI_EXCEL };

// ============================================================
// CLIENTI CBRE PERSONALIZZATI
// L'utente può aggiungere nuovi clienti/sezioni dalle Impostazioni.
// Si salvano su Firebase (config/clienti_cbre_custom) e compaiono su tutti i PC.
// Ognuno diventa: una categoria, una voce nella tendina "sezione Excel" e,
// nell'Excel mensile, una sezione propria (gestita in costruisciExcelMese).
// ============================================================

// Applica i clienti personalizzati a tendine e mappe (chiamata dal listener Firebase)
function applicaClientiCustom() {
  const custom = state.clientiCustom || [];

  // 1. Tendina "categoria": ricostruisco da base + personalizzati
  CATEGORIE.cbre = [
    ...BASE_CATEGORIE_CBRE,
    ...custom.map(c => ({ value: c.value, label: c.label, custom: true }))
  ];

  // 2. Mappa nomi sezione (usata nello storico): base + personalizzati
  Object.keys(NOMI_SEZIONI_EXCEL).forEach(k => delete NOMI_SEZIONI_EXCEL[k]);
  Object.assign(NOMI_SEZIONI_EXCEL, BASE_NOMI_SEZIONI_EXCEL);
  custom.forEach(c => { NOMI_SEZIONI_EXCEL[c.value] = c.label; });

  // 3. Tendina "sezione Excel": tolgo le voci personalizzate vecchie e rimetto quelle attuali
  const sel = document.getElementById("sezioneExcel");
  if (sel) {
    Array.from(sel.querySelectorAll('option[data-custom="1"]')).forEach(o => o.remove());
    custom.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.value;
      opt.textContent = "★ " + c.label;
      opt.dataset.custom = "1";
      sel.appendChild(opt);
    });
  }

  // 4. Se la tendina categoria è su CBRE, la rinfresco
  const tipoEl = document.getElementById("tipoConsuntivo");
  if (tipoEl && tipoEl.value === "cbre") aggiornaCategoriePerTipo();

  // 5. Aggiorno la lista nelle Impostazioni
  renderListaClientiCustom();
}

// Aggiunge un cliente personalizzato (salva su Firebase)
async function aggiungiClienteCustom(nome) {
  const label = (nome || "").trim().toUpperCase();
  if (!label) { showToast("Scrivi il nome del cliente", "error"); return; }
  const value = slugCliente(label);
  const esistenti = state.clientiCustom || [];
  // Evito doppioni (stessa chiave o stesso nome) e collisioni coi clienti fissi
  if (BASE_CATEGORIE_CBRE.some(c => c.value === value) || esistenti.some(c => c.value === value)) {
    showToast("Esiste già un cliente con questo nome", "error");
    return;
  }
  const nuovi = [...esistenti, { value, label }];
  try {
    await fb.setDoc(fb.doc(fb.db, "config", "clienti_cbre_custom"), { clienti: nuovi });
    showToast(`Cliente "${label}" aggiunto`, "success");
    const inp = document.getElementById("nuovoClienteCustom");
    if (inp) inp.value = "";
  } catch (e) {
    console.error("Errore aggiunta cliente:", e);
    showToast("Errore nel salvataggio del cliente", "error");
  }
}

// Rimuove un cliente personalizzato (salva su Firebase)
async function rimuoviClienteCustom(value) {
  const cliente = (state.clientiCustom || []).find(c => c.value === value);
  if (!cliente) return;
  const ok = confirm(`Vuoi togliere il cliente "${cliente.label}"?\n\nI consuntivi già fatti restano, ma il cliente non comparirà più nelle tendine.`);
  if (!ok) return;
  const nuovi = (state.clientiCustom || []).filter(c => c.value !== value);
  try {
    await fb.setDoc(fb.doc(fb.db, "config", "clienti_cbre_custom"), { clienti: nuovi });
    showToast(`Cliente "${cliente.label}" rimosso`, "success");
  } catch (e) {
    console.error("Errore rimozione cliente:", e);
    showToast("Errore nella rimozione del cliente", "error");
  }
}

// Disegna la lista dei clienti personalizzati nelle Impostazioni
function renderListaClientiCustom() {
  const cont = document.getElementById("listaClientiCustom");
  if (!cont) return;
  const custom = state.clientiCustom || [];
  if (custom.length === 0) {
    cont.innerHTML = '<p class="hint-vuoto">Nessun cliente personalizzato. Aggiungine uno qui sotto.</p>';
    return;
  }
  cont.innerHTML = custom.map(c =>
    `<div class="cliente-custom-riga">
       <span class="cliente-custom-nome">★ ${escapeHtml(c.label)}</span>
       <button type="button" class="btn-rimuovi-cliente" data-value="${escapeHtml(c.value)}">🗑️ Togli</button>
     </div>`
  ).join("");
  // app.js è un modulo: collego i pulsanti con addEventListener (niente onclick inline)
  cont.querySelectorAll(".btn-rimuovi-cliente").forEach(btn => {
    btn.addEventListener("click", () => rimuoviClienteCustom(btn.dataset.value));
  });
}


function setupRigheManualiExcel() {
  const btn = document.getElementById("btnAggiungiRigaExcel");
  if (!btn) return;
  // Mese di default = mese corrente
  const inpMese = document.getElementById("manMese");
  if (inpMese && !inpMese.value) inpMese.value = state.meseCorrente;

  const btnAnn = document.getElementById("btnAnnullaModificaRigaManuale");
  if (btnAnn) btnAnn.addEventListener("click", annullaModificaRigaManuale);

  // Gestione pulsanti colore
  const COLORI_MAN = {
    "giallo":   { hex: "#E8C84B", label: "Pagato" },
    "azzurro":  { hex: "#BFE3F5", label: "Parz. pagato" },
    "":         { hex: "",        label: "Nessun colore" }
  };
  function aggiornaBottoniColore(valore) {
    ["giallo","azzurro","nessuno"].forEach(k => {
      const b = document.getElementById("manColore" + k.charAt(0).toUpperCase() + k.slice(1));
      if (b) b.style.border = ((valore === k || (k === "nessuno" && valore === "")) ? "3px solid #111" : "1px solid #bbb");
    });
    const label = document.getElementById("manColoreLabel");
    if (label) label.textContent = COLORI_MAN[valore] ? COLORI_MAN[valore].label : "Nessun colore";
    const inp = document.getElementById("manColore");
    if (inp) inp.value = valore;
  }
  aggiornaBottoniColore("");
  document.getElementById("manColoreGiallo")?.addEventListener("click", () => aggiornaBottoniColore("giallo"));
  document.getElementById("manColoreAzzurro")?.addEventListener("click", () => aggiornaBottoniColore("azzurro"));
  document.getElementById("manColoreNessuno")?.addEventListener("click", () => aggiornaBottoniColore(""));

  btn.addEventListener("click", async () => {
    const sezione = document.getElementById("manSezione").value;
    const mese = document.getElementById("manMese").value;
    if (!sezione) { showToast("⚠️ Scegli la sezione del riepilogo", "warn"); return; }
    if (!mese) { showToast("⚠️ Scegli il mese", "warn"); return; }

    const riga = {
      sezioneExcel: sezione,
      excelMese: mese,
      indirizzo: document.getElementById("manIndirizzo").value.trim(),
      numero: document.getElementById("manNumero").value.trim(),
      data: document.getElementById("manData").value.trim(),
      totale: parseFloat(document.getElementById("manTotale").value) || 0,
      odl: document.getElementById("manOdl").value.trim(),
      nota: document.getElementById("manNota").value.trim(),
      colore: document.getElementById("manColore")?.value || "",
      creatoIl: new Date().toISOString()
    };
    if (!riga.indirizzo && !riga.numero && riga.totale === 0) {
      showToast("⚠️ Compila almeno indirizzo, numero o totale", "warn");
      return;
    }

    try {
      const idModifica = state.modificaInCorsoRigaManuale;
      let meseVecchio = null;
      if (idModifica) {
        const orig = (state.righeManualiMese || []).find(r => r.id === idModifica) || {};
        meseVecchio = orig.excelMese || null;
        riga.creatoIl = orig.creatoIl || riga.creatoIl;
        riga.modificatoIl = new Date().toISOString();
        await fb.setDoc(fb.doc(fb.db, "righe_excel_manuali", idModifica), riga);
        showToast("✅ Riga aggiornata. Aggiorno l'Excel...", "success");
      } else {
        await fb.setDoc(fb.doc(fb.collection(fb.db, "righe_excel_manuali")), riga);
        showToast("✅ Riga salvata. Aggiorno l'Excel...", "success");
      }
      // Esco dalla modifica e pulisco i campi (tengo sezione e mese per inserimenti a raffica)
      annullaModificaRigaManuale();
      // Se modificando è cambiato il mese, ricostruisco anche il vecchio (la riga sparisce da lì)
      if (meseVecchio && meseVecchio !== mese) {
        await aggiornaExcelMese(meseVecchio, true);
      }
      // Aggiorno/creo l'Excel del mese scelto (in modifica ricostruisco da template per pulizia)
      const r = await aggiornaExcelMese(mese, !!idModifica);
      if (r.ok) showToast(`📊 Excel di ${meseAnnoLabel(mese)} aggiornato`, "success", 5000);
      else if (r.motivo !== "file aperto") showToast("⚠️ Excel non aggiornato: " + (r.errore || r.motivo || ""), "warn", 6000);
    } catch (e) {
      showToast("⚠️ Errore salvataggio riga: " + e.message, "error");
    }
  });
}

function refreshRigheManuali() {
  const tbody = document.getElementById("righeManualiBody");
  if (!tbody) return;
  const lista = (state.righeManualiMese || []).slice().sort((a,b) =>
    (a.sezioneExcel || "").localeCompare(b.sezioneExcel || ""));
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">Nessuna riga manuale questo mese.</td></tr>`;
    return;
  }
  const COLORI_MAN = {
    "giallo":  { hex: "#E8C84B", label: "Pagato" },
    "azzurro": { hex: "#BFE3F5", label: "Parz. pagato" },
  };
  tbody.innerHTML = lista.map(m => {
    const col = COLORI_MAN[m.colore];
    const sfondo = col ? `style="background:${col.hex}"` : "";
    const pallino = col ? `<span title="${col.label}" style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${col.hex};border:1px solid #aaa;"></span>` : "—";
    return `
    <tr ${sfondo}>
      <td>${escapeHtml(NOMI_SEZIONI_EXCEL[m.sezioneExcel] || m.sezioneExcel || "—")}</td>
      <td>${escapeHtml(m.indirizzo || "—")}</td>
      <td>${escapeHtml(m.numero || "—")}</td>
      <td>${escapeHtml(m.data || "—")}</td>
      <td>€ ${formatEuro(m.totale || 0)}</td>
      <td>${escapeHtml(m.odl || "—")}</td>
      <td style="text-align:center">${pallino}</td>
      <td>
        <button class="btn-mini" onclick="window.modificaRigaManuale('${m.id}')" title="Modifica">✏️</button>
        <button class="btn-mini danger" onclick="window.eliminaRigaManuale('${m.id}')" title="Elimina">🗑️</button>
      </td>
    </tr>`;
  }).join("");
}

window.eliminaRigaManuale = async (id) => {
  if (!confirm("Eliminare questa riga manuale dall'Excel?")) return;
  try {
    const mese = (state.righeManualiMese.find(r => r.id === id) || {}).excelMese || state.meseCorrente;
    await fb.deleteDoc(fb.doc(fb.db, "righe_excel_manuali", id));
    showToast("🗑️ Riga eliminata. Aggiorno l'Excel...", "success");
    await aggiornaExcelMese(mese, true); // ricostruisco da template: così la riga eliminata sparisce davvero dall'Excel
  } catch (e) {
    showToast("⚠️ Errore: " + e.message, "error");
  }
};

function annullaModificaRigaManuale() {
  state.modificaInCorsoRigaManuale = null;
  const btn = document.getElementById("btnAggiungiRigaExcel");
  if (btn) btn.innerHTML = "➕ Aggiungi riga all'Excel";
  const btnAnn = document.getElementById("btnAnnullaModificaRigaManuale");
  if (btnAnn) btnAnn.classList.add("hidden");
  ["manIndirizzo","manNumero","manData","manTotale","manOdl","manNota"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  // Reset colore
  const inpCol = document.getElementById("manColore");
  if (inpCol) inpCol.value = "";
  ["Giallo","Azzurro","Nessuno"].forEach(k => {
    const b = document.getElementById("manColore" + k);
    if (b) b.style.border = k === "Nessuno" ? "3px solid #111" : "1px solid #bbb";
  });
  const label = document.getElementById("manColoreLabel");
  if (label) label.textContent = "Nessun colore";
}

window.modificaRigaManuale = (id) => {
  const m = (state.righeManualiMese || []).find(r => r.id === id);
  if (!m) { showToast("Riga non trovata", "error"); return; }
  document.getElementById("manSezione").value = m.sezioneExcel || "";
  document.getElementById("manMese").value = m.excelMese || state.meseCorrente;
  document.getElementById("manIndirizzo").value = m.indirizzo || "";
  document.getElementById("manNumero").value = m.numero || "";
  document.getElementById("manData").value = m.data || "";
  document.getElementById("manTotale").value = (m.totale != null ? m.totale : "");
  document.getElementById("manOdl").value = m.odl || "";
  document.getElementById("manNota").value = m.nota || "";
  // Ripristina colore
  const coloreVal = m.colore || "";
  const inpCol = document.getElementById("manColore");
  if (inpCol) inpCol.value = coloreVal;
  ["giallo","azzurro","nessuno"].forEach(k => {
    const b = document.getElementById("manColore" + k.charAt(0).toUpperCase() + k.slice(1));
    if (b) b.style.border = ((coloreVal === k || (k === "nessuno" && coloreVal === "")) ? "3px solid #111" : "1px solid #bbb");
  });
  const label = document.getElementById("manColoreLabel");
  if (label) label.textContent = coloreVal === "giallo" ? "Pagato" : coloreVal === "azzurro" ? "Parz. pagato" : "Nessun colore";
  state.modificaInCorsoRigaManuale = id;
  const btn = document.getElementById("btnAggiungiRigaExcel");
  if (btn) btn.innerHTML = "💾 Salva modifiche";
  const btnAnn = document.getElementById("btnAnnullaModificaRigaManuale");
  if (btnAnn) btnAnn.classList.remove("hidden");
  const anchor = document.getElementById("manSezione");
  if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("✏️ Stai modificando una riga manuale", "info", 4000);
};

window.modificaPreventivo = async (id) => {
  const snap = await fb.getDoc(fb.doc(fb.db, "preventivi", id));
  if (!snap.exists()) { showToast("Preventivo non trovato", "error"); return; }
  const p = snap.data();
  document.getElementById("prevDestinatario").value = p.destinatario || "";
  document.getElementById("prevData").value = p.dataDocumento || "";
  // Ricostruisco i blocchi offerta (array nuovo, o singola offerta per i preventivi vecchi)
  const contMod = document.getElementById("prevBlocchi");
  if (contMod) contMod.innerHTML = "";
  const offerteMod = (Array.isArray(p.offerte) && p.offerte.length)
    ? p.offerte
    : [{ oggetto: p.oggetto || "", elenco: p.elenco || "", importo: p.importo || "", pagamenti: p.pagamenti || "" }];
  offerteMod.forEach(o => aggiungiBloccoPreventivo(o));
  state.modificaInCorsoPrev = { id, numero: p.numero };
  const btnAnn = document.getElementById("btnAnnullaModificaPrev");
  if (btnAnn) btnAnn.classList.remove("hidden");
  document.getElementById("prevDestinatario").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(`✏️ Stai modificando il preventivo NR ${p.numero}`, "info", 4000);
};

window.scaricaPreventivo = async (id) => {
  const snap = await fb.getDoc(fb.doc(fb.db, "preventivi", id));
  if (!snap.exists()) { showToast("Preventivo non trovato", "error"); return; }
  const p = snap.data();
  try {
    const { blob, filename } = await buildPreventivoDocx(p);
    if (state.isElectron) {
      const arr = await blob.arrayBuffer();
      await window.electronAPI.salvaPreventivo(filename, Array.from(new Uint8Array(arr)));
      showToast(`✅ Preventivo NR ${p.numero} rigenerato`, "success");
    } else {
      saveAs(blob, filename);
      showToast(`✅ Scaricato`, "success");
    }
  } catch (e) { showToast("⚠️ Errore: " + e.message, "error"); }
};

window.eliminaPreventivo = async (id, numero) => {
  if (!confirm(`Eliminare il preventivo NR ${numero}?\n\nVerranno eliminati:\n• La riga dall'archivio\n• Il file .docx salvato\n• La riga dall'Excel (se era accettato)\n\nL'operazione non è reversibile.`)) return;
  // Leggo i dati prima di cancellare
  let dati = null;
  try {
    const snap = await fb.getDoc(fb.doc(fb.db, "preventivi", id));
    if (snap.exists()) dati = snap.data();
  } catch (e) { console.warn("Lettura preventivo pre-eliminazione:", e); }

  try {
    await fb.deleteDoc(fb.doc(fb.db, "preventivi", id));
  } catch (e) { showToast("⚠️ Errore: " + e.message, "error"); return; }

  // Cancello anche la riga creata in "consuntivi" quando il preventivo era stato
  // accettato (campo daPreventivo:true + preventivoId). Senza questo la riga
  // "PREVENTIVO NR X ACCETTATO" resterebbe nell'Excel e nella PWA.
  try {
    const qC = fb.query(fb.collection(fb.db, "consuntivi"),
                        fb.where("preventivoId", "==", id));
    const snapC = await fb.getDocs(qC);
    for (const d of snapC.docs) {
      await fb.deleteDoc(fb.doc(fb.db, "consuntivi", d.id));
    }
  } catch (e) { console.warn("Eliminazione riga consuntivi del preventivo:", e); }

  // Cancello il file .docx
  let fileMsg = "";
  if (state.isElectron && dati && window.electronAPI.eliminaFileConsuntivo) {
    try {
      const oggettoFile = (dati.oggetto || "preventivo").substring(0, 40).replace(/[/\\?%*:|"<>]/g, "");
      const filenameDocx = `PREVENTIVO NR ${numero} ${oggettoFile}.docx`;
      const mese = dati.mese || (dati.dataDocumento ? dati.dataDocumento.substring(0,7) : state.meseCorrente);
      const r = await window.electronAPI.eliminaFileConsuntivo("preventivo", mese, filenameDocx);
      if (r.ok && r.trovatoQualcosa) fileMsg = " (file eliminato)";
      else fileMsg = " — ⚠️ file non trovato, cancellalo a mano";
    } catch (e) { console.warn("Eliminazione file preventivo:", e); }
  }

  // Se era accettato, rigenero l'Excel del mese di destinazione da template
  // PULITO (forzaRicostruzione=true) così la riga del preventivo sparisce davvero.
  if (dati && dati.excelMese) {
    setTimeout(() => { aggiornaExcelMese(dati.excelMese, true).catch(()=>{}); }, 700);
  }

  showToast(`🗑️ Preventivo NR ${numero} eliminato${fileMsg}`, "success", 6000);
};

function annullaModificaPreventivo() {
  state.modificaInCorsoPrev = null;
  const btnAnn = document.getElementById("btnAnnullaModificaPrev");
  if (btnAnn) btnAnn.classList.add("hidden");
  resetBlocchiPreventivo();
  showToast("Modifica annullata.", "info");
}

// ============================================================
// DUSSMANN (consuntivi per Dussmann Service - Distacco/Servizio)
// ============================================================
function aggiornaDussNumeroUI() {
  const gruppoSel = document.getElementById("dussGruppo");
  const gruppo = gruppoSel ? gruppoSel.value : "NHOOD";
  const key = DUSS_GRUPPO_KEY[gruppo] || "nhood";
  const n = (state.prossimoNumeroDussmann && state.prossimoNumeroDussmann[key]) ?? "—";
  const prev = document.getElementById("dussNumeroPreview");
  const btn = document.getElementById("dussNumeroBtn");
  if (prev) prev.textContent = n;
  if (btn) btn.textContent = `NR ${n}`;
  // Card unica DUSSMANN in alto: mostra il prossimo numero (contatore unico).
  const cN = document.getElementById("cardDussNhood");
  const numeroUnico = state.prossimoNumeroDussmann.unico
    ?? state.prossimoNumeroDussmann.nhood
    ?? "—";
  if (cN) cN.textContent = numeroUnico;
}

function setupDussmannTab() {
  const form = document.getElementById("formDussmann");
  if (!form) return;

  // Data di default = oggi
  const dataField = document.getElementById("dussData");
  if (dataField) dataField.value = new Date().toISOString().split("T")[0];

  // Cambio tipo: mostro/nascondo i campi giusti + ricompongo l'oggetto
  const tipoSel = document.getElementById("dussTipo");
  tipoSel.addEventListener("change", () => { aggiornaCampiDussmann(); precompilaOggettoDussmann(); });
  aggiornaCampiDussmann();

  // Cambio gruppo: ricompongo l'oggetto col modello giusto + aggiorno il numero
  const gruppoSel = document.getElementById("dussGruppo");
  if (gruppoSel) gruppoSel.addEventListener("change", () => {
    compilaDestinatarioSeEni();
    aggiornaVisibilitaOperaioEdile();
    precompilaOggettoDussmann();
    aggiornaDussNumeroUI();
  });

  // Menu operaio EDILE: quando cambia, aggiorno l'oggetto col nome scelto
  const operaioSel = document.getElementById("dussOperaioEdile");
  if (operaioSel) operaioSel.addEventListener("change", () => {
    const inputAltro = document.getElementById("dussOperaioEdileAltro");
    if (operaioSel.value === "__ALTRO__") {
      if (inputAltro) { inputAltro.style.display = ""; inputAltro.focus(); }
    } else {
      if (inputAltro) inputAltro.style.display = "none";
      applicaOperaioEdileAOggetto();
    }
  });
  const operaioAltro = document.getElementById("dussOperaioEdileAltro");
  if (operaioAltro) operaioAltro.addEventListener("input", () => applicaOperaioEdileAOggetto());

  // Ricalcolo automatico su tutti i campi numerici
  const campiCalcolo = ["dussOre","dussRetribuzione","dussTredicesima","dussFestivita",
    "dussExFestivita","dussTfr","dussAddInail","dussInail","dussInps","dussTrattenute",
    "dussCostoDistacco","dussCostoPattuito"];
  campiCalcolo.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", ricalcolaDussmann);
  });

  form.addEventListener("submit", (e) => { e.preventDefault(); generaDussmann(); });

  const btnAnnulla = document.getElementById("btnAnnullaModificaDuss");
  if (btnAnnulla) btnAnnulla.addEventListener("click", annullaModificaDussmann);

  const tendinaDest = document.getElementById("dussDestinatariSalvati");
  if (tendinaDest) {
    tendinaDest.addEventListener("change", () => {
      if (tendinaDest.value) {
        document.getElementById("dussDestinatario").value = tendinaDest.value;
        tendinaDest.selectedIndex = 0;
      }
    });
  }

  const btnVoce = document.getElementById("btnAggiungiVoceRimborso");
  if (btnVoce) btnVoce.addEventListener("click", () => aggiungiVoceRimborso());

  ricalcolaDussmann();
  aggiornaVisibilitaOperaioEdile();
  precompilaOggettoDussmann();
}

function aggiornaCampiDussmann() {
  const tipo = document.getElementById("dussTipo").value;
  document.getElementById("dussDistaccoFields").style.display = (tipo === "distacco") ? "" : "none";
  document.getElementById("dussServizioFields").style.display = (tipo === "servizio") ? "" : "none";
  const rimb = document.getElementById("dussRimborsoFields");
  if (rimb) rimb.style.display = (tipo === "rimborso") ? "" : "none";
  // Nel rimborso le ore non servono (è una somma di voci, non ore × tariffa)
  const oreWrap = document.getElementById("dussOreWrap");
  if (oreWrap) oreWrap.style.display = (tipo === "rimborso") ? "none" : "";
  // Alla prima apertura del rimborso creo una riga vuota da compilare
  if (tipo === "rimborso") {
    const cont = document.getElementById("dussRigheRimborso");
    if (cont && cont.children.length === 0) aggiungiVoceRimborso();
  }
  ricalcolaDussmann();
}

// Precompila il campo Oggetto in base a gruppo + tipo scelti.
// Il testo resta modificabile. Non sovrascrive se l'utente ha già scritto qualcosa
// di personalizzato (a meno che il campo sia vuoto o contenga un modello precedente).
const MODELLI_OGGETTO_DUSSMANN = {
  "NHOOD": {
    distacco: "CONTABILITA' CONSUNTIVO QUOTA DISTACCO ATTIVITA' DI SERVIZIO DI MANUTENZIONE E CONDUZIONE VARIE NS TECNICO HURZHUY IVAN RIF. VS COMMESSA NHOOD NR ___ PRESIDIO CC ___ DAL ___ AL ___",
    servizio: "CONTABILITA' CONSUNTIVO QUOTA DI SERVIZIO ATTIVITA' DI MANUTENZIONE E CONDUZIONE VARIE NS TECNICO HURZHUY IVAN RIF. VS COMMESSA NHOOD NR ___ CC ___ DAL ___ AL ___"
  },
  "ENI / GI.L.C.": {
    distacco: "CONTABILITA' CONSUNTIVO QUOTA DISTACCO PERSONALE BRUSENKO VALENTYN ATTIVITA' DI MANUTENZIONE E CONDUZIONE IMPIANTI MECCANICI/TECNOLOGICI PRESSO LA SEDE DI ENI SAN DONATO MILANESE 2° PALAZZO IN PIAZZA BOLDRINI,1 MESE DI ___",
    servizio: "CONTABILITA' CONSUNTIVO QUOTA SERVIZIO BRUSENKO VALENTYN ATTIVITA' DI MANUTENZIONE E CONDUZIONE IMPIANTI MECCANICI/TECNOLOGICI PRESSO LA SEDE DI ENI SAN DONATO MILANESE 2° PALAZZO IN PIAZZA BOLDRINI,1 MESE DI ___"
  },
  "RAI VIA MECENATE": {
    distacco: "CONTABILITA' CONSUNTIVO QUOTA DISTACCO PERSONALE CASCIELLO PIETRO ATTIVITA' DI MANUTENZIONE E CONDUZIONE IMPIANTI ELETTRICI PRESSO LA SEDE RAI DI VIA MECENATE, 10 MILANO RIF. VS COMMESSA NR 410 MESE DI ___",
    servizio: "CONTABILITA' CONSUNTIVO QUOTA SERVIZIO CASCIELLO PIETRO ATTIVITA' DI MANUTENZIONE E CONDUZIONE IMPIANTI ELETTRICI PRESSO LA SEDE RAI DI VIA MECENATE, 10 MILANO RIF. VS COMMESSA NR 410 MESE DI ___"
  },
  "SQUADRA EDILE": {
    distacco: "CONTABILITA' CONSUNTIVO QUOTA DISTACCO PERSONALE TECNICO NOME COGNOME ATTIVITA' DI MANUTENZIONE /RIPARZIONE/RIPRISTINO EDILE PRESSO LE DIVERSE SEDI FIBERCOP SITE IN LOMBARDIA ESEGUITE NEL MESE DI ___",
    servizio: "CONTABILITA' CONSUNTIVO QUOTA DI SERVIZIO TECNICO NOME COGNOME ATTIVITA' DI MANUTENZIONE /RIPARZIONE/RIPRISTINO EDILE PRESSO LE DIVERSE SEDI FIBERCOP SITE IN LOMBARDIA ESEGUITE NEL MESE DI ___"
  },
  "SQUADRA IMPIANTISTICA": {
    distacco: "CONTABILITA' CONSUNTIVO QUOTA DISTACCO PERSONALE TECNICO NOME COGNOME ATTIVITA' DI MANUTENZIONE E CONDUZIONE IMPIANTI ___ PRESSO LE DIVERSE SEDI FIBERCOP SITE IN LOMBARDIA ESEGUITE NEL MESE DI ___",
    servizio: "CONTABILITA' CONSUNTIVO QUOTA DI SERVIZIO TECNICO NOME COGNOME ATTIVITA' DI MANUTENZIONE E CONDUZIONE IMPIANTI ___ PRESSO LE DIVERSE SEDI FIBERCOP SITE IN LOMBARDIA ESEGUITE NEL MESE DI ___"
  }
};

// Raccolgo tutti i modelli in un set per riconoscere se il testo attuale è un modello (non personalizzato)
function _tuttiModelliOggetto() {
  const arr = [];
  for (const g of Object.keys(MODELLI_OGGETTO_DUSSMANN)) {
    arr.push(MODELLI_OGGETTO_DUSSMANN[g].distacco, MODELLI_OGGETTO_DUSSMANN[g].servizio);
  }
  return arr;
}

// Quando il gruppo è "ENI / GI.L.C.", compilo automaticamente il destinatario
// con i dati fissi di GI.L.C. IMPIANTI SRL (così il consuntivo va nella cartella
// ENI e l'intestazione è corretta). Il campo resta comunque modificabile.
// Operai per gruppo (menu a tendina). Si possono aggiungere altri nomi qui.
const OPERAI_PER_GRUPPO = {
  "SQUADRA EDILE": ["NICOLA SCIARRA", "EL MALKI AHMED"],
  "SQUADRA IMPIANTISTICA": ["ERION DORACI", "SIDHON BISHOUNADI"]
};

// Mostra/nasconde e popola il menu operaio in base al gruppo selezionato.
// Vale per SQUADRA EDILE e SQUADRA IMPIANTISTICA (operaio scelto da tendina).
function aggiornaVisibilitaOperaioEdile() {
  const gruppo = document.getElementById("dussGruppo").value;
  const riga = document.getElementById("rigaOperaioEdile");
  const sel = document.getElementById("dussOperaioEdile");
  const label = document.getElementById("labelOperaioMenu");
  const inputAltro = document.getElementById("dussOperaioEdileAltro");
  if (!riga || !sel) return;

  const operai = OPERAI_PER_GRUPPO[gruppo];
  if (operai) {
    riga.style.display = "";
    if (label) label.textContent = `Operaio ${gruppo === "SQUADRA EDILE" ? "EDILE" : "IMPIANTISTICA"} (si inserisce nell'oggetto)`;
    // Ripopolo le opzioni col set giusto di operai
    sel.innerHTML = operai.map(n => `<option value="${n}">${n}</option>`).join("")
      + `<option value="__ALTRO__">Altro... (scrivi tu)</option>`;
    if (inputAltro) { inputAltro.style.display = "none"; inputAltro.value = ""; }
  } else {
    riga.style.display = "none";
  }
}

// Restituisce il nome operaio EDILE attualmente scelto (dal menu o dalla casella "Altro")
function operaioEdileScelto() {
  const sel = document.getElementById("dussOperaioEdile");
  if (!sel) return "";
  if (sel.value === "__ALTRO__") {
    const altro = document.getElementById("dussOperaioEdileAltro");
    return (altro && altro.value || "").trim().toUpperCase();
  }
  return sel.value;
}

// Inserisce il nome dell'operaio EDILE nell'oggetto, al posto del segnaposto
// "NOME COGNOME" oppure di un nome operaio inserito in precedenza.
function applicaOperaioEdileAOggetto() {
  const campo = document.getElementById("dussOggetto");
  if (!campo) return;
  if (state.modificaInCorsoDuss) return;
  const nome = operaioEdileScelto();
  if (!nome) return;
  let testo = campo.value || "";

  // Caso 1: c'è ancora il segnaposto NOME COGNOME → lo sostituisco
  if (testo.includes("NOME COGNOME")) {
    testo = testo.replace(/NOME COGNOME/g, nome);
  } else {
    // Caso 2: era già stato messo un operaio (Sciarra/El Malki o altro). Lo sostituisco
    // col nuovo. Riconosco lo schema "TECNICO <NOME> ATTIVITA'".
    const m = testo.match(/TECNICO\s+(.+?)\s+ATTIVITA/i);
    if (m && m[1]) {
      testo = testo.replace(m[1], nome);
    }
  }
  campo.value = testo;
}

function compilaDestinatarioSeEni() {
  const gruppo = document.getElementById("dussGruppo").value;
  const campoDest = document.getElementById("dussDestinatario");
  if (!campoDest) return;
  if (state.modificaInCorsoDuss) return;
  const DEST_GILC = "GI.L.C. IMPIANTI SRL\nVIA FRATELLI DI DIO,2 B\n20063 CERNUSCO SUL NAVIGLIO (MI)\nP.IVA 11174510153";
  const DEST_DUSSMANN = "DUSSMANN SERVICE SRL\nVIA SAN GREGORIO,55\n20124 MILANO (MI)\nP.IVA 00124140211";
  const attuale = (campoDest.value || "").trim();
  if (gruppo === "ENI / GI.L.C.") {
    // Compilo GI.L.C. se il campo è vuoto o conteneva il destinatario Dussmann standard
    if (attuale === "" || attuale === DEST_DUSSMANN.trim() || attuale.toUpperCase().includes("DUSSMANN")) {
      campoDest.value = DEST_GILC;
    }
  } else {
    // Tornando a un gruppo non-ENI, se c'era GI.L.C. rimetto Dussmann standard
    if (attuale.toUpperCase().replace(/[\s.]/g, "").includes("GILCIMPIANTI")) {
      campoDest.value = DEST_DUSSMANN;
    }
  }
}

function precompilaOggettoDussmann() {
  const gruppo = document.getElementById("dussGruppo").value;
  const tipo = document.getElementById("dussTipo").value;
  const campo = document.getElementById("dussOggetto");
  if (!campo) return;
  if (state.modificaInCorsoDuss) return; // in modifica non tocco l'oggetto salvato

  const nuovo = (MODELLI_OGGETTO_DUSSMANN[gruppo] && MODELLI_OGGETTO_DUSSMANN[gruppo][tipo]) || "";
  const attuale = (campo.value || "").trim();

  // Precompilo SOLO se il campo è vuoto o contiene ancora uno dei modelli
  // (così non cancello un oggetto che l'utente ha personalizzato a mano)
  if (nuovo && (attuale === "" || _tuttiModelliOggetto().some(m => m.trim() === attuale))) {
    campo.value = nuovo;
  }

  // Per i gruppi con menu operaio (EDILE e IMPIANTISTICA), inserisco subito il
  // nome dell'operaio scelto nel menu al posto di "NOME COGNOME".
  if (OPERAI_PER_GRUPPO[gruppo]) {
    applicaOperaioEdileAOggetto();
  }
}

// --- RIMBORSO: righe dinamiche (descrizione + importo) ---
function aggiungiVoceRimborso(descrizione = "", importo = "") {
  const cont = document.getElementById("dussRigheRimborso");
  if (!cont) return;
  const div = document.createElement("div");
  div.className = "form-row riga-rimborso";
  div.innerHTML = `
    <div class="form-field" style="flex:3">
      <textarea class="rimb-desc" rows="2" placeholder="Descrizione voce (es. Nolo attrezzatura per lavaggio impianto)"></textarea>
    </div>
    <div class="form-field" style="flex:1;max-width:150px">
      <input type="number" class="rimb-importo" step="0.01" placeholder="€ importo">
    </div>
    <div class="form-field" style="flex:0;display:flex;align-items:flex-end">
      <button type="button" class="btn btn-secondary rimb-rimuovi" title="Rimuovi voce" style="background:#ef4444;color:white">✖</button>
    </div>`;
  cont.appendChild(div);
  div.querySelector(".rimb-desc").value = descrizione;
  div.querySelector(".rimb-importo").value = importo;
  div.querySelector(".rimb-importo").addEventListener("input", ricalcolaDussmann);
  div.querySelector(".rimb-rimuovi").addEventListener("click", () => { div.remove(); ricalcolaDussmann(); });
  ricalcolaDussmann();
}
function leggiRigheRimborso() {
  return Array.from(document.querySelectorAll("#dussRigheRimborso .riga-rimborso")).map(r => ({
    descrizione: (r.querySelector(".rimb-desc").value || "").trim(),
    importo: parseFloat(r.querySelector(".rimb-importo").value) || 0
  })).filter(v => v.descrizione || v.importo);
}

function ricalcolaDussmann() {
  const tipo = document.getElementById("dussTipo").value;
  const ore = parseFloat(document.getElementById("dussOre").value) || 0;
  let totale = 0;

  if (tipo === "distacco") {
    const v = (id) => parseFloat(document.getElementById(id).value) || 0;
    const costoOrario = v("dussRetribuzione") + v("dussTredicesima") + v("dussFestivita") +
      v("dussExFestivita") + v("dussTfr") + v("dussAddInail") + v("dussInail") +
      v("dussInps") + v("dussTrattenute");
    document.getElementById("dussCostoOrario").value = formatEuro(costoOrario);
    totale = ore * costoOrario;
  } else if (tipo === "rimborso") {
    totale = leggiRigheRimborso().reduce((s, voce) => s + voce.importo, 0);
  } else {
    const distacco = parseFloat(document.getElementById("dussCostoDistacco").value) || 0;
    const pattuito = parseFloat(document.getElementById("dussCostoPattuito").value) || 0;
    const quota = pattuito - distacco;
    document.getElementById("dussQuota").value = formatEuro(quota);
    totale = ore * quota;
  }
  document.getElementById("dussTotale").value = formatEuro(totale);
  return totale;
}

// Prenota un numero DUSSMANN (incrementa il contatore su Firebase)
async function prenotaNumeroDussmann(gruppo) {
  // In MODALITÀ TEST restituisco un numero finto senza toccare Firebase
  // (così la prova funziona e il contatore vero non avanza).
  if (state.modalitaTest) {
    return state.prossimoNumeroDussmann.unico || 999;
  }
  // NUMERO UNICO: un solo contatore progressivo condiviso da TUTTI i gruppi
  // (NHOOD, SQUADRA EDILE, SQUADRA IMPIANTISTICA e GI.L.C./ENI). Non più separato
  // per gruppo. Uso il documento "contatore_dussmann_unico".
  const docRef = fb.doc(fb.db, "config", "contatore_dussmann_unico");
  const snap = await fb.getDoc(docRef);
  let nuovo;
  if (snap.exists()) {
    nuovo = (snap.data().ultimoNumero || 0) + 1;
  } else {
    // Prima volta: parto dal massimo tra i vecchi contatori per gruppo (così non
    // ricomincio da 1 sovrascrivendo numeri già usati) oppure da 1.
    let maxEsistente = 0;
    for (const key of ["nhood", "edile", "impiantistica"]) {
      try {
        const s = await fb.getDoc(fb.doc(fb.db, "config", dussContatoreDocId(key)));
        if (s.exists() && (s.data().ultimoNumero || 0) > maxEsistente) {
          maxEsistente = s.data().ultimoNumero;
        }
      } catch (e) {}
    }
    nuovo = maxEsistente + 1;
  }
  await fb.setDoc(docRef, { ultimoNumero: nuovo }, { merge: true });
  return nuovo;
}

function costruisciDussmannDaForm(numero) {
  const tipo = document.getElementById("dussTipo").value;
  const dataDoc = document.getElementById("dussData").value;
  const anno = dataDoc ? dataDoc.split("-")[0] : new Date().getFullYear();
  const v = (id) => parseFloat(document.getElementById(id).value) || 0;
  const t = (id) => (document.getElementById(id).value || "").trim();

  const c = {
    tipo: "dussmann",
    sottoTipo: tipo,
    gruppo: (document.getElementById("dussGruppo").value || "NHOOD"),
    numero,
    anno: String(anno),
    dataDocumento: dataDoc,
    periodo: t("dussPeriodo"),
    oggetto: t("dussOggetto"),
    destinatario: t("dussDestinatario"),
    ore: v("dussOre"),
    pagamenti: t("dussPagamenti"),
    mese: getMonthFromDate(dataDoc),
    creatoIl: new Date().toISOString()
  };

  if (tipo === "distacco") {
    c.retribuzione = v("dussRetribuzione");
    c.tredicesima = v("dussTredicesima");
    c.festivita = v("dussFestivita");
    c.exFestivita = v("dussExFestivita");
    c.tfr = v("dussTfr");
    c.addInail = v("dussAddInail");
    c.inail = v("dussInail");
    c.inps = v("dussInps");
    c.trattenute = v("dussTrattenute");
    c.costoOrario = c.retribuzione + c.tredicesima + c.festivita + c.exFestivita +
      c.tfr + c.addInail + c.inail + c.inps + c.trattenute;
    c.totale = c.ore * c.costoOrario;
  } else if (tipo === "rimborso") {
    c.righe = leggiRigheRimborso();
    c.totale = c.righe.reduce((s, voce) => s + voce.importo, 0);
    c.ore = 0;
  } else {
    c.costoDistacco = v("dussCostoDistacco");
    c.costoPattuito = v("dussCostoPattuito");
    c.quota = c.costoPattuito - c.costoDistacco;
    c.totale = c.ore * c.quota;
  }
  return c;
}

async function generaDussmann() {
  const tipo = document.getElementById("dussTipo").value;
  if (!document.getElementById("dussOggetto").value.trim()) {
    showToast("⚠️ Scrivi l'oggetto del consuntivo", "warn");
    return;
  }
  if (tipo === "rimborso") {
    if (leggiRigheRimborso().length === 0) {
      showToast("⚠️ Aggiungi almeno una voce al rimborso", "warn");
      return;
    }
  } else if (!(parseFloat(document.getElementById("dussOre").value) > 0)) {
    showToast("⚠️ Inserisci le ore", "warn");
    return;
  }

  // MODIFICA in corso?
  if (state.modificaInCorsoDuss) {
    const mod = state.modificaInCorsoDuss;
    const c = costruisciDussmannDaForm(mod.numero);
    c.modificatoIl = new Date().toISOString();
    try {
      await fb.setDoc(fb.doc(fb.db, "dussmann", mod.id), c, { merge: true });
      await buildAndSaveDussmann(c);
      showToast(`✅ DUSSMANN NR ${mod.numero} modificato`, "success", 5000);
    } catch (err) {
      showToast("❌ Errore modifica: " + err.message, "error");
      return;
    }
    state.modificaInCorsoDuss = null;
    document.getElementById("btnAnnullaModificaDuss").classList.add("hidden");
    document.getElementById("formDussmann").reset();
    { const _cr = document.getElementById("dussRigheRimborso"); if (_cr) _cr.innerHTML = ""; }
    aggiornaCampiDussmann();
    aggiornaDussNumeroUI();
    cancellaBozza();
    return;
  }

  // NUOVO
  const gruppoSel = document.getElementById("dussGruppo").value;
  let numero;
  try {
    numero = await prenotaNumeroDussmann(gruppoSel);
  } catch (err) {
    showToast("❌ Errore nel prenotare il numero: " + err.message, "error");
    return;
  }

  const c = costruisciDussmannDaForm(numero);
  try {
    // Salvo su Firebase
    const id = `dussmann_${numero}_${Date.now()}`;
    await fb.setDoc(fb.doc(fb.db, "dussmann", id), c);
    // Genero e salvo il documento
    await buildAndSaveDussmann(c);
    showToast(`✅ DUSSMANN NR ${numero} (${tipo}) creato e salvato`, "success", 5000);
  } catch (err) {
    console.error(err);
    showToast("⚠️ Errore: " + err.message, "error");
    return;
  }

  // Reset (tengo tipo e data per comodità)
  const tipoMemo = document.getElementById("dussTipo").value;
  const dataMemo = document.getElementById("dussData").value;
  document.getElementById("formDussmann").reset();
  { const _cr = document.getElementById("dussRigheRimborso"); if (_cr) _cr.innerHTML = ""; }
  document.getElementById("dussTipo").value = tipoMemo;
  document.getElementById("dussData").value = dataMemo;
  aggiornaCampiDussmann();
  aggiornaDussNumeroUI();
  ricalcolaDussmann();
  precompilaOggettoDussmann();
  cancellaBozza();
}

// Costruisce il .docx DUSSMANN e lo salva (NAS + PDF desktop), riusa l'handler consuntivi
// Determina la SOTTOCARTELLA FISICA dove va il consuntivo Dussmann, secondo la
// struttura standard: DUSSMANN GAMA / AAAA / MM_MESE_AAAA / SOTTOCARTELLA.
// Le 6 sottocartelle fisiche (sempre MAIUSCOLE, nomi esatti) sono:
//   ENI, NHOOD ORDINARIA + EXTRA, RAI VIA MECENATE, RIMBORSO,
//   SQUADRA EDILE, SQUADRA IMPIANTISTICA
// Ordine di priorità del riconoscimento:
//   1. RIMBORSO  → se il consuntivo è di tipo rimborso (qualsiasi gruppo)
//   2. ENI       → se il destinatario è GI.L.C. IMPIANTI SRL
//   3. RAI VIA MECENATE → se l'oggetto cita RAI di Via Mecenate
//   4. NHOOD ORDINARIA + EXTRA / SQUADRA EDILE / SQUADRA IMPIANTISTICA → dal gruppo
function determinaSottoCartellaDussmann(c) {
  const oggetto = (c.oggetto || "").toUpperCase();
  const destNorm = (c.destinatario || "").toUpperCase().replace(/[\s.]/g, "");
  const sottoTipo = c.sottoTipo || "";

  // 1. RIMBORSO ha priorità assoluta
  if (sottoTipo === "rimborso") return "RIMBORSO";

  // 2. GI.L.C. IMPIANTI SRL → ENI (riconosciuto dal gruppo o dal destinatario)
  const gruppoRaw = (c.gruppo || "").toUpperCase();
  if (gruppoRaw.includes("ENI") || gruppoRaw.includes("GILC") || gruppoRaw.includes("GI.L.C")) return "ENI";
  if (destNorm.includes("GILCIMPIANTI") || destNorm.includes("GILC")) return "ENI";

  // 3. RAI VIA MECENATE: riconosco dal gruppo o dall'oggetto (cita RAI + MECENATE)
  if (gruppoRaw.includes("RAI")) return "RAI VIA MECENATE";
  if (oggetto.includes("RAI") && oggetto.includes("MECENATE")) return "RAI VIA MECENATE";

  // 4. In base al gruppo del gestionale → nome cartella fisico
  const gruppo = (c.gruppo || "NHOOD").toUpperCase();
  if (gruppo.includes("NHOOD")) return "NHOOD ORDINARIA + EXTRA";
  if (gruppo.includes("EDILE")) return "SQUADRA EDILE";
  if (gruppo.includes("IMPIANTISTICA")) return "SQUADRA IMPIANTISTICA";

  // Ripiego di sicurezza
  return "NHOOD ORDINARIA + EXTRA";
}

async function buildAndSaveDussmann(c) {
  // Salvo il destinatario nella lista condivisa (se nuovo), come per i preventivi
  if (c.destinatario && c.destinatario.trim()) salvaDestinatarioSeNuovo(c.destinatario.trim());
  const { blob, filename } = await buildDocxDussmann(c);

  // Calcolo la sottocartella fisica secondo la struttura DUSSMANN GAMA standard
  const sottoCartella = determinaSottoCartellaDussmann(c);

  if (state.isElectron && window.electronAPI.salvaDussmannPersonalizzato) {
    // Cartella di default proposta: DUSSMANN GAMA / AAAA / MESE / SOTTOCARTELLA
    // dentro la cartella root configurata.
    const anno = (c.mese || "").slice(0, 4) || String(new Date().getFullYear());
    const meseFolder = nomeCartellaMese(c.mese);
    let cartellaDefault = "";
    if (state.cartellaRoot) {
      cartellaDefault = `${state.cartellaRoot}/DUSSMANN GAMA/${anno}/${meseFolder}/${sottoCartella}`;
    }
    // Parte FISSA non modificabile: "CONSUNTIVO DUSSMANN NR <numero>"
    // con il numero vero (crescente). L'utente scrive solo la parte dopo.
    const prefissoFisso = `CONSUNTIVO DUSSMANN NR ${c.numero}`;

    // Mostro la finestra: prefisso fisso col numero + parte scrivibile + cartella + Salva
    const scelta = await mostraFinestraSalvaDussmann(prefissoFisso, cartellaDefault);
    if (!scelta) {
      showToast("Salvataggio annullato", "warn", 3000);
      return;
    }

    const arrayBuffer = await blob.arrayBuffer();
    const arr = Array.from(new Uint8Array(arrayBuffer));
    const r = await window.electronAPI.salvaDussmannPersonalizzato(scelta.cartella, scelta.nomeFile, arr);
    if (r.ok) {
      if (r.pdfPath) {
        showToast(`✅ Salvato Word + PDF come "${scelta.nomeFile}"`, "success", 6000);
      } else {
        showToast(`✅ Word salvato come "${scelta.nomeFile}". ⚠️ PDF non creato: ${r.pdfErrore}`, "warn", 8000);
      }
    } else {
      showToast(`❌ Errore salvataggio: ${r.errore}`, "error", 7000);
    }
  } else if (state.isElectron && window.electronAPI.salvaConsuntivo) {
    // Ripiego (versione vecchia senza finestra): salvataggio automatico
    const arrayBuffer = await blob.arrayBuffer();
    const arr = Array.from(new Uint8Array(arrayBuffer));
    const r = await window.electronAPI.salvaConsuntivo("dussmann_gama", c.mese, filename, arr, c.gruppo || "NHOOD", sottoCartella);
    if (!r.ok && !r.pdfSalvato) {
      console.warn("Salvataggio DUSSMANN GAMA:", r.errore);
    }
  } else {
    saveAs(blob, filename);
  }
}

// Mostra una finestra modale per i DUSSMANN: l'utente scrive il nome del file
// e conferma/cambia la cartella, poi clicca Salva. Ritorna {cartella, nomeFile}
// oppure null se annulla.
function mostraFinestraSalvaDussmann(prefissoFisso, cartellaDefault) {
  return new Promise((resolve) => {
    // Rimuovo eventuale finestra precedente
    const vecchia = document.getElementById("overlaySalvaDuss");
    if (vecchia) vecchia.remove();

    const overlay = document.createElement("div");
    overlay.id = "overlaySalvaDuss";
    overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;";

    const box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:12px;padding:24px;width:560px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,0.3);font-family:inherit;";
    const prefissoSafe = (prefissoFisso || "CONSUNTIVO DUSSMANN NR").replace(/"/g, "&quot;");
    box.innerHTML = `
      <h2 style="margin:0 0 6px;font-size:19px;color:#1f2937;">💾 Salva consuntivo DUSSMANN</h2>
      <p style="margin:0 0 18px;font-size:13px;color:#6b7280;">Il numero è già inserito e non si può cancellare. Scrivi solo il resto del nome, poi premi Salva. Verranno creati il Word e il PDF.</p>

      <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;">Nome del file</label>
      <div style="display:flex;align-items:stretch;gap:0;margin-bottom:4px;border:2px solid #d1d5db;border-radius:8px;overflow:hidden;">
        <span id="dussSalvaPrefisso" style="display:flex;align-items:center;padding:10px 10px;background:#eef2ff;color:#4338ca;font-weight:700;font-size:13px;white-space:nowrap;border-right:2px solid #d1d5db;">${prefissoSafe}</span>
        <input id="dussSalvaNome" type="text" placeholder="scrivi il resto (es. QUOTA DISTACCO PIETRO RAI)" style="flex:1;box-sizing:border-box;padding:10px 12px;border:none;outline:none;font-size:14px;">
      </div>
      <p style="margin:0 0 16px;font-size:11px;color:#9ca3af;">La parte azzurra "${prefissoSafe}" è fissa. Non serve scrivere .docx o .pdf.</p>

      <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;">Cartella di salvataggio</label>
      <div style="display:flex;gap:8px;margin-bottom:20px;">
        <input id="dussSalvaCartella" type="text" value="${(cartellaDefault || "").replace(/"/g, "&quot;")}" style="flex:1;box-sizing:border-box;padding:10px 12px;border:2px solid #d1d5db;border-radius:8px;font-size:12px;color:#4b5563;background:#f9fafb;">
        <button id="dussSalvaSfoglia" style="white-space:nowrap;padding:10px 14px;border:none;border-radius:8px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer;font-size:13px;">📁 Cambia</button>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="dussSalvaAnnulla" style="padding:10px 20px;border:2px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-weight:600;cursor:pointer;font-size:14px;">Annulla</button>
        <button id="dussSalvaConferma" style="padding:10px 24px;border:none;border-radius:8px;background:#16a34a;color:#fff;font-weight:700;cursor:pointer;font-size:14px;">✅ Salva</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const inputNome = box.querySelector("#dussSalvaNome");
    const inputCartella = box.querySelector("#dussSalvaCartella");
    inputNome.focus();

    const chiudi = (risultato) => { overlay.remove(); resolve(risultato); };

    // Pulsante "Cambia" cartella: apre il dialog di Windows/Mac
    box.querySelector("#dussSalvaSfoglia").onclick = async () => {
      try {
        const r = await window.electronAPI.scegliCartellaLibera(inputCartella.value || cartellaDefault);
        if (r && r.ok && r.cartella) inputCartella.value = r.cartella;
      } catch (e) { console.warn("Scelta cartella:", e); }
    };

    box.querySelector("#dussSalvaAnnulla").onclick = () => chiudi(null);
    overlay.onclick = (e) => { if (e.target === overlay) chiudi(null); };

    box.querySelector("#dussSalvaConferma").onclick = () => {
      const resto = (inputNome.value || "").trim();
      const cartella = (inputCartella.value || "").trim();
      if (!cartella) { inputCartella.style.borderColor = "#dc2626"; return; }
      // Nome finale = prefisso fisso (col numero) + quello che ha scritto l'utente
      const nomeFinale = resto ? `${prefissoFisso} ${resto}` : prefissoFisso;
      chiudi({ nomeFile: nomeFinale, cartella });
    };

    // Invio = salva
    inputNome.onkeydown = (e) => { if (e.key === "Enter") box.querySelector("#dussSalvaConferma").click(); };
  });
}

async function buildDocxDussmann(c) {
  const dataDocFormat = formatDateIt(c.dataDocumento);
  const base64 = (c.sottoTipo === "distacco")
    ? TEMPLATE_DOCX_DUSSMANN_DISTACCO_BASE64
    : (c.sottoTipo === "rimborso")
      ? TEMPLATE_DOCX_DUSSMANN_RIMBORSO_BASE64
      : TEMPLATE_DOCX_DUSSMANN_SERVIZIO_BASE64;

  const placeholders = {
    "{{DATA_DOC}}": dataDocFormat,
    "{{NUMERO}}": String(c.numero),
    "{{ANNO}}": String(c.anno),
    "{{OGGETTO}}": c.oggetto || "",
    "{{PERIODO}}": c.periodo || "",
    "{{ORE}}": formatNumero(c.ore),
    "{{TOTALE}}": formatEuro(c.totale),
    "{{PAGAMENTI}}": c.pagamenti || ""
  };

  if (c.sottoTipo === "distacco") {
    Object.assign(placeholders, {
      "{{RETRIBUZIONE}}": formatEuro(c.retribuzione),
      "{{TREDICESIMA}}": formatEuro(c.tredicesima),
      "{{FESTIVITA}}": formatEuro(c.festivita),
      "{{EXFESTIVITA}}": formatEuro(c.exFestivita),
      "{{TFR}}": formatEuro(c.tfr),
      "{{TOT_RETRIBUZIONE}}": formatEuro(c.retribuzione + c.tredicesima + c.festivita + c.exFestivita + c.tfr),
      "{{ADD_INAIL}}": formatEuro(c.addInail),
      "{{INAIL}}": formatEuro(c.inail),
      "{{INPS}}": formatEuro(c.inps),
      "{{TOT_CONTRIBUZIONE}}": formatEuro(c.addInail + c.inail + c.inps),
      "{{TRATTENUTE}}": formatEuro(c.trattenute),
      "{{TOT_TRATTENUTE}}": formatEuro(Math.abs(c.trattenute)),
      "{{COSTO_ORARIO}}": formatEuro(c.costoOrario)
    });
  } else if (c.sottoTipo === "servizio") {
    Object.assign(placeholders, {
      "{{QUOTA}}": formatEuro(c.quota),
      "{{COSTO_DISTACCO}}": formatEuro(c.costoDistacco),
      "{{COSTO_PATTUITO}}": formatEuro(c.costoPattuito)
    });
  }

  const templateBytes = base64ToBytes(base64);
  const zip = await JSZip.loadAsync(templateBytes);
  let docXml = await zip.file("word/document.xml").async("string");
  for (const [ph, val] of Object.entries(placeholders)) {
    docXml = docXml.split(ph).join(escapeXml(val));
  }
  // Destinatario (multi-riga). Ogni riga diventa un a-capo nel documento.
  // Se vuoto, uso DUSSMANN come predefinito (comportamento storico).
  const destDefault = "DUSSMANN SERVICE SRL\nVIA SAN GREGORIO,55\n20124 MILANO (MI)\nP.IVA 00124140211";
  const destLines = (c.destinatario || destDefault).split("\n").map(s => escapeXml(s.trim()));
  docXml = docXml.split("{{DESTINATARIO}}").join(destLines.join("</w:t><w:br/><w:t>"));
  // Rimborso: elenco voci. Descrizione in nero, importo in rosso/grassetto/corsivo come nei documenti originali.
  if (c.sottoTipo === "rimborso") {
    const righe = c.righe || [];
    // Genero le righe della tabella: descrizione in nero, importo in rosso/grassetto/corsivo
    const parR = (testo, { bold = false, italic = false, color = "222222", jc = null }) => {
      const jcXml = jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : "";
      return `<w:p>${jcXml}<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}<w:color w:val="${color}"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${testo}</w:t></w:r></w:p>`;
    };
    const cellaR = (w, p, vc = false) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${vc ? '<w:vAlign w:val="center"/>' : ''}</w:tcPr>${p}</w:tc>`;
    const righeXml = righe.map(voce =>
      `<w:tr>${cellaR(7201, parR(escapeXml(voce.descrizione || ""), {}))}${cellaR(2325, parR("€ " + escapeXml(formatEuro(voce.importo || 0)), { bold: true, italic: true, color: "FF0000", jc: "right" }), true)}</w:tr>`
    ).join("");
    const idxV = docXml.indexOf("{{ELENCO_VOCI}}");
    if (idxV >= 0) {
      const trStart = docXml.lastIndexOf("<w:tr", idxV);
      const trEnd = docXml.indexOf("</w:tr>", idxV) + "</w:tr>".length;
      docXml = docXml.substring(0, trStart) + righeXml + docXml.substring(trEnd);
    }
  }
  zip.file("word/document.xml", docXml);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE"
  });

  const tipoLabel = c.sottoTipo === "distacco" ? "DISTACCO" : (c.sottoTipo === "rimborso" ? "RIMBORSO" : "SERVIZIO");
  const oggBreve = (c.oggetto || "").substring(0, 40).replace(/[/\\?%*:|"<>]/g, "");
  const filename = `CONSUNTIVO DUSSMANN NR ${c.numero} ${tipoLabel} ${oggBreve}.docx`;
  return { blob, filename };
}

function annullaModificaDussmann() {
  state.modificaInCorsoDuss = null;
  document.getElementById("btnAnnullaModificaDuss").classList.add("hidden");
  document.getElementById("formDussmann").reset();
  aggiornaCampiDussmann();
  aggiornaDussNumeroUI();
  precompilaOggettoDussmann();
  cancellaBozza();
  showToast("Modifica annullata.", "info");
}

// --- STORICO DUSSMANN ---
function refreshStoricoDussmann() {
  const tbody = document.getElementById("dussStoricoBody");
  const stats = document.getElementById("dussStoricoStats");
  if (!tbody) return;
  const lista = state.dussmannMese || [];

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">Nessun DUSSMANN questo mese.</td></tr>`;
    if (stats) stats.innerHTML = "";
    return;
  }

  const totEuro = lista.reduce((s, c) => s + (c.totale || 0), 0);
  const nDist = lista.filter(c => c.sottoTipo === "distacco").length;
  const nServ = lista.filter(c => c.sottoTipo === "servizio").length;
  const nRimb = lista.filter(c => c.sottoTipo === "rimborso").length;
  if (stats) stats.innerHTML = `
    <div class="stat">Tot: <strong>${lista.length}</strong></div>
    <div class="stat">Distacco: <strong>${nDist}</strong></div>
    <div class="stat">Servizio: <strong>${nServ}</strong></div>
    <div class="stat">Rimborso: <strong>${nRimb}</strong></div>
    <div class="stat">Tot importo: <strong>€ ${formatEuro(totEuro)}</strong></div>`;

  tbody.innerHTML = lista.map(c => {
    const ogg = (c.oggetto || "").substring(0, 50) + ((c.oggetto || "").length > 50 ? "…" : "");
    return `
    <tr>
      <td><strong>${c.numero}</strong></td>
      <td><span class="badge-tipo">${c.sottoTipo === "distacco" ? "Distacco" : (c.sottoTipo === "rimborso" ? "Rimborso" : "Servizio")}</span></td>
      <td>${escapeHtml(c.gruppo || "—")}</td>
      <td>${formatDateIt(c.dataDocumento)}</td>
      <td title="${escapeHtml(c.oggetto || "")}">${escapeHtml(ogg)}</td>
      <td>${formatNumero(c.ore)}</td>
      <td>€ ${formatEuro(c.totale)}</td>
      <td>
        <button class="btn-mini" onclick="window.modificaDussmann('${c.id}')" title="Modifica">✏️</button>
        <button class="btn-mini" onclick="window.scaricaDussmann('${c.id}')" title="Scarica">⬇️</button>
        <button class="btn-mini danger" onclick="window.eliminaDussmann('${c.id}', ${c.numero})" title="Elimina">🗑️</button>
      </td>
    </tr>`;
  }).join("");
}

window.modificaDussmann = async (id) => {
  const snap = await fb.getDoc(fb.doc(fb.db, "dussmann", id));
  if (!snap.exists()) { showToast("DUSSMANN non trovato", "error"); return; }
  const c = snap.data();

  // Carico i dati nel form
  document.getElementById("dussTipo").value = c.sottoTipo || "distacco";
  document.getElementById("dussGruppo").value = c.gruppo || "NHOOD";
  document.getElementById("dussData").value = c.dataDocumento || "";
  document.getElementById("dussPeriodo").value = c.periodo || "";
  document.getElementById("dussOggetto").value = c.oggetto || "";
  document.getElementById("dussDestinatario").value = c.destinatario || "DUSSMANN SERVICE SRL\nVIA SAN GREGORIO,55\n20124 MILANO (MI)\nP.IVA 00124140211";
  document.getElementById("dussOre").value = c.ore || 0;
  document.getElementById("dussPagamenti").value = c.pagamenti || "BB 60GDFFM";

  if (c.sottoTipo === "distacco") {
    document.getElementById("dussRetribuzione").value = c.retribuzione || 0;
    document.getElementById("dussTredicesima").value = c.tredicesima || 0;
    document.getElementById("dussFestivita").value = c.festivita || 0;
    document.getElementById("dussExFestivita").value = c.exFestivita || 0;
    document.getElementById("dussTfr").value = c.tfr || 0;
    document.getElementById("dussAddInail").value = c.addInail || 0;
    document.getElementById("dussInail").value = c.inail || 0;
    document.getElementById("dussInps").value = c.inps || 0;
    document.getElementById("dussTrattenute").value = c.trattenute || 0;
  } else if (c.sottoTipo === "servizio") {
    document.getElementById("dussCostoDistacco").value = c.costoDistacco || 0;
    document.getElementById("dussCostoPattuito").value = c.costoPattuito || 0;
  }

  // Rimborso: ricostruisco le voci dell'elenco
  const contRimb = document.getElementById("dussRigheRimborso");
  if (contRimb) contRimb.innerHTML = "";
  if (c.sottoTipo === "rimborso" && Array.isArray(c.righe)) {
    c.righe.forEach(voce => aggiungiVoceRimborso(voce.descrizione || "", voce.importo || ""));
  }

  state.modificaInCorsoDuss = { id, numero: c.numero };
  document.getElementById("btnAnnullaModificaDuss").classList.remove("hidden");
  aggiornaCampiDussmann();
  ricalcolaDussmann();

  // Vado in cima alla scheda
  document.getElementById("dussTipo").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(`✏️ Stai modificando il DUSSMANN NR ${c.numero}`, "info", 4000);
};

window.scaricaDussmann = async (id) => {
  const snap = await fb.getDoc(fb.doc(fb.db, "dussmann", id));
  if (!snap.exists()) { showToast("DUSSMANN non trovato", "error"); return; }
  const c = snap.data();
  try {
    await buildAndSaveDussmann(c);
    showToast(`✅ DUSSMANN NR ${c.numero} rigenerato e salvato`, "success");
  } catch (e) {
    showToast("⚠️ Errore: " + e.message, "error");
  }
};

window.eliminaDussmann = async (id, numero) => {
  if (!confirm(`Eliminare il DUSSMANN NR ${numero}?\n\nVerranno eliminati:\n• La riga dall'archivio\n• Il file .docx e PDF salvati\n\nL'operazione non è reversibile.`)) return;
  // Leggo i dati prima di cancellare
  let dati = null;
  try {
    const snap = await fb.getDoc(fb.doc(fb.db, "dussmann", id));
    if (snap.exists()) dati = snap.data();
  } catch (e) { console.warn("Lettura DUSSMANN pre-eliminazione:", e); }

  try {
    await fb.deleteDoc(fb.doc(fb.db, "dussmann", id));
  } catch (e) {
    showToast("⚠️ Errore eliminazione: " + e.message, "error");
    return;
  }

  // Cancello i file (docx + pdf) dalla cartella DUSSMANN GAMA
  let fileMsg = "";
  if (state.isElectron && dati && window.electronAPI.eliminaFileConsuntivo) {
    try {
      const tipoLabel = dati.sottoTipo === "distacco" ? "DISTACCO" : (dati.sottoTipo === "rimborso" ? "RIMBORSO" : "SERVIZIO");
      const oggBreve = (dati.oggetto || "").substring(0, 40).replace(/[/\\?%*:|"<>]/g, "");
      const filenameDocx = `CONSUNTIVO DUSSMANN NR ${numero} ${tipoLabel} ${oggBreve}.docx`;
      // Calcolo la stessa sottocartella usata in fase di salvataggio
      const sottoCartella = determinaSottoCartellaDussmann(dati);
      const r = await window.electronAPI.eliminaFileConsuntivo("dussmann_gama", dati.mese, filenameDocx, dati.gruppo, sottoCartella);
      if (r.ok && r.trovatoQualcosa) fileMsg = " (file eliminati)";
      else fileMsg = " — ⚠️ file non trovato, cancellalo a mano";
    } catch (e) { console.warn("Eliminazione file DUSSMANN GAMA:", e); }
  }

  showToast(`🗑️ DUSSMANN NR ${numero} eliminato${fileMsg}`, "success", 6000);
};


// ============================================================
// PREVIEW
// ============================================================
function mostraPreview() {
  if (!validaForm()) return;
  const tipo = document.getElementById("tipoConsuntivo").value;
  const numero = tipo === "cbre" ? state.prossimoNumeroCbre : state.prossimoNumeroCreval;
  const c = costruisciConsuntivoDaForm(numero ?? "—", tipo);
  const totale = calcolaTotaleConsuntivo(c);
  const costoOre = c.ore * c.tariffaOraria;
  const odl = c.odl ? ` ODL NR. ${c.odl}` : ` ODL NR.`;
  const anno = c.dataDocumento ? c.dataDocumento.split("-")[0] : new Date().getFullYear();

  let txt = "";
  txt += `${state.settings.intestazione}\n`;
  txt += `P.IVA ${state.settings.piva}\n`;
  txt += `Mail: ${state.settings.mail}\n\n`;
  txt += `SOVICO ${formatDateIt(c.dataDocumento)}\n\n`;
  if (tipo === "cbre") {
    txt += `CBRE GWS TECHNICAL DIVISION\n`;
    txt += `VIA VERROTTI 65015 MONTESILVANO (PE)\n\n`;
  } else {
    txt += `CREDITO VALTELLINESE\n\n`;
  }
  txt += `CONSUNTIVO NR ${c.numero}/${anno}\n\n`;
  txt += `OGGETTO: CONSUNTIVO INTERVENTO ESEGUITO IN DATA ${c.dataIntervento} PRESSO ${c.sede.toUpperCase()}${odl}\n\n`;
  txt += `${c.descrizione}\n\n`;
  txt += `NR ° ${formatNumero(c.ore)} ORE TOTALI = € ${formatEuro(costoOre)}\n`;
  // Riga ore extra (opzionale): tecnico specializzato
  if (c.oreExtra && c.oreExtra > 0 && c.tariffaExtra && c.tariffaExtra > 0) {
    const costoOreExtra = c.oreExtra * c.tariffaExtra;
    txt += `NR ° ${formatNumero(c.oreExtra)} ORE TOTALI TECNICO SPECIALIZZATO = € ${formatEuro(costoOreExtra)}\n`;
  }
  // Riga ore di viaggio (opzionale)
  if (c.oreViaggio && c.oreViaggio > 0 && c.tariffaViaggio && c.tariffaViaggio > 0) {
    const costoViaggio = c.oreViaggio * c.tariffaViaggio;
    txt += `NR ° ${formatNumero(c.oreViaggio)} ORE DI VIAGGIO = € ${formatEuro(costoViaggio)}\n`;
  }
  txt += `\n`;
  if (c.costoMateriale > 0) {
    if (c.descrMateriale) txt += `MATERIALE:\n${c.descrMateriale} = € ${formatEuro(c.costoMateriale)}\n\n`;
    else txt += `MATERIALE = € ${formatEuro(c.costoMateriale)}\n\n`;
  }
  // Materiali extra (aggiunti col +)
  (c.materialiExtra || []).forEach(m => {
    if ((m.descr || "").trim() || (m.costo || 0) !== 0) {
      txt += `${(m.descr || "MATERIALE").trim()} = € ${formatEuro(m.costo || 0)}\n\n`;
    }
  });
  if (c.smaltimento !== 0) {
    const segno = c.smaltimento < 0 ? "-" : "";
    txt += `SMALTIMENTO = ${segno}€ ${formatEuro(Math.abs(c.smaltimento))}\n\n`;
  }
  // Voci aggiuntive (nolo piattaforma/trabattello/F-Gas/manuali)
  if ((c.noloPiattaforma || 0) !== 0) txt += `NOLO PIATTAFORMA = € ${formatEuro(c.noloPiattaforma)}\n\n`;
  if ((c.noloTrabattello || 0) !== 0) txt += `NOLO TRABATTELLO = € ${formatEuro(c.noloTrabattello)}\n\n`;
  if ((c.praticaFgas || 0) !== 0) txt += `PRATICA F-GAS = € ${formatEuro(c.praticaFgas)}\n\n`;
  (c.vociManuali || []).forEach(v => {
    if ((v.descr || "").trim() || (v.importo || 0) !== 0) {
      const segnoV = (v.importo || 0) < 0 ? "-" : "";
      txt += `${(v.descr || "VOCE").trim().toUpperCase()} = ${segnoV}€ ${formatEuro(Math.abs(v.importo || 0))}\n\n`;
    }
  });
  txt += `    L'IMPORTO DI QUANTO SOPRA DESCRITTO È PARI A € ${formatEuro(totale)} + IVA DI LEGGE\n\n`;
  txt += `CORDIALI SALUTI\n`;

  document.getElementById("previewContent").textContent = txt;
  document.getElementById("previewArea").classList.remove("hidden");
  document.getElementById("previewArea").scrollIntoView({ behavior: "smooth" });
}

// ============================================================
// STORICO
// ============================================================
function setupStoricoTab() {
  document.getElementById("filtroMese").addEventListener("change", caricaStoricoFiltrato);
  document.getElementById("filtroTipo").addEventListener("change", caricaStoricoFiltrato);
  document.getElementById("btnAggiornaStorico").addEventListener("click", caricaStoricoFiltrato);
  document.getElementById("btnScaricaZipMese").addEventListener("click", scaricaZipMese);
  const _btnCaricaDrive = document.getElementById("btnCaricaMeseDrive");
  if (_btnCaricaDrive) _btnCaricaDrive.addEventListener("click", caricaMeseSuDriveUI);

  // Ricerca per ODL
  const inputOdl = document.getElementById("cercaOdl");
  document.getElementById("btnCercaOdl").addEventListener("click", cercaPerOdl);
  document.getElementById("btnResetCerca").addEventListener("click", () => {
    inputOdl.value = "";
    caricaStoricoFiltrato();
  });
  // Cerca premendo Invio
  inputOdl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") cercaPerOdl();
  });
}

// Ricerca consuntivi per ODL: cerca in TUTTI i mesi (non solo il corrente)
async function cercaPerOdl() {
  const termine = document.getElementById("cercaOdl").value.trim().toLowerCase();
  if (!termine) {
    caricaStoricoFiltrato();
    return;
  }
  showToast("🔍 Ricerca in corso su tutti i mesi...", "info");
  try {
    // Scarico tutti i consuntivi e filtro per ODL (contiene il termine)
    const snap = await fb.getDocs(fb.collection(fb.db, "consuntivi"));
    let trovati = [];
    snap.forEach(d => {
      const c = { id: d.id, ...d.data() };
      const odl = (c.odl || "").toLowerCase();
      const odlCreval = (c.crevalOdlNumero || "").toLowerCase();
      if (odl.includes(termine) || odlCreval.includes(termine)) {
        trovati.push(c);
      }
    });
    trovati.sort((a,b) => (a.numero || 999999) - (b.numero || 999999));
    refreshStoricoLista(trovati, null, `Risultati ricerca ODL "${termine}"`);
    if (!trovati.length) {
      showToast(`Nessun consuntivo trovato con ODL "${termine}"`, "warn");
    } else {
      showToast(`✅ Trovati ${trovati.length} consuntivi`, "success");
    }
  } catch (err) {
    showToast("Errore ricerca: " + err.message, "error");
  }
}

async function caricaStoricoFiltrato() {
  const mese = document.getElementById("filtroMese").value;
  const tipoFiltro = document.getElementById("filtroTipo").value;
  if (!mese) return;

  // Se è il mese corrente uso i listener live, altrimenti faccio fetch
  let lista;
  if (mese === state.meseCorrente) {
    lista = state.consuntiviMese;
  } else {
    const q = fb.query(
      fb.collection(fb.db, "consuntivi"),
      fb.where("mese", "==", mese)
    );
    const snap = await fb.getDocs(q);
    lista = [];
    snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
  }

  if (tipoFiltro) lista = lista.filter(c => c.tipo === tipoFiltro);
  lista.sort((a,b) => {
    if (a.tipo === b.tipo) return a.numero - b.numero;
    return a.tipo.localeCompare(b.tipo);
  });

  refreshStoricoLista(lista, mese);
}

function refreshStorico() {
  caricaStoricoFiltrato();
}

// --- STATO PAGAMENTO (colori storico + Excel) ---
const COLORI_PAGAMENTO = {
  pagato:   { hex: "#E8C84B", label: "Pagato" },
  parziale: { hex: "#BFE3F5", label: "Parzialmente pagato" },
};

// 3 pulsantini colorati per impostare lo stato pagamento di una riga
function bottoniStatoPagamento(id, statoAttuale, tipo, mese) {
  const opzioni = [
    { stato: "pagato",   bg: "#E8C84B", titolo: "Pagato" },
    { stato: "parziale", bg: "#BFE3F5", titolo: "Parzialmente pagato" },
    { stato: "",         bg: "#ffffff", titolo: "Nessuno (togli colore)" },
  ];
  return opzioni.map(o => {
    const attivo = (statoAttuale || "") === o.stato;
    const bordo = attivo ? "2px solid #111" : "1px solid #bbb";
    return `<button class="btn-mini" title="${o.titolo}" onclick="window.setStatoPagamento('${id}','${o.stato}','${tipo || ""}','${mese || ""}')" style="background:${o.bg};border:${bordo};width:22px;min-width:22px;padding:0;color:#111">${attivo ? "✓" : "&nbsp;"}</button>`;
  }).join("");
}

function refreshStoricoLista(lista, mese, titoloRicerca) {
  const tbody = document.getElementById("storicoBody");
  const stats = document.getElementById("storicoStats");

  if (!lista.length) {
    const msg = titoloRicerca ? titoloRicerca + ": nessun risultato." : `Nessun consuntivo per ${formatMonthLabel(mese)}.`;
    tbody.innerHTML = `<tr><td colspan="11" class="empty">${msg}</td></tr>`;
    stats.innerHTML = "";
    return;
  }

  const totQuant = lista.length;
  const totEuro = lista.reduce((s, c) => s + (c.totale || 0), 0);
  const totOre = lista.reduce((s, c) => s + (c.ore || 0), 0);
  const totCbre = lista.filter(c => c.tipo === "cbre").length;
  const totCreval = lista.filter(c => c.tipo === "creval").length;

  const intestazione = titoloRicerca ? `<div class="stat" style="background:#f59014;color:white">${titoloRicerca}</div>` : "";

  stats.innerHTML = `
    ${intestazione}
    <div class="stat">Tot: <strong>${totQuant}</strong></div>
    <div class="stat">CBRE: <strong>${totCbre}</strong></div>
    <div class="stat">CREVAL: <strong>${totCreval}</strong></div>
    <div class="stat">Tot ore: <strong>${formatNumero(totOre)}</strong></div>
    <div class="stat">Tot importo: <strong>€ ${formatEuro(totEuro)}</strong></div>
  `;

  tbody.innerHTML = lista.map(c => {
    const numVisualizzato = (c.numero === null || c.numero === undefined || c.numero >= 900000)
      ? "—"
      : (c.tipo === "creval" ? `CR ${c.numero}` : c.numero);
    const _stato = c.statoPagamento || "";
    const _rigaColore = COLORI_PAGAMENTO[_stato] ? ` style="background:${COLORI_PAGAMENTO[_stato].hex}"` : "";
    return `
    <tr${_rigaColore}>
      <td><span class="badge-tipo badge-${c.tipo}">${c.tipo}</span></td>
      <td><strong>${numVisualizzato}</strong></td>
      <td>${formatDateIt(c.dataDocumento)}</td>
      <td>${labelCategoria(c.categoria)}</td>
      <td>${escapeHtml(c.sede)}</td>
      <td>${escapeHtml(c.dataIntervento)}</td>
      <td>${escapeHtml(c.odl || c.crevalOdlNumero || "—")}</td>
      <td>${formatNumero(c.ore)}</td>
      <td>€ ${formatEuro(c.totale)}</td>
      <td>${escapeHtml(c.operatore || "—")}</td>
      <td>
        ${bottoniStatoPagamento(c.id, _stato, c.tipo, c.mese)}
        <button class="btn-mini" onclick="window.modificaConsuntivo('${c.id}')" title="Modifica">✏️</button>
        <button class="btn-mini" onclick="window.scaricaConsuntivo('${c.id}')" title="Scarica">⬇️</button>
        <button class="btn-mini danger" onclick="window.eliminaConsuntivo('${c.id}', '${c.tipo}', ${c.numero})" title="Elimina">🗑️</button>
      </td>
    </tr>
  `;}).join("");
}

// Imposta lo stato pagamento (colore) di un consuntivo e ricolora la riga
window.setStatoPagamento = async (id, stato, tipo, mese) => {
  try {
    // Segnalo che il cambio colore è LOCALE, così il listener Firestore non
    // rigenera l'Excel una seconda volta (lo facciamo già qui sotto).
    state._coloreCambiatoLocale = true;
    await fb.setDoc(fb.doc(fb.db, "consuntivi", id), { statoPagamento: stato }, { merge: true });
    // Aggiorno lo stato in memoria (sia nella lista del mese corrente, se presente)
    const it = state.consuntiviMese.find(c => c.id === id);
    if (it) it.statoPagamento = stato;
    caricaStoricoFiltrato();
    const lbl = stato === "pagato" ? "Pagato" : (stato === "parziale" ? "Parzialmente pagato" : "Nessuno");

    // Recupero mese e tipo se non sono stati passati (es. lista filtrata/ricerca):
    // li leggo dal consuntivo in memoria o, in ultima istanza, da Firestore.
    let meseFinale = mese;
    let tipoFinale = tipo;
    let dati = it;
    if (!dati) {
      try {
        const snap = await fb.getDoc(fb.doc(fb.db, "consuntivi", id));
        if (snap.exists()) dati = { id, ...snap.data() };
      } catch (e) {}
    }
    if (dati) {
      if (!meseFinale) meseFinale = dati.mese || (dati.dataDocumento ? dati.dataDocumento.slice(0, 7) : "");
      if (!tipoFinale) tipoFinale = dati.tipo || "cbre";
    }

    // Riporto il colore anche nell'Excel del mese. Ricostruzione PULITA: il colore
    // deriva dal dato (statoPagamento) letto FRESCO da Firestore dentro la funzione
    // di rigenerazione, quindi il colore appena salvato viene sempre applicato.
    if (meseFinale) {
      showToast(`Stato: ${lbl}. Aggiorno l'Excel del mese...`, "success", 2500);
      let res;
      if (tipoFinale === "creval") res = await aggiornaExcelCrevalMese(meseFinale, true, true);
      else res = await aggiornaExcelMese(meseFinale, true, true);
      // Avviso se l'Excel non è stato salvato (es. cartella NAS non impostata o file aperto)
      if (res && res.ok === false) {
        if (res.motivo === "file aperto") {
          // già avvisato dentro la funzione
        } else if (res.motivo === "nessun consuntivo") {
          showToast("⚠️ Colore salvato, ma nessun Excel da aggiornare per questo mese.", "warn", 5000);
        } else if (!state.cartellaRoot) {
          showToast("⚠️ Colore salvato su cloud, ma la cartella del NAS non è impostata: l'Excel sul NAS non è stato aggiornato. Imposta la cartella nelle impostazioni.", "warn", 8000);
        } else {
          showToast("⚠️ Colore salvato, ma l'Excel non è stato aggiornato: " + (res.errore || res.motivo || "motivo sconosciuto"), "warn", 7000);
        }
      } else if (res && res.ok) {
        showToast(`✅ Excel aggiornato col colore ${lbl}.`, "success", 2500);
      }
    } else {
      showToast("⚠️ Colore salvato, ma non riesco a capire il mese per aggiornare l'Excel.", "warn", 6000);
    }
  } catch (e) {
    showToast("Errore nel salvare lo stato: " + (e.message || e), "error");
  }
};

window.scaricaConsuntivo = async (id) => {
  const snap = await fb.getDoc(fb.doc(fb.db, "consuntivi", id));
  if (!snap.exists()) {
    showToast("Consuntivo non trovato", "error");
    return;
  }
  const c = snap.data();
  const { blob, filename } = await buildDocx(c);
  const res = await salvaInCartella(blob, filename, c.tipo, c.mese);
  if (res.saved) showToast(`✅ Salvato in ${res.path}`, "success");
  else showToast(`✅ Scaricato`, "success");
};

// MODIFICA consuntivo esistente: carica i dati nel form e attiva la modalità modifica
window.modificaConsuntivo = async (id) => {
  const snap = await fb.getDoc(fb.doc(fb.db, "consuntivi", id));
  if (!snap.exists()) {
    showToast("Consuntivo non trovato", "error");
    return;
  }
  const c = snap.data();

  // Memorizzo che sto modificando questo consuntivo
  state.modificaInCorso = { id, numero: c.numero, tipo: c.tipo, totaleOriginale: c.totale || 0 };

  // Vado sulla tab "Nuovo"
  document.querySelector('.tab-btn[data-tab="nuovo"]').click();

  // Compilo il form coi dati esistenti
  document.getElementById("tipoConsuntivo").value = c.tipo;
  aggiornaCategoriePerTipo();

  if (c.sezioneExcel) {
    const selSez = document.getElementById("sezioneExcel");
    if (selSez) selSez.value = c.sezioneExcel;
  }
  document.getElementById("sede").value = c.sede || "";
  document.getElementById("dataDocumento").value = c.dataDocumento || "";
  document.getElementById("dataIntervento").value = c.dataIntervento || "";
  document.getElementById("odl").value = c.odl || "";
  document.getElementById("descrizione").value = c.descrizione || "";
  document.getElementById("ore").value = c.ore || 0;
  document.getElementById("tariffaOraria").value = c.tariffaOraria || 0;
  document.getElementById("oreExtra").value = c.oreExtra || "";
  document.getElementById("tariffaExtra").value = c.tariffaExtra || "";
  document.getElementById("descrMateriale").value = c.descrMateriale || "";
  document.getElementById("costoMateriale").value = c.costoMateriale || 0;
  if (document.getElementById("smaltimento")) document.getElementById("smaltimento").value = c.smaltimento || 0;
  // Voci aggiuntive
  if (document.getElementById("noloPiattaforma")) document.getElementById("noloPiattaforma").value = c.noloPiattaforma || "";
  if (document.getElementById("noloTrabattello")) document.getElementById("noloTrabattello").value = c.noloTrabattello || "";
  if (document.getElementById("praticaFgas")) document.getElementById("praticaFgas").value = c.praticaFgas || "";
  impostaVociManuali(c.vociManuali || []);
  impostaMaterialiExtra(c.materialiExtra || []);
  document.getElementById("notaExcel").value = c.notaExcel || "";

  // Campi CREVAL
  if (c.tipo === "creval") {
    if (document.getElementById("crevalProvincia")) document.getElementById("crevalProvincia").value = c.crevalProvincia || "";
    if (document.getElementById("crevalRegione")) document.getElementById("crevalRegione").value = c.crevalRegione || "";
    if (document.getElementById("crevalTicket")) document.getElementById("crevalTicket").value = c.crevalTicket || "";
    if (document.getElementById("crevalOdlNumero")) document.getElementById("crevalOdlNumero").value = c.crevalOdlNumero || "";
  }
  // Pagamenti
  if (document.getElementById("pagamentiTipo")) document.getElementById("pagamentiTipo").value = c.pagamentiTipo || "";

  // Ripristino "Totale a mano": se era attivo, oppure se è un consuntivo importato senza dettaglio ore
  const _senzaDettaglioMod = (!c.ore || c.ore === 0) && (!c.tariffaOraria || c.tariffaOraria === 0) && (c.totale || 0) > 0;
  const _usaManuale = !!c.totaleManuale || !!c.importatoAMano || _senzaDettaglioMod;
  const _totManElMod = document.getElementById("totaleManuale");
  if (_totManElMod) {
    _totManElMod.checked = _usaManuale;
    const _totMod = document.getElementById("totale");
    if (_usaManuale) {
      _totMod.readOnly = false;
      _totMod.classList.remove("readonly");
      _totMod.value = formatEuro(c.totaleInserito != null ? c.totaleInserito : (c.totale || 0));
    } else {
      _totMod.readOnly = true;
      _totMod.classList.add("readonly");
    }
  }

  // Ripristino "Nascondi A corpo"
  const _nascEl = document.getElementById("nascondiaCorpo");
  if (_nascEl) _nascEl.checked = !!c.nascondiaCorpo;

  ricalcolaTotale();

  // Cambio il testo del bottone genera per indicare modifica
  const numeroBtn = document.getElementById("numeroBtn");
  if (numeroBtn) {
    const numLabel = (c.numero >= 900000 || c.numero == null) ? "(modifica)" : c.numero;
    numeroBtn.textContent = `✏️ ${numLabel}`;
  }

  // Mostro il bottone "Annulla modifica"
  const btnAnnulla = document.getElementById("btnAnnullaModifica");
  if (btnAnnulla) btnAnnulla.classList.remove("hidden");

  // Se è un consuntivo importato a mano (totale salvato ma niente dettaglio ore/tariffa)
  // avviso l'utente del totale originale
  const senzaDettaglio = (!c.ore || c.ore === 0) && (!c.tariffaOraria || c.tariffaOraria === 0) && c.totale > 0;
  if (senzaDettaglio || c.importatoAMano) {
    showToast(`✏️ Modifica ${c.tipo.toUpperCase()} ${c.numero >= 900000 ? '(senza num)' : 'NR '+c.numero}. Questo consuntivo non ha il dettaglio ore: ho attivato "Totale a mano" col totale € ${formatEuro(c.totale || 0)}. Puoi modificarlo direttamente, oppure togli la spunta per reinserire ore e tariffa.`, "info", 9000);
  } else {
    showToast(`✏️ Stai modificando il ${c.tipo.toUpperCase()} ${c.numero >= 900000 ? '(senza numero)' : 'NR '+c.numero}. Modifica i campi e premi "Genera consuntivo" per salvare, oppure "Annulla modifica" per uscire.`, "info", 7000);
  }
};

// Esce dalla modalità modifica senza salvare e pulisce il form
function annullaModifica() {
  state.modificaInCorso = null;
  const btnAnnulla = document.getElementById("btnAnnullaModifica");
  if (btnAnnulla) btnAnnulla.classList.add("hidden");
  document.getElementById("formConsuntivo").reset();
  impostaVociManuali([]);
  impostaMaterialiExtra([]);
  aggiornaCategoriePerTipo();
  aggiornaNumeroPreview();
  ricalcolaTotale();
  cancellaBozza();
  showToast("Modifica annullata. Puoi creare un nuovo consuntivo.", "info");
}

window.eliminaConsuntivo = async (id, tipo, numero) => {
  const numLabel = (numero >= 900000 || numero == null) ? "(senza numero)" : `NR ${numero}`;
  if (!confirm(`Eliminare il consuntivo ${tipo.toUpperCase()} ${numLabel}?\n\nVerranno eliminati:\n• La riga dal database\n• Il file .docx dal NAS\n• Il PDF dal Desktop\n• La riga dall'Excel del mese\n\nIl numero ${numero >= 900000 ? '' : numero} non verrà recuperato.`)) return;

  // 1. Leggo i dati del consuntivo PRIMA di cancellarlo (mi servono mese e dati per i file)
  let dati = null;
  try {
    const snap = await fb.getDoc(fb.doc(fb.db, "consuntivi", id));
    if (snap.exists()) dati = snap.data();
  } catch (e) { console.warn("Lettura dati pre-eliminazione:", e); }

  // 1bis. Controllo se il file Excel del mese è APERTO (sulla rete NAS o sul PC).
  //       Se è aperto non riuscirei ad aggiornarlo dopo: quindi NON elimino niente
  //       e avviso di chiuderlo. Così evito di lasciare nell'Excel una riga che
  //       invece ho già tolto dal database.
  if (state.isElectron && dati && dati.mese && window.electronAPI.leggiExcelEsistente) {
    try {
      const excelName = (tipo === "creval")
        ? nomeFileExcelCrevalMese(dati.mese)
        : nomeFileExcelMese(dati.mese);
      const chk = await window.electronAPI.leggiExcelEsistente(dati.mese, excelName);
      if (chk && chk.bloccato) {
        showToast(`⚠️ Il file Excel ${tipo.toUpperCase()} di questo mese è APERTO (sulla rete o sul PC). Chiudilo e riprova: ho annullato l'eliminazione per non lasciare la riga nell'Excel.`, "warn", 9000);
        return;
      }
    } catch (e) { console.warn("Controllo Excel aperto:", e); }
  }

  // 2. Cancello da Firebase
  try {
    await fb.deleteDoc(fb.doc(fb.db, "consuntivi", id));
  } catch (err) {
    showToast("❌ Errore eliminazione dal database: " + err.message, "error");
    return;
  }

  // 3. Cancello i file fisici (docx dal NAS + PDF dal Desktop) - solo in Electron
  let fileMsg = "";
  if (state.isElectron && dati && window.electronAPI.eliminaFileConsuntivo) {
    try {
      // Ricostruisco il filename come quando è stato creato
      const sedeFile = (dati.sede || "").toUpperCase().replace(/[/\\?%*:|"<>]/g, "");
      const filenameDocx = `CONSUNTIVO NR ${numero} ${sedeFile}.docx`;
      const r = await window.electronAPI.eliminaFileConsuntivo(tipo, dati.mese, filenameDocx);
      if (r.ok) {
        const parti = [];
        if (r.docxEliminato) parti.push("docx NAS");
        if (r.pdfEliminato) parti.push("PDF Desktop");
        if (parti.length) {
          fileMsg = ` (${parti.join(" + ")} eliminati)`;
        } else {
          fileMsg = " — ⚠️ file non trovato, cancellalo a mano dalla cartella";
        }
      }
    } catch (e) { console.warn("Eliminazione file:", e); }
  }

  // 4. Rigenero l'Excel del mese (così la riga sparisce)
  if (dati && dati.mese) {
    setTimeout(async () => {
      try {
        if (tipo === "cbre") await aggiornaExcelMese(dati.mese);
        else if (tipo === "creval") await aggiornaExcelCrevalMese(dati.mese);
      } catch (e) { console.error("Rigenerazione Excel post-eliminazione:", e); }
    }, 700);
  }

  showToast(`✅ Consuntivo ${tipo.toUpperCase()} ${numLabel} eliminato${fileMsg}. Excel in aggiornamento...`, "success", 5000);
};

// Scarica ZIP del mese con la struttura cartelle CBRE/CREVAL
async function scaricaZipMese() {
  const mese = document.getElementById("filtroMese").value;
  if (!mese) return;

  // Recupero consuntivi del mese
  let lista;
  if (mese === state.meseCorrente) {
    lista = state.consuntiviMese;
  } else {
    const q = fb.query(fb.collection(fb.db, "consuntivi"), fb.where("mese", "==", mese));
    const snap = await fb.getDocs(q);
    lista = [];
    snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
  }

  if (!lista.length) {
    showToast("⚠️ Nessun consuntivo da zippare per questo mese", "warn");
    return;
  }

  showToast("⏳ Generazione ZIP in corso...", "warn");

  const zip = new JSZip();
  const rootName = nomeCartellaMese(mese);
  const rootFolder = zip.folder(rootName);
  const cbreFolder = rootFolder.folder("CBRE");
  const crevalFolder = rootFolder.folder("CREVAL");

  for (const c of lista) {
    const { blob, filename } = await buildDocx(c);
    const folder = c.tipo === "cbre" ? cbreFolder : crevalFolder;
    folder.file(filename, blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  saveAs(zipBlob, `${rootName}.zip`);
  showToast(`✅ ZIP scaricato: ${rootName}.zip (${lista.length} consuntivi)`, "success", 5000);
}

// Carica su Google Drive i documenti CBRE/CREVAL GIA' ESISTENTI del mese scelto.
// I nuovi consuntivi salgono da soli al salvataggio: questo serve solo per i vecchi.
async function caricaMeseSuDriveUI() {
  const mese = document.getElementById("filtroMese").value;
  if (!mese) { showToast("⚠️ Scegli prima un mese", "warn"); return; }
  if (!state.isElectron || !window.electronAPI.caricaMeseSuDrive) {
    showToast("⚠️ Questa funzione è disponibile solo nel programma installato", "warn", 6000);
    return;
  }
  if (!confirm(`Carico su Google Drive i documenti CBRE e CREVAL di ${mese} che hai già?\n\nI consuntivi nuovi vengono caricati da soli: questo serve per portare su Drive quelli vecchi del mese.`)) return;
  showToast("⏳ Caricamento su Drive in corso... (attendi qualche secondo)", "warn", 8000);
  try {
    const r = await window.electronAPI.caricaMeseSuDrive(mese, ["CBRE", "CREVAL"]);
    if (!r || !r.ok) { showToast("❌ Errore: " + ((r && r.errore) || "sconosciuto"), "error", 7000); return; }
    if (!r.totaleTrovati) {
      showToast("ℹ️ Nessun documento CBRE/CREVAL trovato per questo mese sul NAS", "warn", 6000);
    } else if (!r.totaleErrori) {
      showToast(`✅ Caricati su Drive ${r.totaleCaricati} documenti di ${mese} (CBRE/CREVAL)`, "success", 6000);
    } else {
      showToast(`⚠️ Caricati ${r.totaleCaricati} su ${r.totaleTrovati} (${r.totaleErrori} non riusciti). Puoi ripremere il pulsante per riprovare.`, "warn", 8000);
    }
  } catch (e) {
    showToast("❌ Errore: " + e.message, "error", 7000);
  }
}

// ============================================================
// TAB EXCEL — Template integrato, file rigenerato a ogni consuntivo
// ============================================================

// Mappa sezioni Excel: per ogni id sezione → riga di partenza dati (1-indexed Excel)
// Queste righe sono FISSE perché il template ha sempre la stessa struttura
const SEZIONI_EXCEL = {
  bnl:            { startRow: 5,  endRow: 25, titoloRow: 3,  formulaRow: 26 },
  torre_diamante: { startRow: 30, endRow: 34, titoloRow: 28, formulaRow: 35 },
  mediobanca:     { startRow: 39, endRow: 53, titoloRow: 37, formulaRow: 54 },
  ceva:           { startRow: 58, endRow: 69, titoloRow: 56, formulaRow: 70 },
  bdb:            { startRow: 74, endRow: 81, titoloRow: 72, formulaRow: 82 },
  padovani:       { startRow: 86, endRow: 87, titoloRow: 84, formulaRow: 88 },
  keller:         { startRow: 92, endRow: 99, titoloRow: 90, formulaRow: 100 }
};

// Da "2026-05" a "MAGGIO 2026"
function meseAnnoLabel(yyyymm) {
  const [y, m] = yyyymm.split("-");
  const nomi = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
  return `${nomi[parseInt(m)-1]} ${y}`;
}

// Nome file Excel del mese
function nomeFileExcelMese(yyyymm) {
  // Il numero davanti segue il mese: gennaio=001, giugno=006, dicembre=012
  const numMese = yyyymm.split("-")[1].padStart(3, "0");
  return `${numMese} REPILOGO ATTIVITA CBRE ${meseAnnoLabel(yyyymm)}.xlsx`;
}

// Costruisce il file Excel del mese modificando DIRETTAMENTE l'XML interno
// del template (preserva al 100% colori, stili, formattazione)
//
// NOVITÀ: se una sezione ha più consuntivi delle righe disponibili,
// le righe vengono AGGIUNTE dinamicamente (e le sezioni successive scendono giù)
// Costruisce lo scheletro XML di un blocco "cliente personalizzato": riga titolo
// (arancione), riga intestazioni colonne, n righe dati VUOTE (riempite poi dai
// cellEdits, così funzionano anche i colori) e la riga totale con la somma.
// Gli stili (s="...") sono gli stessi delle sezioni fisse del template.
function scheletroBloccoCustom(titoloRow, titolo, n, totale) {
  const headerRow = titoloRow + 1;
  const dataStart = titoloRow + 2;
  const dataEnd = dataStart + n - 1;
  const formulaRow = dataEnd + 1;
  const cs = (ref, s, txt) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(txt))}</t></is></c>`;
  const ce = (ref, s) => `<c r="${ref}" s="${s}" t="n"></c>`;
  let xml = `<row r="${titoloRow}">` +
    cs(`B${titoloRow}`, 31, titolo) + ce(`C${titoloRow}`, 4) + ce(`D${titoloRow}`, 15) +
    ce(`E${titoloRow}`, 16) + ce(`F${titoloRow}`, 16) + ce(`G${titoloRow}`, 16) + ce(`H${titoloRow}`, 16) +
    `</row>`;
  xml += `<row r="${headerRow}">` +
    cs(`B${headerRow}`, 23, " INDIRIZZO SEDE/AGENZIA") + ce(`C${headerRow}`, 27) +
    cs(`D${headerRow}`, 24, "N. CONSUNTIVO") + cs(`E${headerRow}`, 25, "DATA INTERVENTO") +
    cs(`F${headerRow}`, 25, "TOTALE  ") + cs(`G${headerRow}`, 23, "ODL ") +
    cs(`H${headerRow}`, 26, "NOTA INTERVENTO ") +
    `</row>`;
  for (let r = dataStart; r <= dataEnd; r++) {
    xml += `<row r="${r}">` + ce(`B${r}`, 10) + ce(`C${r}`, 10) + ce(`D${r}`, 10) +
      ce(`E${r}`, 10) + ce(`F${r}`, 21) + ce(`G${r}`, 10) + ce(`H${r}`, 10) + `</row>`;
  }
  xml += `<row r="${formulaRow}"><c r="F${formulaRow}" s="28"><f>SUM(F${dataStart}:F${dataEnd})</f><v>${totale || 0}</v></c></row>`;
  return { xml, formulaRow };
}

async function costruisciExcelMese(yyyymm, consuntiviCbre, baseBytes = null) {
  // 1. Carico il file di base: se mi è stato passato un file esistente (Opzione A:
  //    mantiene colori e note dell'utente) uso quello, altrimenti il template pulito.
  const templateBytes = baseBytes || base64ToBytes(TEMPLATE_EXCEL_BASE64);

  // 2. Apro come ZIP
  const zip = await JSZip.loadAsync(templateBytes);

  // 3. Leggo i due file XML che mi servono
  let sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  let sharedXml = "";
  if (zip.file("xl/sharedStrings.xml")) {
    sharedXml = await zip.file("xl/sharedStrings.xml").async("string");
  }
  // Stili: serve per colorare le righe in base allo stato pagamento
  let stylesXml = zip.file("xl/styles.xml") ? await zip.file("xl/styles.xml").async("string") : null;
  const gestoreColori = stylesXml ? creaGestoreColori(stylesXml) : null;

  // 4. Aggiorno i titoli arancioni (sostituendo nome del mese)
  // I titoli possono essere in sharedStrings.xml (formato Excel originale) o
  // direttamente inline nel sheet1.xml (formato openpyxl), li sostituisco in entrambi
  const meseLabel = meseAnnoLabel(yyyymm);
  const meseRegex = /(GENNAIO|FEBBRAIO|MARZO|APRILE|MAGGIO|GIUGNO|LUGLIO|AGOSTO|SETTEMBRE|OTTOBRE|NOVEMBRE|DICEMBRE)\s+\d{4}/gi;
  if (sharedXml) {
    sharedXml = sharedXml.replace(meseRegex, meseLabel);
  }
  // Anche sheetXml (per titoli inline)
  sheetXml = sheetXml.replace(meseRegex, meseLabel);

  // 5. Raggruppo i consuntivi per sezioneExcel
  const perSezione = {};
  consuntiviCbre.forEach(c => {
    if (!c.sezioneExcel) return;
    perSezione[c.sezioneExcel] = perSezione[c.sezioneExcel] || [];
    perSezione[c.sezioneExcel].push(c);
  });
  for (const k of Object.keys(perSezione)) {
    perSezione[k].sort((a,b) => {
      // Ordine: prima i consuntivi normali (per numero), poi i preventivi, poi le righe manuali
      const rank = (x) => x._manuale ? 2 : (x._prev ? 1 : 0);
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (a.numero || 999999) - (b.numero || 999999);
    });
  }

  // ============================================================
  // 5b. ESPANSIONE DINAMICA: se una sezione ha più consuntivi delle
  // righe disponibili, allungo la sezione duplicando le righe.
  // Per farlo, lavoro sulle sezioni in ordine INVERSO (dall'ultima
  // alla prima) così non devo ricalcolare gli indici.
  // ============================================================
  const sezioniOrder = ["bnl", "torre_diamante", "mediobanca", "ceva", "bdb", "padovani", "keller"];
  // Calcolo righe extra necessarie per ogni sezione
  const righeExtra = {};
  for (const sezKey of sezioniOrder) {
    const sez = SEZIONI_EXCEL[sezKey];
    const righe = perSezione[sezKey] || [];
    const maxRighe = sez.endRow - sez.startRow + 1;
    if (righe.length > maxRighe) {
      righeExtra[sezKey] = righe.length - maxRighe;
      console.log(`Sezione ${sezKey}: ${righe.length} consuntivi, ${maxRighe} righe template → +${righeExtra[sezKey]} righe da aggiungere`);
    }
  }

  // Creo una copia mutevole della mappa SEZIONI_EXCEL che aggiornerò man mano
  const sezDinamiche = {};
  for (const k of sezioniOrder) {
    sezDinamiche[k] = { ...SEZIONI_EXCEL[k] };
  }

  // Espando sezioni dall'ULTIMA alla PRIMA (così i calcoli sono semplici)
  // Quando espando una sezione, sposto giù tutte le sezioni che vengono dopo
  for (let i = sezioniOrder.length - 1; i >= 0; i--) {
    const sezKey = sezioniOrder[i];
    const extra = righeExtra[sezKey] || 0;
    if (extra <= 0) continue;

    const sez = sezDinamiche[sezKey];
    console.log(`Espando sezione ${sezKey} di ${extra} righe (era ${sez.startRow}-${sez.endRow})`);
    sheetXml = espandiSezione(sheetXml, sez.endRow, extra);

    // Aggiorno gli indici della sezione corrente: ha più righe ora
    sez.endRow += extra;
    sez.formulaRow += extra;

    // Aggiorno gli indici di TUTTE le sezioni successive (sono scese giù)
    for (let j = i + 1; j < sezioniOrder.length; j++) {
      const sezDopo = sezDinamiche[sezioniOrder[j]];
      sezDopo.titoloRow += extra;
      sezDopo.startRow += extra;
      sezDopo.endRow += extra;
      sezDopo.formulaRow += extra;
    }
  }

  // 6. Costruisco la mappa cella → nuovo valore
  // Per ogni sezione, definisco cosa scrivere nelle celle B/D/E/F/G/H
  const cellEdits = {}; // es. "B5": { type: "string", value: "..." }

  // 6a. Prima pulisco TUTTE le celle dati di tutte le sezioni (usando indici aggiornati)
  for (const sez of Object.values(sezDinamiche)) {
    for (let r = sez.startRow; r <= sez.endRow; r++) {
      for (const col of ['B', 'D', 'E', 'F', 'G', 'H']) {
        cellEdits[`${col}${r}`] = { clear: true };
      }
    }
  }

  // 6b. Poi imposto i valori per i consuntivi (usando indici aggiornati)
  for (const [sezKey, righe] of Object.entries(perSezione)) {
    const sez = sezDinamiche[sezKey];
    if (!sez) continue;
    const maxRighe = sez.endRow - sez.startRow + 1;
    righe.slice(0, maxRighe).forEach((c, i) => {
      const r = sez.startRow + i;
      const annoNum = c.dataDocumento ? c.dataDocumento.split("-")[0] : new Date().getFullYear();
      // Numero consuntivo: se manca (consuntivo importato senza numero, es. PRESIDIO FIGUS), lascio vuoto
      let numeroCell;
      if (c._manuale) {
        numeroCell = c.numeroLibero || "";
      } else if (c._prev) {
        numeroCell = `PREV ${c.numero}/${annoNum}`;
      } else {
        numeroCell = (c.numero === null || c.numero === undefined || c.numero === "" || c.senzaNumero || c.numero >= 900000)
          ? ""
          : `${c.numero}/${annoNum}`;
      }
      const _fill = COLORI_EXCEL[c.statoPagamento] || null;
      cellEdits[`B${r}`] = { type: "inlineStr", value: (c.sede || "").toUpperCase(), colorFill: _fill };
      cellEdits[`D${r}`] = { type: "inlineStr", value: numeroCell, colorFill: _fill };
      cellEdits[`E${r}`] = { type: "inlineStr", value: c.dataIntervento || "", colorFill: _fill };
      // Per le righe manuali scrivo il totale come stringa formattata (es. 13.390,00)
      // per le righe normali lo scrivo come numero (il formato della cella lo gestisce)
      if (c._manuale) {
        const totStr = (c.totale || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        cellEdits[`F${r}`] = { type: "inlineStr", value: totStr, colorFill: _fill };
      } else {
        cellEdits[`F${r}`] = { type: "number", value: c.totale || 0, colorFill: _fill };
      }
      cellEdits[`G${r}`] = { type: "inlineStr", value: c.odl || "", colorFill: _fill };
      cellEdits[`H${r}`] = { type: "inlineStr", value: c.notaExcel || "", colorFill: _fill };
      // Coloro anche la colonna C (vuota) per non lasciare un buco bianco nella riga
      if (_fill) cellEdits[`C${r}`] = { clear: true, colorFill: _fill };
    });
  }

  // 6c. CLIENTI PERSONALIZZATI: per ogni cliente custom con consuntivi nel mese
  //     creo un blocco in fondo al foglio (titolo + intestazioni + righe + totale).
  const _chiaviFisse = new Set(sezioniOrder);
  const _clientiCustom = Object.keys(perSezione).filter(k => k && !_chiaviFisse.has(k));
  if (_clientiCustom.length > 0) {
    let _cursore = Math.max(...[...sheetXml.matchAll(/<row r="(\d+)"/g)].map(m => parseInt(m[1], 10))) + 2;
    const _blocchi = [];
    for (const k of _clientiCustom) {
      const righeC = perSezione[k];
      const n = Math.max(righeC.length, 1);
      const titolo = `RIEPILOGO ATTIVITA' ${(NOMI_SEZIONI_EXCEL[k] || k)} MESE DI ${meseLabel}`;
      const titoloRow = _cursore;
      const dataStart = titoloRow + 2;
      const totaleBlocco = righeC.reduce((s, c) => s + (Number(c.totale) || 0), 0);
      const ris = scheletroBloccoCustom(titoloRow, titolo, n, totaleBlocco);
      _blocchi.push(ris.xml);
      righeC.slice(0, n).forEach((c, i) => {
        const r = dataStart + i;
        const annoNum = c.dataDocumento ? c.dataDocumento.split("-")[0] : new Date().getFullYear();
        let numeroCell;
        if (c._manuale) numeroCell = c.numeroLibero || "";
        else if (c._prev) numeroCell = `PREV ${c.numero}/${annoNum}`;
        else numeroCell = (c.numero === null || c.numero === undefined || c.numero === "" || c.senzaNumero || c.numero >= 900000) ? "" : `${c.numero}/${annoNum}`;
        const _fill = COLORI_EXCEL[c.statoPagamento] || null;
        cellEdits[`B${r}`] = { type: "inlineStr", value: (c.sede || "").toUpperCase(), colorFill: _fill };
        cellEdits[`D${r}`] = { type: "inlineStr", value: numeroCell, colorFill: _fill };
        cellEdits[`E${r}`] = { type: "inlineStr", value: c.dataIntervento || "", colorFill: _fill };
        if (c._manuale) {
          const totStr = (c.totale || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          cellEdits[`F${r}`] = { type: "inlineStr", value: totStr, colorFill: _fill };
        } else {
          cellEdits[`F${r}`] = { type: "number", value: c.totale || 0, colorFill: _fill };
        }
        cellEdits[`G${r}`] = { type: "inlineStr", value: c.odl || "", colorFill: _fill };
        cellEdits[`H${r}`] = { type: "inlineStr", value: c.notaExcel || "", colorFill: _fill };
        if (_fill) cellEdits[`C${r}`] = { clear: true, colorFill: _fill };
      });
      _cursore = ris.formulaRow + 2;
    }
    sheetXml = sheetXml.replace("</sheetData>", _blocchi.join("") + "</sheetData>");
    const _nuovaMax = _cursore - 2;
    sheetXml = sheetXml.replace(/<dimension ref="[^"]*"/, `<dimension ref="A2:X${_nuovaMax}"`);
  }

  // 7. Applico le modifiche al sheet XML
  sheetXml = applicaModificheCelle(sheetXml, cellEdits, gestoreColori);

  // 8. Riscrivo i file modificati nello zip
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  if (sharedXml) {
    zip.file("xl/sharedStrings.xml", sharedXml);
  }
  if (gestoreColori && stylesXml) {
    zip.file("xl/styles.xml", gestoreColori.applicaAStyles(stylesXml));
  }

  // 9. Genero il blob finale
  const arrayBuffer = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE"
  });

  return new Uint8Array(arrayBuffer);
}

// ============================================================
// ESPANDI SEZIONE: aggiunge N righe a una sezione duplicando l'ULTIMA
// riga di dati e spostando giù tutte le righe successive del sheet XML.
//
// Parametri:
// - sheetXml: stringa XML del foglio
// - ultimaRigaDati: numero dell'ultima riga dati attuale della sezione (es. 25 per BNL)
// - N: quante righe aggiungere
//
// Logica:
// 1. Estraggo dal sheetXml la riga ultimaRigaDati come "stampino"
// 2. Sposto giù di N tutte le righe DOPO ultimaRigaDati
// 3. Inserisco N righe duplicate appena dopo ultimaRigaDati
// 4. Aggiorno tutte le formule SUM che fanno riferimento a celle spostate
// ============================================================
function espandiSezione(sheetXml, ultimaRigaDati, N) {
  if (N <= 0) return sheetXml;

  // 1. Trovo il blocco <row r="ultimaRigaDati">...</row> come stampino
  const stampinoRegex = new RegExp(`<row r="${ultimaRigaDati}"[^>]*>[\\s\\S]*?</row>`, "");
  const stampinoMatch = sheetXml.match(stampinoRegex);
  if (!stampinoMatch) {
    console.error(`Impossibile espandere: riga ${ultimaRigaDati} non trovata in sheet`);
    return sheetXml;
  }
  const stampinoXml = stampinoMatch[0];

  // 2. Trovo TUTTE le righe e le rinumero
  // Pattern per match di una riga: <row r="N" ...>...</row>
  const rowPattern = /<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g;

  const rowsNew = [];
  let match;
  while ((match = rowPattern.exec(sheetXml)) !== null) {
    const numRiga = parseInt(match[1]);
    const attrs = match[2];
    const contenuto = match[3];
    if (numRiga <= ultimaRigaDati) {
      // Resta uguale
      rowsNew.push({ num: numRiga, attrs, contenuto, originale: numRiga });
    } else {
      // Sposta giù di N
      rowsNew.push({ num: numRiga + N, attrs, contenuto, originale: numRiga });
    }
  }

  // 3. Aggiungo N righe duplicate dopo ultimaRigaDati
  for (let k = 1; k <= N; k++) {
    rowsNew.push({
      num: ultimaRigaDati + k,
      attrs: extractRowAttrs(stampinoXml),
      contenuto: extractRowContent(stampinoXml),
      originale: ultimaRigaDati,
      isClone: true
    });
  }

  // 4. Riordino per num crescente
  rowsNew.sort((a, b) => a.num - b.num);

  // 5. Ricostruisco le righe: aggiorno gli attributi r="..." delle celle
  //    Per ogni cella <c r="A5" ..., cambio "5" col numero giusto
  const nuoveRighe = rowsNew.map(row => {
    let nuovoContenuto = row.contenuto;
    // Aggiorno tutti gli attributi r="LetteraN" nelle celle di questa riga
    nuovoContenuto = nuovoContenuto.replace(/<c r="([A-Z]+)(\d+)"/g, (m, col, _n) => {
      return `<c r="${col}${row.num}"`;
    });
    // Aggiorno le formule SUM presenti nel contenuto (potrebbero esserci range come F5:F25)
    nuovoContenuto = nuovoContenuto.replace(/<f>([\s\S]*?)<\/f>/g, (m, formula) => {
      const nuovaFormula = aggiornaFormula(formula, ultimaRigaDati, N);
      return `<f>${nuovaFormula}</f>`;
    });
    // Se è un clone (nuova riga), svuoto le celle (B/D/E/F/G/H) per non duplicare dati
    if (row.isClone) {
      // Tolgo eventuali formule (la riga stampino dovrebbe essere dati, ma per sicurezza)
      // Inoltre le celle dovrebbero essere già vuote, ma le svuoto comunque
      // qui in realtà non serve perché poi cellEdits.clear le pulirà
    }
    return `<row r="${row.num}"${row.attrs}>${nuovoContenuto}</row>`;
  });

  // 6. Sostituisco l'intero blocco <sheetData>...</sheetData> nel sheetXml
  const sheetDataMatch = sheetXml.match(/<sheetData>[\s\S]*?<\/sheetData>/);
  if (sheetDataMatch) {
    const nuovoSheetData = `<sheetData>${nuoveRighe.join("")}</sheetData>`;
    sheetXml = sheetXml.replace(sheetDataMatch[0], nuovoSheetData);
  }

  // 7. Aggiorno anche eventuali range esterni a sheetData (es. dimension)
  // Aggiorno <dimension ref="A1:X100"/>
  sheetXml = sheetXml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g, (m, c1, r1, c2, r2) => {
    const r1n = parseInt(r1);
    const r2n = parseInt(r2);
    const newR1 = r1n > ultimaRigaDati ? r1n + N : r1n;
    const newR2 = r2n > ultimaRigaDati ? r2n + N : r2n;
    return `<dimension ref="${c1}${newR1}:${c2}${newR2}"`;
  });

  // 8. Aggiorno eventuali mergeCells
  sheetXml = sheetXml.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g, (m, c1, r1, c2, r2) => {
    const r1n = parseInt(r1);
    const r2n = parseInt(r2);
    const newR1 = r1n > ultimaRigaDati ? r1n + N : r1n;
    const newR2 = r2n > ultimaRigaDati ? r2n + N : r2n;
    return `<mergeCell ref="${c1}${newR1}:${c2}${newR2}"`;
  });

  return sheetXml;
}

// Estrae solo gli attributi di una riga (r="..." escluso)
function extractRowAttrs(rowXml) {
  const m = rowXml.match(/<row r="\d+"([^>]*)>/);
  return m ? m[1] : "";
}

// Estrae solo il contenuto di una riga (le celle <c>...</c>)
function extractRowContent(rowXml) {
  const m = rowXml.match(/<row r="\d+"[^>]*>([\s\S]*?)<\/row>/);
  return m ? m[1] : "";
}

// Aggiorna una formula: se contiene riferimenti tipo F5:F25, e abbiamo aggiunto N righe
// alla sezione che termina a "ultimaRigaDati", estendo il range:
// - Se la formula referenzia una cella PRIMA o UGUALE a ultimaRigaDati: estendo l'end se è uguale
// - Se la formula referenzia una cella DOPO ultimaRigaDati: aggiungo N a tutti i riferimenti
function aggiornaFormula(formula, ultimaRigaDati, N) {
  // Pattern per riferimenti cella: A1 o A1:A25
  return formula.replace(/([A-Z]+)(\d+)(:([A-Z]+)(\d+))?/g, (m, col1, n1, hasRange, col2, n2) => {
    const num1 = parseInt(n1);
    if (hasRange) {
      const num2 = parseInt(n2);
      // Caso classico: SUM(F5:F25) e ultimaRigaDati=25, N=2 → SUM(F5:F27)
      // Estendo l'estremo superiore SE è uguale a ultimaRigaDati
      let newN1 = num1, newN2 = num2;
      if (num2 === ultimaRigaDati) {
        newN2 = num2 + N;
      } else if (num2 > ultimaRigaDati) {
        newN2 = num2 + N;
      }
      if (num1 > ultimaRigaDati) {
        newN1 = num1 + N;
      }
      return `${col1}${newN1}:${col2}${newN2}`;
    } else {
      // Riferimento singolo
      if (num1 > ultimaRigaDati) {
        return `${col1}${num1 + N}`;
      }
      return m;
    }
  });
}

// Colori dello stato pagamento per l'Excel (formato ARGB: FF + esadecimale)
const COLORI_EXCEL = { pagato: "FFE8C84B", parziale: "FFBFE3F5" };

// Gestore colori Excel: aggiunge i riempimenti (fills) e crea AL VOLO le varianti
// colorate degli stili delle celle, mantenendo bordi/font/allineamento originali.
function creaGestoreColori(stylesXml) {
  const fillsMatch = stylesXml.match(/<fills count="(\d+)">([\s\S]*?)<\/fills>/);
  const xfsMatch = stylesXml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!fillsMatch || !xfsMatch) {
    return { xfColorato: (o) => o, applicaAStyles: (x) => x };
  }
  const fillCount = parseInt(fillsMatch[1], 10);
  const xfCount = parseInt(xfsMatch[1], 10);
  const xfEsistenti = xfsMatch[2].match(/<xf[^>]*?\/>|<xf[^>]*?>[\s\S]*?<\/xf>/g) || [];
  const fillsAggiunti = [];
  const xfsAggiunti = [];
  const fillIdCache = {};
  const xfCache = {};

  function fillIdPerColore(hex) {
    if (fillIdCache[hex] !== undefined) return fillIdCache[hex];
    const id = fillCount + fillsAggiunti.length;
    fillsAggiunti.push(`<fill><patternFill patternType="solid"><fgColor rgb="${hex}"/><bgColor indexed="64"/></patternFill></fill>`);
    fillIdCache[hex] = id;
    return id;
  }
  function xfColorato(origXf, hex) {
    const key = origXf + "|" + hex;
    if (xfCache[key] !== undefined) return xfCache[key];
    const fillId = fillIdPerColore(hex);
    const base = xfEsistenti[origXf] || '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';
    let nuovo = /fillId="\d+"/.test(base)
      ? base.replace(/fillId="\d+"/, `fillId="${fillId}"`)
      : base.replace(/<xf /, `<xf fillId="${fillId}" `);
    if (!/applyFill=/.test(nuovo)) nuovo = nuovo.replace(/<xf /, `<xf applyFill="1" `);
    const id = xfCount + xfsAggiunti.length;
    xfsAggiunti.push(nuovo);
    xfCache[key] = id;
    return id;
  }
  function applicaAStyles(xml) {
    let out = xml;
    if (fillsAggiunti.length) {
      out = out.replace(/<fills count="\d+">/, `<fills count="${fillCount + fillsAggiunti.length}">`)
               .replace("</fills>", () => fillsAggiunti.join("") + "</fills>");
    }
    if (xfsAggiunti.length) {
      out = out.replace(/<cellXfs count="\d+">/, `<cellXfs count="${xfCount + xfsAggiunti.length}">`)
               .replace("</cellXfs>", () => xfsAggiunti.join("") + "</cellXfs>");
    }
    return out;
  }
  return { xfColorato, applicaAStyles };
}

// Modifica le celle XML mantenendo intatti gli stili
// cellEdits: { "B5": { clear: true } o { type: "inlineStr"|"number", value: ... } }
function applicaModificheCelle(sheetXml, cellEdits, gestoreColori) {
  // Pattern per match di una cella: <c r="..." [s="..."] [t="..."]>...</c> oppure self-closing <c r="..." /> 
  const pattern = /<c\s+([^/>]*?)\s*(?:\/>|>([\s\S]*?)<\/c>)/g;

  // Prima passata: modifica le celle esistenti
  const celleGiaScritte = new Set();
  let xml = sheetXml.replace(pattern, (match, attrs, content) => {
    const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
    if (!refMatch) return match;
    const ref = refMatch[1];

    const edit = cellEdits[ref];
    if (!edit) return match;

    celleGiaScritte.add(ref);

    const styleMatch = attrs.match(/s="(\d+)"/);
    let styleAttr = styleMatch ? ` s="${styleMatch[1]}"` : "";
    if (edit.colorFill && gestoreColori) {
      const origXf = styleMatch ? parseInt(styleMatch[1], 10) : 0;
      styleAttr = ` s="${gestoreColori.xfColorato(origXf, edit.colorFill)}"`;
    }

    if (edit.clear) return `<c r="${ref}"${styleAttr}/>`;
    if (edit.type === "number") return `<c r="${ref}"${styleAttr}><v>${edit.value}</v></c>`;
    if (edit.type === "inlineStr") {
      const escapedVal = escapeXml(String(edit.value));
      return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapedVal}</t></is></c>`;
    }
    return match;
  });

  // Seconda passata: inserisce le celle che non esistevano nell'XML
  // Raggruppa le celle mancanti per riga
  const celleMancanti = {};
  for (const [ref, edit] of Object.entries(cellEdits)) {
    if (celleGiaScritte.has(ref) || edit.clear) continue;
    const rowMatch = ref.match(/^([A-Z]+)(\d+)$/);
    if (!rowMatch) continue;
    const rowNum = rowMatch[2];
    if (!celleMancanti[rowNum]) celleMancanti[rowNum] = [];
    celleMancanti[rowNum].push({ ref, edit, col: rowMatch[1] });
  }

  // Per ogni riga con celle mancanti, inserisce le celle nel tag <row>
  for (const [rowNum, celle] of Object.entries(celleMancanti)) {
    const rowPattern = new RegExp(`(<row[^>]*\\br="${rowNum}"[^>]*>)([\\s\\S]*?)(</row>)`);
    const rowMatch = xml.match(rowPattern);

    // Costruisce le nuove celle XML
    let nuoveCelleXml = "";
    for (const { ref, edit } of celle) {
      let styleAttr = "";
      if (edit.colorFill && gestoreColori) {
        styleAttr = ` s="${gestoreColori.xfColorato(0, edit.colorFill)}"`;
      }
      if (edit.type === "number") {
        nuoveCelleXml += `<c r="${ref}"${styleAttr}><v>${edit.value}</v></c>`;
      } else if (edit.type === "inlineStr") {
        const escapedVal = escapeXml(String(edit.value));
        nuoveCelleXml += `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapedVal}</t></is></c>`;
      }
    }

    if (!nuoveCelleXml) continue;

    if (rowMatch) {
      // Riga esiste: aggiunge le celle dentro
      xml = xml.replace(rowPattern, (m, open, content, close) => {
        return open + content + nuoveCelleXml + close;
      });
    } else {
      // Riga non esiste: la crea prima di </sheetData>
      const newRow = `<row r="${rowNum}">${nuoveCelleXml}</row>`;
      xml = xml.replace("</sheetData>", newRow + "</sheetData>");
    }
  }

  return xml;
}

// Helper: setta cella mantenendo stile
function setCell(ws, addr, value) {
  if (!ws[addr]) ws[addr] = { t: "s" };
  ws[addr].v = value;
  ws[addr].t = "s";
  if ("w" in ws[addr]) ws[addr].w = String(value);
}

function setCellNum(ws, addr, value) {
  if (!ws[addr]) ws[addr] = { t: "n" };
  ws[addr].v = value;
  ws[addr].t = "n";
  if ("w" in ws[addr]) ws[addr].w = String(value);
}

// Rigenera e salva il file Excel del mese (Scenario C)
// Viene chiamato automaticamente dopo ogni nuovo consuntivo CBRE
// Raccoglie i dati per l'Excel CBRE del mese: consuntivi CBRE + preventivi
// ACCETTATI destinati a quel file Excel (campo excelMese/excelSezione).
// Usata SIA dalla scrittura SIA dall'import, così le posizioni combaciano sempre.
async function listaCbreConPreventiviAccettati(yyyymm, forzaRilettura = false) {
  let consuntiviCbre;
  if (yyyymm === state.meseCorrente && !forzaRilettura) {
    consuntiviCbre = state.consuntiviMese.filter(c => c.tipo === "cbre");
  } else {
    const q = fb.query(fb.collection(fb.db, "consuntivi"),
                       fb.where("mese", "==", yyyymm),
                       fb.where("tipo", "==", "cbre"));
    const snap = await fb.getDocs(q);
    consuntiviCbre = [];
    snap.forEach(d => consuntiviCbre.push({ id: d.id, ...d.data() }));
  }

  // Deduplica le righe dei preventivi accettati: se per errore esistono più
  // righe con lo stesso preventivoId (es. accettato più volte in passato),
  // tengo solo la più recente ed elimino le altre da Firestore.
  try {
    const perPrev = {};
    consuntiviCbre.forEach(c => {
      if (c.preventivoId) {
        (perPrev[c.preventivoId] = perPrev[c.preventivoId] || []).push(c);
      }
    });
    const idDaRimuovere = new Set();
    for (const pid of Object.keys(perPrev)) {
      const righe = perPrev[pid];
      if (righe.length > 1) {
        // Ordino per creatoIl (più recente in cima), tengo la prima
        righe.sort((a, b) => String(b.creatoIl || "").localeCompare(String(a.creatoIl || "")));
        for (let i = 1; i < righe.length; i++) {
          idDaRimuovere.add(righe[i].id);
          try { await fb.deleteDoc(fb.doc(fb.db, "consuntivi", righe[i].id)); } catch (e) {}
        }
      }
    }
    if (idDaRimuovere.size) {
      consuntiviCbre = consuntiviCbre.filter(c => !idDaRimuovere.has(c.id));
    }
  } catch (e) { console.warn("Deduplica preventivi accettati:", e); }

  // Preventivi accettati: NON li leggo più dalla collection "preventivi".
  // Ora quando un preventivo viene accettato viene salvata una riga nella
  // collection "consuntivi" (tipo:"cbre", nota "PREVENTIVO NR X ACCETTATO"),
  // quindi è già incluso in consuntiviCbre qui sopra. Questo evita la doppia
  // riga (OFFERTA + ACCETTATO) e mostra solo gli accettati.
  const pseudo = [];

  // Righe manuali (inserite a mano nella scheda File Excel) destinate a questo mese
  try {
    const qm = fb.query(fb.collection(fb.db, "righe_excel_manuali"),
                        fb.where("excelMese", "==", yyyymm));
    const snapM = await fb.getDocs(qm);
    snapM.forEach(d => {
      const m = d.data();
      if (!m.sezioneExcel) return;
      pseudo.push({
        _manuale: true,         // riga manuale (l'import la salta)
        id: d.id,
        numeroLibero: m.numero || "",   // testo libero, non numerico
        sede: m.indirizzo || "",
        dataDocumento: yyyymm + "-01",  // per ordinamento interno
        dataIntervento: m.data || "",
        odl: m.odl || "",
        notaExcel: m.nota || "",
        totale: m.totale || 0,
        sezioneExcel: m.sezioneExcel,
        // Colore: può venire da statoPagamento o dal campo colore del desktop
        statoPagamento: m.statoPagamento || (m.colore === "giallo" ? "pagato" : m.colore === "azzurro" ? "parziale" : ""),
      });
    });
  } catch (e) { console.warn("Lettura righe manuali per Excel:", e.message); }

  return consuntiviCbre.concat(pseudo);
}

async function aggiornaExcelMese(yyyymm, forzaRicostruzione = false, forzaRilettura = false) {
  // Consuntivi CBRE del mese + preventivi accettati destinati a questo Excel
  const consuntiviCbre = await listaCbreConPreventiviAccettati(yyyymm, forzaRilettura);

  if (!consuntiviCbre.length) {
    console.log(`Nessun dato CBRE per ${yyyymm}, salto creazione Excel`);
    return { ok: false, motivo: "nessun consuntivo" };
  }

  const filename = nomeFileExcelMese(yyyymm);

  // OPZIONE A: se il file Excel esiste già, lo uso come base (mantengo colori/note utente).
  // PROTEZIONE CBRE: uso il file esistente SOLO se non servono righe extra (nessuna
  // sezione supera le righe del template). Se serve espandere, riparto dal template
  // pulito per non rischiare di rompere il file con una doppia espansione.
  let baseBytes = null;
  if (state.isElectron && window.electronAPI.leggiExcelEsistente) {
    try {
      // Controllo se serve espansione: conto i consuntivi per sezione
      const perSez = {};
      consuntiviCbre.forEach(c => {
        if (c.sezioneExcel) perSez[c.sezioneExcel] = (perSez[c.sezioneExcel] || 0) + 1;
      });
      let serveEspansione = false;
      for (const sezKey of Object.keys(perSez)) {
        const sez = SEZIONI_EXCEL[sezKey];
        if (sez) {
          const maxRighe = sez.endRow - sez.startRow + 1;
          if (perSez[sezKey] > maxRighe) { serveEspansione = true; break; }
        }
      }
      // Se ci sono consuntivi per clienti PERSONALIZZATI (sezioni non fisse), riparto
      // sempre dal template pulito: i blocchi custom vengono ricreati da zero, così
      // non si duplicano riutilizzando il file esistente.
      if (!serveEspansione) {
        for (const sezKey of Object.keys(perSez)) {
          if (!SEZIONI_EXCEL[sezKey]) { serveEspansione = true; break; }
        }
      }

      const ris = await window.electronAPI.leggiExcelEsistente(yyyymm, filename);
      if (ris.esiste && ris.bloccato) {
        showToast("⚠️ Il file Excel CBRE è aperto. Chiudilo per aggiornarlo, poi rifai l'operazione.", "warn", 7000);
        return { ok: false, motivo: "file aperto" };
      }
      if (ris.esiste && ris.base64) {
        if (serveEspansione || forzaRicostruzione) {
          // Riparto dal template PULITO (baseBytes resta null) per non lasciare
          // righe "fantasma": serve quando una sezione si espande, oppure quando
          // rigenero dopo un'eliminazione (riga manuale o consuntivo). Riusare il
          // file già espanso lascerebbe la riga cancellata ancora nel file.
          if (serveEspansione && !forzaRicostruzione) {
            showToast("ℹ️ Tante righe in una sezione: l'Excel CBRE è stato rigenerato (eventuali colori manuali su questo file vanno rifatti).", "info", 7000);
          }
        } else {
          baseBytes = base64ToBytes(ris.base64);
        }
      }
    } catch (e) { console.warn("Lettura Excel esistente:", e); }
  }

  const bytesOut = await costruisciExcelMese(yyyymm, consuntiviCbre, baseBytes);

  // === MODALITÀ ELECTRON: salvo direttamente nella cartella mese ===
  if (state.isElectron && state.cartellaRoot) {
    try {
      const arr = Array.from(bytesOut);
      const r = await window.electronAPI.salvaExcelMese(yyyymm, filename, arr);
      if (r.ok) {
        console.log("Excel mese aggiornato:", r.fullPath);
        return { ok: true, path: r.relativePath, fullPath: r.fullPath };
      }
      return { ok: false, errore: r.errore };
    } catch (err) {
      console.error("Errore aggiornaExcelMese:", err);
      return { ok: false, errore: err.message };
    }
  }

  // === MODALITÀ BROWSER: ritorno il buffer per eventuale download manuale ===
  return { ok: true, browserBuffer: bytesOut, filename };
}

// ============================================================
// EXCEL CREVAL - Tabella singola (no sezioni multiple come CBRE)
// ============================================================

// Configurazione del template Excel CREVAL
const CREVAL_EXCEL_CONFIG = {
  startRow: 6,    // prima riga dati
  endRow: 27,     // ultima riga dati possibile
  titoloRow: 2,   // riga del titolo "Riepilogo Consuntivi mese di..."
  formulaRow: 28  // riga della formula SUM imponibile
};

function nomeFileExcelCrevalMese(yyyymm) {
  // Il numero davanti segue il mese: gennaio=001, giugno=006, dicembre=012
  const numMese = yyyymm.split("-")[1].padStart(3, "0");
  return `${numMese} FORMAT RIEPILOGO CONSUNTIVI CREVAL ${meseAnnoLabel(yyyymm)}.xlsx`;
}

// Costruisce il file Excel CREVAL del mese modificando DIRETTAMENTE l'XML interno
// NOVITÀ: se ci sono più consuntivi delle 22 righe del template, le righe vengono
// AGGIUNTE dinamicamente, senza limite massimo
async function costruisciExcelCrevalMese(yyyymm, consuntiviCreval, baseBytes = null) {
  // 1. Carico il file di base: file esistente (Opzione A, mantiene colori/note)
  //    oppure il template pulito se è la prima volta.
  const templateBytes = baseBytes || base64ToBytes(TEMPLATE_EXCEL_CREVAL_BASE64);

  // 2. Apro come ZIP
  const zip = await JSZip.loadAsync(templateBytes);

  // 3. Leggo gli XML
  let sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  let sharedXml = "";
  if (zip.file("xl/sharedStrings.xml")) {
    sharedXml = await zip.file("xl/sharedStrings.xml").async("string");
  }
  let stylesXml = zip.file("xl/styles.xml") ? await zip.file("xl/styles.xml").async("string") : null;
  const gestoreColori = stylesXml ? creaGestoreColori(stylesXml) : null;

  // 4. Aggiorno il mese nel titolo
  const meseLabel = meseAnnoLabel(yyyymm);
  const meseRegex = /(GENNAIO|FEBBRAIO|MARZO|APRILE|MAGGIO|GIUGNO|LUGLIO|AGOSTO|SETTEMBRE|OTTOBRE|NOVEMBRE|DICEMBRE)\s+\d{4}/gi;
  if (sharedXml) {
    sharedXml = sharedXml.replace(meseRegex, meseLabel);
  }
  sheetXml = sheetXml.replace(meseRegex, meseLabel);

  // 5. Ordino consuntivi per numero
  const righe = consuntiviCreval.slice().sort((a,b) => (a.numero || 999999) - (b.numero || 999999));

  // 5b. ESPANSIONE DINAMICA: se servono più di 22 righe, le aggiungo
  const startRow = CREVAL_EXCEL_CONFIG.startRow;
  let endRow = CREVAL_EXCEL_CONFIG.endRow;
  let formulaRow = CREVAL_EXCEL_CONFIG.formulaRow;
  const maxRigheTemplate = endRow - startRow + 1;
  let extra = 0;
  if (righe.length > maxRigheTemplate) {
    extra = righe.length - maxRigheTemplate;
    console.log(`CREVAL: ${righe.length} consuntivi, ${maxRigheTemplate} righe template → +${extra} righe da aggiungere`);
    sheetXml = espandiSezione(sheetXml, endRow, extra);
    endRow += extra;
    formulaRow += extra;
  }

  // 6. Costruisco la mappa cella → valore
  const cellEdits = {};

  // 6a. Pulisco TUTTE le celle dati (B-L, righe da startRow a endRow aggiornato)
  for (let r = startRow; r <= endRow; r++) {
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) {
      cellEdits[`${col}${r}`] = { clear: true };
    }
  }

  // 6b. Scrivo i consuntivi
  righe.forEach((c, i) => {
    const r = startRow + i;
    const annoNum = c.dataDocumento ? c.dataDocumento.split("-")[0] : new Date().getFullYear();
    const costoOre = (c.ore || 0) * (c.tariffaOraria || 0);
    // Uso il totale salvato se presente (consuntivi importati a mano), altrimenti lo calcolo
    const totale = (c.totale !== undefined && c.totale !== null && c.totale !== 0)
      ? c.totale
      : costoOre + (c.costoMateriale || 0) + (c.smaltimento || 0);
    // Numero consuntivo: vuoto se manca (importato senza numero) OPPURE
    // se è stato creato con "Solo Excel" (nascondiNumeroExcel)
    const numeroCell = (c.numero === null || c.numero === undefined || c.numero === "" || c.senzaNumero || c.numero >= 900000 || c.nascondiNumeroExcel)
      ? ""
      : `${c.numero}/${annoNum}`;

    const _fill = COLORI_EXCEL[c.statoPagamento] || null;
    cellEdits[`B${r}`] = { type: "inlineStr", value: (c.sede || "").toUpperCase(), colorFill: _fill };
    cellEdits[`C${r}`] = { type: "inlineStr", value: c.crevalProvincia || "", colorFill: _fill };
    cellEdits[`D${r}`] = { type: "inlineStr", value: c.crevalRegione || "LOMBARDIA", colorFill: _fill };
    cellEdits[`E${r}`] = { type: "inlineStr", value: c.crevalTicket || "", colorFill: _fill };
    cellEdits[`F${r}`] = { type: "inlineStr", value: c.crevalOdlNumero || "", colorFill: _fill };
    cellEdits[`G${r}`] = { type: "inlineStr", value: numeroCell, colorFill: _fill };
    cellEdits[`H${r}`] = { type: "inlineStr", value: c.descrizione || "", colorFill: _fill };
    cellEdits[`I${r}`] = { type: "inlineStr", value: c.dataIntervento || "", colorFill: _fill };
    // Colonna ORE: totale finale = ore normali + ore extra (richiesta CREVAL)
    cellEdits[`J${r}`] = { type: "number", value: (c.ore || 0) + (c.oreExtra || 0), colorFill: _fill };
    if (c.costoMateriale && c.costoMateriale !== 0) {
      cellEdits[`K${r}`] = { type: "number", value: c.costoMateriale, colorFill: _fill };
    } else {
      cellEdits[`K${r}`] = { clear: true, colorFill: _fill };
    }
    cellEdits[`L${r}`] = { type: "number", value: totale, colorFill: _fill };
  });

  // 7. Applico le modifiche
  sheetXml = applicaModificheCelle(sheetXml, cellEdits, gestoreColori);

  // 8. Riscrivo lo zip
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  if (sharedXml) {
    zip.file("xl/sharedStrings.xml", sharedXml);
  }
  if (gestoreColori && stylesXml) {
    zip.file("xl/styles.xml", gestoreColori.applicaAStyles(stylesXml));
  }

  // 9. Genero il file
  const arrayBuffer = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE"
  });

  return new Uint8Array(arrayBuffer);
}

// Rigenera e salva il file Excel CREVAL del mese (Scenario C)
// ============================================================
// IMPORTAZIONE MODIFICHE MANUALI EXCEL → FIREBASE
// ============================================================
// All'avvio, legge l'Excel del mese corrente e, se l'utente ha corretto
// a mano delle celle di testo, riporta le modifiche su Firebase.
// Abbinamento riga→consuntivo per posizione, con verifica del numero.

function decodeXmlImport(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Estrae il valore di una cella dall'XML del foglio
function leggiValoreCella(sheetXml, sharedStrings, ref) {
  const re = new RegExp(`<c\\s+[^>]*?r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`, "");
  const m = sheetXml.match(re);
  if (!m) return "";
  const cellaIntera = m[0];
  const contenuto = m[1] || "";
  if (!contenuto) return "";
  const tMatch = contenuto.match(/<t[^>]*>([\s\S]*?)<\/t>/);
  if (cellaIntera.includes('t="inlineStr"') && tMatch) {
    return decodeXmlImport(tMatch[1]);
  }
  if (cellaIntera.includes('t="s"')) {
    const vMatch = contenuto.match(/<v>(\d+)<\/v>/);
    if (vMatch && sharedStrings) {
      return sharedStrings[parseInt(vMatch[1])] || "";
    }
  }
  const vMatch = contenuto.match(/<v>([\s\S]*?)<\/v>/);
  if (vMatch) return decodeXmlImport(vMatch[1]);
  return "";
}

function estraiSharedStrings(sharedXml) {
  if (!sharedXml) return [];
  const strings = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(sharedXml)) !== null) {
    const tMatch = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
    strings.push(tMatch ? decodeXmlImport(tMatch[1]) : "");
  }
  return strings;
}

// Importa modifiche manuali dall'Excel CREVAL del mese verso Firebase
async function importaModificheExcelCreval(yyyymm) {
  if (!state.isElectron || !window.electronAPI.leggiCelleExcel) return 0;
  const filename = nomeFileExcelCrevalMese(yyyymm);
  let ris;
  try {
    ris = await window.electronAPI.leggiCelleExcel(yyyymm, filename);
  } catch (e) { return 0; }
  if (!ris.esiste || !ris.base64) return 0;

  let sheetXml, sharedStrings;
  try {
    const zip = await JSZip.loadAsync(base64ToBytes(ris.base64));
    sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
    let sharedXml = "";
    if (zip.file("xl/sharedStrings.xml")) {
      sharedXml = await zip.file("xl/sharedStrings.xml").async("string");
    }
    sharedStrings = estraiSharedStrings(sharedXml);
  } catch (e) { console.warn("Lettura Excel CREVAL per import:", e); return 0; }

  const consuntivi = state.consuntiviMese
    .filter(c => c.tipo === "creval")
    .sort((a, b) => (a.numero || 999999) - (b.numero || 999999));

  const annoNum = yyyymm.split("-")[0];
  let modifiche = 0;
  let riga = CREVAL_EXCEL_CONFIG.startRow;

  for (const c of consuntivi) {
    const letti = {
      sede: leggiValoreCella(sheetXml, sharedStrings, `B${riga}`),
      crevalProvincia: leggiValoreCella(sheetXml, sharedStrings, `C${riga}`),
      crevalRegione: leggiValoreCella(sheetXml, sharedStrings, `D${riga}`),
      crevalTicket: leggiValoreCella(sheetXml, sharedStrings, `E${riga}`),
      crevalOdlNumero: leggiValoreCella(sheetXml, sharedStrings, `F${riga}`),
      descrizione: leggiValoreCella(sheetXml, sharedStrings, `H${riga}`),
      dataIntervento: leggiValoreCella(sheetXml, sharedStrings, `I${riga}`)
    };

    // SICUREZZA: verifico il numero (colonna G) prima di importare
    const numeroExcel = leggiValoreCella(sheetXml, sharedStrings, `G${riga}`);
    const numeroAtteso = (c.numero && c.numero < 900000) ? `${c.numero}/${annoNum}` : "";
    if (numeroExcel && numeroAtteso && numeroExcel !== numeroAtteso) {
      riga++;
      continue;
    }

    const updates = {};
    for (const campo of Object.keys(letti)) {
      const valExcel = (letti[campo] || "").trim();
      const valFb = (c[campo] || "").toString().trim();
      const valFbConfronto = campo === "sede" ? valFb.toUpperCase() : valFb;
      if (valExcel && valExcel !== valFbConfronto) {
        updates[campo] = valExcel;
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        await fb.updateDoc(fb.doc(fb.db, "consuntivi", c.id), updates);
        modifiche++;
      } catch (e) { console.warn("Update da Excel CREVAL:", e); }
    }
    riga++;
  }
  return modifiche;
}

// Importa modifiche manuali dall'Excel CBRE del mese verso Firebase.
// Il CBRE ha sezioni dinamiche: ricalcolo le posizioni come fa la scrittura.
async function importaModificheExcelCbre(yyyymm) {
  if (!state.isElectron || !window.electronAPI.leggiCelleExcel) return 0;
  const filename = nomeFileExcelMese(yyyymm);
  let ris;
  try {
    ris = await window.electronAPI.leggiCelleExcel(yyyymm, filename);
  } catch (e) { return 0; }
  if (!ris.esiste || !ris.base64) return 0;

  let sheetXml, sharedStrings;
  try {
    const zip = await JSZip.loadAsync(base64ToBytes(ris.base64));
    sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
    let sharedXml = "";
    if (zip.file("xl/sharedStrings.xml")) {
      sharedXml = await zip.file("xl/sharedStrings.xml").async("string");
    }
    sharedStrings = estraiSharedStrings(sharedXml);
  } catch (e) { console.warn("Lettura Excel CBRE per import:", e); return 0; }

  const consuntiviCbre = await listaCbreConPreventiviAccettati(yyyymm);
  if (!consuntiviCbre.length) return 0;

  // Raggruppo per sezione (come fa la scrittura)
  const perSezione = {};
  consuntiviCbre.forEach(c => {
    if (!c.sezioneExcel) return;
    perSezione[c.sezioneExcel] = perSezione[c.sezioneExcel] || [];
    perSezione[c.sezioneExcel].push(c);
  });
  for (const k of Object.keys(perSezione)) {
    perSezione[k].sort((a,b) => {
      // Ordine: prima i consuntivi normali (per numero), poi i preventivi, poi le righe manuali
      const rank = (x) => x._manuale ? 2 : (x._prev ? 1 : 0);
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (a.numero || 999999) - (b.numero || 999999);
    });
  }

  // Ricalcolo le posizioni delle sezioni considerando le espansioni
  const sezioniOrder = ["bnl", "torre_diamante", "mediobanca", "ceva", "bdb", "padovani", "keller"];
  const righeExtra = {};
  for (const sezKey of sezioniOrder) {
    const sez = SEZIONI_EXCEL[sezKey];
    const righe = perSezione[sezKey] || [];
    const maxRighe = sez.endRow - sez.startRow + 1;
    if (righe.length > maxRighe) righeExtra[sezKey] = righe.length - maxRighe;
  }
  const sezDinamiche = {};
  for (const k of sezioniOrder) sezDinamiche[k] = { ...SEZIONI_EXCEL[k] };
  // Applico gli spostamenti (le sezioni dopo una espansa scendono)
  for (let i = 0; i < sezioniOrder.length; i++) {
    const extra = righeExtra[sezioniOrder[i]] || 0;
    if (extra <= 0) continue;
    sezDinamiche[sezioniOrder[i]].endRow += extra;
    for (let j = i + 1; j < sezioniOrder.length; j++) {
      sezDinamiche[sezioniOrder[j]].startRow += extra;
      sezDinamiche[sezioniOrder[j]].endRow += extra;
    }
  }

  const annoNum = yyyymm.split("-")[0];
  let modifiche = 0;

  // Per ogni sezione, leggo le righe e confronto
  for (const sezKey of sezioniOrder) {
    const righe = perSezione[sezKey] || [];
    if (!righe.length) continue;
    const startRow = sezDinamiche[sezKey].startRow;

    for (let idx = 0; idx < righe.length; idx++) {
      const c = righe[idx];
      const r = startRow + idx;

      // Le righe dei PREVENTIVI accettati e quelle MANUALI non si importano
      if (c._prev || c._manuale) continue;

      // Colonne testo CBRE: B=sede, E=dataIntervento, G=odl, H=notaExcel
      const letti = {
        sede: leggiValoreCella(sheetXml, sharedStrings, `B${r}`),
        dataIntervento: leggiValoreCella(sheetXml, sharedStrings, `E${r}`),
        odl: leggiValoreCella(sheetXml, sharedStrings, `G${r}`),
        notaExcel: leggiValoreCella(sheetXml, sharedStrings, `H${r}`)
      };

      // SICUREZZA: verifico il numero (colonna D) prima di importare
      const numeroExcel = leggiValoreCella(sheetXml, sharedStrings, `D${r}`);
      const numeroAtteso = (c.numero && c.numero < 900000) ? `${c.numero}/${annoNum}` : "";
      if (numeroExcel && numeroAtteso && numeroExcel !== numeroAtteso) {
        continue; // riga non corrisponde: salto per sicurezza
      }

      const updates = {};
      for (const campo of Object.keys(letti)) {
        const valExcel = (letti[campo] || "").trim();
        const valFb = (c[campo] || "").toString().trim();
        const valFbConfronto = campo === "sede" ? valFb.toUpperCase() : valFb;
        if (valExcel && valExcel !== valFbConfronto) {
          updates[campo] = valExcel;
        }
      }

      if (Object.keys(updates).length > 0) {
        try {
          await fb.updateDoc(fb.doc(fb.db, "consuntivi", c.id), updates);
          modifiche++;
        } catch (e) { console.warn("Update da Excel CBRE:", e); }
      }
    }
  }
  return modifiche;
}

// Importa modifiche Excel all'avvio (mese corrente)
async function importaModificheExcelAllAvvio() {
  if (!state.isElectron) return;
  try {
    const nCreval = await importaModificheExcelCreval(state.meseCorrente);
    const nCbre = await importaModificheExcelCbre(state.meseCorrente);
    const totale = nCreval + nCbre;
    if (totale > 0) {
      showToast(`📥 Importate ${totale} modifiche fatte a mano nell'Excel`, "info", 5000);
    }
  } catch (e) {
    console.warn("Importazione modifiche Excel:", e);
  }
}

async function aggiornaExcelCrevalMese(yyyymm, forzaRicostruzione = false, forzaRilettura = false) {
  let consuntiviCreval;
  if (yyyymm === state.meseCorrente && !forzaRilettura) {
    consuntiviCreval = state.consuntiviMese.filter(c => c.tipo === "creval");
  } else {
    const q = fb.query(fb.collection(fb.db, "consuntivi"),
                       fb.where("mese", "==", yyyymm),
                       fb.where("tipo", "==", "creval"));
    const snap = await fb.getDocs(q);
    consuntiviCreval = [];
    snap.forEach(d => consuntiviCreval.push({ id: d.id, ...d.data() }));
  }

  if (!consuntiviCreval.length) {
    console.log(`Nessun consuntivo CREVAL per ${yyyymm}, salto creazione Excel`);
    return { ok: false, motivo: "nessun consuntivo" };
  }

  const filename = nomeFileExcelCrevalMese(yyyymm);

  // OPZIONE A: se il file Excel CREVAL esiste già, lo uso come base (mantengo colori/note).
  // PROTEZIONE: uso il file esistente solo se non serve espandere (≤ 22 righe standard).
  let baseBytes = null;
  if (state.isElectron && window.electronAPI.leggiExcelEsistente) {
    try {
      const maxRigheStandard = CREVAL_EXCEL_CONFIG.endRow - CREVAL_EXCEL_CONFIG.startRow + 1;
      const serveEspansione = consuntiviCreval.length > maxRigheStandard;

      const ris = await window.electronAPI.leggiExcelEsistente(yyyymm, filename);
      if (ris.esiste && ris.bloccato) {
        showToast("⚠️ Il file Excel CREVAL è aperto. Chiudilo per aggiornarlo, poi rifai l'operazione.", "warn", 7000);
        return { ok: false, motivo: "file aperto" };
      }
      if (ris.esiste && ris.base64) {
        if (serveEspansione || forzaRicostruzione) {
          if (serveEspansione && !forzaRicostruzione) {
            showToast("ℹ️ Tante righe: l'Excel CREVAL è stato rigenerato (eventuali colori manuali su questo file vanno rifatti).", "info", 7000);
          }
        } else {
          baseBytes = base64ToBytes(ris.base64);
        }
      }
    } catch (e) { console.warn("Lettura Excel CREVAL esistente:", e); }
  }

  const bytesOut = await costruisciExcelCrevalMese(yyyymm, consuntiviCreval, baseBytes);

  if (state.isElectron && state.cartellaRoot) {
    try {
      const arr = Array.from(bytesOut);
      const r = await window.electronAPI.salvaExcelMese(yyyymm, filename, arr);
      if (r.ok) {
        console.log("Excel CREVAL mese aggiornato:", r.fullPath);
        return { ok: true, path: r.relativePath, fullPath: r.fullPath };
      }
      return { ok: false, errore: r.errore };
    } catch (err) {
      console.error("Errore aggiornaExcelCrevalMese:", err);
      return { ok: false, errore: err.message };
    }
  }

  return { ok: true, browserBuffer: bytesOut, filename };
}

// Scarica il file Excel del mese (download manuale via browser/download standard)
async function scaricaExcelMese() {
  const result = await aggiornaExcelMese(state.meseCorrente);
  if (!result.ok) {
    showToast("⚠️ " + (result.motivo || result.errore || "Errore"), "warn");
    return;
  }
  if (result.browserBuffer) {
    const blob = new Blob([result.browserBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, result.filename);
    showToast("✅ Excel scaricato", "success");
  } else {
    // In Electron: già salvato in cartella + faccio anche un download di copia
    const cbre = state.consuntiviMese.filter(c => c.tipo === "cbre");
    const bytesOut = await costruisciExcelMese(state.meseCorrente, cbre);
    const blob = new Blob([bytesOut], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, nomeFileExcelMese(state.meseCorrente));
    showToast("✅ Excel scaricato (copia)", "success");
  }
}

// Setup tab Excel (nuovi bottoni)
function setupExcelTab() {
  document.getElementById("btnScaricaExcel").addEventListener("click", scaricaExcelMese);

  // Bottone "Rigenera": forza la ricostruzione del file
  const btnForza = document.getElementById("btnForzaExcel");
  if (btnForza) {
    btnForza.addEventListener("click", async () => {
      showToast("⏳ Rigenero i file Excel del mese (CBRE + CREVAL)...", "warn");
      const rCbre = await aggiornaExcelMese(state.meseCorrente, true);
      const rCreval = await aggiornaExcelCrevalMese(state.meseCorrente, true);

      const fatti = [];
      if (rCbre.ok) fatti.push("CBRE");
      if (rCreval.ok) fatti.push("CREVAL");

      // Errori "veri": escludo "nessun consuntivo" (normale se quel mese non ha
      // quel tipo) e "file aperto" (gia' segnalato con un avviso dalle funzioni).
      const ignora = ["nessun consuntivo", "file aperto"];
      const errori = [];
      if (!rCbre.ok && !ignora.includes(rCbre.motivo)) errori.push("CBRE: " + (rCbre.motivo || rCbre.errore || "errore"));
      if (!rCreval.ok && !ignora.includes(rCreval.motivo)) errori.push("CREVAL: " + (rCreval.motivo || rCreval.errore || "errore"));

      if (fatti.length) showToast(`✅ Excel rigenerato: ${fatti.join(" + ")}`, "success", 5000);
      if (errori.length) showToast("⚠️ " + errori.join(" · "), "warn", 7000);
      if (!fatti.length && !errori.length) showToast("ℹ️ Nessun consuntivo da mettere nell'Excel per questo mese", "info", 5000);
    });
  }

  // Bottone "Apri cartella mese"
  const btnApri = document.getElementById("btnApriExcel");
  if (btnApri) {
    btnApri.addEventListener("click", async () => {
      if (state.isElectron) {
        const meseFolder = nomeCartellaMese(state.meseCorrente);
        const r = await window.electronAPI.apriCartella(meseFolder);
        if (!r.ok) showToast("Errore: " + r.errore, "error");
      } else {
        showToast("Disponibile solo nella versione desktop (.exe)", "warn");
      }
    });
  }
}

function refreshExcelStato() {
  const div = document.getElementById("excelStato");
  const pathDiv = document.getElementById("excelPath");
  const cbre = state.consuntiviMese.filter(c => c.tipo === "cbre");

  // Path del file
  if (state.isElectron && state.cartellaRoot) {
    const cartellaMese = nomeCartellaMese(state.meseCorrente);
    const filename = nomeFileExcelMese(state.meseCorrente);
    if (pathDiv) {
      pathDiv.innerHTML = `📂 ${escapeHtml(state.cartellaRoot)}<br>&nbsp;&nbsp;└─ ${cartellaMese}/<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└─ <strong>${filename}</strong>`;
    }
  } else if (pathDiv) {
    pathDiv.innerHTML = `<em>Nessuna cartella impostata. Imposta una cartella nella tab "Nuovo Consuntivo" o nelle Impostazioni.</em>`;
  }

  // Stato per categoria
  if (!cbre.length) {
    div.innerHTML = `<em>Nessun consuntivo CBRE per ${formatMonthLabel(state.meseCorrente)}.</em>`;
    return;
  }

  const bySez = {};
  cbre.forEach(c => {
    const k = c.sezioneExcel || "(non assegnato)";
    bySez[k] = bySez[k] || [];
    bySez[k].push(c);
  });

  const labelSez = {
    bnl: "BNL + FINDOMESTIC",
    torre_diamante: "TORRE DIAMANTE/SMERALDO",
    mediobanca: "MEDIOBANCA + BCC + BENETTON + RMA",
    ceva: "CEVA LOGISTICS",
    bdb: "BDB",
    padovani: "PADOVANI",
    keller: "KELLER"
  };

  let html = `<strong>Mese: ${formatMonthLabel(state.meseCorrente)}</strong><br>Consuntivi CBRE: ${cbre.length}<br><br>Per sezione Excel:<br>`;
  for (const k of ["bnl","torre_diamante","mediobanca","ceva","bdb","padovani","keller","(non assegnato)"]) {
    if (!bySez[k]) continue;
    const tot = bySez[k].reduce((s,c) => s + (c.totale||0), 0);
    const max = SEZIONI_EXCEL[k] ? (SEZIONI_EXCEL[k].endRow - SEZIONI_EXCEL[k].startRow + 1) : "—";
    const warn = SEZIONI_EXCEL[k] && bySez[k].length > max ? ` ⚠️ TROPPE (max ${max})` : "";
    html += `&nbsp;&nbsp;• ${labelSez[k] || k}: ${bySez[k].length} righe — € ${formatEuro(tot)}${warn}<br>`;
  }
  div.innerHTML = html;
}

// ============================================================
// IMPOSTAZIONI
// ============================================================
function setupImpostazioniTab() {
  // Clienti CBRE personalizzati
  const btnAddCliente = document.getElementById("btnAggiungiClienteCustom");
  const inpCliente = document.getElementById("nuovoClienteCustom");
  if (btnAddCliente && inpCliente) {
    btnAddCliente.addEventListener("click", () => aggiungiClienteCustom(inpCliente.value));
    inpCliente.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); aggiungiClienteCustom(inpCliente.value); }
    });
  }
  renderListaClientiCustom();

  // Bottoni cartella (solo se Electron)
  const btnCambia = document.getElementById("btnCambiaCartella");
  const btnApri = document.getElementById("btnApriCartella");
  const btnRicrea = document.getElementById("btnRicreaCartelle");
  const inputCart = document.getElementById("cartellaCorrenteInput");

  // Mostro la cartella corrente
  if (state.cartellaRoot) {
    inputCart.value = typeof state.cartellaRoot === "string"
      ? state.cartellaRoot
      : state.cartellaRootName;
  }

  if (state.isElectron) {
    btnCambia.addEventListener("click", async () => {
      const r = await window.electronAPI.resetCartella();
      if (r.ok) {
        // L'utente vuole cambiare, riavvio la procedura di selezione
        const r2 = await window.electronAPI.selezionaCartella();
        if (r2.canceled) {
          showToast("Cambio annullato", "warn");
          return;
        }
        if (r2.ok) {
          state.cartellaRoot = r2.path;
          state.cartellaRootName = pathBasename(r2.path);
          inputCart.value = r2.path;
          document.getElementById("cartellaStato").textContent = `✅ ${r2.path}`;
          document.getElementById("cartellaStato").className = "cartella-stato scelta";
          const msg = r2.cartelleCreate
            ? `✅ Nuova cartella + create ${r2.cartelleCreate} cartelle mensili`
            : `✅ Cartella cambiata`;
          showToast(msg, "success", 5000);
        }
      }
    });

    btnApri.addEventListener("click", async () => {
      const r = await window.electronAPI.apriCartella("");
      if (!r.ok) showToast("Errore: " + r.errore, "error");
    });

    btnRicrea.addEventListener("click", async () => {
      const r = await window.electronAPI.preparaCartelleMensili(12);
      if (r.ok) {
        showToast(`✅ Verificate/create ${r.count} cartelle mensili`, "success");
      } else {
        showToast("Errore: " + r.errore, "error");
      }
    });

    // Bottone "Verifica stato NAS adesso"
    const btnVerificaNas = document.getElementById("btnVerificaNas");
    if (btnVerificaNas) {
      btnVerificaNas.addEventListener("click", async () => {
        btnVerificaNas.disabled = true;
        btnVerificaNas.textContent = "⏳ Verifico...";
        await verificaStatoNas(true);
        btnVerificaNas.disabled = false;
        btnVerificaNas.textContent = "🔌 Verifica stato NAS adesso";
      });
    }

    // Bottone "Sincronizza file offline ora"
    const btnSincOra = document.getElementById("btnSincronizzaOra");
    if (btnSincOra) {
      btnSincOra.addEventListener("click", async () => {
        btnSincOra.disabled = true;
        btnSincOra.textContent = "⏳ Sincronizzo...";
        try {
          const r = await window.electronAPI.sincronizzaOffline();
          if (r.ok) {
            if (r.fileSpostati > 0) {
              showToast(`✅ Sincronizzati ${r.fileSpostati} file dal locale al NAS`, "success", 5000);
            } else {
              showToast("✅ Nessun file offline da sincronizzare", "success");
            }
          } else {
            showToast("⚠️ " + (r.errore || "Errore sincronizzazione"), "warn");
          }
        } catch (err) {
          showToast("❌ " + err.message, "error");
        }
        btnSincOra.disabled = false;
        btnSincOra.textContent = "⬆️ Sincronizza file offline ora";
      });
    }
  } else {
    // In browser puro: alcuni bottoni non hanno senso, li disabilito con un avviso
    [btnCambia, btnApri, btnRicrea].forEach(b => {
      b.disabled = true;
      b.title = "Disponibile solo nella versione desktop (.exe)";
    });
    const btnVerificaNas = document.getElementById("btnVerificaNas");
    const btnSincOra = document.getElementById("btnSincronizzaOra");
    if (btnVerificaNas) { btnVerificaNas.disabled = true; btnVerificaNas.title = "Solo .exe"; }
    if (btnSincOra) { btnSincOra.disabled = true; btnSincOra.title = "Solo .exe"; }
  }

  document.getElementById("btnSalvaImpostazioni").addEventListener("click", async () => {
    state.settings.intestazione = document.getElementById("gamaIntestazione").value;
    state.settings.piva = document.getElementById("gamaPiva").value;
    state.settings.mail = document.getElementById("gamaMail").value;
    // merge:true + solo i 3 campi: così NON tocco altri dati nel documento
    // (es. la lista dei destinatari salvati dei preventivi)
    await fb.setDoc(fb.doc(fb.db, "config", "settings"), {
      intestazione: state.settings.intestazione,
      piva: state.settings.piva,
      mail: state.settings.mail
    }, { merge: true });
    showToast("✅ Impostazioni salvate", "success");
  });

  document.getElementById("btnForzaNumeroCbre").addEventListener("click", () => forzaNumero("cbre"));
  document.getElementById("btnForzaNumeroCreval").addEventListener("click", () => forzaNumero("creval"));

  // Preventivo: forza numero
  const btnForzaPrev = document.getElementById("btnForzaNumeroPreventivo");
  if (btnForzaPrev) {
    btnForzaPrev.addEventListener("click", () => forzaNumero("preventivo"));
  }

  // DUSSMANN: forza il numero (contatore UNICO per tutti i gruppi)
  const btnForzaDuss = document.getElementById("btnForzaNumeroDussmannNhood");
  if (btnForzaDuss) {
    btnForzaDuss.addEventListener("click", () => forzaNumeroDussmannUnico("forzaNumeroDussmannNhood"));
  }

  // Preventivo: scegli cartella
  const btnCartPrev = document.getElementById("btnCartellaPreventivi");
  if (btnCartPrev) {
    btnCartPrev.addEventListener("click", async () => {
      if (!state.isElectron) {
        showToast("Disponibile solo nella versione desktop (.exe)", "warn");
        return;
      }
      const r = await window.electronAPI.selezionaCartellaPreventivi();
      if (r.ok) {
        document.getElementById("cartellaPreventiviInput").value = r.path;
        showToast("✅ Cartella preventivi impostata: " + r.path, "success");
      }
    });
    // Carico la cartella attuale
    if (state.isElectron && window.electronAPI.getCartellaPreventivi) {
      window.electronAPI.getCartellaPreventivi().then(r => {
        if (r.path) document.getElementById("cartellaPreventiviInput").value = r.path;
      });
    }
  }

  // Cartella DUSSMANN
  const btnCartDuss = document.getElementById("btnCartellaDussmann");
  if (btnCartDuss) {
    btnCartDuss.addEventListener("click", async () => {
      if (!state.isElectron) {
        showToast("Disponibile solo nella versione desktop (.exe)", "warn");
        return;
      }
      const r = await window.electronAPI.selezionaCartellaDussmann();
      if (r.ok) {
        document.getElementById("cartellaDussmannInput").value = r.path;
        showToast("✅ Cartella DUSSMANN impostata: " + r.path, "success");
      }
    });
    if (state.isElectron && window.electronAPI.getCartellaDussmann) {
      window.electronAPI.getCartellaDussmann().then(r => {
        if (r.path) document.getElementById("cartellaDussmannInput").value = r.path;
      });
    }
  }

  // Cartella PREVENTIVI ACCETTATI
  const btnCartAcc = document.getElementById("btnCartellaAccettati");
  if (btnCartAcc) {
    btnCartAcc.addEventListener("click", async () => {
      if (!state.isElectron) {
        showToast("Disponibile solo nella versione desktop (.exe)", "warn");
        return;
      }
      const r = await window.electronAPI.selezionaCartellaAccettati();
      if (r.ok) {
        document.getElementById("cartellaAccettatiInput").value = r.path;
        showToast("✅ Cartella accettati impostata: " + r.path, "success");
      }
    });
    if (state.isElectron && window.electronAPI.getCartellaAccettati) {
      window.electronAPI.getCartellaAccettati().then(r => {
        if (r.path) document.getElementById("cartellaAccettatiInput").value = r.path;
      });
    }
  }
}

async function forzaNumero(tipo) {
  let inputId;
  if (tipo === "cbre") inputId = "forzaNumeroCbre";
  else if (tipo === "creval") inputId = "forzaNumeroCreval";
  else inputId = "forzaNumeroPreventivo";

  const n = parseInt(document.getElementById(inputId).value);
  if (!n || n < 1) {
    showToast("⚠️ Inserisci un numero valido", "warn");
    return;
  }
  const label = tipo.toUpperCase();
  if (!confirm(`Forzare il prossimo numero ${label} a ${n}?\n\nIl prossimo ${label} sarà NR ${n}.`)) return;
  await fb.setDoc(fb.doc(fb.db, "config", `contatore_${tipo}`), {
    ultimoNumero: n - 1,
    aggiornatoIl: new Date().toISOString()
  }, { merge: true });
  showToast(`✅ Prossimo ${label} impostato a ${n}`, "success");
}

// Forza il numero di partenza per uno specifico gruppo DUSSMANN
async function forzaNumeroDussmannUnico(inputId) {
  const n = parseInt(document.getElementById(inputId).value);
  if (!n || n < 1) {
    showToast("⚠️ Inserisci un numero valido", "warn");
    return;
  }
  if (!confirm(`Forzare il prossimo numero DUSSMANN a ${n}?\n\nIl prossimo consuntivo DUSSMANN (di qualsiasi gruppo) sarà NR ${n}.`)) return;
  // Scrivo sul contatore UNICO condiviso da tutti i gruppi
  await fb.setDoc(fb.doc(fb.db, "config", "contatore_dussmann_unico"), {
    ultimoNumero: n - 1,
    aggiornatoIl: new Date().toISOString()
  }, { merge: true });
  showToast(`✅ Prossimo DUSSMANN impostato a ${n}`, "success");
}

async function loadSettings() {
  if (!fb) return;
  try {
    const snap = await fb.getDoc(fb.doc(fb.db, "config", "settings"));
    if (snap.exists()) Object.assign(state.settings, snap.data());
  } catch (e) {
    console.warn("Impossibile caricare settings:", e);
  }
  document.getElementById("gamaIntestazione").value = state.settings.intestazione;
  document.getElementById("gamaPiva").value = state.settings.piva;
  document.getElementById("gamaMail").value = state.settings.mail;
}

// ============================================================
// UTILS
// ============================================================
function currentMonthString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function getMonthFromDate(dateStr) {
  if (!dateStr) return currentMonthString();
  return dateStr.substring(0, 7);
}

function formatMonthLabel(yyyymm) {
  if (!yyyymm) return "—";
  const [y, m] = yyyymm.split("-");
  const nomi = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
  return `${nomi[parseInt(m)-1]} ${y}`;
}

function formatDateIt(yyyymmdd) {
  if (!yyyymmdd) return "";
  const [y, m, d] = yyyymmdd.split("-");
  return `${d}/${m}/${y}`;
}

function formatEuro(n) {
  if (typeof n !== "number") n = parseFloat(n) || 0;
  // Formattazione manuale garantita: punto per le migliaia, virgola per i decimali.
  // (Non dipende dal supporto locale Intl, che su alcuni ambienti non mette il punto migliaia.)
  const negativo = n < 0;
  const assoluto = Math.abs(n);
  const parti = assoluto.toFixed(2).split(".");        // ["2293","10"]
  const intero = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, "."); // "2.293"
  return (negativo ? "-" : "") + intero + "," + parti[1];
}

function formatNumero(n) {
  if (typeof n !== "number") n = parseFloat(n) || 0;
  if (n % 1 === 0) return String(n);
  return n.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("it-IT");
}

function labelCategoria(cat) {
  return ({
    bnl: "BNL+FINDOMESTIC",
    torre_diamante: "TORRE DIAMANTE",
    mediobanca: "MEDIOBANCA+BCC+RMA",
    ceva: "CEVA",
    bdb: "BDB",
    padovani: "PADOVANI",
    keller: "KELLER",
    creval: "CREVAL"
  })[cat] || cat;
}

function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function showToast(msg, type = "", duration = 3500) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + (type || "");
  t.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add("hidden"), duration);
}
