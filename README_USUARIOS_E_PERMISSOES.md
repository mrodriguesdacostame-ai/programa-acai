# 🔐 Usuários e Permissões — Programa Açaí

O sistema tem **autenticação real**: usuários com senha (guardada com hash **scrypt+salt**, nunca em texto), sessão por **cookie HttpOnly** (12h) e **3 perfis**. Toda rota `/api/*` exige login (menos o login em si e o webhook da IA, que tem segredo próprio).

## Perfis
| Perfil | Para quem | Pode fazer |
|---|---|---|
| **operador** | caixa / atendente | usar PDV, Delivery, Atendimento, Clientes, Produtos; assumir atendimento; criar/repetir pedido; lançar venda e fiado |
| **supervisor** | responsável do turno | tudo do operador **+** cancelar venda, excluir pedido/produto/cliente/lançamento, ajustar estoque, liberar atendimento assumido por outro |
| **admin** | dono / gerente | tudo **+** Administração: usuários, dados da loja, exportar/importar, backup, logs, mídia do WhatsApp |

## Onde as permissões são aplicadas
A checagem **real é no backend** (não só na tela). Resumo:
- **admin**: `/api/usuarios*`, `/api/backup*`, `/api/manutencao*`, `/api/logs-acoes`, `/api/exportar*`, `/api/importar*`, salvar **Dados da Loja**.
- **supervisor**: excluir pedidos/produtos/clientes/lançamentos, cancelar venda, ajustar estoque, excluir conversa.
- **operador**: o resto (qualquer usuário logado).
Sem sessão → **401**. Sem permissão → **403** (e o acesso negado fica no log de segurança).

## Autorização do supervisor
Ações sensíveis feitas por um **operador** pedem a **senha do supervisor** na hora (modal). Ao validar, abre uma **janela de 5 minutos** naquela sessão em que o operador pode concluir a ação — sem precisar trocar de usuário.

## Gerenciar usuários (admin)
**Administração → 👥 Usuários**:
- **Criar** usuário (nome, login, senha, perfil);
- **Trocar o perfil** (select na hora);
- **Trocar a senha** (🔑 — a senha não aparece em lugar nenhum);
- **Ativar/Desativar** (desativar derruba as sessões do usuário na hora). Não há exclusão — desativar preserva a auditoria.

## Boas práticas
1. **Troque a senha do `admin`** no primeiro acesso.
2. Crie um usuário por pessoa (não compartilhe login) — os logs ficam rastreáveis.
3. Dê **operador** para o caixa, **supervisor** para o responsável do turno, **admin** só para quem administra.
4. Ao expor na internet, use HTTPS + cookie `Secure` + rate-limit no login (ver limitações na doc da fase 12/20).
