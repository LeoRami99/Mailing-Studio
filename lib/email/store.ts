"use client";

import { useCallback, useReducer } from "react";
import type { Block, EmailDoc } from "./types";

/** Ubicación de una lista de bloques: raíz o una columna de un bloque de columnas. */
export interface Target {
  columnsId?: string;
  columnId?: string;
}

export function findList(doc: EmailDoc, t: Target): Block[] | null {
  if (!t.columnsId) return doc.blocks;
  const parent = findBlock(doc, t.columnsId);
  if (!parent || parent.type !== "columns") return null;
  return parent.columns.find((c) => c.id === t.columnId)?.blocks ?? null;
}

export function findBlock(doc: EmailDoc, id: string): Block | null {
  const r = locate(doc, id);
  return r ? r.list[r.index] : null;
}

export function locate(doc: EmailDoc, id: string): { list: Block[]; index: number; target: Target } | null {
  const walk = (list: Block[], target: Target): { list: Block[]; index: number; target: Target } | null => {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.id === id) return { list, index: i, target };
      if (b.type === "columns") {
        for (const c of b.columns) {
          const r = walk(c.blocks, { columnsId: b.id, columnId: c.id });
          if (r) return r;
        }
      }
    }
    return null;
  };
  return walk(doc.blocks, {});
}

interface State {
  doc: EmailDoc;
  past: EmailDoc[];
  future: EmailDoc[];
  lastKey: string | null;
  lastAt: number;
}

type Action =
  | { type: "load"; doc: EmailDoc }
  | { type: "change"; fn: (d: EmailDoc) => void; key?: string }
  | { type: "undo" }
  | { type: "redo" };

const LIMIT = 100;

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "load":
      return { doc: a.doc, past: [], future: [], lastKey: null, lastAt: 0 };
    case "change": {
      const next = structuredClone(state.doc);
      a.fn(next);
      const now = Date.now();
      // Agrupa cambios rápidos sobre el mismo campo (p. ej. escribir) en un solo paso de deshacer.
      const coalesce = a.key && a.key === state.lastKey && now - state.lastAt < 800;
      return {
        doc: next,
        past: coalesce ? state.past : [...state.past.slice(-LIMIT), state.doc],
        future: [],
        lastKey: a.key ?? null,
        lastAt: now,
      };
    }
    case "undo": {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return { doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future], lastKey: null, lastAt: 0 };
    }
    case "redo": {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { doc: next, past: [...state.past, state.doc], future: rest, lastKey: null, lastAt: 0 };
    }
  }
}

export function useEmailStore(initial: EmailDoc) {
  const [state, dispatch] = useReducer(reducer, {
    doc: initial,
    past: [],
    future: [],
    lastKey: null,
    lastAt: 0,
  });
  const change = useCallback((fn: (d: EmailDoc) => void, key?: string) => dispatch({ type: "change", fn, key }), []);
  const load = useCallback((doc: EmailDoc) => dispatch({ type: "load", doc }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  return {
    doc: state.doc,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    change,
    load,
    undo,
    redo,
  };
}

export type EmailStore = ReturnType<typeof useEmailStore>;
