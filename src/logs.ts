import { format } from "node:util";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  message: string;
}

type Listener = (entry: LogEntry) => void;

const MAX_ENTRIES = 1000;
const MAX_MESSAGE_LENGTH = 4000;

let entries: LogEntry[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

export function addLog(level: LogLevel, message: string): LogEntry {
  const entry: LogEntry = {
    id: nextId++,
    time: Date.now(),
    level,
    message:
      message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}… (truncated)` : message,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // A broken listener (e.g. a closed stream) must not break logging.
    }
  }
  return entry;
}

/** Entries with id > afterId, oldest first, at most `limit` of the newest. */
export function getLogs(afterId = 0, limit = MAX_ENTRIES): LogEntry[] {
  const newer = entries.filter((e) => e.id > afterId);
  return newer.slice(-limit);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let installed = false;

/**
 * Mirrors console.log/info/warn/error into the log buffer so the dashboard can
 * show them. Output still goes to stdout/stderr as before.
 */
export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;

  const wrap = (method: "log" | "info" | "warn" | "error", level: LogLevel) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      addLog(level, format(...args));
    };
  };
  wrap("log", "info");
  wrap("info", "info");
  wrap("warn", "warn");
  wrap("error", "error");
}

export function resetLogs(): void {
  entries = [];
  nextId = 1;
  listeners.clear();
}
