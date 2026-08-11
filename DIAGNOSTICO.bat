@echo off
cd /d "%~dp0"
title DIAGNOSTICO - Acai do Centro
color 0A
cls
echo ==================================================
echo    DIAGNOSTICO DO ACAI DO CENTRO
echo ==================================================
echo.
echo [1] Commit atual no disco:
git rev-parse --short HEAD 2>nul
echo.
echo [2] O index.html no disco TEM o botao de configuracao?
findstr /c:"btn-config-programa" public\index.html >nul 2>&1 && echo     SIM - arquivo novo (tem o botao) || echo     NAO - index.html AINDA VELHO
echo.
echo [3] Versao instalada:
node -p "require('./package.json').version" 2>nul
echo.
echo [4] Usuarios e seus perfis (o botao so aparece p/ perfil = admin):
node -e "new (require('node:sqlite').DatabaseSync)('acai.db').prepare('SELECT usuario,nome,perfil,ativo FROM usuarios').all().forEach(u=>console.log('     '+u.usuario+'  ->  perfil: '+u.perfil+'   (nome: '+u.nome+', ativo: '+u.ativo+')'))" 2>nul
echo.
echo ==================================================
echo  Tire um PRINT desta tela e mande.
echo ==================================================
echo.
pause
