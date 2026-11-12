# Gestor de tareas

Gestor de tareas del equipo. La app trabaja sobre el navegador (IndexedDB) y se sincroniza con Supabase, que guarda los datos y las cuentas.

## Qué incluye

- **Captura en segundos** (Cmd/Ctrl+K o la barra de cada vista) con sintaxis rápida: `mañana`, `el viernes`,
  `#proyecto`, `@persona`, `!1`, `~30m`, `+etiqueta`, `cada lunes`, `US-1234`, `^R2.3`, `recuérdame a las 17:00`…
- **Barra lateral**: Hoy (con **Mi día**, resumen, atrasadas y "Repartir"), Bandeja, **Tablero** (todas las tareas, US,
  TS y temas "Para hablar", con filtros, vistas guardadas y modo lista), **Calendario** (Semana de lunes a domingo o Mes)
  y **Notas** (como OneNote). Debajo, proyectos con **subproyectos** (botón + para crear), personas y, en "Más",
  **Revisión semanal**, Releases y Registro.
- **Buscar todo** (`/`): tareas, notas, personas y proyectos en un solo sitio.
- **Panel de detalle** de cada tarea: tipo (Tarea, User Story, Test Scenario, Para hablar…), estado, fecha, recordatorio,
  release, ID externo con enlace a Jira/Xray, prioridad, personas, etiquetas de color, estimación, pasos, notas e historial.
- **Notas y actas** en Markdown con formato en vivo. Las acciones `- [ ]` se convierten en tareas enlazadas. Cada US/TS
  tiene sus **notas fechadas**, visibles también agrupadas en su proyecto.
- **Teams**: enlace de la reunión con "Unirse", compartir el resumen del acta, abrir un chat con los asistentes e
  **importar reuniones** desde un archivo `.ics` de Outlook o Teams.
- **Fichas de persona**: temas para hablar, tareas, lo que dijo cada uno en las reuniones y reuniones con ella. Se pueden
  **renombrar o unir** (por ejemplo "Luis" y "Luis Gómez"), y se actualizan tareas y menciones en las notas.
- **Outlook**: "Añadir a Outlook" en el panel descarga un `.ics` con aviso, para que te avise aunque la app esté cerrada.
- **Revisión semanal** guiada (el viernes la app te la propone): bandeja, atrasadas, cómo fue la semana, temas por
  persona, carga de la semana que viene y tareas olvidadas.
- **Teclado**: J/K, Enter, E, C, D, T, A (Mi día), M, 1–4, Supr; `?` muestra todos los atajos. Deshacer global con Cmd/Ctrl+Z.
- **Fechas** con calendario mensual (semanas, carga por día) o escribiendo "vie", "15 oct"…
- **Equipo**: cada uno entra con su cuenta. Todo es privado salvo los proyectos que pones en un **espacio** (Excelencia,
  Pagos…), que ven y editan todos sus miembros, y lo que menciona a una cuenta por su nombre completo o email. Se puede
  estar en varios espacios y filtrar por espacio en la barra lateral. «Mi día», recordatorios, fichas y ajustes son siempre
  de cada uno.
- **Mensajes de entrega**: plantillas en `plantillas/` (guías y validaciones de etiquetado) que se rellenan con la tarea.

## Usarla (una sola dirección)

La app vive en **http://localhost:4173**, servida por el servidor del equipo (`servidor/`). Para arrancarlo (o
actualizar tras cambios):

```bash
npm start
```

- Los datos y las cuentas del equipo están en **Supabase** (`.env`: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`;
  el esquema está en `supabase/migrations/`). La primera cuenta es administradora; los compañeros entran con la
  **invitación de su espacio** (Ajustes → Espacios).
- El servidor de `servidor/` ya solo hace falta para los conectores (Rally, Confluence, calendario, chats y lista): guarda
  sus claves en `servidor/datos/equipo.sqlite` (fuera de Git). Tras pasar a Supabase hay que volver a conectarlos.
- Si el servidor ya estaba en marcha, `npm start` lo reinicia con lo último.
- La primera vez que entras en un navegador que ya tenía datos de antes, la app te ofrece subirlos a tu cuenta (y antes
  descarga una copia).

> `localhost:5173` (`npm run dev`) es solo para desarrollar: usa el servidor de 4173 para la API (tiene que estar en
> marcha) y no hace falta abrirlo.

## Arrancar en local (desarrollo)

Requisitos: Node 20 o superior.

```bash
npm install
npm run dev
```

Abre la dirección que indique la terminal (normalmente http://localhost:5173).

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm start` | **La app**: compila y arranca el servidor del equipo en http://localhost:4173 (si ya está en marcha, solo compila) |
| `npm run servidor` | Arranca el servidor sin compilar |
| `npm run dev` | Solo para desarrollar (localhost:5173, datos aparte) |
| `npm test` | Ejecuta los tests (Vitest) |
| `npm run typecheck` | Comprueba los tipos de TypeScript |
| `npm run build` | Compila la versión de producción en `dist/` |
| `npm run preview` | Sirve `dist/` para probarla |

## Usarla como app (PWA, sin conexión)

Para el uso diario, mejor la versión compilada que el servidor de desarrollo:

```bash
npm run build && npm run preview
```

Ábrela (http://localhost:4173) e instálala desde **Copias y ajustes → Instalar app** o con el icono de instalar de la
barra de direcciones. A partir de ahí funciona sin conexión y se abre en su propia ventana.

> **Importante:** el navegador guarda los datos por dirección. `localhost:5173` (desarrollo), `localhost:4173` (preview)
> y una URL desplegada son almacenes **distintos**. Para pasar tus tareas de una a otra, exporta la copia en una e
> impórtala en la otra.

## Despliegue estático (opcional)

`dist/` es un sitio estático con rutas por hash y `base: './'`, así que funciona en Vercel, GitHub Pages o abriéndolo desde cualquier servidor estático sin configuración extra.

## Tus datos

- Se guardan solo en este navegador y en este dispositivo. Borrar los datos del sitio los elimina.
- En **Copias y ajustes** puedes exportar o importar una copia JSON y, en Chrome o Edge, vincular un archivo para que se guarde una copia automática tras cada cambio. Ponlo en una carpeta sincronizada (Drive, iCloud, Dropbox) y tendrás copia en la nube.
- Si pasan más de 7 días sin copia, la app te lo recuerda.
- Los recordatorios avisan solo mientras la app está abierta (aunque esté minimizada); no hay servidor de notificaciones.
