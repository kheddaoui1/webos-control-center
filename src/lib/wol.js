'use strict';

const dgram = require('dgram');
const os = require('os');
const { execFile } = require('child_process');

function normalizeMac(input) {
  if (!input) return '';
  const hex = String(input).replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 12) return '';
  return hex.match(/.{2}/g).join(':');
}

function magicPacket(mac) {
  const normalized = normalizeMac(mac);
  if (!normalized) return null;
  const bytes = Buffer.from(normalized.replace(/:/g, ''), 'hex');
  const packet = Buffer.alloc(6 + 16 * bytes.length, 0xff);
  for (let i = 0; i < 16; i++) bytes.copy(packet, 6 + i * bytes.length);
  return packet;
}

function broadcastAddresses(ip) {
  const list = ['255.255.255.255'];
  if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    list.push(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
  }
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const parts = info.address.split('.');
      if (parts.length === 4) list.push(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
    }
  }
  return Array.from(new Set(list));
}

function sendPacket(packet, host, port) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (_) {}
      resolve();
    };
    socket.on('error', finish);
    socket.bind(() => {
      try { socket.setBroadcast(true); } catch (_) {}
      try {
        socket.send(packet, 0, packet.length, port, host, finish);
      } catch (_) {
        finish();
      }
    });
    setTimeout(finish, 400);
  });
}

/** Sends the Wake-on-LAN magic packet a few times to every plausible broadcast address. */
async function wakeTV(mac, ip) {
  const packet = magicPacket(mac);
  if (!packet) throw new Error('That MAC address is not valid.');
  const targets = broadcastAddresses(ip);
  for (let round = 0; round < 3; round++) {
    await Promise.all(targets.flatMap((host) => [sendPacket(packet, host, 9), sendPacket(packet, host, 7)]));
    await new Promise((r) => setTimeout(r, 180));
  }
  return { mac: normalizeMac(mac), targets };
}

function arpLookup(ip) {
  return new Promise((resolve) => {
    execFile('arp', ['-a', ip], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve('');
        return;
      }
      const escaped = ip.replace(/\./g, '\\.');
      const line = stdout.split(/\r?\n/).find((l) => new RegExp(`\\b${escaped}\\b`).test(l)) || '';
      const match = /([0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2})/i.exec(line);
      resolve(match ? normalizeMac(match[1]) : '');
    });
  });
}

function ping(ip) {
  return new Promise((resolve) => {
    execFile('ping', ['-n', '1', '-w', '700', ip], { windowsHide: true, timeout: 2500 }, () => resolve());
  });
}

/** The TV's MAC from the Windows ARP table (pings first so the entry exists). */
async function macFromArp(ip) {
  if (!ip) return '';
  let mac = await arpLookup(ip);
  if (mac) return mac;
  await ping(ip);
  await new Promise((r) => setTimeout(r, 350));
  mac = await arpLookup(ip);
  return mac;
}

module.exports = { normalizeMac, magicPacket, wakeTV, macFromArp, broadcastAddresses };
