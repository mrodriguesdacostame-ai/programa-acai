@echo off
cd /d "%~dp0"
title Acai do Centro

REM encerra qualquer servidor antigo preso
taskkill /F /IM node.exe >nul 2>&1

REM primeira vez: instala as dependencias
if not exist node_modules call npm install

REM inicia o servidor em segundo plano, minimizado (deixe essa janelinha aberta)
start "Acai do Centro - servidor (nao feche esta janela)" /min cmd /c node server.js

REM espera o servidor subir (porta 3001). UM PowerShell so, que fica testando a porta INTERNO
REM (nao depende de curl e nao paga "PowerShell frio" a cada volta). Detecta na hora que subir.
echo  Abrindo o Acai do Centro...
powershell -NoProfile -Command "for($i=0;$i -lt 150;$i++){ try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('localhost',3001); $c.Close(); exit 0 }catch{ Start-Sleep -Milliseconds 300 } }; exit 0" >nul 2>&1

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
