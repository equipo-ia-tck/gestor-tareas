# Gestor de tareas

App web personal de tareas. Todo vive en el navegador (IndexedDB): sin backend, sin cuentas y sin conexión obligatoria.

## Arrancar en local

Requisitos: Node 20 o superior.

```bash
npm install
npm run dev
```

Abre la dirección que indique la terminal (normalmente http://localhost:5173).

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con recarga en caliente |
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
- El dictado por voz (opcional, desactivado por defecto) es lo único que puede enviar datos fuera: en Chrome y Edge el
  audio se transcribe en servidores externos. Se activa en **Copias y ajustes** y se usa con el micrófono de la barra de
  captura o con Alt+M.
