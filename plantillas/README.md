# Plantillas de mensajes

Cada archivo `.md` de esta carpeta es una plantilla que aparece en el panel de una tarea, en «Mensaje».
Se edita aquí, en Git, y entra en la app al ejecutar `npm start`.

Cabecera (opcional):

```
---
grupo: Guías de etiquetado (US)   # para agrupar en el desplegable
nombre: Owner · Solicita validación de guía
tipos: us                          # abreviaturas o ids de tipo separados por comas; sin «tipos» vale para todos
---
```

Campos que se rellenan solos:

| Campo | Qué pone |
|---|---|
| `{id}` | ID externo (US1764574) |
| `{titulo}` | Título de la tarea |
| `{tipo}` / `{estado}` | Tipo (User Story…) y estado actual |
| `{proyecto}` | Proyecto con su ruta |
| `{enlace}` | Enlace a Rally (o el enlace de la tarea) |
| `{fecha}` | Fecha límite (dd/mm) |
| `{para}` | Nombres de las personas de la tarea («Mike y Rosa») |
| `{hecho}` / `{pendiente}` / `{pasos}` | Pasos completados, pendientes o todos |
| `{descripcion}` | Descripción de la tarea |

Si un campo queda vacío, su línea entera desaparece del mensaje.

**Huecos que se preguntan** al preparar el mensaje (no salen de la tarea): `{?Link a la guía}`, `{?Número de defect}`,
`{?PO IT}`… Cada uno aparece como una casilla, con sugerencias (enlaces de la tarea, o personas ordenadas por su rol
en la ficha). Si se deja vacío, el mensaje muestra `<Link a la guía>` para que se vea.

Con `{?Etiqueta|campo}` el hueco toma por defecto un campo de la tarea: `Hola {?Responsable del delivery|para},`
saluda a las personas de la tarea si no se escribe otro nombre.

Las plantillas actuales son los mensajes oficiales de guías y validaciones de etiquetado (de Confluence).
