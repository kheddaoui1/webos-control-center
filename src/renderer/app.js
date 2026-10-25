'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const api = window.webos;

const SOUND_LABELS = {
  tv_speaker: 'TV speakers',
  external_optical: 'Optical',
  external_arc: 'HDMI ARC',
  external_speaker: 'External speaker',
  soundbar: 'Soundbar',
  bluetooth_sound: 'Bluetooth',
  headphone: 'Headphones',
  tv_external_speaker: 'External speaker'
};

const INPUT_TITLES = {
  'com.webos.app.livetv': 'Live TV',
  'com.webos.app.hdmi1': 'HDMI 1',
  'com.webos.app.hdmi2': 'HDMI 2',
  'com.webos.app.hdmi3': 'HDMI 3',
  'com.webos.app.hdmi4': 'HDMI 4'
};

const UI = {
  state: {
    status: 'idle',
    ip: '',
    name: 'My TV',
    message: '',
    volume: 25,
    muted: false,
    soundOutput: '',
    channel: { number: '', name: '' },
    appId: '',
    info: {},
    mac: ''
  },
  config: {
    ip: '', name: '', mac: '', clientKey: '', paired: false, alwaysOnTop: true,
    launchAtLogin: false, closeToTray: true, autoReconnect: true, sounds: true
  },
  apps: [],
  appSource: '',
  inputs: [],
  tab: 'remote',
  search: '',
  sheet: null,
  setupOpen: false,
  setupStep: 'scan',
  setupIp: '',
  setupAutoScan: false,
  version: '1.0.1',
  sounds: true,
  volDragging: false,
  forgetArmed: false,
  lastToastAt: 0,
  channelEntry: ''
};

let audioCtx = null;
let volumeTimer = null;
let forgetTimer = null;
let lastHoldToast = 0;

// ============================================================ helpers

const isConnected = () => UI.state.status === 'connected';
const hasPairedTV = () => !!(UI.config.clientKey || UI.config.paired);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function appDisplayName(appId) {
  if (!appId) return '';
  if (INPUT_TITLES[appId]) return INPUT_TITLES[appId];
  const installed = UI.apps.find((app) => app.id === appId);
  const brand = brandFor(appId, installed ? installed.title : '');
  if (brand) return brand.name;
  if (installed) return installed.title;
  const tail = appId.split('.').filter(Boolean).pop() || appId;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

function statusText() {
  const s = UI.state.status;
  if (s === 'connected') return UI.state.ip ? `Connected · ${UI.state.ip}` : 'Connected';
  if (s === 'pairing') return 'Press Allow on your TV';
  if (s === 'connecting') return UI.state.message || 'Connecting…';
  if (s === 'off') return 'TV is off · power to wake';
  if (s === 'denied') return 'Pairing was declined';
  if (s === 'error') return UI.state.message || 'Offline';
  if (s === 'disconnected') return UI.state.message || 'Disconnected';
  return 'Set up your TV';
}

function statusKind() {
  if (isConnected()) return 'online';
  if (['connecting', 'pairing'].includes(UI.state.status)) return 'busy';
  if (['error', 'denied'].includes(UI.state.status)) return 'error';
  return '';
}

function currentChannelText() {
  const { number, name } = UI.state.channel || {};
  if (number) return `CH ${number}${name ? ` · ${name}` : ''}`;
  return '';
}

function playClick() {
  if (!UI.sounds) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(560, now + 0.035);
    gain.gain.setValueAtTime(0.028, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } catch (_) {}
}

function toast(message, kind = 'info', duration = 3200) {
  if (!message) return;
  const host = $('#toastHost');
  if (!host) return;
  while (host.children.length >= 3) host.firstElementChild.remove();
  const icons = {
    success: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/></svg>'
  };
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icons[kind] || icons.info}<span></span>`;
  el.querySelector('span').textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, duration);
}

function setPressed(name) {
  const button = $(`.dpad-arrow[data-key="${name}"]`) || $(`[data-key="${name}"]`);
  if (!button) return;
  button.classList.add('pressed');
  setTimeout(() => button.classList.remove('pressed'), 150);
}

function requireTV() {
  if (isConnected()) return true;
  const now = Date.now();
  if (now - UI.lastToastAt > 1600) {
    UI.lastToastAt = now;
    if (UI.state.status === 'off') toast('Your TV is off. Press Power to wake it.', 'info');
    else if (['connecting', 'pairing'].includes(UI.state.status)) toast('Still connecting to your TV…', 'info');
    else toast('Connect to your TV first.', 'info');
  }
  return false;
}

// ============================================================ rendering

function renderAll() {
  renderStatus();
  renderRemote();
  renderApps();
  renderSettings();
  renderInputGrid();
}

function renderStatus() {
  const panel = $('#panel');
  const name = UI.config.name || UI.state.name || UI.state.info?.modelName || 'My TV';
  $('#tvName').textContent = name;
  $('#statusText').textContent = statusText();
  const dot = $('#statusDot');
  dot.className = `status-dot ${statusKind()}`.trim();
  panel.classList.toggle('is-offline', !isConnected());

  $('#pinBtn').classList.toggle('pinned', !!UI.config.alwaysOnTop);
  $('#pinBtn').title = UI.config.alwaysOnTop ? 'Always on top: on' : 'Always on top: off';

  const wake = !isConnected() && ['off', 'idle', 'error', 'disconnected'].includes(UI.state.status) && !!UI.config.ip;
  const powerBtn = $('#powerBtn');
  powerBtn.classList.toggle('wake', wake);
  $('#powerLabel').textContent = isConnected() ? 'Power' : (wake ? 'Wake' : 'Power');
}

function renderRemote() {
  const volume = clamp(Math.round(Number(UI.state.volume) || 0), 0, 100);
  const volNum = $('#volNum');
  volNum.textContent = String(volume);
  volNum.classList.toggle('muted', !!UI.state.muted);
  $('#volSlider').style.setProperty('--p', String(volume));
  if (!UI.volDragging) $('#volSlider').value = String(volume);
  $('#muteBtn').classList.toggle('muted', !!UI.state.muted);
  $('#muteBtn').setAttribute('aria-label', UI.state.muted ? 'Unmute' : 'Mute');

  const channel = UI.state.channel || {};
  $('#chNum').textContent = channel.number || '—';

  const appName = appDisplayName(UI.state.appId);
  const nowApp = $('#nowApp');
  const nowMeta = $('#nowMeta');
  const pulse = $('#nowPulse');
  if (isConnected()) {
    nowApp.textContent = appName || 'Home';
    nowMeta.textContent = nowMetaText();
    pulse.classList.remove('idle');
  } else {
    nowApp.textContent = ['connecting', 'pairing'].includes(UI.state.status) ? 'Connecting to your TV…' : 'Ready when you are';
    nowMeta.textContent = UI.config.ip || 'Set up your TV';
    pulse.classList.add('idle');
  }

  const activeInput = UI.state.appId && UI.state.appId.startsWith('com.webos.app.hdmi')
    ? UI.state.appId
    : (UI.state.appId === 'com.webos.app.livetv' ? 'com.webos.app.livetv' : '');
  $$('.input-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.input === activeInput));
}

function soundLabel() {
  const key = UI.state.soundOutput;
  if (!key) return 'Unknown';
  return SOUND_LABELS[key] || key.replace(/_/g, ' ');
}

function nowMetaText() {
  const appId = UI.state.appId || '';
  if (appId.startsWith('com.webos.app.hdmi')) return UI.state.soundOutput ? soundLabel() : 'Input';
  if (!appId || appId === 'com.webos.app.livetv') {
    return currentChannelText() || (UI.state.soundOutput ? soundLabel() : 'Connected');
  }
  return UI.state.soundOutput ? soundLabel() : 'Connected';
}

function renderSettings() {
  const info = UI.state.info || {};
  $('#infoModel').textContent = info.modelName || info.modelNumber || '—';
  const version = info.version || info.firmware || '';
  $('#infoVersion').textContent = version || '—';
  const versionRow = $('#infoVersion').closest('.kv');
  if (versionRow) versionRow.style.display = version ? '' : 'none';
  $('#infoIp').textContent = UI.config.ip || '—';
  $('#infoMac').textContent = UI.config.mac || UI.state.mac || '—';
  $('#soundOutput').textContent = soundLabel();

  const macInput = $('#macInput');
  if (macInput && document.activeElement !== macInput) {
    macInput.value = UI.config.mac || UI.state.mac || '';
  }

  $$('.toggle-row').forEach((row) => {
    const key = row.dataset.toggle;
    const value = !!UI.config[key];
    row.setAttribute('aria-checked', String(value));
  });
}

function renderInputGrid() {
  const grid = $('#inputGrid');
  if (!grid) return;
  const inputs = inputList();
  const activeInput = UI.state.appId || '';
  grid.innerHTML = inputs.map((input) => {
    const isTv = input.id === 'com.webos.app.livetv';
    const active = input.id === activeInput || (isTv && activeInput === 'com.webos.app.livetv');
    const icon = isTv
      ? '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12.5" rx="2.5"/><path d="M8 3l4 3 4-3M8.5 21h7"/></svg>'
      : '<svg viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/></svg>';
    return `<button class="input-chip ${active ? 'active' : ''}" data-input="${input.id}">
      ${icon}
      <span>${escapeHtml(input.label || INPUT_TITLES[input.id] || input.id)}</span>
      <span class="conn-dot ${input.connected === false ? 'off' : ''}"></span>
    </button>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function inputList() {
  const list = [{ id: 'com.webos.app.livetv', label: 'Live TV', connected: true }];
  for (const input of UI.inputs) {
    if (input.id === 'com.webos.app.livetv') continue;
    list.push(input);
  }
  return list;
}

// ============================================================ commands

function sendKey(name, opts = {}) {
  if (!requireTV()) return;
  if (!opts.silent) playClick();
  api.key(name).then((res) => {
    if (!res || !res.ok) {
      if (res && res.error && res.error !== 'NOT_CONNECTED') toast(res.error, 'error');
    }
  });
}

function sendMedia(action) {
  if (!requireTV()) return;
  playClick();
  api.media(action).then((res) => {
    if (!res.ok) toast(res.error || 'Media command failed.', 'error');
  });
}

function sendChannel(direction) {
  if (!requireTV()) return;
  playClick();
  setPressed(direction === 'up' ? 'CHANNELUP' : 'CHANNELDOWN');
  api.channel(direction).then((res) => {
    if (!res.ok) toast(res.error || 'Channel change failed.', 'error');
  });
}

function setVolume(value, immediate = false) {
  const volume = clamp(Math.round(Number(value) || 0), 0, 100);
  UI.state.volume = volume;
  if (UI.state.muted) UI.state.muted = false;
  const slider = $('#volSlider');
  slider.value = String(volume);
  slider.style.setProperty('--p', String(volume));
  $('#volNum').textContent = String(volume);
  $('#volNum').classList.remove('muted');
  $('#muteBtn').classList.remove('muted');
  clearTimeout(volumeTimer);
  if (immediate) {
    if (!requireTV()) return;
    api.volume(volume).then((res) => {
      if (!res.ok) toast(res.error || 'Could not change volume.', 'error');
    });
    return;
  }
  volumeTimer = setTimeout(() => {
    if (!isConnected()) return;
    api.volume(volume).catch(() => {});
  }, 100);
}

function toggleMute() {
  if (!requireTV()) return;
  playClick();
  const next = !UI.state.muted;
  UI.state.muted = next;
  $('#muteBtn').classList.toggle('muted', next);
  $('#volNum').classList.toggle('muted', next);
  api.mute(next).then((res) => {
    if (!res.ok) toast(res.error || 'Could not toggle mute.', 'error');
  });
}

async function handlePower() {
  if (isConnected()) {
    openSheet('power');
    return;
  }
  if (['connecting', 'pairing', 'idle'].includes(UI.state.status)) {
    if (UI.state.status === 'idle' && !UI.config.ip) openSetup();
    else toast('Trying to reach your TV…', 'info');
    return;
  }
  if (UI.config.ip) {
    const res = await api.wake();
    if (!res.ok) {
      toast(res.error || 'Could not wake the TV.', 'error');
      setTab('settings');
      setTimeout(() => $('#wakeBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    } else {
      toast('Wake signal sent — give it a few seconds.', 'success', 4200);
    }
    return;
  }
  openSetup();
}

async function switchInput(id, label) {
  if (!requireTV()) return;
  closeSheets();
  playClick();
  const res = await api.setInput(id);
  if (res.ok) toast(`Switching to ${label || INPUT_TITLES[id] || id}`, 'success', 2200);
  else toast(res.error || 'Could not switch input.', 'error');
}

// ============================================================ tabs

function setTab(name) {
  if (!['remote', 'apps', 'settings'].includes(name)) return;
  UI.tab = name;
  const tabs = $$('.tab');
  const index = tabs.findIndex((tab) => tab.dataset.tab === name);
  tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
  const indicator = $('#tabInd');
  indicator.style.setProperty('--i', String(index));
}

function bindTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      playClick();
      setTab(tab.dataset.tab);
    });
  });
}

// ============================================================ init + events

function onEvent(event) {
  if (!event || !event.type) return;
  switch (event.type) {
    case 'state': {
      const wasConnected = isConnected();
      UI.state = event.state || UI.state;
      renderStatus();
      renderRemote();
      renderSettings();
      renderInputGrid();
      if (!wasConnected && isConnected()) {
        if (UI.setupOpen) closeSetup();
        if (UI.state.appId) setTimeout(renderApps, 0);
      }
      if (!isConnected() && UI.state.status === 'pairing' && !UI.setupOpen) {
        const now = Date.now();
        if (now - UI.lastToastAt > 4000) {
          UI.lastToastAt = now;
          toast('Look at your TV and press Allow to pair.', 'info', 5000);
        }
      }
      break;
    }
    case 'config':
      UI.config = event.config || UI.config;
      UI.sounds = UI.config.sounds !== false;
      applyConfig();
      renderStatus();
      renderSettings();
      renderInputGrid();
      break;
    case 'apps':
      UI.apps = Array.isArray(event.apps) ? event.apps : [];
      UI.appSource = event.source || '';
      renderApps();
      renderRemote();
      break;
    case 'inputs':
      UI.inputs = Array.isArray(event.inputs) ? event.inputs : [];
      renderInputGrid();
      break;
    case 'toast':
      toast(event.message, event.kind || 'info');
      break;
    case 'forgotten':
      UI.apps = [];
      UI.inputs = [];
      break;
    default:
      break;
  }
}

function applyConfig() {
  UI.sounds = UI.config.sounds !== false;
  $('#pinBtn').classList.toggle('pinned', !!UI.config.alwaysOnTop);
  const closeBtn = $('#closeBtn');
  if (closeBtn) {
    const label = UI.config.closeToTray ? 'Hide to tray' : 'Quit';
    closeBtn.title = label;
    closeBtn.setAttribute('aria-label', label);
  }
  $$('.toggle-row').forEach((row) => {
    if (row.dataset.toggle === 'sounds') row.setAttribute('aria-checked', String(UI.sounds));
    else row.setAttribute('aria-checked', String(!!UI.config[row.dataset.toggle]));
  });
  const macInput = $('#macInput');
  if (macInput && document.activeElement !== macInput) {
    macInput.value = UI.config.mac || '';
  }
}

function bindChrome() {
  $('#pinBtn').addEventListener('click', async () => {
    playClick();
    const next = !UI.config.alwaysOnTop;
    UI.config.alwaysOnTop = next;
    renderStatus();
    await api.pin(next);
  });
  $('#minBtn').addEventListener('click', () => { playClick(); api.minimize(); });
  $('#closeBtn').addEventListener('click', () => { playClick(); api.close(); });
  $('#refreshBtn').addEventListener('click', async () => {
    if (!requireTV()) return;
    const button = $('#refreshBtn');
    button.classList.add('spinning');
    playClick();
    const res = await api.refresh();
    button.classList.remove('spinning');
    if (res.ok) toast('Refreshed from TV', 'success', 1800);
    else toast(res.error || 'Refresh failed.', 'error');
  });
}

function bindRemote() {
  // D-pad: press and hold to repeat.
  $$('.dpad-arrow').forEach((button) => {
    let startTimer = null;
    let repeatTimer = null;
    const stop = () => {
      clearTimeout(startTimer);
      clearInterval(repeatTimer);
      startTimer = null;
      repeatTimer = null;
      button.classList.remove('pressed');
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const key = button.dataset.key;
      sendKey(key);
      button.classList.add('pressed');
      startTimer = setTimeout(() => {
        repeatTimer = setInterval(() => sendKey(key, { silent: true }), 115);
      }, 430);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((name) => {
      button.addEventListener(name, stop);
    });
  });

  $$('[data-key]').forEach((button) => {
    if (button.classList.contains('dpad-arrow')) return;
    button.addEventListener('click', () => {
      playClick();
      setPressed(button.dataset.key);
      const key = button.dataset.key;
      if (key === 'CHANNELUP' || key === 'CHANNELDOWN') {
        api.channel(key === 'CHANNELUP' ? 'up' : 'down').then((res) => {
          if (!res.ok) toast(res.error || 'Channel change failed.', 'error');
        });
        return;
      }
      sendKey(key);
    });
  });

  $$('[data-media]').forEach((button) => {
    button.addEventListener('click', () => sendMedia(button.dataset.media));
  });

  const slider = $('#volSlider');
  slider.addEventListener('pointerdown', () => { UI.volDragging = true; });
  window.addEventListener('pointerup', () => { UI.volDragging = false; });
  slider.addEventListener('input', () => setVolume(slider.value));
  slider.addEventListener('change', () => {
    UI.volDragging = false;
    setVolume(slider.value, true);
  });
  slider.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setVolume(Number(slider.value) + (event.key === 'ArrowRight' ? 1 : -1), true);
    }
  });

  $('#muteBtn').addEventListener('click', toggleMute);
  $('#powerBtn').addEventListener('click', handlePower);
  $('#inputsBtn').addEventListener('click', () => openSheet('inputs'));
  $('#quickInputs').addEventListener('click', () => openSheet('inputs'));
  $('#quickKeyboard').addEventListener('click', () => openSheet('keyboard'));
  $('#quickSettings').addEventListener('click', async () => {
    if (!requireTV()) return;
    playClick();
    const res = await api.openSettings();
    if (!res.ok) toast(res.error || 'Could not open TV settings.', 'error');
  });
  $('#quickScreen').addEventListener('click', async () => {
    if (!requireTV()) return;
    playClick();
    const res = await api.screen(false);
    if (res.ok) toast('Screen off — press any key on the remote to wake it.', 'success', 3800);
    else toast(res.error || 'Screen off is not supported on this TV.', 'error');
  });
  $('#chDisplay').addEventListener('click', () => {
    if (!requireTV()) return;
    UI.channelEntry = '';
    $('#chEntry').textContent = '—';
    openSheet('channel');
  });

  // Mouse pad / wheel: the empty area of the D-pad ring acts as a trackpad for the Magic Remote pointer.
  bindTrackpad();
}

function bindTrackpad() {
  const pad = $('#dpad');
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;
  let moved = 0;
  let lastWheelAt = 0;

  pad.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('.dpad-arrow, .dpad-ok')) return;
    if (!isConnected()) return;
    dragging = true;
    moved = 0;
    lastX = startX = event.clientX;
    lastY = startY = event.clientY;
    pad.setPointerCapture(event.pointerId);
  });

  pad.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 2) api.pointer('move', dx * 1.6, dy * 1.6).catch(() => {});
  });

  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    if (moved < 5) {
      api.pointer('click').catch(() => {});
      playClick();
    }
  };

  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', () => { dragging = false; });

  pad.addEventListener('wheel', (event) => {
    if (!isConnected()) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelAt < 55) return;
    lastWheelAt = now;
    const direction = event.deltaY > 0 ? -1 : 1;
    api.pointer('scroll', 0, direction).catch(() => {});
  }, { passive: false });
}

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target && target.closest && target.closest('input, textarea');

    if (event.key === 'Escape') {
      if (UI.sheet) { closeSheets(); event.preventDefault(); return; }
      if (UI.setupOpen) { closeSetup(); event.preventDefault(); return; }
    }

    if (typing) return;
    if (UI.sheet || UI.setupOpen) return;

    if (target && target.closest && target.closest('button') && (event.key === 'Enter' || event.key === ' ')) {
      return;
    }

    const arrows = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT' };
    if (arrows[event.key]) {
      event.preventDefault();
      const key = arrows[event.key];
      setPressed(key);
      sendKey(key);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      setPressed('ENTER');
      sendKey('ENTER');
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      setPressed('BACK');
      sendKey('BACK');
      return;
    }
    if (event.key.toLowerCase() === 'h') { sendKey('HOME'); return; }
    if (event.key.toLowerCase() === 'm') { toggleMute(); return; }
    if (event.key === '+' || event.key === '=') {
      if (!requireTV()) return;
      api.volumeUp().catch(() => {});
      return;
    }
    if (event.key === '-') {
      if (!requireTV()) return;
      api.volumeDown().catch(() => {});
    }
  });
}

// ============================================================ apps

function bindAppIconFallback() {
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!img || img.tagName !== 'IMG' || !img.closest('.app-icon')) return;
    const tile = img.closest('.app-tile');
    const holder = img.closest('.app-icon');
    const nameEl = tile && tile.querySelector('.app-name');
    const title = nameEl ? nameEl.textContent.trim() : '';
    const source = title || (tile && tile.dataset.appId) || '?';
    img.remove();
    const span = document.createElement('span');
    span.className = 'app-initials';
    span.textContent = initialsFor(source, source);
    holder.appendChild(span);
    const hue = hashHue(source);
    holder.style.background = `linear-gradient(145deg, hsl(${hue} 52% 36%), hsl(${(hue + 46) % 360} 55% 20%))`;
  }, true);
}

function renderApps() {
  const grid = $('#appsGrid');
  if (!grid) return;
  const installed = UI.apps.filter((app) =>
    app && app.id && !HIDDEN_APPS.test(app.id) && app.id !== 'com.palm.app.settings'
  );
  const suggested = installed.length === 0;
  const query = UI.search.trim().toLowerCase();

  if (suggested && isConnected() && !UI.appSource) {
    grid.innerHTML = new Array(12).fill(0)
      .map((_, i) => `<div class="app-tile skeleton" style="--i:${i}"><div class="app-icon"></div><div class="app-name"></div></div>`)
      .join('');
    $('#appsEmpty').hidden = true;
    $('#appsSub').textContent = 'Reading your TV…';
    return;
  }

  const base = suggested ? APP_CATALOG.map((app) => ({ ...app, icon: '' })) : installed;
  const filtered = sortApps(base.filter((app) => {
    if (!query) return true;
    return `${app.title || ''} ${app.id || ''}`.toLowerCase().includes(query);
  }));

  const tiles = filtered.map((app, index) => {
    const visual = appVisual(app);
    const style = visual.background ? `style="background:${visual.background}"` : '';
    return `<button class="app-tile" data-app-id="${escapeHtml(app.id)}" style="--i:${index}" title="${escapeHtml(app.title || app.id)}">
      <span class="app-icon" ${style}>${visual.html}</span>
      <span class="app-name">${escapeHtml(visual.title)}</span>
    </button>`;
  });

  if (!query) {
    tiles.push(`<button class="app-tile add" data-add-app="1" style="--i:${tiles.length}" title="Launch a custom app ID">
      <span class="app-icon"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>
      <span class="app-name">Add app</span>
    </button>`);
  }

  grid.innerHTML = tiles.join('');
  $('#appsEmpty').hidden = filtered.length !== 0;
  if (query) $('#appsEmpty').hidden = filtered.length !== 0;

  if (suggested) {
    $('#appsSub').textContent = query
      ? `${filtered.length} matching popular apps`
      : 'Popular apps — tap to launch';
  } else {
    $('#appsSub').textContent = query
      ? `${filtered.length} of ${installed.length} apps`
      : `${installed.length} apps installed`;
  }
}

function bindAppsPanel() {
  const search = $('#appSearch');
  search.addEventListener('input', () => {
    UI.search = search.value;
    $('#searchClear').hidden = !search.value;
    renderApps();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      search.value = '';
      UI.search = '';
      $('#searchClear').hidden = true;
      renderApps();
      search.blur();
    }
  });
  $('#searchClear').addEventListener('click', () => {
    search.value = '';
    UI.search = '';
    $('#searchClear').hidden = true;
    search.focus();
    renderApps();
  });

  $('#appsGrid').addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-app]');
    if (add) {
      openSheet('customApp');
      return;
    }
    const tile = event.target.closest('[data-app-id]');
    if (!tile) return;
    launchApp(tile.dataset.appId);
  });

  $('#appsRefresh').addEventListener('click', async () => {
    if (!requireTV()) return;
    playClick();
    const button = $('#appsRefresh');
    button.classList.add('spinning');
    await api.apps();
    button.classList.remove('spinning');
  });
  $('#addAppBtn').addEventListener('click', () => openSheet('customApp'));
  $('#tvHomeBtn').addEventListener('click', () => {
    if (!requireTV()) return;
    playClick();
    api.key('HOME').catch(() => {});
  });
}

function launchApp(id) {
  if (!requireTV()) return;
  if (!id) return;
  playClick();
  UI.state.appId = id;
  renderRemote();
  api.launch(id).then((res) => {
    if (res.ok) toast(`Opening ${appDisplayName(id)}`, 'success', 1700);
    else toast(res.error || 'Could not launch that app.', 'error');
  });
}

// ============================================================ settings

function bindSettingsPanel() {
  $('#soundSettings').addEventListener('click', async () => {
    if (!requireTV()) return;
    const res = await api.openSettings();
    if (!res.ok) toast(res.error || 'Could not open TV settings.', 'error');
    else toast('Use the D-pad to pick a sound output.', 'info', 3200);
  });

  $('#tvSettingsBtn').addEventListener('click', async () => {
    if (!requireTV()) return;
    const res = await api.openSettings();
    if (!res.ok) toast(res.error || 'Could not open TV settings.', 'error');
  });

  $$('.toggle-row').forEach((row) => {
    row.addEventListener('click', async () => {
      const key = row.dataset.toggle;
      const current = key === 'sounds' ? UI.sounds : !!UI.config[key];
      const next = !current;
      playClick();
      if (key === 'sounds') UI.sounds = next;
      else UI.config[key] = next;
      row.setAttribute('aria-checked', String(next));
      if (key === 'alwaysOnTop') renderStatus();
      const res = await api.setConfig({ [key]: next });
      if (res && !res.ok) {
        UI.config[key] = current;
        row.setAttribute('aria-checked', String(current));
        toast(res.error || 'Could not save that setting.', 'error');
      }
    });
  });

  $('#changeTvBtn').addEventListener('click', () => {
    playClick();
    openSetup('scan');
  });

  $('#quitBtn').addEventListener('click', () => {
    playClick();
    api.quit();
  });

  $('#forgetBtn').addEventListener('click', async () => {
    const button = $('#forgetBtn');
    if (!UI.forgetArmed) {
      UI.forgetArmed = true;
      button.textContent = 'Click again to forget';
      playClick();
      clearTimeout(forgetTimer);
      forgetTimer = setTimeout(() => {
        UI.forgetArmed = false;
        button.textContent = 'Forget TV';
      }, 4000);
      return;
    }
    clearTimeout(forgetTimer);
    UI.forgetArmed = false;
    button.textContent = 'Forget TV';
    const res = await api.forget();
    if (!res.ok) {
      toast(res.error || 'Could not forget the TV.', 'error');
      return;
    }
    setTab('remote');
    toast('TV forgotten. Pair again any time.', 'success');
    openSetup('scan');
  });

  $('#saveMacBtn').addEventListener('click', async () => {
    const value = $('#macInput').value.trim();
    const normalized = value.replace(/[^0-9a-f]/gi, '');
    if (value && normalized.length !== 12) {
      toast('A MAC address needs 12 hex characters, e.g. A8:23:FE:11:22:33.', 'error');
      return;
    }
    const formatted = normalized ? normalized.match(/.{2}/g).join(':').toUpperCase() : '';
    const res = await api.setConfig({ mac: formatted });
    if (res.ok) toast(formatted ? 'MAC address saved.' : 'MAC address cleared.', 'success');
    else toast(res.error || 'Could not save the MAC address.', 'error');
  });

  $('#wakeBtn').addEventListener('click', async () => {
    playClick();
    if (isConnected()) {
      toast('The TV is already on.', 'info');
      return;
    }
    const res = await api.wake();
    if (res.ok) {
      toast('Wake signal sent — give it a few seconds.', 'success', 4200);
    } else {
      toast(res.error || 'Could not wake the TV.', 'error');
    }
  });

  $('#screenOffBtn').addEventListener('click', async () => {
    if (!requireTV()) return;
    const res = await api.screen(false);
    if (res.ok) toast('Screen off — press any key on the remote to wake it.', 'success', 3600);
    else toast(res.error || 'Not supported on this TV.', 'error');
  });

  $('#powerOffBtn').addEventListener('click', () => {
    if (!requireTV()) return;
    openSheet('power');
  });

  $('#openDataBtn').addEventListener('click', () => api.openData());

  $('#inputGrid').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-input]');
    if (!chip) return;
    const item = inputList().find((input) => input.id === chip.dataset.input);
    switchInput(chip.dataset.input, item && item.label);
  });
}

// ============================================================ setup

function showSetupStep(step) {
  UI.setupStep = step;
  ['scan', 'pair', 'error'].forEach((name) => {
    const el = $(`#step${name.charAt(0).toUpperCase()}${name.slice(1)}`);
    if (el) el.hidden = name !== step;
  });
}

function openSetup(step = 'scan') {
  UI.setupOpen = true;
  const overlay = $('#setupOverlay');
  overlay.hidden = false;
  showSetupStep(step);
  const ipInput = $('#ipInput');
  if (ipInput && document.activeElement !== ipInput) {
    ipInput.value = UI.config.ip || '';
  }
  if (step === 'scan') scanTVs();
}

function closeSetup() {
  UI.setupOpen = false;
  $('#setupOverlay').hidden = true;
  const radar = $('#radar');
  if (radar) radar.classList.remove('scanning');
}

async function scanTVs() {
  if (UI.scanning) return;
  UI.scanning = true;
  showSetupStep('scan');
  const radar = $('#radar');
  radar.classList.add('scanning');
  $('#rescanBtn').disabled = true;
  $('#tvList').innerHTML = '<div class="scan-line"><span class="spinner"></span>Searching your network…</div>';

  let found = [];
  try {
    const res = await api.discover({ scan: true });
    if (res.ok) found = Array.isArray(res.data) ? res.data : [];
    else toast(res.error || 'Network scan failed.', 'error');
  } catch (_) {
    toast('Network scan failed.', 'error');
  }

  UI.scanning = false;
  radar.classList.remove('scanning');
  $('#rescanBtn').disabled = false;
  renderFoundTVs(found);
}

function renderFoundTVs(tvs) {
  const host = $('#tvList');
  if (!tvs || !tvs.length) {
    host.innerHTML = '<div class="scan-line">No TVs found yet — type the IP below.</div>';
    return;
  }
  host.innerHTML = tvs.map((tv, index) => {
    const name = tv.name && tv.name !== 'LG webOS TV' ? tv.name : 'LG webOS TV';
    return `<button class="tv-item" data-ip="${escapeHtml(tv.ip)}" data-name="${escapeHtml(name)}" style="animation-delay:${index * 45}ms">
      <span class="tv-item-ico"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12.5" rx="2.5"/><path d="M8 3l4 3 4-3M8.5 21h7"/></svg></span>
      <span class="tv-item-txt">
        <span class="tv-item-name">${escapeHtml(name)}</span>
        <span class="tv-item-ip">${escapeHtml(tv.ip)}${tv.model ? ` · ${escapeHtml(tv.model)}` : ''}</span>
      </span>
      <span class="tv-item-go"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
    </button>`;
  }).join('');
}

async function connectTo(ip, name) {
  if (!ip) return;
  UI.setupIp = ip;
  showSetupStep('pair');
  $('#pairText').textContent = `Connecting to ${ip}…`;
  setTimeout(() => {
    if (UI.setupOpen && UI.setupStep === 'pair' && !isConnected()) {
      $('#pairText').textContent = 'Waiting for your TV…';
    }
  }, 2400);

  const res = await api.connect({ ip, name });
  if (res.ok) {
    if (UI.setupOpen) closeSetup();
    return;
  }
  showSetupError(res.error || 'Could not connect to the TV.', ip, !!res.denied);
}

function showSetupError(message, ip, denied) {
  if (!UI.setupOpen) {
    toast(message, 'error', 5000);
    return;
  }
  showSetupStep('error');
  $('#setupErrorTitle').textContent = denied ? 'Pairing declined' : 'Could not connect';
  $('#setupErrorText').textContent = message || 'Check the IP address and try again.';
  $('#setupRetryBtn').dataset.ip = ip || UI.setupIp || '';
  $('#setupRetryBtn').dataset.name = UI.config.name || '';
}

function bindSetup() {
  $('#setupClose').addEventListener('click', () => { playClick(); closeSetup(); });
  $('#pairCancelBtn').addEventListener('click', () => {
    closeSetup();
    toast('Pairing is still pending on your TV.', 'info');
  });
  $('#rescanBtn').addEventListener('click', () => { playClick(); scanTVs(); });

  $('#helpBtn').addEventListener('click', () => {
    const help = $('#setupHelp');
    help.hidden = !help.hidden;
    $('#helpBtn').textContent = help.hidden ? 'Need help?' : 'Hide help';
    playClick();
  });

  $('#ipConnectBtn').addEventListener('click', () => {
    const value = $('#ipInput').value.trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
      showSetupError('Enter the TV IP address like 192.168.1.42.', value, false);
      return;
    }
    playClick();
    connectTo(value, '');
  });

  $('#ipInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('#ipConnectBtn').click();
  });

  $('#setupRetryBtn').addEventListener('click', () => {
    const ip = $('#setupRetryBtn').dataset.ip;
    if (!ip) { showSetupStep('scan'); scanTVs(); return; }
    playClick();
    connectTo(ip, $('#setupRetryBtn').dataset.name || '');
  });

  $('#setupBackBtn').addEventListener('click', () => { playClick(); showSetupStep('scan'); scanTVs(); });

  $('#tvList').addEventListener('click', (event) => {
    const item = event.target.closest('.tv-item');
    if (!item) return;
    playClick();
    connectTo(item.dataset.ip, item.dataset.name || '');
  });
}

// ============================================================ sheets

function openSheet(name) {
  if (['inputs', 'power', 'channel', 'keyboard'].includes(name) && !isConnected()) {
    requireTV();
    return;
  }
  closeSheets();
  UI.sheet = name;
  $('#scrim').hidden = false;
  const sheet = $(`#${name}Sheet`);
  if (!sheet) return;
  sheet.hidden = false;

  if (name === 'inputs') renderInputSheet();
  if (name === 'keyboard') setTimeout(() => $('#tvTextInput').focus(), 80);
  if (name === 'customApp') setTimeout(() => $('#customAppInput').focus(), 80);
  if (name === 'channel') {
    UI.channelEntry = '';
    $('#chEntry').textContent = '—';
  }
}

function closeSheets() {
  const open = $('.sheet:not([hidden])');
  if (open) open.hidden = true;
  $('#scrim').hidden = true;
  UI.sheet = null;
}

function renderInputSheet() {
  const host = $('#inputList');
  const list = inputList();
  host.innerHTML = list.map((input) => {
    const isTv = input.id === 'com.webos.app.livetv';
    const icon = isTv
      ? '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12.5" rx="2.5"/><path d="M8 3l4 3 4-3M8.5 21h7"/></svg>'
      : '<svg viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/></svg>';
    return `<button class="input-row" data-input-id="${escapeHtml(input.id)}" data-input-label="${escapeHtml(input.label || input.id)}">
      <span class="row-ico">${icon}</span>
      <span class="row-txt">
        <span class="row-main">${escapeHtml(input.label || INPUT_TITLES[input.id] || input.id)}</span>
        <span class="row-sub">${input.connected === false ? 'Not detected' : 'Ready'}</span>
      </span>
      <span class="go"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
    </button>`;
  }).join('');
}

function bindSheets() {
  $('#scrim').addEventListener('click', closeSheets);
  $$('.sheet-close').forEach((button) => button.addEventListener('click', () => { playClick(); closeSheets(); }));

  $('#inputList').addEventListener('click', (event) => {
    const row = event.target.closest('[data-input-id]');
    if (!row) return;
    switchInput(row.dataset.inputId, row.dataset.inputLabel);
  });

  $('#confirmPowerOffBtn').addEventListener('click', async () => {
    closeSheets();
    const res = await api.powerOff();
    if (res.ok) toast('TV is turning off.', 'success', 2600);
    else toast(res.error || 'Could not turn the TV off.', 'error');
  });

  // Keyboard
  const tvText = $('#tvTextInput');
  const sendText = async () => {
    const text = tvText.value;
    if (!text) return;
    tvText.value = '';
    const res = await api.text(text);
    if (res.ok) toast('Text sent to the TV.', 'success', 1600);
    else toast(res.error || 'Could not send text.', 'error');
  };
  $('#kbSendBtn').addEventListener('click', sendText);
  tvText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendText();
    }
  });
  $('#kbSpaceBtn').addEventListener('click', async () => {
    playClick();
    const res = await api.text(' ');
    if (!res.ok) toast(res.error || 'Could not send text.', 'error');
  });
  $('#kbBackBtn').addEventListener('click', async () => {
    playClick();
    const res = await api.backspace();
    if (!res.ok) toast(res.error || 'Could not send Backspace.', 'error');
  });
  $('#kbEnterBtn').addEventListener('click', async () => {
    playClick();
    const res = await api.enter();
    if (!res.ok) toast(res.error || 'Could not send Enter.', 'error');
  });

  // Channel keypad
  $('#keypad').addEventListener('click', (event) => {
    const button = event.target.closest('[data-digit]');
    if (!button) return;
    const digit = button.dataset.digit;
    playClick();
    if (digit === 'ok') {
      api.key('ENTER').then((res) => {
        if (!res.ok) toast(res.error || 'Could not send the channel.', 'error');
      });
      closeSheets();
      return;
    }
    if (digit === 'back') {
      UI.channelEntry = UI.channelEntry.slice(0, -1);
      $('#chEntry').textContent = UI.channelEntry || '—';
      api.key('BACK').catch(() => {});
      return;
    }
    if (UI.channelEntry.length >= 4) return;
    UI.channelEntry += digit;
    $('#chEntry').textContent = UI.channelEntry;
    api.key(digit).catch(() => {});
  });

  // Custom app
  const launchCustom = async () => {
    const id = $('#customAppInput').value.trim();
    if (!id) return;
    closeSheets();
    $('#customAppInput').value = '';
    UI.state.appId = id;
    renderRemote();
    const res = await api.launch(id);
    if (res.ok) toast(`Opening ${appDisplayName(id)}`, 'success', 2000);
    else toast(res.error || 'That app ID did not launch.', 'error', 4200);
  };
  $('#customAppLaunchBtn').addEventListener('click', launchCustom);
  $('#customAppInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') launchCustom();
  });
}

// ============================================================ boot

async function init() {
  bindChrome();
  bindRemote();
  bindTabs();
  bindAppsPanel();
  bindSettingsPanel();
  bindSetup();
  bindSheets();
  bindKeyboardShortcuts();
  bindAppIconFallback();

  api.onEvent(onEvent);

  let data = {};
  try {
    data = await api.init();
  } catch (_) {
    data = {};
  }

  UI.config = { ...UI.config, ...(data.config || {}) };
  UI.state = { ...UI.state, ...(data.state || {}) };
  UI.version = data.version || '1.0.1';
  UI.sounds = UI.config.sounds !== false;

  $('#appVersion').textContent = UI.version;
  $('#versionChip').textContent = `v${UI.version}`;
  applyConfig();
  renderAll();

  if (UI.config.ip && hasPairedTV()) {
    const macInput = $('#macInput');
    if (macInput) macInput.value = UI.config.mac || '';
  } else {
    openSetup('scan');
  }

  if (document.documentElement.classList.contains('preview')) {
    window.__preview = { openSetup, closeSetup, setTab, toast, UI, renderApps, renderAll };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

