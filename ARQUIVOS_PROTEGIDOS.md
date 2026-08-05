# 🔒 Arquivos protegidos (nunca tocados por atualização)

A atualização do sistema **só troca o código do programa**. Estes itens são **dados/segredos da
loja** e **nunca** são baixados, enviados, sobrescritos ou apagados por uma atualização — nem pelo
`git pull`, nem pelo instalador, nem pelo `PUBLICAR_VERSAO.bat`. Todos estão no `.gitignore`.

| Item | O que é | Onde fica |
|---|---|---|
| `acai.db` (+ `-wal`, `-shm`) | Banco de dados — clientes, vendas, estoque, usuários, config | pasta do sistema |
| `.env` | Chaves de IA e senhas locais | pasta do sistema |
| `backups/` | Backups automáticos do banco | pasta do sistema |
| `logs/` | Logs de erro e o resultado da última atualização | pasta do sistema |
| `.wwebjs_auth/`, `.wwebjs_cache/` | Sessão do WhatsApp | pasta do sistema |
| `node_modules/` | Dependências (reinstaladas por `npm install`) | pasta do sistema |

## Por que é seguro
O Git versiona **apenas os arquivos do programa** (server.js, backend/, public/, etc.). Como os itens
acima estão no `.gitignore`, o `git pull` e o `git reset` (rollback) **nunca** os alteram. Além disso:

- **Antes de cada atualização** o sistema cria um **backup** do banco (`backups/acai-AAAA-MM-DD-HH-MM.db`).
- Se a atualização falhar, o código volta sozinho para a versão anterior (**rollback**); os dados
  seguem intactos.
- O banco só é **criado** (vazio) quando **ainda não existe** — nunca recriado por cima do real.

> ⚠️ Nunca commite/publique o `.env` ou o `acai.db`. O `PUBLICAR_VERSAO.bat` aborta se detectar isso.
