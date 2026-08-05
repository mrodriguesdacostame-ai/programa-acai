# 🔄 Atualização — Açaí do Centro

## Como funciona (visão geral)
- O **código** do sistema mora no GitHub (repositório **privado**).
- Cada loja instalada recebe as novas versões pelo **botão interno** do ERP —
  **Administração → Atualizações** (só **Administrador**).
- A atualização **baixa só o código** e **preserva 100% dos dados** (ver `ARQUIVOS_PROTEGIDOS.md`).
- Antes de atualizar, o sistema faz **backup automático**. Se falhar, **volta sozinho** para a versão
  anterior (rollback).

## Autenticação (segura, sem senha no código)
O repositório é privado, então a máquina precisa se autenticar **uma vez**:
- Usamos o **Git Credential Manager** (vem no Git do Windows).
- Na **primeira** verificação/atualização, abre a janela do GitHub; o admin faz login **uma vez**.
- O Windows guarda a credencial no **Cofre de Credenciais**. Depois, atualiza sem pedir de novo.
- **Nenhum token/senha** fica no código, no instalador ou no repositório.

> Se preferir não usar login por navegador, dá para gerar um **token read-only** e guardá-lo no Cofre
> de Credenciais do Windows (nunca no projeto) — ver observação no fim.

## Ligar a máquina ao repositório (uma vez)
Se o status mostrar “não ligada ao repositório”, rode uma vez o **`CONECTAR_GITHUB.bat`** na pasta do
sistema (o instalador já deixa a URL configurada em `update.config.json`). Ele liga a pasta ao repo
**sem tocar nos dados**.

## Publicar uma nova versão (no PC de desenvolvimento)
1. Programe e teste.
2. Duplo-clique em **`PUBLICAR_VERSAO.bat`**:
   - pede o **número da versão** e uma **descrição curta**;
   - **confere** que nenhum arquivo sensível (`.env`, `acai.db`) entrou;
   - atualiza `package.json` + `CHANGELOG.md`;
   - **comita**, cria a **tag** `vX.Y.Z` e **envia** pro GitHub.
3. Pronto — as lojas veem a nova versão ao clicar **Verificar atualização**.

## Fluxo do botão “Atualizar Sistema”
1. **Verificar atualização** → busca no GitHub e mostra se há nova versão + resumo.
2. **Atualizar agora** → confirma, **bloqueia se houver caixa aberto/venda recente**, faz **backup**,
   e dispara o atualizador externo (`atualizador.bat`), que:
   encerra o servidor → `git pull` → `npm install` (só se mudou) → **reinicia** → grava o resultado.
   No boot, as **migrações** de banco (se houver) rodam sozinhas.
3. A tela mostra **“Atualizando…”** e recarrega sozinha ao terminar, exibindo **sucesso** ou
   **falha (versão anterior restaurada)**.

## Rollback
Se o download ou a instalação falhar, o atualizador faz `git reset --hard` para o commit anterior e
reinicia. O **banco nunca é tocado** (e há o backup). O histórico fica em Administração → Atualizações.

---

## ✅ Testes já executados (nesta entrega)
| Cenário | Resultado |
|---|---|
| Instalação limpa (Setup.exe) → atalho + ícone + banco criado (88 tabelas + admin) | ✅ OK |
| `npm install` sem baixar o Chromium do puppeteer (`.puppeteerrc.cjs`) | ✅ OK |
| Atualização com **banco populado** (fast-forward) → dados preservados | ✅ OK |
| **Rollback** ao falhar (divergência) → código não muda, dados preservados, status = ERRO | ✅ OK |
| Endpoints `/api/atualizacao/*` + gating (401 sem login, admin-only) | ✅ OK |

## 🔲 Testes a validar na máquina real (checklist)
- [ ] Atualização de uma versão antiga para a nova ponta a ponta, pelo botão do ERP.
- [ ] Primeira autenticação no GitHub (Git Credential Manager) numa máquina nova.
- [ ] Atualização **sem internet** / **queda de internet** durante o download → deve falhar com
      mensagem clara e manter a versão atual.
- [ ] Reinício automático do servidor e reabertura do ERP.
- [ ] Atalho da Área de Trabalho e funcionamento após reiniciar o Windows.
- [ ] Windows **10** e Windows **11**.
- [ ] Confirmar clientes/vendas/estoque/config **intactos** após atualizar.

## Observação — token read-only (alternativa ao login por navegador)
Gerar no GitHub um **fine-grained token** com acesso **somente leitura** a este repositório e guardá-lo
no **Cofre de Credenciais do Windows** (via `git credential approve` ou `cmdkey`). Assim a loja atualiza
sem abrir navegador. O token **nunca** deve ficar no projeto/instalador.
