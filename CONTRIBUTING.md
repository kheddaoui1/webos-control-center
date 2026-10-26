# Contributing

Bug reports are the most useful thing you can send. Patches are welcome too.

## Before you open a bug

Include the **TV model** and the **webOS / firmware version** (on the TV: *Settings → All Settings →
General → About This TV*), plus how the TV outputs audio. webOS exposes a different set of commands
per major version, so those three lines usually explain the whole problem.

If you run from source, `npm run diagnose -- <tv-ip>` prints the ports, transports, and permissions
the TV actually grants.

## Running from source

```bat
npm install
npm start          :: uses the %APPDATA%\webOS Control Center Dev profile
npm run preview    :: the same UI in a browser against a mock TV, no Electron
npm run check      :: syntax-check every source file - please run it before a PR
```

Source runs never touch the packaged install's pairing, so you can test without losing your TV setup.

## Style

- Plain HTML, CSS, and JavaScript. No frameworks, no build step, and no runtime dependencies besides
  `ws` - the widget has to start instantly and keep working offline.
- Match the surrounding code: two-space indent, single quotes, small functions, no semicolons-only
  cleverness.
- Animate with the existing CSS variables and respect `prefers-reduced-motion`; Windows' *Reduce
  motion* setting is a hard requirement, not a nicety.
- Every command should fail quietly. A dead TV must never leave the widget stuck on a spinner.

## Pull requests

- Keep the diff focused: one fix or feature per PR.
- Say which TV model and webOS version you tested on. "Works on my C1 / webOS 6.2.1" is enough.
- If you touch pairing, subscriptions, or power, mention what you did to confirm the TV actually
  received it - these three areas are where silent failures hide.

MIT licensed. By contributing you agree your work ships under the same license.
