/**
 * The size the app takes in a large window: the steps, the room Auto asks for, and the width below which the narrow layout begins.
 * The window is measured in CSS pixels, so a browser zoom already set never doubles (2560 x 1290 at 150 % reads 1707 x 860, stays at 100 %).
 */

export const UI_SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;

export type UiScaleStep = (typeof UI_SCALE_STEPS)[number];

export type UiScaleSetting = 'auto' | UiScaleStep;

/**
 * The room Auto keeps for the app after the scale: the width of the layout column and the height the dock, the replay and the
 * timeline need. The smallest window at which the left column does not scroll (sweet-spot.spec): 670 px high on a singles replay turn,
 * 720 doubles, 920 singles and 980 doubles in a variation with the history panel, 1,060 px wide.
 */
export const UI_SCALE_ROOM = { width: 1400, height: 820 } as const;

/**
 * The window width below which the stacked layout of the narrow windows begins (the 1050 px media blocks of the stylesheets); a step that
 * leaves less width is disabled.
 */
export const STACK_BREAKPOINT = 1050;

export interface WindowSize { width: number; height: number }

export function autoScale({ width, height }: WindowSize): UiScaleStep {
  let best: UiScaleStep = UI_SCALE_STEPS[0];
  for (const step of UI_SCALE_STEPS) {
    if (width / step >= UI_SCALE_ROOM.width && height / step >= UI_SCALE_ROOM.height) best = step;
  }
  return best;
}

/** Whether a step leaves the app the width of the two-column layout. 100 % is always allowed: it is the app's own size. */
export function stepAllowed(step: UiScaleStep, width: number): boolean {
  return step === UI_SCALE_STEPS[0] || width / step >= STACK_BREAKPOINT;
}

export function stepDisabledReason(step: UiScaleStep, width: number): string | null {
  if (stepAllowed(step, width)) return null;
  return `Needs a window at least ${Math.ceil(STACK_BREAKPOINT * step)} px wide`;
}

/**
 * The factor the page takes: Auto's, or the chosen step; a chosen step the window no longer allows falls back to the largest allowed step
 * below it.
 */
export function resolveScale(setting: UiScaleSetting, size: WindowSize): UiScaleStep {
  if (setting === 'auto') return autoScale(size);
  const allowed = UI_SCALE_STEPS.filter(step => step <= setting && stepAllowed(step, size.width));
  return allowed[allowed.length - 1] ?? UI_SCALE_STEPS[0];
}

export function scaleLabel(setting: UiScaleSetting): string {
  return setting === 'auto' ? 'Auto' : `${Math.round(setting * 100)} %`;
}
