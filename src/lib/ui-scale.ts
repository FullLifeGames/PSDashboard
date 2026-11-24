
export const UI_SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;

export type UiScaleStep = (typeof UI_SCALE_STEPS)[number];

export type UiScaleSetting = 'auto' | UiScaleStep;

// The smallest window at which the left column does not scroll (sweet-spot.spec): 670 to 980 px high, 1,060 wide.
export const UI_SCALE_ROOM = { width: 1400, height: 820 } as const;

/** The 1050 px media blocks of the stylesheets; a step that leaves less width is disabled. */
export const STACK_BREAKPOINT = 1050;

export interface WindowSize { width: number; height: number }

export function autoScale({ width, height }: WindowSize): UiScaleStep {
  let best: UiScaleStep = UI_SCALE_STEPS[0];
  for (const step of UI_SCALE_STEPS) {
    if (width / step >= UI_SCALE_ROOM.width && height / step >= UI_SCALE_ROOM.height) best = step;
  }
  return best;
}

export function stepAllowed(step: UiScaleStep, width: number): boolean {
  return step === UI_SCALE_STEPS[0] || width / step >= STACK_BREAKPOINT;
}

export function stepDisabledReason(step: UiScaleStep, width: number): string | null {
  if (stepAllowed(step, width)) return null;
  return `Needs a window at least ${Math.ceil(STACK_BREAKPOINT * step)} px wide`;
}

export function resolveScale(setting: UiScaleSetting, size: WindowSize): UiScaleStep {
  if (setting === 'auto') return autoScale(size);
  const allowed = UI_SCALE_STEPS.filter(step => step <= setting && stepAllowed(step, size.width));
  return allowed[allowed.length - 1] ?? UI_SCALE_STEPS[0];
}

export function scaleLabel(setting: UiScaleSetting): string {
  return setting === 'auto' ? 'Auto' : `${Math.round(setting * 100)} %`;
}
