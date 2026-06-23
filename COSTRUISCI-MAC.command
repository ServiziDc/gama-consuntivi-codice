#!/bin/bash
# ============================================================
#  COSTRUISCI APP MAC - Gama Consuntivi
#  Doppio clic su questo file per costruire il .dmg del Mac.
#  (Se Mac dice "sviluppatore non identificato": tasto destro
#   sul file -> Apri -> Apri.)
# ============================================================

# Mi sposto nella cartella dove si trova questo file
cd "$(dirname "$0")"

echo "============================================================"
echo "   COSTRUZIONE APP MAC - GAMA CONSUNTIVI"
echo "============================================================"
echo ""
echo "Cartella: $(pwd)"
echo ""
echo "Passo 1/2: installazione componenti (npm install)..."
echo "Puo' richiedere qualche minuto, attendere..."
echo ""
npm install
if [ $? -ne 0 ]; then
  echo ""
  echo "!!! ERRORE durante npm install."
  echo "    Controlla la connessione internet e che Node.js sia installato."
  read -p "Premi Invio per chiudere..."
  exit 1
fi

echo ""
echo "Passo 2/2: costruzione del .dmg (build:mac)..."
echo "Puo' richiedere qualche minuto, attendere..."
echo ""
npm run build:mac
if [ $? -ne 0 ]; then
  echo ""
  echo "!!! ERRORE durante la costruzione."
  read -p "Premi Invio per chiudere..."
  exit 1
fi

echo ""
echo "============================================================"
echo "   FATTO! Il file .dmg e' nella cartella 'dist'."
echo "   Usa quello con 'x64' nel nome (la tua VM e' Intel)."
echo "============================================================"
echo ""
read -p "Premi Invio per chiudere..."
