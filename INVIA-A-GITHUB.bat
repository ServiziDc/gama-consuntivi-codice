@echo off
chcp 1252 >nul
title Invia codice a GitHub (per costruire il Mac)
color 0B
cd /d "%~dp0"

echo ============================================================
echo    INVIO CODICE A GITHUB (per costruire il Mac)
echo ============================================================
echo.
echo Questo invia SOLO il codice (non ripubblica Windows).
echo.

if not exist ".git" git init
git branch -M main 2>nul
git config user.email "simox91.st@gmail.com" 2>nul
git config user.name "ServiziDc" 2>nul
git remote remove origin 2>nul
git remote add origin https://%GH_TOKEN%@github.com/ServiziDc/gama-consuntivi-codice.git

git add -A
git commit -m "Invio codice per build Mac" 2>nul

echo.
echo --- Provo a inviare (guarda se sotto compare testo ROSSO) ---
echo.
git push -u origin main --force

echo.
echo ============================================================
echo  Se sopra NON c'e' testo rosso di errore: codice inviato!
echo  Se c'e' un errore: fai uno screenshot e mandalo.
echo ============================================================
echo.
pause
