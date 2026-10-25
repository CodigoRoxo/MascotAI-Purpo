// Sobe o "ollama serve" escondido, pra não precisar abrir o Ollama na mão.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

async function isRunning(host) {
  try {
    const res = await fetch(`${host}/api/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function findExe() {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe')]
    : ['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/homebrew/bin/ollama'];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) return Promise.resolve(found);

  // fallback: procura no PATH
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => execFile(finder, ['ollama'], (err, out) => {
    resolve(err ? null : out.split(/\r?\n/)[0].trim() || null);
  }));
}

// retorna { ok, already?, error? }
async function start(host) {
  if (await isRunning(host)) return { ok: true, already: true };

  const exe = await findExe();
  if (!exe) return { ok: false, error: 'Ollama não encontrado. Instale em ollama.com' };

  // usa o mesmo endereço configurado no app (sem o http://)
  const env = { ...process.env, OLLAMA_HOST: host.replace(/^https?:\/\//, '') };
  const child = spawn(exe, ['serve'], { env, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();

  // espera até ~20 s
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isRunning(host)) return { ok: true };
  }
  return { ok: false, error: 'O Ollama não respondeu a tempo.' };
}

module.exports = { isRunning, start };
