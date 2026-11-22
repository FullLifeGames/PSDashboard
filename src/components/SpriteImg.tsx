import { useState, type ImgHTMLAttributes } from 'react';
import type { GameRules } from '@fulllifegames/replay-core';
import { baseSpriteUrl, spriteUrl } from '../lib/sprite-url';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  species: string;
  rules: GameRules;
  /** The last miss hides the box (the empty image box and its alt text go). Default: it stays. */
  hideOnMiss?: boolean;
};

/**
 * A species sprite with one fallback (round 89, FB-1): the sprite folder holds no file for some formes (Dragalge-Mega), so a miss shows
 * the base species' sprite, read from the Dex (`baseSpriteUrl`); a miss of that one ends the chain. The state names the files that
 * failed, so a new species starts over without an effect.
 */
export function SpriteImg({ species, rules, hideOnMiss = false, ...image }: Props) {
  const own = spriteUrl(species, rules);
  const base = baseSpriteUrl(species, rules);
  const [failed, setFailed] = useState<string[]>([]);
  const src = failed.includes(own) && base ? base : own;
  const dead = failed.includes(src);
  return (
    <img
      {...image}
      src={src}
      hidden={hideOnMiss && dead ? true : image.hidden}
      onError={() => setFailed(previous => (previous.includes(src) ? previous : [...previous, src]))}
    />
  );
}
