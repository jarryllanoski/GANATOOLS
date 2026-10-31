# Guía – Sistema de Sorteos

Todo vive en **Cloudflare**, en un solo Worker llamado `sorteos`:

| Qué | Dirección |
|---|---|
| Panel admin | https://sorteos.jarryllanoski.workers.dev/ |
| Formulario público | https://sorteos.jarryllanoski.workers.dev/formulario?r=ID |
| Estado de la API | https://sorteos.jarryllanoski.workers.dev/api → `{"ok":true,"app":"sorteos","v":1}` |

## Qué hay en el repositorio
- **index.html** → panel admin.
- **formulario.html** → página pública para participar.
- **worker.js** → la API (rutas `/api/*` y fotos `/pub/*`).
- **wrangler.toml** → configuración: base D1, variables y páginas.

Al desplegar, solo `index.html` y `formulario.html` se publican como páginas
(se copian a la carpeta temporal `public/`). El resto del código no es visible.

## Cómo desplegar
Desde la carpeta del proyecto:
```
npx wrangler deploy
```
Regla: **lo que está en `main` es lo que debe estar publicado.**

## Configuración en Cloudflare (ya hecha)
- Base D1 `sorteos` (las tablas se crean solas).
- Secreto `ADMIN_PIN` → PIN del panel. Para cambiarlo: `npx wrangler secret put ADMIN_PIN`.
- `ALLOWED_ORIGIN` → la dirección del Worker (en `wrangler.toml`).

## Antispam (opcional)
Cloudflare → **Turnstile** → *Add widget* con el dominio `sorteos.jarryllanoski.workers.dev`:
- *Site key* → en el panel: Config → Sistema → Turnstile Site Key.
- *Secret key* → `npx wrangler secret put TURNSTILE_SECRET`.

## Links que genera el sistema
| Para qué | Link |
|---|---|
| Participar | `formulario?r=ID` |
| Participantes + verificación | `formulario?r=ID&v=p` |
| Boleto de cada cliente | `formulario?t=TOKEN` |
| Link personalizado (1 uso) | `formulario?l=CODIGO` |

## Consumo estimado (plan gratis)
- Abrir el formulario: **1 lectura** (el talonario entero es una sola fila).
- Registrarse: unas **3–5 lecturas y 2 escrituras**.
- Lista pública: 1 lectura por participante, con caché de 24 s.
Con los límites gratis de D1 (5 M lecturas y 100 mil escrituras al día) hay margen para miles de participantes diarios.
