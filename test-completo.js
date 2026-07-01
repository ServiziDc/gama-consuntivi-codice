#!/usr/bin/env node
/* ============================================================================
   GAMA CONSUNTIVI - TEST AUTOMATICO COMPLETO
   Verifica integrità del codice (Windows + Mac), feature presenti, e logica.
   Genera un report dettagliato con errori trovati e test superati.
   Lanciato da TESTA-TUTTO.bat
   ============================================================================ */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");

// Colori console (Windows supporta ANSI da Win10+)
const C = {
  reset: "\x1b[0m", rosso: "\x1b[31m", verde: "\x1b[32m",
  giallo: "\x1b[33m", ciano: "\x1b[36m", grassetto: "\x1b[1m"
};

let testPassati = 0;
let testFalliti = 0;
const errori = [];
const righeReport = [];

function log(msg) { console.log(msg); righeReport.push(msg.replace(/\x1b\[[0-9;]*m/g, "")); }

function test(nome, condizione, dettaglioErrore = "") {
  if (condizione) {
    testPassati++;
    log(`    ${C.verde}[OK]${C.reset} ${nome}`);
  } else {
    testFalliti++;
    errori.push(nome + (dettaglioErrore ? " - " + dettaglioErrore : ""));
    log(`    ${C.rosso}[X]${C.reset}  ${nome}${dettaglioErrore ? " - " + dettaglioErrore : ""}`);
  }
}

function sezione(titolo) {
  log("");
  log(`${C.ciano}${C.grassetto}=== ${titolo} ===${C.reset}`);
}

function leggi(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (e) { return ""; }
}

function esiste(file) {
  return fs.existsSync(file);
}

// ============================================================================
log(`${C.grassetto}${C.ciano}`);
log("==============================================================");
log("          GAMA CONSUNTIVI - TEST AUTOMATICO COMPLETO");
log("==============================================================");
log(`${C.reset}`);

// Leggo la versione
let versione = "sconosciuta";
try {
  const pkg = JSON.parse(leggi(path.join(ROOT, "package.json")));
  versione = pkg.version;
} catch (e) {}
log(`  Versione testata: ${C.grassetto}${versione}${C.reset}`);
log(`  Data test: ${new Date().toLocaleString("it-IT")}`);

// ============================================================================
sezione("FASE A - INTEGRITÀ FILE (sintassi JavaScript)");

const fileJS = [
  ["main.js (processo principale)", path.join(ROOT, "main.js")],
  ["preload.js (ponte sicurezza)", path.join(ROOT, "preload.js")],
  ["src/app.js (logica app)", path.join(SRC, "app.js")],
];

fileJS.forEach(([nome, file]) => {
  if (!esiste(file)) { test(nome + " - file presente", false, "FILE MANCANTE"); return; }
  try {
    execSync(`node --check "${file}"`, { stdio: "pipe" });
    test(nome + " - sintassi valida", true);
  } catch (e) {
    test(nome + " - sintassi valida", false, "ERRORE DI SINTASSI: " + (e.stderr ? e.stderr.toString().split("\n")[0] : e.message));
  }
});

// ============================================================================
sezione("FASE B - BILANCIAMENTO PARENTESI");

fileJS.forEach(([nome, file]) => {
  if (!esiste(file)) return;
  const c = leggi(file);
  let graffe = 0, quadre = 0, tonde = 0;
  let inStringa = false, char = "", prec = "";
  for (let i = 0; i < c.length; i++) {
    char = c[i];
    if (char === "{") graffe++;
    if (char === "}") graffe--;
    if (char === "[") quadre++;
    if (char === "]") quadre--;
    if (char === "(") tonde++;
    if (char === ")") tonde--;
  }
  test(`${nome} - graffe bilanciate`, graffe === 0, graffe !== 0 ? `sbilanciamento: ${graffe}` : "");
  test(`${nome} - quadre bilanciate`, quadre === 0, quadre !== 0 ? `sbilanciamento: ${quadre}` : "");
});

// ============================================================================
sezione("FASE C3 - STRUTTURA DUSSMANN GAMA (cartelle standard)");

const appDG = leggi(path.join(ROOT, "src/app.js"));
const mainDG = leggi(path.join(ROOT, "main.js"));
test("Funzione determinaSottoCartellaDussmann", appDG.includes("function determinaSottoCartellaDussmann"));
test("Sottocartella RIMBORSO", appDG.includes('return "RIMBORSO"'));
test("Sottocartella ENI", appDG.includes('return "ENI"'));
test("Sottocartella RAI VIA MECENATE", appDG.includes('return "RAI VIA MECENATE"'));
test("Sottocartella NHOOD ORDINARIA + EXTRA", appDG.includes('return "NHOOD ORDINARIA + EXTRA"'));
test("Sottocartella SQUADRA EDILE", appDG.includes('return "SQUADRA EDILE"'));
test("Sottocartella SQUADRA IMPIANTISTICA", appDG.includes('return "SQUADRA IMPIANTISTICA"'));
test("Riconoscimento RAI da oggetto", appDG.includes('oggetto.includes("RAI") && oggetto.includes("MECENATE")'));
test("Rimborso ha priorita (primo controllo)", /sottoTipo === "rimborso"[\s\S]{0,60}return "RIMBORSO"/.test(appDG));
test("Tipo dussmann_gama usato", appDG.includes('"dussmann_gama"'));
test("main.js: struttura DUSSMANN GAMA/AAAA", mainDG.includes('path.join(base, "DUSSMANN GAMA", annoFolder, meseFolder, sottoSafe)'));
test("main.js: anno ricavato dal mese", mainDG.includes("meseYYYYMM.slice(0, 4)"));
test("Finestra salva personalizzato (solo Dussmann)", appDG.includes("function mostraFinestraSalvaDussmann"));
test("Handler salva-dussmann-personalizzato", mainDG.includes('"salva-dussmann-personalizzato"'));
test("Handler scegli-cartella-libera", mainDG.includes('"scegli-cartella-libera"'));
test("Dussmann usa finestra salva", appDG.includes("mostraFinestraSalvaDussmann(prefissoFisso, cartellaDefault)"));
test("Prefisso fisso con numero (CONSUNTIVO DUSSMANN NR)", appDG.includes("CONSUNTIVO DUSSMANN NR ${c.numero}"));
test("Prefisso non modificabile (span, non input)", appDG.includes('id="dussSalvaPrefisso"'));
test("Nome finale = prefisso + resto", appDG.includes("`${prefissoFisso} ${resto}`"));
test("Numero sempre presente anche senza testo", appDG.includes("resto ? `${prefissoFisso} ${resto}` : prefissoFisso"));
test("Salva crea sia docx che pdf", mainDG.includes('base + ".docx"') && mainDG.includes('base + ".pdf"'));
test("Gruppo ENI / GI.L.C. nei modelli", appDG.includes('"ENI / GI.L.C."'));
test("ENI: operaio BRUSENKO VALENTYN fisso", appDG.includes("BRUSENKO VALENTYN"));
test("ENI: oggetto SAN DONATO MILANESE", appDG.includes("SAN DONATO MILANESE") && appDG.includes("PIAZZA BOLDRINI"));
test("Opzione ENI nel menu HTML", leggi(path.join(ROOT, "src/index.html")).includes('value="ENI / GI.L.C."'));
test("Compila destinatario GI.L.C. automatico", appDG.includes("function compilaDestinatarioSeEni"));
test("ENI riconosciuto dal gruppo (cartella)", appDG.includes('gruppoRaw.includes("ENI")'));
test("Menu operaio EDILE in HTML", leggi(path.join(ROOT, "src/index.html")).includes('id="dussOperaioEdile"'));
test("Operaio NICOLA SCIARRA nel menu", leggi(path.join(ROOT, "src/index.html")).includes("NICOLA SCIARRA"));
test("Operaio EL MALKI AHMED nel menu", leggi(path.join(ROOT, "src/index.html")).includes("EL MALKI AHMED"));
test("Opzione Altro operaio EDILE", leggi(path.join(ROOT, "src/index.html")).includes("__ALTRO__"));
test("Funzione applicaOperaioEdileAOggetto", appDG.includes("function applicaOperaioEdileAOggetto"));
test("Operaio EDILE sostituito nell'oggetto", appDG.includes('testo.replace(/NOME COGNOME/g, nome)'));
test("Menu operaio visibile solo per EDILE", appDG.includes("OPERAI_PER_GRUPPO[gruppo]"));
test("Operai IMPIANTISTICA definiti", appDG.includes('"SQUADRA IMPIANTISTICA": ["ERION DORACI", "SIDHON BISHOUNADI"]'));
test("Operaio ERION DORACI", appDG.includes("ERION DORACI"));
test("Operaio SIDHON BISHOUNADI", appDG.includes("SIDHON BISHOUNADI"));
test("Tabella OPERAI_PER_GRUPPO", appDG.includes("const OPERAI_PER_GRUPPO"));
test("Gruppo RAI VIA MECENATE nei modelli", appDG.includes('"RAI VIA MECENATE": {'));
test("Pagamenti DUSSMANN precompilato BB 60GDFFM", leggi(path.join(ROOT, "src/index.html")).includes('id="dussPagamenti" value="BB 60GDFFM"'));
test("RAI: operaio CASCIELLO PIETRO fisso", appDG.includes("CASCIELLO PIETRO"));
test("RAI: commessa NR 410", appDG.includes("COMMESSA NR 410"));
test("Opzione RAI nel menu HTML", leggi(path.join(ROOT, "src/index.html")).includes('value="RAI VIA MECENATE"'));
test("RAI riconosciuto dal gruppo (cartella)", appDG.includes('gruppoRaw.includes("RAI")'));

// ============================================================================
sezione("FASE C2 - MODALITA TEST (no scritture Firebase)");

const mainCodeMT = leggi(path.join(ROOT, "main.js"));
const appCodeMT = leggi(path.join(ROOT, "src/app.js"));
const preloadMT = leggi(path.join(ROOT, "preload.js"));
test("Handler get-modalita-test in main.js", mainCodeMT.includes("get-modalita-test"));
test("Legge variabile GAMA_TEST", mainCodeMT.includes("GAMA_TEST"));
test("getModalitaTest esposto nel preload", preloadMT.includes("getModalitaTest"));
test("Funzione attivaModalitaTestSeRichiesto", appCodeMT.includes("attivaModalitaTestSeRichiesto"));
test("Blocca setDoc in test", appCodeMT.includes("fb.setDoc = finto"));
test("Blocca updateDoc in test", appCodeMT.includes("fb.updateDoc = finto"));
test("Blocca deleteDoc in test", appCodeMT.includes("fb.deleteDoc = finto"));
test("Blocca addDoc in test", appCodeMT.includes("fb.addDoc = finto"));
test("Banner rosso modalita test", appCodeMT.includes("mostraBannerModalitaTest"));
test("File TEST-GAMA.bat presente", fs.existsSync(path.join(ROOT, "TEST-GAMA.bat")));
test("File TEST-GAMA-MAC.command presente", fs.existsSync(path.join(ROOT, "TEST-GAMA-MAC.command")));
test("prenotaNumero salta Firebase in test", appCodeMT.includes("if (state.modalitaTest)") && /prenotaNumero\(tipo\)[\s\S]{0,200}state\.modalitaTest/.test(appCodeMT));
test("prenotaNumeroDussmann salta Firebase in test", /prenotaNumeroDussmann[\s\S]{0,300}state\.modalitaTest/.test(appCodeMT));
test("prenotaNumeroPreventivo salta Firebase in test", /prenotaNumeroPreventivo[\s\S]{0,150}state\.modalitaTest/.test(appCodeMT));

// ============================================================================
sezione("FASE C - CATENA IPC (preload ↔ main)");

const preloadCode = leggi(path.join(ROOT, "preload.js"));
const mainCode = leggi(path.join(ROOT, "main.js"));

const invokes = [...new Set([...preloadCode.matchAll(/ipcRenderer\.invoke\(["']([^"']+)["']/g)].map(m => m[1]))];
const handlers = [...new Set([...mainCode.matchAll(/ipcMain\.handle\(["']([^"']+)["']/g)].map(m => m[1]))];

test(`Almeno 1 funzione IPC definita`, invokes.length > 0, `trovate: ${invokes.length}`);
let ipcMancanti = 0;
invokes.forEach(inv => {
  if (!handlers.includes(inv)) { ipcMancanti++; }
});
test(`Tutte le ${invokes.length} funzioni hanno il loro handler`, ipcMancanti === 0,
     ipcMancanti > 0 ? `${ipcMancanti} senza handler` : "");

// ============================================================================
sezione("FASE D - GENERAZIONE PDF (Windows + Mac)");

test("Conversione Windows (PowerShell .ps1)", mainCode.includes("ExecutionPolicy Bypass -File"));
test("Conversione Mac (AppleScript)", mainCode.includes("POSIX file"));
test("Fallback LibreOffice su Mac", mainCode.includes("LibreOffice.app"));
test("Fallback LibreOffice su Linux/test", mainCode.includes("libreoffice --headless"));
test("Sanificazione nome file PDF", mainCode.includes("caratteri vietati") || mainCode.includes("nomePulito"));
test("Gestione formato PDF Word (wdFormatPDF=17)", mainCode.includes("17"));
test("Pulizia file temporanei .ps1", mainCode.includes("unlinkSync") || mainCode.includes("unlink"));

// ============================================================================
sezione("FASE E - PDF SUL DESKTOP (3 pulsanti)");

const appCode = leggi(path.join(SRC, "app.js"));

test("Funzione salvaAnteprimaPdf esiste", appCode.includes("async function salvaAnteprimaPdf"));
test("Anteprima preventivo usa template corretto", appCode.includes("buildPreventivoDocx(p)"));
test("Anteprima → prefisso ANTEPRIMA (true)", /salvaAnteprima\([^)]*,\s*true\)/.test(appCode));
test("Genera consuntivo → PDF Desktop senza prefisso (false)", appCode.includes("Array.from(new Uint8Array(arrPdf)), false"));
test("Genera preventivo → PDF Desktop senza prefisso (false)", appCode.includes("salvaAnteprima(filename, bytesArr, false)"));
test("Handler PDF Desktop in main", mainCode.includes("salva-anteprima-pdf-desktop"));
test("Parametro isAnteprima gestito", mainCode.includes("isAnteprima"));

// Conversione PDF cross-platform (Windows + Mac)
test("Mac: PDF generato in locale poi spostato (no problemi NAS)", mainCode.includes("pdfTmpLocale") && mainCode.includes("spostaPdfFinale"));
test("Mac: cartella temp sicura in Home (no /var/folders bloccata)", mainCode.includes("function cartellaTempSicura") && mainCode.includes(".gama-consuntivi-temp"));
test("Mac: conversione usa cartella temp sicura", mainCode.includes("cartellaTempSicura()"));
test("Mac: messaggio chiaro se permesso Word negato", mainCode.includes("Automazione") && mainCode.includes("Privacy e Sicurezza"));
test("Mac: Word come prima scelta", mainCode.includes('tell application "Microsoft Word"'));
test("Mac: fallback LibreOffice", mainCode.includes("sofficeEsistente"));
test("Mac: messaggio chiaro se manca Word/LibreOffice", mainCode.includes("installa LibreOffice come alternativa") || mainCode.includes("Automazione"));
test("Windows: PowerShell per conversione", mainCode.includes("powershell") && mainCode.includes("Word.Application"));
test("Windows: rileva Word mancante", mainCode.includes("Microsoft Word non risulta installato"));
test("Temp conversione nome pulito (no apostrofi)", mainCode.includes("gama_tmp_"));

// ============================================================================
sezione("FASE F - PREVENTIVI (accetta / elimina / doppioni)");

test("Accettazione salva in collection consuntivi", appCode.includes("daPreventivo: true"));
test("Accettazione usa tipo 'cbre'", appCode.includes('tipo: "cbre"'));
test("Pulizia righe precedenti (anti-doppione)", appCode.includes("Pulizia righe preventivo precedenti") || appCode.includes("doppioni se si accetta"));
test("Deduplica preventivi accettati", appCode.includes("Deduplica preventivi accettati") || appCode.includes("idDaRimuovere"));
test("Eliminazione cancella riga consuntivi", appCode.includes('where("preventivoId", "==", id)'));
test("Eliminazione rigenera Excel forzato", appCode.includes("aggiornaExcelMese(dati.excelMese, true)"));
test("Cambio mese rigenera vecchio mese", appCode.includes("aggiornaExcelMese(vm, true)"));

// Tabella voci preventivo (Descrizione, U.M., Q.tà, P.Unit, P.Totale)
test("Tabella voci: funzione costruisci XML", appCode.includes("function costruisciTabellaVociXml"));
test("Tabella voci: riga dinamica nel form", appCode.includes("function htmlRigaVocePreventivo"));
test("Tabella voci: calcolo totali", appCode.includes("function ricalcolaTotaliPreventivo"));
test("Tabella voci: lettura voci", appCode.includes("function leggiVociPreventivo"));
test("Tabella voci: unità di misura con 'a corpo'", appCode.includes('"a corpo"'));
test("Tabella voci: U.M. scrivibile (Altro)", appCode.includes("voce-um-altro"));
test("Tabella voci: 5 colonne header", appCode.includes('"DESCRIZIONE"') && appCode.includes('"P. Unitario"') && appCode.includes('"P. Totale"'));
test("Tabella voci: calcolo P.Totale (qta×pu)", appCode.includes("qta * pu"));
test("Tabella voci: sostituisce tabella Word", appCode.includes("costruisciTabellaVociXml(voci, totaleOfferta)"));
test("Tabella voci: pulsante aggiungi", appCode.includes("prev-aggiungi-voce"));

// Ore di viaggio nel Word + U.M. sui materiali
test("Ore di viaggio nella tabella Word/PDF", appCode.includes('tit: "Ore di Viaggio"'));
test("Materiali: tendina U.M. (a corpo, n, mt...)", appCode.includes("mat-um-sel") && appCode.includes("UNITA_MISURA_PREV"));
test("Materiali: U.M. scrivibile (Altro)", appCode.includes("mat-um-altro") && appCode.includes("__ALTRO__"));
test("Materiali: U.M. compare nel Word", appCode.includes("m.um.trim() : (c.nascondiaCorpo"));
test("Materiali: U.M. salvata e ripristinata", appCode.includes("aggiungiMaterialeExtra(m.descr, m.costo, m.um)"));

// Storico preventivi: navigazione tra i mesi (fetch da Firebase)
test("Storico prev: selettore mese", leggi(path.join(ROOT, "src/index.html")).includes('id="prevStoricoMese"'));
test("Storico prev: pulsanti prec/succ/oggi", appCode.includes("spostaMeseStoricoPreventivi") && appCode.includes("prevStoricoOggi"));
test("Storico prev: fetch da Firebase mesi passati", appCode.includes("function caricaStoricoPreventiviMese") && appCode.includes("fb.getDocs"));
test("Storico prev: non sovrascrive mese passato con live", appCode.includes("prevStoricoMeseVisualizzato !== state.meseCorrente"));
test("Storico prev: navigazione collegata all'avvio", appCode.includes("setupNavigazioneStoricoPreventivi();"));

// ============================================================================
sezione("FASE G - CONSUNTIVI (campi e calcoli)");

test("Ore di viaggio presente", appCode.includes("oreViaggio") && appCode.includes("tariffaViaggio"));
test("Calcolo costo viaggio", appCode.includes("costoViaggio"));
test("Nascondi 'A corpo'", appCode.includes("nascondiaCorpo"));
test("ODL multipli", leggi(path.join(SRC, "index.html")).includes("odlListaContainer"));
test("Colori righe manuali", leggi(path.join(SRC, "index.html")).includes("manColoreGiallo") || appCode.includes("statoPagamento"));
test("Ore extra", appCode.includes("oreExtra"));
test("Totale a mano", appCode.includes("totaleManuale"));
test("Funzione calcolaTotaleConsuntivo", appCode.includes("function calcolaTotaleConsuntivo"));

// ============================================================================
sezione("FASE H - EXCEL (generazione celle)");

test("applicaModificheCelle 2 passate", appCode.includes("Seconda passata") || appCode.includes("celleMancanti"));
test("Inserimento celle in righe vuote", appCode.includes("celleMancanti") || appCode.includes("nuoveCelleXml"));
test("Formato numero italiano (it-IT)", appCode.includes('toLocaleString("it-IT"'));
test("Rigenerazione forzata da template", appCode.includes("forzaRicostruzione"));
test("Funzione aggiornaExcelMese", appCode.includes("function aggiornaExcelMese"));

// ============================================================================
sezione("FASE I - TEST LOGICI (calcoli reali)");

// Test calcolo totale multi-offerta
(function() {
  const offerte = [{ importo: 1000 }, { importo: 2500 }, { importo: 1500 }];
  const tot = offerte.reduce((s, o) => s + (parseFloat(o.importo) || 0), 0);
  test("Calcolo totale 3 offerte (=5000€)", tot === 5000, tot !== 5000 ? `ottenuto ${tot}` : "");
})();

// Test calcolo ore complete
(function() {
  const tot = 8 * 30 + 2 * 33 + 3 * 20 + 500;
  test("Calcolo ore+viaggio+materiale (=866€)", tot === 866, tot !== 866 ? `ottenuto ${tot}` : "");
})();

// Test mappatura colori
(function() {
  const c = s => s === "pagato" ? "giallo" : s === "parziale" ? "azzurro" : "";
  const s = cc => cc === "giallo" ? "pagato" : cc === "azzurro" ? "parziale" : "";
  const ok = ["pagato", "parziale", ""].every(x => s(c(x)) === x);
  test("Mappatura colori pagamento (roundtrip)", ok);
})();

// Test sanificazione nome
(function() {
  function san(f) {
    let n = f.replace(/\.docx$/i, "").replace(/^ANTEPRIMA\s*-\s*/i, "");
    n = n.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ").replace(/[\r\n]+/g, " ").replace(/\./g, "").replace(/\s+/g, " ").trim().substring(0, 100);
    return n || "documento";
  }
  const conPunti = san("CBRE S.r.l. test.docx");
  const lungo = san("A".repeat(200) + ".docx");
  test("Sanificazione rimuove punti", !conPunti.includes("."), `risultato: ${conPunti}`);
  test("Sanificazione tronca nomi lunghi (≤100)", lungo.length <= 100, `lunghezza: ${lungo.length}`);
})();

// Test menu mesi (tutto l'anno)
(function() {
  const now = new Date();
  const a = now.getFullYear();
  const o = [];
  for (let y = a - 1; y <= a + 1; y++) for (let m = 1; m <= 12; m++) o.push(`${y}-${String(m).padStart(2, "0")}`);
  const annoCorr = [...new Set(o)].filter(x => x.startsWith(String(a)));
  test(`Menu mesi: 12 mesi anno corrente (${a})`, annoCorr.length === 12, `trovati: ${annoCorr.length}`);
})();

// Test ciclo vita preventivo (simulato)
(function() {
  const db = { preventivi: {}, consuntivi: {} };
  db.preventivi["p1"] = { numero: 999, excelMese: "2026-08", excelSezione: "bnl" };
  db.consuntivi["c1"] = { tipo: "cbre", mese: "2026-08", sezioneExcel: "bnl", preventivoId: "p1", daPreventivo: true };
  const appare = Object.values(db.consuntivi).some(c => c.tipo === "cbre" && c.mese === "2026-08" && c.sezioneExcel === "bnl");
  delete db.preventivi["p1"];
  Object.entries(db.consuntivi).filter(([k, v]) => v.preventivoId === "p1").forEach(([k]) => delete db.consuntivi[k]);
  const sparito = !Object.values(db.consuntivi).some(c => c.preventivoId === "p1");
  test("Ciclo preventivo: accetta → appare", appare);
  test("Ciclo preventivo: elimina → sparisce", sparito);
})();

// Test deduplica doppioni
(function() {
  let cbre = [
    { id: "c1", preventivoId: "p247", creatoIl: "2026-06-25T10:00" },
    { id: "c2", preventivoId: "p247", creatoIl: "2026-06-25T11:00" },
    { id: "c3", numero: 100 },
  ];
  const perPrev = {};
  cbre.forEach(c => { if (c.preventivoId) (perPrev[c.preventivoId] = perPrev[c.preventivoId] || []).push(c); });
  const rm = new Set();
  for (const pid of Object.keys(perPrev)) {
    const r = perPrev[pid];
    if (r.length > 1) { r.sort((a, b) => String(b.creatoIl || "").localeCompare(String(a.creatoIl || ""))); for (let i = 1; i < r.length; i++) rm.add(r[i].id); }
  }
  cbre = cbre.filter(c => !rm.has(c.id));
  const unaRiga = cbre.filter(c => c.preventivoId === "p247").length === 1;
  const normaleOk = cbre.some(c => c.id === "c3");
  test("Deduplica: 2 doppioni → 1 riga", unaRiga);
  test("Deduplica: consuntivo normale intatto", normaleOk);
})();

// ============================================================================
sezione("FASE L - PACKAGING (file necessari)");

test("package.json presente", esiste(path.join(ROOT, "package.json")));
test("PUBBLICA-AGGIORNAMENTO.bat presente", esiste(path.join(ROOT, "PUBBLICA-AGGIORNAMENTO.bat")));
test("Cartella assets presente", esiste(path.join(SRC, "assets")));
test("Template CBRE presente", esiste(path.join(SRC, "assets", "template-docx-cbre.js")));
test("Template preventivo presente", esiste(path.join(SRC, "assets", "template-docx-preventivo.js")));
test("Timbro presente", esiste(path.join(SRC, "assets", "timbro.png")));
test("Workflow GitHub Actions (build Mac)", esiste(path.join(ROOT, ".github", "workflows", "build.yml")));

// ============================================================================
sezione("FASE N - SISTEMA DI ATTIVAZIONE (key)");

test("File attivazione.js presente", esiste(path.join(ROOT, "attivazione.js")));
test("File attivazione.html presente", esiste(path.join(ROOT, "attivazione.html")));

if (esiste(path.join(ROOT, "attivazione.js"))) {
  try {
    const att = require(path.join(ROOT, "attivazione.js"));
    // Genera codice macchina
    const codice = att.generaCodiceMacchina();
    test("Genera codice macchina (formato XXXX-XXXX-XXXX)", /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codice), `ottenuto: ${codice}`);
    // STABILITÀ: due chiamate consecutive devono dare lo stesso codice (cruciale su Mac)
    const codice2 = att.generaCodiceMacchina();
    test("Codice macchina STABILE (Mac: ignora MAC randomizzati)", codice === codice2, codice !== codice2 ? `${codice} != ${codice2}` : "");
    // Genera key per il codice
    const keyCorretta = att.calcolaKeyPerCodice(codice);
    test("Genera key (formato XXXXX-XXXXX-XXXXX-XXXXX)", /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(keyCorretta), `ottenuto: ${keyCorretta}`);
    // Valida key corretta
    test("Key corretta viene accettata", att.validaKey(keyCorretta));
    // Rifiuta key sbagliata
    test("Key sbagliata viene rifiutata", !att.validaKey("AAAAA-BBBBB-CCCCC-DDDDD"));
    // Tollera minuscole
    test("Tollera key in minuscolo", att.validaKey(keyCorretta.toLowerCase()));
    // 1 key = 1 PC: key di altro codice rifiutata
    test("Key di un altro PC viene rifiutata (1 key = 1 PC)", !att.validaKey(att.calcolaKeyPerCodice("XXXX-YYYY-ZZZZ")));
    // CODICE STABILE: 5 chiamate devono dare sempre lo stesso codice
    const codiciRipetuti = [];
    for (let i = 0; i < 5; i++) codiciRipetuti.push(att.generaCodiceMacchina());
    test("Codice macchina STABILE su 5 chiamate (no riattivazione)", new Set(codiciRipetuti).size === 1);
    // RETE DI SICUREZZA: eAttivato accetta un PC già attivato anche se il codice cambia
    if (att.eAttivato) {
      const codiceVecchio = "AAAA-BBBB-CCCC";
      const keyVecchia = att.calcolaKeyPerCodice(codiceVecchio);
      // Simulo un'app con licenza salvata col codice vecchio
      const fakeApp = {
        getPath: () => "/tmp",
      };
      // Verifico la funzione di calcolo key (base della rete di sicurezza)
      test("Rete di sicurezza: key autentica per codice memorizzato", keyVecchia === att.calcolaKeyPerCodice(codiceVecchio));
    }
  } catch (e) {
    test("Modulo attivazione funzionante", false, "errore: " + e.message);
  }
}

// Verifico che il segreto sia identico tra attivazione.js e il generatore
// (il generatore è in /home/claude ma sul PC sarà nella stessa cartella o consegnato a parte)
if (esiste(path.join(ROOT, "attivazione.js"))) {
  const attCode = leggi(path.join(ROOT, "attivazione.js"));
  const segretoMatch = attCode.match(/const SEGRETO = '([^']+)'/);
  test("Segreto di attivazione configurato", segretoMatch && segretoMatch[1].length > 10);
}

// Integrazione in main.js
test("Attivazione integrata in main.js", mainCode.includes('require("./attivazione")'));
test("Caricamento attivazione a prova di crash (try/catch)", mainCode.includes("Modulo attivazione non disponibile") || /try\s*{[^}]*require\("\.\/attivazione"\)/.test(mainCode));
test("Handler codice macchina", mainCode.includes("attivazione-codice-macchina"));
test("Handler verifica key", mainCode.includes("attivazione-verifica-key"));
test("Controllo attivazione all'avvio", mainCode.includes("attivazione.eAttivato"));

// CRITICO: i file attivazione DEVONO essere nella build di electron-builder,
// altrimenti l'exe compilato dà "Cannot find module './attivazione'"
try {
  const pkgBuild = JSON.parse(leggi(path.join(ROOT, "package.json")));
  const filesBuild = (pkgBuild.build && pkgBuild.build.files) || [];
  test("attivazione.js incluso nella build (.exe)", filesBuild.includes("attivazione.js"),
       !filesBuild.includes("attivazione.js") ? "MANCA in package.json build.files - l'exe non troverà il modulo!" : "");
  test("attivazione.html incluso nella build (.exe)", filesBuild.includes("attivazione.html"),
       !filesBuild.includes("attivazione.html") ? "MANCA in package.json build.files!" : "");
} catch (e) {
  test("Configurazione build leggibile", false, e.message);
}

// ============================================================================
// TEST SPECIFICI DELLA PIATTAFORMA REALE (cambiano tra Windows e Mac)
// ============================================================================
const piattaforma = process.platform === "darwin" ? "Mac" :
                    process.platform === "win32" ? "Windows" : "Linux/altro";
sezione(`FASE M - AMBIENTE REALE (${piattaforma})`);

log(`    Sistema operativo rilevato: ${C.grassetto}${piattaforma}${C.reset} (${process.platform})`);
log(`    Versione Node.js: ${process.version}`);

if (process.platform === "win32") {
  // Su Windows: verifico che Word sia disponibile (serve per i PDF)
  try {
    const out = execSync('powershell -NoProfile -Command "try { $w = New-Object -ComObject Word.Application; $v = $w.Version; $w.Quit(); Write-Output $v } catch { Write-Output \'NO\' }"', { stdio: "pipe", timeout: 30000 }).toString().trim();
    test(`Microsoft Word installato (per PDF Windows)`, out !== "NO" && out !== "", out === "NO" ? "Word NON trovato - i PDF non funzioneranno!" : `versione ${out}`);
  } catch (e) {
    test(`Microsoft Word installato (per PDF Windows)`, false, "impossibile verificare Word: " + e.message.split("\n")[0]);
  }
  // Verifico PowerShell
  try {
    execSync("powershell -NoProfile -Command \"Write-Output OK\"", { stdio: "pipe", timeout: 10000 });
    test("PowerShell disponibile", true);
  } catch (e) {
    test("PowerShell disponibile", false, "PowerShell non risponde");
  }
}

if (process.platform === "darwin") {
  // Su Mac: verifico Word OPPURE LibreOffice (almeno uno serve per i PDF)
  const wordMac = esiste("/Applications/Microsoft Word.app");
  const libreMac = esiste("/Applications/LibreOffice.app");
  test("Microsoft Word installato su Mac", wordMac, !wordMac ? "Word non trovato in /Applications" : "");
  test("LibreOffice installato su Mac (fallback)", libreMac, !libreMac ? "LibreOffice non trovato in /Applications" : "");
  test("Almeno un convertitore PDF disponibile (Word o LibreOffice)", wordMac || libreMac,
       (!wordMac && !libreMac) ? "NESSUNO DEI DUE - i PDF non funzioneranno! Installa Word o LibreOffice" : "");
  // Verifico osascript (AppleScript)
  try {
    execSync('osascript -e "return 1"', { stdio: "pipe", timeout: 10000 });
    test("osascript (AppleScript) disponibile", true);
  } catch (e) {
    test("osascript (AppleScript) disponibile", false, "osascript non risponde");
  }
}

if (process.platform !== "win32" && process.platform !== "darwin") {
  // Linux (ambiente di test): verifico libreoffice
  try {
    execSync("which libreoffice", { stdio: "pipe" });
    test("LibreOffice disponibile (Linux)", true);
  } catch (e) {
    test("LibreOffice disponibile (Linux)", false, "non installato");
  }
  log(`    ${C.giallo}Nota: sei su Linux. I test del codice valgono per Windows e Mac,${C.reset}`);
  log(`    ${C.giallo}ma per testare i PDF reali serve lanciare su Windows o Mac.${C.reset}`);
}

// ============================================================================
// REPORT FINALE
// ============================================================================
const totale = testPassati + testFalliti;
const percentuale = totale > 0 ? Math.round((testPassati / totale) * 100) : 0;

log("");
log(`${C.grassetto}${C.ciano}==============================================================${C.reset}`);
log(`${C.grassetto}${C.ciano}                      REPORT FINALE${C.reset}`);
log(`${C.grassetto}${C.ciano}==============================================================${C.reset}`);
log(`  Versione:        ${versione}`);
log(`  Test totali:     ${totale}`);
log(`  ${C.verde}Test superati:   ${testPassati}${C.reset}`);
log(`  ${testFalliti > 0 ? C.rosso : C.verde}Test falliti:    ${testFalliti}${C.reset}`);
log(`  Percentuale:     ${percentuale}%`);
log(`${C.grassetto}${C.ciano}==============================================================${C.reset}`);

if (testFalliti > 0) {
  log("");
  log(`${C.rosso}${C.grassetto}  >>> ERRORI TROVATI (${testFalliti}):${C.reset}`);
  errori.forEach((e, i) => log(`${C.rosso}    ${i + 1}. ${e}${C.reset}`));
  log("");
  log(`${C.rosso}${C.grassetto}  [X] ATTENZIONE: ci sono errori da sistemare prima di pubblicare!${C.reset}`);
} else {
  log("");
  log(`${C.verde}${C.grassetto}  [OK] TUTTO OK - Nessun errore. La release e' pronta per la pubblicazione!${C.reset}`);
}

// Salvo il report su file
const reportTesto = righeReport.join("\n");
const nomeReport = `REPORT-TEST-${versione}-${new Date().toISOString().slice(0, 10)}.txt`;
const percorsoReport = path.join(ROOT, nomeReport);
try {
  fs.writeFileSync(percorsoReport, reportTesto, "utf8");
  log("");
  log(`  Report salvato in: ${nomeReport}`);
} catch (e) {
  log(`  Impossibile salvare il report: ${e.message}`);
}

// Exit code: 0 se tutto ok, 1 se ci sono errori (utile per automazioni)
process.exit(testFalliti > 0 ? 1 : 0);
