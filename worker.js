/* ==========================================================================
   SORTEOS · Worker de Cloudflare (API)
   --------------------------------------------------------------------------
   Bindings (Worker → Settings → Bindings):
     DB   → base de datos D1           (obligatorio)
     IMG  → bucket R2                  (opcional: sin R2 las fotos se guardan en D1)
   Variables (Worker → Settings → Variables and Secrets):
     ADMIN_PIN        → PIN del panel   (obligatorio, tipo Secret)
     ALLOWED_ORIGIN   → ej: https://sorteos.tuusuario.workers.dev (opcional, por defecto *)
     TURNSTILE_SECRET → clave secreta de Turnstile        (opcional, antispam)
   Las tablas se crean solas en la primera petición.
   ========================================================================== */

const CFG = {
  CACHE_MS: 12000,   // caché en memoria de lecturas públicas (ahorra lecturas D1)
  IP_MAX: 6,         // registros máximos por IP...
  IP_WIN: 10 * 60e3, // ...dentro de esta ventana
  MAX_IMG: 1.5e6,    // peso máx. de comprobante (bytes)
  MAX_NUM: 10000,    // números máximos por sorteo
  RETRIES: 4,        // reintentos ante escrituras simultáneas
  PAPELERA_DIAS: 30, // días en la papelera antes de borrarse para siempre
  PIN_MAX: 5,             // PIN equivocado X veces seguidas...
  PIN_BLOQUEO: 15 * 60e3, // ...bloquea ese dispositivo/red durante 15 minutos
};

/* ---------------- Esquema ---------------- */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rifas (id TEXT PRIMARY KEY, cfg TEXT NOT NULL, board TEXT NOT NULL, priv TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 0, act INTEGER NOT NULL DEFAULT 0, creado INTEGER)`,
  `CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, rifa TEXT NOT NULL, tok TEXT NOT NULL, nombre TEXT, cel TEXT, dni TEXT, nums TEXT, monto REAL, op TEXT, img TEXT, ih TEXT, est TEXT, creado INTEGER, vence INTEGER, ip TEXT, nota TEXT)`,
  `CREATE INDEX IF NOT EXISTS ix_part_rifa ON part(rifa, creado)`,
  `CREATE INDEX IF NOT EXISTS ix_part_exp ON part(rifa, est, vence)`,
  `CREATE INDEX IF NOT EXISTS ix_part_cel ON part(rifa, cel)`,
  `CREATE INDEX IF NOT EXISTS ix_part_ip ON part(rifa, ip, creado)`,
  `CREATE INDEX IF NOT EXISTS ix_part_op ON part(rifa, op)`,
  `CREATE INDEX IF NOT EXISTS ix_part_ih ON part(rifa, ih)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_part_tok ON part(tok)`,
  `CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, rifa TEXT, data TEXT, usado INTEGER DEFAULT 0, creado INTEGER)`,
  `CREATE TABLE IF NOT EXISTS imgs (k TEXT PRIMARY KEY, mime TEXT, b64 TEXT)`,
  // Intentos de PIN fallidos por IP (guardada cifrada): n = fallos seguidos, hasta = fin del bloqueo
  `CREATE TABLE IF NOT EXISTS intentos (ip TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, ult INTEGER, hasta INTEGER NOT NULL DEFAULT 0)`,
];
// Columnas agregadas después (papelera): bor = fecha en que entró a la papelera,
// prev = estado que tenía antes (para recuperarlo igual).
const MIGRAR = ['ALTER TABLE part ADD COLUMN bor INTEGER', 'ALTER TABLE part ADD COLUMN prev TEXT'];
let SCHEMA_OK = false;
async function ensureSchema(env) {
  if (SCHEMA_OK) return;
  if (!env.DB) err('Falta el binding D1 llamado "DB" en el Worker', 500);
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  for (const q of MIGRAR) {
    try { await env.DB.prepare(q).run(); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
  SCHEMA_OK = true;
}

/* ---------------- Valores por defecto de un sorteo ---------------- */
const DEF = {
  titulo: 'Nuevo sorteo', desc: '', foto: '', premios: ['Premio principal'],
  modo: 'pago', estado: 'activa', cantidad: 100, base: 1,
  maxPer: 0, maxSel: 20, elegir: true, aprobar: false,
  cierre: 0, bloqueoH: 0, reservaMin: 30,
  precio: 5, promos: [], yape: '', plin: '', titular: '', qr: '', bancos: '', instr: '',
  compObl: false, opObl: true, wa: '', negocio: '', bases: '', tsKey: '',
};

/* ---------------- Entrada ---------------- */
export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    let res;
    try {
      await ensureSchema(env);
      res = await route(req, env);
    } catch (e) {
      res = J({ ok: false, error: e.message || 'Error interno' }, e.status || 500);
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors(origin))) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  },
  // Tarea diaria (cron en wrangler.toml): vacía lo que lleva más de 30 días en la papelera
  async scheduled(evt, env, ctx) {
    ctx.waitUntil(ensureSchema(env).then(async () => {
      await limpiarPapelera(env);
      // Borra registros de intentos de PIN viejos (más de 1 día sin actividad)
      await env.DB.prepare('DELETE FROM intentos WHERE hasta<? AND ult<?').bind(now(), now() - 864e5).run();
    }));
  },
};

function cors(o) {
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,x-pin',
    'Access-Control-Max-Age': '86400',
  };
}

async function route(req, env) {
  const u = new URL(req.url);
  const m = req.method;
  const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!seg.length) return J({ ok: true, app: 'sorteos', v: 1 });
  if (seg[0] === 'pub' && m === 'GET') return getImg(env, seg.slice(1).join('/'), true);
  if (seg[0] !== 'api') err('No encontrado', 404);
  const [, a, b, c] = seg;
  if (!a) return J({ ok: true, app: 'sorteos', v: 1 });
  if (a === 'admin') { await auth(req, env); return admin(req, env, seg.slice(2)); }
  if (a === 'r' && b && !c && m === 'GET') return pubRifa(env, b);
  if (a === 'r' && b && c === 'part' && m === 'GET') return pubPart(env, b);
  if (a === 'r' && b && c === 'entrar' && m === 'POST') return entrar(req, env, b);
  if (a === 't' && b && !c && m === 'GET') return boleto(env, b);
  if (a === 't' && b && c === 'pago' && m === 'POST') return pagoTardio(req, env, b);
  if (a === 'l' && b && m === 'GET') return linkInfo(env, b);
  err('Ruta no encontrada', 404);
}

/* ---------------- Utilidades ---------------- */
const J = (o, st = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
function err(msg, status = 400) { const e = new Error(msg); e.status = status; throw e; }
const now = () => Date.now();
const enc = s => new TextEncoder().encode(s);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc(s) : s));
const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
const rid = (n = 10) => [...crypto.getRandomValues(new Uint8Array(n))].map(x => ABC[x % ABC.length]).join('');
const randInt = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const splitNums = s => String(s || '').split(',').filter(x => x !== '').map(Number).filter(Number.isInteger);
const baseOf = c => (c.base === 0 ? 0 : 1);
const fmtNum = (c, i) => String(i + baseOf(c)).padStart(String((c.cantidad || 1) - 1 + baseOf(c)).length, '0');
const ext = mime => ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }[mime] || 'bin');
const cap = w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '');
function maskName(n) { const w = String(n || '').trim().split(/\s+/).filter(Boolean); return w.length ? cap(w[0]) + (w[1] ? ' ' + w[1][0].toUpperCase() + '.' : '') : '—'; }
function maskCel(c) { c = String(c || ''); return c.length >= 9 ? c[0] + '•• ••• ' + c.slice(-3) : '•••'; }
function stats(board) {
  const s = { total: board.length, libres: 0, reserv: 0, rev: 0, pag: 0 };
  for (const ch of board) { if (ch === '0') s.libres++; else if (ch === '1') s.reserv++; else if (ch === '2') s.rev++; else if (ch === '3') s.pag++; }
  return s;
}
function pickRandom(arr, k) {
  const a = arr.slice();
  for (let i = 0; i < k; i++) { const j = i + randInt(a.length - i); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, k);
}
function precioTotal(c, k) {
  const pu = +c.precio || 0;
  const promos = (c.promos || []).filter(p => p.n > 1);
  const best = [0];
  for (let i = 1; i <= k; i++) {
    let v = best[i - 1] + pu;
    for (const p of promos) if (i >= p.n) v = Math.min(v, best[i - p.n] + p.p);
    best[i] = v;
  }
  return Math.round(best[k] * 100) / 100;
}
function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

/* Caché en memoria (por instancia) */
const MEM = new Map();
const memGet = k => { const v = MEM.get(k); return v && v.t > now() ? v.d : null; };
const memSet = (k, d, ms) => { if (MEM.size > 200) MEM.clear(); MEM.set(k, { d, t: now() + ms }); };
const memDel = id => { MEM.delete('r:' + id); MEM.delete('p:' + id); };

// Bloqueo del PIN: tras PIN_MAX fallos seguidos desde la misma IP, esa IP queda
// bloqueada PIN_BLOQUEO (aunque luego ponga el PIN correcto). Un acierto reinicia el contador.
async function auth(req, env) {
  if (!env.ADMIN_PIN) err('Configura la variable ADMIN_PIN en el Worker', 500);
  const ip = (await sha((req.headers.get('cf-connecting-ip') || 'x') + 'pin')).slice(0, 16), t = now();
  const row = await env.DB.prepare('SELECT n,ult,hasta FROM intentos WHERE ip=?').bind(ip).first();
  const espera = ms => { const m = Math.ceil(ms / 60e3); return `${m} minuto${m === 1 ? '' : 's'}`; };
  if (row && row.hasta > t) err(`🔒 Demasiados intentos. Espera ${espera(row.hasta - t)} y vuelve a intentar.`, 429);
  // Comparación por huella: tarda lo mismo acierte o no
  if (await sha(req.headers.get('x-pin') || '') === await sha(String(env.ADMIN_PIN))) {
    if (row) await env.DB.prepare('DELETE FROM intentos WHERE ip=?').bind(ip).run();
    return;
  }
  const n = (row && row.hasta === 0 && t - row.ult < 864e5 ? row.n : 0) + 1, bloq = n >= CFG.PIN_MAX;
  await env.DB.prepare('INSERT OR REPLACE INTO intentos (ip,n,ult,hasta) VALUES (?,?,?,?)').bind(ip, bloq ? 0 : n, t, bloq ? t + CFG.PIN_BLOQUEO : 0).run();
  if (bloq) err(`🔒 Demasiados intentos. Espera ${espera(CFG.PIN_BLOQUEO)} y vuelve a intentar.`, 429);
  const q = CFG.PIN_MAX - n;
  err(`PIN incorrecto. Te queda${q === 1 ? '' : 'n'} ${q} intento${q === 1 ? '' : 's'}.`, 401);
}

async function turnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) err('Completa la verificación antispam');
  const fd = new FormData();
  fd.append('secret', env.TURNSTILE_SECRET); fd.append('response', token); if (ip) fd.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.success) err('La verificación antispam falló, recarga la página');
}

/* ---------------- Imágenes (R2 o D1) ---------------- */
async function putImg(env, key, buf, mime) {
  if (env.IMG) await env.IMG.put(key, buf, { httpMetadata: { contentType: mime } });
  else await env.DB.prepare('INSERT OR REPLACE INTO imgs (k,mime,b64) VALUES (?,?,?)').bind(key, mime, b64(buf)).run();
  return key;
}
async function getImg(env, key, pub) {
  if (pub && !key.startsWith('p/')) err('No permitido', 403);
  const cc = pub ? 'public, max-age=604800, immutable' : 'private, max-age=3600';
  if (env.IMG) {
    const o = await env.IMG.get(key);
    if (o) return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'image/webp', 'cache-control': cc } });
  }
  const row = await env.DB.prepare('SELECT mime,b64 FROM imgs WHERE k=?').bind(key).first();
  if (!row) err('Imagen no encontrada', 404);
  return new Response(unb64(row.b64), { headers: { 'content-type': row.mime, 'cache-control': cc } });
}
async function fileFrom(fd, name) {
  const f = fd.get(name);
  if (!f || typeof f === 'string' || !f.size) return null;
  if (f.size > CFG.MAX_IMG) err('La imagen es muy pesada (máx. 1.5 MB)');
  if (!/^image\/(webp|jpeg|png|gif)$/.test(f.type)) err('Formato de imagen no permitido');
  return { buf: await f.arrayBuffer(), mime: f.type };
}
async function delImgs(env, prefix) {
  await env.DB.prepare('DELETE FROM imgs WHERE k LIKE ?').bind(prefix + '%').run();
  if (!env.IMG) return;
  let cursor;
  do {
    const l = await env.IMG.list({ prefix, cursor });
    if (l.objects.length) await env.IMG.delete(l.objects.map(o => o.key));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
}

/* ---------------- Carga y escritura del sorteo ---------------- */
async function loadRifa(env, id, noExp) {
  const row = await env.DB.prepare('SELECT id,cfg,board,priv,ver,act FROM rifas WHERE id=?').bind(id).first();
  if (!row) err('Sorteo no encontrado', 404);
  const r = { id: row.id, cfg: JSON.parse(row.cfg), board: row.board, priv: JSON.parse(row.priv || '{}'), ver: row.ver, act: row.act };
  return noExp ? r : expire(env, r);
}

// Libera reservas vencidas solo cuando hace falta (cfg._nx = próximo vencimiento)
async function expire(env, r) {
  const nx = r.cfg._nx;
  if (!nx || nx > now()) return r;
  const t = now();
  const { results } = await env.DB.prepare("SELECT nums FROM part WHERE rifa=? AND est='R' AND vence<=?").bind(r.id, t).all();
  const b = r.board.split('');
  for (const p of results) for (const n of splitNums(p.nums)) if (b[n] === '1') b[n] = '0';
  const mn = await env.DB.prepare("SELECT MIN(vence) m FROM part WHERE rifa=? AND est='R' AND vence>?").bind(r.id, t).first();
  const cfg = { ...r.cfg, _nx: mn && mn.m ? mn.m : 0 };
  const board = b.join('');
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE part SET est='X', nota='vencido', bor=?, prev='R' WHERE rifa=? AND est='R' AND vence<=? AND (SELECT ver FROM rifas WHERE id=?)=?").bind(t, r.id, t, r.id, r.ver),
    env.DB.prepare('UPDATE rifas SET board=?, cfg=?, ver=ver+1 WHERE id=? AND ver=?').bind(board, JSON.stringify(cfg), r.id, r.ver),
  ]);
  if (!res[1].meta.changes) return loadRifa(env, r.id, true);
  memDel(r.id);
  return { ...r, board, cfg, ver: r.ver + 1 };
}

// Guarda board/cfg solo si nadie escribió antes (control de versión).
// `pre` son sentencias condicionadas a la misma versión: todo o nada.
async function commit(env, r, pre = [], act = 0) {
  const up = env.DB.prepare('UPDATE rifas SET board=?, cfg=?, ver=ver+1, act=act+? WHERE id=? AND ver=?')
    .bind(r.board, JSON.stringify(r.cfg), act, r.id, r.ver);
  const res = await env.DB.batch([...pre, up]);
  const ok = res[res.length - 1].meta.changes > 0;
  if (ok) { r.ver++; memDel(r.id); }
  return ok;
}
const VER_OK = '(SELECT ver FROM rifas WHERE id=?)=?';

function checkAbierta(c) {
  if (c.estado !== 'activa') err('Este sorteo no está recibiendo participantes por ahora');
  if (c.cierre && now() > c.cierre - (c.bloqueoH || 0) * 3600e3) err('La inscripción ya cerró');
}

async function dupPago(env, id, op, ih, except = '') {
  if (!op && !ih) return;
  const conds = [], binds = [id, except];
  if (op) { conds.push('op=?'); binds.push(op); }
  if (ih) { conds.push('ih=?'); binds.push(ih); }
  const q = await env.DB.prepare(`SELECT op FROM part WHERE rifa=? AND est!='X' AND id!=? AND (${conds.join(' OR ')}) LIMIT 1`).bind(...binds).first();
  if (q) err(op && q.op === op ? 'Ese N° de operación ya fue registrado' : 'Ese comprobante ya fue usado en otro registro', 409);
}

/* ---------------- Público ---------------- */
async function pubRifa(env, id) {
  let d = memGet('r:' + id);
  if (!d) {
    const r = await loadRifa(env, id);
    d = { id, cfg: r.cfg, board: r.board, t: now() };
    memSet('r:' + id, d, CFG.CACHE_MS);
  }
  return J({ ok: true, ...d }, 200, { 'cache-control': 'public, max-age=8' });
}

async function pubPart(env, id) {
  let d = memGet('p:' + id);
  if (!d) {
    const r = await loadRifa(env, id);
    const { results } = await env.DB.prepare("SELECT nombre,cel,nums,est,creado FROM part WHERE rifa=? AND est IN ('R','V','P') ORDER BY creado").bind(id).all();
    d = { id, cfg: r.cfg, board: r.board, list: results.map(p => ({ n: maskName(p.nombre), c: maskCel(p.cel), nums: p.nums, e: p.est, t: p.creado })), t: now() };
    memSet('p:' + id, d, CFG.CACHE_MS * 2);
  }
  return J({ ok: true, ...d }, 200, { 'cache-control': 'public, max-age=15' });
}

async function entrar(req, env, id) {
  const fd = await req.formData();
  const g = k => String(fd.get(k) || '').trim();
  const nombre = g('nombre').replace(/\s+/g, ' ').slice(0, 60);
  const cel = g('cel').replace(/\D/g, '').slice(-9);
  const dni = g('dni').replace(/\D/g, '').slice(0, 12);
  const op = g('op').replace(/\s/g, '').slice(0, 30);
  const ih = g('ih').replace(/[^a-f0-9]/gi, '').slice(0, 64);
  const code = g('link').slice(0, 20);
  const azar = Math.max(0, Math.min(500, parseInt(g('azar'), 10) || 0));
  const pedidos = [...new Set(splitNums(g('nums')))];

  if (nombre.length < 3) err('Escribe tu nombre completo');
  if (!/^9\d{8}$/.test(cel)) err('Celular inválido: 9 dígitos y empieza con 9');
  if (g('acepto') !== '1') err('Debes aceptar las bases del sorteo');

  const ip = req.headers.get('cf-connecting-ip') || '';
  await turnstile(env, g('ts'), ip);
  const iph = ip ? (await sha(ip + 'sx')).slice(0, 16) : '';

  let r = await loadRifa(env, id);
  const c = r.cfg;
  checkAbierta(c);
  const want = azar || pedidos.length;
  if (!want) err('Elige al menos un número');
  if (c.maxSel && want > c.maxSel) err(`Máximo ${c.maxSel} números por registro`);

  if (iph) {
    const q = await env.DB.prepare('SELECT COUNT(*) n FROM part WHERE rifa=? AND ip=? AND creado>?').bind(id, iph, now() - CFG.IP_WIN).first();
    if (q.n >= CFG.IP_MAX) err('Demasiados registros seguidos. Intenta en unos minutos.', 429);
  }
  if (c.maxPer) {
    const prev = await env.DB.prepare("SELECT nums FROM part WHERE rifa=? AND cel=? AND est IN ('R','V','P')").bind(id, cel).all();
    const ya = prev.results.reduce((a, p) => a + splitNums(p.nums).length, 0);
    if (ya + want > c.maxPer) err(ya ? `Ya tienes ${ya} número(s). El máximo por persona es ${c.maxPer}.` : `El máximo por persona es ${c.maxPer}`);
  }
  let link = null;
  if (code) {
    link = await env.DB.prepare('SELECT rifa,usado FROM links WHERE code=?').bind(code).first();
    if (!link || link.rifa !== id) err('Link personalizado inválido');
    if (link.usado) err('Este link personalizado ya fue usado');
  }

  const file = c.modo === 'pago' ? await fileFrom(fd, 'img') : null;
  if (c.modo === 'pago' && c.compObl && !file) err('Adjunta la foto de tu comprobante de pago');
  if (file && c.opObl !== false && !op) err('Escribe el N° de operación de tu pago');
  if (file) await dupPago(env, id, op, ih);

  const pid = rid(8), tok = rid(18), t = now();
  const key = file ? await putImg(env, `c/${id}/${pid}.${ext(file.mime)}`, file.buf, file.mime) : null;
  const est = c.modo === 'gratis' ? (c.aprobar ? 'V' : 'P') : (file ? 'V' : 'R');
  const ch = { R: '1', V: '2', P: '3' }[est];

  for (let i = 0; i < CFG.RETRIES; i++) {
    const b = r.board.split('');
    let idx;
    if (azar) {
      const libres = [];
      for (let j = 0; j < b.length; j++) if (b[j] === '0') libres.push(j);
      if (libres.length < want) err(libres.length ? `Solo quedan ${libres.length} números disponibles` : 'Ya no quedan números disponibles', 409);
      idx = pickRandom(libres, want);
    } else {
      const tomados = pedidos.filter(n => !(n >= 0 && n < b.length) || b[n] !== '0');
      if (tomados.length) err(`Ya no disponible: ${tomados.map(n => fmtNum(r.cfg, n)).join(', ')}. Elige otro(s).`, 409);
      idx = pedidos.slice();
    }
    idx.sort((x, y) => x - y);
    idx.forEach(j => { b[j] = ch; });
    r.board = b.join('');
    const vence = est === 'R' ? t + (c.reservaMin || 30) * 60e3 : 0;
    if (vence) r.cfg = { ...r.cfg, _nx: r.cfg._nx ? Math.min(r.cfg._nx, vence) : vence };
    const monto = c.modo === 'pago' ? precioTotal(c, idx.length) : 0;
    const pre = [
      env.DB.prepare(`INSERT INTO part (id,rifa,tok,nombre,cel,dni,nums,monto,op,img,ih,est,creado,vence,ip,nota) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${VER_OK}`)
        .bind(pid, id, tok, nombre, cel, dni, idx.join(','), monto, op || null, key, ih || null, est, t, vence, iph, code ? 'link:' + code : null, id, r.ver),
    ];
    if (code) pre.push(env.DB.prepare(`UPDATE links SET usado=1 WHERE code=? AND usado=0 AND ${VER_OK}`).bind(code, id, r.ver));
    if (await commit(env, r, pre, 1)) return J({ ok: true, tok, id: pid, nums: idx, est, vence, monto });
    r = await loadRifa(env, id);
  }
  err('Mucha gente registrándose a la vez, intenta de nuevo', 503);
}

async function boleto(env, tok) {
  const p = await env.DB.prepare('SELECT id,rifa,nombre,cel,nums,monto,op,img,est,creado,vence,nota FROM part WHERE tok=?').bind(tok).first();
  if (!p) err('Boleto no encontrado', 404);
  const r = await loadRifa(env, p.rifa);
  if (p.est === 'R' && p.vence && p.vence <= now()) { p.est = 'X'; p.nota = 'vencido'; }
  return J({ ok: true, rifa: { id: r.id, cfg: r.cfg }, p: { ...p, cel: maskCel(p.cel), img: !!p.img } });
}

async function pagoTardio(req, env, tok) {
  const fd = await req.formData();
  const g = k => String(fd.get(k) || '').trim();
  const op = g('op').replace(/\s/g, '').slice(0, 30);
  const ih = g('ih').replace(/[^a-f0-9]/gi, '').slice(0, 64);
  const file = await fileFrom(fd, 'img');
  if (!file) err('Adjunta la foto de tu comprobante');
  const p0 = await env.DB.prepare('SELECT id,rifa FROM part WHERE tok=?').bind(tok).first();
  if (!p0) err('Boleto no encontrado', 404);
  let r = await loadRifa(env, p0.rifa);
  if (r.cfg.modo !== 'pago') err('Este sorteo no requiere pago');
  if (r.cfg.opObl !== false && !op) err('Escribe el N° de operación de tu pago');
  await dupPago(env, p0.rifa, op, ih, p0.id);
  const key = await putImg(env, `c/${p0.rifa}/${p0.id}-${rid(4)}.${ext(file.mime)}`, file.buf, file.mime);

  for (let i = 0; i < CFG.RETRIES; i++) {
    const p = await env.DB.prepare('SELECT id,nums,est,nota FROM part WHERE id=?').bind(p0.id).first();
    if (p.est === 'P') err('Tu pago ya fue confirmado ✅');
    if (p.est === 'X' && p.nota !== 'vencido') err('Este registro fue anulado. Comunícate con el organizador.');
    const idx = splitNums(p.nums);
    const b = r.board.split('');
    if (p.est === 'X') {
      checkAbierta(r.cfg);
      const tom = idx.filter(j => b[j] !== '0');
      if (tom.length) err(`Tu reserva venció y estos números ya fueron tomados: ${tom.map(j => fmtNum(r.cfg, j)).join(', ')}`, 409);
    }
    idx.forEach(j => { b[j] = '2'; });
    r.board = b.join('');
    const pre = [env.DB.prepare(`UPDATE part SET est='V', op=?, img=?, ih=?, vence=0, nota=NULL, bor=NULL, prev=NULL WHERE id=? AND ${VER_OK}`).bind(op || null, key, ih || null, p.id, r.id, r.ver)];
    if (await commit(env, r, pre, 1)) return J({ ok: true, est: 'V' });
    r = await loadRifa(env, p0.rifa);
  }
  err('Intenta de nuevo en unos segundos', 503);
}

async function linkInfo(env, code) {
  const row = await env.DB.prepare('SELECT rifa,data,usado FROM links WHERE code=?').bind(code).first();
  if (!row) err('Link no encontrado', 404);
  return J({ ok: true, rifa: row.rifa, usado: !!row.usado, data: JSON.parse(row.data || '{}') });
}

/* ---------------- Sorteo verificable ----------------
   1) Al crear el sorteo se genera una semilla secreta y se publica su SHA-256 (compromiso).
   2) Al sortear: lista = índices pagados en orden → eh = SHA-256(lista.join(',')).
   3) Se toma aleatoriedad pública de drand (beacon) que nadie conoce de antemano.
   4) Ganador j = lista[ HMAC-SHA256(semilla, eh:beacon:j) mod tamaño ], sin repetir.
   Se publica la semilla: cualquiera puede repetir el cálculo en la página pública. */
async function drawPicks(seed, snap, beacon, k) {
  const paid = [];
  for (let i = 0; i < snap.length; i++) if (snap[i] === '1') paid.push(i);
  const eh = await sha(paid.join(','));
  const key = await crypto.subtle.importKey('raw', enc(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const pool = paid.slice(), out = [];
  for (let j = 0; j < k && pool.length; j++) {
    const h = hex(await crypto.subtle.sign('HMAC', key, enc(`${eh}:${beacon}:${j}`)));
    const ix = Number(BigInt('0x' + h.slice(0, 13)) % BigInt(pool.length));
    out.push(pool.splice(ix, 1)[0]);
  }
  return { picks: out, eh, total: paid.length };
}
async function beacon() {
  try {
    const r = await fetch('https://drand.cloudflare.com/public/latest', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return { round: j.round || 0, r: j.randomness || '' };
  } catch { return { round: 0, r: '' }; }
}

/* ---------------- Admin ---------------- */
async function admin(req, env, s) {
  const m = req.method;
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  if (s[0] === 'rifas' && !s[1] && m === 'GET') return listRifas(env);
  if (s[0] === 'rifas' && !s[1] && m === 'POST') return saveRifa(env, await body());
  if (s[0] === 'rifas' && s[1] && m === 'DELETE') return delRifa(env, s[1]);
  if (s[0] === 'r' && s[1] && s[2] === 'part' && m === 'GET') return adminDetalle(env, s[1]);
  if (s[0] === 'r' && s[1] && s[2] === 'sortear' && m === 'POST') return sortear(env, s[1], await body());
  if (s[0] === 'part' && s[1] && m === 'POST') return accion(env, s[1], await body());
  if (s[0] === 'upload' && m === 'POST') return upload(req, env);
  if (s[0] === 'img' && s[1] && m === 'GET') return getImg(env, s.slice(1).join('/'), false);
  if (s[0] === 'links' && m === 'POST') return crearLink(env, await body());
  err('Ruta admin no encontrada', 404);
}

async function listRifas(env) {
  const { results } = await env.DB.prepare('SELECT id,cfg,board,act FROM rifas ORDER BY creado DESC').all();
  return J({ ok: true, rifas: results.map(x => { const c = JSON.parse(x.cfg); return { id: x.id, titulo: c.titulo, estado: c.estado, modo: c.modo, act: x.act, st: stats(x.board) }; }) });
}

function sanitize(c) {
  const o = {};
  const str = (k, n = 300) => { if (k in c) o[k] = String(c[k] ?? '').slice(0, n); };
  const num = (k, min, max, int = true) => { if (k in c) { let v = +c[k]; if (!isFinite(v)) v = min; v = Math.max(min, Math.min(max, v)); o[k] = int ? Math.round(v) : Math.round(v * 100) / 100; } };
  const bool = k => { if (k in c) o[k] = !!c[k]; };
  str('titulo', 120); str('desc', 1500); str('foto', 200); str('qr', 200); str('yape', 20); str('plin', 20);
  str('titular', 80); str('bancos', 1000); str('instr', 1000); str('wa', 20); str('negocio', 60); str('bases', 8000); str('tsKey', 100);
  if ('premios' in c) o.premios = (Array.isArray(c.premios) ? c.premios : []).map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 20);
  if ('modo' in c) o.modo = c.modo === 'gratis' ? 'gratis' : 'pago';
  if ('estado' in c) o.estado = ['activa', 'pausada', 'cerrada', 'sorteada'].includes(c.estado) ? c.estado : 'activa';
  num('cantidad', 1, CFG.MAX_NUM); num('base', 0, 1); num('maxPer', 0, CFG.MAX_NUM); num('maxSel', 1, 500);
  num('bloqueoH', 0, 720); num('reservaMin', 5, 10080); num('precio', 0, 1e6, false); num('cierre', 0, 4e12);
  bool('elegir'); bool('aprobar'); bool('compObl'); bool('opObl');
  if ('promos' in c) o.promos = (Array.isArray(c.promos) ? c.promos : []).map(p => ({ n: Math.round(+p.n || 0), p: Math.max(0, Math.round((+p.p || 0) * 100) / 100) })).filter(p => p.n > 1).slice(0, 10);
  return o;
}

async function saveRifa(env, { id, cfg = {} }) {
  const clean = sanitize(cfg || {});
  if (!id) {
    const nid = rid(7);
    const seed = hex(crypto.getRandomValues(new Uint8Array(32)));
    const c = { ...DEF, ...clean, seedHash: await sha(seed), creado: now() };
    await env.DB.prepare('INSERT INTO rifas (id,cfg,board,priv,ver,act,creado) VALUES (?,?,?,?,0,0,?)')
      .bind(nid, JSON.stringify(c), '0'.repeat(c.cantidad), JSON.stringify({ seed }), now()).run();
    return J({ ok: true, id: nid });
  }
  for (let i = 0; i < CFG.RETRIES; i++) {
    const r = await loadRifa(env, id, true);
    const c = { ...r.cfg, ...clean };
    if (c.cantidad !== r.board.length) {
      if (r.cfg.resultado) err('No puedes cambiar la cantidad después del sorteo');
      if (c.cantidad > r.board.length) r.board += '0'.repeat(c.cantidad - r.board.length);
      else {
        if (/[^0]/.test(r.board.slice(c.cantidad))) err('No puedes reducir: hay números ocupados al final del talonario');
        r.board = r.board.slice(0, c.cantidad);
      }
    }
    r.cfg = c;
    if (await commit(env, r)) return J({ ok: true, id });
  }
  err('Intenta de nuevo', 503);
}

async function delRifa(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rifas WHERE id=?').bind(id),
    env.DB.prepare('DELETE FROM part WHERE rifa=?').bind(id),
    env.DB.prepare('DELETE FROM links WHERE rifa=?').bind(id),
  ]);
  await delImgs(env, `c/${id}/`);
  memDel(id);
  return J({ ok: true });
}

async function adminDetalle(env, id) {
  const r = await loadRifa(env, id);
  await limpiarPapelera(env, id);
  const { results } = await env.DB.prepare('SELECT id,tok,nombre,cel,dni,nums,monto,op,img,est,creado,vence,nota,bor,prev FROM part WHERE rifa=? ORDER BY creado DESC').bind(id).all();
  return J({ ok: true, rifa: { id: r.id, cfg: r.cfg, board: r.board, act: r.act }, parts: results });
}

// Papelera = registros anulados (est 'X'). Se pueden recuperar; a los 30 días
// se borran para siempre junto con sus comprobantes. Sin `id` limpia todos los sorteos.
async function limpiarPapelera(env, id) {
  const t = now(), lim = t - CFG.PAPELERA_DIAS * 864e5;
  const w = id ? 'rifa=? AND ' : '', b = id ? [id] : [];
  const { results } = await env.DB.prepare(`SELECT id,rifa FROM part WHERE ${w}est='X' AND bor<?`).bind(...b, lim).all();
  const q = [env.DB.prepare(`UPDATE part SET bor=? WHERE ${w}est='X' AND bor IS NULL`).bind(t, ...b)];
  if (results.length) q.push(env.DB.prepare(`DELETE FROM part WHERE ${w}est='X' AND bor<?`).bind(...b, lim));
  await env.DB.batch(q);
  for (const p of results) { await delImgs(env, `c/${p.rifa}/${p.id}.`); await delImgs(env, `c/${p.rifa}/${p.id}-`); }
  return results.length;
}

async function accion(env, pid, { acc, nota, nombre, cel, dni, op }) {
  if (acc === 'nota') {
    await env.DB.prepare('UPDATE part SET nota=? WHERE id=?').bind(String(nota || '').slice(0, 200), pid).run();
    return J({ ok: true });
  }
  if (acc === 'editar') {
    const p = await env.DB.prepare('SELECT rifa FROM part WHERE id=?').bind(pid).first();
    if (!p) err('Participante no encontrado', 404);
    const nom = String(nombre || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const c = String(cel || '').replace(/\D/g, '').slice(-9);
    if (nom.length < 3) err('Escribe el nombre completo');
    if (!/^9\d{8}$/.test(c)) err('Celular inválido: 9 dígitos y empieza con 9');
    await env.DB.prepare('UPDATE part SET nombre=?, cel=?, dni=?, op=?, nota=? WHERE id=?')
      .bind(nom, c, String(dni || '').replace(/\D/g, '').slice(0, 12), String(op || '').replace(/\s/g, '').slice(0, 30) || null, String(nota || '').slice(0, 200) || null, pid).run();
    memDel(p.rifa);
    return J({ ok: true });
  }
  const MAP = { aprobar: ['P', '3'], revision: ['V', '2'], rechazar: ['X', '0'], liberar: ['X', '0'] };
  if (!MAP[acc]) err('Acción inválida');
  const [est, ch] = MAP[acc];
  for (let i = 0; i < CFG.RETRIES; i++) {
    const p = await env.DB.prepare('SELECT id,rifa,nums,est,nota FROM part WHERE id=?').bind(pid).first();
    if (!p) err('Participante no encontrado', 404);
    if (p.est === est) return J({ ok: true, est });
    const r = await loadRifa(env, p.rifa);
    if (est === 'X' && p.est === 'P' && r.cfg.resultado) err('Ya participó del sorteo: no se puede mandar a la papelera');
    const idx = splitNums(p.nums);
    const b = r.board.split('');
    if (p.est === 'X') {
      const tom = idx.filter(j => b[j] !== '0');
      if (tom.length) err(`Estos números ya son de otra persona: ${tom.map(j => fmtNum(r.cfg, j)).join(', ')}`, 409);
    }
    idx.forEach(j => { b[j] = ch; });
    r.board = b.join('');
    const nn = est === 'X' ? (acc === 'rechazar' ? 'rechazado' : 'liberado') : (p.nota === 'vencido' || p.nota === 'rechazado' || p.nota === 'liberado' ? null : p.nota);
    const bor = est === 'X' ? now() : null, prev = est === 'X' ? p.est : null;
    const pre = [env.DB.prepare(`UPDATE part SET est=?, nota=?, vence=0, bor=?, prev=? WHERE id=? AND ${VER_OK}`).bind(est, nn, bor, prev, pid, r.id, r.ver)];
    if (await commit(env, r, pre)) return J({ ok: true, est });
  }
  err('Intenta de nuevo', 503);
}

async function sortear(env, id, { g = 1, s = 0, force = false }) {
  g = Math.max(1, Math.min(50, parseInt(g, 10) || 1));
  s = Math.max(0, Math.min(20, parseInt(s, 10) || 0));
  for (let i = 0; i < CFG.RETRIES; i++) {
    const r = await loadRifa(env, id);
    const prev = r.cfg.resultado;
    if (prev && !force) err('Este sorteo ya se realizó', 409);
    const snap = r.board.replace(/[^3]/g, '0').replace(/3/g, '1');
    const nPag = (snap.match(/1/g) || []).length;
    if (nPag < g) err(`Se necesitan al menos ${g} número(s) pagado(s). Hay ${nPag}.`);
    const bea = await beacon();
    const { picks, eh, total } = await drawPicks(r.priv.seed, snap, bea.r, Math.min(g + s, nPag));
    const { results } = await env.DB.prepare("SELECT id,nombre,cel,nums FROM part WHERE rifa=? AND est='P'").bind(id).all();
    const owner = new Map();
    for (const p of results) for (const n of splitNums(p.nums)) owner.set(n, p);
    const res = {
      t: now(), seed: r.priv.seed, eh, round: bea.round, beacon: bea.r, snap, g, s, total,
      picks: picks.map(n => ({ n, nom: maskName(owner.get(n)?.nombre) })),
      resets: prev ? (prev.resets || 0) + 1 : 0,
    };
    r.cfg = { ...r.cfg, resultado: res, estado: 'sorteada' };
    if (await commit(env, r)) {
      const full = picks.map(n => { const p = owner.get(n) || {}; return { n, nombre: p.nombre || '', cel: p.cel || '', pid: p.id || '' }; });
      return J({ ok: true, resultado: res, full });
    }
  }
  err('Intenta de nuevo', 503);
}

async function upload(req, env) {
  const mime = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\/(webp|jpeg|png|gif)$/.test(mime)) err('Formato de imagen no permitido');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 3e6) err('Imagen muy pesada (máx. 3 MB)');
  const key = await putImg(env, `p/${rid(14)}.${ext(mime)}`, buf, mime);
  return J({ ok: true, key });
}

async function crearLink(env, { rifa, nombre = '', cel = '', nums = '', nota = '' }) {
  await loadRifa(env, rifa, true);
  const code = rid(10);
  const data = {
    nombre: String(nombre).slice(0, 60),
    cel: String(cel).replace(/\D/g, '').slice(-9),
    nums: String(nums).replace(/[^\d,\s]/g, '').slice(0, 300),
    nota: String(nota).slice(0, 200),
  };
  await env.DB.prepare('INSERT INTO links (code,rifa,data,usado,creado) VALUES (?,?,?,0,?)').bind(code, rifa, JSON.stringify(data), now()).run();
  return J({ ok: true, code });
}
