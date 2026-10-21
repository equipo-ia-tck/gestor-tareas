import { useState } from 'react';
import { Copy, MessageSquare } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { routeHref } from '../../app/router';
import { Popover } from '../../components/ui/Popover';
import { useToast } from '../../components/Toast';
import { projectPath } from '../../domain/projects';
import { externalUrl } from '../../domain/releases';
import { teamsChatUrl } from '../../domain/teams';
import { fillTemplate, parseTemplate, templatesFor } from '../../domain/templates';
import { nameKey } from '../../domain/text';
import type { Task } from '../../domain/types';
import { findType } from '../../domain/workflows';

// Las plantillas son archivos del repositorio (plantillas/*.md) y entran en la app al compilar.
const files = import.meta.glob('/plantillas/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const MESSAGE_TEMPLATES = Object.entries(files)
  .filter(([path]) => !path.endsWith('/README.md'))
  .map(([path, raw]) => parseTemplate(path.split('/').pop()!.replace(/\.md$/, ''), raw))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'));

/** Prepara un mensaje a partir de una plantilla y lo copia o lo abre en un chat de Teams. */
export function MessageButton({ task, className }: { task: Task; className: string }) {
  const { itemTypes } = useApp();
  const options = templatesFor(MESSAGE_TEMPLATES, findType(itemTypes, task.type_id));
  if (!options.length) return <span className="px-2 text-xs text-zinc-400">No hay plantillas para este tipo (carpeta plantillas/)</span>;
  return (
    <Popover width="w-[26rem]" trigger={(toggle) => (
      <button type="button" onClick={toggle} className={`${className} flex items-center gap-1.5 text-left text-indigo-600 dark:text-indigo-400`}>
        Preparar mensaje<span className="text-xs text-zinc-400">({options.length === 1 ? options[0].name : `${options.length} plantillas`})</span>
      </button>
    )}>
      {(close) => <Composer task={task} close={close} />}
    </Popover>
  );
}

function Composer({ task, close }: { task: Task; close: () => void }) {
  const { itemTypes, projectMap, peopleCards } = useApp();
  const toast = useToast();
  const type = findType(itemTypes, task.type_id);
  const options = templatesFor(MESSAGE_TEMPLATES, type);
  const [templateId, setTemplateId] = useState(options[0].id);
  const fill = (id: string) => fillTemplate(options.find((t) => t.id === id) ?? options[0], task, {
    type,
    projectPath: task.project_id ? projectPath(task.project_id, projectMap) : undefined,
    link: externalUrl(task, type),
  });
  const [text, setText] = useState(() => fill(templateId));

  const people = task.people.map((name) => ({ name, email: peopleCards.find((p) => nameKey(p.name) === nameKey(name))?.email ?? '' }));
  const missing = people.filter((p) => !p.email);
  const topic = [task.external_id, task.title].filter(Boolean).join(' · ');
  const teams = teamsChatUrl(people.map((p) => p.email), topic, text);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Mensaje copiado');
      close();
    } catch {
      toast('No se pudo copiar: selecciona el texto y cópialo a mano');
    }
  };

  return (
    <div className="space-y-2 p-2 text-sm">
      {options.length > 1 && (
        <select value={templateId} aria-label="Plantilla" onChange={(e) => { setTemplateId(e.target.value); setText(fill(e.target.value)); }}
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
          {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} aria-label="Mensaje"
        className="w-full resize-y rounded-md border border-zinc-200 bg-white p-2 font-sans text-sm leading-relaxed dark:border-zinc-700 dark:bg-zinc-900" />
      {missing.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Para abrir el chat en Teams falta el email de{' '}
          {missing.map((p, i) => (
            <span key={p.name}>{i > 0 && ', '}<a href={routeHref({ view: 'person', name: p.name })} className="underline" onClick={close}>{p.name}</a></span>
          ))}{' '}(en su ficha).
        </p>
      )}
      {!people.length && <p className="text-xs text-zinc-500">Añade personas a la tarea para abrir el chat en Teams.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => void copy()} className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          <Copy className="size-3.5" />Copiar
        </button>
        {teams && (
          <a href={teams} target="_blank" rel="noreferrer" onClick={close}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500">
            <MessageSquare className="size-3.5" />Abrir en Teams{people.length - missing.length > 1 ? ' (chat de grupo)' : ''}
          </a>
        )}
      </div>
    </div>
  );
}
