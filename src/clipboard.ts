import type { Terminal } from "@xterm/xterm";

/** Copy text to the system clipboard. Silently no-ops if the Clipboard API is unavailable. */
export function copyToClipboard(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => {
    // Clipboard API may be blocked (e.g. non-secure context); ignore.
  });
}

/**
 * Read text from the system clipboard and call `onText` with the result.
 * Silently no-ops if the Clipboard API is unavailable or access is denied.
 */
export function pasteFromClipboard(onText: (text: string) => void): void {
  navigator.clipboard
    ?.readText()
    .then((text) => {
      if (text) onText(text);
    })
    .catch(() => {
      // Clipboard API may be blocked (e.g. non-secure context); ignore.
    });
}

export type TerminalClipboardOptions = {
  /**
   * Called with the text the user just pasted via Ctrl/Cmd+V. Provide for
   * interactive terminals (forward to ws / stdin); omit for read-only
   * viewers — pasting will silently no-op there.
   */
  onPaste?: (text: string) => void;
};

/**
 * Wire Ctrl/Cmd+C (copy selection) and Ctrl/Cmd+V (paste) on an xterm.js Terminal.
 *
 * Copy fires only when there is an active selection; otherwise Ctrl+C still
 * sends ETX to the process. Paste forwards via `onPaste` if provided.
 * Shift / Alt modifiers fall through to xterm's default handling.
 */
export function installTerminalClipboard(
  term: Terminal,
  options: TerminalClipboardOptions = {},
): void {
  const { onPaste } = options;

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;

    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey || event.shiftKey) return true;

    const key = event.key.toLowerCase();

    if (key === "c" && term.hasSelection()) {
      const text = term.getSelection();
      if (text) {
        copyToClipboard(text);
      }
      term.clearSelection();
      event.preventDefault();
      return false;
    }

    if (key === "v" && onPaste) {
      pasteFromClipboard(onPaste);
      event.preventDefault();
      return false;
    }

    return true;
  });
}
