@echo off
REM -----------------------------------------------------------------------------
REM  PUBLICAR NOVA VERSAO — Açaí do Centro (roda no PC de desenvolvimento)
REM  Pergunta versao + descricao, confere que nao ha arquivo sensivel, atualiza
REM  package.json + CHANGELOG, comita, cria a tag e envia pro GitHub. As lojas
REM  recebem pelo botao "Atualizar Sistema" (Administracao -> Atualizacoes).
REM -----------------------------------------------------------------------------
setlocal enableextensions
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 goto :sem_git
where node >nul 2>&1
if errorlevel 1 goto :sem_node

for /f "delims=" %%v in ('node -e "process.stdout.write(require('./package.json').version)"') do set "ATUAL=%%v"
echo.
echo  ===========================================
echo    PUBLICAR NOVA VERSAO   (atual: %ATUAL%)
echo  ===========================================
echo.
set "NOVA="
set /p NOVA=  Numero da nova versao (ex.: 1.0.1):
if not defined NOVA goto :cancel
set "DESC="
set /p DESC=  Descricao curta da atualizacao:
if not defined DESC set "DESC=Atualizacao %NOVA%"

echo.
echo  Conferindo arquivos sensiveis...
git add -A
git diff --cached --name-only > "%TEMP%\_acai_staged.txt"
findstr /X /I ".env" "%TEMP%\_acai_staged.txt" >nul && goto :sensivel
findstr /I /R "acai\.db" "%TEMP%\_acai_staged.txt" >nul && goto :sensivel
del "%TEMP%\_acai_staged.txt" >nul 2>&1

echo  Atualizando package.json e CHANGELOG...
node -e "const fs=require('fs');const p=require('./package.json');p.version=process.argv[1];fs.writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n');const d=new Date().toISOString().slice(0,10);const linha='## '+process.argv[1]+' - '+d+'\n- '+process.argv[2]+'\n\n';let c='';try{c=fs.readFileSync('./CHANGELOG.md','utf8')}catch{c='# Histórico de versões\n\n'}const i=c.indexOf('\n\n')+2;fs.writeFileSync('./CHANGELOG.md',c.slice(0,i)+linha+c.slice(i));" "%NOVA%" "%DESC%"

git add -A
git commit -m "v%NOVA% - %DESC%"
if errorlevel 1 goto :err_commit
git tag "v%NOVA%"
echo.
echo  Enviando pro GitHub...
git push origin HEAD
if errorlevel 1 goto :err_push
git push origin "v%NOVA%"

echo.
echo  ===========================================
echo    [OK] Versao v%NOVA% publicada!
echo  ===========================================
echo   As lojas ja podem atualizar pelo botao
echo   "Atualizar Sistema" dentro do ERP.
echo.
pause
goto :fim

:sensivel
del "%TEMP%\_acai_staged.txt" >nul 2>&1
echo  [X] Um arquivo SENSIVEL (.env ou acai.db) entrou no commit.
echo      Publicacao ABORTADA. Confira o .gitignore.
pause
goto :fim
:err_commit
echo  [X] Nada para commitar ou erro no commit. Verifique.
pause
goto :fim
:err_push
echo  [X] Falha ao enviar pro GitHub. Confira internet/login.
pause
goto :fim
:sem_git
echo  [X] Git nao encontrado. Instale em https://git-scm.com
pause
goto :fim
:sem_node
echo  [X] Node.js nao encontrado. Instale em https://nodejs.org
pause
goto :fim
:cancel
echo  Cancelado.
pause
:fim
endlocal
