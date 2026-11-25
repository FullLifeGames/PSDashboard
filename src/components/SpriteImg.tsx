import { useState, type ImgHTMLAttributes } from 'react';
import type { GameRules } from '@fulllifegames/replay-core';
import { baseSpriteUrl, spriteUrl } from '../lib/sprite-url';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  species: string;
  rules: GameRules;
  hideOnMiss?: boolean;
};

/** One fallback: a forme without a sprite file shows the base species' sprite from the Dex (`baseSpriteUrl`). */
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
