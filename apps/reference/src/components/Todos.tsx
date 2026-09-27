// Rows, live: a RecordStore synced in the background. Two devices editing the
// same list merge per row; toggling on one and renaming on the other both
// survive.

import { useEffect, useMemo, useState } from "react";

import type { StorageNamespace } from "@niclaslindstedt/oss-framework/storage";

import { describeError, useLog } from "../log.tsx";

type Todo = { title: string; done: boolean; updatedAt: number };

export function Todos({ ns }: { ns: StorageNamespace }) {
  const log = useLog();
  const store = useMemo(() => ns.recordStore<Todo>("todos"), [ns]);
  const [, setVersion] = useState(0);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("syncing");

  useEffect(() => {
    const stopListen = store.subscribe(() => setVersion((v) => v + 1));
    const stop = store.live({
      debounceMs: 150,
      onError: (err) => {
        setStatus("error");
        log.add("error", `sync: ${describeError(err)}`);
      },
    });
    const timer = setInterval(() => {
      const pending = store.pending().length;
      setStatus((s) =>
        s === "error" && pending > 0
          ? "error"
          : pending > 0
            ? `pending ${pending}`
            : "synced",
      );
    }, 100);
    return () => {
      stop();
      stopListen();
      clearInterval(timer);
    };
  }, [store, log]);

  const readOnly = ns.role === "viewer";
  const rows = store.entries().sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <section className="card" aria-label="To-do">
      <h2>
        To-do{" "}
        <small className="muted" data-testid="todo-status">
          {status}
        </small>
      </h2>
      <ul className="list" data-testid="todo-list">
        {rows.map(([key, t]) => (
          <li
            key={key}
            data-testid="todo-item"
            data-title={t.title}
            data-done={t.done ? "yes" : "no"}
          >
            <label>
              <input
                type="checkbox"
                data-testid="todo-toggle"
                checked={t.done}
                disabled={readOnly}
                onChange={() =>
                  store.set(key, { ...t, done: !t.done, updatedAt: Date.now() })
                }
              />
              <input
                data-testid="todo-title"
                value={t.title}
                disabled={readOnly}
                onChange={(e) =>
                  store.set(key, {
                    ...t,
                    title: e.target.value,
                    updatedAt: Date.now(),
                  })
                }
              />
            </label>
            {!readOnly && (
              <button
                data-testid="todo-delete"
                onClick={() => store.delete(key)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            store.set(key, { title, done: false, updatedAt: Date.now() });
            setTitle("");
          }}
        >
          <input
            data-testid="todo-new"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New item"
          />
          <button data-testid="todo-add" disabled={!title.trim()}>
            Add
          </button>
        </form>
      )}
    </section>
  );
}
