# 🛒 Operação — Programa Açaí

Como usar o sistema no dia a dia. Cada módulo é acessível pela **Home** (atalhos) ou pelo menu do topo.

## Login
Abra `http://localhost:3001`, entre com seu usuário e senha. Há 3 perfis: **operador**, **supervisor** e **admin** (ver `README_USUARIOS_E_PERMISSOES.md`).

## 🏠 Home / Dashboard
A tela inicial é um **painel do dia**: faturamento, vendas, ticket médio, pedidos, formas de pagamento, situação do delivery/atendimento, alertas de estoque, financeiro rápido e top produtos. Atualiza sozinha (tempo real no que dá) e tem botão **🔄 Atualizar**. Embaixo ficam os **atalhos** para os módulos.

## 🛒 PDV (Vendas)
Balcão. Digite o **código** do produto e **Enter** para adicionar (use `3*codigo` para quantidade). Feche a venda no **Recebimento**: escolha as formas de pagamento (PIX, Dinheiro, Cartão, Fiado…), informe o valor e confirme. A **última venda** fica visível e pode ser **cancelada** (devolve ao estoque; exige supervisor). Vendas no fiado lançam automaticamente na conta do cliente.

## 🛵 Delivery
Quadro de pedidos por **status**: Pendente → Em preparo → Em rota → Entregue. Crie pedidos manualmente ou receba pela IA/Atendimento. Arraste/clique para mudar o status. Cada pedido novo pode ser copiado por WhatsApp para números configurados (cozinha, entregador).

## 💬 Atendimento
Central do WhatsApp em **3 colunas**: conversas · chat · contexto do cliente. Em tempo real (SSE). Por conversa você pode:
- **Assumir** o atendimento (a IA para de responder essa conversa) e **Devolver pra IA**;
- ligar/desligar a **IA desta conversa**;
- ver **contexto**: cliente, fiado, último pedido e histórico (cliente unificado);
- **criar pedido**, **repetir último pedido**, **mudar status** do pedido em aberto e escrever **anotações internas**.
O indicador na lista mostra se a conversa está com IA, manual (e quem assumiu) ou IA desligada.

## 👥 Clientes / Fiado
Cadastro de clientes e **caderneta (fiado)**. Lance **compras** (aumenta a dívida) e **pagamentos** (abate). O **saldo** é sempre a soma do extrato (nunca é digitado). Avisos de saldo podem ser enviados por WhatsApp. O cliente é **unificado por telefone** — o mesmo cadastro aparece no PDV, no Delivery e no Atendimento.

## 📦 Produtos / Estoque
Abas:
- **Mercadorias**: cadastro e **entrada de mercadoria** (com nota fiscal, custo, caixas). Botão **🫐 Processar em vários produtos (rendimento)** para produção.
- **Insumos**: descartáveis (copos, sacolas…) com **unidade**, quantidade e custo.
- **Histórico**: faturamento, gastos e saldo por período.
- **Notas Fiscais**: entradas agrupadas por número da nota.
- **💲 Custos & Produção**: produções recentes + **custo e margem por produto**.

## 🫐 Compras / Insumos / Rendimento (retaguarda)
- **Compra**: registra o gasto; pode ter **itens** (produto/insumo) — item de produto atualiza o custo e pode dar entrada no estoque.
- **Insumo**: entra com saldo e custo; dá pra registrar **consumo/ajuste** (histórico de movimentos).
- **Rendimento/Produção**: informe a **matéria-prima** (ex.: 1 saca de açaí, R$ 250) e os **produtos gerados** (código, quantidade, preço). O sistema **calcula o custo por produto**, **aumenta o estoque** do produto final e registra o gasto. Tudo fica no histórico de produções.

## ⚙️ Administração (só admin)
- **Usuários**: criar, trocar perfil/senha, ativar/desativar.
- **🏪 Dados da Loja**: identidade e parâmetros da loja.
- **📤 Dados / Exportar**: status da instalação, **exportar** (JSON/CSV) e **importar** clientes/produtos.
- **Segurança / Logs**: auditoria de ações.
- **Backup**: criar/baixar backups.
- **Mídia WhatsApp**: limpar anexos antigos (preserva o texto).

---
Dicas: **duplo-espaço** em campos de busca abre a busca por nome; muitas listas navegam por **seta/Enter**; interruptores seguem o padrão **verde = ligado / vermelho = desligado**.
