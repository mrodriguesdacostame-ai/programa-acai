@echo off
title Programa Acai - Atualizar para nova versao
color 5F
cls
cd /d "%~dp0"
echo.
echo  ================================================
echo    PROGRAMA ACAI - ATUALIZAR PARA A NOVA VERSAO
echo  ================================================
echo.
echo   Seus DADOS sao preservados (banco, .env, backups,
echo   node_modules). So o CODIGO do programa e trocado.
echo.

REM ===== MODO 1: repositorio online (git) =====
where git >nul 2>&1
if not errorlevel 1 (
  git rev-parse --is-inside-work-tree >nul 2>&1
  if not errorlevel 1 (
    git remote get-url origin >nul 2>&1
    if not errorlevel 1 (
      echo  Repositorio online detectado. Baixando a ultima versao...
      echo.
      git pull
      if errorlevel 1 (
        echo  [X] Falhou o git pull. Confira internet / login.
        pause
        exit /b 1
      )
      echo.
      echo  Conferindo dependencias...
      call npm install
      echo.
      echo  [OK] Atualizado pelo GitHub! Rode o  iniciar.bat
      echo.
      pause
      exit /b 0
    )
  )
)

REM ===== MODO 2: pendrive / pasta =====
echo  Esta maquina ainda nao esta ligada ao GitHub.
echo.
echo  DICA: para atualizar pela INTERNET (sem pendrive), rode uma vez
echo        o  CONECTAR_GITHUB.bat  e depois use este ATUALIZAR normalmente.
echo.
echo  Por agora, vou atualizar a partir de uma PASTA com a versao nova
echo  (ex.: o pendrive).
echo.
echo  Arraste aqui a pasta ACAI-INSTALADOR do pendrive e aperte ENTER
echo  (ou digite o caminho):
set "ORIGEM="
set /p ORIGEM=  Origem:
if not defined ORIGEM (
  echo  [X] Nada informado. Cancelado.
  pause
  exit /b 1
)
set ORIGEM=%ORIGEM:"=%
if not exist "%ORIGEM%\server.js" (
  echo  [X] Nao encontrei o server.js dentro de "%ORIGEM%".
  echo      Confira se e a pasta certa, a que tem o programa novo.
  pause
  exit /b 1
)

echo.
echo  Copiando a nova versao... (preservando seus dados)
robocopy "%ORIGEM%" "%~dp0." /E /XD node_modules backups .wwebjs_auth .wwebjs_cache logs .git .claude /XF acai.db acai.db-wal acai.db-shm acai.db-journal .env *.log ATUALIZAR.bat >nul
echo  [OK] Codigo atualizado.
echo.
echo  Conferindo dependencias (caso a nova versao precise)...
call npm install
echo.
echo  ================================================
echo    PRONTO! Rode o  iniciar.bat  para usar a versao nova.
echo  ================================================
echo.
pause
