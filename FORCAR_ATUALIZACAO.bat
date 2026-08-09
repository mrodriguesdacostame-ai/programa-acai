@echo off
REM Forca a atualizacao pro codigo mais novo do GitHub (fetch + reset --hard).
REM Use quando o "Atualizar agora" do sistema falhar (maquina presa em versao antiga).
REM Preserva os dados: acai.db / .env / backups sao gitignored (git nao toca neles).
cd /d "%~dp0"
title Forcar atualizacao - Acai do Centro
where git >/dev/null 2>&1 || (echo Git nao instalado nesta maquina. & pause & exit /b)
echo Encerrando o servidor...
taskkill /F /IM node.exe >/dev/null 2>&1
timeout /t 2 /nobreak >nul
echo Baixando a versao mais nova do GitHub...
git fetch origin main || goto :erro
git reset --hard origin/main || goto :erro
echo Atualizando dependencias (se preciso)...
call npm install
echo.
echo ====================================================
echo  ATUALIZADO para a versao mais recente com sucesso.
echo ====================================================
timeout /t 2 /nobreak >nul
start "" "%~dp0iniciar.bat"
goto :fim
:erro
echo.
echo !! Falha ao acessar o GitHub. Confira a internet e o login do GitHub e tente de novo.
pause
:fim
