@echo off
title Programa Acai - Subir pro GitHub (configuracao unica)
color 5F
cls
cd /d "%~dp0"
echo.
echo  ==================================================
echo    PROGRAMA ACAI - LIGAR ESTE PROJETO AO GITHUB
echo  ==================================================
echo.

REM --- precisa do git ---
where git >nul 2>&1
if errorlevel 1 (
  echo  [X] Git nao encontrado. Instale em: https://git-scm.com
  pause
  exit /b 1
)

REM --- precisa ser a PASTA DO PROJETO (tem .git) ---
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo  [X] Esta pasta nao e o projeto com historico do git.
  echo      Rode este arquivo dentro da pasta  PROGRAMA ACAI
  echo      (a original onde voce programa), nao no pacote/pendrive.
  pause
  exit /b 1
)

REM --- ja tem remoto? entao so envia ---
git remote get-url origin >nul 2>&1
if not errorlevel 1 (
  echo  [OK] Ja existe um repositorio online ligado:
  git remote get-url origin
  echo.
  echo  Enviando a versao atual...
  git add -A
  git commit -m "Atualizacao" >nul 2>&1
  git push
  echo.
  echo  Para salvar novas versoes depois, use o  versionar.bat
  pause
  exit /b 0
)

echo  PASSO 1 (no navegador):
echo    - Entre em  https://github.com/new
echo    - Nome do repositorio:  programa-acai
echo    - Marque  PRIVATE (privado)     ^<-- IMPORTANTE
echo    - NAO marque "Add a README"
echo    - Clique em  Create repository
echo.
echo  PASSO 2:
echo    - O GitHub mostra uma URL terminando em  .git
echo      ex.:  https://github.com/SEU-USUARIO/programa-acai.git
echo    - Copie e cole aqui embaixo:
echo.
set /p URL=  URL do repositorio (.git):
set URL=%URL:"=%
if "%URL%"=="" (
  echo  [X] Nenhuma URL informada. Cancelado.
  pause
  exit /b 1
)

echo.
echo  Ligando e enviando... (o GitHub pode pedir login no navegador)
git remote add origin "%URL%"
git branch -M main
git push -u origin main
if errorlevel 1 (
  echo.
  echo  [X] Nao consegui enviar. Causas comuns:
  echo      - login do GitHub nao autorizado ^(tente de novo^)
  echo      - URL errada ^(confira o PASSO 2^)
  echo  Para desfazer a ligacao e tentar de novo:
  echo      git remote remove origin
  pause
  exit /b 1
)

echo.
echo  ==================================================
echo    [OK] PROJETO NO GITHUB (privado)!
echo  ==================================================
echo   - Salvar novas versoes:   versionar.bat
echo   - Atualizar outra maquina: ATUALIZAR.bat (usa git pull)
echo   - Instalar do zero online: git clone %URL%
echo.
pause
