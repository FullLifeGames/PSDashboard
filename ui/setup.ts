import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// The suite runs its files in parallel next to reconstructions and searches;
// a hook that lazy-loads a module can take longer than Testing Library's
// one-second default to settle under that load.
configure({ asyncUtilTimeout: 5_000 });

// Testing Library unmounts on its own only when the runner exposes global
// hooks; Vitest does not, so every test unmounts here. jsdom keeps one window
// per test file, so the preferences and picker toggles the hooks persist in
// localStorage are wiped between tests as well.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
