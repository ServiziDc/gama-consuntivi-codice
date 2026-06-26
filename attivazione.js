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

function generaCodiceMacchina() {
  const interfacce = os.networkInterfaces();
  const macValidi = [];

  // Raccolgo TUTTI i MAC delle schede fisiche (non virtuali, non randomizzate)
  for (const nome of Object.keys(interfacce)) {
    // Salto le interfacce virtuali/randomizzate
    if (INTERFACCE_DA_IGNORARE.test(nome)) continue;
    for (const dettaglio of interfacce[nome]) {
      if (!dettaglio.internal && dettaglio.mac && dettaglio.mac !== '00:00:00:00:00:00') {
        macValidi.push(dettaglio.mac.toLowerCase());
      }
    }
  }

  // ORDINO i MAC e tolgo i duplicati: così l'ordine in cui il sistema elenca
  // le interfacce NON conta (su Mac e Windows può variare). Il codice resta
  // identico sullo stesso PC anche se cambia l'ordine delle schede.
  const macUnici = [...new Set(macValidi)].sort();

  // Se non trovo nessun MAC fisico (raro), uso un fallback basato solo su
  // hostname+sistema (meno unico ma evita di bloccare il programma)
  const macFinale = macUnici.length > 0 ? macUnici.join(',') : 'no-mac';

  // Combino i dati hardware/sistema
  const datiMacchina = [
    macFinale,
    os.hostname(),
    os.platform(),
    os.arch()
  ].join('|');

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
  // Rivalido la key contro il codice macchina ATTUALE (anti-copia del file)
  return validaKey(licenza.key);
}

module.exports = {
  generaCodiceMacchina,
  calcolaKeyPerCodice,
  validaKey,
  salvaLicenza,
  leggiLicenza,
  eAttivato
};
