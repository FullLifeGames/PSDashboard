import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library unmounts on its own only when the runner exposes global
// hooks; Vitest does not, so every test unmounts here. jsdom keeps one window
// per test file, so the preferences and picker toggles the hooks persist in
// localStorage are wiped between tests as well.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
