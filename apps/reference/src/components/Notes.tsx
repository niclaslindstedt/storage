// Files: one note per file under notes/, edited with compare-and-swap. When
// another device saved first, the app shows both versions and lets the
// person choose — nothing is ever overwritten silently.

import { useCallback, useEffect, useState } from "react";

import {
  FileConflictError,
  type NamespaceFileInfo,
  type StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage";

import { describeError, useLog } from "../log.tsx";

const DIR = "notes";

export function Notes({ ns }: { ns: StorageNamespace }) {
  const log = useLog();
  const [files, setFiles] = useState<NamespaceFileInfo[]>([]);
  const [open, setOpen] = useState<{ path: string; rev: string } | null>(null);
  const [text, setText] = useState("");
  const [conflict, setConflict] = useState<{
    theirs: string;
    rev: string;
  } | null>(null);
  const [newName, setNewName] = useState("");
  const [history, setHistory] = useState<{ rev: string; createdAt: number }[]>(
    [],
  );
  const [trash, setTrash] = useState<{ fileId: string; path: string }[]>([]);

  const reload = useCallback(async () => {
    try {
      setFiles(await ns.files.list(DIR));
      setTrash(await ns.files.trash());
    } catch (err) {
      log.add("error", describeError(err));
    }
  }, [ns, log]);

  useEffect(() => {
    void reload();
    return ns.watch(() => void reload());
  }, [ns, reload]);

  async function openFile(path: string) {
    const r = await ns.files.readText(path);
    if (!r) return;
    setOpen({ path, rev: r.info.rev });
    setText(r.text);
    setConflict(null);
    setHistory(await ns.files.history(path));
  }

  async function save(force?: { rev: string }) {
    if (!open) return;
    try {
      const info = await ns.files.write(open.path, text, {
        ifRev: force?.rev ?? open.rev,
        mime: "text/markdown",
      });
      setOpen({ path: open.path, rev: info.rev });
      setConflict(null);
      log.add("sync", `saved ${open.path}`);
      setHistory(await ns.files.history(open.path));
      await reload();
    } catch (err) {
      if (err instanceof FileConflictError && err.current) {
        const theirs = await ns.files.readText(open.path);
        setConflict({ theirs: theirs?.text ?? "", rev: err.current.rev });
        log.add("conflict", `${open.path} changed on another device`);
        return;
      }
      log.add("error", describeError(err));
    }
  }

  const readOnly = ns.role === "viewer";
  return (
    <section className="card" aria-label="Notes">
      <h2>Notes</h2>
      <ul className="list" data-testid="note-list">
        {files.map((f) => (
          <li key={f.path}>
            <button
              data-testid="note-item"
              data-path={f.path}
              onClick={() => openFile(f.path)}
            >
              {f.path.slice(DIR.length + 1)}
            </button>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const path = `${DIR}/${newName}`;
              const info = await ns.files.write(path, "", {
                ifAbsent: true,
                mime: "text/markdown",
              });
              setNewName("");
              await reload();
              setOpen({ path, rev: info.rev });
              setText("");
            } catch (err) {
              log.add("error", describeError(err));
            }
          }}
        >
          <input
            data-testid="note-new-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="new-note.md"
          />
          <button data-testid="note-create" disabled={!newName.trim()}>
            New note
          </button>
        </form>
      )}
      {open && (
        <div className="editor">
          <h3 data-testid="note-open-path">{open.path}</h3>
          <textarea
            data-testid="note-text"
            rows={6}
            value={text}
            readOnly={readOnly}
            onChange={(e) => setText(e.target.value)}
          />
          {!readOnly && (
            <div className="row">
              <button data-testid="note-save" onClick={() => save()}>
                Save
              </button>
              <button
                data-testid="note-delete"
                onClick={async () => {
                  await ns.files.delete(open.path);
                  setOpen(null);
                  await reload();
                }}
              >
                Delete
              </button>
            </div>
          )}
          {conflict && (
            <div className="conflict" data-testid="note-conflict">
              <p>Another device saved this note first. Theirs:</p>
              <pre data-testid="note-theirs">{conflict.theirs}</pre>
              <button
                data-testid="conflict-keep-mine"
                onClick={() => save({ rev: conflict.rev })}
              >
                Keep mine
              </button>
              <button
                data-testid="conflict-use-theirs"
                onClick={() => {
                  setText(conflict.theirs);
                  setOpen({ path: open.path, rev: conflict.rev });
                  setConflict(null);
                }}
              >
                Use theirs
              </button>
            </div>
          )}
          <details>
            <summary>History ({history.length})</summary>
            <ul className="list" data-testid="note-history">
              {history.map((h) => (
                <li key={h.rev}>
                  {new Date(h.createdAt).toLocaleTimeString()}
                  {!readOnly && (
                    <button
                      data-testid="note-restore"
                      onClick={async () => {
                        await ns.files.restore(open.path, h.rev);
                        await openFile(open.path);
                      }}
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {trash.length > 0 && (
        <details>
          <summary>Trash ({trash.length})</summary>
          <ul className="list" data-testid="trash-list">
            {trash.map((t) => (
              <li key={t.fileId}>
                {t.path}
                <button
                  data-testid="trash-restore"
                  onClick={async () => {
                    await ns.files.restoreTrash(t.fileId);
                    await reload();
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
