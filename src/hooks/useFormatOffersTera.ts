import { useEffect, useState } from 'react';

/** Whether the simulator lets a format Terastallize, and whether the lazy probe still owes its answer. */
export function useFormatOffersTera(formatId: string, wanted: boolean): { offers: boolean; pending: boolean } {
  const [answer, setAnswer] = useState<{ formatId: string; offers: boolean } | null>(null);
  useEffect(() => {
    if (!wanted) return undefined;
    let current = true;
    void import('../lib/tera-offer').then(({ teraBanned }) => {
      if (current) setAnswer({ formatId, offers: !teraBanned(formatId) });
    });
    return () => { current = false; };
  }, [formatId, wanted]);
  const answered = answer?.formatId === formatId;
  return { offers: wanted && answered && answer.offers, pending: wanted && !answered };
}
