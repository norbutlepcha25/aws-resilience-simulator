import React, { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, BookOpen } from 'lucide-react';
import { COURSE_LABS } from '../../data/courseLabs.ts';
import { useArchitecture } from '../../context/ArchitectureContext.tsx';

export function LabsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState(COURSE_LABS[0].id);
  const { openLabReference } = useArchitecture();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement;
    panel.current?.focus();
    return () => previous?.focus();
  }, [isOpen]);
  if (!isOpen) return null;
  const lab = COURSE_LABS.find(item => item.id === selected)!;
  return <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="labs-title"
      className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-auto outline-none"
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const items = panel.current?.querySelectorAll<HTMLElement>('button, a[href]');
          if (!items?.length) return;
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <header className="p-5 border-b flex items-center justify-between">
        <div><h2 id="labs-title" className="font-bold text-xl flex gap-2 items-center"><BookOpen size={22}/> DSO303 Labs</h2><p className="text-sm text-slate-500 mt-1">Course instructions and architecture references</p></div>
        <button onClick={onClose} aria-label="Close labs" className="p-2 hover:bg-slate-100 rounded"><X/></button>
      </header>
      <div className="flex flex-col md:flex-row">
        <nav aria-label="Course labs" className="md:w-64 shrink-0 p-3 border-r space-y-1">
          {COURSE_LABS.map(item => <button key={item.id} aria-current={selected === item.id ? 'page' : undefined} onClick={() => setSelected(item.id)} className={`w-full text-left rounded p-3 text-sm ${selected === item.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}>Lab {item.number} · {item.title}</button>)}
        </nav>
        <section className="p-6 flex-1 min-w-0">
          <h3 className="text-lg font-bold">Lab {lab.number}: {lab.title}</h3>
          <a href={lab.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-600 text-sm my-3 underline">Open original lab instructions <ExternalLink size={14}/></a>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">{lab.objectives.map(text => <li key={text}>{text}</li>)}</ul>
          <p className="my-4 p-3 rounded bg-amber-50 text-amber-900 text-sm"><strong>Simulation scope: </strong>{lab.limitations}</p>
          <p className="text-xs text-slate-500 mb-3">Loading or running a reference replaces the current canvas. Run reference uses the supplied configuration; use Send Request to explore canvas edits for network labs. IAM examples use a separate policy evaluation.</p>
          <div className="space-y-3">{lab.references.map(reference => <article key={reference.id} className="border rounded-lg p-4">
            <h4 className="font-semibold">{reference.title}</h4><p className="text-sm text-slate-600 mt-1">{reference.description}</p>
            <p className="text-sm mt-2"><strong>Expected: </strong>{reference.expected}</p>
            <div className="flex gap-3 mt-3"><button className="border rounded px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { openLabReference(reference); onClose(); }}>Load reference</button><button className="bg-blue-600 text-white rounded px-3 py-2 text-sm hover:bg-blue-700" onClick={() => { openLabReference(reference, true); onClose(); }}>Run reference simulation</button></div>
          </article>)}</div>
        </section>
      </div>
    </div>
  </div>;
}
