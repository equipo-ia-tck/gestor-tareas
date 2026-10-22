import type { NewTask } from '../domain/types';
import { CaptureInput } from '../features/capture/CaptureInput';
import { useCommandCenter } from '../features/command/CommandCenter';

interface Props {
  /** Valores que hereda la tarea según la vista, si el texto no indica otra cosa. */
  defaults?: Partial<NewTask>;
  placeholder?: string;
  seed?: { text: string; n: number } | null;
}

/** Captura en línea al principio de cada vista. Misma sintaxis que Cmd/Ctrl+K. */
export function QuickAdd({ defaults, placeholder, seed }: Props) {
  const { open } = useCommandCenter();
  return (
    <div className="mb-5">
      <CaptureInput
        defaults={defaults}
        placeholder={placeholder}
        seed={seed}
        onCommandMode={(query) => open({ kind: 'palette', query })}
      />
    </div>
  );
}
