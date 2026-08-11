@echo off
cd /d "%~dp0"
title Acai do Centro

REM encerra qualquer servidor antigo preso
taskkill /F /IM node.exe >nul 2>&1

REM primeira vez: instala as dependencias
if not exist node_modules call npm install

REM inicia o servidor em segundo plano, minimizado (deixe essa janelinha aberta)
start "Acai do Centro - servidor (nao feche esta janela)" /min cmd /c node server.js

REM espera o servidor subir (porta 3001)
echo  Abrindo o Acai do Centro...
:esperar
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('localhost',3001);exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 goto :esperar

REM abre em MODO APLICATIVO (janela propria, sem barra/abas de navegador)
REM ?nc=aleatorio a cada abertura → o Chrome busca a pagina NOVA (sem cache velho)
set "URL=http://localhost:3001/?nc=%RANDOM%%RANDOM%"
set "PFX86=%ProgramFiles(x86)%"
set "NAV="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%PFX86%\Google\Chrome\Application\chrome.exe" set "NAV=%PFX86%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%PFX86%\Microsoft\Edge\Application\msedge.exe" set "NAV=%PFX86%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not defined NAV goto :semnav
REM perfil ISOLADO do app (nao mistura com o Chrome normal) e apaga o cache dele
REM a cada abertura -> impossivel servir app.js/style.css velhos ("atualizei e ficou velho")
set "APPPROF=%LocalAppData%\AcaiDoCentro\navegador"
rmdir /s /q "%APPPROF%\Default\Cache" >nul 2>&1
rmdir /s /q "%APPPROF%\Default\Code Cache" >nul 2>&1
rmdir /s /q "%APPPROF%\Default\GPUCache" >nul 2>&1
rmdir /s /q "%APPPROF%\GrShaderCache" >nul 2>&1
start "" "%NAV%" --app=%URL% --user-data-dir="%APPPROF%" --disk-cache-size=1 --window-size=1300,860
goto :fim
:semnav
REM sem Chrome/Edge: abre no navegador padrao
start "" %URL%
:fim
