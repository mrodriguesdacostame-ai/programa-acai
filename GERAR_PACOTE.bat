@echo off
title Programa Acai - Gerar pacote para o pendrive
color 5F
cls
cd /d "%~dp0"
echo.
echo  ================================================
echo    GERAR PACOTE DE INSTALACAO / ATUALIZACAO
echo  ================================================
echo.
echo   Rode isto DEPOIS de programar, pra empacotar o codigo
echo   ATUAL. Vai gerar (sem banco, sem .env, sem node_modules):
set DEST=%USERPROFILE%\Desktop\ACAI-INSTALADOR
echo       %DEST%
echo.
echo   Depois e so copiar essa pasta pro pendrive.
echo.
pause
echo.
echo  Gerando pacote...
if exist "%DEST%" rmdir /S /Q "%DEST%"
robocopy "%~dp0." "%DEST%" /E /XD node_modules .git backups .wwebjs_auth .wwebjs_cache logs .claude instalador dist-instalador assets /XF acai.db acai.db-wal acai.db-shm acai.db-journal .env *.log GERAR_INSTALADOR.bat GERAR_PACOTE.bat SUBIR_GITHUB.bat versionar.bat PUBLICAR_VERSAO.bat INSTALADOR_PROFISSIONAL.md VERSIONAR_ONLINE.md >nul
echo.
echo  ================================================
echo    [OK] Pacote gerado em:
echo    %DEST%
echo  ================================================
echo.
echo   Na outra maquina:
echo     - Instalar do zero:  INSTALAR.bat   depois  iniciar.bat
echo     - So atualizar:      ATUALIZAR.bat  (ja instalada)
echo.
pause
