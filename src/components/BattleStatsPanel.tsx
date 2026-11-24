import {
  generatesTeam, inferReplayFormatId, missingBodies, teamSizes,
  type OpponentTeamInfo,
  type PokemonEvsInfo,
  type PokemonFieldInfo,
  type PokemonMoveInfo,
  type ReplayData,
  type RevealedPokemonInfo,
} from '@fulllifegames/replay-core';
import { useScrollFade } from '../hooks/useScrollFade';
import { sourceAccent, sourceLabel } from '../lib/provenance-labels';
import { SpriteImg } from './SpriteImg';
import { useReplayRules } from '../lib/replay-rules';
import { standInMarkOf } from '../lib/stand-in-mark';
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

const EVS_UNKNOWN = 'EVs not yet known';

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
    // Random sets run a fixed 85 EVs everywhere; "0 EVs" would mislead.
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
  const mark = standInMarkOf(poke);
  return (
    <div className="ps-stats-pokemon">
      <SpriteImg
        species={poke.species}
        rules={rules}
        alt={poke.species}
        className="ps-stats-sprite"
      />
      <div className="ps-stats-details">
        <div className="ps-stats-species">
          {poke.species}
          {poke.level !== 100 && <span className="ps-stats-level"> L{poke.level}</span>}
          {poke.gender && <span className="ps-stats-gender"> {poke.gender === 'M' ? '♂' : '♀'}</span>}
        </div>
        {mark && <div className="ps-stats-standin" title={mark.explanation} style={{ color: '#8899aa', fontSize: 10 }}>{mark.text}</div>}
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
          {poke.nature && <MetaTag field={poke.nature} className="ps-stats-tag" />}
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
 * A side whose `|teamsize|` counts bodies the panel could not fill (no team preview, and no stats file or an unreachable one): the engine
 * plays the bodies shown.
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
  // A Random Battle always runs six Pokémon: show the unrevealed slots, not a team that looks complete.
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

export function BattleStatsPanel({ replayData, p1Info, p2Info }: Props) {
  const fadeRef = useScrollFade();
  if (!p1Info && !p2Info) return null;
  const isRandomFormat = generatesTeam(inferReplayFormatId(replayData));

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
