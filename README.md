# @tokimo/terminal

React WebTerminal component backed by a WebSocket PTY session. Uses xterm.js v6 with fit, web-links, and search addons.

## Features

- WebSocket PTY with session persistence via `sessionStorage`
- Binary + text message handling
- Ctrl/Cmd+C copy / Ctrl/Cmd+V paste integration
- 12 built-in themes (dark, dracula, one-dark, nord, catppuccin-mocha, and more)
- Host-injected i18n via the `t` prop

## Installation

```bash
pnpm add @tokimo/terminal @xterm/xterm @xterm/addon-fit @xterm/addon-web-links @xterm/addon-search
```

## Usage

```tsx
import { WebTerminal } from "@tokimo/terminal";
import { useTranslation } from "react-i18next";
import type { WebTerminalI18nKey } from "@tokimo/terminal";

const TERMINAL_KEYS: Record<WebTerminalI18nKey, string> = {
  connected: "terminal.connected",
  connecting: "terminal.connecting",
  connectFailed: "terminal.connectFailed",
  disconnected: "terminal.disconnected",
  disconnectedStatus: "terminal.disconnectedStatus",
};

function MyTerminal() {
  const { t } = useTranslation();
  return (
    <WebTerminal
      wsUrl="ws://localhost:5678/api/terminal/ws"
      sessionStorageKey="my-terminal"
      t={(key) => t(TERMINAL_KEYS[key])}
      onConnect={() => console.log("connected")}
      onDisconnect={() => console.log("disconnected")}
    />
  );
}
```

### Without i18n (English fallback)

```tsx
<WebTerminal wsUrl="ws://localhost:5678/api/terminal/ws" />
```

## Theming

```tsx
import { TERMINAL_THEMES, getTerminalTheme } from "@tokimo/terminal";

// List all themes
console.log(TERMINAL_THEMES.map((t) => t.id));

// Get xterm.js ITheme for use with Terminal options
const theme = getTerminalTheme("catppuccin-mocha", "dark");
```

## Clipboard helpers

```tsx
import { copyToClipboard, pasteFromClipboard } from "@tokimo/terminal";

copyToClipboard("hello");
pasteFromClipboard((text) => console.log("pasted:", text));
```
