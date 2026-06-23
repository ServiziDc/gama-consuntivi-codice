@echo off
title Gama Consuntivi - Test rapido
color 0B

echo.
echo  ============================================================
echo    GAMA CONSUNTIVI - Avvio rapido per test (senza .EXE)
echo  ============================================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo  [X] ERRORE: Node.js non e' installato.
    echo      Scaricalo da: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo  [*] Prima esecuzione: installo le dipendenze...
    call npm install
    if errorlevel 1 (
        echo [X] Errore durante npm install.
        pause
        exit /b 1
    )
)

echo  [*] Avvio l'app in modalita' sviluppo...
echo      ^(Chiudi la finestra dell'app per terminare^)
echo.
call npm start
