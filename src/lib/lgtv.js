'use strict';

const WebSocket = require('ws');
const { EventEmitter } = require('events');

/**
 * LG webOS second-screen (SSAP) client.
 *
 * Talks to ws://<tv-ip>:3000, registers once (the TV shows a pairing prompt),
 * remembers the client-key it returns, then uses the same socket for requests,
 * subscriptions and the virtual remote (pointer input socket on port 3001).
 */
// webOS 26 (firmware 43.x) rejects the old "com.lge.test" signed manifest and
// silently withholds elevated permissions. The accepted manifest now has no
// `signed` block and lists every permission in the outer block the user
// approves with the on-screen prompt.
const PERMISSIONS = [
  'LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CLOSE', 'TEST_OPEN', 'TEST_PROTECTED',
  'CONTROL_AUDIO', 'CONTROL_DISPLAY', 'CONTROL_INPUT_JOYSTICK',
  'CONTROL_INPUT_MEDIA_RECORDING', 'CONTROL_INPUT_MEDIA_PLAYBACK', 'CONTROL_INPUT_TV',
  'CONTROL_POWER', 'CONTROL_TV_SCREEN', 'READ_APP_STATUS', 'READ_CURRENT_CHANNEL',
  'READ_INPUT_DEVICE_LIST', 'READ_NETWORK_STATE', 'READ_RUNNING_APPS',
  'READ_TV_CHANNEL_LIST', 'WRITE_NOTIFICATION_TOAST', 'READ_POWER_STATE',
  'READ_COUNTRY_INFO', 'READ_SETTINGS', 'CONTROL_INPUT_TEXT',
  'CONTROL_MOUSE_AND_KEYBOARD', 'WRITE_SETTINGS', 'WRITE_NOTIFICATION_ALERT',
  'READ_INSTALLED_APPS', 'READ_UPDATE_INFO'
];

const REGISTER_MANIFEST = {
  manifestVersion: 1,
  appVersion: '1.0',
  permissions: PERMISSIONS
};

// Newer webOS sets only accept the secure endpoint; older ones only expose 3000.
const ENDPOINTS = [
  { scheme: 'wss', port: 3001 },
  { scheme: 'ws', port: 3000 }
];

const BUTTONS = new Set([
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'EXIT', 'HOME', 'MENU', 'INFO',
  'RED', 'GREEN', 'YELLOW', 'BLUE', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'VOLUMEUP', 'VOLUMEDOWN', 'MUTE', 'CHANNELUP', 'CHANNELDOWN',
  'PLAY', 'PAUSE', 'STOP', 'REWIND', 'FASTFORWARD', 'RECORD'
]);

class LGTV extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.ip = null;
    this.clientKey = null;
    this.registered = false;
    this.state = 'idle';
    this.autoReconnect = true;
    this.waking = false;

    this._seq = 0;
    this._pending = new Map();
    this._subUris = new Map();
    this._closing = false;
    this._wakeAttempts = 0;
    this._retryAttempt = 0;
    this._retryTimer = null;
    this._pingTimer = null;
    this._registerTimer = null;
    this._pairingTimer = null;
    this._connectResolve = null;
    this._connectReject = null;
    this._pointer = null;
    this._pointerPromise = null;

    this._endpointIndex = 0;
    this._endpoint = ENDPOINTS[0];
    this._lastSocketError = '';
    this._keyRetryDone = false;
  }

  isConnected() {
    return this.registered && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  setAutoReconnect(on) {
    this.autoReconnect = !!on;
    if (!on) this._clearRetry();
  }

  _setState(state, extra = {}) {
    this.state = state;
    this.emit('status', Object.assign({ state, ip: this.ip }, extra));
  }

  _clearRetry() {
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  _scheduleRetry(reason) {
    if (this._closing || !this.autoReconnect || !this.ip) return;
    if (this.state === 'denied') return;
    if (!this.waking && !this._wasConnected) return;

    this._clearRetry();
    const delay = Math.min(20000, 2000 + this._retryAttempt * 1500);
    this._retryAttempt += 1;
    this._setState('disconnected', { message: reason || 'Reconnecting…' });
    this._retryTimer = setTimeout(() => {
      if (this._closing) return;
      this._retryTimer = null;
      this._open();
    }, delay);
  }

  /** Connects and resolves once the TV has registered this client. */
  connect(ip, clientKey = null) {
    this.disconnect({ silent: true });
    this.ip = ip;
    this.clientKey = clientKey || null;
    this._closing = false;
    this._wasConnected = !!this.waking;
    this._retryAttempt = 0;
    this._wakeAttempts = 0;
    this._endpointIndex = 0;
    this._keyRetryDone = !this.clientKey;
    this._setState('connecting', { pairing: !this.clientKey });

    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;
      this._open();
    });
  }

  _open() {
    this._clearRetry();
    if (!this.ip) return;

    const endpoint = ENDPOINTS[Math.min(this._endpointIndex, ENDPOINTS.length - 1)];
    this._endpoint = endpoint;
    this._setState('connecting', { pairing: !this.clientKey, message: this.waking ? 'Waking your TV…' : '' });

    let ws;
    try {
      ws = new WebSocket(`${endpoint.scheme}://${this.ip}:${endpoint.port}`, {
        handshakeTimeout: 9000,
        perMessageDeflate: false,
        rejectUnauthorized: false
      });
    } catch (err) {
      this._failConnect(err);
      return;
    }
    this.ws = ws;
    this._lastSocketError = '';

    // The TV answers the register message immediately (`response`), before the
    // user even taps Allow. If the first endpoint stays silent it is the wrong
    // transport, so give it a short window and fall back.
    const hasFallback = this._endpointIndex < ENDPOINTS.length - 1;
    this._registerTimer = setTimeout(() => {
      if (this.registered || this._closing) return;
      if (this._tryNextEndpoint()) return;
      this._failConnect(new Error('No answer from the TV. Check that it is on and on the same Wi-Fi.'));
    }, hasFallback ? 15000 : 90000);

    ws.on('open', () => {
      const payload = { forcePairing: false, pairingType: 'PROMPT', manifest: REGISTER_MANIFEST };
      if (this.clientKey) payload['client-key'] = this.clientKey;
      this._registerId = `register_${Date.now()}`;
      try {
        ws.send(JSON.stringify({ id: this._registerId, type: 'register', payload }));
      } catch (err) {
        this._failConnect(err);
        return;
      }
      // A saved key is normally instant; if the TV needs a prompt it shows up now.
      clearTimeout(this._pairingTimer);
      this._pairingTimer = setTimeout(() => {
        if (!this.registered) this._setState('pairing', { pairing: true, message: 'Accept the request on your TV.' });
      }, 2200);
    });

    ws.on('message', (data) => this._onMessage(data));
    ws.on('error', (err) => {
      const message = err && err.message ? err.message : 'Network error';
      this._lastSocketError = message;
      if (this.registered) this.emit('socketError', message);
    });
    ws.on('close', () => this._onClose());
  }

  /** Switches to the next transport after a failed attempt. */
  _tryNextEndpoint() {
    if (this._closing) return false;
    if (this._endpointIndex >= ENDPOINTS.length - 1) return false;
    this._endpointIndex += 1;
    this._clearTimers();
    this._destroySocket();
    this._open();
    return true;
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'registered') {
      const key = msg.payload && msg.payload['client-key'];
      if (key) {
        this.clientKey = key;
        this.emit('clientKey', key);
      }
      this.registered = true;
      this._wasConnected = true;
      this._closing = false;
      this._retryAttempt = 0;
      this._wakeAttempts = 0;
      this.waking = false;
      clearTimeout(this._registerTimer);
      clearTimeout(this._pairingTimer);
      this._startPing();
      this._settleConnect(null);
      this._setState('connected', { name: msg.payload && msg.payload.deviceName });
      this.emit('ready');
      return;
    }

    if (msg.type === 'response') {
      const entry = this._pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        this._pending.delete(msg.id);
        entry.resolve(msg.payload || {});
      }
      return;
    }

    if (msg.type === 'error') {
      const entry = this._pending.get(msg.id);
      const error = new Error(msg.error || (msg.payload && msg.payload.errorText) || 'The TV refused that command.');
      if (entry) {
        clearTimeout(entry.timer);
        this._pending.delete(msg.id);
        entry.reject(error);
      }
      if (msg.id === this._registerId) {
        const denied = /denied|reject|not allowed|pair/i.test(error.message);
        const e = new Error(denied
          ? 'Pairing was declined on the TV. Try again and press Allow on the remote.'
          : `The TV refused the connection: ${error.message}`);
        e.code = denied ? 'PAIRING_REJECTED' : 'REGISTER_FAILED';
        this._failConnect(e);
      }
      return;
    }

    if (msg.type === 'changed') {
      const uri = this._subUris.get(msg.id) || '';
      this.emit('update', uri, msg.payload || {});
    }
  }

  _settleConnect(err) {
    const resolve = this._connectResolve;
    const reject = this._connectReject;
    this._connectResolve = null;
    this._connectReject = null;
    if (err) {
      if (reject) reject(err);
    } else if (resolve) {
      resolve({ ip: this.ip, clientKey: this.clientKey });
    }
  }

  _failConnect(err) {
    clearTimeout(this._registerTimer);
    clearTimeout(this._pairingTimer);
    const rejected = err && err.code === 'PAIRING_REJECTED';
    this._settleConnect(err);
    this._setState(rejected ? 'denied' : 'error', { message: err ? err.message : 'Connection failed.' });
    this._destroySocket();
    if (!rejected) this._scheduleRetry(err ? err.message : 'Reconnecting…');
  }

  _onClose() {
    const wasRegistered = this.registered;
    this.registered = false;
    this._clearTimers();

    for (const [, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('DISCONNECTED'));
    }
    this._pending.clear();
    this._subUris.clear();
    this._closePointer();

    const hadPendingConnect = !!this._connectReject;

    // Reconnects after a successful registration stay on the transport that worked.
    if (hadPendingConnect && !wasRegistered && !this._closing) {
      if (this._tryNextEndpoint()) return;
      // The stored key may have been forgotten by the TV: pair again without it.
      if (this.clientKey && !this._keyRetryDone) {
        this._keyRetryDone = true;
        this.clientKey = null;
        this._endpointIndex = 0;
        this._open();
        return;
      }
    }

    if (hadPendingConnect) this._settleConnect(new Error(this._closeMessage(wasRegistered)));

    this._setState(wasRegistered ? 'disconnected' : 'error', {
      message: wasRegistered ? 'Connection lost.' : this._closeMessage(false)
    });
    this.emit('disconnected', { wasRegistered });

    this._scheduleRetry('Reconnecting…');
  }

  _closeMessage(wasRegistered) {
    if (wasRegistered) return 'The TV closed the connection.';
    const error = this._lastSocketError || '';
    if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT/i.test(error)) {
      return `Could not reach the TV at ${this.ip}. Check that it is on and on the same Wi-Fi.`;
    }
    return 'The TV refused the connection. Turn on "TV On With Mobile" (or "LG Connect Apps" on older sets) and try again.';
  }

  _destroySocket() {
    this._closePointer();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.removeAllListeners(); } catch (_) {}
      try { ws.terminate(); } catch (_) {}
    }
  }

  _closePointer() {
    if (this._pointer) {
      try { this._pointer.close(); } catch (_) {}
      this._pointer = null;
    }
    this._pointerPromise = null;
  }

  _startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try { this.ws.ping(); } catch (_) {}
    }, 25000);
  }

  _clearTimers() {
    clearInterval(this._pingTimer);
    clearTimeout(this._registerTimer);
    clearTimeout(this._pairingTimer);
    this._pingTimer = null;
    this._registerTimer = null;
    this._pairingTimer = null;
  }

  disconnect({ silent = false } = {}) {
    this._closing = true;
    this._clearRetry();
    this._settleConnect(new Error('Disconnected'));
    this._clearTimers();
    for (const [, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('DISCONNECTED'));
    }
    this._pending.clear();
    this._subUris.clear();
    this._destroySocket();
    this.registered = false;
    if (!silent) this._setState('disconnected', { message: 'Disconnected.' });
    this.state = 'disconnected';
  }

  request(uri, payload = {}, timeout = 9000) {
    if (!this.isConnected()) return Promise.reject(new Error('NOT_CONNECTED'));
    const id = `req_${++this._seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`The TV did not answer ${uri.split('/').pop()}.`));
      }, timeout);
      this._pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, type: 'request', uri, payload }));
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  /** Requests a get-style URI and keeps receiving `changed` events for it. */
  subscribe(uri, payload = {}, timeout = 9000) {
    if (!this.isConnected()) return Promise.reject(new Error('NOT_CONNECTED'));
    const id = `sub_${++this._seq}`;
    this._subUris.set(id, uri);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`The TV did not answer ${uri.split('/').pop()}.`));
      }, timeout);
      this._pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, type: 'request', uri, payload }));
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  async _getPointer() {
    if (this._pointer && this._pointer.readyState === WebSocket.OPEN) return this._pointer;
    if (this._pointerPromise) return this._pointerPromise;

    this._pointerPromise = (async () => {
      const res = await this.request('ssap://com.webos.service.networkinput/getPointerInputSocket', {}, 12000);
      if (!res || !res.socketPath) throw new Error('The TV did not provide a remote control socket.');
      let socketPath = res.socketPath;
      // Some sets report the plain endpoint even though they only serve TLS.
      if (this._endpoint && this._endpoint.scheme === 'wss') {
        try {
          const url = new URL(socketPath);
          url.protocol = 'wss:';
          if (url.port === '3000') url.port = '3001';
          socketPath = url.toString();
        } catch (_) {}
      }
      const ws = new WebSocket(socketPath, { handshakeTimeout: 9000, rejectUnauthorized: false });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Remote control socket timed out.')), 10000);
        ws.once('open', () => { clearTimeout(timer); resolve(); });
        ws.once('error', (err) => { clearTimeout(timer); reject(err); });
        ws.once('close', () => { clearTimeout(timer); reject(new Error('Remote control socket closed.')); });
      });
      ws.on('error', () => {});
      ws.on('close', () => { if (this._pointer === ws) this._pointer = null; });
      this._pointer = ws;
      return ws;
    })();

    try {
      return await this._pointerPromise;
    } finally {
      this._pointerPromise = null;
    }
  }

  async _sendPointer(text) {
    const ws = await this._getPointer();
    ws.send(text);
  }

  async button(name) {
    const key = String(name || '').toUpperCase();
    if (!BUTTONS.has(key)) throw new Error(`Unknown key: ${name}`);
    await this._sendPointer(`type:button\nname:${key}\n\n`);
  }

  async pointer(action, dx = 0, dy = 0) {
    if (action === 'click') {
      await this._sendPointer('type:click\n\n');
      return;
    }
    if (action === 'scroll') {
      await this._sendPointer(`type:scroll\ndx:${Math.round(dx)}\ndy:${Math.round(dy)}\n\n`);
      return;
    }
    await this._sendPointer(`type:move\ndx:${Math.round(dx)}\ndy:${Math.round(dy)}\n\n`);
  }

  volume(volume) {
    return this.request('ssap://audio/setVolume', { volume: Math.max(0, Math.min(100, Math.round(volume))) });
  }

  volumeUp() { return this._sendPointer('type:button\nname:VOLUMEUP\n\n'); }
  volumeDown() { return this._sendPointer('type:button\nname:VOLUMEDOWN\n\n'); }
  mute(muted) { return this.request('ssap://audio/setMute', { mute: !!muted }); }

  channel(direction) {
    return this.button(direction === 'up' ? 'CHANNELUP' : 'CHANNELDOWN');
  }

  media(action) {
    const allowed = ['play', 'pause', 'stop', 'rewind', 'fastForward'];
    if (!allowed.includes(action)) return Promise.reject(new Error('Unknown media command'));
    return this.request(`ssap://media.controls/${action}`, {});
  }

  launchApp(id, params) {
    const payload = { id };
    if (params) payload.params = params;
    return this.request('ssap://system.launcher/launch', payload, 12000);
  }

  toast(message) {
    return this.request('ssap://system.notifications/createToast', { message }, 5000);
  }

  insertText(text) {
    return this.request('ssap://com.webos.service.ime/insertText', { text: String(text), replace: 0 });
  }

  deleteText(count = 1) {
    return this.request('ssap://com.webos.service.ime/deleteCharacters', { count });
  }

  enterText() {
    return this.request('ssap://com.webos.service.ime/sendKeyboardEnter', { type: 'enter' });
  }

  screenOff() {
    return this.request('ssap://com.webos.service.tvpower/power/turnOffScreen', {}, 6000);
  }

  screenOn() {
    return this.request('ssap://com.webos.service.tvpower/power/turnOnScreen', {}, 6000);
  }

  async powerOff() {
    try { await this.request('ssap://system/turnOff', {}, 4000); } catch (_) {}
    this._closing = true;
    this.autoReconnect = false;
    this._clearRetry();
    this._destroySocket();
    this.registered = false;
    this._setState('off', { message: 'TV is off.' });
  }

  /** Wake-on-LAN is handled by the caller; this just starts trying to reconnect. */
  startWaking() {
    this.waking = true;
    this._wakeAttempts = 0;
    this.autoReconnect = true;
    this._wasConnected = true;
    this._retryAttempt = 0;
  }
}

module.exports = LGTV;
module.exports.PERMISSIONS = PERMISSIONS;
