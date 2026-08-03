# 💾 Backup, Logs e Manutenção — Programa Açaí

Como proteger e manter os dados. Tudo vive em **um único arquivo** (`acai.db`) — isso facilita muito o backup.

## Backup automático
- O sistema faz backup **automático todo dia às 03:00**, usando `VACUUM INTO` (cópia consistente do banco), salvando em **`backups/`** na raiz.
- Há uma **retenção** que mantém os backups recentes (1 por dia) e limpa os antigos.

## Backup manual (recomendado antes de grandes mudanças)
- Pela tela: **Administração → 💾 Backup → "Criar backup agora"**. Mostra o nome do arquivo gerado.
- Também há o **status**: último backup (data/tamanho), quantidade guardada e próxima execução.

## Backup "cópia simples" (pendrive/nuvem)
Como é um arquivo só, dá pra copiar manualmente:
1. **Pare o sistema** (ou faça um backup pela tela antes, pra garantir consistência).
2. Copie o arquivo **`acai.db`** (e a pasta **`backups/`**, se quiser o histórico) para o pendrive/nuvem.
> Copiar o `acai.db` com o sistema rodando geralmente funciona, mas o jeito seguro é usar o backup da tela (VACUUM) ou parar o sistema antes.

## Restaurar um backup
1. **Pare o sistema**.
2. Guarde o `acai.db` atual (renomeie para `acai.db.old`, por segurança).
3. Copie o arquivo de backup (`backups/acai-YYYY-MM-DD...db`) para a raiz com o nome **`acai.db`**.
4. **Inicie o sistema**. As tabelas novas (de versões mais recentes) são criadas/migradas automaticamente no start — nada é apagado.

## Exportação de dados (backup "legível")
Além do backup do banco, dá pra **exportar** os dados em **JSON ou CSV**: **Administração → 📤 Dados / Exportar**. Serve para auditoria, planilha ou migração. Também há **exportar TUDO** (um JSON com clientes/produtos/vendas/pedidos/compras/insumos).

## Importação assistida
Em **Administração → 📤 Dados** dá pra **importar clientes e produtos** de um JSON exportado. É **idempotente** (não duplica): clientes casam pelo **telefone**, produtos pelo **código**. Para restaurar TUDO, prefira restaurar o `acai.db` (acima).

## Logs
- **Logs de ação** (`logs_acoes`): login, exclusões, cancelamentos, ajustes, backups, produções, exportações, mudanças de config etc. Veja em **Administração → 🛡 Segurança / Logs** (com filtros por ação/módulo/período).
- **Log de erros** do processo: arquivo `logs/erro.log` (erros não tratados, falhas de integração). O servidor tem blindagem: um erro do WhatsApp/IA **não derruba** o PDV/Delivery/Atendimento.

## Limpeza de mídia do WhatsApp
As fotos/áudios do WhatsApp são guardados no banco e podem inchá-lo. Em **Administração → 🖼 Mídia WhatsApp**:
- veja o **status** (quantas mensagens têm mídia, tamanho aproximado);
- **limpe a mídia antiga** (ex.: mais de 30 dias) — remove **só os anexos**, **preservando o texto** das conversas. Pede confirmação digitando `LIMPAR`.

## Se o WhatsApp travar
1. Feche o sistema.
2. Encerre janelas órfãs do Chrome de automação (as que apontam para `.wwebjs_auth`) — **não** feche seu Chrome pessoal.
3. Reinicie o sistema. Se ainda assim não conectar, apague a pasta `.wwebjs_auth/` e escaneie o QR de novo (só reconecta a sessão; não perde dados).
