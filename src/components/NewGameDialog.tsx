import { useEffect, useMemo, useState } from 'react';
import { ConfirmBanner } from './ConfirmBanner';
import { ModalDialog } from './ModalDialog';
import { useLeaveAsk } from '../hooks/useLeaveAsk';
import { FormatPicker } from './new-game/FormatPicker';
import { TeamBox } from './new-game/TeamBox';
import { useTeamCheck } from './new-game/use-team-check';
import { CALIBRATED_FORMATS, formatHasTeamPreview, formatNote, loadPanelGroups } from '../lib/new-game/format-list';
import type { FormatGroup, FormatOption } from '../lib/new-game/format-options';
import { newGameSeed, type NewGameRecord } from '../lib/new-game/record';
import { readTeamPaste, seedProblem, startBlocks, startNewGame, stopsStart } from '../lib/new-game/start';

// The dialog stays mounted while closed: the pasted teams survive a click beside it or Cancel.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (record: NewGameRecord) => Promise<unknown> | void;
  unsavedVariation?: () => boolean;
}

const DEFAULT_FORMAT = CALIBRATED_FORMATS[0];

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The Champions formats join once the mod is loaded in this realm.
function useFormatGroups(open: boolean): FormatGroup[] | null {
  const [groups, setGroups] = useState<FormatGroup[] | null>(null);
  useEffect(() => {
    if (!open || groups) return undefined;
    let live = true;
    void loadPanelGroups().then(loaded => { if (live) setGroups(loaded); });
    return () => { live = false; };
  }, [open, groups]);
  return groups;
}

function SeedRow({ seed, onSeed }: { seed: string; onSeed: (seed: string) => void }) {
  const problem = seed.trim() ? seedProblem(seed) : null;
  return (
    <div className="ps-newgame-seed">
      <label className="ps-newgame-label" htmlFor="ps-newgame-seed">Seed</label>
      <input
        id="ps-newgame-seed"
        className="ps-input ps-newgame-seed-input"
        type="text"
        value={seed}
        placeholder="Empty: a fresh seed"
        spellCheck={false}
        aria-invalid={problem !== null}
        onChange={event => onSeed(event.target.value)}
      />
      <button type="button" className="ps-btn ps-newgame-small" onClick={() => onSeed(newGameSeed('fresh'))}>New seed</button>
      <span className="ps-newgame-seed-hint">The same seed, teams and choices roll the same dice.</span>
      {problem && <span className="ps-newgame-error ps-newgame-seed-problem" role="alert">{problem}</span>}
    </div>
  );
}

function useNewGameDraft({ onOpenChange, onStart, open, unsavedVariation }: Pick<Props, 'onOpenChange' | 'onStart' | 'open' | 'unsavedVariation'>) {
  const leave = useLeaveAsk(unsavedVariation, open);
  const groups = useFormatGroups(open);
  const [format, setFormat] = useState<string>(DEFAULT_FORMAT);
  const [names, setNames] = useState<[string, string]>(['', '']);
  const [texts, setTexts] = useState<[string, string]>(['', '']);
  const [seed, setSeed] = useState(() => newGameSeed('fresh'));
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reads = useMemo(() => [readTeamPaste(texts[0]), readTeamPaste(texts[1])] as const, [texts]);
  const selected: FormatOption | null = useMemo(
    () => groups?.flatMap(group => group.options).find(option => option.id === format) ?? null,
    [groups, format],
  );
  const check = useTeamCheck(format, reads[0].sets, reads[1].sets, nonce);
  const blocks = startBlocks({ texts, seed, refused: check.state === 'done' ? [check.problems.refused.p1, check.problems.refused.p2] : undefined });
  const blocked = stopsStart(blocks);
  const { ask, question } = leave;

  const run = async (what: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (failure) {
      setError(`The game could not ${what}: ${messageOf(failure)}`);
    } finally {
      setBusy(false);
    }
  };
  const begin = (picked: FormatOption) => {
    void run('start', async () => {
      const record = await startNewGame({ format, formatName: picked.name, names, texts, seed });
      await onStart(record);
      setSeed(newGameSeed('fresh'));
    });
  };
  const start = () => {
    if (!selected || blocked) return;
    ask('Starting a game', () => begin(selected));
  };
  return {
    groups, format, setFormat, names, setNames, texts, setTexts, seed, setSeed, setNonce, busy, error,
    reads, selected, check, blocks, blocked, start, question,
  };
}

export function NewGameDialog(props: Props) {
  const { open, onOpenChange } = props;
  const draft = useNewGameDraft(props);
  const { groups, format, names, texts, reads, selected, check, blocks, blocked, busy, error, question } = draft;
  if (!open) return null;
  return (
    <ModalDialog title="New game" closeLabel="Close new game" onClose={() => onOpenChange(false)} maxWidth={940}>
      <div className="ps-newgame">
        <div className="ps-newgame-intro">
          Paste both teams in Showdown&apos;s export format and pick the format.{' '}
          {selected && !formatHasTeamPreview(selected.id)
            ? 'Start opens the game at turn 0: this format has no Team Preview, so you pick each side\u2019s lead there, and both teams are in full view, as with open team sheets; you play both sides.'
            : 'Start opens the game at Team Preview with both teams in full view, as with open team sheets; you play both sides.'}
        </div>
        <div className="ps-newgame-format">
          <span className="ps-newgame-label" id="ps-newgame-format-label">Format</span>
          <FormatPicker groups={groups ?? []} value={format} onSelect={option => draft.setFormat(option.id)} disabled={!groups} />
          {selected && <span className="ps-format-facts">{formatNote(selected)}</span>}
        </div>
        <SeedRow seed={draft.seed} onSeed={draft.setSeed} />
        <div className="ps-newgame-teams">
          {(['p1', 'p2'] as const).map((side, index) => (
            <TeamBox
              key={side}
              side={side}
              name={names[index]}
              onName={name => draft.setNames(current => (index === 0 ? [name, current[1]] : [current[0], name]))}
              text={texts[index]}
              onText={text => draft.setTexts(current => (index === 0 ? [text, current[1]] : [current[0], text]))}
              read={reads[index]}
              format={format}
              formatName={selected?.name ?? format}
              check={check}
              reason={blocks.teams[index]}
              startBlocked={blocked}
              onValidate={() => draft.setNonce(current => current + 1)}
            />
          ))}
        </div>
        {error && <div className="ps-newgame-error" role="alert">{error}</div>}
        {question && <ConfirmBanner message={question.message} proceedLabel="Discard variation" onProceed={question.proceed} onCancel={question.cancel} />}
        <div className="ps-newgame-actions">
          <button type="button" className="ps-btn ps-btn-red" disabled={!selected || blocked || busy} onClick={draft.start}>
            {busy ? 'Starting…' : 'Start'}
          </button>
          <button type="button" className="ps-btn" onClick={() => onOpenChange(false)}>Cancel</button>
        </div>
      </div>
    </ModalDialog>
  );
}
