/**
 * Interactive web terminal backed by a WebSocket PTY session on the Rust server.
 * Uses xterm.js v6 with fit/web-links addons.
 *
 * Session persistence: the backend keeps the PTY alive across WS disconnects.
 * The session_id is stored in sessionStorage so page refreshes reconnect to
 * the same shell with scrollback replay.
 */

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import React, { useEffect, useRef, useState } from "react";
import { installTerminalClipboard } from "./clipboard.js";

const DEFAULT_SESSION_KEY = "tokimo-terminal-session-id";

/** i18n keys exposed by WebTerminal. Host injects a translator via the `t` prop. */
export type WebTerminalI18nKey =
  | "connected"
  | "connecting"
  | "connectFailed"
  | "disconnected"
  | "disconnectedStatus";

const FALLBACK_STRINGS: Record<WebTerminalI18nKey, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  connectFailed: "Connection failed",
  disconnected: "Terminal disconnected.",
  disconnectedStatus: "Disconnected",
};

export interface WebTerminalProps {
  /** WebSocket URL for the PTY endpoint */
  wsUrl: string;
  /** Remove border/rounded corners for embedding. Default: false */
  borderless?: boolean;
  /**
   * sessionStorage key for the server-assigned session id.
   * Defaults to a shared key — pass a unique value when embedding multiple terminals.
   */
  sessionStorageKey?: string;
  /** Called when the WebSocket connection is established. */
  onConnect?: () => void;
  /** Called when the WebSocket connection closes. */
  onDisconnect?: () => void;
  /**
   * i18n hook — host injects a translator.
   * Optional; falls back to English strings when omitted.
   */
  t?: (key: WebTerminalI18nKey) => string;
  /** CSS height. Default: 100% */
  height?: string;
  /** Minimum height in px. Default: 300 */
  minHeight?: number;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export function WebTerminal({
  wsUrl,
  borderless = false,
  sessionStorageKey = DEFAULT_SESSION_KEY,
  onConnect,
  onDisconnect,
  t,
  height = "100%",
  minHeight = 300,
}: WebTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  // Refs keep latest callbacks/translator so the WebSocket effect closure always
  // uses fresh values without needing them in the dependency array.
  const tRef = useRef(t);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  tRef.current = t;
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

  const translate = (key: WebTerminalI18nKey): string =>
    t ? t(key) : FALLBACK_STRINGS[key];

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let ws: WebSocket | null = null;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        allowTransparency: true,
        theme: {
          background: "rgba(0, 0, 0, 0)",
          foreground: "#e4e4e7",
          cursor: "#a1a1aa",
          cursorAccent: "#09090b",
          selectionBackground: "#3f3f46",
          black: "#18181b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#e4e4e7",
          brightBlack: "#71717a",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
        },
        fontSize: 14,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        lineHeight: 1.3,
        scrollback: 10000,
        cursorBlink: true,
        cursorStyle: "block",
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(
        new WebLinksAddon((_event, uri) => {
          window.open(uri, "_blank", "noopener,noreferrer");
        }),
      );

      term.open(containerRef.current);

      requestAnimationFrame(() => {
        if (!disposed) {
          try {
            fitAddon.fit();
          } catch {
            // container may not have dimensions yet
          }
        }
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      installTerminalClipboard(term, {
        onPaste: (text) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode(text));
          }
        },
      });

      // ── WebSocket connection ──────────────────────────────────────────
      const savedSession = sessionStorage.getItem(sessionStorageKey);
      const urlHasSessionId = /[?&]session_id=/.test(wsUrl);
      const connectUrl = savedSession && !urlHasSessionId
        ? `${wsUrl}${wsUrl.includes("?") ? "&" : "?"}session_id=${encodeURIComponent(savedSession)}`
        : wsUrl;

      ws = new WebSocket(connectUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setStatus("connected");
        sendResize(ws!, term.cols, term.rows);
        term.focus();
        onConnectRef.current?.();
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (disposed) return;
        if (typeof ev.data === "string") {
          // Control message: \x02 prefix = session_id assignment
          if (ev.data.startsWith("\x02")) {
            const sid = ev.data.slice(1);
            sessionStorage.setItem(sessionStorageKey, sid);
            return;
          }
          term.write(ev.data);
        } else if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("disconnected");
        // Use the injected translator so the disconnected message respects the host's locale
        const msg = tRef.current
          ? tRef.current("disconnected")
          : FALLBACK_STRINGS.disconnected;
        term.write(`\r\n\x1b[33m${msg}\x1b[0m\r\n`);
        onDisconnectRef.current?.();
      };

      ws.onerror = () => {
        if (disposed) return;
        setStatus("error");
      };

      // Terminal input → WebSocket
      term.onData((data: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data));
        }
      });

      term.onBinary((data: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          const buf = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) {
            buf[i] = data.charCodeAt(i);
          }
          ws.send(buf);
        }
      });

      term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          sendResize(ws, cols, rows);
        }
      });

      const ro = new ResizeObserver(() => {
        if (!disposed) {
          try {
            fitAddon.fit();
          } catch {
            // ignore
          }
        }
      });
      ro.observe(containerRef.current!);
      roRef.current = ro;
    };

    void init();

    return () => {
      disposed = true;
      roRef.current?.disconnect();
      roRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [wsUrl, sessionStorageKey]);

  const statusLabel =
    status === "connected"
      ? translate("connected")
      : status === "connecting"
        ? translate("connecting")
        : status === "error"
          ? translate("connectFailed")
          : translate("disconnectedStatus");

  const dotClass =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting"
        ? "bg-yellow-500 animate-pulse"
        : status === "error"
          ? "bg-red-500"
          : "bg-zinc-500";

  return (
    <div className={`relative ${borderless ? "flex h-full flex-col" : ""}`}>
      {!borderless && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
          <span className="text-zinc-400">{statusLabel}</span>
        </div>
      )}
      <div
        ref={containerRef}
        className={`overflow-hidden p-2 [&_.xterm-viewport]:!overflow-y-auto [&_.xterm-viewport]:!bg-transparent [&_.xterm]:!bg-transparent [&_.xterm]:!p-0 ${borderless ? "min-h-0 flex-1" : "rounded-lg border border-zinc-800"}`}
        style={borderless ? undefined : { height, minHeight }}
      />
    </div>
  );
}

function sendResize(ws: WebSocket, cols: number, rows: number): void {
  ws.send(`\x01${JSON.stringify({ cols, rows })}`);
}
