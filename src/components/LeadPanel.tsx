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
  /** 1 in singles, 2 in doubles — selection order is the slot order (a, b). */
  leadsPerSide: number;
  /** True while the sim rebuilds or executes — blocks the start button. */
  executing: boolean;
  onStart: (leads: { p1: string[]; p2: string[] }) => void;
}

const SLOT_LABELS = ['a', 'b', 'c'];

function LeadColumn({ label, options, selected, leadsPerSide, onToggle }: {
  label: string;
  options: LeadOption[];
  selected: string[];
  leadsPerSide: number;
  onToggle: (species: string) => void;
}) {
  return (
    <div className="ps-controls ps-side-controls">
      <div className="ps-whatdo">
        <span className="ps-side-label">{label}</span>
        {' '}{leadsPerSide > 1 ? `Who leads? Pick ${leadsPerSide} (order sets the slots)` : 'Who leads?'}
      </div>
      <div className="ps-switchgrid ps-switchgrid-compact">
        {options.map(option => {
          const slot = selected.indexOf(option.species);
          return (
            <button
              key={option.species}
              type="button"
              onClick={() => onToggle(option.species)}
              className={`ps-switchbtn ps-switchbtn-compact ${slot >= 0 ? 'ps-switchbtn-selected' : ''}`}
              aria-pressed={slot >= 0}
              title={option.wasLead ? `${option.name} led the real game.` : option.name}
            >
              <img src={spriteUrl(option.species)} alt={option.name} />
              <div className="ps-switchbtn-name">
                {slot >= 0 && leadsPerSide > 1 && (
                  <span className="ps-lead-slot" title={`Sends out in slot ${SLOT_LABELS[slot]}.`}>{SLOT_LABELS[slot]}</span>
                )}
                {option.name}
                {option.wasLead && <span className="ps-played-badge" title="This Pokémon led the real game.">played</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Turn 0 of the unified timeline: the team-preview decision. Replaces the
 * turn pickers while the pointer sits on T0 — pick each side's lead (both
 * slots in doubles) and play the game from the start as a variation.
 */
export function LeadPanel({ playerNames, p1Options, p2Options, leadsPerSide, executing, onStart }: Props) {
  const initialFor = (options: LeadOption[]) =>
    options.filter(option => option.wasLead).slice(0, leadsPerSide).map(option => option.species);
  const [p1Leads, setP1Leads] = useState<string[]>(() => initialFor(p1Options));
  const [p2Leads, setP2Leads] = useState<string[]>(() => initialFor(p2Options));

  if (p1Options.length === 0 || p2Options.length === 0) {
    return (
      <div className="ps-branch-controls-shell" style={{ padding: '8px 12px', fontSize: 11, color: '#9fb2cc' }}>
        Turn 0 · team preview. The teams are still loading.
      </div>
    );
  }

  // Click toggles; a click past the limit replaces the OLDEST pick, so
  // swapping one lead never needs a deselect first.
  const toggle = (setter: typeof setP1Leads) => (species: string) => {
    setter(previous => (previous.includes(species)
      ? previous.filter(entry => entry !== species)
      : [...previous, species].slice(-leadsPerSide)));
  };

  const ready = p1Leads.length === leadsPerSide && p2Leads.length === leadsPerSide;
  return (
    <div>
      <div style={{ fontSize: 10, color: '#9fb2cc', margin: '4px 0 2px' }}>
        {leadsPerSide > 1
          ? 'Turn 0 · team preview: pick both leads per side (selection order is the slot order) and play the game from the start.'
          : 'Turn 0 · team preview: pick each side’s lead and play the game from the start.'}
      </div>
      <div className="ps-branch-controls-shell">
        <div className="ps-branch-controls-grid">
          <div className="ps-branch-side-column">
            <LeadColumn
              label={`P1 · ${playerNames[0]}`}
              options={p1Options}
              selected={p1Leads}
              leadsPerSide={leadsPerSide}
              onToggle={toggle(setP1Leads)}
            />
          </div>
          <div className="ps-side-divider" />
          <div className="ps-branch-side-column">
            <LeadColumn
              label={`P2 · ${playerNames[1]}`}
              options={p2Options}
              selected={p2Leads}
              leadsPerSide={leadsPerSide}
              onToggle={toggle(setP2Leads)}
            />
          </div>
        </div>
        <div className="ps-execute-wrap">
          <button
            type="button"
            onClick={() => ready && onStart({ p1: [...p1Leads], p2: [...p2Leads] })}
            disabled={!ready || executing}
            className="ps-execute-btn"
            style={{ background: ready && !executing ? '#cc4455' : '#555' }}
          >
            {executing ? 'Preparing…' : ready ? 'Play from turn 0' : `Pick ${leadsPerSide} lead${leadsPerSide > 1 ? 's' : ''} per side`}
          </button>
        </div>
      </div>
    </div>
  );
}
