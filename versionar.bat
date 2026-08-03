@echo off
title Programa Acai - Salvar versao online
color 5F
cls
echo.
echo  ===========================================
echo    PROGRAMA ACAI - SALVAR VERSAO ONLINE
echo  ===========================================
echo.
cd /d "%~dp0"

REM --- Git instalado? ---
where git >nul 2>&1
if errorlevel 1 (
  echo  [X] Git nao encontrado. Instale em: https://git-scm.com
  pause
  exit /b 1
)

REM --- Ja existe um repositorio remoto configurado? ---
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo  [!] Ainda nao ha um repositorio online ligado a este projeto.
  echo      Abra o arquivo  VERSIONAR_ONLINE.md  e siga os passos 1 e 2
  echo      ^(criar o repositorio no GitHub e ligar com "git remote add"^).
  echo.
  pause
  exit /b 1
)

echo  Salvando o estado atual...
git add -A

REM --- Ha algo pra salvar? ---
git diff --cached --quiet
if not errorlevel 1 (
  echo  [OK] Nada mudou desde a ultima versao. Nada a enviar.
  echo.
  pause
  exit /b 0
)

set /p MSG=  Descreva a mudanca (enter = data/hora):
if "%MSG%"=="" set MSG=Backup automatico %date% %time%

git commit -m "%MSG%"
echo.
echo  Enviando pro GitHub...
git push
if errorlevel 1 (
  echo.
  echo  [X] Falhou ao enviar. Confira sua internet / login do GitHub.
  pause
  exit /b 1
)

echo.
echo  [OK] Versao salva online com sucesso!
echo.
pause
