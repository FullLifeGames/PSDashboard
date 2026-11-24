import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { logRules } from '@fulllifegames/replay-core';
import { SpriteImg } from '../../../src/components/SpriteImg';

const rules = logRules('');
const FOLDER = 'https://play.pokemonshowdown.com/sprites/gen5/';

describe('SpriteImg', () => {
  test('a forme without a file falls back to its base species\' sprite, once', () => {
    render(<SpriteImg species="Dragalge-Mega" rules={rules} alt="Dragalge-Mega" />);
    const image = screen.getByRole('img', { name: 'Dragalge-Mega' });
    expect(image).toHaveAttribute('src', `${FOLDER}dragalge-mega.png`);
    fireEvent.error(image);
    expect(image).toHaveAttribute('src', `${FOLDER}dragalge.png`);
    fireEvent.error(image);
    expect(image).toHaveAttribute('src', `${FOLDER}dragalge.png`);
  });

  test('a base species has no fallback; hideOnMiss hides the box after the last miss', () => {
    render(<SpriteImg species="Dragalge" rules={rules} alt="Dragalge" hideOnMiss />);
    const image = screen.getByRole('img', { name: 'Dragalge' });
    fireEvent.error(image);
    expect(image).toHaveAttribute('src', `${FOLDER}dragalge.png`);
    expect(image).not.toBeVisible();
  });

  test('a new species resets the miss: the next forme tries its own file first', () => {
    const { rerender } = render(<SpriteImg species="Dragalge-Mega" rules={rules} alt="mon" />);
    fireEvent.error(screen.getByRole('img', { name: 'mon' }));
    rerender(<SpriteImg species="Garchomp-Mega" rules={rules} alt="mon" />);
    expect(screen.getByRole('img', { name: 'mon' })).toHaveAttribute('src', `${FOLDER}garchomp-mega.png`);
  });
});
