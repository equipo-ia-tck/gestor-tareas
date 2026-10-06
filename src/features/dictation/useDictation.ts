import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { normalizeSpoken } from '../../parser/spoken';
import { isDictationSupported, startDictation, type Recognition } from './speech';

/** Estado del dictado. `available` = el navegador lo soporta y está activado en ajustes. */
export function useDictation(onFinal: (text: string) => void) {
  const { settings } = useApp();
  const available = isDictationSupported() && settings.ui.dictation_enabled;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    if (!available || rec.current) return;
    setError(null);
    setInterim('');
    try {
      rec.current = startDictation({
        onInterim: setInterim,
        onFinal: (t) => { if (t) finalRef.current(normalizeSpoken(t)); },
        onError: setError,
        onEnd: () => { rec.current = null; setListening(false); setInterim(''); },
      });
      setListening(!!rec.current);
    } catch (e) {
      rec.current = null;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [available]);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);

  useEffect(() => () => rec.current?.abort(), []);

  return { available, listening, interim, error, start, stop, toggle };
}
