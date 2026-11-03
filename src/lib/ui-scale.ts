/**
 * Round 84 (T315): the size the app takes in a large window. One rule in one module: the steps, the room Auto asks for, and the
 * width below which the narrow layout begins. The window is measured in CSS pixels, so a browser zoom already set counts and never
 * doubles: a window of 2560 x 1290 at a browser zoom of 150 % reads 1707 x 860 and stays at 100 %.
 */

/** The sizes the app can take, as factors: 100 to 200 % in steps of 25 %. */
export const UI_SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;

export type UiScaleStep = (typeof UI_SCALE_STEPS)[number];

/** The user's choice: Auto, or one fixed step. */
export type UiScaleSetting = 'auto' | UiScaleStep;

/** The room Auto keeps for the app after the scale: the width of the app's layout column and the height the dock, the replay and the timeline need. */
export const UI_SCALE_ROOM = { width: 1400, height: 820 } as const;

/**
 * The window width below which the stacked layout of the narrow windows begins (the 1050 px media blocks of the stylesheets). A step
 * that leaves the app less width than this is disabled.
 */
export const STACK_BREAKPOINT = 1050;

export interface WindowSize { width: number; height: number }

/** The largest step at which the window still gives the app the room of `UI_SCALE_ROOM`; 100 % when even that is short. */
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

/** The reason a step is disabled, in the Setup menu's words; null when it is allowed. */
export function stepDisabledReason(step: UiScaleStep, width: number): string | null {
  if (stepAllowed(step, width)) return null;
  return `Needs a window at least ${Math.ceil(STACK_BREAKPOINT * step)} px wide`;
}

/**
 * The factor the page takes: Auto's, or the chosen step. A chosen step that the window no longer allows (it shrank after the
 * choice) falls back to the largest allowed step below it, so the stacked layout never begins by the scale's doing.
 */
export function resolveScale(setting: UiScaleSetting, size: WindowSize): UiScaleStep {
  if (setting === 'auto') return autoScale(size);
  const allowed = UI_SCALE_STEPS.filter(step => step <= setting && stepAllowed(step, size.width));
  return allowed[allowed.length - 1] ?? UI_SCALE_STEPS[0];
}

/** The label of a setting in the menu: "Auto" or "150 %". */
export function scaleLabel(setting: UiScaleSetting): string {
  return setting === 'auto' ? 'Auto' : `${Math.round(setting * 100)} %`;
}
