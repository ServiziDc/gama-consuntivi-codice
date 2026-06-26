@echo off
title GAMA CONSUNTIVI - Test Automatico Completo
color 0B

echo.
echo  ==============================================================
echo            GAMA CONSUNTIVI - TEST AUTOMATICO COMPLETO
echo  ==============================================================
echo.
echo   Avvio dei test in corso...
echo.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    color 0C
    echo  ERRORE: Node.js non e' installato o non e' nel PATH.
    echo     Installa Node.js da https://nodejs.org per usare i test.
    echo.
    pause
    exit /b 1
)

if not exist "test-completo.js" (
    color 0C
    echo  ERRORE: file test-completo.js non trovato in questa cartella.
    echo.
    pause
    exit /b 1
)

node test-completo.js
set RISULTATO=%errorlevel%

echo.
echo  --------------------------------------------------------------
if "%RISULTATO%"=="0" (
    color 0A
    echo   TEST COMPLETATI SENZA ERRORI
) else (
    color 0C
    echo   TEST COMPLETATI CON ERRORI - controlla il report sopra
)
echo  --------------------------------------------------------------
echo.
echo   Il report dettagliato e' stato salvato come file di testo
echo   in questa cartella ^(REPORT-TEST-...txt^)
echo.
pause
