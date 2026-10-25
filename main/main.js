const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, dialog } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');

const config = require('./config');
const { createProvider, listModels } = require('./providers');
const ollama = require('./providers/ollama');
const ollamaProcess = require('./ollamaProcess');
const { languageRule, languageList } = require('./languages');
const { IDENTITY } = require('./identity');
const { trimHistory, estimateTokens } = require('./history');

const WIN_W = 380;
const WIN_H = 480;
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'assets', 'sprites', 'frames', 'face_eyes.png');

const HONESTY_RULE =
  'Regras de honestidade:\n' +
  '- Sobre você, seu criador e o usuário, use SOMENTE os fatos acima. Não acrescente nada.\n' +
  '- Se não tiver certeza de algo, diga claramente que não sabe. Não chute.\n' +
  '- Nunca invente nomes, pessoas, canais, links, e-mails, datas ou números.';

let win;
let settingsWin;
let tray;
let cfg;
let history = [];
let currentAbort = null;
let drag = null;
let followTimer = null;
let lastCursor = null;
let startingOllama = null;
const pulls = new Map();

if (!app.requestSingleInstanceLock()) app.quit();

function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - WIN_W - 16, y: workArea.y + workArea.height - WIN_H };
}

function createWindow() {
  const pos = cfg.position ?? defaultPosition();

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });

  // 'screen-saver' fica acima até de janela em tela cheia
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(ROOT, 'src', 'index.html'));
}

function openSettings(tab) {
  // no Windows a janela nova abre atrás das outras se não fizer isso
  const bringToFront = () => {
    settingsWin.show();
    settingsWin.setAlwaysOnTop(true);
    settingsWin.focus();
    settingsWin.setAlwaysOnTop(false);
  };
  if (settingsWin && !settingsWin.isDestroyed()) return bringToFront();

  settingsWin = new BrowserWindow({
    width: 720,
    height: 460,
    show: false,
    frame: false,
    title: 'MascotAI — Configurações',
    icon: ICON,
    backgroundColor: '#141414',
    resizable: false,
    maximizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  settingsWin.once('ready-to-show', bringToFront);
  settingsWin.loadFile(path.join(ROOT, 'src', 'settings.html'), { hash: typeof tab === 'string' ? tab : '' });
}

function publicConfig() {
  return {
    mode: cfg.mode,
    pixelScale: cfg.pixelScale,
    model: cfg.ollama.model,
    host: cfg.ollama.host,
    systemPrompt: cfg.systemPrompt,
    shortcut: cfg.shortcut,
    language: cfg.language,
    languages: languageList(),
    followMouse: cfg.followMouse,
    knowledge: cfg.knowledge,
    identity: IDENTITY.slice(0, 2),
  };
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  if (cfg.mode !== 'assistant') return;
  try {
    globalShortcut.register(cfg.shortcut, () => {
      if (!win.isVisible()) win.show();
      win.focus();
      win.webContents.send('prompt:open');
    });
  } catch (err) {
    console.error('Atalho inválido:', cfg.shortcut, err.message);
  }
}

function applyConfig(patch) {
  const before = { ...cfg, ollama: { ...cfg.ollama } };

  if (patch.mode) cfg.mode = patch.mode;
  if (patch.pixelScale) cfg.pixelScale = patch.pixelScale;
  if (patch.model) cfg.ollama.model = patch.model;
  if (patch.host) cfg.ollama.host = patch.host.replace(/\/+$/, '');
  if (typeof patch.systemPrompt === 'string') cfg.systemPrompt = patch.systemPrompt;
  if (typeof patch.knowledge === 'string') cfg.knowledge = patch.knowledge;
  if (patch.shortcut) cfg.shortcut = patch.shortcut;
  if (patch.language) cfg.language = patch.language;
  config.save(cfg);

  // a conversa antiga atrapalha depois dessas mudanças (idioma errado, fatos velhos...)
  const resetChat =
    before.ollama.model !== cfg.ollama.model ||
    before.ollama.host !== cfg.ollama.host ||
    before.language !== cfg.language ||
    before.knowledge !== cfg.knowledge ||
    cfg.mode !== 'assistant';
  if (resetChat) {
    currentAbort?.abort();
    history = [];
  }

  registerShortcut();
  if (before.ollama.model !== cfg.ollama.model || (before.mode !== 'assistant' && cfg.mode === 'assistant')) warmup();
  win.webContents.send('config:changed', publicConfig());
  return publicConfig();
}

function warmup() {
  if (cfg.mode !== 'assistant') return;
  createProvider(cfg).warmup?.().catch(() => {});
}

function buildSystemPrompt() {
  const facts = [...IDENTITY.map((f) => `- ${f}`), cfg.knowledge?.trim()].filter(Boolean).join('\n');
  return [cfg.systemPrompt.trim(), `Fatos verdadeiros:\n${facts}`, HONESTY_RULE, languageRule(cfg.language)].join('\n\n');
}

async function startOllama() {
  startingOllama ??= ollamaProcess.start(cfg.ollama.host).finally(() => { startingOllama = null; });
  const res = await startingOllama;
  if (res.ok) warmup();
  if (process.platform === 'win32' && tray) {
    tray.displayBalloon({
      title: 'MascotAI',
      content: res.ok ? (res.already ? 'O Ollama já estava rodando.' : 'Ollama iniciado em segundo plano.') : res.error,
      iconType: res.ok ? 'info' : 'error',
    });
  }
  return res;
}

function killOllama() {
  const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, () => resolve()));
  if (process.platform === 'win32') {
    // o app da bandeja religa o servidor, então ele sai primeiro
    return run('taskkill', ['/F', '/IM', 'ollama app.exe']).then(() => run('taskkill', ['/F', '/IM', 'ollama.exe']));
  }
  return run('pkill', ['-f', 'ollama']);
}

async function quitEverything() {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Encerrar tudo', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    title: 'MascotAI',
    message: 'Encerrar o MascotAI e o Ollama?',
    detail: 'Libera a memória da GPU e da RAM. Outros programas que estiverem usando o Ollama também vão parar.',
  });
  if (response !== 0) return;

  currentAbort?.abort();
  setFollow(false);
  await ollama.unloadAll(cfg.ollama.host).catch(() => {});
  await killOllama();
  app.quit();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32, quality: 'best' }));
  tray.setToolTip('MascotAI');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar / ocultar', click: toggleVisible },
    { label: 'Novo chat', click: () => { history = []; win.webContents.send('chat:reset'); } },
    { label: 'Voltar pro canto', click: resetPosition },
    { label: 'Configurações…', click: openSettings },
    { type: 'separator' },
    { label: 'Iniciar Ollama', click: startOllama },
    { type: 'separator' },
    { label: 'Sair (só o mascote)', click: () => app.quit() },
    { label: 'Encerrar tudo (inclui Ollama)', click: quitEverything },
  ]));
  tray.on('click', toggleVisible);
}

function toggleVisible() {
  if (win.isVisible()) win.hide();
  else win.showInactive();
}

function resetPosition() {
  const p = defaultPosition();
  win.setPosition(p.x, p.y);
  cfg.position = p;
  config.save(cfg);
}

// só fica lendo o cursor enquanto o modo "seguir" está ligado
function setFollow(on) {
  clearInterval(followTimer);
  followTimer = null;
  lastCursor = null;
  if (!on) return;
  followTimer = setInterval(() => {
    if (!win.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    if (lastCursor && c.x === lastCursor.x && c.y === lastCursor.y) return;
    lastCursor = c;
    const [wx, wy] = win.getPosition();
    win.webContents.send('follow:cursor', { x: c.x - wx, y: c.y - wy });
  }, 100);
}

async function sendChat(text) {
  if (cfg.mode !== 'assistant') return { ok: false, aborted: true };
  currentAbort?.abort();
  const abort = new AbortController();
  currentAbort = abort;

  const system = buildSystemPrompt();
  history.push({ role: 'user', content: text });
  history = trimHistory(history, { numCtx: cfg.ollama.numCtx, systemTokens: estimateTokens(system) + 60 });

  // Repete a regra de idioma colada na pergunta, senão o modelo responde no idioma
  // de quem perguntou. (Como mensagem "system" no final, o llama começava a resposta
  // escrevendo "assistant".)
  const last = history[history.length - 1];
  const messages = [
    { role: 'system', content: system },
    ...history.slice(0, -1),
    { role: 'user', content: `${last.content}\n\n(${languageRule(cfg.language)})` },
  ];

  try {
    const reply = await createProvider(cfg).chat({
      messages,
      signal: abort.signal,
      onToken: (t) => win.webContents.send('chat:token', t),
    });
    history.push({ role: 'assistant', content: reply });
    return { ok: true };
  } catch (err) {
    history.pop();
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: err.message };
  } finally {
    if (currentAbort === abort) currentAbort = null;
  }
}

async function pullModel(sender, model) {
  if (pulls.has(model)) return { ok: false, error: 'Já está baixando' };
  const abort = new AbortController();
  pulls.set(model, abort);
  try {
    await ollama.pullModel(cfg.ollama.host, model, {
      signal: abort.signal,
      onProgress: (p) => { if (!sender.isDestroyed()) sender.send('models:pull-progress', { model, ...p }); },
    });
    return { ok: true };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: err.message };
  } finally {
    pulls.delete(model);
  }
}

ipcMain.handle('app:config', () => publicConfig());
ipcMain.handle('app:set-config', (_e, patch) => applyConfig(patch));
ipcMain.handle('app:models', async (_e, host) => {
  try {
    return { ok: true, models: await listModels({ ...cfg, ollama: { ...cfg.ollama, host: host || cfg.ollama.host } }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('system:specs', () => ({ ramGB: Math.round(os.totalmem() / 1024 ** 3) }));
ipcMain.handle('models:pull', (e, model) => pullModel(e.sender, model));
ipcMain.on('models:pull-cancel', (_e, model) => pulls.get(model)?.abort());
ipcMain.handle('ollama:status', () => ollamaProcess.isRunning(cfg.ollama.host));
ipcMain.handle('ollama:start', () => startOllama());

ipcMain.on('settings:open', openSettings);
ipcMain.on('settings:close', () => settingsWin?.close());
ipcMain.on('settings:minimize', () => settingsWin?.minimize());
ipcMain.on('app:quit-all', quitEverything);

ipcMain.on('win:ignore-mouse', (_e, ignore) => win.setIgnoreMouseEvents(ignore, { forward: true }));
ipcMain.on('win:focus', () => win.focus());

ipcMain.on('drag:start', () => {
  const [wx, wy] = win.getPosition();
  drag = { wx, wy, cursor: screen.getCursorScreenPoint() };
});
ipcMain.on('drag:move', () => {
  if (!drag) return;
  const c = screen.getCursorScreenPoint();
  win.setPosition(drag.wx + c.x - drag.cursor.x, drag.wy + c.y - drag.cursor.y);
});
ipcMain.on('drag:end', () => {
  if (!drag) return;
  drag = null;
  const [x, y] = win.getPosition();
  cfg.position = { x, y };
  config.save(cfg);
});

ipcMain.on('follow:set', (_e, on) => {
  cfg.followMouse = on;
  config.save(cfg);
  setFollow(on);
});

ipcMain.handle('chat:send', (_e, text) => sendChat(text));
ipcMain.on('chat:cancel', () => currentAbort?.abort());
ipcMain.on('chat:reset', () => {
  currentAbort?.abort();
  history = [];
});

// --settings ou --settings=<aba> abre direto nas configurações
function settingsFlag(argv) {
  const arg = argv.find((a) => a === '--settings' || a.startsWith('--settings='));
  return arg ? arg.split('=')[1] ?? '' : null;
}

app.whenReady().then(() => {
  cfg = config.load();
  createWindow();
  createTray();
  registerShortcut();
  warmup();
  setFollow(cfg.followMouse);
  const flag = settingsFlag(process.argv);
  if (flag !== null) openSettings(flag);
});

app.on('second-instance', (_e, argv) => {
  win?.show();
  const flag = settingsFlag(argv);
  if (flag !== null) openSettings(flag);
});
app.on('will-quit', () => globalShortcut.unregisterAll());
// fechar as configurações não pode fechar o app
app.on('window-all-closed', () => {});
