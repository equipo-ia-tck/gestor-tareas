/**
 * Envoltorio mínimo de la Web Speech API. En Chrome el audio se procesa en servidores de Google,
 * por eso el dictado está desactivado por defecto y se avisa al activarlo.
 */

interface RecognitionAlternative { transcript: string }
interface RecognitionResult { isFinal: boolean; 0: RecognitionAlternative; length: number }
interface RecognitionEvent { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } }
interface RecognitionErrorEvent { error: string }

export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isDictationSupported = () => getRecognitionCtor() !== null;

export function dictationErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed': return 'No hay permiso para usar el micrófono.';
    case 'network': return 'El dictado necesita conexión a internet.';
    case 'no-speech': return 'No se ha oído nada.';
    case 'audio-capture': return 'No se encuentra ningún micrófono.';
    case 'aborted': return '';
    default: return `Error de dictado (${code}).`;
  }
}

export interface DictationHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

/** Empieza a escuchar en español; se detiene sola tras una pausa. Devuelve la instancia para pararla. */
export function startDictation(h: DictationHandlers): Recognition | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = 'es-ES';
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) h.onFinal(res[0].transcript.trim());
      else interim += res[0].transcript;
    }
    h.onInterim(interim.trim());
  };
  r.onerror = (e) => {
    const msg = dictationErrorMessage(e.error);
    if (msg) h.onError(msg);
  };
  r.onend = () => h.onEnd();
  r.start();
  return r;
}
