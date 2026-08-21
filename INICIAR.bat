@echo off
setlocal enableextensions
cd /d "%~dp0"
title Acai do Centro

REM ============================================================================
REM  MODO TERMINAL: se existe "servidor.txt" (com o endereco do PRINCIPAL), esta
REM  maquina NAO roda servidor proprio - ela abre a tela do principal (pela rede
REM  local, ex.: http://192.168.0.10:3001, ou pela internet, ex.: a URL do tunel).
REM  Sem "servidor.txt" = esta e a maquina PRINCIPAL (roda o servidor local).
REM ============================================================================
set "BASE=http://localhost:3001"
if exist "servidor.txt" set /p BASE=<servidor.txt
if exist "servidor.txt" echo  Modo TERMINAL - conectando no servidor principal...
if exist "servidor.txt" goto :abrir

REM ===== MODO PRINCIPAL (padrao): sobe o servidor local =====
REM 0) Se o servidor JA esta no ar, NAO reinicia  abre direto (bem mais rapido nas reaberturas)
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('localhost',3001);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto :abrir

REM 1) Node: usa o EMBUTIDO (runtime\node.exe, vem dentro do instalador) se existir;
REM    senao cai no Node do sistema. Assim NAO precisa instalar Node na maquina.
set "NODEEXE=node"
if exist "%~dp0runtime\node.exe" set "NODEEXE=%~dp0runtime\node.exe"
if not exist "%~dp0runtime\node.exe" where node >nul 2>&1
if not exist "%~dp0runtime\node.exe" if errorlevel 1 goto :semnode

REM 2) limpa instancias velhas (node zumbi que trava o "Abrindo...") e garante a pasta de log
taskkill /F /IM node.exe >nul 2>&1
if not exist logs mkdir logs >nul 2>&1

REM 3) sobe o servidor em 2o plano GRAVANDO O LOG (Start-Process do PowerShell herda o
REM    cwd deste .bat; e' o jeito confiavel - cmd /c com caminho que tem espaco falha).
REM    Se o servidor cair, o motivo fica em logs\servidor-erros.txt.
echo  Iniciando o servidor...
powershell -NoProfile -Command "Start-Process '%NODEEXE%' -ArgumentList 'server.js' -RedirectStandardOutput 'logs\servidor.txt' -RedirectStandardError 'logs\servidor-erros.txt' -WindowStyle Hidden"

REM 4) espera a porta 3001 responder (ate ~30s) - UMA chamada PowerShell, sem loop de cmd
echo  Abrindo o Acai do Centro...
powershell -NoProfile -Command "for($i=0;$i -lt 100;$i++){ try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('localhost',3001); $c.Close(); exit 0 }catch{ Start-Sleep -Milliseconds 300 } }; exit 1" >nul 2>&1
if errorlevel 1 echo  (O servidor demorou. Vou abrir mesmo assim; se nao carregar, me mande logs\servidor-erros.txt)

:abrir
REM ?nc=aleatorio a cada abertura -> busca a pagina NOVA (sem cache velho)
set "URL=%BASE%/?nc=%RANDOM%%RANDOM%"
set "PFX86=%ProgramFiles(x86)%"
set "NAV="
REM procura EDGE e CHROME em TODOS os locais (inclusive instalacao no perfil do usuario)
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
goto :fim

:semnode
echo.
echo  ============================================================
echo   O Node.js nao esta instalado nesta maquina.
echo   Rode o instalador "AcaiDoCentro-Setup" de novo (ele instala
echo   o Node) ou instale o Node 22+ e abra novamente.
echo  ============================================================
echo.
pause

:fim
endlocal
