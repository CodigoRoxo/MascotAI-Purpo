// Provider local via Ollama (https://ollama.com).
// Interface de provider: chat({ messages, signal, onToken }) -> Promise<string>

// modelos instalados, sem os de embedding (que não conversam)
async function listModels(host) {
  let res;
  try {
    res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
  } catch {
    throw new Error('Ollama não está rodando (rode "ollama serve").');
  }
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`);
  const { models = [] } = await res.json();
  return models
    .filter((m) => {
      const families = m.details?.families ?? [m.details?.family];
      return !families.some((f) => /bert/i.test(f ?? '')) && !/embed|minilm/i.test(m.name);
    })
    .map((m) => ({ name: m.name, size: m.size, params: m.details?.parameter_size ?? '' }))
    .sort((a, b) => a.size - b.size);
}

// baixa um modelo; onProgress({ status, completed, total })
async function pullModel(host, model, { signal, onProgress }) {
  let res;
  try {
    res = await fetch(`${host}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Ollama não está rodando (rode "ollama serve").');
  }
  if (!res.ok) throw new Error(`Ollama respondeu ${res.status}: ${await res.text().catch(() => '')}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      onProgress(msg);
    }
  }
}

function create({ host, model, keepAlive, numCtx }) {
  const options = { temperature: 0.4, num_ctx: numCtx };
  return {
    name: `ollama:${model}`,

    // carrega o modelo sem gerar nada, pra primeira pergunta não ficar esperando
    async warmup() {
      await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // mesmo num_ctx do chat, senão o Ollama recarrega o modelo na 1ª pergunta
        body: JSON.stringify({ model, messages: [], keep_alive: keepAlive, options }),
      });
    },

    async chat({ messages, signal, onToken }) {
      let res;
      try {
        res = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // temperatura baixa: modelo pequeno inventa menos e troca menos de idioma
          body: JSON.stringify({ model, messages, stream: true, keep_alive: keepAlive, options }),
          signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new Error('Não consegui falar com o Ollama. Ele está aberto? (rode "ollama serve")');
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 404 || /not found/i.test(body)) {
          throw new Error(`Modelo "${model}" não encontrado. Rode: ollama pull ${model}`);
        }
        throw new Error(`Ollama respondeu ${res.status}: ${body.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.error) throw new Error(msg.error);
          const token = msg.message?.content ?? '';
          if (token) {
            full += token;
            onToken(token);
          }
        }
      }
      return full;
    },
  };
}

// descarrega todos os modelos que estão na memória
async function unloadAll(host) {
  const res = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(3000) });
  const { models = [] } = await res.json();
  await Promise.all(models.map((m) =>
    fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m.name, keep_alive: 0 }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {})));
}

module.exports = { create, listModels, pullModel, unloadAll };
