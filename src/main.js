'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const LGTV = require('./lib/lgtv');
const { discoverTVs } = require('./lib/discovery');
const { wakeTV, macFromArp, normalizeMac } = require('./lib/wol');

const APP_NAME = 'webOS Control Center';
app.setName(APP_NAME);
// Running from source keeps its own profile so it never inherits (or overwrites)
// the TV pairing of an installed copy. A fresh profile starts with onboarding.
const PROFILE_NAME = app.isPackaged ? APP_NAME : `${APP_NAME} Dev`;
app.setPath('userData', path.join(app.getPath('appData'), PROFILE_NAME));

// The TV serves app artwork from its own HTTPS endpoint with a self-signed
// certificate, so the renderer would otherwise show broken icons.
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  const trusted = host && (host === config.ip || host === '127.0.0.1' || host === 'localhost');
  if (trusted) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const ICO_PATH = path.join(__dirname, '..', 'assets', 'icon.ico');
const BASE_WIDTH = 424;
const BASE_HEIGHT = 800;

const DEFAULTS = {
  ip: '',
  clientKey: '',
  paired: false,
  mac: '',
  name: '',
  alwaysOnTop: true,
  launchAtLogin: false,
  closeToTray: true,
  autoReconnect: true,
  sounds: true,
  bounds: null
};

let config = loadConfig();
let win = null;
let tray = null;
let tv = null;
let quitting = false;
let windowScale = 1;
let pollTimer = null;
let pushTimer = null;
let saveBoundsTimer = null;

function isPaired() {
  return !!(config.clientKey || config.paired);
}

const tvState = {
  status: config.ip && isPaired() ? 'connecting' : 'idle',
  ip: config.ip || '',
  name: config.name || 'My TV',
  message: '',
  volume: 25,
  muted: false,
  volumeFixed: false,
  soundOutput: '',
  channel: { number: '', name: '', id: '' },
  appId: '',
  powerState: '',
  info: {},
  mac: config.mac || ''
};

// ---------------------------------------------------------------- config

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Object.assign({}, DEFAULTS, raw, { bounds: raw.bounds || null });
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    const tmp = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (_) {}
}

function publicConfig() {
  return Object.assign({}, config);
}

// ---------------------------------------------------------------- helpers

function sendEvent(payload) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send('tv:event', payload); } catch (_) {}
}

function pushState(immediate = false) {
  if (immediate) {
    clearTimeout(pushTimer);
    pushTimer = null;
    sendEvent({ type: 'state', state: tvState });
    return;
  }
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    sendEvent({ type: 'state', state: tvState });
  }, 45);
}

function errorMessage(err) {
  if (!err) return 'Something went wrong.';
  return String(err.message || err).replace(/^Error:\s*/, '');
}

function reply(promise) {
  return Promise.resolve(promise)
    .then((data) => {
      if (data && typeof data === 'object' && 'ok' in data) return data;
      return data === undefined ? { ok: true } : { ok: true, data };
    })
    .catch((err) => ({ ok: false, error: errorMessage(err) }));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function titleForApp() {
  return tvState.appId || '';
}

// ---------------------------------------------------------------- TV state

function applyVolume(payload) {
  if (!payload) return;
  let changed = false;
  if (typeof payload.volume === 'number' && payload.volume !== tvState.volume) {
    tvState.volume = clamp(Math.round(payload.volume), 0, 100);
    changed = true;
  }
  if (typeof payload.muted === 'boolean' && payload.muted !== tvState.muted) {
    tvState.muted = payload.muted;
    changed = true;
  }
  if (payload.soundOutput && payload.soundOutput !== tvState.soundOutput) {
    tvState.soundOutput = payload.soundOutput;
    changed = true;
  }
  // Newer webOS nests the numbers in volumeStatus; adjustVolume=false / a negative volume
  // means the TV hands volume off to an external amp.
  const status = payload.volumeStatus || payload;
  if (status.adjustVolume === false || (typeof status.volume === 'number' && status.volume < 0)) {
    if (!tvState.volumeFixed) { tvState.volumeFixed = true; changed = true; }
  } else if (typeof status.volume === 'number' && tvState.volumeFixed) {
    tvState.volumeFixed = false;
    changed = true;
  }
  if (changed) pushState();
}

function applyChannel(payload) {
  if (!payload) return;
  const number = payload.channelNumber === undefined || payload.channelNumber === null
    ? '' : String(payload.channelNumber);
  const name = payload.channelName || '';
  const id = payload.channelId || '';
  if (number !== tvState.channel.number || name !== tvState.channel.name || id !== tvState.channel.id) {
    tvState.channel = { number, name, id };
    pushState();
  }
}

function applyApp(payload) {
  if (!payload) return;
  const appId = payload.appId || '';
  if (appId && appId !== tvState.appId) {
    tvState.appId = appId;
    pushState();
  }
}

function applyPower(payload) {
  if (!payload) return;
  const state = payload.state || payload.powerState || '';
  if (state && state !== tvState.powerState) {
    tvState.powerState = state;
    pushState();
  }
}

function applySound(payload) {
  if (payload && payload.soundOutput && payload.soundOutput !== tvState.soundOutput) {
    tvState.soundOutput = payload.soundOutput;
    pushState();
  }
}

function handleUpdate(uri, payload) {
  if (uri.includes('audio/getVolume')) applyVolume(payload);
  else if (uri.includes('tv/getCurrentChannel')) applyChannel(payload);
  else if (uri.includes('getForegroundAppInfo')) applyApp(payload);
  else if (uri.includes('audio/getSoundOutput')) applySound(payload);
  else if (uri.includes('tvpower')) applyPower(payload);
}

function ensureTV() {
  if (tv) return tv;
  tv = new LGTV();

  tv.on('status', (status) => {
    tvState.status = status.state;
    tvState.message = status.message || '';
    if (status.ip) tvState.ip = status.ip;
    if (status.state === 'connected') {
      tvState.message = '';
      console.log(`[webOS] connected to ${status.ip || config.ip}`);
    } else if (status.state === 'error' || status.state === 'denied') {
      console.warn(`[webOS] ${status.message}`);
    }
    pushState(true);
    rebuildTray();
  });

  tv.on('clientKey', (key) => {
    config.clientKey = key;
    config.paired = true;
    if (tvState.ip) config.ip = tvState.ip;
    saveConfig();
    sendEvent({ type: 'config', config: publicConfig() });
  });

  tv.on('update', handleUpdate);

  tv.on('ready', () => {
    tvState.status = 'connected';
    tvState.message = '';
    pushState(true);
    rebuildTray();
    bootstrapTV();
  });

  tv.on('disconnected', ({ wasRegistered } = {}) => {
    stopPolling();
    if (wasRegistered) tvState.message = 'Connection lost. Reconnecting…';
    pushState(true);
    rebuildTray();
  });

  tv.on('socketError', (message) => {
    tvState.message = message;
    pushState();
  });

  return tv;
}

async function bootstrapTV() {
  if (!tv || !tv.isConnected()) return;
  const client = tv;

  client.subscribe('ssap://audio/getVolume').then(applyVolume).catch(() => {});
  client.subscribe('ssap://tv/getCurrentChannel').then(applyChannel).catch(() => {});
  client.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo').then(applyApp).catch(() => {});
  client.subscribe('ssap://audio/getSoundOutput').then(applySound).catch(() => {});
  client.request('ssap://com.webos.service.tvpower/power/getPowerState').then(applyPower).catch(() => {});

  fetchSystemInfo();
  fetchApps();
  fetchInputs();
  startPolling();

  if (!config.mac && config.ip) {
    macFromArp(config.ip).then((mac) => {
      if (!mac) return;
      config.mac = mac;
      tvState.mac = mac;
      saveConfig();
      pushState();
      sendEvent({ type: 'config', config: publicConfig() });
    }).catch(() => {});
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!tv || !tv.isConnected()) return;
    if (win && !win.isVisible()) return;
    tv.request('ssap://audio/getVolume').then(applyVolume).catch(() => {});
    tv.request('ssap://tv/getCurrentChannel').then(applyChannel).catch(() => {});
    tv.request('ssap://com.webos.applicationManager/getForegroundAppInfo').then(applyApp).catch(() => {});
    tv.request('ssap://com.webos.service.tvpower/power/getPowerState').then(applyPower).catch(() => {});
  }, 12000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function fetchSystemInfo() {
  if (!tv || !tv.isConnected()) return;
  const client = tv;
  const result = {};
  try {
    const info = await client.request('ssap://system/getSystemInfo');
    Object.assign(result, {
      modelName: info.modelName || '',
      modelNumber: info.modelNumber || '',
      serialNumber: info.serialNumber || '',
      receiverType: info.receiverType || ''
    });
  } catch (_) {}
  try {
    const sw = await client.request('ssap://com.webos.service.update/getCurrentSWInformation');
    Object.assign(result, {
      firmware: sw.product_name || sw.sw_type || '',
      version: sw.major_ver && sw.minor_ver ? `${sw.major_ver}.${sw.minor_ver}` : (sw.version || '')
    });
  } catch (_) {}
  tvState.info = result;
  pushState();

  if (!config.name && result.modelName) {
    config.name = result.modelName;
    tvState.name = result.modelName;
    saveConfig();
    sendEvent({ type: 'config', config: publicConfig() });
  }
}

async function fetchApps() {
  if (!tv || !tv.isConnected()) return;
  const client = tv;
  let apps = [];
  let source = 'launchPoints';
  try {
    const res = await client.request('ssap://com.webos.applicationManager/listLaunchPoints', {}, 15000);
    apps = Array.isArray(res.launchPoints) ? res.launchPoints : [];
  } catch (_) {}
  if (!apps.length) {
    source = 'apps';
    try {
      const res = await client.request('ssap://com.webos.applicationManager/listApps', {}, 15000);
      apps = Array.isArray(res.apps) ? res.apps : [];
    } catch (_) {}
  }
  const cleaned = apps
    .filter((a) => a && a.id)
    .map((a) => ({
      id: a.id,
      title: a.title || a.name || a.id,
      icon: normalizeIconUrl(a.largeIcon || a.icon || ''),
      color: a.bgColor || a.iconColor || '',
      system: !!a.systemApp || /^com\.webos\.app\.(home|launcher|inputpicker)/.test(a.id)
    }));
  sendEvent({ type: 'apps', apps: cleaned, source });
}

function normalizeIconUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
        return `http://${config.ip}:3000${parsed.pathname}${parsed.search}`;
      }
      return url;
    } catch (_) {
      return '';
    }
  }
  return '';
}

async function fetchInputs() {
  if (!tv || !tv.isConnected()) return;
  const client = tv;
  let inputs = [];
  try {
    const res = await client.request('ssap://tv/getExternalInputList', {}, 12000);
    inputs = (res.devices || []).map((d) => ({
      id: d.id,
      label: d.label || d.id,
      connected: !!d.connected,
      port: d.port || 0
    }));
  } catch (_) {}
  if (!inputs.length) {
    inputs = [1, 2, 3, 4].map((n) => ({
      id: `HDMI_${n}`,
      label: `HDMI ${n}`,
      connected: true,
      port: n
    }));
  }
  sendEvent({ type: 'inputs', inputs });
}

// ---------------------------------------------------------------- connect

async function connectTV({ ip, clientKey, name, quiet = false } = {}) {
  const address = String(ip || config.ip || '').trim();
  if (!address) return { ok: false, error: 'Enter your TV’s IP address first.' };
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    return { ok: false, error: 'That does not look like an IP address (example: 192.168.1.42).' };
  }

  const previous = { ip: config.ip, clientKey: config.clientKey, name: config.name, paired: config.paired };
  const sameTV = address === previous.ip;
  const wasPaired = sameTV && !!(previous.clientKey || previous.paired);

  // Keep the attempt in memory only. Nothing is written to config.json until
  // the TV accepts the pair, so a mistyped IP never becomes a silent auto-connect.
  config.ip = address;
  if (clientKey !== undefined) {
    config.clientKey = clientKey || '';
  } else if (!sameTV) {
    // A different TV needs its own key; never send the old TV's key to it.
    config.clientKey = '';
    config.paired = false;
  }
  if (name) {
    config.name = name;
    tvState.name = name;
  }

  const client = ensureTV();
  client.setAutoReconnect(!!config.autoReconnect);
  tvState.ip = address;
  tvState.name = config.name || tvState.name || 'My TV';
  tvState.message = '';
  tvState.status = 'connecting';
  pushState(true);

  try {
    await client.connect(address, config.clientKey || null);
    config.paired = true;
    config.ip = address;
    saveConfig();
    tvState.status = 'connected';
    tvState.message = '';
    pushState(true);
    sendEvent({ type: 'config', config: publicConfig() });
    rebuildTray();
    return { ok: true };
  } catch (err) {
    const message = errorMessage(err);
    tvState.status = client.state === 'denied' ? 'denied' : 'error';
    tvState.message = message;

    if (!wasPaired) {
      // Fresh setup or a new TV failed: restore the previous saved TV.
      config.ip = previous.ip;
      config.clientKey = previous.clientKey;
      config.name = previous.name;
      config.paired = previous.paired;
      saveConfig();
      sendEvent({ type: 'config', config: publicConfig() });
    }

    pushState(true);
    if (!quiet) sendEvent({ type: 'toast', kind: 'error', message });
    return { ok: false, error: message, denied: tvState.status === 'denied' };
  }
}

async function wakeTVHandler() {
  const ip = config.ip;
  if (!ip) return { ok: false, error: 'Connect to your TV once before using Wake-on-LAN.' };
  let mac = normalizeMac(config.mac || tvState.mac);
  if (!mac) mac = await macFromArp(ip);
  if (!mac) {
    return { ok: false, error: 'No MAC address found. Add it in Settings → Wake on LAN.' };
  }
  config.mac = mac;
  tvState.mac = mac;
  saveConfig();
  sendEvent({ type: 'config', config: publicConfig() });
  pushState();

  await wakeTV(mac, ip);

  const client = ensureTV();
  client.startWaking();
  tvState.status = 'connecting';
  tvState.message = 'Waking your TV…';
  pushState(true);
  client.connect(ip, config.clientKey || null).catch(() => {});
  return { ok: true, mac };
}

async function forgetTV() {
  if (tv) {
    tv.powerOff && (tv.autoReconnect = false);
    tv.disconnect();
  }
  config.ip = '';
  config.clientKey = '';
  config.paired = false;
  config.mac = '';
  config.name = '';
  saveConfig();
  Object.assign(tvState, {
    status: 'idle',
    ip: '',
    name: 'My TV',
    message: '',
    volume: 25,
    muted: false,
    volumeFixed: false,
    soundOutput: '',
    channel: { number: '', name: '', id: '' },
    appId: '',
    info: {},
    mac: ''
  });
  pushState(true);
  sendEvent({ type: 'config', config: publicConfig() });
  sendEvent({ type: 'forgotten' });
  rebuildTray();
  return { ok: true };
}

// ---------------------------------------------------------------- window

function sanitizeBounds(bounds, width, height) {
  if (!bounds) return null;
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const wa = d.workArea;
    return bounds.x < wa.x + wa.width - 80 &&
      bounds.x + width > wa.x + 80 &&
      bounds.y < wa.y + wa.height - 80 &&
      bounds.y + height > wa.y + 20;
  });
  return visible ? bounds : null;
}

function defaultPosition(width, height) {
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  return {
    x: Math.round(wa.x + wa.width - width - 26),
    y: Math.round(wa.y + (wa.height - height) / 2)
  };
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  windowScale = clamp((wa.height - 70) / BASE_HEIGHT, 0.78, 1);
  const width = Math.round(BASE_WIDTH * windowScale);
  const height = Math.round(BASE_HEIGHT * windowScale);
  const saved = sanitizeBounds(config.bounds, width, height);
  const pos = saved || defaultPosition(width, height);

  win = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    minWidth: width,
    minHeight: height,
    maxWidth: width,
    maxHeight: height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: !!config.alwaysOnTop,
    skipTaskbar: false,
    hasShadow: true,
    title: 'webOS Control Center',
    icon: fs.existsSync(ICO_PATH) ? ICO_PATH : (fs.existsSync(ICON_PATH) ? ICON_PATH : undefined),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: true
    }
  });

  win.setMenu(null);
  try { win.setAlwaysOnTop(!!config.alwaysOnTop, 'normal'); } catch (_) {}
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (windowScale < 1) win.webContents.setZoomFactor(windowScale);
    win.show();
    if (config.ip && isPaired()) {
      setTimeout(() => {
        connectTV({ ip: config.ip, clientKey: config.clientKey, quiet: true }).catch(() => {});
      }, 400);
    }
  });

  win.webContents.on('did-finish-load', () => {
    if (windowScale < 1) win.webContents.setZoomFactor(windowScale);
    sendEvent({ type: 'state', state: tvState });
    sendEvent({ type: 'config', config: publicConfig() });
  });

  win.on('moved', scheduleBoundsSave);
  win.on('close', (event) => {
    if (!quitting && config.closeToTray) {
      event.preventDefault();
      win.hide();
      if (tray) {
        try {
          tray.displayBalloon({
            title: 'webOS Control Center',
            content: 'Still running in the tray. Right-click the tray icon to quit.'
          });
        } catch (_) {}
      }
    }
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function scheduleBoundsSave() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    config.bounds = { x: b.x, y: b.y };
    saveConfig();
  }, 500);
}

function showWindow() {
  if (quitting) return;
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function setLoginItem(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()]
    });
  } catch (_) {}
}

// ---------------------------------------------------------------- tray

function trayImage() {
  let image = null;
  try {
    if (fs.existsSync(ICO_PATH)) image = nativeImage.createFromPath(ICO_PATH);
    if (!image || image.isEmpty()) image = nativeImage.createFromPath(ICON_PATH);
  } catch (_) {}
  if (!image || image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  return image;
}

function rebuildTray() {
  if (!tray) return;
  const connected = tvState.status === 'connected';
  const menu = Menu.buildFromTemplate([
    { label: connected ? `Connected · ${config.ip}` : 'Show control center', click: showWindow },
    { type: 'separator' },
    {
      label: 'Turn TV off',
      enabled: connected,
      click: () => { if (tv) tv.powerOff().catch(() => {}); }
    },
    {
      label: 'Wake TV',
      enabled: !connected && !!config.ip,
      click: () => { wakeTVHandler().catch(() => {}); }
    },
    {
      label: 'Reconnect',
      enabled: !!config.ip,
      click: () => { connectTV({ ip: config.ip, clientKey: config.clientKey, quiet: true }).catch(() => {}); }
    },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: !!config.alwaysOnTop,
      click: (item) => {
        config.alwaysOnTop = item.checked;
        saveConfig();
        if (win) win.setAlwaysOnTop(item.checked, 'normal');
        sendEvent({ type: 'config', config: publicConfig() });
      }
    },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: !!config.launchAtLogin,
      click: (item) => {
        config.launchAtLogin = item.checked;
        saveConfig();
        setLoginItem(item.checked);
        sendEvent({ type: 'config', config: publicConfig() });
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(connected ? `webOS Control Center · ${config.ip}` : 'webOS Control Center');
}

function createTray() {
  tray = new Tray(trayImage());
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible() && win.isFocused()) win.hide();
    else showWindow();
  });
  tray.on('double-click', showWindow);
  rebuildTray();
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    config: publicConfig(),
    version: app.getVersion(),
    state: tvState
  }));

  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); return { ok: true }; });
  ipcMain.handle('app:open-data', () => { shell.openPath(app.getPath('userData')); return { ok: true }; });

  ipcMain.handle('tv:connect', (_e, opts) => reply(connectTV(opts || {})));
  ipcMain.handle('tv:disconnect', () => { if (tv) tv.disconnect(); return { ok: true }; });
  ipcMain.handle('tv:forget', () => reply(forgetTV()));
  ipcMain.handle('tv:wake', () => reply(wakeTVHandler()));
  ipcMain.handle('tv:discover', (_e, opts) => reply(discoverTVs({ timeout: 3800, scan: true, ...(opts || {}) })));

  ipcMain.handle('tv:key', (_e, { name }) => reply(tv ? tv.button(name) : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:pointer', (_e, { action, dx, dy }) => reply(tv ? tv.pointer(action, dx, dy) : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:media', (_e, { action }) => reply(tv ? tv.media(action) : Promise.reject(new Error('Connect to your TV first.'))));

  ipcMain.handle('tv:volume', (_e, { volume }) => {
    if (!tv || !tv.isConnected()) return { ok: false, error: 'Connect to your TV first.' };
    const value = clamp(Math.round(Number(volume) || 0), 0, 100);
    const wasMuted = tvState.muted;
    tvState.volume = value;
    if (wasMuted) tvState.muted = false;
    pushState(true);
    return reply((async () => {
      if (wasMuted) await tv.mute(false).catch(() => {});
      await tv.volume(value);
    })());
  });
  ipcMain.handle('tv:volume-up', () => reply(tv ? tv.volumeUp() : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:volume-down', () => reply(tv ? tv.volumeDown() : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:mute', (_e, { mute }) => {
    if (!tv || !tv.isConnected()) return { ok: false, error: 'Connect to your TV first.' };
    tvState.muted = !!mute;
    pushState(true);
    return reply(tv.mute(!!mute));
  });

  ipcMain.handle('tv:channel', (_e, { direction }) => reply(tv ? tv.channel(direction === 'up' ? 'up' : 'down') : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:launch', (_e, { id, params }) => reply(tv ? tv.launchApp(id, params) : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:text', (_e, { text }) => reply(tv ? tv.insertText(text) : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:backspace', () => reply(tv ? tv.deleteText(1) : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:enter', () => reply(tv ? tv.enterText() : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:toast', (_e, { message }) => reply(tv ? tv.toast(String(message || '').slice(0, 120)) : Promise.reject(new Error('Connect to your TV first.'))));

  ipcMain.handle('tv:apps', () => reply((async () => { await fetchApps(); return { ok: true }; })()));
  ipcMain.handle('tv:inputs', () => reply((async () => { await fetchInputs(); return { ok: true }; })()));
  ipcMain.handle('tv:refresh', () => reply((async () => {
    if (!tv || !tv.isConnected()) throw new Error('Connect to your TV first.');
    await Promise.allSettled([
      tv.request('ssap://audio/getVolume').then(applyVolume),
      tv.request('ssap://tv/getCurrentChannel').then(applyChannel),
      tv.request('ssap://com.webos.applicationManager/getForegroundAppInfo').then(applyApp),
      tv.request('ssap://audio/getSoundOutput').then(applySound),
      fetchSystemInfo(),
      fetchApps(),
      fetchInputs()
    ]);
    return { ok: true };
  })()));

  ipcMain.handle('tv:input', (_e, { id }) => {
    if (!tv || !tv.isConnected()) return { ok: false, error: 'Connect to your TV first.' };
    if (/^com\.webos\.app\./.test(id)) return reply(tv.launchApp(id));
    return reply(tv.request('ssap://tv/switchInput', { inputId: id }, 12000));
  });

  ipcMain.handle('tv:settings', () => {
    if (!tv || !tv.isConnected()) return { ok: false, error: 'Connect to your TV first.' };
    return reply((async () => {
      let lastError = null;
      for (const id of ['com.palm.app.settings', 'com.webos.app.settings']) {
        try {
          return await tv.launchApp(id);
        } catch (err) {
          lastError = err;
        }
      }
      const refused = /401|insufficient|permission/i.test(lastError ? lastError.message : '');
      throw new Error(refused
        ? 'This TV does not allow opening its settings remotely. Use the TV remote.'
        : (lastError ? lastError.message : 'Could not open TV settings.'));
    })());
  });

  ipcMain.handle('tv:screen', (_e, { on }) => reply(tv ? (on ? tv.screenOn() : tv.screenOff()) : Promise.reject(new Error('Connect to your TV first.'))));
  ipcMain.handle('tv:power-off', () => reply(tv ? tv.powerOff() : Promise.reject(new Error('Connect to your TV first.'))));

  ipcMain.handle('win:minimize', () => { if (win) win.minimize(); return { ok: true }; });
  ipcMain.handle('win:hide', () => { if (win) win.hide(); return { ok: true }; });
  ipcMain.handle('win:close', () => { if (win) win.close(); return { ok: true }; });
  ipcMain.handle('win:pin', (_e, { value }) => {
    config.alwaysOnTop = !!value;
    saveConfig();
    if (win) win.setAlwaysOnTop(!!value, 'normal');
    rebuildTray();
    sendEvent({ type: 'config', config: publicConfig() });
    return { ok: true, value: config.alwaysOnTop };
  });

  ipcMain.handle('config:set', (_e, { patch }) => {
    const allowed = ['alwaysOnTop', 'launchAtLogin', 'closeToTray', 'autoReconnect', 'sounds', 'mac', 'name'];
    for (const key of allowed) {
      if (!patch || !(key in patch)) continue;
      if (key === 'mac') config.mac = normalizeMac(patch.mac);
      else if (key === 'name') config.name = String(patch.name || '').slice(0, 60);
      else config[key] = !!patch[key];
    }
    saveConfig();
    if (win) win.setAlwaysOnTop(!!config.alwaysOnTop, 'normal');
    if (tv) tv.setAutoReconnect(!!config.autoReconnect);
    if ('launchAtLogin' in (patch || {})) setLoginItem(config.launchAtLogin);
    if ('name' in (patch || {})) {
      tvState.name = config.name || tvState.name;
      pushState(true);
    }
    sendEvent({ type: 'config', config: publicConfig() });
    rebuildTray();
    return { ok: true, config: publicConfig() };
  });
}

// ---------------------------------------------------------------- lifecycle

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    ensureTV();
    registerIpc();
    createWindow();
    createTray();
    // Reconcile the Windows startup entry with the saved setting so a stale
    // "launch at login" entry can never bring the widget back after quitting.
    // Unpackaged runs share a generic Electron key, so only touch it when the
    // option is actually on (or when the app is installed).
    if (app.isPackaged || config.launchAtLogin) setLoginItem(!!config.launchAtLogin);
    globalShortcut.register('Control+Alt+W', () => {
      if (!win) return;
      if (win.isVisible() && win.isFocused()) win.hide();
      else showWindow();
    });
    if (!globalShortcut.isRegistered('Control+Alt+W')) {
      console.warn('[webOS Control Center] Ctrl+Alt+W is already used by another app.');
    }
  });

  app.on('activate', () => {
    if (quitting) return;
    if (!win) createWindow();
    else showWindow();
  });

  app.on('window-all-closed', () => {
    // "Close to tray" keeps the widget alive. Otherwise closing the window
    // really exits, instead of leaving a hidden process behind.
    if (quitting || !config.closeToTray) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    clearTimeout(saveBoundsTimer);
    stopPolling();
    if (tv) tv.disconnect({ silent: true });
    if (tray) {
      try { tray.destroy(); } catch (_) {}
      tray = null;
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

process.on('uncaughtException', (err) => {
  console.error('[webOS Control Center]', err);
});
