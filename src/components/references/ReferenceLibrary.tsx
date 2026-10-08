import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Download, Save } from 'lucide-react';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';
import { REFERENCE_ARCHITECTURES, type ReferenceArchitecture } from '../../data/referenceArchitectures.ts';
import { referenceSnapshot, readReferenceLibrary, saveReference } from '../../engine/persistence/references.ts';
import { draftFilename } from '../../engine/persistence/draft.ts';
import { saveJsonFile } from '../../utils/saveJson.ts';

export function ReferenceLibrary() {
  const { nodes, edges, scenario, draftName, loadTemplate } = useArchitecture();
  const panel = useRef<HTMLDetailsElement>(null);
  const [saved, setSaved] = useState<ReferenceArchitecture[]>([]);
  const [name, setName] = useState(''); const [search, setSearch] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!message || busy) return;
    const timer = window.setTimeout(() => setMessage(''), 6000);
    return () => window.clearTimeout(timer);
  }, [message, busy]);
  const button = 'min-h-9 px-3 py-2 rounded-md border border-slate-300 text-xs hover:bg-slate-100 focus-visible:outline-circuit-600';
  const references = [...REFERENCE_ARCHITECTURES.map(ref => saved.find(item => item.id === ref.id) ?? ref),
    ...saved.filter(ref => !REFERENCE_ARCHITECTURES.some(item => item.id === ref.id))];
  const load = (ref: ReferenceArchitecture) => {
    if (!window.confirm(`Load “${ref.name}” and replace the canvas? Save current work first if needed.`)) return;
    loadTemplate(ref.id, ref); if (panel.current) panel.current.open = false;
  };
  return <details ref={panel} className="relative" onToggle={() => { if (panel.current?.open) { try { setSaved(readReferenceLibrary(localStorage)); setName(draftName || 'My architecture'); } catch (error) { setMessage(String(error)); } } }}>
    <summary className="list-none cursor-pointer flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white/95 shadow-sm text-xs font-semibold text-slate-800 dark:bg-slate-900/95 dark:border-slate-700 dark:text-slate-200"><FolderOpen size={15} />Reference Diagrams</summary>
    <section aria-label="Reference diagram library" className="absolute top-full left-0 mt-2 w-[min(420px,85vw)] max-h-[75dvh] overflow-y-auto rounded-xl bg-white border border-slate-200 shadow-xl p-4 text-slate-900 space-y-3" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' && panel.current) panel.current.open = false; }}>
      <div><h3 className="font-semibold">Reference diagrams</h3><p className="text-xs text-slate-500 mt-1">Start from an example or keep your own architecture.</p></div>
      <input aria-label="Search reference diagrams" className="w-full border rounded-md p-2 text-sm" placeholder="Search diagrams…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="max-h-64 overflow-auto divide-y divide-slate-100">{references.filter(r => `${r.name} ${r.category}`.toLowerCase().includes(search.toLowerCase())).map(ref => <div key={ref.id} className="flex items-center gap-2 py-2">
        <button className="flex-1 text-left rounded hover:bg-slate-50 p-1" onClick={() => load(ref)}><span className="block text-xs font-semibold">{ref.name}</span><span className="block text-[11px] text-slate-500">{ref.category}{saved.some(r => r.id === ref.id) ? ' · Saved in this browser' : ''}</span></button>
        <button className={button} aria-label={`Download reference ${ref.name}`} onClick={async () => { try { await saveJsonFile(JSON.stringify(ref, null, 2), draftFilename(ref.name), true); } catch (error) { setMessage(String(error)); } }}><Download size={14} /></button>
      </div>)}</div>
      <div className="border-t pt-3 space-y-2"><label className="block text-xs font-medium">Reference name<input className="block w-full border rounded-md p-2 mt-1 text-sm" maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
        <div className="flex gap-2"><button disabled={busy || !name.trim()} className={button} onClick={async () => {
          setMessage('');
          setBusy(true);
          try {
            // Saving under the loaded reference's name preserves its repository identity
            // and teaching metadata. A new name creates a separate reference.
            const existing = name.trim() === draftName ? references.find(ref => ref.name === draftName) : undefined;
            const clearedStart = Boolean(scenario.startNodeId && !nodes.some(node => node.id === scenario.startNodeId));
            const ref = referenceSnapshot({ id: `custom-${crypto.randomUUID()}`, category: 'My references', difficulty: 'Beginner', description: 'User-created architecture snapshot.', learningOutcome: '', ...existing, name: name.trim(), nodes, edges, scenario });
            let stored = true;
            try { setSaved(saveReference(localStorage, ref)); } catch { stored = false; }
            setMessage('Saving reference file…');
            const downloaded = await saveJsonFile(JSON.stringify(ref, null, 2), draftFilename(ref.name), true);
            setMessage((downloaded ? `Reference JSON exported.${stored ? ' A copy is also saved in this browser.' : ' Browser storage was unavailable.'}` : stored ? 'Saved in this browser. File save cancelled; use the download button later.' : 'File save cancelled. Browser storage was unavailable; no reference was saved.')
              + (clearedStart ? ' The removed request start node was cleared; choose a start component before simulating.' : ''));
          } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
        }}><Save size={14} className="inline mr-1" />{busy ? 'Saving…' : 'Save as reference'}</button></div>
        <p className="text-xs text-slate-500">A reference file keeps the architecture and request settings. Browser copies stay on this device; export a file to share or keep a backup.</p>
      </div>
      {message && <p role="status" className="text-xs bg-slate-100 p-2 rounded">{message}</p>}
    </section>
  </details>;
}
