# 🌴 Programa Açaí

Sistema do Açaí do Centro: PDV, Delivery, Central de Atendimento e atendente por IA no WhatsApp.

> **Repositório PRIVADO.** Nunca torne público: o código tem a chave PIX e o telefone da loja.

## Rodar no PC

```bash
npm install
node server.js
```
Abre em http://localhost:3001

## Arquivos que NÃO estão aqui (ficam só no PC, por segurança)

Estão no `.gitignore` de propósito — quem clonar precisa recriar:

| Arquivo | O que é | Como obter |
|---|---|---|
| `.env` | Chaves de API | Criar na mão (veja abaixo) |
| `acai.db` | Banco (clientes, pedidos, produtos) | É criado sozinho no 1º start; os dados reais ficam só no PC |
| `.wwebjs_auth/` | Sessão do WhatsApp | Reconecta lendo o QR Code na tela inicial |

### `.env` necessário

```
ANTHROPIC_API_KEY=coloque_sua_chave_aqui
WEBHOOK_SECRET=um_segredo_qualquer
# opcional: OPENAI_API_KEY=... (se quiser usar GPT no lugar do Claude)
# opcional: APP_SENHA=... (trava por senha quando hospedado na internet)
```

## Editar pelo celular (na nuvem)

Na nuvem dá pra **editar o código** de qualquer lugar. Para o sistema **rodar de verdade**
(WhatsApp, banco, IA), continua no PC: traga as mudanças com `git pull` e reinicie o servidor.
