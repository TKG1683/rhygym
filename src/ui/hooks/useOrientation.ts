/**
 * useOrientation — tiny React hook around `matchMedia("(orientation: ...)")`
 * for the two-hand mode's "横にしてね" guide (#83 Phase C).
 *
 * Subscribes to the orientation media query and re-renders the
 * caller whenever the device flips. Returns 'portrait' / 'landscape'
 * — null only briefly during the first SSR-style render where
 * `window` isn't available (we're a pure client app so this is
 * effectively defensive).
 */

import { useEffect, useState } from 'react';

export type Orientation = 'portrait' | 'landscape';

export function useOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(() => readOrientation());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(orientation: portrait)');
    const handler = () => setOrientation(mql.matches ? 'portrait' : 'landscape');
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return orientation;
}

function readOrientation(): Orientation {
  if (typeof window === 'undefined' || !window.matchMedia) return 'landscape';
  return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
}
