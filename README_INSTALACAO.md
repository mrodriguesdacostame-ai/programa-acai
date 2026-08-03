# 📦 Instalação — Programa Açaí

Guia prático para instalar e rodar o sistema em uma máquina nova (ou em outra loja).

## 1. Requisitos
- **Node.js 22 ou superior** (o sistema usa o SQLite embutido do Node — `node:sqlite` — que não existe em versões antigas). Confira com `node -v`.
- **Google Chrome** (ou Microsoft Edge) instalado — usado pelo WhatsApp. O sistema procura o Chrome/Edge automaticamente no Windows.
- Windows, Linux ou macOS. (O projeto foi desenvolvido no Windows.)

## 2. Instalar dependências
Na pasta do projeto:
```bash
npm install
```
Isso instala: `express`, `whatsapp-web.js`, `@anthropic-ai/sdk`, `openai`, `qrcode`, `qrcode-terminal`, `dotenv`.

## 3. Configurar o `.env`
Crie um arquivo **`.env`** na raiz do projeto. Todas as chaves são **opcionais** (o sistema roda sem elas, mas com recursos reduzidos):

```env
# IA do Atendimento — pelo menos uma das duas pra a IA responder sozinha
ANTHROPIC_API_KEY=sk-ant-...        # provider principal atual (Claude)
OPENAI_API_KEY=sk-...               # opcional (GPT); se presente, é o primeiro provider

# Proteção do webhook externo da IA (se for expor na internet)
WEBHOOK_SECRET=uma-frase-secreta

# Usuário admin inicial (só na PRIMEIRA execução, se ainda não houver usuários)
ADMIN_USER=admin
ADMIN_SENHA=troque-esta-senha

# Trava geral por senha (HTTP Basic) — use só se hospedar na internet
# APP_SENHA=senha-geral
# APP_USER=admin
```
> Sem `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, o Atendimento funciona no modo **manual** (humano responde); só a resposta automática por IA fica desligada.

## 4. Iniciar o sistema
```bash
npm start          # ou: node server.js
```
Vai aparecer `✅ PROGRAMA AÇAÍ rodando em http://localhost:3001`. Abra **http://localhost:3001** no navegador. Backend e frontend são o **mesmo processo** (o Express serve a interface da pasta `public/`).

## 5. Banco de dados
- O banco é o arquivo **`acai.db`** na raiz — criado sozinho no primeiro start (todas as tabelas são criadas automaticamente).
- **Nada a instalar**: o SQLite é embutido no Node.
- Para **começar do zero**, basta não ter o `acai.db` (ele é recriado vazio). Para **migrar de outra máquina**, veja o `README_BACKUP.md`.

## 6. Criar o usuário inicial
Na primeira execução, se não houver nenhum usuário, o sistema cria **`admin` / `admin`** (ou o que estiver em `ADMIN_USER`/`ADMIN_SENHA`). **Troque a senha** logo no primeiro acesso: Administração → Usuários → 🔑.

## 7. Conectar o WhatsApp
1. Abra o sistema logado e vá em **Clientes** ou **Conectividade** — aparece o **QR Code**.
2. No celular da loja: WhatsApp → **Aparelhos conectados → Conectar um aparelho** → escaneie.
3. A sessão fica salva em `.wwebjs_auth/` — não pede QR de novo nos próximos starts.
> Se o WhatsApp travar, feche as janelas órfãs do Chrome de automação e reinicie o sistema (ver `README_BACKUP.md` → manutenção).

## 8. Configurar os dados da loja
Logado como admin: **Administração → 🏪 Dados da Loja** — preencha nome, telefone, endereço, bairro, horário, taxa de entrega e mensagem de atendimento. Isso é usado em vários lugares (título, atendimento).

## 9. Restaurar um backup (opcional)
Para trazer os dados de outra instalação, veja o **`README_BACKUP.md`** (basicamente: parar o sistema, substituir o `acai.db` pelo backup, reiniciar).

---
Pronto: siga o **`CHECKLIST_IMPLANTACAO.md`** para validar tudo de ponta a ponta.
