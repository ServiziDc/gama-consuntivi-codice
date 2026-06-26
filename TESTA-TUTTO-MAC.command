#!/bin/bash
# ============================================================================
#  GAMA CONSUNTIVI — TEST AUTOMATICO COMPLETO (Mac)
#  Doppio click per lanciare i test su Mac. Stesso motore della versione Windows.
# ============================================================================

# Vai nella cartella dello script
cd "$(dirname "$0")"

# Colori
VERDE='\033[0;32m'
ROSSO='\033[0;31m'
CIANO='\033[0;36m'
GRASSETTO='\033[1m'
RESET='\033[0m'

clear
echo ""
echo -e "${CIANO}${GRASSETTO}"
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║          GAMA CONSUNTIVI - TEST AUTOMATICO COMPLETO          ║"
echo "  ║                       (versione Mac)                         ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo "   Avvio dei test in corso..."
echo ""

# Verifico che Node.js sia installato
if ! command -v node &> /dev/null; then
    echo -e "${ROSSO}  ❌ ERRORE: Node.js non e' installato.${RESET}"
    echo "     Installa Node.js da https://nodejs.org per usare i test."
    echo ""
    echo "   Premi INVIO per chiudere..."
    read
    exit 1
fi

# Verifico che lo script di test esista
if [ ! -f "test-completo.js" ]; then
    echo -e "${ROSSO}  ❌ ERRORE: file test-completo.js non trovato.${RESET}"
    echo ""
    echo "   Premi INVIO per chiudere..."
    read
    exit 1
fi

# Eseguo i test
node test-completo.js
RISULTATO=$?

echo ""
echo "  ────────────────────────────────────────────────────────────────"
if [ $RISULTATO -eq 0 ]; then
    echo -e "${VERDE}${GRASSETTO}   ✅ TEST COMPLETATI SENZA ERRORI${RESET}"
else
    echo -e "${ROSSO}${GRASSETTO}   ⚠️  TEST COMPLETATI CON ERRORI - controlla il report sopra${RESET}"
fi
echo "  ────────────────────────────────────────────────────────────────"
echo ""
echo "   Il report dettagliato e' stato salvato come file di testo"
echo "   in questa cartella (REPORT-TEST-...txt)"
echo ""
echo "   Premi INVIO per chiudere..."
read
