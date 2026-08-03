/* ═══════════════════════════════════════════════════════════════════════════
   IA — CONFIGURAÇÃO DO PROVIDER (Fase 2)
   Instancia os SDKs e centraliza as constantes da IA. Provider-agnóstica:
     • OpenAI (gpt-4o-mini)         = PRINCIPAL — usado quando há OPENAI_API_KEY.
     • Anthropic (claude-haiku-4-5) = FALLBACK  — usado só se NÃO houver OPENAI_API_KEY.
   Requer que o dotenv já tenha sido carregado pelo server.js (lê process.env).
   ═══════════════════════════════════════════════════════════════════════════ */
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const MODELO_OPENAI = 'gpt-4o-mini';
const MODELO_ANTHROPIC = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 500;        // 1ª chamada (resposta / tool)
const MAX_TOKENS_FINAL = 300;  // 2ª chamada (mensagem final após a tool)
// Fase 3: teto de idas-e-voltas de tool numa MESMA mensagem (ex.: consulta → consulta → criar_pedido → texto).
// Protege contra loop infinito de tool call. 4 é folgado pro fluxo atual.
const MAX_TOOL_LOOPS = 4;
// Janela pós-pedido: o atendimento fica "vivo" por esse tempo pro cliente ajustar algo antes de zerar.
// Configurável via JANELA_ALTERACAO_MIN no .env (padrão 5 min). Usada pela memória da IA E, no
// server.js, por alterarUltimoPedidoIA (por isso o server.js também importa esta config).
const JANELA_ALTERACAO_MS = Math.round((parseFloat(process.env.JANELA_ALTERACAO_MIN) || 5) * 60 * 1000);

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const iaAtiva = !!(openai || anthropic);

// Log de boot: mostra o provider PRINCIPAL e se há fallback — NUNCA imprime a chave.
function logBoot() {
  console.log(
    openai ? `🤖 IA pronta — provider PRINCIPAL: OpenAI (${MODELO_OPENAI})${anthropic ? ' · fallback: Anthropic disponível' : ' · sem fallback'}.`
    : anthropic ? `🤖 IA pronta — provider: Anthropic (${MODELO_ANTHROPIC}) [OpenAI não configurada — usando fallback].`
    : '⚠️ Nenhuma chave de IA (OPENAI_API_KEY ou ANTHROPIC_API_KEY) — atendimento por IA desligado até configurar.');
}

module.exports = {
  openai, anthropic, iaAtiva,
  MODELO_OPENAI, MODELO_ANTHROPIC, MAX_TOKENS, MAX_TOKENS_FINAL, MAX_TOOL_LOOPS, JANELA_ALTERACAO_MS,
  logBoot,
};
