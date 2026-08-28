import { useState } from 'react';
import { spriteUrl } from '../lib/sprite-url';

/** One team slot offered as a lead: identity plus what the real game did. */
export interface LeadOption {
  name: string;
  species: string;
  /** This Pokémon led the real game. */
  wasLead: boolean;
  /** This Pokémon was brought (active at some point) in the real game. */
  wasBrought: boolean;
}

interface Props {
  playerNames: [string, string];
  p1Options: LeadOption[];
  p2Options: LeadOption[];
  /** 1 in singles, 2 in doubles — selection order is the slot order (a, b). */
  leadsPerSide: number;
  /** Bring-limited formats (VGC 4 of 6, BSS 3 of 6): total picks per side.
   *  Null brings the whole team, so only the leads are picked. */
  bringCount: number | null;
  /** True while the sim rebuilds or executes — blocks the start button. */
  executing: boolean;
  onStart: (leads: { p1: string[]; p2: string[] }) => void;
}

const SLOT_LABELS = ['a', 'b', 'c'];

function LeadColumn({ label, options, selected, leadsPerSide, maxPicks, onToggle }: {
  label: string;
  options: LeadOption[];
  selected: string[];
  leadsPerSide: number;
  maxPicks: number;
  onToggle: (species: string) => void;
}) {
  const prompt = maxPicks > leadsPerSide
    ? `Who comes along? Pick ${maxPicks} — the first ${leadsPerSide > 1 ? `${leadsPerSide} lead` : 'one leads'}`
    : leadsPerSide > 1
      ? `Who leads? Pick ${leadsPerSide} (order sets the slots)`
      : 'Who leads?';
  return (
    <div className="ps-controls ps-side-controls">
      <div className="ps-whatdo">
        <span className="ps-side-label">{label}</span>
        {' '}{prompt}
      </div>
      <div className="ps-switchgrid ps-switchgrid-compact">
        {options.map(option => {
          const slot = selected.indexOf(option.species);
          const showBadges = maxPicks > 1;
          return (
            <button
              key={option.species}
              type="button"
              onClick={() => onToggle(option.species)}
              className={`ps-switchbtn ps-switchbtn-compact ${slot >= 0 ? 'ps-switchbtn-selected' : ''}`}
              aria-pressed={slot >= 0}
              title={option.wasLead
                ? `${option.name} led the real game.`
                : option.wasBrought
                  ? `${option.name} was brought in the real game.`
                  : option.name}
            >
              <img src={spriteUrl(option.species)} alt={option.name} />
              <div className="ps-switchbtn-name">
                {slot >= 0 && showBadges && (
                  <span
                    className="ps-lead-slot"
                    title={slot < leadsPerSide ? `Leads in slot ${SLOT_LABELS[slot]}.` : 'Comes along in the back.'}
                  >
                    {slot < leadsPerSide ? SLOT_LABELS[slot] : slot + 1}
                  </span>
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
 * slots in doubles) and, in bring-limited formats, the whole brought
 * selection; then play the game from the start as a variation.
 */
export function LeadPanel({ playerNames, p1Options, p2Options, leadsPerSide, bringCount, executing, onStart }: Props) {
  const maxPicks = bringCount ?? leadsPerSide;
  // The real game's choice preselects: leads first (slot order), then the
  // rest of what was actually brought.
  const initialFor = (options: LeadOption[]) => [
    ...options.filter(option => option.wasLead),
    ...options.filter(option => !option.wasLead && option.wasBrought),
  ].slice(0, maxPicks).map(option => option.species);
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
  // swapping one Pokémon never needs a deselect first.
  const toggle = (setter: typeof setP1Leads) => (species: string) => {
    setter(previous => (previous.includes(species)
      ? previous.filter(entry => entry !== species)
      : [...previous, species].slice(-maxPicks)));
  };

  const ready = p1Leads.length === maxPicks && p2Leads.length === maxPicks;
  const intro = bringCount !== null
    ? `Turn 0 · team preview: pick the ${bringCount} each side brings — the first ${leadsPerSide > 1 ? `${leadsPerSide} lead` : 'one leads'} — and play the game from the start.`
    : leadsPerSide > 1
      ? 'Turn 0 · team preview: pick both leads per side (selection order is the slot order) and play the game from the start.'
      : 'Turn 0 · team preview: pick each side’s lead and play the game from the start.';
  return (
    <div>
      <div style={{ fontSize: 10, color: '#9fb2cc', margin: '4px 0 2px' }}>
        {intro}
      </div>
      <div className="ps-branch-controls-shell">
        <div className="ps-branch-controls-grid">
          <div className="ps-branch-side-column">
            <LeadColumn
              label={`P1 · ${playerNames[0]}`}
              options={p1Options}
              selected={p1Leads}
              leadsPerSide={leadsPerSide}
              maxPicks={maxPicks}
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
              maxPicks={maxPicks}
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
            {executing ? 'Preparing…' : ready ? 'Play from turn 0' : `Pick ${maxPicks} per side`}
          </button>
        </div>
      </div>
    </div>
  );
}
