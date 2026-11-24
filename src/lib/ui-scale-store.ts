import { autoScale, resolveScale, type UiScaleSetting, type UiScaleStep, type WindowSize } from './ui-scale';
import { readUiScale, writeUiScale } from './ui-scale-setting';

// innerWidth and innerHeight never see the root's `zoom` (CSS pixels of the browser's own zoom), so the scale never
// doubles one; base.css turns `--ps-scale` into the root's `zoom` and divides the vh and vw rules by it.

export const UI_SCALE_PROPERTY = '--ps-scale';

export const UI_SCALE_EVENT = 'ps-ui-scale';

export interface UiScaleState {
  setting: UiScaleSetting;
  scale: UiScaleStep;
  /** The step Auto gives this window, whatever the user chose (the menu names it on its Auto entry). */
  auto: UiScaleStep;
  width: number;
}

const listeners = new Set<() => void>();
let state: UiScaleState | null = null;

const windowSize = (): WindowSize => ({ width: window.innerWidth, height: window.innerHeight });

function compute(setting: UiScaleSetting): UiScaleState {
  const size = windowSize();
  return { setting, scale: resolveScale(setting, size), auto: autoScale(size), width: size.width };
}

export function getUiScaleState(): UiScaleState {
  state ??= compute(readUiScale());
  return state;
}

export function subscribeUiScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** What the measuring hooks divide a visual length by. */
export function appliedUiScale(root: HTMLElement = document.documentElement): number {
  const value = Number(root.style.getPropertyValue(UI_SCALE_PROPERTY));
  return value > 0 ? value : 1;
}

function writeRoot(root: HTMLElement, scale: UiScaleStep): void {
  if (scale === 1) root.style.removeProperty(UI_SCALE_PROPERTY);
  else root.style.setProperty(UI_SCALE_PROPERTY, String(scale));
}

function adopt(next: UiScaleState, root: HTMLElement): void {
  const before = state;
  if (before && before.scale === next.scale && before.auto === next.auto && before.setting === next.setting && before.width === next.width) return;
  state = next;
  const moved = !before || before.scale !== next.scale;
  if (moved) writeRoot(root, next.scale);
  listeners.forEach(listener => listener());
  if (moved) window.dispatchEvent(new Event(UI_SCALE_EVENT));
}

let activeRoot: HTMLElement | null = null;

export function setUiScaleSetting(setting: UiScaleSetting): void {
  writeUiScale(setting);
  adopt(compute(setting), activeRoot ?? document.documentElement);
}

export function startUiScale(root: HTMLElement = document.documentElement): () => void {
  activeRoot = root;
  state = null;
  adopt(compute(readUiScale()), root);
  const onResize = () => adopt(compute(getUiScaleState().setting), root);
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    root.style.removeProperty(UI_SCALE_PROPERTY);
    activeRoot = null;
  };
}
