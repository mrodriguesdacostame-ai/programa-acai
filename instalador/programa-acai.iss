; -----------------------------------------------------------------------------
;  INSTALADOR PROFISSIONAL — Programa Açaí  (Inno Setup 6)
;  Gera um Setup.exe que instala o sistema numa maquina Windows:
;   - confere se o Node.js esta instalado (instala via winget ou orienta)
;   - copia o codigo (sem banco/segredos/node_modules)
;   - instala as dependencias (npm install)
;   - cria .env a partir do modelo
;   - cria atalhos na Area de Trabalho e no Menu Iniciar
;       (Abrir / Atualizar / Conectar ao GitHub)
;   - abre o sistema no fim
;  O banco (acai.db) e criado VAZIO no primeiro uso (o proprio ERP cria).
;  NAO altera nenhuma regra de negocio do ERP.
; -----------------------------------------------------------------------------

#define AppNome "Programa Acai"
#define AppVersao "1.0.0"
#define AppPublisher "Acai do Centro"
#define AppExeLauncher "iniciar.bat"

[Setup]
AppId={{8F3A2C10-ACA1-4E77-9B21-1A2B3C4D5E6F}
AppName={#AppNome}
AppVersion={#AppVersao}
AppPublisher={#AppPublisher}
; instala numa pasta do usuario (gravavel, sem exigir Administrador) — o ERP
; grava o acai.db na propria pasta, entao NAO pode ser Arquivos de Programas.
PrivilegesRequired=lowest
DefaultDirName={autopf}\ProgramaAcai
DefaultGroupName={#AppNome}
DisableProgramGroupPage=yes
OutputDir=..\dist-instalador
OutputBaseFilename=ProgramaAcai-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#AppNome}

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Area de Trabalho"; GroupDescription: "Atalhos:"

[Files]
; copia o projeto INTEIRO, exceto o que nao deve ir (dados/segredos/pesados/o proprio instalador)
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; \
  Excludes: "node_modules\*,\.git\*,\.git,backups\*,logs\*,\.wwebjs_auth\*,\.wwebjs_cache\*,\.claude\*,instalador\*,dist-instalador\*,acai.db,acai.db-wal,acai.db-shm,acai.db-journal,.env,*.log"
; cria o .env a partir do modelo, so se ainda nao existir
Source: "..\.env.exemplo"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdoesntexist

[Icons]
Name: "{group}\Programa Acai";            Filename: "{app}\{#AppExeLauncher}"; WorkingDir: "{app}"; Comment: "Abrir o Programa Acai"
Name: "{group}\Atualizar Programa Acai";  Filename: "{app}\ATUALIZAR.bat";     WorkingDir: "{app}"; Comment: "Baixar a versao nova (GitHub)"
Name: "{group}\Conectar ao GitHub";       Filename: "{app}\CONECTAR_GITHUB.bat"; WorkingDir: "{app}"; Comment: "Ligar esta maquina ao repositorio (uma vez)"
Name: "{group}\Desinstalar Programa Acai"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Programa Acai";      Filename: "{app}\{#AppExeLauncher}"; WorkingDir: "{app}"; Tasks: desktopicon; Comment: "Abrir o Programa Acai"

[Run]
; instala as dependencias (o Node ja foi verificado em PrepareToInstall)
Filename: "{cmd}"; Parameters: "/c npm install"; WorkingDir: "{app}"; \
  StatusMsg: "Instalando dependencias (pode demorar alguns minutos)..."; Flags: runhidden
; abre o sistema ao final
Filename: "{app}\{#AppExeLauncher}"; Description: "Abrir o Programa Acai agora"; \
  WorkingDir: "{app}"; Flags: postinstall shellexec nowait skipifsilent

[Code]
// Roda "node -v" e devolve True se o Node.js estiver instalado/no PATH.
function NodeInstalado(): Boolean;
var Rc: Integer;
begin
  Result := Exec('cmd.exe', '/c node -v', '', SW_HIDE, ewWaitUntilTerminated, Rc) and (Rc = 0);
end;

// Antes de copiar os arquivos: garante o Node.js (instala via winget ou orienta).
// Devolver texto NAO vazio cancela a instalacao mostrando a mensagem.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Rc: Integer;
begin
  Result := '';
  if NodeInstalado() then exit;

  if MsgBox('O Node.js (necessario para o sistema) nao foi encontrado nesta maquina.'#13#10#13#10 +
            'Deseja instalar automaticamente agora? (usa o winget do Windows, precisa de internet e pode demorar alguns minutos)',
            mbConfirmation, MB_YESNO) = IDYES then
  begin
    Exec('cmd.exe', '/c winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
         '', SW_SHOW, ewWaitUntilTerminated, Rc);
    // O PATH so atualiza numa nova sessao — pedimos para rodar o instalador de novo.
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
