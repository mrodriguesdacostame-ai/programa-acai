@echo off
cd /d "%~dp0"
title Acai do Centro - Configurar TERMINAL
color 1F
cls
echo.
echo  ==================================================
echo    CONFIGURAR ESTA MAQUINA COMO TERMINAL
echo  ==================================================
echo.
echo   Um TERMINAL nao tem banco proprio: ele mostra a tela
echo   do servidor PRINCIPAL (todas as maquinas veem os
echo   MESMOS dados - vendas, clientes, estoque).
echo.
echo   Digite o endereco do servidor PRINCIPAL:
echo     - Mesma loja (rede local):
echo         http://IP-DO-PRINCIPAL:3001
echo         (ex.: http://192.168.18.232:3001)
echo     - Pela internet (tunel):
echo         a URL que o tunel gerou (ex.: https://xxxx.trycloudflare.com)
echo.
set "SRV="
set /p SRV=  Endereco do principal:
if "%SRV%"=="" (
  echo.
  echo  [X] Nada informado. Cancelado.
  pause
  exit /b 1
)
> servidor.txt echo %SRV%
echo.
echo  ==================================================
echo    [OK] Esta maquina agora e um TERMINAL de:
echo         %SRV%
echo  ==================================================
echo.
echo   Abra pelo atalho "Acai do Centro" que ela ja conecta
echo   no principal. Para VOLTAR a ser principal (com banco
echo   proprio), apague o arquivo  servidor.txt  desta pasta.
echo.
pause
