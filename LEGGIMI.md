# GAMA CONSUNTIVI - Versione 2.9.0

App desktop per generare consuntivi CBRE/CREVAL e PREVENTIVI di Gama Service S.R.L.

## NOVITA' VERSIONE 2.9.0

- PREVENTIVI: nuova sezione per creare preventivi (offerte) con destinatario
  modificabile, elenco voci libero, numerazione separata, cartella separata.
- Cartelle organizzate per ANNO (2026, 2027...) dentro CONSULTIVI GAMA.
- File Excel CBRE dentro la cartella CBRE, Excel CREVAL dentro CREVAL.
- Modifica consuntivo gia' esistente (bottone matita nello Storico).
- Ricerca consuntivi per ODL (cerca in tutti i mesi).
- Opzione "Solo Excel" per aggiungere all'Excel senza creare il documento.
- Etichetta "CR" davanti al numero CREVAL nell'app.
- Consuntivi senza numero gestiti (cella numero vuota nell'Excel).

## VERSIONI PRECEDENTI (riassunto)

- Doppio salvataggio: .docx sul NAS + PDF sul Desktop (cartella PDF CONSUNTIVI).
- NAS multi-PC con cartella condivisa "CONSULTIVI GAMA" e modalita' offline.
- Espansione automatica righe Excel (CBRE e CREVAL) senza limite.
- Righe gialle Excel rimosse (tutte bianche).
- Numerazione atomica via Firebase (niente duplicati tra PC).

## COME CREARE L'INSTALLER .EXE

1. Installa Node.js da https://nodejs.org/ (versione LTS) - una volta sola
2. Doppio click su COMPILA-EXE.bat
3. L'installer si trova nella cartella dist\
4. Per provare senza compilare: doppio click su TEST-RAPIDO.bat

## CARTELLE

CONSUNTIVI (sul NAS, cartella scelta + "CONSULTIVI GAMA"):
  CONSULTIVI GAMA/2026/06_GIUGNO_2026/CBRE/   (docx + excel CBRE)
  CONSULTIVI GAMA/2026/06_GIUGNO_2026/CREVAL/ (docx + excel CREVAL)

PDF (sul Desktop locale di ogni PC):
  PDF CONSUNTIVI/2026/06_GIUGNO_2026/CBRE/    (solo PDF)
  PDF CONSUNTIVI/2026/06_GIUGNO_2026/CREVAL/  (solo PDF)

PREVENTIVI (cartella separata scelta nelle Impostazioni):
  PREVENTIVI GAMA/2026/   (solo docx)

## CONFIGURAZIONE NAS QNAP (multi-PC)

1. Crea cartella condivisa sul NAS (es. Consuntivi-Gama)
2. Su ogni PC mappa l'unita' di rete (es. Z:) verso quella cartella
3. Al primo avvio scegli la cartella padre (es. Z:) - l'app crea CONSULTIVI GAMA
4. Su tutti i PC scegli la STESSA cartella padre

## FIREBASE

Credenziali gia' inserite in src/firebase-config.js (progetto gama-service).
Contatori separati: contatore_cbre, contatore_creval, contatore_preventivo.

## SUPPORTO

Per problemi di compilazione vedere COME_COMPILARE.md (se presente).
