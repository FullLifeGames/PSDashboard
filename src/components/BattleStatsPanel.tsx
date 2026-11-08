import {
  missingBodies, teamSizes,
  type OpponentTeamInfo,
  type PokemonEvsInfo,
  type PokemonFieldInfo,
  type PokemonMoveInfo,
  type ReplayData,
  type RevealedPokemonInfo,
} from '@fulllifegames/replay-core';
import { useScrollFade } from '../hooks/useScrollFade';
import { sourceAccent, sourceLabel } from '../lib/provenance-labels';
import { spriteUrl } from '../lib/sprite-url';
import { useReplayRules } from '../lib/replay-rules';
import { typeBg } from '../lib/type-colors';

interface Props {
  replayData: ReplayData;
  p1Info: OpponentTeamInfo | null;
  p2Info: OpponentTeamInfo | null;
}

function formatFieldValue(field: PokemonFieldInfo): string {
  if (!field.value) return '';
  if (field.value === '(has item)') return 'Has item';
  return field.value;
}

const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' } as const;

/** Round 87 (release 1.1.0), T317: the tag's words for a spread nobody has revealed; it carries no source word, since "unknown" is the whole claim. */
const EVS_UNKNOWN = 'EVs not yet known';

/** Round 88 (F, #101): the marker of a stand-in, a body the log never showed that the format's teammate usage names. */
const STAND_IN_MARK = 'Not revealed (guessed from teammate usage)';
const STAND_IN_TITLE = 'The log never showed this Pokémon. The statistics of the format name it as a likely teammate, so the engine plays with it. Edit it or paste your team to replace the guess.';

function formatEvs(evs: PokemonEvsInfo, isRandomFormat: boolean): string {
  const labels = [
    ['HP', evs.value.hp],
    ['Atk', evs.value.atk],
    ['Def', evs.value.def],
    ['SpA', evs.value.spa],
    ['SpD', evs.value.spd],
    ['Spe', evs.value.spe],
  ] as const;
  const nonZero = labels.filter(([, value]) => value > 0);
  if (nonZero.length === 0) {
    // Random sets run fixed 85 EVs across the board; "0 EVs" would be
    // misleading for unknown spreads too (G21).
    if (isRandomFormat && evs.source === 'unknown') return '85 EVs each (random set)';
    return evs.source === 'unknown' ? EVS_UNKNOWN : '0 EVs';
  }
  return `${nonZero.map(([label, value]) => `${value} ${label}`).join(' / ')} EVs`;
}

/** The IVs the build plays when any is below 31 (a Trick Room body); '' when every IV is 31 or none is known. */
function formatIvs(ivs: PokemonEvsInfo | undefined): string {
  if (!ivs || ivs.source === 'unknown') return '';
  const lowered = (['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const)
    .filter(stat => ivs.value[stat] !== 31)
    .map(stat => `${ivs.value[stat]} ${STAT_LABELS[stat]}`);
  return lowered.length > 0 ? `${lowered.join(' / ')} IVs` : '';
}

function MetaTag({
  field,
  className,
  children,
  background,
}: {
  field: PokemonFieldInfo;
  className?: string;
  children?: string;
  background?: string;
}) {
  const value = children || formatFieldValue(field);
  if (!value) return null;

  return (
    <span
      className={className}
      style={{
        background: background || undefined,
        color: background ? '#fff' : undefined,
        border: `1px solid ${sourceAccent(field.source)}`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
      }}
      title={field.sourceDetail || sourceLabel(field.source, field.probability, field.sourceDetail)}
    >
      {value}
      <span
        style={{
          marginLeft: 6, color: sourceAccent(field.source), fontSize: 9, textTransform: 'uppercase',
          // Type-colored pills (Tera) drown the accent — back it with a
          // dark chip so the source stays readable on any type color.
          ...(background ? { background: 'rgba(0,0,0,0.45)', padding: '0 3px', borderRadius: 2 } : {}),
        }}
      >
        {sourceLabel(field.source, field.probability, field.sourceDetail)}
      </span>
    </span>
  );
}

function MoveTag({ move }: { move: PokemonMoveInfo }) {
  return (
    <span
      className="ps-stats-move"
      style={{
        border: `1px solid ${sourceAccent(move.source)}`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
      }}
      title={move.sourceDetail || sourceLabel(move.source, move.probability)}
    >
      {move.name}
      <span style={{ marginLeft: 6, color: sourceAccent(move.source), fontSize: 9, textTransform: 'uppercase' }}>
        {sourceLabel(move.source, move.probability)}
      </span>
    </span>
  );
}

/** The EV or IV line with the source of its numbers. */
function SpreadTag({ info, text }: { info: PokemonEvsInfo; text: string }) {
  return (
    <span
      className="ps-stats-tag"
      style={{
        border: `1px solid ${sourceAccent(info.source)}`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
      }}
      title={info.sourceDetail || sourceLabel(info.source, info.probability, info.sourceDetail)}
    >
      {text}
      {text !== EVS_UNKNOWN && (
        <span style={{ marginLeft: 6, color: sourceAccent(info.source), fontSize: 9, textTransform: 'uppercase' }}>
          {sourceLabel(info.source, info.probability, info.sourceDetail)}
        </span>
      )}
    </span>
  );
}

function PokemonEntry({ poke, isRandomFormat }: { poke: RevealedPokemonInfo; isRandomFormat: boolean }) {
  const rules = useReplayRules();
  return (
    <div className="ps-stats-pokemon">
      <img
        src={spriteUrl(poke.species, rules)}
        alt={poke.species}
        className="ps-stats-sprite"
      />
      <div className="ps-stats-details">
        <div className="ps-stats-species">
          {poke.species}
          {poke.level !== 100 && <span className="ps-stats-level"> L{poke.level}</span>}
          {poke.gender && <span className="ps-stats-gender"> {poke.gender === 'M' ? '♂' : '♀'}</span>}
        </div>
        {poke.standIn && <div className="ps-stats-standin" title={STAND_IN_TITLE} style={{ color: '#8899aa', fontSize: 10 }}>{STAND_IN_MARK}</div>}
        {poke.moves.length > 0 && (
          <div className="ps-stats-moves">
            {poke.moves.map(move => (
              <MoveTag key={`${move.name}-${move.source}`} move={move} />
            ))}
          </div>
        )}
        <div className="ps-stats-meta">
          <MetaTag field={poke.ability} className="ps-stats-tag" />
          <MetaTag field={poke.item} className="ps-stats-tag ps-stats-tag-item" />
          <SpreadTag info={poke.evs} text={formatEvs(poke.evs, isRandomFormat)} />
          {poke.ivs && formatIvs(poke.ivs) && <SpreadTag info={poke.ivs} text={formatIvs(poke.ivs)} />}
          {poke.teraType.value && (
            <MetaTag
              field={poke.teraType}
              className="ps-stats-tag"
              background={typeBg(poke.teraType.value)}
            >
              {`Tera ${poke.teraType.value}`}
            </MetaTag>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Round 88 (F, #101): the bodies of a side that the log's `|teamsize|` counts and the panel could not fill, in a game without team
 * preview: the engine plays the side with the bodies shown. No stats file (a Random Battle) or an unreachable one leaves this notice.
 */
function missingNotice(log: string, side: 'p1' | 'p2', built: number): string | null {
  const missing = missingBodies(log, built, side);
  const size = teamSizes(log)[side];
  return missing > 0 && size !== null ? `${side.toUpperCase()} never showed ${missing} of ${size} Pokémon. The engine counts only the shown ones.` : null;
}

function TeamColumn({ label, playerName, info, isRandomFormat, notice }: {
  label: string;
  playerName: string;
  info: OpponentTeamInfo;
  isRandomFormat: boolean;
  notice: string | null;
}) {
  // Random battles always run six Pokémon — show the not-yet-revealed slots
  // instead of implying the team is complete (G21).
  const hiddenSlots = isRandomFormat ? Math.max(0, 6 - info.pokemon.length) : 0;

  return (
    <div className="ps-stats-team">
      <div className="ps-stats-header">
        <span className="ps-stats-label">{label}</span> {playerName}
      </div>
      {notice && <div className="ps-stats-notice" style={{ color: '#8899aa', fontSize: 10, marginBottom: 6 }}>{notice}</div>}
      {info.pokemon.map(p => (
        <PokemonEntry key={p.species} poke={p} isRandomFormat={isRandomFormat} />
      ))}
      {Array.from({ length: hiddenSlots }, (_, index) => (
        <div key={`hidden-${index}`} className="ps-stats-pokemon" style={{ opacity: 0.55 }}>
          <div className="ps-stats-sprite" aria-hidden="true" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: '#8899aa',
          }}>?</div>
          <div className="ps-stats-details">
            <div className="ps-stats-species" style={{ color: '#8899aa' }}>Not yet revealed</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Round 84 (turn dock), A7b (ruling 9a): a closed panel at the foot of the right column. The heading stays; the list scrolls inside
 * the panel and fades out over its last 36 px while more follows (stats-panel.css).
 */
export function BattleStatsPanel({ replayData, p1Info, p2Info }: Props) {
  const fadeRef = useScrollFade();
  if (!p1Info && !p2Info) return null;
  const isRandomFormat = (replayData.formatid || '').includes('random');

  return (
    <div className="ps-panel ps-stats-panel" style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>Battle Statistics</div>
      <div className="ps-stats-grid" ref={fadeRef}>
        {p1Info && (
          <TeamColumn label="P1" playerName={replayData.players[0]} info={p1Info} isRandomFormat={isRandomFormat}
            notice={missingNotice(replayData.log, 'p1', p1Info.pokemon.length)} />
        )}
        {p2Info && (
          <TeamColumn label="P2" playerName={replayData.players[1]} info={p2Info} isRandomFormat={isRandomFormat}
            notice={missingNotice(replayData.log, 'p2', p2Info.pokemon.length)} />
        )}
      </div>
    </div>
  );
}
