@echo off
cd /d "%~dp0"
title Acai do Centro

REM encerra qualquer servidor antigo preso
taskkill /F /IM node.exe >nul 2>&1

REM primeira vez: instala as dependencias
if not exist node_modules call npm install

REM inicia o servidor em segundo plano, minimizado (deixe essa janelinha aberta)
start "Acai do Centro - servidor (nao feche esta janela)" /min cmd /c node server.js

REM espera o servidor subir (porta 3001) — usa CURL (rapido) e checa NA HORA, sem spawnar
REM PowerShell a cada volta (PowerShell "frio" logo apos ligar o PC custa segundos).
echo  Abrindo o Acai do Centro...
set "TENT=0"
:esperar
curl -s -o nul --max-time 1 http://localhost:3001/ >nul 2>&1
if not errorlevel 1 goto :subiu
set /a TENT+=1
if %TENT% geq 90 goto :subiu
timeout /t 1 /nobreak >nul
goto :esperar
:subiu

REM abre em MODO APLICATIVO (janela propria, sem barra/abas de navegador)
REM ?nc=aleatorio a cada abertura → o Chrome busca a pagina NOVA (sem cache velho)
set "URL=http://localhost:3001/?nc=%RANDOM%%RANDOM%"
set "PFX86=%ProgramFiles(x86)%"
set "NAV="
REM prioriza o EDGE (o Chrome desta maquina estava travando o app) — cai pro Chrome se nao tiver Edge
if exist "%PFX86%\Microsoft\Edge\Application\msedge.exe" set "NAV=%PFX86%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%PFX86%\Google\Chrome\Application\chrome.exe" set "NAV=%PFX86%\Google\Chrome\Application\chrome.exe"

if not defined NAV goto :semnav
REM abre no perfil PADRAO do Chrome (mantem voce logado). O cache velho ja e resolvido
REM pelo ?v=<mtime> de cada arquivo (servido pelo server) + ?nc na URL + Cache-Control no-store.
REM abre em TELA CHEIA TOTAL (sem barra de titulo e cobrindo a barra do Windows).
REM Pra fechar: Alt+F4. Pra sair da tela cheia sem fechar: F11.
start "" "%NAV%" --app=%URL% --start-fullscreen --window-position=0,0
goto :fim
:semnav
REM sem Chrome/Edge: abre no navegador padrao
start "" %URL%
:fim
