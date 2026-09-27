// An in-page event log — what happened, in order — so a test (or a person)
// can see sync, conflicts and errors without devtools. Writing uses a stable
// function (its own context) so effects can log without re-running.

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type Kind = "info" | "error" | "sync" | "conflict";
type Entry = { id: number; at: string; kind: Kind; text: string };
type Log = { add(kind: Kind, text: string): void };

const WriteContext = createContext<Log>({ add: () => {} });
const EntriesContext = createContext<Entry[]>([]);
let seq = 0;

export function LogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const add = useCallback((kind: Kind, text: string) => {
    setEntries((e) => [
      ...e.slice(-199),
      { id: ++seq, at: new Date().toISOString().slice(11, 19), kind, text },
    ]);
  }, []);
  const [writer] = useState<Log>(() => ({ add: (k, t) => add(k, t) }));
  return (
    <WriteContext.Provider value={writer}>
      <EntriesContext.Provider value={entries}>
        {children}
      </EntriesContext.Provider>
    </WriteContext.Provider>
  );
}

export function useLog(): Log {
  return useContext(WriteContext);
}

export function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export function LogPanel() {
  const entries = useContext(EntriesContext);
  return (
    <section className="card log" aria-label="Event log">
      <h2>Event log</h2>
      <ol data-testid="log">
        {entries.map((e) => (
          <li key={e.id} data-testid="log-entry" data-kind={e.kind}>
            <time>{e.at}</time>{" "}
            <span className={`kind ${e.kind}`}>{e.kind}</span> {e.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
