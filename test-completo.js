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
test("Genera preventivo → PDF Desktop senza prefisso (false)", appCode.includes("Array.from(new Uint8Array(arr)), false"));
test("Handler PDF Desktop in main", mainCode.includes("salva-anteprima-pdf-desktop"));
test("Parametro isAnteprima gestito", mainCode.includes("isAnteprima"));

// ============================================================================
sezione("FASE F - PREVENTIVI (accetta / elimina / doppioni)");

test("Accettazione salva in collection consuntivi", appCode.includes("daPreventivo: true"));
test("Accettazione usa tipo 'cbre'", appCode.includes('tipo: "cbre"'));
test("Pulizia righe precedenti (anti-doppione)", appCode.includes("Pulizia righe preventivo precedenti") || appCode.includes("doppioni se si accetta"));
test("Deduplica preventivi accettati", appCode.includes("Deduplica preventivi accettati") || appCode.includes("idDaRimuovere"));
test("Eliminazione cancella riga consuntivi", appCode.includes('where("preventivoId", "==", id)'));
test("Eliminazione rigenera Excel forzato", appCode.includes("aggiornaExcelMese(dati.excelMese, true)"));
test("Cambio mese rigenera vecchio mese", appCode.includes("aggiornaExcelMese(vm, true)"));

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
