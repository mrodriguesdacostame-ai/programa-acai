@echo off
cd /d "%~dp0"
title Acai do Centro

REM ============================================================================
REM  MODO TERMINAL: se existe "servidor.txt" (com o endereco do PRINCIPAL), esta
REM  maquina NAO roda servidor proprio — ela abre a tela do principal (pela rede
REM  local, ex.: http://192.168.0.10:3001, ou pela internet, ex.: a URL do tunel).
REM  O banco fica so no principal, entao todas as maquinas veem os MESMOS dados.
REM  Sem "servidor.txt" = esta e a maquina PRINCIPAL (roda o servidor local).
REM ============================================================================
set "BASE=http://localhost:3001"
if exist "servidor.txt" (
  set /p BASE=<servidor.txt
  echo  Modo TERMINAL - conectando no servidor principal...
  goto :abrir
)

REM ===== MODO PRINCIPAL (padrao): sobe o servidor local =====
taskkill /F /IM node.exe >nul 2>&1
if not exist node_modules call npm install --omit=dev
start "Acai do Centro - servidor (nao feche esta janela)" /min cmd /c node server.js
echo  Abrindo o Acai do Centro...
powershell -NoProfile -Command "for($i=0;$i -lt 150;$i++){ try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('localhost',3001); $c.Close(); exit 0 }catch{ Start-Sleep -Milliseconds 300 } }; exit 0" >nul 2>&1

:abrir
REM ?nc=aleatorio a cada abertura -> busca a pagina NOVA (sem cache velho)
set "URL=%BASE%/?nc=%RANDOM%%RANDOM%"
set "PFX86=%ProgramFiles(x86)%"
set "NAV="
REM procura o EDGE e o CHROME em TODOS os locais possiveis (inclusive instalacao no perfil do usuario)
if exist "%PFX86%\Microsoft\Edge\Application\msedge.exe" set "NAV=%PFX86%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%PFX86%\Google\Chrome\Application\chrome.exe" set "NAV=%PFX86%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "NAV=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "NAV=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV for /f "delims=" %%p in ('where chrome 2^>nul') do if not defined NAV set "NAV=%%p"
if not defined NAV for /f "delims=" %%p in ('where msedge 2^>nul') do if not defined NAV set "NAV=%%p"

if not defined NAV goto :semnav
REM janela PROPRIA e independente (perfil dedicado), maximizada (com X e barra de tarefas)
set "PERFIL=%LocalAppData%\AcaiDoCentro\navegador"
start "" "%NAV%" --user-data-dir="%PERFIL%" --app=%URL% --start-maximized --window-position=0,0
goto :fim
:semnav
start "" %URL%
:fim
