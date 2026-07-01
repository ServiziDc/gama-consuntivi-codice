@echo off
chcp 65001 >nul
title GAMA CONSUNTIVI - MODALITA TEST
color 0C

echo ===============================================================
echo                  GAMA CONSUNTIVI - MODALITA TEST
echo ===============================================================
echo.
echo  In questa modalita puoi provare TUTTO il programma:
echo    - Generare consuntivi CBRE, CREVAL, DUSSMANN, ENI
echo    - Generare preventivi
echo    - Provare i colori, i numeri, i salvataggi
echo.
echo  MA NIENTE viene salvato su Firebase:
echo    - I numeri (contatori) NON avanzano
echo    - I consuntivi NON vengono salvati nel database
echo    - I colori NON vengono salvati
echo.
echo  Vedrai una banda ROSSA in alto che te lo ricorda.
echo  Quando chiudi, il database e' pulito come prima.
echo.
echo ===============================================================
echo.

REM Attivo la modalita test tramite variabile d'ambiente
REM (la imposto a livello di processo cosi viene ereditata dall'app)
set GAMA_TEST=1

REM Cerco l'eseguibile installato nei percorsi piu comuni
set "EXE1=%LOCALAPPDATA%\Programs\gama-consuntivi\Gama Consuntivi.exe"
set "EXE2=%LOCALAPPDATA%\Programs\Gama Consuntivi\Gama Consuntivi.exe"
set "EXE3=%PROGRAMFILES%\Gama Consuntivi\Gama Consuntivi.exe"
set "EXE4=%PROGRAMFILES(X86)%\Gama Consuntivi\Gama Consuntivi.exe"

if exist "%EXE1%" (
    echo Avvio: %EXE1%
    echo.
    start "" /b "%EXE1%"
    goto :avviato
)
if exist "%EXE2%" (
    echo Avvio: %EXE2%
    echo.
    start "" /b "%EXE2%"
    goto :avviato
)
if exist "%EXE3%" (
    echo Avvio: %EXE3%
    echo.
    start "" /b "%EXE3%"
    goto :avviato
)
if exist "%EXE4%" (
    echo Avvio: %EXE4%
    echo.
    start "" /b "%EXE4%"
    goto :avviato
)

echo  ERRORE: Non trovo il programma installato.
echo.
echo  Ho cercato in questi percorsi:
echo    %EXE1%
echo    %EXE2%
echo    %EXE3%
echo    %EXE4%
echo.
echo  Assicurati di aver installato Gama Consuntivi.
echo.
pause
goto :fine

:avviato
echo  Programma avviato in MODALITA TEST.
echo  Puoi chiudere questa finestra nera.
echo.
timeout /t 5 >nul

:fine
