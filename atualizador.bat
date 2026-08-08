@echo off
REM -----------------------------------------------------------------------------
REM  ATUALIZADOR EXTERNO ? A?a? do Centro
REM  Roda FORA do node (o ERP dispara este .bat destacado). Passos:
REM   1) guarda o commit atual (ponto de rollback)
REM   2) encerra o servidor
REM   3) baixa a nova versao do GitHub (git pull, so codigo; dados sao gitignored)
REM   4) se package.json mudou, atualiza dependencias (npm install)
REM   5) reinicia o servidor e reabre o ERP
REM   6) grava o resultado em logs\ultima-atualizacao.txt
REM  Em qualquer falha: git reset --hard <rollback> (restaura a versao anterior).
REM  Os DADOS (acai.db/.env/backups/logs) nunca sao tocados (gitignored + git so
REM  mexe em arquivos versionados).
REM  Modo teste: definir ATUALIZADOR_TESTE=1 pula o taskkill e o restart.
REM -----------------------------------------------------------------------------
setlocal enableextensions
cd /d "%~dp0"
if not exist logs mkdir logs
set "RESULT=logs\ultima-atualizacao.txt"
set "STAMP=%date% %time%"

where git >nul 2>&1
if errorlevel 1 goto :sem_git

for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "ROLLBACK=%%h"
if "%ROLLBACK%"=="" goto :sem_repo

REM commit do package.json ANTES (pra saber se dependencias mudaram)
for /f "delims=" %%p in ('git rev-parse HEAD:package.json 2^>nul') do set "PKG_ANTES=%%p"

if defined ATUALIZADOR_TESTE goto :pull
REM da tempo do ERP mostrar "atualizando" e libera a porta/arquivos
timeout /t 3 /nobreak >nul
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:pull
REM descobre o ramo atual (main/master) e baixa via fetch + reset --hard
REM (mais robusto que "pull --ff-only": alinha ao GitHub mesmo com arvore suja).
set "BR=main"
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BR=%%b"
git fetch origin %BR% > "logs\atualizador-git.log" 2>&1
if errorlevel 1 goto :err_pull
git reset --hard origin/%BR% >> "logs\atualizador-git.log" 2>&1
if errorlevel 1 goto :err_pull

for /f "delims=" %%p in ('git rev-parse HEAD:package.json 2^>nul') do set "PKG_DEPOIS=%%p"
if "%PKG_ANTES%"=="%PKG_DEPOIS%" goto :ok
echo Atualizando dependencias...
call npm install >> "logs\atualizador-git.log" 2>&1
if errorlevel 1 goto :err_npm
goto :ok

:err_pull
git reset --hard %ROLLBACK% >nul 2>&1
call :grava ERRO "falha ao baixar do GitHub - veja logs\atualizador-git.log - versao anterior restaurada"
goto :restart

:err_npm
git reset --hard %ROLLBACK% >nul 2>&1
call :grava ERRO "falha nas dependencias - versao anterior restaurada"
goto :restart

:ok
set "NOVO=?"
for /f "delims=" %%h in ('git rev-parse --short HEAD 2^>nul') do set "NOVO=%%h"
call :grava OK "atualizado de %ROLLBACK:~0,7% para %NOVO%"
goto :restart

:sem_git
call :grava ERRO "Git nao instalado nesta maquina"
goto :fim

:sem_repo
call :grava ERRO "esta pasta nao esta ligada ao repositorio - use Conectar ao GitHub"
goto :fim

:restart
if defined ATUALIZADOR_TESTE goto :fim
start "" "%~dp0iniciar.bat"
goto :fim

:grava
> "%RESULT%" echo %~1^|%STAMP%^|%~2
exit /b

:fim
endlocal
