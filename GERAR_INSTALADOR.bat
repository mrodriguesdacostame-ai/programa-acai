@echo off
title Programa Acai - Gerar o instalador (Setup.exe)
color 5F
cls
cd /d "%~dp0"
echo.
echo  ==================================================
echo    GERAR O INSTALADOR PROFISSIONAL (Setup.exe)
echo  ==================================================
echo.
echo   Isto cria o arquivo  ProgramaAcai-Setup.exe  a partir
echo   do codigo ATUAL, dentro da pasta  dist-instalador\.
echo.

REM --- localizar o compilador do Inno Setup (ISCC.exe) ---
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
REM instalacao por usuario (winget costuma por aqui)
if not defined ISCC if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"

if not defined ISCC (
  echo  [!] Inno Setup nao encontrado. Vou tentar instalar via winget...
  echo.
  winget install -e --id JRSoftware.InnoSetup --accept-package-agreements --accept-source-agreements
  echo.
  if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
  if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
  if not defined ISCC if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
)

if not defined ISCC (
  echo  [X] Nao consegui achar/instalar o Inno Setup.
  echo      Baixe e instale gratis em:  https://jrsoftware.org/isdl.php
  echo      Depois rode este GERAR_INSTALADOR.bat de novo.
  pause
  exit /b 1
)

echo  [OK] Inno Setup: "%ISCC%"
echo.
echo  Compilando o instalador...
REM --- pega a versao do package.json e injeta no instalador (fica sempre em dia) ---
set "VER="
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version" 2^>nul`) do set "VER=%%v"
if not defined VER set "VER=1.0.5"
echo  Versao do instalador: %VER%
echo.
echo  Compilando o instalador...
"%ISCC%" /DAppVersao=%VER% "instalador\programa-acai.iss"
if errorlevel 1 (
  echo.
  echo  [X] Falhou a compilacao. Veja o erro acima.
  pause
  exit /b 1
)

echo.
echo  ==================================================
echo    [OK] Instalador gerado em:
echo    %CD%\dist-instalador\ProgramaAcai-Setup.exe
echo  ==================================================
echo   Leve esse Setup.exe pra outra maquina e execute.
echo.
pause
