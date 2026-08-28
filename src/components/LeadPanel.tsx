import { useState } from 'react';
import { spriteUrl } from '../lib/sprite-url';

/** One team slot offered as a lead: identity plus whether it actually led. */
export interface LeadOption {
  name: string;
  species: string;
  /** This Pokémon led the real game. */
  wasLead: boolean;
}

interface Props {
  playerNames: [string, string];
  p1Options: LeadOption[];
  p2Options: LeadOption[];
  /** Doubles needs two leads per side — not supported yet. */
  doubles: boolean;
  /** True while the sim rebuilds or executes — blocks the start button. */
  executing: boolean;
  onStart: (leads: { p1: string; p2: string }) => void;
}

function LeadColumn({ label, options, selected, onSelect }: {
  label: string;
  options: LeadOption[];
  selected: string | null;
  onSelect: (species: string) => void;
}) {
  return (
    <div className="ps-controls ps-side-controls">
      <div className="ps-whatdo">
        <span className="ps-side-label">{label}</span>
        {' '}Who leads?
      </div>
      <div className="ps-switchgrid ps-switchgrid-compact">
        {options.map(option => (
          <button
            key={option.species}
            type="button"
            onClick={() => onSelect(option.species)}
            className={`ps-switchbtn ps-switchbtn-compact ${selected === option.species ? 'ps-switchbtn-selected' : ''}`}
            aria-pressed={selected === option.species}
            title={option.wasLead ? `${option.name} led the real game.` : option.name}
          >
            <img src={spriteUrl(option.species)} alt={option.name} />
            <div className="ps-switchbtn-name">
              {option.name}
              {option.wasLead && <span className="ps-played-badge" title="This Pokémon led the real game.">played</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Turn 0 of the unified timeline: the team-preview decision. Replaces the
 * turn pickers while the pointer sits on T0 — pick each side's lead and
 * play the game from the start as a variation.
 */
export function LeadPanel({ playerNames, p1Options, p2Options, doubles, executing, onStart }: Props) {
  const [p1Lead, setP1Lead] = useState<string | null>(
    () => p1Options.find(option => option.wasLead)?.species ?? null,
  );
  const [p2Lead, setP2Lead] = useState<string | null>(
    () => p2Options.find(option => option.wasLead)?.species ?? null,
  );

  if (doubles) {
    return (
      <div className="ps-branch-controls-shell" style={{ padding: '8px 12px', fontSize: 11, color: '#9fb2cc' }}>
        Turn 0 · team preview. Lead branching covers singles games for now — doubles needs two leads per side.
      </div>
    );
  }
  if (p1Options.length === 0 || p2Options.length === 0) {
    return (
      <div className="ps-branch-controls-shell" style={{ padding: '8px 12px', fontSize: 11, color: '#9fb2cc' }}>
        Turn 0 · team preview. The teams are still loading.
      </div>
    );
  }

  const ready = p1Lead !== null && p2Lead !== null;
  return (
    <div>
      <div style={{ fontSize: 10, color: '#9fb2cc', margin: '4px 0 2px' }}>
        Turn 0 · team preview: pick each side&apos;s lead and play the game from the start.
      </div>
      <div className="ps-branch-controls-shell">
        <div className="ps-branch-controls-grid">
          <div className="ps-branch-side-column">
            <LeadColumn label={`P1 · ${playerNames[0]}`} options={p1Options} selected={p1Lead} onSelect={setP1Lead} />
          </div>
          <div className="ps-side-divider" />
          <div className="ps-branch-side-column">
            <LeadColumn label={`P2 · ${playerNames[1]}`} options={p2Options} selected={p2Lead} onSelect={setP2Lead} />
          </div>
        </div>
        <div className="ps-execute-wrap">
          <button
            type="button"
            onClick={() => ready && onStart({ p1: p1Lead!, p2: p2Lead! })}
            disabled={!ready || executing}
            className="ps-execute-btn"
            style={{ background: ready && !executing ? '#cc4455' : '#555' }}
          >
            {executing ? 'Preparing…' : 'Play from turn 0'}
          </button>
        </div>
      </div>
    </div>
  );
}
