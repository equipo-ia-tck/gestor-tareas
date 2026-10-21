# Plan de integración: gestor + Microsoft 365 + Rally + Confluence

Investigación del 21 de octubre de 2026. Objetivo: un único sitio con un panel de entrada y un agente al que
preguntar, que prepare los mensajes y el trabajo repetitivo (por ejemplo, entregar una US o un TS).

**En resumen:** todo se puede conectar. Microsoft 365 no es problema porque ya tenemos licencias de Copilot.
Lo que depende de terceros es Rally y Confluence, que son del cliente: técnicamente funcionan con nuestros
usuarios, pero hay que pedir autorización antes de usarlos con una IA.

---

## 1. Qué aporta cada pieza

### Microsoft 365 (de WPP)

Se conecta todo con **Microsoft Graph**, la API única de Microsoft 365, y una app registrada en **Entra ID**
(registrarla es gratis, pero la tiene que aprobar IT). Cada servicio es un permiso distinto: se pide solo lo
que haga falta.

| Servicio | Para qué nos sirve | Permiso de Graph | ¿Incluido? |
|---|---|---|---|
| **Outlook · correo** | Ver correos importantes en el panel; borradores de entrega por correo | `Mail.Read` (leer), `Mail.Send` (enviar) | Graph no tiene coste. Copilot en Outlook ya va en nuestra licencia |
| **Outlook · calendario** | Reuniones del día y de la semana en el panel; crear eventos con aviso | `Calendars.Read` / `Calendars.ReadWrite` | Sí. Hoy ya funciona sin permisos con «Añadir a Outlook» (.ics) |
| **Teams · chats** | Mensajes sin leer y menciones; enviar el mensaje de entrega a Mike | `Chat.Read`, `ChatMessage.Send` | Sí. Abrir un chat con el mensaje escrito ya funciona hoy sin permisos |
| **Teams · canales** | Ver lo que se habla en los canales del equipo | `ChannelMessage.Read.All` (pide administrador) | Sí, con aprobación de IT |
| **Teams · reuniones** | Transcripciones para generar actas y temas «Para hablar» | `OnlineMeetingTranscript.Read.All` (pide administrador) | Copilot en Teams ya resume reuniones con nuestra licencia |
| **SharePoint** | Buscar y leer guías, documentación y el Excel de seguimiento de Responsable de Excelencia | `Sites.Read.All` o `Sites.Selected` (solo sitios concretos) | Sí |
| **OneDrive** | Guardar la copia automática del gestor (tarea pendiente A de la auditoría) | `Files.ReadWrite` | Sí |
| **OneNote** | Importar el cuaderno «Marta en WPP Cloud» automáticamente, sin capturas | `Notes.Read` | Sí |
| **Copilot** (Microsoft 365) | Preguntar sobre correo, Teams y documentos desde Teams/Outlook | — | **Ya lo tenemos** |
| **Copilot Studio** | Crear nuestro agente propio con Microsoft 365 + Rally + Confluence | — | Agentes internos incluidos en la licencia de Copilot (uso razonable). Work IQ (datos de M365 dentro del agente) consume créditos aparte |

> Aunque Microsoft no exija administrador para varios de estos permisos, en empresas grandes el usuario no
> puede autorizar apps por su cuenta. Hay que pedir a IT el **consentimiento de administrador** para la app.

### Rally (del cliente)

| Qué | Detalle |
|---|---|
| Para qué | Ver nuestras US, TS, tareas y defectos por iteración; cambiar estados; leer criterios y pasos para preparar las entregas |
| Cómo | API WSAPI con **clave personal** (perfil de Rally → «API Keys»), o el **conector MCP oficial** de Rally para IA (Europa: `https://mcp-eu.rallydev.com/mcp`), que usa esa misma clave |
| Acceso hoy | Ya tenemos usuario en la suscripción del cliente, así que podemos crear la clave salvo que el administrador lo haya restringido (posible desde 2026) |
| Permiso | **Del cliente.** Que funcione no significa que podamos usarlo: usar sus datos con una IA necesita su visto bueno |
| Coste | Sin coste extra: va con la licencia de Rally que ya paga el cliente. El MCP está disponible para todos los clientes |
| Límites | 12 consultas simultáneas por usuario. Desde el navegador directo hace falta que su administrador permita nuestro dominio (CORS): con un servidor propio no |

### Confluence (del cliente)

| Qué | Detalle |
|---|---|
| Para qué | Buscar, leer y resumir guías (etiquetado, onboarding…) y enlazarlas a las tareas |
| Cómo | **Conector MCP de Atlassian (Rovo)**: `https://mcp.atlassian.com/v2/mcp`, con OAuth o token de API. Solo funciona con Confluence Cloud (`*.atlassian.net`) |
| Permiso | **Del administrador de Atlassian del cliente**: puede bloquear el conector, limitar qué herramientas se conectan y prohibir tokens a usuarios externos (como nosotros) |
| Coste | Sin licencia aparte (según la comunidad de Atlassian). Límite de llamadas por hora según el plan del cliente (de 500 a 10.000) |
| Riesgo | Depende más del cliente que Rally |

### GitHub (nuestro)

| Qué | Detalle |
|---|---|
| Para qué | Trabajar los dos sobre el mismo código, no perder nada y guardar lo que la herramienta usa: plantillas de mensajes, instrucciones del agente, documentación |
| Cómo | Repositorio **privado**. Mejor en la organización de GitHub de WPP si existe; si no, en una cuenta personal con el otro como colaborador |
| Coste | Repositorios privados gratis con colaboradores ilimitados (GitHub Free) |
| Regla | **Nunca** se suben datos del cliente ni claves: `importar/`, copias JSON y `.env` están en `.gitignore` |

---

## 2. Pasos a seguir

| # | Paso | Qué hace falta | Quién | Tiempo | Conector | Licencia / gasto |
|---|---|---|---|---|---|---|
| 1 | Subir el proyecto a GitHub | Repositorio privado y dar acceso al compañero | Nosotros | 1 hora | — | 0 € |
| 2 | Probar lo que ya funciona sin permisos | Plantillas de entrega (`plantillas/`), chat de Teams con el mensaje escrito, «Añadir a Outlook» | Nosotros | Ya disponible | Enlaces de Teams y .ics | 0 € |
| 3 | Comprobar accesos | ¿Podemos crear la clave en Rally (sin usarla)? ¿Confluence es `atlassian.net`? ¿Tenemos Copilot Studio? | Nosotros | 1 día | — | 0 € |
| 4 | Pedir autorización al cliente | Usar la clave de Rally y el conector de Atlassian con la IA aprobada por WPP | Responsable del cliente + sus administradores | **1–4 semanas** (lo más incierto) | — | 0 € |
| 5 | Pedir la app de Microsoft a IT | Registro en Entra ID + consentimiento de administrador para los permisos de la sección 1 | IT de WPP | 1–2 semanas | Microsoft Graph | 0 € |
| 6 | Piloto del agente | Copilot Studio con Microsoft 365 y, si hay permiso, Rally y Confluence. Probar 10–15 preguntas reales | Nosotros | 1–2 semanas | Work IQ, MCP de Rally y de Atlassian | Incluido en Copilot; Work IQ consume créditos (paquete de 25.000 por 200 $/mes si se superan) |
| 7 | Panel en el gestor | Servidor propio que guarda los accesos y lee Rally, Confluence y Microsoft 365 | Nosotros + IT (alojamiento) | 4–6 semanas | Graph, API de Rally, Confluence | Alojamiento interno, coste bajo |
| 8 | Automatizaciones | Borradores de entrega, recordatorios, resumen de llegada. Siempre con aprobación antes de enviar | Nosotros | 2 semanas | Los anteriores | 0 € extra |

**Si el cliente dice que no** a Rally o Confluence: el agente y el panel funcionan igual con Microsoft 365 y el
gestor. Rally y Confluence quedan como enlaces (en Ajustes → Tipos y estados, la plantilla de enlace de US y
TS puede apuntar a Rally con `{id}`).

**Alternativa a Copilot:** Claude Team (20–25 $ por usuario al mes, mínimo 5 puestos). Como ya pagamos Copilot,
no compensa para empezar.

---

## 3. Qué se guarda en el repositorio

```
src/          la app (gestor y, más adelante, el panel)
plantillas/   mensajes de entrega y avisos; los editamos aquí y salen en la app («Mensaje» en cada tarea)
agente/       instrucciones del agente, glosario (US, TS, estados) y preguntas frecuentes   ← próximo paso
docs/         este plan y las decisiones
```

Forma de trabajar: cada cambio en una rama, revisión con un pull request y `npm run typecheck && npm test &&
npm run build` antes de unir. Cada uno tiene su copia local y sus datos en su navegador.

---

## 4. Dudas abiertas

1. ¿El GitHub va en la organización de WPP o en una cuenta personal?
2. ¿Quién es el interlocutor en el cliente para pedir el permiso de Rally y Confluence?
3. ¿Confluence es Cloud (`atlassian.net`)?
4. ¿Tenemos Copilot Studio activado o hay que pedirlo a IT?
5. Un par de mensajes reales de entrega de US y TS, para ajustar las plantillas.

---

## Fuentes

- Rally: [acceso al servidor MCP](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/reference/ai/enable-a-model-context-protocol--mcp--server-/access-an-mcp-server.html),
  [requisitos](https://knowledge.broadcom.com/external/article/433691/requirements-to-enable-mcp-in-rally.html),
  [autorización WSAPI](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/reference/rally-web-services-api/authorization.html),
  [notas Q2 2026](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/release-notes/q2-2026-release-notes.html),
  [límites](https://knowledge.broadcom.com/external/article/95713/rally-wsapi-are-there-any-limitations-t.html),
  [CORS](https://knowledge.broadcom.com/external/article/229820/unable-to-make-cors-network-requests.html)
- Atlassian: [servidor MCP oficial](https://github.com/atlassian/atlassian-mcp-server),
  [límites](https://www.atlassian.com/platform/remote-mcp-server),
  [novedades](https://developer.atlassian.com/cloud/rovo-mcp/changelog/),
  [control de tokens](https://atlassian.com/software/guard/guide/api-token-controls),
  [coste (comunidad)](https://community.atlassian.com/forums/Bitbucket-questions/Bitbucket-MCP-server-Price-Rovo/qaa-p/3269031)
- Microsoft: [permisos de Graph](https://learn.microsoft.com/en-us/graph/permissions-reference),
  [consentimiento en Entra ID](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview),
  [Work IQ en Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/use-work-iq),
  [guía de licencias de Copilot Studio (ago. 2026)](https://www.licensingschool.co.uk/wp-content/uploads/2026/08/Microsoft-Copilot-Studio-Licensing-Guide-August-2026.pdf)
- Claude: [precios del plan Team](https://support.anthropic.com/en/articles/9267305-what-is-the-pricing-for-the-team-plan)
