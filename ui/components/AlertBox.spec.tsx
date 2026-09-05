import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertBox } from '../../src/components/AlertBox';

describe('AlertBox', () => {
  test('renders its content as an alert and takes extra styles', () => {
    render(<AlertBox style={{ marginTop: 6 }}>Could not load the replay.</AlertBox>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load the replay.');
    expect(alert).toHaveStyle({ marginTop: '6px' });
  });
});
