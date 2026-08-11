@echo off
cd /d "%~dp0"
title Tornar o usuario admin em ADMIN - Acai do Centro
color 0B
cls
echo ==================================================
echo    DAR PERFIL ADMIN AO USUARIO "admin"
echo    (pra aparecer o botao Configuracao do Programa)
echo ==================================================
echo.
node virar_admin.js
echo.
echo ==================================================
echo  Agora feche o programa e abra de novo pelo icone.
echo ==================================================
echo.
pause
