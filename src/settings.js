const $ = (id) => document.getElementById(id);
const api = window.mascot;

const ART_GRID = 50;
const LIGHT_MODEL_BYTES = 3e9; // até ~3 GB = bom pra PC mais fraco
let cfg;

// abas

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => {
    const on = p.dataset.panel === name;
    p.classList.toggle('active', on);
    if (on) {
      $('tab-title').textContent = p.dataset.title;
      $('tab-sub').textContent = p.dataset.sub;
    }
  });
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

$('win-close').addEventListener('click', () => api.closeSettings());
$('win-min').addEventListener('click', () => api.minimizeSettings());

// salvar

function flashSaved() {
  const el = $('saved');
  el.classList.add('show');
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => el.classList.remove('show'), 1200);
}

async function save(patch) {
  cfg = await api.setConfig(patch);
  render();
  flashSaved();
}

function render() {
  document.querySelector(`input[name=mode][value=${cfg.mode}]`).checked = true;
  document.body.classList.toggle('decor', cfg.mode !== 'assistant');

  document.querySelectorAll('#scale button').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.scale) === cfg.pixelScale));
  const px = (ART_GRID * cfg.pixelScale) / (window.devicePixelRatio || 1);
  $('preview-img').style.width = `${px}px`;
  $('preview-img').style.height = `${px}px`;

  document.querySelectorAll('.model').forEach((m) => m.classList.toggle('active', m.dataset.name === cfg.model));
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.code === cfg.language));
}

function renderLanguages() {
  const box = $('languages');
  box.replaceChildren();
  for (const { code, label } of cfg.languages) {
    const chip = el('button', 'chip', label);
    chip.dataset.code = code;
    chip.onclick = () => save({ language: code });
    box.append(chip);
  }
}

// mascote

document.querySelectorAll('input[name=mode]').forEach((r) =>
  r.addEventListener('change', () => save({ mode: r.value })));

document.querySelectorAll('#scale button').forEach((b) =>
  b.addEventListener('click', () => save({ pixelScale: Number(b.dataset.scale) })));

// modelos

const fmtSize = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;

function modelRow({ name, params, size, missing }) {
  const row = document.createElement('button');
  row.className = 'model' + (missing ? ' missing' : '');
  row.dataset.name = name;

  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = name;
  row.append(dot, label);

  const badges = missing
    ? [['não instalado', '']]
    : [
        ...(size <= LIGHT_MODEL_BYTES ? [['leve', 'light']] : []),
        ...(params ? [[params, '']] : []),
        [fmtSize(size), ''],
      ];
  for (const [text, cls] of badges) {
    const b = document.createElement('span');
    b.className = `badge ${cls}`;
    b.textContent = text;
    row.append(b);
  }

  row.addEventListener('click', () => save({ model: name }).then(loadModels));
  return row;
}

async function loadModels() {
  const list = $('models');
  const status = $('model-status');
  $('refresh').classList.add('spin');
  const res = await api.listModels(cfg.host);
  $('refresh').classList.remove('spin');

  list.replaceChildren();
  if (!res.ok) {
    status.textContent = res.error;
    list.append(modelRow({ name: cfg.model, missing: true }));
    render();
    return;
  }

  installedNames = new Set(res.models.map((m) => m.name));
  renderCatalog();

  const installed = res.models.some((m) => m.name === cfg.model);
  if (!installed) list.append(modelRow({ name: cfg.model, missing: true }));
  res.models.forEach((m) => list.append(modelRow(m)));

  status.textContent = installed
    ? 'Modelos maiores respondem melhor, mas são mais lentos e pesados.'
    : `"${cfg.model}" não está instalado. Escolha outro ou rode: ollama pull ${cfg.model}`;
  render();
}
$('refresh').addEventListener('click', () => { checkServer(); loadModels(); });

// servidor do Ollama

function setServer(state, text) {
  $('server-dot').className = `dot-status ${state}`;
  $('server-text').textContent = text;
  $('server-start').classList.toggle('hidden', state !== 'off');
}

async function checkServer() {
  const running = await api.ollamaStatus();
  setServer(running ? 'on' : 'off', running ? 'Ollama rodando' : 'Ollama parado');
  return running;
}

$('server-start').addEventListener('click', async () => {
  setServer('wait', 'Iniciando o Ollama em segundo plano…');
  const res = await api.startOllama();
  if (res.ok) {
    setServer('on', 'Ollama rodando');
    loadModels();
  } else {
    setServer('off', res.error);
  }
});

// baixar modelos

const CATALOG = [
  {
    name: 'llama3.2:1b',
    tag: 'Ultra leve',
    desc: 'Respostas simples e rápidas. Roda em quase qualquer PC.',
    sizeGB: 1.3,
    minRamGB: 4,
  },
  {
    name: 'llama3.2:3b',
    tag: 'Recomendado',
    recommended: true,
    desc: 'Melhor equilíbrio entre velocidade e qualidade pro dia a dia.',
    sizeGB: 2.0,
    minRamGB: 8,
  },
  {
    name: 'qwen2.5:7b',
    tag: 'Mais esperto',
    desc: 'Respostas bem melhores, mas pede um PC mais forte (ideal com GPU de 6 GB+).',
    sizeGB: 4.7,
    minRamGB: 16,
  },
];

let installedNames = new Set();
let specs = null;
const pulling = new Map(); // nome -> { pct, label, error }

// "llama3.2:3b" instalado pode aparecer como "llama3.2:3b" ou com ":latest"
const isInstalled = (name) => installedNames.has(name) || installedNames.has(`${name}:latest`);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderCatalog() {
  const box = $('catalog');
  box.replaceChildren();

  for (const m of CATALOG) {
    const card = el('div', 'card' + (m.recommended ? ' recommended' : ''));

    const head = el('div', 'card-head');
    head.append(el('span', 'name', m.name), el('span', `badge ${m.recommended ? 'rec' : ''}`, m.tag));

    const req = el('div', 'req');
    const ramOk = !specs || specs.ramGB >= m.minRamGB;
    req.append(
      el('span', null, `${m.sizeGB.toFixed(1)} GB de download`),
      el('span', ramOk ? 'ok' : 'warn', `${ramOk ? '✓' : '⚠'} mín. ${m.minRamGB} GB de RAM`),
    );

    const actions = el('div', 'actions');
    const state = pulling.get(m.name);
    if (state && !state.error) {
      const cancel = el('button', 'btn secondary', 'Cancelar');
      cancel.onclick = () => api.cancelPull(m.name);
      actions.append(cancel);
    } else if (isInstalled(m.name)) {
      const inUse = cfg.model === m.name || cfg.model === `${m.name}:latest`;
      const btn = el('button', inUse ? 'btn done' : 'btn secondary', inUse ? 'Em uso ✓' : 'Usar');
      if (!inUse) btn.onclick = () => save({ model: m.name }).then(loadModels);
      actions.append(btn);
    } else {
      const btn = el('button', 'btn', 'Baixar');
      btn.onclick = () => startPull(m.name);
      actions.append(btn);
    }

    card.append(head, actions, el('div', 'muted', m.desc), req);

    if (state) {
      const bar = el('div', 'progress');
      const fill = el('div');
      fill.style.width = `${state.pct}%`;
      bar.append(fill);
      card.append(bar, el('div', 'progress-label', state.error ?? state.label));
    }
    box.append(card);
  }
}

async function startPull(name) {
  pulling.set(name, { pct: 0, label: 'Conectando ao Ollama…' });
  renderCatalog();
  const res = await api.pullModel(name);
  if (res.ok) {
    pulling.delete(name);
    await save({ model: name }); // já deixa em uso
    await loadModels();
  } else if (res.aborted) {
    pulling.delete(name);
    renderCatalog();
  } else {
    pulling.set(name, { pct: 0, error: res.error });
    renderCatalog();
  }
}

api.onPullProgress(({ model, status, completed, total }) => {
  const state = pulling.get(model);
  if (!state) return;
  if (total) {
    state.pct = Math.round((completed / total) * 100);
    state.label = `Baixando… ${state.pct}% (${(completed / 1e9).toFixed(2)} de ${(total / 1e9).toFixed(2)} GB)`;
  } else {
    state.label = status === 'success' ? 'Pronto!' : status === 'verifying sha256 digest' ? 'Verificando…' : 'Preparando…';
    if (status === 'success') state.pct = 100;
  }
  renderCatalog();
});

// personalidade / avançado

$('system').addEventListener('change', () => save({ systemPrompt: $('system').value }));
$('knowledge').addEventListener('change', () => save({ knowledge: $('knowledge').value }));
$('host').addEventListener('change', async () => {
  await save({ host: $('host').value.trim() });
  loadModels();
});
$('shortcut').addEventListener('change', () => save({ shortcut: $('shortcut').value.trim() }));
$('quit-all').addEventListener('click', () => api.quitAll());

// start

(async () => {
  cfg = await api.getConfig();
  $('system').value = cfg.systemPrompt;
  $('knowledge').value = cfg.knowledge ?? '';
  $('identity').replaceChildren(...cfg.identity.map((f) => el('li', null, f)));
  $('host').value = cfg.host;
  $('shortcut').value = cfg.shortcut;
  showTab(location.hash.slice(1) || 'mascot');
  renderLanguages();
  render();
  renderCatalog();
  loadModels();
  checkServer();

  specs = await api.getSpecs();
  const specsText = $('specs-text');
  specsText.textContent = 'Seu PC tem ';
  specsText.append(el('b', null, `${specs.ramGB} GB de RAM`));
  renderCatalog();
})();
