# Guía de despliegue – Sistema de Sorteos

Todo se hace desde el navegador del celular (Cloudflare + GitHub web).

## 1. Base de datos (Cloudflare D1)
1. Entra a **dash.cloudflare.com** → *Storage & Databases* → **D1** → *Create database*.
2. Nombre: `sorteos` → Crear. (Las tablas se crean solas.)

## 2. Fotos (Cloudflare R2) – opcional pero recomendado
1. *Storage & Databases* → **R2** → *Create bucket* → nombre: `sorteos-img`.
2. R2 puede pedirte registrar un medio de pago para activarse, aunque uses el plan gratis.
   Si no quieres activarlo, sáltate este paso: las fotos se guardarán en D1 (funciona igual, solo ocupa más espacio).

## 3. Worker (la API)
1. *Compute* → **Workers & Pages** → *Create* → *Create Worker* → nombre `sorteos` → Deploy.
2. *Edit code* → borra todo → pega el contenido de **worker.js** → *Deploy*.
3. En el Worker → **Settings → Bindings → Add**:
   - *D1 database* → nombre de variable **`DB`** → base `sorteos`.
   - *R2 bucket* → nombre de variable **`IMG`** → bucket `sorteos-img` (si lo creaste).
4. **Settings → Variables and Secrets → Add**:
   - `ADMIN_PIN` (tipo **Secret**) → tu PIN del panel.
   - `ALLOWED_ORIGIN` (opcional) → `https://jarryllanoski.github.io` para que solo tu web use la API.
5. Copia la URL del Worker (ej. `https://sorteos.tuusuario.workers.dev`). Ábrela: debe mostrar `{"ok":true,"app":"sorteos"}`.

## 4. Páginas (GitHub Pages)
1. En **index.html** y **formulario.html** busca `CONFIG` arriba del `<script>` y pega la URL del Worker en `API: ''`.
2. Sube ambos archivos a un repositorio (pueden ir en la misma carpeta) y activa *Settings → Pages*.
3. Abre `index.html`, entra con tu PIN y crea tu primer sorteo.

## 5. Antispam (opcional)
Cloudflare → **Turnstile** → *Add widget* con tu dominio de GitHub Pages:
- *Site key* → pégala en el panel: Config → Sistema → Turnstile Site Key.
- *Secret key* → variable del Worker `TURNSTILE_SECRET`.

## Links que genera el sistema
| Para qué | Link |
|---|---|
| Participar | `formulario.html?r=ID` |
| Participantes + verificación | `formulario.html?r=ID&v=p` |
| Boleto de cada cliente | `formulario.html?t=TOKEN` |
| Link personalizado (1 uso) | `formulario.html?l=CODIGO` |

## Consumo estimado (plan gratis)
- Abrir el formulario: **1 lectura** (el talonario entero es una sola fila).
- Registrarse: unas **3–5 lecturas y 2 escrituras**.
- Lista pública: 1 lectura por participante, con caché de 24 s.
Con los límites gratis de D1 (5 M lecturas y 100 mil escrituras al día) hay margen para miles de participantes diarios.
