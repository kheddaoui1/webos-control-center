# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [1.1.0]

Thanks to [@paokkerkir](https://github.com/paokkerkir) for [#2](https://github.com/kheddaoui1/webos-control-center/pull/2),
which contributed the volume step buttons, the AVR readout, and the wake fix.

### Added

- **Volume `−` / `+` buttons** next to the slider, with hold-to-repeat. They send the TV's own
  `VOLUMEUP` / `VOLUMEDOWN` keys, so they also work when a soundbar or AVR owns the volume.
- **AVR readout** — when the TV hands volume to an external amp (ARC, optical, soundbar), the number
  is replaced by `AVR` and the slider is greyed out; mute and `−` / `+` stay usable.

### Fixed

- Subscriptions now send `subscribe: true`. Without it webOS answered once and never pushed
  `changed` events, so volume, channel, foreground app, and sound output only refreshed when the
  window was reopened.
- The Power button now sends Wake-on-LAN when the TV was off at launch. Previously the retry loop
  left the status at `connecting`, so the button only said "Trying to reach your TV…".
- AVR detection also accepts `volumeAdjustable: false`, the field name most webOS versions use.

### Changed

- The fallback poll runs every 5 s (was 12 s) and also refreshes the sound output, for TVs that
  never push subscription updates.

## [1.0.1]

### Fixed

- First run always starts on **Find your TV** and never connects to a TV on its own; the pairing is
  only saved after the TV accepts the prompt.
- A wrong IP, a refused connection, or a declined prompt no longer leaves a half-saved TV behind, and
  a stored IP without a client key no longer triggers an automatic connection.
- **Quit widget** in Settings, the tray menu's **Quit**, and closing the window with **Close to tray**
  off now all exit the process instead of leaving a hidden one behind.
- Launch at login is reconciled on start, so a stale login item is removed when the setting is off.

### Changed

- Running from source uses its own `%APPDATA%\webOS Control Center Dev` profile, so it can never
  inherit or overwrite a packaged install's pairing.

## [1.0.0]

### Added

- Volume, channel, D-pad, Magic Remote pointer, media, and keyboard input over LG's SSAP protocol.
- App list with brand artwork and search, plus Live TV and HDMI input switching.
- Wake-on-LAN, screen off, and power off.
- Always on top, launch at login, close to tray, and the `Ctrl+Alt+W` global hotkey.
- TV discovery over SSDP with a manual IP fallback.
