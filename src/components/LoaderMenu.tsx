import { useEffect, useId, useRef, useState } from 'react';
import { ReplayLoader, type ReplayLoaderProps } from './ReplayLoader';
import { MenuGameParts, type GameEntryProps } from './GameEntry';
import { ConfirmBanner } from './ConfirmBanner';
import { useLeaveAsk } from '../hooks/useLeaveAsk';

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

/** The panel closes on Escape and on a press beside the menu. */
function useMenuDismiss(open: boolean, setOpen: (open: boolean) => void, rootRef: React.RefObject<HTMLDivElement | null>) {
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
  }, [open, setOpen, rootRef]);
}

/**
 * Round 84 (turn dock, Q20 a): with a replay loaded the loader folds into a button beside "Setup" in the top bar. Round 89 (#105,
 * user ruling 13.11.2026, H10b): the button is "Game" and the panel has three parts: "Load replay" (URL form, file picker, team
 * paste), "New game" and "Saved games". It closes on Escape, on a click beside it, when a load succeeds, when New game opens its
 * dialog and when a saved game has opened; a failed load keeps it open with the error. A file dropped on the page opens it and
 * loads at once. Round 89, H16a: while `unsavedVariation()` says a variation is open and not saved, a load or an open of a saved game
 * asks first, in the panel (the game itself is saved after every turn and needs no question).
 */
export function LoaderMenu(props: Omit<ReplayLoaderProps, 'variant' | 'showGuide'> & Partial<GameEntryProps> & { unsavedVariation?: () => boolean }) {
  const { loading, error, onLoad, onLoadFile, onNewGame, onOpenGame, currentGameId = null, onShareGame, unsavedVariation, ...loader } = props;
  const leave = useLeaveAsk(unsavedVariation);
  const { ask } = leave;
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
    void dropped.text().then(content => ask('Loading a replay', () => onLoadFile(content, dropped.name)));
  });
  useMenuDismiss(open, setOpen, rootRef);
  return (
    <div ref={rootRef} className="ps-loader-menu">
      <button
        type="button"
        className={`ps-btn ps-loader-toggle${dragging ? ' ps-loader-toggle-drop' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
      >
        Game <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={panelId} className="ps-loader-panel ps-entry-panel">
          {leave.question && <ConfirmBanner message={leave.question.message} proceedLabel="Discard variation" onProceed={leave.question.proceed} onCancel={leave.question.cancel} />}
          <ReplayLoader
            {...loader}
            loading={loading}
            error={error}
            onLoad={url => { ask('Loading a replay', () => onLoad(url)); }}
            onLoadFile={(content, fileName) => { ask('Loading a replay', () => onLoadFile(content, fileName)); }}
            variant="menu"
          />
          {onNewGame && onOpenGame && (
            <MenuGameParts
              currentGameId={currentGameId}
              onShareGame={onShareGame}
              // the dialog takes over: the panel folds away behind it
              onNewGame={() => { setOpen(false); onNewGame(); }}
              // a game that opened closes the panel; one that failed keeps it open with the list's message
              onOpenGame={async record => {
                const open = async () => { await onOpenGame(record); setOpen(false); };
                // the list waits for a game that opens at once (its failure shows there); a held one opens on the answer
                let opening: Promise<void> | undefined;
                if (!ask('Opening a game', () => { opening = open(); })) await opening;
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
