"use client";

import { useEffect } from "react";

const AUTOSAVE_DELAY_MS = 1200;

/**
 * Keeps the manager-built rota safe without moving save logic out of the
 * builder. The builder remains the single owner of validation and persistence;
 * this agent simply triggers its existing atomic save after editing settles.
 */
export function RotaAutosaveAgent() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleAutosave = () => {
      if (timer) clearTimeout(timer);

      const root = document.querySelector<HTMLElement>(".nory-rota");
      if (!root) return;

      const hasUnsavedChanges = Boolean(
        root.querySelector(".nory-rota__save-state--dirty"),
      );
      if (!hasUnsavedChanges) return;

      const saveButton = [...root.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Save draft"));
      if (!saveButton || saveButton.disabled) return;

      timer = setTimeout(() => {
        if (!saveButton.isConnected || saveButton.disabled) return;
        saveButton.click();
      }, AUTOSAVE_DELAY_MS);
    };

    const observer = new MutationObserver(scheduleAutosave);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    scheduleAutosave();

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
