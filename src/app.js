const $ = (id) => document.getElementById(id);

const canvas = $('pet');
const pill = $('pill');
const prompt = $('prompt');
const input = $('prompt-input');
const sendBtn = $('prompt-send');
const chat = $('chat');
const messages = $('messages');

// área do boneco dentro do PNG de 700x700 (o resto é transparente)
const BODY_MIN = 84 / 700;
const BODY_MAX = 616 / 700;
const DOUBLE_CLICK_MS = 260;
const FRESH_CHAT_AFTER = 30 * 60_000;

let pet;
let mode = 'assistant';
let busy = false;
let ignoringMouse = true;
let hoveringPet = false;
let pillHideTimer = null;
let dragging = false;
let downAt = null;
let pendingClick = null;
let recentClicks = [];
let currentReply = null;
let lastSentAt = Date.now();

const isAssistant = () => mode === 'assistant';

function overPetBody(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  return x >= BODY_MIN && x <= BODY_MAX && y >= BODY_MIN && y <= BODY_MAX;
}

function isInteractive(e) {
  const el = e.target.closest?.('.hit');
  if (!el) return false;
  return el === canvas ? overPetBody(e) : true;
}

// a janela ocupa um retângulo invisível; fora do boneco/UI o clique tem que passar direto
function setIgnoreMouse(ignore) {
  if (ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  window.mascot.setIgnoreMouse(ignore);
}

function showPill() {
  clearTimeout(pillHideTimer);
  if (prompt.classList.contains('hidden')) pill.classList.remove('hidden');
  pill.classList.toggle('decor', !isAssistant());
}

function hidePillSoon() {
  clearTimeout(pillHideTimer);
  pillHideTimer = setTimeout(() => pill.classList.add('hidden'), 700);
}

document.addEventListener('mousemove', (e) => {
  if (dragging) return;
  setIgnoreMouse(!isInteractive(e));

  const onPet = e.target === canvas && overPetBody(e);
  const onPill = !!e.target.closest?.('#pill');
  if (onPet || onPill) {
    if (!hoveringPet) pet.poke();
    hoveringPet = true;
    showPill();
  } else if (hoveringPet) {
    hoveringPet = false;
    hidePillSoon();
  }
});

document.addEventListener('mouseleave', () => {
  hoveringPet = false;
  hidePillSoon();
  if (!dragging) setIgnoreMouse(true);
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !overPetBody(e)) return;
  downAt = { x: e.screenX, y: e.screenY };
  dragging = false;
  window.mascot.dragStart();
});

window.addEventListener('mousemove', (e) => {
  if (!downAt) return;
  if (!dragging && Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y) > 4) dragging = true;
  if (dragging) window.mascot.dragMove();
});

window.addEventListener('mouseup', () => {
  if (!downAt) return;
  const wasDrag = dragging;
  downAt = null;
  dragging = false;
  window.mascot.dragEnd();
  if (!wasDrag) handleClick();
});

// 1 clique abre o chat, 2 cliques liga/desliga o "seguir o mouse",
// 5 cliques rápidos deixam ele bravo
function handleClick() {
  const now = Date.now();
  recentClicks = recentClicks.filter((t) => now - t < 1500).concat(now);
  if (recentClicks.length >= 5) {
    recentClicks = [];
    clearTimeout(pendingClick);
    pendingClick = null;
    pet.set('angry');
    return;
  }

  if (pendingClick) {
    clearTimeout(pendingClick);
    pendingClick = null;
    toggleFollow();
    return;
  }
  pendingClick = setTimeout(() => {
    pendingClick = null;
    if (isAssistant()) togglePrompt();
    else pet.set('happy');
  }, DOUBLE_CLICK_MS);
}

function toggleFollow() {
  const on = !pet.following;
  pet.setFollowing(on);
  window.mascot.setFollow(on);
  if (!on) pet.set('wake');
}

canvas.addEventListener('auxclick', (e) => {
  if (e.button === 1 && overPetBody(e)) {
    pet.poke();
    pet.set('tongue');
  }
});

canvas.addEventListener('contextmenu', (e) => {
  if (overPetBody(e)) window.mascot.openSettings();
});

function openPrompt() {
  pill.classList.add('hidden');
  prompt.classList.remove('hidden');
  window.mascot.focus();
  input.focus();
  pet.poke();
  updateTypingState();
}

function closePrompt() {
  prompt.classList.add('hidden');
  input.blur();
  if (!busy) pet.set('idle');
}

function togglePrompt() {
  if (prompt.classList.contains('hidden')) openPrompt();
  else closePrompt();
}

function updateTypingState() {
  sendBtn.disabled = !input.value.trim() || busy;
  if (busy) return;
  pet.poke();
  pet.set(input.value ? 'typing' : 'idle');
}

input.addEventListener('input', updateTypingState);
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (busy) window.mascot.cancel();
  else closePrompt();
});

$('pill-edit').addEventListener('click', openPrompt);
$('pill-settings').addEventListener('click', () => window.mascot.openSettings());
$('prompt-new').addEventListener('click', () => {
  window.mascot.reset();
  clearChat();
  input.value = '';
  updateTypingState();
  input.focus();
});

window.addEventListener('blur', () => {
  if (!input.value && !busy) closePrompt();
});

function scrollChat() {
  messages.scrollTop = messages.scrollHeight;
}

// a última bolha de cada sequência do mesmo lado ganha o "rabinho"
function updateTails() {
  const all = [...messages.children];
  all.forEach((m, i) => {
    const next = all[i + 1];
    const sameSide = next && next.classList.contains('user') === m.classList.contains('user');
    m.classList.toggle('tail', !sameSide);
  });
}

function addMessage(role, text = '') {
  chat.classList.remove('hidden');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  messages.append(el);
  updateTails();
  scrollChat();
  return el;
}

function addTyping() {
  const el = addMessage('ai typing');
  el.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
  return el;
}

function hideChat() {
  chat.classList.add('hidden');
}

function clearChat() {
  messages.replaceChildren();
  hideChat();
}

$('chat-close').addEventListener('click', hideChat);

prompt.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;

  if (/mostr[ae] a l[ií]ngua/i.test(text)) {
    input.value = '';
    sendBtn.disabled = true;
    pet.set('tongue');
    return;
  }

  if (Date.now() - lastSentAt > FRESH_CHAT_AFTER) {
    window.mascot.reset();
    clearChat();
  }
  lastSentAt = Date.now();

  busy = true;
  input.value = '';
  sendBtn.disabled = true;
  input.placeholder = 'Pensando… (Esc cancela)';
  addMessage('user', text);
  const typing = addTyping();
  pet.set('thinking');

  let received = '';
  let reply = null;
  currentReply = (t) => {
    if (!reply) {
      pet.set('talking');
      typing.remove();
      reply = addMessage('ai');
    }
    received += t;
    reply.textContent = received.trimStart();
    scrollChat();
  };

  const res = await window.mascot.send(text);
  currentReply = null;
  busy = false;
  input.placeholder = 'Pergunte mais alguma coisa';
  typing.remove();

  if (res.ok) pet.set('done');
  else if (res.aborted) pet.set('idle');
  else {
    addMessage('ai error', res.error);
    pet.set('error');
  }
  updateTails();
  sendBtn.disabled = !input.value.trim();
});

function applyConfig(cfg) {
  mode = cfg.mode;
  pet.resize(cfg.pixelScale);
  if (!isAssistant()) {
    hideChat();
    closePrompt();
    pill.classList.add('hidden');
  }
}

window.mascot.onToken((t) => currentReply?.(t));
window.mascot.onReset(() => {
  clearChat();
  input.value = '';
  updateTypingState();
});
window.mascot.onOpenPrompt(() => { if (isAssistant()) openPrompt(); });
window.mascot.onConfigChanged(applyConfig);
window.mascot.onFollowCursor(({ x, y }) => {
  if (!pet?.following) return;
  const r = canvas.getBoundingClientRect();
  pet.lookAt(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
});

(async () => {
  const cfg = await window.mascot.getConfig();
  pet = new Pet(canvas, cfg.pixelScale);
  await pet.load('../assets/sprites/frames');
  applyConfig(cfg);
  pet.setFollowing(!!cfg.followMouse);
  pet.play();
})();
