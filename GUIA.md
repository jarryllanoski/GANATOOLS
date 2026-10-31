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

## Formulario por pasos (diseño de Total-Tools)
1. **Números** → 2. **Tus datos** (DNI → nombre automático) → 3. **Pago** (el N° de operación aparece recién al subir la captura; aquí acepta las bases) → **Participar**.
- La **foto del premio** sale grande arriba: súbela en el panel → Config → *Foto del premio*.
- Arriba se ve un **boleto vivo** que se llena mientras el cliente escribe.
- **Heavy** (el guía) da consejos en cada paso; se cierra con cualquier toque.

### Envío del premio (después de registrarse, opcional)
En su boleto el cliente ve **"📦 ¿Cómo te enviamos el premio si ganas?"** con los couriers de Total-Tools:
Shalom y Olva (lista de sedes con buscador y ubicación), Marvisur (escribe la agencia), Delivery (dirección),
Otras agencias (ciudad) y Retiro en tienda. Puede elegirlo después desde el link de su boleto.
- Panel → Config → **Envío del premio**: prende o apaga la pregunta y cada courier; pon la dirección de tu tienda.
- En el panel, cada tarjeta muestra el envío o **"⚠️ Sin datos de envío"**. El CSV trae Envío, Destino y Departamento.
- Al registrarse, WhatsApp se abre después de que elige el envío (o toca "Lo elijo después").

### DNI con RENIEC (shalom-api.lat)
- La clave va como secreto del Worker: **`RENIEC_API_KEY`**. Sin la clave, el cliente escribe su nombre a mano.
- Protecciones: un DNI ya consultado no vuelve a costar (caché de 1 año); máximo 12 consultas nuevas
  cada 10 minutos por red y **150 consultas nuevas al día**. Pasado el tope, el formulario sigue funcionando.
- Si el DNI ya se consultó, se guarda el **nombre oficial** (aunque el cliente escriba otro).

### Listas de agencias
- `public/data/agencias-shalom.json` (562 sedes) y `public/data/agencias-olva.json` (430 sedes), copiadas de Total-Tools.
  Para actualizarlas, reemplaza esos archivos.

## Impresión de tickets
Se imprime **un ticket por cada número**, con los datos de su dueño ("Número 2 de 5").
Al tocar imprimir, el panel pregunta el formato (y recuerda el último):

| Formato | Papel | Uso |
|---|---|---|
| A4 a color | 210 × 297 mm, 5 tickets con talón por hoja | Impresora normal |
| Ticketera 80 mm | 80 × 100 mm por ticket, blanco y negro | Ticketera térmica |
| Ticketera 58 mm | 58 × 90 mm por ticket, blanco y negro | Ticketera térmica pequeña |
| Sticker 100 × 50 mm | Una etiqueta por ticket | Impresora de etiquetas |
| Sticker 50 × 30 mm | Una etiqueta por ticket, sin QR | Impresora de etiquetas |

En la ventana de impresión elige el **mismo tamaño de papel**, **márgenes: ninguno** y **escala: 100 %**.
Cada ticket es una página, así la ticketera corta entre ticket y ticket.
El código está en `public/impresion.js`: para agregar un tamaño, se añade una entrada en `FORMATOS`.

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
