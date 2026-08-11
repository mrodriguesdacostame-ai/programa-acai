@echo off
cd /d "%~dp0"
title Acai do Centro - CORRIGIR (limpar cache e reabrir)
color 2F
cls
echo.
echo  ==================================================
echo    CORRIGIR: limpar o cache do Chrome e reabrir
echo    (resolve o "atualizei e continua a tela velha")
echo  ==================================================
echo.
echo  Fechando o programa e o Chrome...
taskkill /F /IM node.exe   >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM msedge.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo  Apagando o cache do aplicativo...
REM cache do perfil isolado do app (versao nova)
rmdir /s /q "%LocalAppData%\AcaiDoCentro\navegador\Default\Cache"      >nul 2>&1
rmdir /s /q "%LocalAppData%\AcaiDoCentro\navegador\Default\Code Cache" >nul 2>&1
rmdir /s /q "%LocalAppData%\AcaiDoCentro\navegador\Default\GPUCache"   >nul 2>&1
rmdir /s /q "%LocalAppData%\AcaiDoCentro\navegador\GrShaderCache"      >nul 2>&1
REM cache do Chrome NORMAL (onde a tela velha ficou presa)
rmdir /s /q "%LocalAppData%\Google\Chrome\User Data\Default\Cache"      >nul 2>&1
rmdir /s /q "%LocalAppData%\Google\Chrome\User Data\Default\Code Cache" >nul 2>&1
rmdir /s /q "%LocalAppData%\Google\Chrome\User Data\Default\GPUCache"   >nul 2>&1

echo  Reabrindo o Acai do Centro do zero...
echo.
call "%~dp0iniciar.bat"
