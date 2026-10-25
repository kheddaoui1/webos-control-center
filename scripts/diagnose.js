'use strict';

/**
 * Connection diagnostic for the TV.
 *
 *   node scripts/diagnose.js 192.168.1.42
 *
 * Checks TCP reachability, then tries an SSAP registration on both the plain
 * (3000) and TLS (3001) endpoints and prints everything the TV sends back.
 */

const net = require('net');
const WebSocket = require('ws');
const LGTV = require('../src/lib/lgtv');

// Use the exact manifest the app registers with, so the diagnostic reflects
// what the widget itself will be allowed to do.
const PERMISSIONS = LGTV.PERMISSIONS;
const MANIFEST = { manifestVersion: 1, appVersion: '1.0', permissions: PERMISSIONS };

const MINIMAL_MANIFEST = { manifestVersion: 1, appVersion: '1.0', permissions: ['READ_INSTALLED_APPS'] };

function tcp(port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: ip, port });
    const done = (ok, error) => {
      socket.destroy();
      resolve({ port, ok, ms: Date.now() - started, error });
    };
    socket.setTimeout(5000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, err.code || err.message));
  });
}

function probe(url, manifest, clientKey) {
  return new Promise((resolve) => {
    const result = { url, opened: false, messages: [], code: null, reason: '', error: '', outcome: 'pending' };
    let ws;
    let timer;
    const finish = (outcome) => {
      if (result.outcome !== 'pending') return;
      result.outcome = outcome;
      clearTimeout(timer);
      try { ws.terminate(); } catch (_) {}
      resolve(result);
    };

    try {
      ws = new WebSocket(url, { handshakeTimeout: 8000, rejectUnauthorized: false });
    } catch (err) {
      result.error = err.message;
      result.outcome = 'construct-error';
      return resolve(result);
    }

    timer = setTimeout(() => finish('timeout'), 20000);

    ws.on('open', () => {
      result.opened = true;
      const payload = { forcePairing: false, pairingType: 'PROMPT', manifest };
      if (clientKey) payload['client-key'] = clientKey;
      ws.send(JSON.stringify({ id: 'register_0', type: 'register', payload }));
    });

    ws.on('message', (raw) => {
      let text = raw.toString();
      try { text = JSON.stringify(JSON.parse(text)); } catch (_) {}
      result.messages.push(text.slice(0, 400));
      if (text.includes('"type":"registered"')) finish('registered');
    });

    ws.on('error', (err) => {
      result.error = (err.code ? `${err.code}: ` : '') + err.message;
    });

    ws.on('close', (code, reason) => {
      result.code = code;
      result.reason = String(reason || '');
      finish(result.messages.length ? 'closed-after-message' : 'closed-silently');
    });
  });
}

const ip = process.argv[2];
if (!ip) {
  console.error('Usage: node scripts/diagnose.js <tv-ip> [client-key]');
  process.exit(1);
}

/** Reuse the widget's saved pairing key so diagnosing does not re-prompt. */
function savedClientKey() {
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(process.env.APPDATA || '', 'webOS Control Center', 'config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    return config.clientKey || null;
  } catch (_) {
    return null;
  }
}

const savedKey = process.argv[3] || savedClientKey();

/** Opens the control socket, registers, then checks the pointer socket URL. */
function pointerCheck(controlUrl, manifest, clientKey) {
  return new Promise((resolve) => {
    const result = { control: controlUrl, pointerUrl: null, opened: false, error: '', closeCode: null };
    let done = false;
    const ws = new WebSocket(controlUrl, { handshakeTimeout: 8000, rejectUnauthorized: false });
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch (_) {}
      resolve(result);
    };
    const timer = setTimeout(() => { result.error = result.error || 'timeout'; finish(); }, 25000);

    ws.on('open', () => {
      const payload = { forcePairing: false, pairingType: 'PROMPT', manifest };
      if (clientKey) payload['client-key'] = clientKey;
      ws.send(JSON.stringify({ type: 'register', id: 'register_0', payload }));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

      if (msg.type === 'registered') {
        ws.send(JSON.stringify({
          type: 'request', id: 'pointer_1',
          uri: 'ssap://com.webos.service.networkinput/getPointerInputSocket', payload: {}
        }));
      }

      if (msg.id === 'pointer_1') {
        result.pointerUrl = (msg.payload && msg.payload.socketPath) || null;
        if (!result.pointerUrl) {
          result.error = 'The TV did not return a socketPath.';
          return finish();
        }
        const ptr = new WebSocket(result.pointerUrl, { handshakeTimeout: 8000, rejectUnauthorized: false });
        ptr.once('open', () => {
          result.opened = true;
          try { ptr.terminate(); } catch (_) {}
          finish();
        });
        ptr.once('error', (err) => { result.error = err.message; finish(); });
        ptr.once('close', (code) => { result.closeCode = code; if (!result.opened) finish(); });
      }
    });

    ws.on('error', (err) => { result.error = err.message; });
    ws.on('close', (code) => { result.closeCode = code; finish(); });
  });
}

/**
 * Re-registers with the saved key and checks that write commands are permitted.
 * Invalid targets are used so nothing actually changes on screen: a 401 means
 * the permission is missing, any other error means the request was allowed.
 */
function permissionCheck(controlUrl, manifest, clientKey) {
  return new Promise((resolve) => {
    const steps = [
      ['launch apps', 'ssap://system.launcher/launch', { id: 'com.example.missing' }],
      ['switch input', 'ssap://tv/switchInput', { inputId: 'HDMI_MISSING' }],
      ['screen on', 'ssap://com.webos.service.tvpower/power/turnOnScreen', {}]
    ];
    const results = [];
    const ids = new Map();
    let index = 0;
    let done = false;
    let timer;

    const ws = new WebSocket(controlUrl, { handshakeTimeout: 8000, rejectUnauthorized: false });

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch (_) {}
      resolve(results);
    };

    const next = () => {
      if (index >= steps.length) return finish();
      const [label, uri, payload] = steps[index++];
      const id = `perm_${index}`;
      ids.set(id, { label, uri });
      ws.send(JSON.stringify({ type: 'request', id, uri, payload }));
    };

    timer = setTimeout(finish, 20000);

    ws.on('open', () => {
      const payload = { forcePairing: false, pairingType: 'PROMPT', manifest };
      if (clientKey) payload['client-key'] = clientKey;
      ws.send(JSON.stringify({ type: 'register', id: 'register_0', payload }));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (msg.type === 'registered') return next();
      if (msg.id === 'register_0' && msg.type === 'error') {
        results.push({ label: 'register', granted: false, detail: msg.error || 'registration failed' });
        return finish();
      }
      const step = ids.get(msg.id);
      if (!step) return;
      const error = msg.type === 'error' ? (msg.error || 'error') : '';
      results.push({
        label: step.label,
        granted: !/401|insufficient|permission/i.test(error),
        detail: error || 'allowed'
      });
      next();
    });

    ws.on('error', (err) => {
      results.push({ label: 'socket', granted: false, detail: err.message });
      finish();
    });
    ws.on('close', finish);
  });
}

(async () => {
  console.log(`\nTV: ${ip}\n`);

  console.log('TCP ports');
  for (const port of [3000, 3001]) {
    const r = await tcp(port);
    console.log(`  ${port}: ${r.ok ? `open (${r.ms} ms)` : `closed (${r.error})`}`);
  }

  console.log('\nSSAP registration (plain ws:// port 3000)');
  const plain = await probe(`ws://${ip}:3000`, MANIFEST, savedKey);
  console.log(JSON.stringify(plain, null, 2));

  let tls = null;
  if (plain.outcome !== 'registered') {
    console.log('\nSSAP registration (TLS wss:// port 3001)');
    tls = await probe(`wss://${ip}:3001`, MANIFEST, savedKey);
    console.log(JSON.stringify(tls, null, 2));
  }

  if (plain.outcome !== 'registered' && (!tls || tls.outcome !== 'registered')) {
    console.log('\nMinimal manifest retry (plain ws:// port 3000)');
    const minimal = await probe(`ws://${ip}:3000`, MINIMAL_MANIFEST, savedKey);
    console.log(JSON.stringify(minimal, null, 2));
  }

  const good = plain.outcome === 'registered' ? plain : (tls && tls.outcome === 'registered' ? tls : null);
  if (good) {
    const registered = good.messages.map((m) => {
      try { return JSON.parse(m); } catch (_) { return null; }
    }).find((m) => m && m.type === 'registered');
    const key = registered && registered.payload && registered.payload['client-key'];
    console.log(`\nPointer socket check (client-key ${key})`);
    const pointer = await pointerCheck(good.url, MANIFEST, key);
    console.log(JSON.stringify(pointer, null, 2));

    console.log('\nWrite permissions');
    const perms = await permissionCheck(good.url, MANIFEST, key);
    if (!perms.length) {
      console.log('  no answer from the TV');
    } else {
      for (const perm of perms) {
        console.log(`  ${perm.granted ? 'granted' : 'DENIED '} ${perm.label} (${perm.detail})`);
      }
    }
  }

  console.log('');
})().catch((err) => {
  console.error('diagnose failed:', err);
  process.exit(1);
});
