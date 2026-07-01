#!/bin/bash
# GAMA CONSUNTIVI - MODALITA TEST (Mac)
# Lancia il programma senza salvare nulla su Firebase

echo "==============================================================="
echo "                 GAMA CONSUNTIVI - MODALITA TEST"
echo "==============================================================="
echo ""
echo "  In questa modalita puoi provare TUTTO il programma."
echo "  MA NIENTE viene salvato su Firebase:"
echo "    - I numeri (contatori) NON avanzano"
echo "    - I consuntivi NON vengono salvati"
echo "    - I colori NON vengono salvati"
echo ""
echo "  Vedrai una banda ROSSA in alto che te lo ricorda."
echo "==============================================================="
echo ""

# Attivo la modalita test
export GAMA_TEST=1

# Cerco l'app installata
APP1="/Applications/Gama Consuntivi.app"
APP2="$HOME/Applications/Gama Consuntivi.app"

APP=""
if [ -d "$APP1" ]; then
    APP="$APP1"
elif [ -d "$APP2" ]; then
    APP="$APP2"
fi

if [ -z "$APP" ]; then
    echo "ERRORE: Non trovo Gama Consuntivi installato."
    echo "Cercato in:"
    echo "  $APP1"
    echo "  $APP2"
    echo ""
    read -p "Premi INVIO per chiudere..."
    exit 1
fi

# Lancio direttamente l'eseguibile interno con la variabile GAMA_TEST
# (cosi viene ereditata in modo sicuro, a differenza di open --env)
ESEGUIBILE="$APP/Contents/MacOS/Gama Consuntivi"
if [ -f "$ESEGUIBILE" ]; then
    echo "Avvio: $APP (modalita test)"
    GAMA_TEST=1 "$ESEGUIBILE" &
else
    echo "Avvio: $APP (modalita test, via open)"
    GAMA_TEST=1 open -n "$APP"
fi

echo ""
echo "Programma avviato in MODALITA TEST."
echo "Puoi chiudere questa finestra."
sleep 3
