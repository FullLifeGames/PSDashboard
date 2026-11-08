import { displayName } from '../lib/branch-history';
import { useReplayRules } from '../lib/replay-rules';
import { spriteUrl } from '../lib/sprite-url';
import type { LeadOption } from '../lib/lead-options';
import { STAND_IN_BADGE, STAND_IN_BADGE_TITLE, useIsGuessed, type GuessedSide } from '../lib/stand-in-mark';

/** The slot letter of a lead: a, b, c (selection order is the slot order). */
const slotLetter = (slot: number): string => String.fromCharCode(97 + slot);

function columnPrompt(maxPicks: number, leadsPerSide: number): string {
  return maxPicks > leadsPerSide
    ? `Who comes along? Pick ${maxPicks}. The first ${leadsPerSide > 1 ? `${leadsPerSide} lead` : 'one leads'}`
    : leadsPerSide > 1
      ? `Who leads? Pick ${leadsPerSide} (order sets the slots)`
      : 'Who leads?';
}

/**
 * Round 84 (turn dock), A7b: one body of the lead picker as the bench's tile (`.ps-switchbtn` of the dock: sprite, name, the
 * selection blue). The order of a pick and the "played" badge stand in the tile's flag row on its top edge, after the name in the
 * DOM, so a pick never changes the tile's box and the tile's accessible name still begins with the body's name.
 */
function LeadTile({ side, option, slot, leadsPerSide, showOrder, onToggle }: {
  side: GuessedSide;
  option: LeadOption;
  slot: number;
  leadsPerSide: number;
  showOrder: boolean;
  onToggle: (species: string) => void;
}) {
  const rules = useReplayRules();
  // Round 88 (F, #101): a body the log never showed (a stand-in) wears the stats panel's marker, as on the dock's switch tiles.
  const guessed = useIsGuessed()(side, option.species);
  // The switch tiles of the turn dock read this same label (round 77, C10).
  const label = displayName(option.name, option.species);
  const picked = slot >= 0;
  const order = picked && showOrder ? (slot < leadsPerSide ? slotLetter(slot) : String(slot + 1)) : null;
  return (
    <button
      type="button"
      onClick={() => onToggle(option.species)}
      className={`ps-switchbtn${picked ? ' ps-switchbtn-selected' : ''}`}
      aria-pressed={picked}
      title={option.wasLead
        ? `${label} led the real game.`
        : option.wasBrought
          ? `${label} was brought in the real game.`
          : label}
    >
      <img src={spriteUrl(option.species, rules)} alt={label} />
      <span className="ps-switch-text">
        <span className="ps-switchbtn-name">{label}</span>
      </span>
      {(order !== null || option.wasLead || guessed) && (
        <span className="ps-tile-flags">
          {guessed && <span className="ps-guess-badge" title={STAND_IN_BADGE_TITLE}>{STAND_IN_BADGE}</span>}
          {order !== null && (
            <span className="ps-lead-slot" title={slot < leadsPerSide ? `Leads in slot ${slotLetter(slot)}.` : 'Comes along in the back.'}>{order}</span>
          )}
          {option.wasLead && <span className="ps-played-badge" title="This Pokémon led the real game.">played</span>}
        </span>
      )}
    </button>
  );
}

/** One side of the lead picker in the dock's rows: the side's prompt, then its bodies in the bench's wrapping row. */
export function LeadSide({ side, label, options, selected, leadsPerSide, maxPicks, onToggle }: {
  side: GuessedSide;
  label: string;
  options: LeadOption[];
  selected: string[];
  leadsPerSide: number;
  maxPicks: number;
  onToggle: (species: string) => void;
}) {
  return (
    <div className="ps-lead-side">
      <div className="ps-lead-prompt">
        <span className="ps-lead-label">{label}</span>
        {' '}{columnPrompt(maxPicks, leadsPerSide)}
      </div>
      <div className="ps-switch-row">
        {options.map(option => (
          <LeadTile
            key={option.species}
            side={side}
            option={option}
            slot={selected.indexOf(option.species)}
            leadsPerSide={leadsPerSide}
            showOrder={maxPicks > 1}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
