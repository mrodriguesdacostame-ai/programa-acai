; ─────────────────────────────────────────────────────────────────────────────
;  INSTALADOR PROFISSIONAL — Açaí do Centro  (Inno Setup 6)
;  Gera um Setup.exe que instala o sistema numa maquina Windows:
;   - confere o Node.js (instala via winget ou orienta) e o Git (para atualizacoes)
;   - copia SO o runtime (sem banco/segredos/node_modules/arquivos de desenvolvimento)
;   - instala as dependencias (npm install)
;   - cria .env a partir do modelo e a config de atualizacao (sem segredo)
;   - cria atalhos "Açaí do Centro" e "Desinstalar" (Area de Trabalho + Menu Iniciar)
;   - abre o sistema no fim
;  O banco (acai.db) e criado VAZIO no primeiro uso (o proprio ERP cria).
;  A atualizacao acontece DENTRO do ERP (Administracao -> Atualizacoes).
;  NAO altera nenhuma regra de negocio do ERP.
; ─────────────────────────────────────────────────────────────────────────────

#define AppNome "Açaí do Centro"
#define AppPasta "AcaiDoCentro"
; a versão pode vir do GERAR_INSTALADOR.bat (/DAppVersao=x.y.z, lida do package.json);
; se não vier, usa este padrão. Mantenha em dia com o package.json.
#ifndef AppVersao
  #define AppVersao "1.0.5"
#endif
#define AppPublisher "Açaí do Centro"

[Setup]
AppId={{8F3A2C10-ACA1-4E77-9B21-1A2B3C4D5E6F}
AppName={#AppNome}
AppVersion={#AppVersao}
AppPublisher={#AppPublisher}
; instala numa pasta do usuario (gravavel, sem exigir Administrador) — o ERP
; grava o acai.db na propria pasta, entao NAO pode ser Arquivos de Programas.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppPasta}
DefaultGroupName={#AppNome}
DisableProgramGroupPage=yes
OutputDir=..\dist-instalador
OutputBaseFilename=AcaiDoCentro-Setup
SetupIconFile=..\assets\icone-acai.ico
UninstallDisplayIcon={app}\icone-acai.ico
UninstallDisplayName={#AppNome}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"

[Files]
; copia o runtime, EXCLUINDO dados/segredos/pesados e os arquivos de desenvolvimento
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; \
  Excludes: "node_modules\*,\.git\*,\.git,backups\*,logs\*,\.wwebjs_auth\*,\.wwebjs_cache\*,\.claude\*,instalador\*,dist-instalador\*,assets\*,acai.db,acai.db-wal,acai.db-shm,acai.db-journal,acai-*.db,*.bak,*.tmp,.env,.env.local,.env.*.local,*.log,GERAR_INSTALADOR.bat,GERAR_PACOTE.bat,SUBIR_GITHUB.bat,versionar.bat,PUBLICAR_VERSAO.bat,INSTALADOR_PROFISSIONAL.md,VERSIONAR_ONLINE.md"
; cria o .env a partir do modelo, so se ainda nao existir (nunca sobrescreve o real)
Source: "..\.env.exemplo"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdoesntexist
; icone para os atalhos
Source: "..\assets\icone-acai.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppNome}";              Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\icone-acai.ico"; Comment: "Abrir o {#AppNome}"
Name: "{group}\Desinstalar {#AppNome}";  Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppNome}";        Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\icone-acai.ico"; Tasks: desktopicon; Comment: "Abrir o {#AppNome}"

[Run]
; instala as dependencias (Node ja verificado em PrepareToInstall; .puppeteerrc.cjs pula o Chrome)
Filename: "{cmd}"; Parameters: "/c npm install"; WorkingDir: "{app}"; \
  StatusMsg: "Instalando componentes (pode demorar alguns minutos)..."; Flags: runhidden
; abre o sistema ao final
Filename: "{app}\iniciar.bat"; Description: "Abrir o {#AppNome} agora"; \
  WorkingDir: "{app}"; Flags: postinstall shellexec nowait skipifsilent

[Code]
function TemComando(cmd: String): Boolean;
var Rc: Integer;
begin
  Result := Exec('cmd.exe', '/c ' + cmd, '', SW_HIDE, ewWaitUntilTerminated, Rc) and (Rc = 0);
end;

// Antes de copiar: Node.js e OBRIGATORIO (instala via winget ou orienta e cancela).
// O Git e recomendado (para as atualizacoes internas): instala em silencio se faltar,
// mas NAO cancela a instalacao se nao conseguir.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Rc: Integer;
begin
  Result := '';

  // --- Git (recomendado, nao bloqueia) ---
  if not TemComando('git --version') then
  begin
    Exec('cmd.exe', '/c winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements',
         '', SW_SHOW, ewWaitUntilTerminated, Rc);
  end;

  // --- Node.js (obrigatorio) ---
  if TemComando('node -v') then exit;

  if MsgBox('O Node.js (necessario para o sistema) nao foi encontrado nesta maquina.'#13#10#13#10 +
            'Deseja instalar automaticamente agora? (usa o winget do Windows, precisa de internet e pode demorar alguns minutos)',
            mbConfirmation, MB_YESNO) = IDYES then
  begin
    Exec('cmd.exe', '/c winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
         '', SW_SHOW, ewWaitUntilTerminated, Rc);
    Result := 'O Node.js foi instalado (ou o instalador dele abriu).'#13#10 +
              'Por favor, FECHE este instalador e execute-o NOVAMENTE para concluir.'#13#10 +
              'Se der erro, instale manualmente em https://nodejs.org e rode de novo.';
  end
  else
  begin
    Exec('cmd.exe', '/c start https://nodejs.org', '', SW_HIDE, ewWaitUntilTerminated, Rc);
    Result := 'Instalacao cancelada.'#13#10 +
              'Instale o Node.js 22 ou superior (abri o site https://nodejs.org) e rode este instalador novamente.';
  end;
end;
