@echo off
chcp 1252 >nul
title Pubblicazione Aggiornamento - Gama Consuntivi
color 0E

echo ============================================================
echo    PUBBLICAZIONE AGGIORNAMENTO - GAMA CONSUNTIVI
echo ============================================================
echo.
echo Questo strumento pubblica una nuova versione dell'app.
echo  - Windows: si aggiorna da solo al riavvio
echo  - Mac: GitHub costruisce il file e con "Aggiorna" lo scarichi
echo.
echo ------------------------------------------------------------

REM Mi sposto nella cartella dove si trova questo file .bat
cd /d "%~dp0"

REM Leggo la versione dal package.json e la mostro
echo.
echo Controllo la versione da pubblicare...
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" package.json') do (
  set VERSIONE=%%~a
  goto :trovata
)
:trovata
echo.
echo    Versione che verra' pubblicata: %VERSIONE%
echo.
echo ------------------------------------------------------------
echo.
echo IMPORTANTE: assicurati che il numero di versione sia piu'
echo alto di quello gia' installato, altrimenti l'aggiornamento
echo non partira'.
echo.
set /p CONFERMA="Vuoi procedere con la pubblicazione? (S/N): "
if /i not "%CONFERMA%"=="S" (
  echo.
  echo Pubblicazione annullata.
  echo.
  pause
  exit /b
)

echo.
echo ============================================================
echo  PASSO 1 di 3: Installazione componenti (npm install)
echo ============================================================
echo  Attendere, puo' richiedere qualche minuto...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  ERRORE durante npm install!
  echo  Controlla la connessione internet e che Node.js sia
  echo  installato correttamente.
  echo ============================================================
  echo.
  pause
  exit /b
)

echo.
echo ============================================================
echo  PASSO 2 di 3: Compilazione e pubblicazione Windows
echo ============================================================
echo  Attendere, puo' richiedere qualche minuto...
echo.
call npm run publish
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  ERRORE durante la pubblicazione Windows!
  echo  Possibili cause:
  echo   - Il token GitHub (GH_TOKEN) non e' impostato
  echo   - Problema di connessione
  echo   - La versione e' uguale a una gia' pubblicata
  echo ============================================================
  echo.
  pause
  exit /b
)

echo.
echo ============================================================
echo  PASSO 3 di 3: Invio codice a GitHub per costruire il Mac
echo ============================================================
echo  GitHub costruira' il Mac da solo (qualche minuto).
echo.

REM Inizializzo il collegamento a GitHub se manca (si auto-ripara)
if not exist ".git" git init
git branch -M main 2>nul
git config user.email "simox91.st@gmail.com" 2>nul
git config user.name "ServiziDc" 2>nul

REM Imposto il collegamento usando il token gia' presente sul PC (GH_TOKEN)
git remote remove origin 2>nul
git remote add origin https://%GH_TOKEN%@github.com/ServiziDc/gama-consuntivi-codice.git

REM Invio tutto il codice
git add -A
git commit -m "Aggiornamento versione %VERSIONE%" 2>nul
git push -u origin main --force
if errorlevel 1 (
  echo.
  echo  ATTENZIONE: l'invio del codice per il Mac non e' riuscito.
  echo  Windows e' stato pubblicato comunque.
  echo  Verifica che il repository "gama-consuntivi-codice" esista
  echo  e che il token GH_TOKEN sia valido, poi rilancia.
  echo.
)

echo.
echo ============================================================
echo    PUBBLICAZIONE COMPLETATA!
echo ============================================================
echo.
echo  Versione %VERSIONE%:
echo   - Windows: pubblicato. I PC si aggiornano al riavvio.
echo   - Mac: GitHub lo sta costruendo. Tra qualche minuto,
echo     sul Mac clicca "Aggiorna" per scaricarlo.
echo.
echo  Puoi chiudere questa finestra.
echo ============================================================
echo.
pause
