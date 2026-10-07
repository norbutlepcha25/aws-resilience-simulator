import React from 'react';
import { Moon, Sun } from 'lucide-react';
import type { Theme } from '../../utils/theme.ts';

/** Light/dark switch. Styling comes from the caller so it fits the home nav and the canvas. */
export function ThemeToggle({ theme, onToggle, className, iconSize = 16, showLabel = false }: {
  theme: Theme;
  onToggle: () => void;
  className?: string;
  iconSize?: number;
  showLabel?: boolean;
}) {
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;
  return <button type="button" className={className} onClick={onToggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
    <Icon size={iconSize} aria-hidden="true" />{showLabel && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
  </button>;
}
