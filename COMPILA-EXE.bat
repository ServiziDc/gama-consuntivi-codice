@echo off
title Gama Consuntivi - Compilazione EXE
color 0E

echo.
echo  ============================================================
echo.
echo    GAMA SERVICE - Generatore Consuntivi
echo    Compilazione installer .EXE
echo.
echo  ============================================================
echo.

cd /d "%~dp0"

echo  [*] Verifico Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [X] ERRORE: Node.js non e' installato.
    echo.
    echo      Scaricalo da: https://nodejs.org/
    echo      Versione consigliata: LTS
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%i in ('node -v') do set NODE_VERSION=%%i
echo      Node.js trovato: %NODE_VERSION%
echo.

if not exist "node_modules\" (
    echo  [*] Prima installazione: scarico Electron e le dipendenze...
    echo      ^(Pesa circa 200 MB, puo' richiedere 5-10 minuti^)
    echo.
    call npm install
    if errorlevel 1 (
        color 0C
        echo.
        echo  [X] ERRORE durante npm install.
        echo      Controlla la connessione Internet e riprova.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Dipendenze installate.
    echo.
) else (
    echo  [*] Dipendenze gia' presenti, salto npm install.
    echo.
)

echo  [*] Compilo l'installer EXE ^(puo' richiedere 3-5 minuti^)...
echo.
call npm run build:win
if errorlevel 1 (
    color 0C
    echo.
    echo  [X] ERRORE durante la compilazione.
    echo.
    echo      Controlla i messaggi sopra per il dettaglio.
    pause
    exit /b 1
)

echo.
color 0A
echo  ============================================================
echo.
echo    [OK] COMPILAZIONE COMPLETATA CON SUCCESSO!
echo.
echo  ============================================================
echo.
echo      L'installer e' nella cartella:  dist\
echo.

if exist "dist\" (
    echo      File generati:
    dir /B "dist\*.exe" 2>nul
    echo.
    set /p APRIRE="Vuoi aprire la cartella dist\ ora? (S/N): "
    if /i "%APRIRE%"=="S" start "" "dist"
)

echo.
pause
