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

echo  Encerrando qualquer servidor antigo preso (node)...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 /nobreak >nul
echo  OK.
echo.

if not exist node_modules (
  echo  Instalando dependencias pela primeira vez...
  echo  Aguarde...
  call npm install
  echo.
)

echo  Iniciando servidor (RECARGA AUTOMATICA ligada)...
echo  - Deixe esta janela ABERTA enquanto usa o sistema.
echo  - Quando o sistema for atualizado, o servidor se ajusta sozinho.
echo  - No navegador, use Ctrl+F5 para ver as telas novas.
echo.
echo  Acesse: http://localhost:3001
echo  (Ctrl+C encerra o servidor)
echo.

start "" http://localhost:3001
node --watch server.js

echo.
echo  O servidor PAROU. Rode o iniciar.bat de novo para religar.
pause
