// ============================================================
// PRELOAD SCRIPT - Bridge sicuro tra Electron e la web app
// Espone solo le funzioni necessarie alla web app, niente accesso libero a Node
// ============================================================

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ---- Filesystem ----

  // Dice se siamo in Electron (la web app può controllarlo)
  isElectron: true,

  // Chiede il path della cartella salvata dalle impostazioni
  getCartellaRoot: () => ipcRenderer.invoke("get-cartella-root"),

  // Chiede all'utente di scegliere una cartella (mostra il dialog di Windows)
  selezionaCartella: () => ipcRenderer.invoke("seleziona-cartella"),

  // Salva un file nella cartella giusta. Crea automaticamente le sottocartelle se non esistono.
  // tipo: "cbre" o "creval"
  // meseYYYYMM: "2026-05"
  // filename: nome del file (es. "CONSUNTIVO NR 304 BNL.docx")
  // arrayBuffer: dati binari del file
  salvaConsuntivo: (tipo, meseYYYYMM, filename, arrayBuffer, gruppo) =>
    ipcRenderer.invoke("salva-consuntivo", { tipo, meseYYYYMM, filename, arrayBuffer, gruppo }),

  // Salva l'ODL (PDF) abbinato a un consuntivo: NAS + Drive
  salvaOdl: (tipo, meseYYYYMM, consuntivoFilename, pdfArray, indice) =>
    ipcRenderer.invoke("salva-odl", { tipo, meseYYYYMM, consuntivoFilename, pdfArray, indice }),

  // Crea le cartelle dei prossimi N mesi (per default 12)
  preparaCartelleMensili: (mesiAvanti) =>
    ipcRenderer.invoke("prepara-cartelle-mensili", mesiAvanti),

  // Carica su Drive i documenti GIA' esistenti di un mese (CBRE/CREVAL)
  caricaMeseSuDrive: (meseYYYYMM, categorie) =>
    ipcRenderer.invoke("carica-mese-su-drive", { meseYYYYMM, categorie }),

  // Apre la cartella nel file explorer di Windows
  apriCartella: (sottoPath) => ipcRenderer.invoke("apri-cartella", sottoPath),

  // Resetta la cartella (la cambia: chiede di nuovo dove metterla)
  resetCartella: () => ipcRenderer.invoke("reset-cartella"),

  // Salva il file Excel del mese nella cartella del mese
  salvaExcelMese: (meseYYYYMM, filename, arrayBuffer) =>
    ipcRenderer.invoke("salva-excel-mese", { meseYYYYMM, filename, arrayBuffer }),

  leggiExcelEsistente: (meseYYYYMM, filename) =>
    ipcRenderer.invoke("leggi-excel-esistente", { meseYYYYMM, filename }),

  leggiCelleExcel: (meseYYYYMM, filename) =>
    ipcRenderer.invoke("leggi-celle-excel", { meseYYYYMM, filename }),

  apriEmailConPdf: (pdfPath, odl) =>
    ipcRenderer.invoke("apri-email-con-pdf", { pdfPath, odl }),

  // ---- Multi-PC / NAS / Offline ----

  // Verifica se la cartella root è raggiungibile (NAS online o offline?)
  verificaStatoCartella: () => ipcRenderer.invoke("verifica-stato-cartella"),

  // Attiva modalità offline (crea/usa cartella locale temporanea)
  attivaModalitaOffline: (meseYYYYMM) =>
    ipcRenderer.invoke("attiva-modalita-offline", { meseYYYYMM }),

  // Sincronizza i file dalla cartella offline al NAS (quando torna online)
  sincronizzaOffline: () => ipcRenderer.invoke("sincronizza-offline"),

  // ---- Preventivi ----
  salvaPreventivo: (filename, arrayBuffer) =>
    ipcRenderer.invoke("salva-preventivo", { filename, arrayBuffer }),
  selezionaCartellaPreventivi: () => ipcRenderer.invoke("seleziona-cartella-preventivi"),
  getCartellaPreventivi: () => ipcRenderer.invoke("get-cartella-preventivi"),
  selezionaCartellaDussmann: () => ipcRenderer.invoke("seleziona-cartella-dussmann"),
  getCartellaDussmann: () => ipcRenderer.invoke("get-cartella-dussmann"),
  selezionaCartellaAccettati: () => ipcRenderer.invoke("seleziona-cartella-accettati"),
  getCartellaAccettati: () => ipcRenderer.invoke("get-cartella-accettati"),
  salvaPreventivoAccettato: (filename, arrayBuffer) => ipcRenderer.invoke("salva-preventivo-accettato", { filename, arrayBuffer }),

  // ---- Eliminazione file fisici ----
  eliminaFileConsuntivo: (tipo, meseYYYYMM, filenameDocx, gruppo) =>
    ipcRenderer.invoke("elimina-file-consuntivo", { tipo, meseYYYYMM, filenameDocx, gruppo }),

  // ---- Auto-update: ricevo notifiche di stato aggiornamento ----
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (event, dati) => callback(dati));
  },

  // ---- Bozza lavoro in corso (auto-save) ----
  salvaBozza: (datiBozza) => ipcRenderer.invoke("salva-bozza", datiBozza),
  leggiBozza: () => ipcRenderer.invoke("leggi-bozza"),
  cancellaBozza: () => ipcRenderer.invoke("cancella-bozza"),

  // Per debug / informazioni
  getVersione: () => ipcRenderer.invoke("get-versione"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  apriPaginaAggiornaMac: () => ipcRenderer.invoke("apri-pagina-aggiornamenti-mac"),
  salvaAnteprima: (filename, arrayBuffer) => ipcRenderer.invoke("salva-anteprima-pdf-desktop", { filename, arrayBuffer }),
});

console.log("[Preload] electronAPI esposto");
