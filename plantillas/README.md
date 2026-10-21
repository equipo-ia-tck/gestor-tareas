# Plantillas de mensajes

Cada archivo `.md` de esta carpeta es una plantilla que aparece en el panel de una tarea, en «Mensaje».
Se edita aquí, en Git, y entra en la app al ejecutar `npm start`.

Cabecera (opcional):

```
---
nombre: Entrega de US
tipos: us          # abreviaturas o ids de tipo separados por comas; sin «tipos» vale para todos
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
