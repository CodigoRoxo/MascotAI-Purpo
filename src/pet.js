// Os frames são PNGs de 700x700 desenhados numa grade de 50x50 (cada "pixel" = 14px).
const ART_SIZE = 700;
const ART_GRID = 50;

const FRAMES = [
  'face_eyes', 'face_eyes_low', 'face_closed', 'face_happy', 'face_prompt', 'face_talk',
  'tired', 'tired_low', 'sleepy', 'sleeping', 'angry',
  'loading1', 'loading2', 'loading3',
  'check_init', 'check_middle', 'check_final',
  'error_init', 'error_mid', 'error_final',
  'looking_left', 'looking_right', 'looking_topleft', 'looking_topright',
  'looking_bottomleft', 'looking_bottomright',
  'easter1', 'easter2', 'easter3', 'easter4', 'easter5', 'easter6',
];

// língua: sai (1-3), balança 3x (4-5-6-5), para no 5 e volta (3-2-1)
const TONGUE = [
  ['easter1', 140], ['easter2', 140], ['easter3', 160],
  ...Array.from({ length: 3 }, () => [['easter4', 110], ['easter5', 110], ['easter6', 110], ['easter5', 110]]).flat(),
  ['easter5', 350],
  ['easter3', 140], ['easter2', 140], ['easter1', 160],
];
const TONGUE_MS = TONGUE.reduce((sum, [, ms]) => sum + ms, 0);

// frames: [nome, ms]  |  next: estado ao terminar  |  minMs: tempo mínimo na tela
// (sem o minMs, uma resposta instantânea faz loading/check piscarem)
const STATES = {
  idle:     { frames: [['face_eyes', 900], ['face_eyes_low', 900]], blink: true, canLook: true },
  typing:   { frames: [['face_prompt', 1000]] },
  thinking: { frames: [['loading1', 320], ['loading2', 320], ['loading3', 320]], minMs: 960 },
  talking:  { frames: [['face_talk', 170], ['face_prompt', 170]], minMs: 500 },
  done:     { frames: [['check_init', 160], ['check_middle', 160], ['check_final', 1200]], next: 'idle', minMs: 1520 },
  error:    { frames: [['error_init', 160], ['error_mid', 160], ['error_final', 1600]], next: 'idle', minMs: 1920 },
  happy:    { frames: [['face_happy', 1500]], next: 'idle' },
  angry:    { frames: [['angry', 1800]], next: 'idle' },
  tongue:   { frames: TONGUE, next: 'idle', minMs: TONGUE_MS },
  wake:     { frames: [['face_closed', 220], ['face_eyes', 160], ['face_closed', 140]], next: 'idle' },
  tired:    { frames: [['tired', 1100], ['tired_low', 1100]] },
  dozing:   { frames: [['sleepy', 1800]], next: 'sleeping' },
  sleeping: { frames: [['sleeping', 60_000]] },
};

const TIRED_AFTER = 60_000;
const SLEEP_AFTER = 150_000;
const LOOK_DIRS = ['left', 'right', 'topleft', 'topright', 'bottomleft', 'bottomright'];
const rand = (min, max) => min + Math.random() * (max - min);

class Pet {
  constructor(canvas, pixelScale) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.images = {};
    this.state = 'idle';
    this.index = 0;
    this.loopCount = 0;
    this.timer = null;
    this.blinkTimer = null;
    this.look = null; // null = olhando pra frente
    this.following = false;
    this.lookTimer = null;
    this.lastActivity = Date.now();
    this.resize(pixelScale);
    setInterval(() => this.checkBoredom(), 5000);
  }

  // pixelScale = pixels físicos por pixel da arte, pra não borrar
  resize(pixelScale) {
    const dpr = window.devicePixelRatio || 1;
    const device = ART_GRID * pixelScale;
    this.canvas.width = device;
    this.canvas.height = device;
    this.canvas.style.width = `${device / dpr}px`;
    this.canvas.style.height = `${device / dpr}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.draw(this.current);
  }

  async load(baseUrl) {
    await Promise.all(FRAMES.map((name) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.images[name] = img; resolve(); };
      img.onerror = () => reject(new Error(`Frame não encontrado: ${name}.png`));
      img.src = `${baseUrl}/${name}.png`;
    })));
  }

  draw(name) {
    const img = this.images[name];
    if (!img) return;
    this.current = name;
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(img, 0, 0, ART_SIZE, ART_SIZE, 0, 0, width, height);
  }

  set(state) {
    if (!STATES[state]) return;
    if (state === this.state) {
      this.cancelPending();
      return;
    }
    const left = (this.enteredAt ?? 0) + (STATES[this.state]?.minMs ?? 0) - Date.now();
    if (left > 0) {
      // fica só o último pedido, os do meio são pulados
      this.pending = state;
      clearTimeout(this.pendingTimer);
      this.pendingTimer = setTimeout(() => this.enter(this.pending), left);
      return;
    }
    this.enter(state);
  }

  cancelPending() {
    clearTimeout(this.pendingTimer);
    this.pending = null;
  }

  enter(state) {
    this.cancelPending();
    this.state = state;
    this.enteredAt = Date.now();
    this.index = 0;
    this.loopCount = 0;
    this.play();
  }

  poke() {
    this.lastActivity = Date.now();
    if (['tired', 'dozing', 'sleeping'].includes(this.state)) this.set('wake');
  }

  frameFor(frame) {
    if (STATES[this.state].canLook && this.look) return `looking_${this.look}`;
    return frame;
  }

  play() {
    clearTimeout(this.timer);
    const def = STATES[this.state];
    const [frame, ms] = def.frames[this.index];
    this.draw(this.frameFor(frame));

    this.scheduleBlink();
    this.scheduleLookAround();

    this.timer = setTimeout(() => {
      this.index++;
      if (this.index >= def.frames.length) {
        this.index = 0;
        this.loopCount++;
        if (def.next && this.loopCount >= (def.loops ?? 1)) {
          return this.enter(this.pending ?? def.next);
        }
      }
      this.play();
    }, ms);
  }

  setLook(dir) {
    if (dir === this.look) return;
    this.look = dir;
    if (STATES[this.state].canLook) {
      const [frame] = STATES[this.state].frames[this.index];
      this.draw(this.frameFor(frame));
    }
  }

  // dx/dy: cursor em relação ao centro do boneco
  lookAt(dx, dy) {
    if (Math.hypot(dx, dy) < 50) return this.setLook(null);

    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const side = dx < 0 ? 'left' : 'right';
    let dir;
    if (Math.abs(angle) <= 25 || Math.abs(angle) >= 155) dir = side;
    else dir = (dy < 0 ? 'top' : 'bottom') + side;
    this.setLook(dir);
  }

  setFollowing(on) {
    this.following = on;
    clearTimeout(this.lookTimer);
    this.lookTimer = null;
    if (!on) this.setLook(null);
    else this.scheduleLookAround();
  }

  // parado, de vez em quando olha pros lados (ou mostra a língua)
  scheduleLookAround() {
    if (this.following || this.lookTimer || !STATES[this.state]?.canLook) return;
    this.lookTimer = setTimeout(async () => {
      if (this.following || !STATES[this.state]?.canLook) {
        this.lookTimer = null;
        return;
      }
      if (Math.random() < 0.08) {
        this.lookTimer = null;
        this.set('tongue');
        return;
      }
      const glances = Math.random() < 0.4 ? 2 : 1;
      for (let i = 0; i < glances; i++) {
        this.setLook(LOOK_DIRS[Math.floor(Math.random() * LOOK_DIRS.length)]);
        await new Promise((r) => setTimeout(r, rand(900, 1800)));
        if (this.following || !STATES[this.state]?.canLook) break;
      }
      if (!this.following) this.setLook(null);
      this.lookTimer = null;
      this.scheduleLookAround();
    }, rand(5000, 12000));
  }

  scheduleBlink() {
    if (!STATES[this.state]?.blink) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
      return;
    }
    if (this.blinkTimer) return;
    this.blinkTimer = setTimeout(() => {
      this.blinkTimer = null;
      if (!STATES[this.state]?.blink) return;
      const back = this.current;
      this.draw('face_closed');
      setTimeout(() => { if (this.current === 'face_closed' && STATES[this.state]?.blink) this.draw(back); }, 140);
      this.scheduleBlink();
    }, rand(2500, 6500));
  }

  checkBoredom() {
    if (this.following) return;
    if (this.state !== 'idle' && this.state !== 'tired') return;
    const idleFor = Date.now() - this.lastActivity;
    if (idleFor > SLEEP_AFTER) this.set('dozing');
    else if (idleFor > TIRED_AFTER) this.set('tired');
  }
}

window.Pet = Pet;
