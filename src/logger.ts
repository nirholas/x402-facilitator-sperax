const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const serialize = (_key: string, value: unknown) => (typeof value === 'bigint' ? value.toString() : value);

/** Structured JSON logs, one line per event, suitable for Cloud Logging and similar sinks. */
export function createLogger(level: LogLevel): Logger {
  const threshold = LEVELS[level];
  const emit = (severity: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[severity] < threshold) return;
    const line = JSON.stringify({ severity: severity.toUpperCase(), time: new Date().toISOString(), msg, ...fields }, serialize);
    (severity === 'error' || severity === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
