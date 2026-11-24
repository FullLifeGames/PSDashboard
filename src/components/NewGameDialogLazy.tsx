import { lazy, Suspense, useState, type ComponentProps } from 'react';
import type { NewGameDialog } from './NewGameDialog';

// A static import of the dialog from the root would put simulator code in the start load (`build-smoke.spec.ts`).
const Dialog = lazy(() => import('./NewGameDialog').then(loaded => ({ default: loaded.NewGameDialog })));

export function LazyNewGameDialog(props: ComponentProps<typeof NewGameDialog>) {
  const [asked, setAsked] = useState(props.open);
  if (props.open && !asked) setAsked(true);
  if (!asked) return null;
  return <Suspense fallback={null}><Dialog {...props} /></Suspense>;
}
