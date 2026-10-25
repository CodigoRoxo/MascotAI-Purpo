// Hoje só tem Ollama. Claude/OpenAI/Gemini entram aqui com a mesma interface.
const ollama = require('./ollama');

function createProvider(cfg) {
  switch (cfg.provider) {
    case 'ollama':
      return ollama.create(cfg.ollama);
    default:
      throw new Error(`Provider desconhecido: ${cfg.provider}`);
  }
}

async function listModels(cfg) {
  switch (cfg.provider) {
    case 'ollama':
      return ollama.listModels(cfg.ollama.host);
    default:
      return [];
  }
}

module.exports = { createProvider, listModels };
