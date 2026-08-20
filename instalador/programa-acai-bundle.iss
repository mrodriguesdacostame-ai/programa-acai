; ─────────────────────────────────────────────────────────────────────────────
;  INSTALADOR AUTOSSUFICIENTE — Açaí do Centro  (Inno Setup 6)
;  NAO precisa de Node.js instalado, NAO precisa de internet, NAO roda npm.
;  Tudo ja vem pronto na pasta ..\_bundle:
;    - codigo do ERP
;    - runtime\node.exe  (o Node embutido; node:sqlite ja vem dentro dele)
;    - node_modules      (dependencias de producao, SEM Electron)
;  O iniciar.bat usa runtime\node.exe automaticamente.
;  Instala numa pasta do usuario (sem exigir Administrador). Banco criado no 1o uso.
; ─────────────────────────────────────────────────────────────────────────────

#define AppNome "Açaí do Centro"
#define AppPasta "AcaiDoCentro"
#ifndef AppVersao
  #define AppVersao "1.0.77"
#endif
#define AppPublisher "Açaí do Centro"

[Setup]
AppId={{8F3A2C10-ACA1-4E77-9B21-1A2B3C4D5E6F}
AppName={#AppNome}
AppVersion={#AppVersao}
AppPublisher={#AppPublisher}
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
; TUDO pronto: codigo + node.exe embutido + node_modules. Sem npm, sem internet, sem Node do sistema.
Source: "..\_bundle\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; .env a partir do modelo, so se ainda nao existir (nunca sobrescreve o real)
Source: "..\_bundle\.env.exemplo"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdoesntexist
; icone na raiz pros atalhos / desinstalador
Source: "..\assets\icone-acai.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppNome}";              Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\icone-acai.ico"; Comment: "Abrir o {#AppNome}"
Name: "{group}\Desinstalar {#AppNome}";  Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppNome}";        Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\icone-acai.ico"; Tasks: desktopicon; Comment: "Abrir o {#AppNome}"

[Run]
; abre o sistema ao final — nada de npm/node pra instalar, ja vem tudo pronto
Filename: "{app}\iniciar.bat"; Description: "Abrir o {#AppNome} agora"; \
  WorkingDir: "{app}"; Flags: postinstall shellexec nowait skipifsilent
