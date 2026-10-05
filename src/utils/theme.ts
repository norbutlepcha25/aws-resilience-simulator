import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'cloud-architecture-lab:theme';
const CHANGE_EVENT = 'cloud-architecture-lab:theme-change';

let chosen: Theme | null = null;

function readTheme(): Theme {
  if (chosen) return chosen;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage blocked: fall back to the OS preference */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** One light/dark preference shared by the home page and the lab canvas, remembered per browser. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const sync = () => setTheme(readTheme());
    const fromOtherTab = () => { chosen = null; sync(); };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', fromOtherTab);
    return () => { window.removeEventListener(CHANGE_EVENT, sync); window.removeEventListener('storage', fromOtherTab); };
  }, []);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    chosen = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* keep the in-memory choice */ }
    setTheme(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return [theme, toggle];
}
