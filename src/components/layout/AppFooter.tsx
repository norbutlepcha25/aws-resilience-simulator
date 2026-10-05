import React from 'react';
import { ReleaseStatus } from './ReleaseStatus.tsx';

export function AppFooter() {
  return (
    <footer className="shrink-0 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/10 bg-[#12181F] px-6 py-2 text-xs text-white/60">
      <ReleaseStatus />
      <span>© {new Date().getFullYear()} cs-Sensei · MIT License</span>
      <span title="Cloud Architecture Lab is an independent educational project. AWS and related marks are trademarks of Amazon.com, Inc. or its affiliates.">Not affiliated with or endorsed by Amazon Web Services</span>
      <a
        href="https://github.com/norbutlepcha25/cloud-architecture-lab"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded text-white/80 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400"
        aria-label="Contribute on GitHub — opens in a new tab"
      >
        Open source · Contribute on GitHub
      </a>
    </footer>
  );
}
