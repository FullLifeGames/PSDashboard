import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_ENGINE, CONTRIBUTED_ENGINES, SELECTED_ENGINE_KEY, engineIdForUrl, loadAddedEngines, saveAddedEngines,
  type EngineEntry,
} from '../lib/engines/registry';
import { setSelectedEngine } from '../lib/eval/engine-setting';

function readSelectedId(): string {
  try {
    return localStorage.getItem(SELECTED_ENGINE_KEY) ?? BUILTIN_ENGINE.id;
  } catch {
    return BUILTIN_ENGINE.id;
  }
}

function storeSelectedId(id: string): void {
  try {
    localStorage.setItem(SELECTED_ENGINE_KEY, id);
  } catch {
    // Storage blocked: the choice stays for this session.
  }
}

/**
 * Round 77 (user gate 28.10.2026, 4a and 5a): the engines on offer and the one chosen. The worker
 * client reads the choice at every evaluation; a switch drops the evaluation and the game graph of
 * the engine before, whose results stay apart in the cache.
 */
export function useEngineChoice(onSwitch: () => void) {
  const [added, setAdded] = useState(loadAddedEngines);
  const [selectedId, setSelectedId] = useState(readSelectedId);
  const engines = useMemo(() => [BUILTIN_ENGINE, ...CONTRIBUTED_ENGINES, ...added], [added]);
  const selected = engines.find(engine => engine.id === selectedId) ?? BUILTIN_ENGINE;
  useEffect(() => {
    setSelectedEngine(selected);
  }, [selected]);
  const choose = useCallback((engine: EngineEntry) => {
    setSelectedEngine(engine);
    storeSelectedId(engine.id);
    setSelectedId(engine.id);
    onSwitch();
  }, [onSwitch]);
  const select = useCallback((id: string) => choose(engines.find(engine => engine.id === id) ?? BUILTIN_ENGINE), [engines, choose]);
  /** An engine added by address is the one its author wants to try: it is chosen at once. */
  const add = useCallback((name: string, url: string) => {
    const entry: EngineEntry = { id: engineIdForUrl(url), name, url, source: 'added' };
    const next = [...added.filter(engine => engine.id !== entry.id), entry];
    saveAddedEngines(next);
    setAdded(next);
    choose(entry);
  }, [added, choose]);
  const remove = useCallback((id: string) => {
    const next = added.filter(engine => engine.id !== id);
    saveAddedEngines(next);
    setAdded(next);
    if (id === selectedId) choose(BUILTIN_ENGINE);
  }, [added, selectedId, choose]);
  return { engines, selected, select, add, remove };
}

export type EngineChoice = ReturnType<typeof useEngineChoice>;
