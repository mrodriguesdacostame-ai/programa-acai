@echo off
REM ============================================================================
REM  ATUALIZADOR ONLINE SEM GIT - Acai do Centro
REM  Baixa o codigo novo do GitHub (ZIP do repositorio PUBLICO), extrai e troca
REM  SO o codigo, preservando os DADOS (acai.db/.env/backups/node_modules/
REM  .wwebjs_auth). Nao precisa de Git instalado. Em falha, reabre a versao atual.
REM  Chamado pelo servidor (botao "Atualizar agora") quando o Git nao esta disponivel.
REM ============================================================================
setlocal enableextensions
cd /d "%~dp0"
if not exist logs mkdir logs
set "RESULT=logs\ultima-atualizacao.txt"
set "ZIP=%TEMP%\acai-online.zip"
set "EXT=%TEMP%\acai-online-ext"
set "URLZIP=https://github.com/mrodriguesdacostame-ai/programa-acai/archive/refs/heads/main.zip"

REM da tempo do ERP mostrar "atualizando" e libera os arquivos
timeout /t 2 /nobreak >nul
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo  Baixando a versao nova do GitHub...
del "%ZIP%" >nul 2>&1
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { Invoke-WebRequest -Uri '%URLZIP%' -OutFile \"$env:TEMP\acai-online.zip\" -UseBasicParsing; exit 0 } catch { exit 1 }" > "logs\atualizador-online.log" 2>&1
if errorlevel 1 goto :err_download

echo  Extraindo o pacote...
rmdir /s /q "%EXT%" >nul 2>&1
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; try { Expand-Archive -Path \"$env:TEMP\acai-online.zip\" -DestinationPath \"$env:TEMP\acai-online-ext\" -Force; exit 0 } catch { exit 1 }" >> "logs\atualizador-online.log" 2>&1
if errorlevel 1 goto :err_extrai

REM a pasta extraida vem como "programa-acai-main"
set "NOVO=%EXT%\programa-acai-main"
if not exist "%NOVO%\server.js" goto :err_conteudo
if not exist "%NOVO%\package.json" goto :err_conteudo

echo  Aplicando o codigo novo (seus dados NAO sao tocados)...
robocopy "%NOVO%" "%~dp0." /E /XF acai.db acai.db-wal acai.db-shm acai.db-journal .env *.log /XD node_modules .git backups .wwebjs_auth .wwebjs_cache logs instalador dist-instalador assets >> "logs\atualizador-online.log" 2>&1

echo  Atualizando dependencias...
call npm install >> "logs\atualizador-online.log" 2>&1

> "%RESULT%" echo OK^|%date% %time%^|atualizado online (sem git)
goto :reabrir

:err_download
> "%RESULT%" echo ERRO^|%date% %time%^|falha ao baixar do GitHub - veja logs\atualizador-online.log
goto :reabrir
:err_extrai
> "%RESULT%" echo ERRO^|%date% %time%^|falha ao extrair o pacote
goto :reabrir
:err_conteudo
> "%RESULT%" echo ERRO^|%date% %time%^|pacote invalido (sem server.js)
goto :reabrir

:reabrir
del "%ZIP%" >nul 2>&1
rmdir /s /q "%EXT%" >nul 2>&1
start "" "%~dp0iniciar.bat"
endlocal
