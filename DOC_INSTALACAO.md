# 📦 Instalação — Açaí do Centro

## Para o usuário final (outra máquina)

1. Copie o arquivo **`AcaiDoCentro-Setup.exe`** para a máquina (pendrive, e-mail, etc.).
2. Dê **duplo-clique** e siga o assistente (tudo em português).
3. O instalador cuida de tudo:
   - confere/instala o **Node.js** (se faltar) e o **Git** (para as atualizações);
   - copia o sistema (sem banco/segredos);
   - instala os componentes (dependências);
   - cria o **`.env`** e prepara o banco (nasce vazio no 1º uso);
   - cria os atalhos **“Açaí do Centro”** (Área de Trabalho + Menu Iniciar) e o **Desinstalador**;
   - **abre o sistema** ao final.
4. **Primeiro login:** usuário `admin`, senha `admin` → troque a senha em Administração → Usuários.

O operador vê só o atalho **Açaí do Centro** e o **Desinstalador**. A atualização é feita **dentro do
ERP** (Administração → Atualizações), sem CMD, sem npm e sem git manual.

## Para o desenvolvedor (gerar o Setup.exe)

1. Programe normalmente no PC de desenvolvimento.
2. Duplo-clique em **`GERAR_INSTALADOR.bat`** — instala o Inno Setup (via winget, se preciso) e compila.
3. O instalador aparece em **`dist-instalador\AcaiDoCentro-Setup.exe`**.

O ícone da árvore de açaí está em `assets\icone-acai.ico` (gerado do `.svg` com ImageMagick).

## Requisitos da máquina da loja
- **Windows 10 ou 11**
- **Node.js 22+** (o instalador instala/orienta)
- **Git** (o instalador instala; necessário para atualizar pela internet)
- **Google Chrome ou Edge** (para o WhatsApp)

## Onde o sistema é instalado
Numa pasta do usuário (`%LocalAppData%\Programs\AcaiDoCentro`), que é **gravável sem exigir
Administrador** — importante porque o banco (`acai.db`) fica na própria pasta do sistema.
