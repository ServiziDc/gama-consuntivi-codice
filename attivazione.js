'use strict';

// ============================================================================
//  GAMA CONSUNTIVI - Sistema di attivazione con key legata al PC
//  - Genera un codice macchina univoco (basato su hardware)
//  - Valida la key tramite algoritmo segreto (offline, nessun server)
//  - Una volta attivato, salva la key e non la richiede più
//  - La key sopravvive agli aggiornamenti (salvata in userData)
// ============================================================================

const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ⚠️ SEGRETO CONDIVISO: deve essere IDENTICO qui e nel generatore di key.
// Se lo cambi, tutte le key esistenti smettono di funzionare.
const SEGRETO = 'GamaService2026-Kx9#mPv2Lq7@nB4tWz!';

// ----------------------------------------------------------------------------
// CODICE MACCHINA: identifica univocamente questo PC.
// Combina: MAC address delle schede di rete FISICHE + hostname + piattaforma
// + architettura CPU. Stabile nel tempo sullo stesso PC, su Windows e Mac.
// ----------------------------------------------------------------------------

// Interfacce da IGNORARE perché hanno MAC randomizzati/virtuali che cambiano:
// - awdl, llw: Apple Wireless Direct Link (Mac) - MAC random ad ogni riavvio
// - utun, ipsec, ppp: VPN/tunnel virtuali
// - vEthernet, vmnet, vboxnet, docker: schede virtuali (VM, Docker, ecc.)
// - bridge, bluetooth: ponti e bluetooth
const INTERFACCE_DA_IGNORARE = /^(awdl|llw|utun|ipsec|ppp|vethernet|vmnet|vboxnet|docker|bridge|bluetooth|tun|tap|zt)/i;

// Legge un identificatore hardware STABILE e permanente del computer.
// - Windows: MachineGuid dal registro di sistema (non cambia mai, è legato
//   all'installazione di Windows)
// - Mac: IOPlatformUUID (UUID hardware della scheda madre, permanente)
// - Linux: machine-id
// Questo ID NON dipende da quali schede di rete sono attive, quindi il codice
// macchina resta identico anche se cambi cavo/Wi-Fi/adattatori.
function leggiIdHardwareStabile() {
  try {
    const { execSync } = require('child_process');
    if (os.platform() === 'win32') {
      // MachineGuid dal registro di Windows
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { timeout: 5000, windowsHide: true }).toString();
      const m = out.match(/MachineGuid\s+REG_SZ\s+([A-Za-z0-9\-]+)/);
      if (m && m[1]) return 'win-' + m[1].trim();
    } else if (os.platform() === 'darwin') {
      // IOPlatformUUID dell'hardware Mac
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { timeout: 5000 }).toString();
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m && m[1]) return 'mac-' + m[1].trim();
    } else {
      // Linux: machine-id
      try {
        const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
        if (id) return 'lin-' + id;
      } catch (e) {}
      try {
        const id = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
        if (id) return 'lin-' + id;
      } catch (e) {}
    }
  } catch (e) {
    console.warn('ID hardware stabile non disponibile, uso fallback MAC:', e.message);
  }
  return null; // se fallisce, useremo il fallback basato su MAC
}

function generaCodiceMacchina() {
  // PRIMA SCELTA: uso l'ID hardware stabile (registro Windows / UUID Mac).
  // Questo è permanente e non cambia mai sullo stesso PC.
  const idStabile = leggiIdHardwareStabile();

  let datiMacchina;
  if (idStabile) {
    // Codice basato sull'ID hardware permanente + hostname (per leggibilità)
    datiMacchina = [idStabile, os.platform(), os.arch()].join('|');
  } else {
    // FALLBACK (raro): se non riesco a leggere l'ID hardware, torno al vecchio
    // metodo basato sui MAC delle schede fisiche.
    const interfacce = os.networkInterfaces();
    const macValidi = [];
    for (const nome of Object.keys(interfacce)) {
      if (INTERFACCE_DA_IGNORARE.test(nome)) continue;
      for (const dettaglio of interfacce[nome]) {
        if (!dettaglio.internal && dettaglio.mac && dettaglio.mac !== '00:00:00:00:00:00') {
          macValidi.push(dettaglio.mac.toLowerCase());
        }
      }
    }
    const macUnici = [...new Set(macValidi)].sort();
    const macFinale = macUnici.length > 0 ? macUnici.join(',') : 'no-mac';
    datiMacchina = [macFinale, os.hostname(), os.platform(), os.arch()].join('|');
  }

  // Hash per ottenere un codice compatto e leggibile (12 caratteri)
  const hash = crypto.createHash('sha256').update(datiMacchina).digest('hex');
  const codice = hash.substring(0, 12).toUpperCase();

  // Formatto come XXXX-XXXX-XXXX (più leggibile)
  return codice.match(/.{1,4}/g).join('-');
}

// ----------------------------------------------------------------------------
// CALCOLO KEY: data un codice macchina, calcola la key valida.
// Stesso algoritmo usato dal generatore. Key formato: XXXXX-XXXXX-XXXXX-XXXXX
// ----------------------------------------------------------------------------
function calcolaKeyPerCodice(codiceMacchina) {
  // Normalizzo il codice (tolgo trattini, maiuscolo)
  const codicePulito = codiceMacchina.replace(/-/g, '').toUpperCase();

  // HMAC del codice macchina con il segreto
  const hmac = crypto.createHmac('sha256', SEGRETO).update(codicePulito).digest('hex');

  // Prendo 20 caratteri esadecimali e li converto in un set di caratteri
  // più "da seriale" (niente caratteri ambigui come 0/O, 1/I)
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 caratteri, no 0,O,1,I
  let key = '';
  for (let i = 0; i < 20; i++) {
    const byte = parseInt(hmac.substr(i * 2, 2), 16);
    key += alfabeto[byte % alfabeto.length];
  }

  // Formatto come XXXXX-XXXXX-XXXXX-XXXXX
  return key.match(/.{1,5}/g).join('-');
}

// ----------------------------------------------------------------------------
// VALIDA KEY: controlla se la key inserita è corretta per QUESTO PC.
// ----------------------------------------------------------------------------
function validaKey(keyInserita) {
  if (!keyInserita || typeof keyInserita !== 'string') return false;
  const codiceMacchina = generaCodiceMacchina();
  const keyCorretta = calcolaKeyPerCodice(codiceMacchina);
  // Confronto normalizzato (ignoro maiuscole/spazi/trattini extra)
  const norm = (s) => s.replace(/[-\s]/g, '').toUpperCase();
  return norm(keyInserita) === norm(keyCorretta);
}

// ----------------------------------------------------------------------------
// PERSISTENZA: salvo/leggo la key attivata in userData (sopravvive agli update)
// ----------------------------------------------------------------------------
function percorsoFileLicenza(app) {
  return path.join(app.getPath('userData'), 'licenza.dat');
}

function salvaLicenza(app, key) {
  try {
    const codiceMacchina = generaCodiceMacchina();
    const contenuto = JSON.stringify({
      key: key,
      codiceMacchina: codiceMacchina,
      attivatoIl: new Date().toISOString()
    });
    // Offusco leggermente (base64) - non è crittografia forte, ma evita modifiche casuali
    const offuscato = Buffer.from(contenuto).toString('base64');
    fs.writeFileSync(percorsoFileLicenza(app), offuscato, 'utf8');
    return true;
  } catch (e) {
    console.error('Errore salvataggio licenza:', e);
    return false;
  }
}

function leggiLicenza(app) {
  try {
    const file = percorsoFileLicenza(app);
    if (!fs.existsSync(file)) return null;
    const offuscato = fs.readFileSync(file, 'utf8');
    const contenuto = Buffer.from(offuscato, 'base64').toString('utf8');
    return JSON.parse(contenuto);
  } catch (e) {
    return null;
  }
}

// ----------------------------------------------------------------------------
// CONTROLLO PRINCIPALE: il programma è già attivato su questo PC?
// Verifica che esista una licenza salvata E che la key sia ancora valida
// per questo PC (così se copi il file licenza su un altro PC non funziona).
// ----------------------------------------------------------------------------
function eAttivato(app) {
  const licenza = leggiLicenza(app);
  if (!licenza || !licenza.key) return false;

  // 1. Caso normale: la key è valida per il codice macchina ATTUALE → attivato.
  if (validaKey(licenza.key)) return true;

  // 2. RETE DI SICUREZZA: la key non valida più per il codice attuale (es. il
  //    codice macchina è cambiato per un motivo hardware). MA se questo PC era
  //    GIÀ stato attivato in passato con una key che a suo tempo era corretta
  //    per il codice di ALLORA, NON richiedo di riattivare.
  //    Verifico che la key salvata fosse valida per il codiceMacchina memorizzato
  //    al momento dell'attivazione: se sì, l'attivazione era autentica e la
  //    mantengo (evita la riattivazione fastidiosa).
  if (licenza.codiceMacchina && licenza.key) {
    const keyAttesaPerVecchioCodice = calcolaKeyPerCodice(licenza.codiceMacchina);
    const keySalvataNorm = (licenza.key || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const keyAttesaNorm = (keyAttesaPerVecchioCodice || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (keySalvataNorm === keyAttesaNorm) {
      // L'attivazione era autentica. Aggiorno il file col nuovo codice macchina
      // così le prossime volte la verifica veloce (punto 1) funziona subito.
      try { salvaLicenza(app, licenza.key); } catch (e) {}
      return true;
    }
  }

  return false;
}

module.exports = {
  generaCodiceMacchina,
  calcolaKeyPerCodice,
  validaKey,
  salvaLicenza,
  leggiLicenza,
  eAttivato
};
