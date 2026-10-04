# Paisaje TikTok para un CLI de una sola cuenta (investigación, 2026-10-04)

> Investigación previa a `surface-recon`. Fuentes web; lo no verificado está marcado.

**En resumen:** ninguna vía cubre las cinco funciones. Lo viable es un híbrido:

- **API oficial**: tu perfil, estadísticas por video y subida como borrador.
- **Accounts API (Business)**: comentarios, pero solo con cuenta Business y app aprobada.
- **Navegador** (Playwright con perfil persistente sobre TikTok Studio): todo lo demás.

## 1. APIs oficiales

| API | Qué permite | Acceso | Límites |
|---|---|---|---|
| Login Kit + Display API ([docs](https://developers.tiktok.com/doc/display-api-overview)) | Tu perfil (`/v2/user/info/`) y tus videos con contadores (`/v2/video/list/`, `/v2/video/query/`). No da feed ni comentarios. | Cualquier desarrollador. El modo Sandbox funciona sin revisión. Scopes: `user.info.basic/profile/stats`, `video.list`. | 600 req/min |
| Content Posting: Direct Post ([docs](https://developers.tiktok.com/doc/content-posting-api-get-started)) | Publica directamente. | Sin auditar, todo sale `SELF_ONLY` (privado). La auditoría **rechaza** las "utilidades para subir contenido a cuentas propias" ([guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)). | 6/min en `init`, unos 15 posts al día |
| Content Posting: Upload / borrador ([docs](https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content)) | El video llega a tu bandeja y lo terminas en la app. | Scope `video.upload`. *No verificado:* si un borrador de una app sin auditar se puede publicar como público. | — |
| Research API | Lee videos, comentarios y usuarios públicos. | Solo academia u ONG. No aplica. | — |
| Commercial Content API | Biblioteca de anuncios de la UE. | Irrelevante. | — |
| Business: Accounts API ([reply](https://business-api.tiktok.com/portal/docs/reply-to-a-comment/v1.3), [publish](https://business-api.tiktok.com/portal/docs/publish-a-public-video-post-to-an-owned-account/v1.3)) | Lista comentarios, responde, da like, oculta, borra y fija. Webhook `comment.update`, insights y **publicación pública**. | Solo cuenta **Business**. Requiere un formulario de acceso y revisión (obligatorio desde marzo de 2026 según [openreply#75](https://github.com/diwenne/openreply/pull/75)). *No verificado:* si aprueba a desarrolladores individuales. | Publicar: 6/min y 15/día. El polling devuelve solo los 30 comentarios más nuevos. Filtro de spam. |
| Business Messaging | Mensajes directos. | No disponible en EE. UU., EEE, Suiza, Reino Unido ni India. | — |

No hay API oficial para el feed "Para ti" ni para comentarios de videos ajenos.

## 2. Librerías no oficiales

| Proyecto | Lenguaje | Estado | Qué hace | Notas |
|---|---|---|---|---|
| [davidteather/TikTok-Api](https://github.com/davidteather/TikTok-Api) | Python | v7.3.3, push 2026-08 | Solo lectura | Playwright + `ms_token`. Respuestas vacías por el antibot. |
| [wkaisertexas/tiktok-uploader](https://github.com/wkaisertexas/tiktok-uploader) | Python | push 2026-02 | Subida y programación | Playwright con cookies. Deja de subir tras muchos usos. |
| [makiisthenes/TiktokAutoUploader](https://github.com/makiisthenes/TiktokAutoUploader) | Python | v2.0.1, 2026-10-03 | Subida, varias cuentas | Login por QR. AGPL-3.0. |
| [Evil0ctal/Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API) | Python | push 2026-10 | Scraper, API, MCP | Solo lectura |
| [carcabot/tiktok-signature](https://github.com/carcabot/tiktok-signature) | Node | push 2026-08 | Firmas | — |
| [thenavidm/tiktok-mcp-cli](https://github.com/thenavidm/tiktok-mcp-cli) | TS | push 2026-10, 0★ | CLI y MCP oficial | Sin comentarios |
| [IvanBBaev/tiktok-mcp](https://github.com/IvanBBaev/tiktok-mcp) | TS | push 2026-10 | MCP oficial con PKCE | Buena referencia |
| drawrowfly/tiktok-scraper, szdc/tiktok-api | TS | abandonados | — | No usar |

Ninguna librería mantenida **responde comentarios** con tu sesión.

## 3. Automatización de navegador

- **Antibot:** la web exige `X-Bogus`, `msToken` y desde 2025–26 `X-Gnarly`. Sin un runtime JS real recibes un 200 vacío. Conviene un navegador real, no firmar a mano.
- **TikTok Studio** (`tiktok.com/tiktokstudio`): subida, analíticas y gestión de comentarios (filtro "no respondidos", responder, like, borrar). Es la mejor superficie para automatizar.
- **Enfoque:**
  - `launchPersistentContext` y login manual una vez;
  - leer interceptando el JSON (`/api/comment/list`, `/api/post/item_list`);
  - escribir con acciones de interfaz;
  - Chrome real en modo headed.
- **Agentes de navegador** (agent-browser, browser-use, Stagehand): de respaldo para flujos frágiles.
- **Riesgos:** viola los Términos de Servicio, captchas, bloqueo de subidas, shadowban si respondes en ráfaga. Mitigaciones: ritmo humano, límites diarios, IP doméstica.

## Matriz

| Función | API oficial | Librería no oficial | Navegador |
|---|---|---|---|
| Feed / tendencias | No | Lectura, frágil | Sí |
| Mi perfil y mis videos | **Sí** (Sandbox) | Sí | Sí |
| Perfil y videos de otros | No | Sí | Sí |
| Comentarios de mis videos | Solo Business | Lectura | **Sí** (Studio) |
| Comentarios de videos ajenos | No | Lectura | Sí |
| Responder comentarios | Solo Business | No | **Sí** (Studio) |
| Analíticas | Básicas; ricas con Business | No | **Sí** (Studio) |
| Publicar en público | Solo Business (Direct Post excluye herramientas personales) | Sí | **Sí** (Studio) |
| Publicar como borrador | **Sí** | — | Sí |

## Recomendación

Una interfaz de comandos con dos adaptadores:

1. `official`: Display API y `video.upload` (borrador).
2. `browser`: Playwright con perfil persistente sobre Studio y la web para el feed, otros usuarios, comentarios, respuestas, analíticas y publicación pública.

Si la cuenta es Business y te aprueban la app, mueve comentarios, analíticas y publicación a la Accounts API.

## No verificado

- Las páginas de business-api no cargaron. Los endpoints y scopes salen de búsquedas y de openreply#75.
- Si la Accounts API aprueba a desarrolladores individuales.
- Si un borrador de una app sin auditar se puede publicar como público.
- Los endpoints internos actuales de Studio. Hay que inspeccionarlos en vivo con `surface-recon`.
