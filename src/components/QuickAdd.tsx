import { useState, type FormEvent } from 'react';
import { repo } from '../data/services';
import type { NewTask } from '../domain/types';

interface Props {
  /** Valores que hereda la tarea según la vista (p. ej. fecha de hoy o proyecto). */
  defaults?: Partial<NewTask>;
  placeholder?: string;
}

/**
 * Alta rápida básica (fase 1). En la fase 2 se sustituye por la barra de captura
 * con sintaxis rápida (Cmd/Ctrl+K).
 */
export function QuickAdd({ defaults, placeholder = 'Añadir tarea y pulsar Enter' }: Props) {
  const [text, setText] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lines = text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    for (const title of lines) await repo.createTask({ ...defaults, title, raw_input: title });
    setText('');
  }

  return (
    <form onSubmit={submit} className="mb-5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
    </form>
  );
}
