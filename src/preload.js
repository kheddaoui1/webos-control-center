'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('webos', {
  init: () => invoke('app:init'),
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('tv:event', handler);
    return () => ipcRenderer.removeListener('tv:event', handler);
  },

  connect: (opts) => invoke('tv:connect', opts),
  disconnect: () => invoke('tv:disconnect'),
  forget: () => invoke('tv:forget'),
  wake: () => invoke('tv:wake'),
  discover: (opts) => invoke('tv:discover', opts),
  refresh: () => invoke('tv:refresh'),

  key: (name) => invoke('tv:key', { name }),
  pointer: (action, dx = 0, dy = 0) => invoke('tv:pointer', { action, dx, dy }),
  media: (action) => invoke('tv:media', { action }),

  volume: (volume) => invoke('tv:volume', { volume }),
  volumeUp: () => invoke('tv:volume-up'),
  volumeDown: () => invoke('tv:volume-down'),
  mute: (mute) => invoke('tv:mute', { mute }),

  channel: (direction) => invoke('tv:channel', { direction }),
  launch: (id, params) => invoke('tv:launch', { id, params }),
  text: (text) => invoke('tv:text', { text }),
  backspace: () => invoke('tv:backspace'),
  enter: () => invoke('tv:enter'),
  tvToast: (message) => invoke('tv:toast', { message }),

  apps: () => invoke('tv:apps'),
  inputs: () => invoke('tv:inputs'),
  setInput: (id) => invoke('tv:input', { id }),
  openSettings: () => invoke('tv:settings'),
  screen: (on) => invoke('tv:screen', { on }),
  powerOff: () => invoke('tv:power-off'),

  pin: (value) => invoke('win:pin', { value }),
  minimize: () => invoke('win:minimize'),
  hide: () => invoke('win:hide'),
  close: () => invoke('win:close'),
  quit: () => invoke('app:quit'),
  openData: () => invoke('app:open-data'),

  setConfig: (patch) => invoke('config:set', { patch })
});
