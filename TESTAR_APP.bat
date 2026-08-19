@echo off
cd /d "%~dp0"
title Acai do Centro - TESTE do app nativo
echo Encerrando servidores antigos...
taskkill /F /IM node.exe >nul 2>&1
echo Abrindo o app nativo (Electron)... a primeira vez pode demorar.
call npx electron electron-main.js
