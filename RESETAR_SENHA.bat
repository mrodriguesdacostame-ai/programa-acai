@echo off
cd /d "%~dp0"
title Resetar senha do admin - Acai do Centro
color 0E
cls
echo ==================================================
echo    RESETAR A SENHA DO ADMINISTRADOR
echo ==================================================
echo.
echo  Vou redefinir a senha do usuario  admin  para  1234
echo  (seus dados/vendas nao sao tocados).
echo.
node resetar_senha.js admin 1234
echo.
echo ==================================================
echo  Agora feche o programa e abra de novo. Entre com:
echo.
echo       Usuario:  admin
echo       Senha:    1234
echo.
echo  Depois, troque a senha e as dos outros usuarios em
echo  Configuracao do Programa  ^>  Usuarios.
echo ==================================================
echo.
pause
