# CLAUDE.md

Gestor de tareas personal, solo frontend. La especificación completa está en `SPEC.md`; aquí van las decisiones de arquitectura tomadas al implementarla.

## Principio rector

Capturar una tarea debe costar menos de 5 segundos y la app no debe exigir mantenimiento manual. Si algo añade fricción o trabajo manual, se descarta.

## Stack

Vite 8, React 19, TypeScript 7, Tailwind 4 (plugin `@tailwindcss/vite`, modo oscuro por `prefers-color-scheme`), Dexie 4 + `dexie-react-hooks`, zod 4 y Vitest 5 con `fake-indexeddb`. Los tests corren con `TZ=Europe/Madrid` (definido en `tests/setup.ts`).

## Estructura

```
src/
  domain/     tipos, esquemas zod, fechas, selectores, recurrencia (nextOccurrence) y texto (fold, búsqueda difusa),
              maintenance.ts (repartir, obsoletas, resumen del día, siguiente ocurrencia), search.ts.
              Funciones puras y testeadas, sin React ni Dexie.
  parser/     parseCapture(texto, ctx) => ParsedTask[]: patterns.ts (expresiones regulares en español + respaldo chrono),
              fields.ts (campos editables)
  data/       db.ts (Dexie y migraciones), repository.ts (interfaz Repository + DexieRepository),
              backup.ts (validar, exportar, recordatorio), fsAutosave.ts (File System Access), services.ts (instancias únicas)
  hooks/      useData (useLiveQuery sobre el repositorio), useTaskActions (acciones con aviso "Deshacer")
  components/ UI reutilizable: TaskRow, TaskList/Section, TaskDetailPanel, FieldEditor, QuickAdd, Modal, Toast;
              ui/ (Badges, Popover, DatePicker, ProjectOptions, ViewSwitcher)
  features/   views/ (Hoy, 7 días, Bandeja, Proyectos, Personas), backup/ (Copias y ajustes, recordatorio),
              capture/ (CaptureInput: resaltado, autocompletado, chips; submitCapture), command/ (modal Cmd+K,
              paleta, comandos, atajos globales, chuleta), selection/ (selección, teclado, barra en bloque),
              history/ (avisos de deshacer y Ctrl/Cmd+Z), maintenance/ (atrasadas, repartir, obsoletas),
              summary/ (resumen del día), dictation/ (Web Speech API)
  app/        App, Sidebar, router por hash, AppContext (datos compartidos y editor)
tests/        Vitest: dominio, copias y repositorio
```

## Decisiones

- **Bandeja derivada.** `status` solo admite `todo | done | archived`. Una tarea está en la bandeja si está activa y no tiene ni fecha ni proyecto (`isInbox`). Así nunca hay que sincronizar ese estado a mano.
- **`due_date` como `YYYY-MM-DD` local** (`ISODate`), sin hora ni zona horaria. Todas las operaciones de fecha están en `domain/dates.ts`.
- **IDs UUID** (`crypto.randomUUID`), para poder importar copias y sincronizar en el futuro sin choques.
- **Borrado suave** con `deleted_at`: hace posible deshacer. `purgeDeleted(30)` se ejecuta al arrancar. `listTasks()` nunca devuelve tareas borradas.
- **Campos añadidos a la especificación:** `series_id` (ocurrencias de una recurrente), `sort_order` (orden manual) y `deleted_at`. `recurrence_rule` es un objeto estructurado (`RecurrenceRule`), no un texto.
- **Capa de repositorio.** Los componentes nunca importan Dexie: usan `repo` (interfaz `Repository`). Cada mutación llama a `emit()`, que dispara la copia automática. `markBackup()` no emite, para evitar un bucle.
- **Lectura en memoria.** Las vistas cargan todas las tareas no borradas con `useLiveQuery(repo.listTasks)` y filtran con selectores puros. Con volúmenes personales (miles de tareas) es instantáneo y deja la lógica testeable. Los índices de Dexie (`*people`, `*tags`, `due_date`…) quedan disponibles por si hiciera falta.
- **Tablas `settings` y `meta`.** `settings` guarda un único registro (`key: 'settings'`) validado con zod al leerlo y entra en las copias. `meta` guarda estado local del dispositivo (el handle del archivo vinculado) y no entra en las copias.
- **Migraciones.** Hay que añadir `this.version(n)` en `db.ts` y subir `SCHEMA_VERSION`. `parseBackup` rechaza copias con un esquema más nuevo que el de la app.
- **Importar.** Primero se valida con zod (incluida la integridad entre tareas y proyectos), después se muestra un resumen y solo entonces se sobrescribe. Antes de sobrescribir se guarda una instantánea en memoria para poder deshacer.
- **Copia automática en archivo.** El `FileSystemFileHandle` se guarda en `meta`. Tras recargar, Chrome exige un gesto del usuario para reconceder el permiso, y el aviso "Reactivar copia automática" aparece en `BackupReminder`. Escribe con un debounce de 2 s y actualiza `last_backup_at`.
- **Router por hash** (`#/today`, `#/project/:id`…). No necesita configuración de servidor y funciona en GitHub Pages y sin conexión.
- **Alta rápida.** `QuickAdd` (en cada vista) y el modal Cmd+K usan el mismo `CaptureInput`.
- **Deshacer global (fase 3).** El repositorio guarda en el historial el estado anterior y posterior de cada registro que cambia
  (tareas y proyectos). `repo.batch(label, fn)` agrupa varias mutaciones en una sola entrada; los lotes anidados se suman
  al exterior. `undo`/`redo` reaplican los estados en una transacción. `HistoryBridge` muestra el aviso "Deshacer" de cada
  entrada nueva y gestiona Ctrl/Cmd+Z y Ctrl/Cmd+Shift+Z (fuera de campos de texto, donde manda el deshacer nativo).
  No entran en el historial los ajustes, `markBackup` ni la purga. Importar vacía el historial. Límite: 100 entradas, solo
  en memoria (se pierde al recargar).
- **Etiquetas de acción.** Las acciones de UI van por `useTaskActions` (o `repo.batch`) con una etiqueta legible:
  es lo que se ve en el aviso. No hace falta mostrar avisos a mano.

## Parser de captura (fase 2)

- **Interfaz estable** `ParseCapture` en `parser/types.ts`: se podrá sustituir por IA sin tocar la UI.
- **Orden de extracción**: tokens con símbolo (`#` `@` `!` `~` `+`) → recurrencia → fecha. Cada token reserva su rango,
  así "cada lunes" no se lee también como "el lunes" y "#mañana" no es una fecha.
- **Fechas propias antes que chrono**: chrono-es falla en "pasado mañana", "el lunes" dicho en lunes y "a las 5".
  chrono solo se usa de respaldo y únicamente si el resultado tiene día y mes seguros y contiene un número.
- **Reglas de fechas**: "el X" dicho en día X → la semana siguiente ("este X" → hoy). Fecha sin año ya pasada → año
  siguiente. "fin de mes" → último día del mes. "la semana que viene" → próximo lunes. "por la mañana" no es fecha.
  "los lunes" (sin "cada"/"todos") no es fecha ni recurrencia.
- **Recurrencia sin fecha** → `due_date` = primera ocurrencia desde hoy (incluido). Con fecha, "cada mes/semana" se ancla
  en ella.
- **Títulos**: se eliminan los tokens salvo `@persona`, que se queda como nombre ("a @Diana" → "a Diana").
- **Descartar chips**: la UI pasa `ctx.ignore` con claves `tipo:texto` (ver `tokenKey`); el fragmento se trata como
  texto y se reserva para que ningún otro extractor lo use. Clave por texto, no por posición, para sobrevivir a ediciones.
- **Nombres**: `nameKey` ignora mayúsculas, tildes y separadores; `#fundacion-cadete` = "Fundación Cadete". El
  autocompletado inserta nombres con espacios convertidos en guiones.
- **Captura**: lo detectado manda sobre los valores por defecto de la vista (fecha de Hoy, proyecto actual…). Los proyectos
  nuevos se crean al enviar, una vez por lote. Las tareas sin título no se crean.

## Interacción (fase 3)

- **Selección** en `SelectionProvider`: `selected` (conjunto), `focused` (cursor) y `editing` (tarea y campo en edición).
  Clic = seleccionar solo esa, Cmd/Ctrl+clic = añadir o quitar, Shift+clic = rango desde el ancla. El orden para rangos
  y para J/K sale del DOM (`[data-task-id]` dentro de `main`), así funciona igual en todas las vistas y secciones.
- **`targetsFor(id)`**: si la tarea forma parte de la selección, la acción se aplica a toda la selección; si no, solo a ella.
  Lo usan el teclado, la barra en bloque, el editor de campos y el arrastre.
- **Edición en línea**: doble clic sobre un campo (`data-field`) o tecla (Enter = título, D = fecha, M = proyecto).
  `FieldEditor` interpreta texto libre con `parser/fields.ts` ("vie", "15 oct", "1h30") y muestra una vista previa.
- **Arrastrar y soltar**: HTML5 nativo con el tipo MIME propio `application/x-gestor-task-ids` (lista de ids). Destinos:
  secciones de día (7 días, Para hoy), "Sin fecha" de un proyecto y, en la barra lateral, Hoy, Bandeja y cada proyecto.
- **Búsqueda**: ruta `#/search/<consulta>` y buscador en la barra lateral (`/`). `domain/search.ts`: palabras sin tildes
  en título, notas, proyecto, personas y etiquetas. Filtros `#`, `@` y `+` por prefijo; `todas:` incluye completadas.
- **Orden de los listeners de teclado**: `SelectionProvider` envuelve a `CommandCenterProvider`. Los efectos hijos se
  registran antes, así que el centro de comandos (N, G+letra, ?, /) procesa la tecla primero y marca `preventDefault`;
  la selección ignora los eventos ya gestionados.

## Reglas automáticas (fase 4)

Todo en `domain/maintenance.ts`, con funciones puras y tests (`tests/maintenance.test.ts`).

- **Recurrentes**: `repo.setCompleted` crea la siguiente ocurrencia dentro del mismo lote, así un solo "Deshacer" lo
  revierte todo. Fecha = `nextDueAfterCompletion`: parte de la fecha de la tarea y salta las ocurrencias pasadas sin ir
  más allá de hoy (completar tarde una diaria no deja cola de atrasadas, pero la de hoy sigue pendiente). No se crea
  ocurrencia si la serie (`series_id`) ya tiene una pendiente: desmarcar y volver a completar no duplica.
- **Atrasadas** (`OverdueBlock`): hoy, mañana, la semana que viene (próximo lunes), sin fecha o eliminar, y para todas,
  "Todas a hoy" y "Repartir…".
- **Repartir** (`distributeOverdue`): orden por prioridad, después fecha más antigua y antigüedad. Reparte en los
  próximos días laborables (desde hoy si lo es, hasta 30) restando lo ya previsto cada día. Sin estimación = 30 min
  (`DEFAULT_ESTIMATE_MINUTES`). Si una tarea no cabe en ningún día, va al que tiene más hueco. Antes de aplicar se ve una
  vista previa (`DistributePreview`, modo `distribute` del centro de comandos).
- **Obsoletas** (`staleTasks`): activas con `last_touched_at` de hace más de 30 días, excluidas las atrasadas (ya tienen
  su bloque). Nunca se archivan solas: "Archivar" pone `status: 'archived'` y "Mantener" solo renueva `last_touched_at`.
- **Resumen del día** (`dailySummary`): las 3 más importantes entre las de hoy y las atrasadas (prioridad, vencimiento,
  antigüedad); si faltan, se completa con las de prioridad 1-2 de los próximos 7 días o sin fecha. Muestra atrasadas,
  carga frente a capacidad y aviso de sobrecarga. Al cerrarlo se guarda `settings.ui.summary_dismissed_on`, así que no
  vuelve ese día. El comando "Ver resumen del día" lo reabre.

## PWA (fase 5)

- **Dictado**: se quitó en la fase 14 (enviaba el audio fuera y no se usaba).
- **PWA** con `vite-plugin-pwa` (`generateSW`, `registerType: 'autoUpdate'`): precachea todo el bundle e iconos, con
  `navigateFallback: index.html` (las rutas van por hash). Los iconos PNG (192, 512 y maskable) salen de `public/icon.svg`.
  En desarrollo no se registra el service worker: para probar sin conexión, `npm run build && npm run preview`.
- **Instalación**: `app/install.ts` guarda `beforeinstallprompt` al arrancar y la tarjeta de ajustes ofrece "Instalar app".
- **Ojo**: IndexedDB va por origen. Desarrollo (5173), preview (4173) y producción tienen datos separados.
  **La app de la usuaria es la de 4173** (`npm start` = build + preview en el puerto 4173 fijo). El 5173 es solo para
  desarrollar y probar cambios; no hay que pedirle que lo abra.

## Atajos (fase 2)

Atajos globales en `CommandCenterProvider`: Cmd/Ctrl+K captura, Cmd/Ctrl+Shift+P paleta, `>` al principio de la captura
pasa a la paleta, `N`/`Q` captura, `G`+letra navega, `?` chuleta. Los atajos de una tecla se ignoran si el foco está
en un campo editable o hay un diálogo abierto.

## v2 · espacio de trabajo (fase 6: lo visual)

Petición de la usuaria (7 oct 2026): más visual (Asana, To Do, Trello, Notion), registro de lo hecho y lo que no, notas de
reunión, estado de US (User Stories) y TS (Test Scenarios), releases, quién dijo qué y recordatorios.

- **Esquema v2** (`db.ts`, migración automática desde v1): tablas `labels` (color por nombre de etiqueta) e `item_types`
  (tipos con flujo de estados). En las tareas, `type_id`, `state_id` y `checklist`. `SCHEMA_VERSION = 2`; las copias v1 se
  siguen importando (zod completa los campos y `state_id` sale de `status`).
- **Tipos y estados** (`domain/workflows.ts`): Tarea, User Story y Test Scenario, cada uno con estados de color y una
  categoría (`todo | doing | blocked | done`). `status` sigue siendo la fuente de verdad de pendiente/completada/archivada,
  así que las reglas de las fases 1-5 no cambian. Se mantiene sincronizado con el estado: `setCompleted` pone el primer estado
  "done" (o el inicial al reabrir) y `setState` a un estado "done" completa la tarea (pasando por `setCompleted`, para que las
  recurrentes generen la siguiente). `setType` busca un estado equivalente por categoría.
- **Etiquetas**: siguen siendo `tags: string[]`. La tabla `labels` solo guarda colores personalizados; sin fila, el color
  sale de `colorFor(nombre)` (estable). Renombrar y eliminar se aplican a todas las tareas en un lote deshacible. El
  historial cubre ahora también las tablas `labels` e `item_types`.
- **Panel de detalle** (`TaskDetailPanel`, sustituye al modal `TaskEditor`): tipo, estado, título, propiedades, pasos con
  progreso y reordenación por arrastre, y notas. Cada cambio es una entrada del historial. En pantallas de 1280 px o más es
  una tercera columna; por debajo se superpone. Esc dentro de un campo sale del campo y un segundo Esc cierra el panel.
- **Lista de proyecto** al estilo Asana: secciones por categoría de estado (En curso, Bloqueadas, Por hacer, Completadas);
  soltar en una sección pasa cada tarea al primer estado de esa categoría dentro de su propio flujo.
- **Tablero** (`features/board`): columnas = estados de un tipo (pestañas Tarea/US/TS). Arrastrar llama a `setState`. Las
  completadas de hace más de 14 días no se muestran. Alta en cada columna con la sintaxis de captura. Hay un tablero global
  (`#/board`, `G T`) con filtro por proyecto y el modo Lista/Tablero de cada proyecto, ambos recordados en localStorage
  (`usePersistentState`).
- **Ancho**: las vistas de tablero piden todo el ancho con `useWideLayout(true)`.
- Iconos con `lucide-react`. Componentes visuales en `components/ui/` (`Badges`, `Popover`, `ViewSwitcher`).

## Fase 7: US/TS, releases y calendario

- **Esquema v3**: en las tareas, `external_id`, `url` y `release_id` (con índices `release_id` y `external_id`); tabla
  `releases` (`name`, `date`, `project_id`, `status: planned | released | cancelled`, `notes`). En los tipos,
  `url_template` opcional. Las copias v1 y v2 se siguen importando (zod pone `null` en los campos que faltan).
- **Enlaces** (`domain/releases.ts`, `externalUrl`): el `url` explícito manda; si no hay, se usa la plantilla del tipo
  sustituyendo `{id}` por el ID externo.
- **Sintaxis de captura**: las claves en mayúsculas tipo Jira (`US-1234`, `QA2-17`) son `external_id` y salen del título;
  si el prefijo coincide con la abreviatura de un tipo, la tarea se crea de ese tipo. Las minúsculas (`covid-19`) no cuentan.
  `^nombre` asigna la release, que se crea si no existe (una vez por lote, con el proyecto de la tarea). El autocompletado
  cubre `^`.
- **Personas en el título**: el nombre se queda solo detrás de una preposición o conjunción ("a @Diana", "con @Luis");
  suelto ("revisar login @Diana") se quita.
- **Releases** (`#/releases`, `G R`): agrupadas en pasadas sin publicar, próximas y publicadas/canceladas. Cada tarjeta
  muestra la cuenta atrás, el progreso (terminadas y bloqueadas) y una barra por tipo con el reparto de estados
  (`releaseProgress`). Al eliminar una release se quita de sus tareas en un lote deshacible.
- **Calendario** (`#/calendar`, `G C`): mes de lunes a domingo (`monthGrid`) con vencimientos y releases; soltar una
  tarea en un día cambia su fecha. El mes visible y "mostrar completadas" se recuerdan en localStorage.
- **Configurar tipos** (Ajustes → Tipos y estados): nombre, abreviatura, color, plantilla y estados (añadir, renombrar,
  recolorear, categoría, reordenar, eliminar). `saveItemType` pasa las tareas de estados eliminados al equivalente por
  categoría; `deleteItemType` pasa las tareas a Tarea (Tarea no se puede eliminar). Todo entra en el historial.
- **Tablero global**: filtro por release; las tarjetas nuevas heredan la release filtrada.

## Fase 8: notas, actas y personas

- **Esquema v4**: tabla `notes` (`title`, `body` en Markdown, `kind: meeting | note`, `date`, `project_id`, `people`
  derivado de las @menciones, `pinned`, borrado suave con `deleted_at`) y tabla `people` (fichas por nombre: `role` y
  `notes`). Tipo nuevo **Tema** (`TOPIC_TYPE_ID`, estados Pendiente/Hablado) para los temas pendientes con alguien: son
  tareas normales (completar, deshacer, buscar…), pero no entran en la Bandeja.
- **Markdown propio** (`domain/markdown.ts`, sin dependencias ni innerHTML): bloques por línea (encabezados, listas,
  acciones `- [ ]`, citas, separadores) e inlines (negrita, cursiva, código, enlaces, @persona, #proyecto, claves
  `US-123`). Las acciones enlazadas llevan `[[t:<id>]]` al final de la línea.
- **Editor** (`features/notes/NoteEditor.tsx`): al escribir, un textarea con una capa coloreada detrás (mismas métricas:
  solo cambia el color, no el tamaño ni el peso); al salir (Esc o "Ver"), Markdown formateado. Autoguardado con debounce de
  700 ms mediante `updateNote(…, { silent: true })`: entra en el historial pero no muestra aviso (`HistoryEntry.silent`).
  Enter continúa listas y acciones, Cmd/Ctrl+B pone negrita y hay autocompletado de @persona.
- **Acciones → tareas** (`noteActions.ts`): cada `- [ ] …` pasa por `parseCapture` (admite @persona, fechas, !1…), hereda el
  proyecto de la nota, guarda "De: <acta> (fecha)" en las notas de la tarea y la línea recibe su `[[t:id]]`. Todo en un lote
  deshacible. La casilla de una acción enlazada refleja el estado de la tarea; marcarla completa o reabre la tarea.
- **Quién dijo qué** (`domain/notes.ts`, `mentionsOf`): líneas que mencionan a la persona (excepto la de asistentes), con
  su sección del acta y su fecha. La ficha de persona reúne rol y notas, temas pendientes (con alta rápida), tareas, "lo que
  dijo o se habló" y sus reuniones. En un acta, el panel lateral muestra los temas pendientes con los asistentes.
- **Contexto en la tarea**: el panel de detalle muestra "Sale de" con las notas que la enlazan. Los proyectos muestran sus
  notas y la búsqueda global también encuentra notas (por palabras).

## Fase 9: recordatorios y registro

- **Esquema v5**: `remind_at` en las tareas (ISO; se pone a `null` al atenderlo) y tabla `activity`
  (`kind: created | completed | reopened | postponed | deleted | archived | state`, `from`/`to`, día local).
- **Registro automático**: `patchTask` y `createTask` llaman a `logActivity`, que usa la función pura
  `activityFor(before, after)`. Los apuntes se guardan en la **misma entrada del historial** que el cambio
  (`recordMany`), así que deshacer quita también el apunte. "Pospuesta" = tenía fecha y se retrasa o se le quita (estando
  pendiente). Completar no apunta además un cambio de estado.
- **Registro** (`#/log`, `G L`): semana a semana, con totales y cada día con Hecho, Pospuesto (con "N×"), Dejado de hacer
  (eliminadas, que se pueden restaurar mientras no se purguen, y archivadas), Cambios de estado y Notas del día.
  `dailyLog` descuenta lo completado y reabierto el mismo día y agrupa por tarea las pospuestas del mismo día.
  `PostponedChip` marca en filas y tarjetas lo pospuesto 2 o más veces; el panel muestra el historial de la tarea.
- **Recordatorios**: sin servidor, así que solo avisan con la app abierta. `ReminderCenter` revisa cada 15 s y programa
  un temporizador exacto para el siguiente. Al vencer: notificación del sistema (si hay permiso; solo para los que vencen
  en ese momento, no para los que se pasaron con la app cerrada), aviso en la app con Hecha/Posponer/Descartar y contador
  en el título de la pestaña. El permiso se pide al poner el primer recordatorio (con un clic) o desde Ajustes.
- **Sintaxis**: "recuérdame / avísame (a las) HH[:MM]" pone el aviso el día de la tarea o hoy (mañana si ya pasó y no hay
  fecha). Va antes que la fecha en el orden de extracción. "a las 5" sin "recuérdame" sigue sin significar nada.

## Fase 10: subproyectos, vista "Todo" y calendario de fechas

- **Esquema v6**: `projects.parent_id`; en las notas, `task_id` y `meeting_url`; en las personas, `email`; en los ajustes,
  `saved_views`. La migración rellena los valores por defecto y las copias antiguas siguen importándose.
- **Subproyectos** (`domain/projects.ts`): árbol de hasta `MAX_PROJECT_DEPTH = 3` niveles. `canMoveUnder` impide ciclos y
  pasar del máximo; `withDescendants` y `ancestry` dan descendientes y ruta. Un proyecto con un antepasado archivado cuenta
  como archivado (`isEffectivelyArchived`, aplicado en `AppContext.projects`). Un subproyecto nuevo hereda el color del padre.
  Barra lateral en árbol plegable (estado en localStorage); el recuento incluye a los descendientes. El proyecto muestra migas
  de pan, tarjetas de subproyectos (con alta), "Mover…" (dentro de otro o al nivel superior) y, con "Ver también sus tareas
  aquí", las tareas de los descendientes (`contextProjectId` oculta el chip del propio proyecto en las filas).
- **Captura**: `#padre/hijo` (el token de proyecto admite `/`). `resolveProjectToken` acepta la ruta completa o su final;
  sin ruta, gana el de menos profundidad. `#padre/nuevo` crea el subproyecto dentro del padre. El autocompletado muestra la
  ruta e inserta `caixa/Sprint-14`. Los selectores usan `useProjectOptions` (árbol con sangría y ruta al buscar).
- **Vista Todo** (fusionada en el Tablero en la fase 12; `domain/filters.ts`): `applyFilter` combina tipo (interruptores por
  tipo), categoría de estado, proyecto (con subproyectos), persona, etiqueta, release, fecha (atrasadas, hoy, 7 días, con o
  sin fecha), texto y "completadas"; `groupTasks` agrupa por tipo, estado, proyecto, persona o fecha. El filtro actual se
  recuerda en localStorage. Las **vistas guardadas** van en `settings.saved_views`, así que entran en las copias.
- **Selector de fecha** (`components/ui/DatePicker.tsx`): mes con número de semana ISO (`isoWeek`), hoy resaltado, días no
  laborables atenuados, un punto en los días con tareas, opciones rápidas y texto libre (`parseDateText`, Enter aplica).
  `DateButton` lo abre en un desplegable (panel, releases, notas); con la tecla D se abre dentro de la fila (`InlineDatePicker`).

## Fase 11: notas de elementos y Teams

- **Notas de un elemento** (US, TS, tarea…): son notas normales (`notes`) con `task_id`, así que también aparecen en Notas
  y en la búsqueda. Se crean desde el panel de detalle (`TaskNotes`, Markdown, Cmd/Ctrl+Enter) con el título
  "US-1234 · Título". El antiguo campo `task.notes` se muestra como "Descripción". El proyecto tiene la sección "Notas por
  elemento" (`ItemNotes`, `notesByTask`): agrupadas por elemento con su estado, cada grupo ordenado por fecha y los grupos
  por la nota más reciente. Las actas del propio proyecto excluyen las notas de elementos. En la vista Notas, el filtro "De
  elementos" y el proyecto se toman del elemento (aunque se mueva).
- **Teams sin servidor ni permisos de Microsoft** (`domain/teams.ts`): `meeting_url` en las actas con botón "Unirse";
  "Compartir" copia el resumen (`meetingSummary`: asistentes, decisiones y acciones con el estado de su tarea) o el acta en
  Markdown, y abre un chat de Teams con los asistentes (`teamsChatUrl`, enlace `teams.microsoft.com/l/chat/0/0?users=…`
  con tema y mensaje), usando el `email` de las fichas. La ficha de persona tiene campo de email y "Chat en Teams".
- **Importar reuniones (.ics)** (`domain/ics.ts`, `IcsImport`): despliega líneas plegadas, lee SUMMARY, DTSTART (UTC → hora
  local; con TZID se toma como hora local; VALUE=DATE de día completo), ORGANIZER/ATTENDEE (CN y email), enlace de Teams
  (`X-MICROSOFT-SKYPETEAMSMEETINGURL` o el que venga en la descripción) y expande RRULE sencillas (DAILY, WEEKLY con BYDAY,
  MONTHLY; INTERVAL, COUNT, UNTIL, EXDATE) en una ventana de −14 a +30 días. Las canceladas se ignoran. Se marcan por
  defecto las de los próximos 7 días y, de cada serie, solo la siguiente. Se evitan duplicados (mismo título y día). Al
  importar se guardan los emails de los asistentes en sus fichas. La conexión directa con el calendario de Microsoft
  (Graph) queda fuera: necesitaría registrar una app en Entra ID con permiso de la empresa.

## Fase 12: tablero único, semana y cuaderno tipo OneNote

- **Clic = abrir**: un clic normal en una fila (o tarjeta) la selecciona y abre el panel de detalle. Cmd/Ctrl/Shift + clic
  solo seleccionan (selección múltiple), sin abrir el panel.
- **Semana** (`#/week`): de lunes a domingo (`mondayOf`), con flechas entre semanas y número de semana ISO. Los días
  pasados se atenúan y muestran también lo completado ese día.
- **Tablero = todo**: la vista "Todo" de la fase 10 desaparece como apartado y su contenido pasa al Tablero (`#/all` redirige
  a él). El tablero tiene interruptores por tipo, filtros, vistas guardadas y modo Tablero/Lista (`board-mode`). Con un solo
  tipo elegido, las columnas son sus estados (`Board`); con varios o ninguno, son las categorías comunes (`CategoryBoard`:
  Por hacer, En curso, Bloqueado y Hecho). Al soltar, cada tarjeta pasa al primer estado de esa categoría en su propio
  flujo, y las tarjetas creadas en una columna se colocan igual. Si el filtro tiene un solo proyecto o una sola release,
  las tarjetas nuevas los heredan.
- **Notas tipo OneNote**: tres columnas. Secciones = proyectos y subproyectos con su color, más "Todas las notas" y "Sin
  sección". Páginas = notas de la sección, en orden manual (`sort_order`, sin índice ni cambio de esquema;
  `sortPages`/`reorderPages`, arrastrando). Las notas de US/TS van debajo, en su propio grupo. Contenido = la página. Abajo,
  "Agregar sección" (dentro de la seleccionada si se marca) y "Agregar página"/"Acta". El lateral de acciones y temas solo
  aparece en actas o en notas con acciones.
- **Teams en tiempo real**: no disponible sin un registro de app en el Entra ID de la empresa (Microsoft Graph). Además,
  el enlace ICS publicado de Outlook no se puede leer desde el navegador por CORS sin un servidor intermedio.

## Fase 13: pantalla de proyecto, personas y desplegables

- **Desplegables** (`components/ui/Popover.tsx`): se dibujan en un portal con `position: fixed` por encima de todo, así no
  los recorta ningún panel con scroll (el calendario del panel lateral salía cortado). Se recolocan para caber en pantalla
  (desplazamiento horizontal y apertura hacia arriba) al abrir, al hacer scroll o al cambiar de tamaño (ResizeObserver).
  Llevan `data-popover`, que `Main` excluye al quitar la selección con un clic fuera.
- **Proyecto** (`features/project/ProjectPage.tsx`): tres modos (`project-view:<id>`). **Resumen** (por defecto): cifras del
  proyecto entero (pendientes, en curso, bloqueadas, atrasadas, hechas en 7 días, notas) y una tarjeta por subproyecto
  directo, más "General" con lo que cuelga del propio proyecto. Cada tarjeta suma sus descendientes y muestra avance,
  estados, sub-subproyectos, tareas abiertas (atrasadas primero, completar, abrir, arrastrar a otra tarjeta), alta rápida
  con la sintaxis de captura y las últimas notas. **Lista**: agrupada por subproyecto con su ruta. **Tablero**: todos los
  tipos (`CategoryBoard`) o los estados de un tipo. Debajo, notas por elemento y actas del proyecto (con subproyectos).
- **Personas** (`domain/people.ts`, `peopleDirectory`): une las personas de las tareas, las mencionadas con @ en notas y las
  que tienen ficha (por `nameKey`). Se usa en la barra lateral (todas; a partir de 10, "Ver las N") y en la vista Personas.
  En la ficha, cada línea de "Lo que dijo o se habló" tiene "→ Tarea" y "→ Tema" (con la persona y el proyecto de la nota;
  se quita el "@Persona:" inicial). No se crean tareas automáticamente a partir de las menciones, para no generar ruido.

## Fase 14: auditoría (menos pantallas, más hábitos)

- **Barra lateral**: Hoy · Bandeja · Tablero · Calendario · Notas; proyectos (con "+" para crear y archivados plegados),
  personas y "Más" plegado (Revisión semanal, Releases, Registro). Se eliminó la pantalla Proyectos (`#/projects` → Hoy).
- **Calendario** con modo Semana/Mes (`calendar-mode` en localStorage); `#/week` abre el calendario en modo semana.
- **Resumen del día** dentro de Hoy, no encima de todas las vistas.
- **Mi día** (`Task.my_day: ISODate | null`, sin índice ni migración: zod pone `null`): lista elegida a mano para hoy, que
  no cambia la fecha. Caduca sola porque solo cuenta si `my_day === today`. Tecla A, sol en la fila y en el panel, y destino
  de arrastre. "Para hoy" y Atrasadas no repiten lo que ya está en Mi día.
- **Para hablar**: el tipo Tema se renombra (migración v7, solo si conserva el nombre original). `SCHEMA_VERSION = 7`.
- **Marcadores `[[t:id]]`**: se reconocen en cualquier punto de la línea y en el editor se pintan transparentes, así
  escribir detrás no rompe el enlace.
- **Renombrar o unir personas** (`repo.renamePerson`): un lote que cambia tareas, menciones en notas (`renameMentions`) y
  fichas (gana la de destino; las notas se concatenan).
- **Búsqueda única** (`SearchView`): tareas, notas, personas y proyectos. Los cuadros de Tablero y Notas son "Filtrar…".
  "/" al principio de la captura va a la búsqueda.
- **Outlook** (`domain/icsExport.ts`): "Añadir a Outlook" descarga un `.ics` con alarma (a la hora del recordatorio, o a las
  9:00 del día). Es el modo de tener avisos con la app cerrada sin servidor.
- **Pistas de sintaxis**: con la captura vacía y enfocada salen chips que insertan cada token.
- **Revisión semanal** (`features/review/ReviewView.tsx`, `#/review`, `G V`): pasos Bandeja → Atrasadas → Cómo fue la semana
  → Para hablar por persona → La semana que viene → Sin tocar. "Revisión hecha" guarda `settings.ui.last_review_on`;
  `reviewDue` muestra un aviso en Hoy de viernes a lunes si no se ha hecho desde el viernes.
- **Pendiente (a propósito)**: copia automática en OneDrive; la usuaria la configurará cuando tenga la herramienta definitiva.

### Más adelante

- **Electron**: la app es web estática con rutas por hash y datos en IndexedDB, así que se puede empaquetar sin cambios
  (cargando `dist/`). Ojo: Electron tendrá su propio IndexedDB, y los datos se pasan con exportar e importar.

### Hoja de ruta v2

- [x] Fase 6: lista tipo Asana, tablero tipo Trello, panel de detalle, pasos y etiquetas de color
- [x] Fase 7: US/TS (ID externo y enlace), releases y calendario de "cuándo sale todo"; configurar tipos y estados
- [x] Fase 8: notas y actas de reunión en Markdown con formato en vivo, acciones convertibles en tareas, ficha de persona
      (temas pendientes y quién dijo qué)
- [x] Fase 9: recordatorios (solo con la app abierta, sin servidor) y registro diario de lo hecho, pospuesto y abandonado
- [x] Fase 10: subproyectos, vista "Todo" con filtros y vistas guardadas, selector de fecha con calendario
- [x] Fase 11: notas fechadas por elemento (en panel, proyecto y Notas) y Teams (enlace, compartir, chat e importar .ics)
- [x] Fase 12: clic abre el panel, semana de lunes a domingo, todo en el Tablero, notas con diseño OneNote
- [x] Fase 13: pantalla de proyecto con resumen por subproyecto, personas de las notas en la barra lateral, desplegables sin recortes
- [x] Fase 14: auditoría: barra lateral simplificada, Mi día, revisión semanal, búsqueda única, Outlook, unir personas, sin dictado

## Fases

- [x] Fase 1: base, IndexedDB, modelo, CRUD, vistas básicas y copias de seguridad
- [x] Fase 2: captura con sintaxis rápida, paleta de comandos y atajos
- [x] Fase 3: edición en línea, arrastrar y soltar, selección múltiple y deshacer global
- [x] Fase 4: recurrentes, mantenimiento automático y resumen del día
- [x] Fase 5: dictado (retirado en la fase 14) y PWA offline

## Comprobaciones antes de cada commit

`npm run typecheck && npm test && npm run build`
