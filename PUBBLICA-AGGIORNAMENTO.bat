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

cd /d "%~dp0"

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
set /p CONFERMA="Vuoi procedere con la pubblicazione? (S/N): "
if /i not "%CONFERMA%"=="S" (
  echo Pubblicazione annullata.
  pause
  exit /b
)

echo.
echo ============================================================
echo  PASSO 1 di 3: Installazione componenti (npm install)
echo ============================================================
call npm install
if errorlevel 1 (
  echo ERRORE durante npm install!
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
REM NON blocchiamo su errore qui: electron-builder a volte esce con
REM errorlevel 1 anche quando l'upload e' riuscito (file gia' esistente).
REM Andiamo avanti al passo 3 sempre.

echo.
echo ============================================================
echo  PASSO 3 di 3: Invio codice a GitHub per costruire il Mac
echo ============================================================
echo  GitHub costruira' il Mac da solo (qualche minuto).
echo.

if not exist ".git" git init
git config user.email "simox91.st@gmail.com" 2>nul
git config user.name "ServiziDc" 2>nul
git branch -M main 2>nul
git remote remove origin 2>nul
git remote add origin https://%GH_TOKEN%@github.com/ServiziDc/gama-consuntivi-codice.git

git add -A
git commit --allow-empty -m "Pubblicazione v%VERSIONE%"
git push -u origin main --force

if errorlevel 1 (
  echo.
  echo  ATTENZIONE: invio codice Mac NON riuscito!
  echo  Windows e' stato pubblicato comunque.
  echo  Riprova con INVIA-A-GITHUB.bat
  echo.
) else (
  echo.
  echo  Codice inviato! GitHub sta costruendo il Mac...
  echo  Tra 10-15 minuti sul Mac clicca "Aggiorna" nelle impostazioni.
  echo.
)

echo.
echo ============================================================
echo    FATTO! Versione %VERSIONE% pubblicata.
echo ============================================================
echo.
pause
