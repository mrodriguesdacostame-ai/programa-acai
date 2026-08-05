# 🏭 Instalador profissional + atualização (Programa Açaí)

Este projeto gera um **`Setup.exe`** de verdade (feito com **Inno Setup**) para instalar o
sistema em qualquer PC Windows, e um fluxo de **atualização pela internet** (GitHub) que
**não precisa de um novo Setup** depois da primeira instalação.

> Nenhuma regra de negócio do ERP foi alterada — isto é só empacotamento e atualização.

---

## 1. Gerar o instalador (você, no PC de desenvolvimento)

1. Programe normalmente.
2. Duplo-clique em **`GERAR_INSTALADOR.bat`**.
   - Se o **Inno Setup** não estiver instalado, ele tenta instalar sozinho (via winget).
     *(Se preferir, instale à mão — grátis — em https://jrsoftware.org/isdl.php.)*
   - Ele compila o script `instalador\programa-acai.iss`.
3. O instalador aparece em **`dist-instalador\ProgramaAcai-Setup.exe`**.

Leve esse `ProgramaAcai-Setup.exe` para a outra máquina (pendrive, e-mail, etc.).

## 2. Instalar na outra máquina (Setup.exe)

Basta **executar o `ProgramaAcai-Setup.exe`** e seguir o assistente. Ele:
- ✅ confere se o **Node.js** está instalado — se não estiver, instala (winget) ou orienta;
- ✅ copia o sistema (sem banco, sem `.env`, sem `node_modules`);
- ✅ cria o **`.env`** a partir do modelo;
- ✅ roda **`npm install`** (baixa as dependências);
- ✅ cria atalhos na **Área de Trabalho** e no **Menu Iniciar**
  (*Programa Açaí*, *Atualizar Programa Açaí*, *Conectar ao GitHub*);
- ✅ **abre o sistema** ao terminar.

**Primeiro login:** usuário `admin`, senha `admin` (troque depois). O **banco nasce vazio**
(o próprio ERP cria o `acai.db` no primeiro uso).

> A instalação vai para uma pasta do usuário (não exige "Administrador"), porque o sistema
> grava o banco na própria pasta.

## 3. Ligar a máquina ao GitHub (uma vez, para receber atualizações)

Para poder atualizar **pela internet** (baixando só as mudanças), rode **uma vez** na máquina
instalada o atalho **“Conectar ao GitHub”** (ou o `CONECTAR_GITHUB.bat`):
- cole a URL do seu repositório (a mesma do `SUBIR_GITHUB.bat`);
- ele liga a pasta ao repositório **sem apagar seus dados** (banco/`.env`/backups ficam).

*(Repositório privado pede login do GitHub uma vez — o Windows guarda depois.)*

## 4. Atualizar (o dia a dia)

- **No seu PC (dev):** programou algo? Rode **`versionar.bat`** (envia pro GitHub).
- **Na loja:** rode o atalho **“Atualizar Programa Açaí”** (ou `ATUALIZAR.bat`):
  - se a máquina está ligada ao GitHub → baixa só as mudanças (`git pull`) e mantém os dados;
  - se ainda não está ligada → ele explica como (passo 3) ou atualiza por pendrive.
- Depois, abra pelo atalho **“Programa Açaí”**.

**Nenhum novo Setup é necessário** para atualizar — só na primeira instalação.

---

## Resumo dos arquivos

| Arquivo | Onde | Para quê |
|---|---|---|
| `GERAR_INSTALADOR.bat` | dev | Gera o `ProgramaAcai-Setup.exe` |
| `instalador\programa-acai.iss` | dev | Script do instalador (Inno Setup) |
| `dist-instalador\ProgramaAcai-Setup.exe` | saída | O instalador para distribuir |
| `CONECTAR_GITHUB.bat` | loja | Liga a máquina ao GitHub (1 vez) |
| `ATUALIZAR.bat` | loja | Baixa a versão nova (mantém os dados) |
| `versionar.bat` | dev | Envia sua nova versão pro GitHub |
| `iniciar.bat` | ambos | Liga o sistema |

## Requisitos na máquina da loja
- **Node.js 22+** (o Setup instala/orienta) · **Git** (para atualizar pela internet) ·
  **Google Chrome/Edge** (para o WhatsApp).
