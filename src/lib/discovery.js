'use strict';

const dgram = require('dgram');
const http = require('http');
const net = require('net');
const os = require('os');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

function searchPacket(searchTarget, mx = 2) {
  return Buffer.from([
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    `MX: ${mx}`,
    `ST: ${searchTarget}`,
    '', ''
  ].join('\r\n'));
}

function ssdpCollect(timeout) {
  return new Promise((resolve) => {
    const found = [];
    let socket;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (_) {
      resolve(found);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { socket.close(); } catch (_) {}
      resolve(found);
    };
    const timer = setTimeout(finish, timeout);

    socket.on('message', (buf, rinfo) => {
      const text = buf.toString('utf8');
      if (!/webos|lg electronics|lge|second-screen/i.test(text) && !/LOCATION/i.test(text)) return;
      const location = (/LOCATION:\s*(.+)/i.exec(text) || [])[1];
      if (!location) return;
      if (found.some((x) => x.ip === rinfo.address)) return;
      found.push({
        ip: rinfo.address,
        location: location.trim(),
        server: ((/SERVER:\s*(.+)/i.exec(text) || [])[1] || '').trim(),
        st: ((/ST:\s*(.+)/i.exec(text) || [])[1] || '').trim()
      });
    });
    socket.on('error', () => finish());
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
      } catch (_) {}
      const targets = [
        'urn:lge-com:service:webos-second-screen:1',
        'urn:schemas-upnp-org:device:MediaRenderer:1',
        'ssdp:all'
      ];
      for (const st of targets) {
        const packet = searchPacket(st);
        for (const host of [SSDP_ADDR, '255.255.255.255']) {
          try { socket.send(packet, 0, packet.length, SSDP_PORT, host); } catch (_) {}
        }
      }
    });
  });
}

function fetchDescription(location, timeout = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let req;
    try {
      req = http.get(location, { timeout }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish({});
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 200000) {
            res.destroy();
            finish({});
          }
        });
        res.on('end', () => {
          const pick = (tag) => {
            const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(body);
            return m ? m[1].trim() : '';
          };
          finish({
            friendlyName: pick('friendlyName'),
            modelName: pick('modelName'),
            modelNumber: pick('modelNumber'),
            manufacturer: pick('manufacturer'),
            udn: pick('UDN')
          });
        });
      });
      req.on('timeout', () => { try { req.destroy(); } catch (_) {} finish({}); });
      req.on('error', () => finish({}));
    } catch (_) {
      finish({});
    }
  });
}

function localSubnets() {
  const result = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (/^169\.254\./.test(info.address)) continue;
      const parts = info.address.split('.').map(Number);
      if (parts.length !== 4) continue;
      result.push({
        adapter: name,
        ip: info.address,
        prefix: `${parts[0]}.${parts[1]}.${parts[2]}`
      });
    }
  }
  return result;
}

function portOpen(host, port = 3000, timeout = 420) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) {}
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try { socket.connect(port, host); } catch (_) { finish(false); }
  });
}

async function scanLocalNetwork(timeout = 480, onProgress) {
  const subnets = localSubnets();
  const open = [];
  const own = new Set(subnets.map((s) => s.ip));

  for (const subnet of subnets.slice(0, 2)) {
    const hosts = [];
    for (let n = 1; n <= 254; n++) {
      const ip = `${subnet.prefix}.${n}`;
      if (!own.has(ip)) hosts.push(ip);
    }
    let index = 0;
    let done = 0;
    const workers = new Array(48).fill(0).map(async () => {
      while (index < hosts.length) {
        const host = hosts[index++];
        const yes = await portOpen(host, 3000, timeout);
        done += 1;
        if (yes) open.push(host);
        if (onProgress && done % 24 === 0) onProgress(done / hosts.length);
      }
    });
    await Promise.all(workers);
  }
  return open;
}

/**
 * Finds LG TVs. SSDP gives names; a light port scan catches TVs whose
 * multicast answers are blocked by the firewall.
 */
async function discoverTVs({ timeout = 3800, scan = true, onProgress } = {}) {
  const found = new Map();
  const ssdp = await ssdpCollect(timeout);

  await Promise.all(ssdp.map(async (entry) => {
    const desc = await fetchDescription(entry.location);
    const name = desc.friendlyName || '';
    const model = desc.modelName || desc.modelNumber || '';
    if (!/lg|webos/i.test(`${name} ${model} ${desc.manufacturer} ${entry.server}`)) {
      if (!/webos|second-screen/i.test(entry.st)) return; // ignore printers, routers, consoles…
    }
    found.set(entry.ip, {
      ip: entry.ip,
      name: name || 'LG webOS TV',
      model,
      source: 'ssdp'
    });
  }));

  if (scan) {
    try {
      const hosts = await scanLocalNetwork(500, onProgress);
      for (const ip of hosts) {
        if (found.has(ip)) continue;
        found.set(ip, { ip, name: 'LG webOS TV', model: '', source: 'scan' });
      }
    } catch (_) {}
  }

  return Array.from(found.values()).sort((a, b) => a.ip.localeCompare(b.ip));
}

module.exports = { discoverTVs, scanLocalNetwork, localSubnets };
