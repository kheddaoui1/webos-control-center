/* Browser preview mock — only active when the Electron preload API is missing.
   Lets you open index.html in a normal browser to see and test the interface. */
(function () {
  if (window.webos) return;
  document.documentElement.classList.add('preview');

  const listeners = [];
  const config = {
    ip: '192.168.1.42',
    name: 'Living Room OLED',
    mac: 'A8:23:FE:6C:1D:90',
    alwaysOnTop: true,
    launchAtLogin: false,
    closeToTray: true,
    autoReconnect: true,
    sounds: false
  };

  const state = {
    status: 'connected',
    ip: config.ip,
    name: config.name,
    message: '',
    volume: 24,
    muted: false,
    soundOutput: 'tv_speaker',
    channel: { number: '7', name: 'SIC' },
    appId: 'netflix',
    powerState: 'Active',
    info: {
      modelName: 'OLED55C1PUB',
      modelNumber: 'OLED55C1PUB',
      version: '6.2.1',
      firmware: 'webOS 6.0',
      serialNumber: 'DEMO-0001'
    },
    mac: config.mac
  };

  const apps = [
    { id: 'netflix', title: 'Netflix', icon: '' },
    { id: 'youtube.leanback.v4', title: 'YouTube', icon: '' },
    { id: 'amazon', title: 'Prime Video', icon: '' },
    { id: 'com.disney.disneyplus-prod', title: 'Disney+', icon: '' },
    { id: 'com.hbo.hbomax', title: 'Max', icon: '' },
    { id: 'com.apple.appletv', title: 'Apple TV', icon: '' },
    { id: 'spotify-beehive', title: 'Spotify', icon: '' },
    { id: 'cdp-30', title: 'Plex', icon: '' },
    { id: 'tv.twitch.tv.starshot.lg', title: 'Twitch', icon: '' },
    { id: 'hulu', title: 'Hulu', icon: '' },
    { id: 'com.crunchyroll.webapp', title: 'Crunchyroll', icon: '' },
    { id: 'com.webos.app.browser', title: 'Web Browser', icon: '' },
    { id: 'com.webos.app.livetv', title: 'Live TV', icon: '' },
    { id: 'com.webos.app.music', title: 'Music', icon: '' },
    { id: 'com.webos.app.photovideo', title: 'Photos', icon: '' }
  ];

  const inputs = [
    { id: 'HDMI_1', label: 'HDMI 1', connected: true },
    { id: 'HDMI_2', label: 'HDMI 2', connected: true },
    { id: 'HDMI_3', label: 'HDMI 3', connected: false },
    { id: 'HDMI_4', label: 'HDMI 4', connected: false }
  ];

  const emit = (event) => {
    for (const listener of listeners) {
      try { listener(event); } catch (_) {}
    }
  };
  const emitState = () => emit({ type: 'state', state });
  const ok = (data) => Promise.resolve(data === undefined ? { ok: true } : { ok: true, data });
  const fail = (error) => Promise.resolve({ ok: false, error });
  const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

  window.webos = {
    init: async () => {
      setTimeout(() => {
        emit({ type: 'apps', apps, source: 'launchPoints' });
        emit({ type: 'inputs', inputs });
      }, 500);
      return { config, state, version: '1.0.1' };
    },
    onEvent: (callback) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    },

    connect: async (opts) => {
      config.ip = opts.ip;
      if (opts.name) config.name = opts.name;
      state.ip = opts.ip;
      state.name = config.name;
      state.status = 'connecting';
      emitState();
      await delay(700);
      state.status = 'pairing';
      emitState();
      await delay(1800);
      state.status = 'connected';
      state.appId = 'com.webos.app.home';
      emitState();
      emit({ type: 'apps', apps, source: 'launchPoints' });
      emit({ type: 'inputs', inputs });
      return { ok: true };
    },
    disconnect: () => { state.status = 'disconnected'; emitState(); return ok(); },
    forget: async () => {
      config.ip = '';
      config.mac = '';
      config.name = '';
      Object.assign(state, {
        status: 'idle', ip: '', name: 'My TV', appId: '', channel: { number: '', name: '' }, info: {}
      });
      emitState();
      emit({ type: 'forgotten' });
      return { ok: true };
    },
    wake: async () => {
      state.status = 'connecting';
      state.message = 'Waking your TV…';
      emitState();
      await delay(1600);
      state.status = 'connected';
      state.message = '';
      emitState();
      return { ok: true, mac: config.mac };
    },
    discover: async () => {
      await delay(1700);
      return {
        ok: true,
        data: [
          { name: 'Living Room OLED', ip: '192.168.1.42', model: 'OLED55C1PUB' },
          { name: 'Bedroom TV', ip: '192.168.1.87', model: '49SM8600PUA' }
        ]
      };
    },
    refresh: async () => ok(),

    key: async (name) => {
      if (/^[0-9]$/.test(name)) {
        state.channel.number = (state.channel.number || '').slice(-2) + name;
        emitState();
      }
      if (name === 'CHANNELUP') { state.channel.number = String(Number(state.channel.number || 1) + 1); emitState(); }
      if (name === 'CHANNELDOWN') { state.channel.number = String(Math.max(1, Number(state.channel.number || 1) - 1)); emitState(); }
      if (name === 'BACK' && state.appId !== 'com.webos.app.home') { state.appId = 'com.webos.app.home'; emitState(); }
      return ok();
    },
    pointer: async () => ok(),
    media: async () => ok(),

    volume: async (volume) => { state.volume = volume; emitState(); return ok(); },
    volumeUp: async () => { state.volume = Math.min(100, state.volume + 1); emitState(); return ok(); },
    volumeDown: async () => { state.volume = Math.max(0, state.volume - 1); emitState(); return ok(); },
    mute: async (mute) => { state.muted = !!mute; emitState(); return ok(); },

    channel: async (direction) => {
      const current = Number(state.channel.number) || 1;
      state.channel.number = String(direction === 'up' ? current + 1 : Math.max(1, current - 1));
      emitState();
      return ok();
    },
    launch: async (id) => { state.appId = id; emitState(); return ok(); },
    text: async () => ok(),
    backspace: async () => ok(),
    enter: async () => ok(),
    tvToast: async () => ok(),

    apps: async () => { emit({ type: 'apps', apps, source: 'launchPoints' }); return ok(); },
    inputs: async () => { emit({ type: 'inputs', inputs }); return ok(); },
    setInput: async (id) => {
      state.appId = id.startsWith('HDMI') ? `com.webos.app.${id.toLowerCase().replace('_', '')}` : id;
      emitState();
      return ok();
    },
    openSettings: async () => { state.appId = 'com.palm.app.settings'; emitState(); return ok(); },
    screen: async (on) => { state.message = on ? '' : 'Screen off'; emitState(); return ok(); },
    powerOff: async () => { state.status = 'off'; emitState(); return ok(); },

    pin: async () => ok(),
    minimize: async () => ok(),
    hide: async () => ok(),
    app: async () => ok(),
    quit: async () => ok(),
    openData: async () => ok(),
    setConfig: async (patch) => {
      Object.assign(config, patch);
      emit({ type: 'config', config });
      return { ok: true, config };
    }
  };
})();
