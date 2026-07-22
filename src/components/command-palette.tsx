"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export type CommandPaletteItem = {
  href: string;
  label: string;
  keywords?: string;
};

export function CommandPalette({ commands }: { commands: CommandPaletteItem[] }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  const openPalette = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    setQuery("");
    dialog.showModal();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closePalette = useCallback(() => dialogRef.current?.close(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPalette]);

  useEffect(() => {
    closePalette();
  }, [closePalette, pathname]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((command) => `${command.label} ${command.keywords ?? ""}`.toLowerCase().includes(term));
  }, [commands, query]);

  const focusResult = (index: number) => {
    const links = resultsRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-command]");
    if (!links?.length) return;
    links[(index + links.length) % links.length]?.focus();
  };

  return (
    <>
      <button aria-haspopup="dialog" className="command-trigger" onClick={openPalette} type="button">
        <Search aria-hidden="true" size={15} />
        <span>Search</span>
        <kbd>⌘/Ctrl K</kbd>
      </button>
      <dialog aria-labelledby="command-palette-title" className="command-palette" onClick={(event) => { if (event.target === event.currentTarget) closePalette(); }} ref={dialogRef}>
        <div className="command-palette__surface">
          <div className="command-palette__header">
            <Search aria-hidden="true" size={19} />
            <label className="sr-only" htmlFor="command-palette-search">Search this workspace</label>
            <input
              autoComplete="off"
              id="command-palette-search"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusResult(0);
                }
                if (event.key === "Enter" && filtered.length === 1) {
                  event.preventDefault();
                  resultsRef.current?.querySelector<HTMLAnchorElement>("a[data-command]")?.click();
                }
              }}
              placeholder="Search pages and actions…"
              ref={inputRef}
              value={query}
            />
            <button aria-label="Close search" className="icon-button" onClick={closePalette} type="button"><X aria-hidden="true" size={17} /></button>
          </div>
          <h2 className="sr-only" id="command-palette-title">Workspace search</h2>
          <div aria-label="Available pages and actions" className="command-palette__results" ref={resultsRef}>
            {filtered.map((command, index) => (
              <Link
                className="command-palette__result"
                data-command
                href={command.href}
                key={`${command.href}:${command.label}`}
                onClick={closePalette}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") { event.preventDefault(); focusResult(index + 1); }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    if (index === 0) inputRef.current?.focus();
                    else focusResult(index - 1);
                  }
                }}
              >
                <span>{command.label}</span>
                <small>{command.href}</small>
              </Link>
            ))}
            {!filtered.length ? <div className="command-palette__empty">No page or action matches “{query}”.</div> : null}
          </div>
          <footer className="command-palette__footer"><span>↑↓ move</span><span>Enter open</span><span>Esc close</span></footer>
        </div>
      </dialog>
    </>
  );
}
