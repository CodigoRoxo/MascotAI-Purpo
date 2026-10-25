const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, ...args) => fn(...args));

contextBridge.exposeInMainWorld('mascot', {
  getConfig: () => ipcRenderer.invoke('app:config'),
  setConfig: (patch) => ipcRenderer.invoke('app:set-config', patch),
  listModels: (host) => ipcRenderer.invoke('app:models', host),
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  quitAll: () => ipcRenderer.send('app:quit-all'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  startOllama: () => ipcRenderer.invoke('ollama:start'),
  getSpecs: () => ipcRenderer.invoke('system:specs'),
  pullModel: (model) => ipcRenderer.invoke('models:pull', model),
  cancelPull: (model) => ipcRenderer.send('models:pull-cancel', model),
  onPullProgress: on('models:pull-progress'),
  minimizeSettings: () => ipcRenderer.send('settings:minimize'),
  onConfigChanged: on('config:changed'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('win:ignore-mouse', ignore),
  focus: () => ipcRenderer.send('win:focus'),

  setFollow: (on) => ipcRenderer.send('follow:set', on),
  onFollowCursor: on('follow:cursor'),

  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: () => ipcRenderer.send('drag:move'),
  dragEnd: () => ipcRenderer.send('drag:end'),

  send: (text) => ipcRenderer.invoke('chat:send', text),
  cancel: () => ipcRenderer.send('chat:cancel'),
  reset: () => ipcRenderer.send('chat:reset'),
  onToken: on('chat:token'),
  onReset: on('chat:reset'),
  onOpenPrompt: on('prompt:open'),
});
