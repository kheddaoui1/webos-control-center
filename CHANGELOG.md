# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

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
