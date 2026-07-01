#!/bin/bash

# ============================================================
#   AGGIORNA GAMA CONSUNTIVI - Mac
#   Doppio clic per aggiornare automaticamente
# ============================================================

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "============================================================"
echo "   AGGIORNAMENTO GAMA CONSUNTIVI"
echo "============================================================"
echo ""

# --- Trova la versione installata attualmente ---
APP_PATH="/Applications/Gama Consuntivi.app"
if [ -f "$APP_PATH/Contents/Info.plist" ]; then
  VERSIONE_ATTUALE=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "sconosciuta")
else
  VERSIONE_ATTUALE="non installata"
fi
echo -e "  Versione attuale: ${YELLOW}$VERSIONE_ATTUALE${NC}"

# --- Scarica info ultima versione da GitHub ---
echo ""
echo "  Controllo ultima versione disponibile..."
LATEST_JSON=$(curl -s "https://api.github.com/repos/ServiziDc/gama-consuntivi-releases/releases/latest")
VERSIONE_NUOVA=$(echo "$LATEST_JSON" | grep '"tag_name"' | sed 's/.*"tag_name": *"v\([^"]*\)".*/\1/')

if [ -z "$VERSIONE_NUOVA" ]; then
  echo -e "${RED}  Errore: impossibile contattare GitHub. Controlla la connessione.${NC}"
  echo ""
  read -p "  Premi Invio per uscire..."
  exit 1
fi

echo -e "  Ultima versione: ${GREEN}$VERSIONE_NUOVA${NC}"

# --- Controlla se è già aggiornato ---
if [ "$VERSIONE_ATTUALE" = "$VERSIONE_NUOVA" ]; then
  echo ""
  echo -e "${GREEN}  Sei già alla versione più recente!${NC}"
  echo ""
  read -p "  Premi Invio per uscire..."
  exit 0
fi

echo ""
echo -e "  Aggiornamento disponibile: ${YELLOW}$VERSIONE_ATTUALE${NC} → ${GREEN}$VERSIONE_NUOVA${NC}"
echo ""
read -p "  Vuoi aggiornare adesso? (s/n): " RISPOSTA
if [[ ! "$RISPOSTA" =~ ^[Ss]$ ]]; then
  echo ""
  echo "  Aggiornamento annullato."
  echo ""
  exit 0
fi

# --- Trova il link ZIP arm64 o x64 ---
# NOTA: uso lo ZIP invece del DMG perché lo ZIP è sempre presente per entrambe
# le architetture (il DMG arm64 a volte non viene generato su GitHub Actions).
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  ZIP_URL=$(echo "$LATEST_JSON" | grep '"browser_download_url"' | grep 'arm64.zip"' | grep -v blockmap | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
  TIPO_ARCH="Apple Silicon (arm64)"
else
  ZIP_URL=$(echo "$LATEST_JSON" | grep '"browser_download_url"' | grep 'x64.zip"' | grep -v blockmap | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
  TIPO_ARCH="Intel (x64)"
fi

# Ripiego di sicurezza: se per qualche motivo non trovo lo ZIP della mia
# architettura, provo il DMG (vecchio metodo) prima di arrendermi.
USA_DMG=0
if [ -z "$ZIP_URL" ]; then
  if [ "$ARCH" = "arm64" ]; then
    ZIP_URL=$(echo "$LATEST_JSON" | grep '"browser_download_url"' | grep 'arm64.dmg"' | grep -v blockmap | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
  else
    ZIP_URL=$(echo "$LATEST_JSON" | grep '"browser_download_url"' | grep 'x64.dmg"' | grep -v blockmap | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
  fi
  [ -n "$ZIP_URL" ] && USA_DMG=1
fi

if [ -z "$ZIP_URL" ]; then
  echo -e "${RED}  Errore: link download non trovato per $TIPO_ARCH${NC}"
  echo "  Contatta Simone: la versione Mac potrebbe non essere ancora pronta."
  echo ""
  read -p "  Premi Invio per uscire..."
  exit 1
fi

echo ""
echo "  Architettura: $TIPO_ARCH"
echo ""
echo "============================================================"
echo "  PASSO 1: Download..."
echo "============================================================"

# --- CASO DMG (ripiego) ---
if [ "$USA_DMG" = "1" ]; then
  DMG_FILE="$HOME/Downloads/GamaConsuntivi-$VERSIONE_NUOVA.dmg"
  curl -L --progress-bar "$ZIP_URL" -o "$DMG_FILE"
  if [ ! -f "$DMG_FILE" ]; then
    echo -e "${RED}  Errore durante il download!${NC}"; echo ""; read -p "  Premi Invio per uscire..."; exit 1
  fi
  echo ""
  echo "  Rimozione blocco sicurezza..."
  xattr -cr "$DMG_FILE"
  HDIUTIL_OUT=$(hdiutil attach "$DMG_FILE" -nobrowse -noautoopen 2>/dev/null)
  MOUNT_POINT=$(echo "$HDIUTIL_OUT" | grep "/Volumes/" | sed 's|.*\(/Volumes/[^\t]*\)|\1|' | sed 's/[[:space:]]*$//')
  APP_IN=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" | head -1)
  APP_NOME=$(basename "$APP_IN" .app)
  pkill -x "$APP_NOME" 2>/dev/null; sleep 1
  rm -rf "/Applications/$(basename "$APP_IN")"
  cp -R "$APP_IN" "/Applications/"
  xattr -cr "/Applications/$(basename "$APP_IN")"
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null
  rm -f "$DMG_FILE"
  echo ""
  echo -e "  ${GREEN}AGGIORNAMENTO COMPLETATO!${NC}"
  open "/Applications/$(basename "$APP_IN")"
  echo "  App avviata. Puoi chiudere questa finestra."
  echo ""
  exit 0
fi

# --- CASO ZIP (normale) ---
ZIP_FILE="$HOME/Downloads/GamaConsuntivi-$VERSIONE_NUOVA.zip"
curl -L --progress-bar "$ZIP_URL" -o "$ZIP_FILE"

if [ ! -f "$ZIP_FILE" ]; then
  echo -e "${RED}  Errore durante il download!${NC}"
  echo ""
  read -p "  Premi Invio per uscire..."
  exit 1
fi

echo ""
echo "============================================================"
echo "  PASSO 2: Rimozione blocco sicurezza Mac..."
echo "============================================================"
xattr -cr "$ZIP_FILE"
echo "  OK"

echo ""
echo "============================================================"
echo "  PASSO 3: Estrazione e installazione..."
echo "============================================================"

# Estraggo lo zip in una cartella temporanea
TMP_DIR="$HOME/Downloads/gama_update_tmp_$$"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
ditto -x -k "$ZIP_FILE" "$TMP_DIR" 2>/dev/null || unzip -q "$ZIP_FILE" -d "$TMP_DIR"

# Trovo il .app estratto
APP_IN_ZIP=$(find "$TMP_DIR" -maxdepth 2 -name "*.app" | head -1)

if [ -z "$APP_IN_ZIP" ]; then
  echo -e "${RED}  Errore: app non trovata nello ZIP${NC}"
  rm -rf "$TMP_DIR"; rm -f "$ZIP_FILE"
  echo ""
  read -p "  Premi Invio per uscire..."
  exit 1
fi

echo "  App trovata: $(basename "$APP_IN_ZIP")"

# Chiudo l'app se è aperta
APP_NOME=$(basename "$APP_IN_ZIP" .app)
pkill -x "$APP_NOME" 2>/dev/null
sleep 1

# Copio in /Applications (sovrascrive)
echo "  Copio in /Applications..."
rm -rf "/Applications/$(basename "$APP_IN_ZIP")"
cp -R "$APP_IN_ZIP" "/Applications/"

# Rimuovo blocco anche dall'app installata
xattr -cr "/Applications/$(basename "$APP_IN_ZIP")"

# Pulisco
rm -rf "$TMP_DIR"
rm -f "$ZIP_FILE"

echo ""
echo "============================================================"
echo -e "  ${GREEN}AGGIORNAMENTO COMPLETATO!${NC}"
echo "  Gama Consuntivi $VERSIONE_NUOVA installato."
echo "============================================================"
echo ""

# Apro l'app aggiornata
open "/Applications/$(basename "$APP_IN_ZIP")"

echo "  App avviata. Puoi chiudere questa finestra."
echo ""
