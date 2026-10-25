// Corta as mensagens mais antigas (em pares) quando a conversa não cabe mais no contexto.

// ~3,5 caracteres por token em português, é só uma estimativa
const estimateTokens = (text) => Math.ceil(text.length / 3.5);

const REPLY_RESERVE = 1024;

function trimHistory(history, { numCtx, systemTokens }) {
  const budget = numCtx - systemTokens - REPLY_RESERVE;
  const kept = [...history];
  const size = () => kept.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);

  while (kept.length > 1 && size() > budget) {
    kept.splice(0, kept[0].role === 'user' && kept[1]?.role === 'assistant' ? 2 : 1);
  }
  return kept;
}

module.exports = { trimHistory, estimateTokens };
