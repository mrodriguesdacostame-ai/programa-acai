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
REM procura o EDGE e o CHROME em TODOS os locais possiveis (inclusive instalacao no perfil do usuario,
REM que era o que faltava: sem achar, ele abria como ABA comum em vez de janela propria do app).
if exist "%PFX86%\Microsoft\Edge\Application\msedge.exe" set "NAV=%PFX86%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%PFX86%\Google\Chrome\Application\chrome.exe" set "NAV=%PFX86%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "NAV=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "NAV=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
REM ultimo recurso: pergunta ao Windows onde esta o chrome/msedge (via where)
if not defined NAV for /f "delims=" %%p in ('where chrome 2^>nul') do if not defined NAV set "NAV=%%p"
if not defined NAV for /f "delims=" %%p in ('where msedge 2^>nul') do if not defined NAV set "NAV=%%p"

if not defined NAV goto :semnav
REM abre numa JANELA PROPRIA E INDEPENDENTE (perfil dedicado --user-data-dir): NAO mistura com as
REM abas do seu navegador (BotConversa etc.) e SEMPRE abre separado, mesmo com o Chrome/Edge ja aberto.
REM Tela cheia total (sem barra). Pra fechar: Alt+F4. Pra sair da tela cheia: F11.
set "PERFIL=%LocalAppData%\AcaiDoCentro\navegador"
start "" "%NAV%" --user-data-dir="%PERFIL%" --app=%URL% --start-fullscreen --window-position=0,0
goto :fim
:semnav
REM sem Chrome/Edge: abre no navegador padrao
start "" %URL%
:fim
