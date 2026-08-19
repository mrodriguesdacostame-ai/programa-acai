@echo off
title Programa Acai - Instalacao (maquina nova)
color 5F
cls
echo.
echo  ============================================
echo    PROGRAMA ACAI - INSTALACAO EM MAQUINA NOVA
echo  ============================================
echo.
cd /d "%~dp0"

REM --- 1) Node.js instalado? ---
where node >nul 2>&1
if errorlevel 1 (
  echo  [X] Node.js NAO foi encontrado nesta maquina.
  echo.
  echo      Instale o Node.js 22 ou superior:
  echo         https://nodejs.org   ^(baixe a versao LTS^)
  echo.
  echo      Depois de instalar, rode este INSTALAR.bat de novo.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODEV=%%v
echo  [OK] Node.js encontrado: %NODEV%
echo       ^(o sistema precisa da versao 22 ou superior^)
echo.

REM --- 2) arquivo .env ---
if not exist ".env" (
  if exist ".env.exemplo" (
    copy ".env.exemplo" ".env" >nul
    echo  [OK] Criei o arquivo .env a partir do modelo.
    echo       Se quiser, abra o .env e ajuste a senha do admin
    echo       e as chaves de IA. Pode deixar como esta tambem.
  )
) else (
  echo  [OK] .env ja existe - mantido.
)
echo.

REM --- 3) dependencias ---
echo  Instalando as dependencias ^(npm install^)...
echo  Isso baixa o necessario e PODE DEMORAR alguns minutos. Aguarde.
echo.
call npm install --omit=dev
if errorlevel 1 (
  echo.
  echo  [X] Deu erro no npm install. Veja a mensagem acima.
  echo      Confira sua internet e rode o INSTALAR.bat de novo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo    INSTALACAO CONCLUIDA COM SUCESSO !
echo  ============================================
echo.
echo    Para USAR o sistema:  rode o  iniciar.bat
echo.
echo    Primeiro login:   usuario  admin    senha  admin
echo    ^(troque a senha depois de entrar^)
echo.
echo    O banco de dados sera criado VAZIO na primeira vez.
echo.
pause
