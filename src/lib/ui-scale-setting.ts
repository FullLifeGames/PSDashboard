import { UI_SCALE_STEPS, type UiScaleSetting } from './ui-scale';

/**
 * Round 84 (T315): the "Size" setting of the Setup menu, kept per browser like the app's other settings (the pattern of
 * `eval/sim-fast-setting.ts`). Missing, unreadable or unknown means Auto.
 */
export const UI_SCALE_STORAGE_KEY = 'ps-replay-interceptor:ui-scale';

/** What a stored string means: a known step ("1.5", "2") or Auto. */
export function parseUiScale(raw: string | null | undefined): UiScaleSetting {
  const value = Number(raw);
  return UI_SCALE_STEPS.find(step => step === value) ?? 'auto';
}

export function readUiScale(): UiScaleSetting {
  try {
    return parseUiScale(typeof localStorage !== 'undefined' ? localStorage.getItem(UI_SCALE_STORAGE_KEY) : null);
  } catch {
    // Storage unavailable: Auto.
    return 'auto';
  }
}

export function writeUiScale(setting: UiScaleSetting): void {
  try {
    if (setting === 'auto') localStorage.removeItem(UI_SCALE_STORAGE_KEY);
    else localStorage.setItem(UI_SCALE_STORAGE_KEY, String(setting));
  } catch {
    // Storage unavailable: the choice holds for this page only.
  }
}
