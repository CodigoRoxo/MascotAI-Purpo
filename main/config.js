const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // 'assistant' ou 'decor' (sem IA)
  mode: 'assistant',
  provider: 'ollama',
  ollama: {
    host: 'http://127.0.0.1:11434',
    model: 'llama3.2:3b',
    // quanto tempo o modelo fica na memória depois da última pergunta
    keepAlive: '30m',
    // contexto em tokens. A memória usada depende disso, não do tamanho da conversa
    numCtx: 4096,
  },
  // fatos do usuário (a identidade do mascote fica em identity.js)
  knowledge: '',
  // idioma das respostas, ver languages.js
  language: 'pt-BR',
  systemPrompt:
    'Você é o MascotAI, um assistente rápido que vive na área de trabalho do usuário. ' +
    'Responda de forma curta e direta, a menos que peçam detalhes.',
  // tamanho: pixels de tela por pixel da arte (a arte é 50x50)
  pixelScale: 3,
  // liga/desliga com 2 cliques no boneco
  followMouse: false,
  position: null,
  shortcut: 'Control+Alt+Space',
};

const OLD_DEFAULT_PROMPT =
  'Você é o MascotAI, um assistente rápido que vive na área de trabalho do usuário. ' +
  'Responda em português do Brasil, de forma curta e direta, a menos que peçam detalhes.';

const OLD_DEFAULT_KNOWLEDGE =
  '- Seu nome é MascotAI, um mascote de IA que roda localmente no computador do usuário.\n' +
  '- Você foi criado por Matheus Franco, do canal Código Roxo no YouTube.';

const file = () => path.join(app.getPath('userData'), 'config.json');

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    // migração de configs de versões antigas
    if (saved.systemPrompt === OLD_DEFAULT_PROMPT) delete saved.systemPrompt;
    if (saved.knowledge === OLD_DEFAULT_KNOWLEDGE) delete saved.knowledge;
    return { ...DEFAULTS, ...saved, ollama: { ...DEFAULTS.ollama, ...saved.ollama } };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(cfg) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error('Falha ao salvar config:', err);
  }
}

module.exports = { load, save, file };
