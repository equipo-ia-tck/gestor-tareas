# CLAUDE.md

Gestor de tareas personal, solo frontend. La especificación completa está en `SPEC.md`; aquí van las decisiones de arquitectura tomadas al implementarla.

## Principio rector

Capturar una tarea debe costar menos de 5 segundos y la app no debe exigir mantenimiento manual. Si algo añade fricción o trabajo manual, se descarta.

## Stack

Vite 8, React 19, TypeScript 7, Tailwind 4 (plugin `@tailwindcss/vite`, modo oscuro por `prefers-color-scheme`), Dexie 4 + `dexie-react-hooks`, zod 4 y Vitest 5 con `fake-indexeddb`. Los tests corren con `TZ=Europe/Madrid` (definido en `tests/setup.ts`).

## Estructura

```
src/
  domain/     tipos, esquemas zod, fechas, selectores, recurrencia (nextOccurrence) y texto (fold, búsqueda difusa).
              Funciones puras y testeadas, sin React ni Dexie.
  parser/     parseCapture(texto, ctx) => ParsedTask[]: patterns.ts (expresiones regulares en español + respaldo chrono)
  data/       db.ts (Dexie y migraciones), repository.ts (interfaz Repository + DexieRepository),
              backup.ts (validar, exportar, recordatorio), fsAutosave.ts (File System Access), services.ts (instancias únicas)
  hooks/      useData (useLiveQuery sobre el repositorio), useTaskActions (acciones con aviso "Deshacer")
  components/ UI reutilizable: TaskRow, TaskList/Section, TaskEditor, QuickAdd, Modal, Toast
  features/   views/ (Hoy, 7 días, Bandeja, Proyectos, Personas), backup/ (Copias y ajustes, recordatorio),
              capture/ (CaptureInput: resaltado, autocompletado, chips; submitCapture), command/ (modal Cmd+K,
              paleta, comandos, atajos globales, chuleta), selection/ (selección, teclado, barra en bloque),
              history/ (avisos de deshacer y Ctrl/Cmd+Z)
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

## Atajos (fase 2)

Atajos globales en `CommandCenterProvider`: Cmd/Ctrl+K captura, Cmd/Ctrl+Shift+P paleta, `>` al principio de la captura
pasa a la paleta, `N`/`Q` captura, `G`+letra navega, `?` chuleta. Los atajos de una tecla se ignoran si el foco está
en un campo editable o hay un diálogo abierto.

## Fases

- [x] Fase 1: base, IndexedDB, modelo, CRUD, vistas básicas y copias de seguridad
- [x] Fase 2: captura con sintaxis rápida, paleta de comandos y atajos
- [x] Fase 3: edición en línea, arrastrar y soltar, selección múltiple y deshacer global
- [ ] Fase 4: recurrentes, mantenimiento automático y resumen del día
- [ ] Fase 5: dictado y PWA offline

## Comprobaciones antes de cada commit

`npm run typecheck && npm test && npm run build`
