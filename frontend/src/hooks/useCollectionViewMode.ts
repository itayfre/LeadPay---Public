import { useCallback, useEffect, useState } from 'react';

export type CollectionViewMode = 'table' | 'matrix';

const STORAGE_KEY = 'lp:collectionViewMode';

function read(): CollectionViewMode {
  if (typeof window === 'undefined') return 'table';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'matrix' ? 'matrix' : 'table';
}

export function useCollectionViewMode(): [CollectionViewMode, (m: CollectionViewMode) => void] {
  const [mode, setMode] = useState<CollectionViewMode>(read);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const setAndPersist = useCallback((m: CollectionViewMode) => setMode(m), []);
  return [mode, setAndPersist];
}
