import { useId } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import { formatRules } from '@fulllifegames/replay-core';
import { spriteUrl } from '../../lib/sprite-url';
import { TEAM_SIZE, type TeamRead } from '../../lib/new-game/start';
import type { TeamCheck } from './use-team-check';

/**
 * Round 89 (lane H, #105), stage H4: one player's side of the New game dialog: the name, Validate, the paste field, the sprites of
 * the sets that were read with their count, and the simulator's check under it. The check shows the problems and leaves Start possible.
 */

interface Props {
  side: 'p1' | 'p2';
  name: string;
  onName: (name: string) => void;
  text: string;
  onText: (text: string) => void;
  read: TeamRead;
  format: string;
  formatName: string;
  check: TeamCheck;
  onValidate: () => void;
}

function Sprites({ sets, format }: { sets: PokemonSet[]; format: string }) {
  const rules = formatRules(format);
  return (
    <>
      {sets.map((set, index) => (
        <img key={`${set.species}-${index}`} src={spriteUrl(set.species, rules)} alt={set.species} title={set.species} />
      ))}
    </>
  );
}

function CheckNote({ read, check }: Pick<Props, 'read' | 'check'>) {
  if (read.sets.length === 0) return null;
  if (check.state === 'failed') return <div className="ps-newgame-problems" role="status">The simulator could not check this team: {check.message}</div>;
  if (check.state !== 'done') return <div className="ps-newgame-valid" role="status">Checking…</div>;
  return null;
}

export function TeamBox({ side, name, onName, text, onText, read, format, formatName, check, onValidate }: Props) {
  const number = side === 'p1' ? 1 : 2;
  const pasteId = useId();
  const problems = check.state === 'done' ? check.problems[side] : null;
  return (
    <section className="ps-newgame-team" aria-label={`Player ${number} team`}>
      <div className="ps-newgame-team-head">
        <span className="ps-stats-label">P{number}</span>
        <input
          className="ps-input ps-newgame-name"
          type="text"
          value={name}
          placeholder={`Player ${number}`}
          aria-label={`Player ${number} name`}
          onChange={event => onName(event.target.value)}
        />
        <button type="button" className="ps-btn ps-newgame-small" onClick={onValidate} disabled={read.sets.length === 0}>Validate</button>
      </div>
      <label className="ps-newgame-field" htmlFor={pasteId}>Import from text: paste the team&apos;s Showdown export</label>
      <textarea
        id={pasteId}
        className="ps-input ps-newgame-paste"
        rows={12}
        spellCheck={false}
        value={text}
        aria-label={`Player ${number} team`}
        onChange={event => onText(event.target.value)}
      />
      {text.trim() !== '' && (
        <div className="ps-newgame-read">
          <Sprites sets={read.sets} format={format} />
          <span className="ps-newgame-count">{read.sets.length} of {TEAM_SIZE} sets read</span>
        </div>
      )}
      {read.skipped.length > 0 && (
        <div className="ps-newgame-problems" role="status">
          No moves read for {read.skipped.join(', ')}: a set needs at least one move line ("- Earthquake"), so it is left out.
        </div>
      )}
      <CheckNote read={read} check={check} />
      {problems && problems.length === 0 && read.sets.length > 0 && (
        <div className="ps-newgame-valid" role="status">This team is valid for {formatName}.</div>
      )}
      {problems && problems.length > 0 && (
        <div className="ps-newgame-problems" role="status">
          This team has {problems.length} {problems.length === 1 ? 'problem' : 'problems'} for {formatName}:
          <ul>{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>
          <span className="ps-newgame-note">Start plays the team as pasted; a league may allow what the format bans.</span>
        </div>
      )}
    </section>
  );
}
