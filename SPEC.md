# Gestor de tareas personal: especificación v1 (solo frontend, sin IA)

## Contexto y objetivo

Quiero una app web personal para gestionar mis tareas. La uso yo sola, a diario y sobre todo desde el ordenador.

El criterio que manda sobre todos los demás: **capturar una tarea tiene que costar menos de 5 segundos y la app no debe exigir mantenimiento manual**. Si una decisión de diseño añade fricción a la captura o obliga a revisar cosas a mano, descártala o propón una alternativa.

## Restricciones

- Todo en el frontend: sin backend, sin base de datos remota y sin APIs de pago.
- Sin IA. La comodidad viene de una sintaxis rápida, reglas automáticas y mucha interacción por teclado.
- Los datos no salen del navegador (con la única excepción del dictado, que es opcional).
- Debe funcionar sin conexión.

## Stack

- Vite, React, TypeScript y Tailwind
- IndexedDB a través de Dexie para la persistencia
- chrono-node con locale español para fechas en lenguaje natural, ampliado con un parser propio
- zod para validar los datos importados
- Vitest para los tests
- PWA instalable y offline (vite-plugin-pwa)
- Despliegue estático opcional (Vercel o GitHub Pages); también debe poder usarse en local

## Modelo de datos (IndexedDB)

- **projects**: id, name, color, archived, created_at
- **tasks**: id, project_id (opcional), title, notes, due_date (opcional), priority (1 a 4), estimated_minutes (opcional), people (string[]), tags (string[]), status (inbox, todo, done, archived), recurrence_rule (opcional), raw_input (texto original capturado), created_at, updated_at, completed_at, last_touched_at
- **settings**: capacidad diaria en minutos (por defecto 360), días laborables, fecha de la última copia de seguridad, preferencias de interfaz

Incluye un campo de versión del esquema y migraciones con Dexie desde el principio.

Si ves una forma mejor de modelar algo, propónla y justifícala antes de implementarla.

## Persistencia y copias de seguridad (fase 1, no negociable)

Al vivir todo en el navegador, perder los datos es el mayor riesgo del proyecto.

- Pedir almacenamiento persistente con `navigator.storage.persist()`.
- Exportar todo a JSON con un clic e importar con validación previa y vista resumen antes de sobrescribir.
- Recordatorio discreto si han pasado más de 7 días desde la última copia.
- En navegadores compatibles (Chrome, Edge), opción de vincular un archivo con la File System Access API para guardar una copia automática tras cada cambio (con debounce). Así puedo dejar ese archivo en una carpeta sincronizada en la nube.

## Funcionalidades v1

### 1. Captura con sintaxis rápida
- Atajo Cmd/Ctrl+K que abre una barra de captura desde cualquier vista.
- Escribo en lenguaje natural con tokens opcionales, y la app los resalta en vivo mientras escribo:
  - Fechas: "hoy", "mañana", "pasado mañana", "el viernes", "el lunes que viene", "15 oct", "fin de mes"
  - `#proyecto` con autocompletado (si no existe, propone crearlo)
  - `@persona` con autocompletado de personas usadas antes
  - `!1` a `!4` para la prioridad
  - `~30m`, `~2h` para la estimación
  - Recurrencia: "cada día", "cada lunes", "todos los lunes y jueves", "cada mes"
- Debajo de la barra, vista previa con chips de lo detectado. Puedo eliminar cualquier chip si el parser se equivoca.
- Varias tareas a la vez separadas por `;` o por saltos de línea (útil para pegar notas de una reunión).
- Lo que no tenga fecha ni proyecto va a la bandeja.
- El texto original se guarda siempre en `raw_input`.

### 2. Paleta de comandos
- Cmd/Ctrl+Shift+P, o empezar con `>` en la barra de captura.
- Búsqueda difusa de comandos: "mover vencidas a mañana", "completar seleccionadas", "nuevo proyecto", "exportar copia", "ir a proyecto X", "repartir atrasadas".

### 3. Interacción
- Edición en línea de cualquier campo con doble clic o Enter.
- Arrastrar y soltar tareas entre días y entre proyectos.
- Selección múltiple con Shift y Cmd/Ctrl y con el teclado, y acciones en bloque.
- Deshacer y rehacer globales (Ctrl+Z / Ctrl+Shift+Z) para cualquier acción, con un aviso "Deshacer" tras cada cambio.
- Navegación completa por teclado: moverse entre tareas, completar, editar, cambiar fecha, mover de proyecto. Chuleta de atajos con `?`.
- Búsqueda global por texto, proyecto, persona y etiqueta.

### 4. Vistas
- **Hoy**: tareas de hoy, bloque de atrasadas (ver punto 5) y resumen del día (punto 6)
- **Próximos 7 días**, con la carga estimada de cada día frente a la capacidad
- **Por proyecto**
- **Por persona**
- **Bandeja**: tareas sin organizar

### 5. Mantenimiento automático (basado en reglas)
- Las tareas vencidas no se acumulan en rojo. Aparecen en un bloque "Se te quedaron atrás" con acciones de un clic: hoy, mañana, la semana que viene, sin fecha, eliminar.
- Acción "Repartir": ordena las atrasadas por prioridad y antigüedad y las distribuye en los próximos días laborables respetando la capacidad diaria. Muestra una vista previa antes de aplicar.
- Las tareas sin tocar en más de 30 días se proponen para archivar en un bloque aparte. Nunca se archivan solas.

### 6. Resumen del día (basado en reglas)
- Panel breve la primera vez que abro la app cada día: las 3 tareas más importantes (por prioridad, vencimiento y antigüedad), número de atrasadas y carga estimada frente a capacidad, con aviso si el día está sobrecargado.
- Se puede cerrar y no vuelve a aparecer ese día.

### 7. Tareas recurrentes
- Diaria, semanal en días concretos o mensual.
- Al completar una recurrente se crea la siguiente ocurrencia.

### 8. Dictado (opcional)
- Botón de micrófono y atajo propio usando la Web Speech API en es-ES. La transcripción pasa por el mismo parser de la captura.
- Desactivado por defecto, con un aviso al activarlo: en Chrome el audio se procesa en servidores externos.
- Si el navegador no lo soporta, el botón no aparece.

## Fuera de alcance en la v1

IA, sincronización entre dispositivos, colaboración, notificaciones push, integraciones con calendario o correo, vista kanban, adjuntos. No los implementes, pero no tomes decisiones que los impidan.

## Arquitectura pensada para crecer

- El parser de captura vive detrás de una interfaz del tipo `parseCapture(texto, contexto) => TareaParseada[]`, para poder sustituirlo por IA en el futuro sin tocar la interfaz.
- El acceso a datos pasa por una capa de repositorio, para poder cambiar IndexedDB por un backend remoto sin reescribir los componentes.
- La lógica de reglas (repartir, resumen, tareas obsoletas) en funciones puras y testeadas.

## Ejemplos de parseo para tests

Fecha de referencia: lunes 5 de octubre de 2026, zona horaria Europe/Madrid.

- "mañana mandar guía de etiquetado a @Diana #caixa" → fecha 6/10, persona Diana, proyecto caixa
- "revisar defects cada lunes !1" → recurrente semanal los lunes, prioridad 1
- "preparar demo el jueves ~2h !1" → fecha 8/10, 120 minutos, prioridad 1
- "llamar al dentista" → sin fecha, a la bandeja
- "comprar café; renovar el DNI el viernes" → dos tareas, la segunda con fecha 9/10
- "pasado mañana revisar informe #trabajo ~45m" → fecha 7/10, proyecto trabajo, 45 minutos

Añade casos límite: fechas ambiguas, tokens mal escritos, texto vacío, "el lunes" dicho en lunes, palabras que parecen fechas pero no lo son.

## Diseño

- Interfaz limpia y densa, pensada para trabajar con teclado.
- Modo claro y oscuro según el sistema.
- Nada de animaciones que ralenticen la captura.

## Forma de trabajar

1. Antes de escribir código, preséntame un plan por fases con la estructura de carpetas y el esquema de datos. Espera mi visto bueno solo en este punto.
2. Después trabaja de forma autónoma, sin pedirme confirmación en cada paso.
3. Fases:
   - Fase 1: proyecto base, IndexedDB, modelo de datos, CRUD, vistas básicas y copias de seguridad
   - Fase 2: captura con sintaxis rápida, paleta de comandos y atajos de teclado
   - Fase 3: edición en línea, arrastrar y soltar, selección múltiple y deshacer
   - Fase 4: tareas recurrentes, mantenimiento automático y resumen del día
   - Fase 5: dictado opcional y PWA offline
4. Al terminar cada fase: la app funciona, los tests pasan, haces commit y me resumes en pocas líneas qué has hecho y qué decisiones has tomado.
5. Mantén un `CLAUDE.md` con las decisiones de arquitectura y un `README.md` con los pasos para arrancar el proyecto.
6. Si algo de esta especificación te parece un error o hay una forma claramente mejor de hacerlo, dímelo antes de implementarlo.
