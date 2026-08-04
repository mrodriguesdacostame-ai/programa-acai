# ☁️ Versionar o Programa Açaí online (GitHub)

Versionar online = guardar o **código** num servidor (GitHub), com histórico de todas as versões.
Serve de **backup do código**, deixa **instalar em outra máquina com um comando** (`git clone`) e
registra cada mudança. **Importante:** vão só os arquivos de código — o `.gitignore` já bloqueia
o `.env` (chaves), o `acai.db` (dados dos clientes), os backups e a sessão do WhatsApp. **Nada disso sobe.**

> ⚠️ Use um repositório **PRIVADO**. Este é o sistema da sua loja — não deixe público.

> 🚀 **Atalho:** depois de criar o repositório privado no site (passo 1), rode o **`SUBIR_GITHUB.bat`**
> e cole a URL — ele faz o `remote add` + `push` sozinho. Os passos manuais abaixo são a alternativa.

---

## 1. Uma vez só — criar a conta e o repositório

1. Crie uma conta em https://github.com (se ainda não tiver).
2. Clique em **New repository** (novo repositório).
   - **Nome:** `programa-acai`
   - **Visibilidade:** **Private** (privado) ✅
   - **NÃO** marque "Add a README" (o projeto já tem os arquivos).
   - Clique em **Create repository**.
3. O GitHub mostra a URL do repositório, algo como:
   `https://github.com/SEU-USUARIO/programa-acai.git`

## 2. Uma vez só — ligar este computador ao repositório

Abra o **Prompt de Comando** na pasta do projeto (`PROGRAMA ACAI`) e rode
(troque a URL pela sua):

```bash
git remote add origin https://github.com/SEU-USUARIO/programa-acai.git
git branch -M main
git push -u origin main
```

Na primeira vez o GitHub pede login (abre uma janela do navegador pra autorizar). Autorize.
Pronto — o código está online.

> Se der "remote origin already exists", troque a primeira linha por:
> `git remote set-url origin https://github.com/SEU-USUARIO/programa-acai.git`

## 3. No dia a dia — salvar uma nova versão online

Sempre que quiser guardar o estado atual, **duplo clique no `versionar.bat`**
(ele faz `add` + `commit` + `push` sozinho). Ou, pela mão:

```bash
git add -A
git commit -m "descrição da mudança"
git push
```

## 4. Instalar em OUTRA máquina a partir do online

Na máquina nova, com Node 22+ e Git instalados:

```bash
git clone https://github.com/SEU-USUARIO/programa-acai.git
cd programa-acai
```
Depois rode o **`INSTALAR.bat`** (cria o `.env`, instala dependências) e o **`iniciar.bat`**.
O banco nasce vazio; o primeiro login é `admin` / `admin`.

> Trazer atualizações depois: `git pull` na pasta do projeto.

---

### O que sobe e o que NÃO sobe

| Sobe (código) | NÃO sobe (protegido pelo .gitignore) |
|---|---|
| `server.js`, `public/`, `backend/`, `scripts/` | `.env` (chaves de IA/senhas) |
| `package.json`, READMEs, `.bat` | `acai.db` e `backups/` (dados dos clientes) |
| `.env.exemplo` (modelo sem segredo) | `node_modules/`, `logs/`, sessão do WhatsApp |
