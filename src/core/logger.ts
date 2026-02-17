/**
 * Lightweight structured logger for debugging the translation pipeline.
 * Filter by "[JP Helper]" in the browser console to trace the full flow.
 *
 * Usage:
 *   const log = createLogger('Video');
 *   log.info('New video detected', videoId);  // [JP Helper][Video] New video detected abc123 +0ms
 */

let LOG_ENABLED = false;

export function setLogEnabled(enabled: boolean): void {
  LOG_ENABLED = enabled;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(tag: string): Logger {
  let lastTime = Date.now();
  const prefix = `[JP Helper][${tag}]`;

  function elapsed(): string {
    const now = Date.now();
    const delta = now - lastTime;
    lastTime = now;
    return `+${delta}ms`;
  }

  return {
    debug(...args: unknown[]) {
      if (!LOG_ENABLED) return;
      console.debug(prefix, ...args, elapsed());
    },
    info(...args: unknown[]) {
      if (!LOG_ENABLED) return;
      console.info(prefix, ...args, elapsed());
    },
    warn(...args: unknown[]) {
      console.warn(prefix, ...args, elapsed());
    },
    error(...args: unknown[]) {
      console.error(prefix, ...args, elapsed());
    },
  };
}
