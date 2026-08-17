@echo off
title Programa Acai - Conectar ao GitHub (uma vez, na loja)
color 5F
cls
cd /d "%~dp0"
REM URL do repositorio JA EMBUTIDA (nao precisa digitar nada)
set "REPO=https://github.com/mrodriguesdacostame-ai/programa-acai.git"
set "GIT=git"

echo.
echo  ==================================================
echo    LIGAR ESTA MAQUINA AO GITHUB (atualizacao online)
echo  ==================================================
echo.
echo   Faca isto UMA VEZ. Depois, atualizar e so 1 clique
echo   no ATUALIZAR (baixa as mudancas do GitHub).
echo   Seus dados (banco, .env, backups) NAO sao tocados.
echo.

REM --- garante o Git: instala sozinho via winget se faltar ---
where git >nul 2>&1
if not errorlevel 1 goto :temgit
echo  Git nao encontrado. Instalando automaticamente (precisa de internet, pode demorar)...
winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
REM apos o winget, o git ainda nao esta no PATH DESTA janela: usa o caminho padrao
if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"
"%GIT%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [X] Nao consegui instalar o Git automaticamente.
  echo      Abri o site pra voce baixar: https://git-scm.com/download/win
  echo      Instale, feche esta janela e rode este arquivo de novo.
  start "" https://git-scm.com/download/win
  pause
  exit /b 1
)
:temgit

REM ja esta ligado ao GitHub?
"%GIT%" rev-parse --is-inside-work-tree >nul 2>&1
if not errorlevel 1 (
  "%GIT%" remote get-url origin >nul 2>&1
  if not errorlevel 1 (
    echo  [OK] Esta maquina JA esta ligada ao GitHub:
    "%GIT%" remote get-url origin
    echo.
    echo  Use o ATUALIZAR para baixar a versao nova.
    pause
    exit /b 0
  )
)

echo  Ligando ao repositorio do Acai do Centro...
echo    %REPO%
echo.
if not exist ".git" "%GIT%" init
"%GIT%" remote remove origin >nul 2>&1
"%GIT%" remote add origin "%REPO%"
"%GIT%" fetch origin main
if errorlevel 1 (
  echo  [X] Nao consegui baixar do GitHub. Confira a internet e tente de novo.
  pause
  exit /b 1
)
"%GIT%" checkout -B main >nul 2>&1
"%GIT%" branch --set-upstream-to=origin/main main >nul 2>&1
"%GIT%" reset --hard origin/main
if errorlevel 1 (
  echo  [X] Falhou ao alinhar o codigo. Veja o erro acima.
  pause
  exit /b 1
)

echo.
echo  ==================================================
echo    [OK] LIGADA AO GITHUB!
echo  ==================================================
echo   Agora, para atualizar, e so rodar o ATUALIZAR (1 clique).
echo   Nunca mais precisa de pen drive.
echo.
pause
