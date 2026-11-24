import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Files run in parallel next to reconstructions and searches; a lazy-loading hook can pass the one-second default.
configure({ asyncUtilTimeout: 5_000 });

// jsdom lays nothing out: the combo box's "keep the highlight in view" is a no-op here.
Element.prototype.scrollIntoView ??= () => {};

// jsdom has no layout observer; the evaluation graph keeps its default width when nothing reports.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Testing Library unmounts on its own only with global hooks; jsdom keeps one window per file: wipe localStorage too.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
