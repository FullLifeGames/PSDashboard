import { Protocol } from '@pkmn/protocol';

/** One log line as @pkmn/protocol reads it, with its upgrade of older line forms. */
export interface LogLine {
  raw: string;
  /** The command after the protocol's upgrade; 'done' for "|", '' for a blank line. */
  cmd: string;
  /** The arguments as the protocol returns them; the client reads them unchanged. */
  args: readonly unknown[];
  kwArgs: Readonly<Record<string, string | true | undefined>>;
}

export function readLine(raw: string): LogLine {
  const { args, kwArgs } = Protocol.parseBattleLine(raw);
  return { raw, cmd: String(args[0] ?? ''), args, kwArgs: kwArgs as LogLine['kwArgs'] };
}

/** An argument as text ('' when absent). */
export const arg = (line: LogLine, index: number): string => {
  const value = line.args[index];
  return value === undefined || value === null ? '' : String(value);
};

/** A keyword argument's text ('' when absent or a bare flag like [still]). */
export const kwText = (line: LogLine, key: string): string => {
  const value = line.kwArgs[key];
  return typeof value === 'string' ? value : '';
};

export const hasKw = (line: LogLine, key: string): boolean => line.kwArgs[key] !== undefined;

/** The [from] effect: its name and kind ('item', 'move', 'ability'; '' for a bare effect such as Stealth Rock). */
export function fromEffect(line: LogLine): { name: string; type: string } {
  const effect = Protocol.parseEffect(kwText(line, 'from'));
  return { name: effect.name, type: effect.type ?? '' };
}

/** Whether any argument names this effect, with or without its kind ("ability: Neutralizing Gas"). */
export function namesEffect(line: LogLine, name: string): boolean {
  const texts = [...line.args.slice(1), ...Object.values(line.kwArgs)];
  return texts.some(text => typeof text === 'string' && Protocol.parseEffect(text).name === name);
}

const IDENT = /^p[1-4][a-d]?: /;

/** A Pokémon ident's parts ("p2a: Nick" -> side p2, slot a, name Nick); null for text that names no Pokémon. */
export function identOf(text: string | undefined): { side: string; slot: string; name: string } | null {
  if (!text || !IDENT.test(text)) return null;
  const { player, position, name } = Protocol.parsePokemonIdent(text as Protocol.PokemonIdent);
  return { side: player, slot: position ?? '', name };
}

/** The [of] Pokémon's ident; the '' the protocol leaves after some upgrades counts as none. */
export const ofIdent = (line: LogLine): string | null => (identOf(kwText(line, 'of')) ? kwText(line, 'of') : null);

/** "p2a: Nick" -> "p2: Nick": one Pokémon whatever position it stands in; other text stays as it is. */
export function keyOf(text: string): string {
  const ident = identOf(text);
  return ident ? `${ident.side}: ${ident.name}`.trim() : text.trim();
}

export function detailsOf(text: string | undefined): { species: string; level: number; gender: string } | null {
  if (!text) return null;
  const details = Protocol.parseDetails('', '' as Protocol.PokemonIdent, text as Protocol.PokemonDetails);
  return { species: details.speciesForme.trim(), level: details.level, gender: details.gender ?? '' };
}
