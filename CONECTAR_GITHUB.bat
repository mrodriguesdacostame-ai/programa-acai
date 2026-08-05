@echo off
title Programa Acai - Conectar ao GitHub (uma vez, na loja)
color 5F
cls
cd /d "%~dp0"
echo.
echo  ==================================================
echo    LIGAR ESTA MAQUINA AO GITHUB (para atualizacoes)
echo  ==================================================
echo.
echo   Faca isto UMA VEZ, na maquina onde o sistema foi
echo   instalado. Depois, as atualizacoes chegam so com o
echo   ATUALIZAR.bat (baixando as mudancas do GitHub).
echo.
echo   Seus dados (banco, .env, backups) NAO sao tocados.
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo  [X] Git nao encontrado. Instale em: https://git-scm.com
  echo      e rode este arquivo de novo.
  pause
  exit /b 1
)

REM ja e um repositorio ligado?
git rev-parse --is-inside-work-tree >nul 2>&1
if not errorlevel 1 (
  git remote get-url origin >nul 2>&1
  if not errorlevel 1 (
    echo  [OK] Esta maquina JA esta ligada ao GitHub:
    git remote get-url origin
    echo.
    echo  Use o  ATUALIZAR.bat  para baixar a versao nova.
    pause
    exit /b 0
  )
)

echo  Cole a URL do repositorio (a mesma do GitHub, termina em .git):
echo    ex.:  https://github.com/SEU-USUARIO/programa-acai.git
echo.
set "URL="
set /p URL=  URL:
if not defined URL (
  echo  [X] Nenhuma URL informada. Cancelado.
  pause
  exit /b 1
)
set URL=%URL:"=%

echo.
echo  Ligando ao repositorio (o GitHub pode pedir login no navegador)...
if not exist ".git" git init
git remote remove origin >nul 2>&1
git remote add origin "%URL%"
git fetch origin
if errorlevel 1 (
  echo  [X] Nao consegui acessar o repositorio. Confira a URL e o login.
  pause
  exit /b 1
)

REM descobre o ramo principal (main ou master)
set "RAMO=main"
git show-ref --verify --quiet refs/remotes/origin/main
if errorlevel 1 set "RAMO=master"

echo  Alinhando o codigo com o GitHub (ramo %RAMO%)...
git checkout -B %RAMO% >nul 2>&1
git branch --set-upstream-to=origin/%RAMO% %RAMO% >nul 2>&1
git reset --hard origin/%RAMO%
if errorlevel 1 (
  echo  [X] Falhou ao alinhar. Veja o erro acima.
  pause
  exit /b 1
)

echo.
echo  ==================================================
echo    [OK] Ligada ao GitHub!
echo  ==================================================
echo   Daqui pra frente, para atualizar e so rodar:
echo        ATUALIZAR.bat
echo.
pause
