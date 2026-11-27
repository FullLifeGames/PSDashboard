import { useEffect, useState } from 'react';

/** Whether the simulator lets a format Terastallize; false until the lazy probe answers or while `wanted` is off. */
export function useFormatOffersTera(formatId: string, wanted: boolean): boolean {
  const [answer, setAnswer] = useState<{ formatId: string; offers: boolean } | null>(null);
  useEffect(() => {
    if (!wanted) return undefined;
    let current = true;
    void import('../lib/tera-offer').then(({ teraBanned }) => {
      if (current) setAnswer({ formatId, offers: !teraBanned(formatId) });
    });
    return () => { current = false; };
  }, [formatId, wanted]);
  return wanted && answer?.formatId === formatId && answer.offers;
}
