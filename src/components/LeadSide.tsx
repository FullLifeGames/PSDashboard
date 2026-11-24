import { displayName } from '../lib/branch-history';
import { useReplayRules } from '../lib/replay-rules';
import { SpriteImg } from './SpriteImg';
import type { LeadOption } from '../lib/lead-options';
import { useIsGuessed, type GuessedSide } from '../lib/stand-in-mark';

const slotLetter = (slot: number): string => String.fromCharCode(97 + slot);

function columnPrompt(maxPicks: number, leadsPerSide: number): string {
  return maxPicks > leadsPerSide
    ? `Who comes along? Pick ${maxPicks}. The first ${leadsPerSide > 1 ? `${leadsPerSide} lead` : 'one leads'}`
    : leadsPerSide > 1
      ? `Who leads? Pick ${leadsPerSide} (order sets the slots)`
      : 'Who leads?';
}

/**
 * One body of the lead picker as the bench's tile. The pick order and the "played" badge sit in the tile's flag row after the name in
 * the DOM, so a pick never changes the tile's box and the tile's accessible name still begins with the body's name.
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
  // A body the log never showed (a stand-in) wears the stats panel's marker, as on the dock's switch tiles.
  const guessed = useIsGuessed()(side, option.species);
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
      <SpriteImg species={option.species} rules={rules} alt={label} />
      <span className="ps-switch-text">
        <span className="ps-switchbtn-name">{label}</span>
      </span>
      {(order !== null || option.wasLead || guessed) && (
        <span className="ps-tile-flags">
          {guessed && <span className="ps-guess-badge" title={guessed.title}>{guessed.badge}</span>}
          {order !== null && (
            <span className="ps-lead-slot" title={slot < leadsPerSide ? `Leads in slot ${slotLetter(slot)}.` : 'Comes along in the back.'}>{order}</span>
          )}
          {option.wasLead && <span className="ps-played-badge" title="This Pokémon led the real game.">played</span>}
        </span>
      )}
    </button>
  );
}

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
