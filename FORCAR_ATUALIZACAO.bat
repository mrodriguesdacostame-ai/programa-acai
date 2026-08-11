@echo off
REM Forca a atualizacao pro codigo mais novo do GitHub (fetch + reset --hard) e reabre LIMPO.
REM Use quando o "Atualizar agora" do sistema nao troca a tela (maquina presa em versao antiga).
REM Preserva os dados: acai.db / .env / backups sao gitignored (git nao toca neles).
cd /d "%~dp0"
title Forcar atualizacao - Acai do Centro
color 1F
cls
echo.
echo  ==================================================
echo    FORCAR ATUALIZACAO (alinhar 100%% com o GitHub)
echo  ==================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo  [X] O Git nao esta instalado nesta maquina.
  echo      Instale o Git e rode este arquivo de novo.
  pause
  exit /b 1
)

echo  Encerrando o servidor e o Chrome...
taskkill /F /IM node.exe   >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM msedge.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo  Baixando a versao mais nova do GitHub...
git fetch origin main
if errorlevel 1 goto :erro
git reset --hard origin/main
if errorlevel 1 goto :erro

echo  Limpando o cache do navegador (pra nao mostrar tela velha)...
rmdir /s /q "%LocalAppData%\AcaiDoCentro\navegador\Default\Cache"       >nul 2>&1
rmdir /s /q "%LocalAppData%\AcaiDoCentro\navegador\Default\Code Cache"  >nul 2>&1
rmdir /s /q "%LocalAppData%\Google\Chrome\User Data\Default\Cache"      >nul 2>&1
rmdir /s /q "%LocalAppData%\Google\Chrome\User Data\Default\Code Cache" >nul 2>&1

echo  Atualizando dependencias (se preciso)...
call npm install

echo.
echo  ==================================================
echo   [OK] ATUALIZADO para a versao mais recente.
echo   Reabrindo o Acai do Centro do zero...
echo  ==================================================
timeout /t 2 /nobreak >nul
start "" "%~dp0iniciar.bat"
goto :fim

:erro
echo.
echo  [X] Falha ao acessar o GitHub. Confira a internet e o login do GitHub
echo      (a 1a vez pode abrir uma janela pedindo login). Tente de novo.
pause

:fim
