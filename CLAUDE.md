# CLAUDE.md

Gestor de tareas personal, solo frontend. La especificación completa está en `SPEC.md`; aquí van las decisiones de arquitectura tomadas al implementarla.

## Principio rector

Capturar una tarea debe costar menos de 5 segundos y la app no debe exigir mantenimiento manual. Si algo añade fricción o trabajo manual, se descarta.

## Stack

Vite 8, React 19, TypeScript 7, Tailwind 4 (plugin `@tailwindcss/vite`, modo oscuro por `prefers-color-scheme`), Dexie 4 + `dexie-react-hooks`, zod 4 y Vitest 5 con `fake-indexeddb`. Los tests corren con `TZ=Europe/Madrid` (definido en `tests/setup.ts`).

## Estructura

```
src/
  domain/     tipos, esquemas zod, fechas y selectores. Funciones puras y testeadas, sin React ni Dexie.
  data/       db.ts (Dexie y migraciones), repository.ts (interfaz Repository + DexieRepository),
              backup.ts (validar, exportar, recordatorio), fsAutosave.ts (File System Access), services.ts (instancias únicas)
  hooks/      useData (useLiveQuery sobre el repositorio), useTaskActions (acciones con aviso "Deshacer")
  components/ UI reutilizable: TaskRow, TaskList/Section, TaskEditor, QuickAdd, Modal, Toast
  features/   views/ (Hoy, 7 días, Bandeja, Proyectos, Personas), backup/ (Copias y ajustes, recordatorio)
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
- **Avisos de deshacer.** Por ahora `useTaskActions` deshace acciones concretas (completar, eliminar, reprogramar). En la fase 3 se sustituirá por un historial global de comandos.

## Fases

- [x] Fase 1: base, IndexedDB, modelo, CRUD, vistas básicas y copias de seguridad
- [ ] Fase 2: captura con sintaxis rápida, paleta de comandos y atajos
- [ ] Fase 3: edición en línea, arrastrar y soltar, selección múltiple y deshacer global
- [ ] Fase 4: recurrentes, mantenimiento automático y resumen del día
- [ ] Fase 5: dictado y PWA offline

## Comprobaciones antes de cada commit

`npm run typecheck && npm test && npm run build`
