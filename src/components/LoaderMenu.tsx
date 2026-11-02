import { useEffect, useId, useRef, useState } from 'react';
import { ReplayLoader, type ReplayLoaderProps } from './ReplayLoader';

/**
 * Round 84 (turn dock, user answer Q20 a, 02.11.2026): a dropped file lands anywhere on the page while a replay is loaded, because
 * the loader no longer takes a column of its own. Only a drag that carries files counts; the page keeps its other drops.
 * `active` is true while such a drag is over the window (the button shows it).
 */
function usePageFileDrop(onFile: (file: File) => void): boolean {
  const [active, setActive] = useState(false);
  const latest = useRef(onFile);
  useEffect(() => { latest.current = onFile; });
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      // A leave without a related target is the drag leaving the window.
      if (event.relatedTarget === null) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setActive(false);
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) latest.current(dropped);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, []);
  return active;
}

/**
 * Round 84 (turn dock, Q20 a): with a replay loaded the loader folds into a "Load" button beside "Setup" in the top bar. The panel
 * holds the loader's parts (URL form, file picker, team paste) and closes on Escape, on a click beside it and when a load
 * succeeds; a failed load keeps it open with the error. A file dropped on the page opens it and loads at once.
 */
export function LoaderMenu(props: Omit<ReplayLoaderProps, 'variant' | 'showGuide'>) {
  const { loading, error, onLoadFile } = props;
  const [open, setOpen] = useState(false);
  // A load that ends without an error closes the panel; the check runs in render, where the loading flag changes.
  const [wasLoading, setWasLoading] = useState(false);
  if (wasLoading !== loading) {
    setWasLoading(loading);
    if (wasLoading && !error) setOpen(false);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const dragging = usePageFileDrop(dropped => {
    if (loading) return;
    setOpen(true);
    void dropped.text().then(content => onLoadFile(content, dropped.name));
  });
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="ps-loader-menu">
      <button
        type="button"
        className={`ps-btn ps-loader-toggle${dragging ? ' ps-loader-toggle-drop' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
      >
        Load <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={panelId} className="ps-loader-panel">
          <ReplayLoader {...props} variant="menu" />
        </div>
      )}
    </div>
  );
}
