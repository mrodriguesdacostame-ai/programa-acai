@echo off
title PROGRAMA ACAI - Iniciando...
color 5F
cls
echo.
echo  ===========================================
echo       PROGRAMA ACAI - ACAI DO CENTRO
echo  ===========================================
echo.

cd /d "%~dp0"

if not exist node_modules (
  echo  Instalando dependencias pela primeira vez...
  echo  Aguarde...
  call npm install
  echo.
)

echo  Iniciando servidor...
echo  Acesse: http://localhost:3001
echo.
echo  Pressione CTRL+C para encerrar.
echo.

start "" http://localhost:3001
node server.js
pause
