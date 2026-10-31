# Guía – Sistema de Sorteos

Todo vive en **Cloudflare**, en un solo Worker llamado `sorteos`:

| Qué | Dirección |
|---|---|
| Panel admin | https://sorteos.jarryllanoski.workers.dev/ |
| Formulario público | https://sorteos.jarryllanoski.workers.dev/formulario?r=ID |
| Estado de la API | https://sorteos.jarryllanoski.workers.dev/api → `{"ok":true,"app":"sorteos","v":1}` |

## Qué hay en el repositorio
- **public/index.html** → panel admin.
- **public/formulario.html** → página pública para participar.
- **worker.js** → la API (rutas `/api/*` y fotos `/pub/*`).
- **wrangler.toml** → configuración: base D1, fotos R2, variables y páginas.
- **index.html / formulario.html** (en la raíz) → solo redirigen los links viejos
  de GitHub Pages a Cloudflare. **No editar**: los cambios van en `public/`.

Solo lo que está en `public/` se publica como página. El resto del código no es visible.

## Cómo desplegar
Desde la carpeta del proyecto:
```
npx wrangler deploy
```
Regla: **lo que está en `main` es lo que debe estar publicado.**

## Configuración en Cloudflare (ya hecha)
- Base D1 `sorteos` (las tablas se crean solas).
- Bucket R2 `sorteos-img` → fotos de premios (`p/…`, públicas) y comprobantes (`c/…`, solo con PIN).
- Secreto `ADMIN_PIN` → PIN del panel. Para cambiarlo: `npx wrangler secret put ADMIN_PIN`.
- `ALLOWED_ORIGIN` → la dirección del Worker (en `wrangler.toml`).

## Estados y papelera
- 🆕 **NUEVO** → registro por revisar.
- ✅ **CONFIRMADO** → pago verificado, entra al sorteo.
- 🏁 **CULMINADO** → ya participó. Al hacer el sorteo 🎲 los confirmados pasan solos; también se puede cambiar a mano. No se puede mandar a la papelera.
- 🗑️ **Papelera** (botón al lado del dado) → toca 🗑️ **dos veces** en una tarjeta para mandarla ahí. Sus números quedan libres.
  Se puede **recuperar** con ♻️. No hay botón de vaciar: cada día, lo que lleva **30 días** se borra solo y para siempre (con su comprobante).
  Las reservas vencidas también van a la papelera.

## Seguridad del PIN
- Si alguien pone el PIN mal **5 veces seguidas**, ese celular o red queda **bloqueado 15 minutos** (aunque después ponga el correcto).
- La pantalla avisa cuántos intentos quedan. Un acierto reinicia el contador.
- Si te bloqueas tú: espera 15 minutos, o entra desde otra red (por ejemplo, datos móviles en vez de WiFi).

## Antispam (Cloudflare Turnstile)
Protege **todos los sorteos** a la vez. Se activa solo cuando el Worker tiene las dos claves:
- `TURNSTILE_SITEKEY` (pública) → en `wrangler.toml`.
- `TURNSTILE_SECRET` (secreta) → `npx wrangler secret put TURNSTILE_SECRET`.
El widget se crea en Cloudflare → **Turnstile** → *Add widget*, dominio `sorteos.jarryllanoski.workers.dev`, modo *Managed*.

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
