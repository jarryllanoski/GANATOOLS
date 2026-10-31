'use strict';

const Impresion = (() => {
  const FORMATOS = [
    {
      id: 'a4',
      nombre: 'A4 a color',
      detalle: 'Hoja A4, 5 tickets con talón por hoja',
      papel: { ancho: 210, alto: 297, margen: 10 },
      plantilla: 'talon',
      ticketsPorPagina: 5,
      conQr: true,
    },
    {
      id: 'termica80',
      nombre: 'Ticketera 80 mm',
      detalle: 'Rollo térmico, blanco y negro',
      papel: { ancho: 80, alto: 100, margen: 4 },
      plantilla: 'rollo',
      ticketsPorPagina: 1,
      conQr: true,
    },
    {
      id: 'termica58',
      nombre: 'Ticketera 58 mm',
      detalle: 'Rollo térmico, blanco y negro',
      papel: { ancho: 58, alto: 90, margen: 3 },
      plantilla: 'rollo',
      ticketsPorPagina: 1,
      conQr: true,
    },
    {
      id: 'sticker100x50',
      nombre: 'Sticker 100 × 50 mm',
      detalle: 'Etiqueta adhesiva, blanco y negro',
      papel: { ancho: 100, alto: 50, margen: 2.5 },
      plantilla: 'etiqueta',
      ticketsPorPagina: 1,
      conQr: true,
    },
    {
      id: 'sticker50x30',
      nombre: 'Sticker 50 × 30 mm',
      detalle: 'Etiqueta pequeña, blanco y negro',
      papel: { ancho: 50, alto: 30, margen: 1.5 },
      plantilla: 'etiquetaMini',
      ticketsPorPagina: 1,
      conQr: false,
    },
  ];

  const escaparHtml = (texto) =>
    String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const formatearFecha = (ms) =>
    ms
      ? new Date(ms).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';

  const formatoPorId = (id) => FORMATOS.find((f) => f.id === id) || FORMATOS[0];

  function boletosPorNumero(participantes) {
    return participantes.flatMap((participante) =>
      participante.numeros.map((numero, indice) => ({
        numero,
        posicion: indice + 1,
        totalDelParticipante: participante.numeros.length,
        nombre: participante.nombre,
        dni: participante.dni,
        celular: participante.celular,
        codigo: participante.codigo,
        registrado: participante.registrado,
        enlace: participante.enlace,
      })),
    );
  }

  const esCarnetExtranjeria = (dni) => String(dni).startsWith('CE ');
  const tipoDocumento = (dni) => (esCarnetExtranjeria(dni) ? 'Carnet ext.' : 'DNI');
  const numeroDocumento = (dni) => (esCarnetExtranjeria(dni) ? String(dni).slice(3) : String(dni));
  const documento = (dni) => `${tipoDocumento(dni)} ${numeroDocumento(dni)}`;
  const lineaContacto = (b) => [b.dni && documento(b.dni), b.celular && `Cel ${b.celular}`].filter(Boolean).join(' · ');
  const posicion = (b) => (b.totalDelParticipante > 1 ? `Número ${b.posicion} de ${b.totalDelParticipante}` : 'Número único');
  const imagenQr = (src, clase) => (src ? `<img class="${clase}" src="${src}" alt="">` : '');

  const PLANTILLAS = {
    talon: (b, sorteo, qr) => `
      <article class="talon">
        <div class="talon-serie"><span>N° ${escaparHtml(b.codigo)}</span></div>
        <div class="talon-cuerpo">
          <header class="talon-cabecera">
            <span class="talon-marca">${escaparHtml(sorteo.negocio)}</span>
            <span class="talon-posicion">${posicion(b)}</span>
          </header>
          <h2 class="talon-titulo">${escaparHtml(sorteo.titulo)}</h2>
          <p class="talon-nombre">${escaparHtml(b.nombre)}</p>
          <p class="talon-contacto">${escaparHtml(lineaContacto(b))}</p>
          <footer class="talon-pie">
            <span>Registro ${formatearFecha(b.registrado)}</span>
            ${sorteo.precio ? `<span>${escaparHtml(sorteo.precio)}</span>` : ''}
            ${sorteo.fecha ? `<span>Sorteo ${formatearFecha(sorteo.fecha)}</span>` : ''}
          </footer>
        </div>
        <div class="talon-corte"></div>
        <div class="talon-desprendible">
          <span class="talon-numero">${escaparHtml(b.numero)}</span>
          <div class="talon-qr">${imagenQr(qr, 'qr')}<b>${escaparHtml(b.nombre.split(' ')[0])}</b></div>
        </div>
      </article>`,

    rollo: (b, sorteo, qr) => `
      <article class="rollo">
        <header class="rollo-cabecera">
          <p class="rollo-marca">${escaparHtml(sorteo.negocio)}</p>
          <p class="rollo-titulo">${escaparHtml(sorteo.titulo)}</p>
        </header>
        <p class="rollo-etiqueta">NÚMERO</p>
        <p class="rollo-numero">${escaparHtml(b.numero)}</p>
        <p class="rollo-posicion">${posicion(b)}</p>
        <dl class="rollo-datos">
          <dt>Participante</dt><dd>${escaparHtml(b.nombre)}</dd>
          ${b.dni ? `<dt>${tipoDocumento(b.dni)}</dt><dd>${escaparHtml(numeroDocumento(b.dni))}</dd>` : ''}
          ${b.celular ? `<dt>Celular</dt><dd>${escaparHtml(b.celular)}</dd>` : ''}
          ${sorteo.fecha ? `<dt>Sorteo</dt><dd>${formatearFecha(sorteo.fecha)}</dd>` : ''}
        </dl>
        <footer class="rollo-pie">
          ${imagenQr(qr, 'qr')}
          <p>Código ${escaparHtml(b.codigo)}</p>
        </footer>
      </article>`,

    etiqueta: (b, sorteo, qr) => `
      <article class="etiqueta">
        <div class="etiqueta-numero"><small>N°</small>${escaparHtml(b.numero)}</div>
        <div class="etiqueta-datos">
          <p class="etiqueta-titulo">${escaparHtml(sorteo.titulo)}</p>
          <p class="etiqueta-nombre">${escaparHtml(b.nombre)}</p>
          <p>${escaparHtml(lineaContacto(b))}</p>
          <p>${posicion(b)} · ${escaparHtml(b.codigo)}</p>
        </div>
        ${imagenQr(qr, 'qr etiqueta-qr')}
      </article>`,

    etiquetaMini: (b, sorteo) => `
      <article class="mini">
        <p class="mini-titulo">${escaparHtml(sorteo.titulo)}</p>
        <p class="mini-numero">${escaparHtml(b.numero)}</p>
        <p class="mini-nombre">${escaparHtml(b.nombre)}</p>
        <p class="mini-pie">${b.dni ? `${escaparHtml(documento(b.dni))} · ` : ''}${escaparHtml(b.codigo)}</p>
      </article>`,
  };

  const estilosBase = (papel) => `
    @page { size: ${papel.ancho}mm ${papel.alto}mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #e5e7eb; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .barra { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: center; padding: 12px; background: #111827; color: #f9fafb; font-size: 13px; }
    .barra button { padding: 10px 22px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
    .barra small { width: 100%; text-align: center; color: #9ca3af; }
    .pagina { width: ${papel.ancho}mm; height: ${papel.alto}mm; padding: ${papel.margen}mm; margin: 16px auto; background: #fff; overflow: hidden; break-after: page; box-shadow: 0 2px 10px rgba(0, 0, 0, .25); }
    .pagina:last-child { break-after: auto; }
    .qr { display: block; image-rendering: pixelated; }
    @media print {
      html, body { background: #fff; }
      .barra { display: none; }
      .pagina { margin: 0; box-shadow: none; }
    }`;

  const ESTILOS_PLANTILLA = {
    talon: `
      .pagina { display: flex; flex-direction: column; gap: 4mm; }
      .talon { position: relative; display: flex; height: 52mm; border-radius: 4mm; overflow: hidden; color: #fff; background: linear-gradient(115deg, #075b61, #0b858b 55%, #14aaae); }
      .talon-serie { flex: none; width: 13mm; display: flex; align-items: center; justify-content: center; background: #05484d; }
      .talon-serie span { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: 800; font-size: 10pt; letter-spacing: 1.5px; white-space: nowrap; }
      .talon-cuerpo { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 4mm 5mm 3.5mm; }
      .talon-cabecera { display: flex; align-items: center; justify-content: space-between; gap: 3mm; }
      .talon-marca { padding: 1.2mm 4mm; background: #e30613; transform: skewX(-14deg); box-shadow: 0 0 0 .6mm #fff; font-style: italic; font-weight: 800; font-size: 13pt; white-space: nowrap; }
      .talon-posicion { padding: 1mm 3mm; border: .35mm solid #fff; border-radius: 10mm; font-size: 7.5pt; font-weight: 800; letter-spacing: .6px; white-space: nowrap; }
      .talon-titulo { margin-top: 2.5mm; font-size: 14pt; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .talon-nombre { margin-top: 2mm; font-size: 12pt; font-weight: 700; line-height: 1.15; text-transform: uppercase; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .talon-contacto { font-size: 9pt; opacity: .9; }
      .talon-pie { margin-top: auto; display: flex; flex-wrap: wrap; gap: 1mm 4mm; padding-top: 1.5mm; border-top: .3mm dashed rgba(255, 255, 255, .6); font-size: 7.5pt; }
      .talon-corte { position: relative; flex: none; width: 0; border-left: .7mm dashed #fff; }
      .talon-corte::before, .talon-corte::after { content: ''; position: absolute; left: -3.6mm; width: 6.5mm; height: 6.5mm; border-radius: 50%; background: #fff; }
      .talon-corte::before { top: -3.3mm; }
      .talon-corte::after { bottom: -3.3mm; }
      .talon-desprendible { flex: none; width: 48mm; display: flex; align-items: center; gap: 2mm; padding: 3mm; background: repeating-linear-gradient(-50deg, #e30613 0 5mm, #c3040f 5mm 10mm); }
      .talon-numero { writing-mode: vertical-rl; font-size: 24pt; font-weight: 900; letter-spacing: 1px; }
      .talon-qr { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; padding: 2mm; border-radius: 2.5mm; background: #fff; color: #075b61; }
      .talon-qr .qr { width: 22mm; height: 22mm; }
      .talon-qr b { max-width: 100%; margin-top: 1mm; font-size: 8pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,

    rollo: `
      .rollo { height: 100%; display: flex; flex-direction: column; align-items: center; text-align: center; }
      .rollo-cabecera { width: 100%; padding-bottom: 2mm; border-bottom: .5mm dashed #000; }
      .rollo-marca { font-size: 11pt; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; }
      .rollo-titulo { margin-top: 1mm; font-size: 9pt; font-weight: 700; line-height: 1.2; }
      .rollo-etiqueta { margin-top: 2.5mm; font-size: 8pt; font-weight: 700; letter-spacing: 2px; }
      .rollo-numero { width: 100%; border: .7mm solid #000; border-radius: 2mm; font-size: var(--tamano-numero); font-weight: 900; line-height: 1.1; }
      .rollo-posicion { margin-top: 1mm; font-size: 8pt; font-weight: 700; }
      .rollo-datos { width: 100%; margin-top: 2mm; display: grid; grid-template-columns: auto 1fr; gap: .8mm 2mm; text-align: left; font-size: 8.5pt; }
      .rollo-datos dt { font-weight: 400; }
      .rollo-datos dd { font-weight: 700; text-transform: uppercase; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .rollo-pie { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 1mm; font-size: 8pt; font-weight: 700; }
      .rollo-pie .qr { width: var(--tamano-qr); height: var(--tamano-qr); }`,

    etiqueta: `
      .etiqueta { height: 100%; display: flex; align-items: center; gap: 2.5mm; }
      .etiqueta-numero { flex: none; min-width: 24mm; padding: 1.5mm 2mm; border: .7mm solid #000; border-radius: 2mm; text-align: center; font-size: 24pt; font-weight: 900; line-height: 1; }
      .etiqueta-numero small { display: block; font-size: 7pt; letter-spacing: 1px; }
      .etiqueta-datos { flex: 1; min-width: 0; font-size: 7.5pt; line-height: 1.3; }
      .etiqueta-datos p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .etiqueta-titulo { font-weight: 700; }
      .etiqueta-datos .etiqueta-nombre { font-size: 9.5pt; font-weight: 900; line-height: 1.15; text-transform: uppercase; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .etiqueta-qr { flex: none; width: 22mm; height: 22mm; }`,

    etiquetaMini: `
      .mini { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; line-height: 1.15; }
      .mini p { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mini-titulo { font-size: 6pt; font-weight: 700; }
      .mini-numero { font-size: 24pt; font-weight: 900; }
      .mini-nombre { font-size: 7pt; font-weight: 900; text-transform: uppercase; }
      .mini-pie { font-size: 6pt; }`,
  };

  const VARIABLES_POR_FORMATO = {
    termica80: '--tamano-numero: 34pt; --tamano-qr: 26mm;',
    termica58: '--tamano-numero: 26pt; --tamano-qr: 20mm;',
  };

  function paginar(boletos, porPagina) {
    const paginas = [];
    for (let i = 0; i < boletos.length; i += porPagina) paginas.push(boletos.slice(i, i + porPagina));
    return paginas;
  }

  function documentoImprimible({ formato, sorteo, boletos, generarQr }) {
    const plantilla = PLANTILLAS[formato.plantilla];
    const qrPorEnlace = new Map();
    const qrDe = (enlace) => {
      if (!formato.conQr || !enlace || !generarQr) return '';
      if (!qrPorEnlace.has(enlace)) qrPorEnlace.set(enlace, generarQr(enlace));
      return qrPorEnlace.get(enlace);
    };
    const paginas = paginar(boletos, formato.ticketsPorPagina)
      .map((grupo) => `<section class="pagina">${grupo.map((b) => plantilla(b, sorteo, qrDe(b.enlace))).join('')}</section>`)
      .join('');
    const { ancho, alto } = formato.papel;
    const cantidad = `${boletos.length} ticket${boletos.length === 1 ? '' : 's'}`;

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escaparHtml(sorteo.titulo)} · ${formato.nombre}</title>
<style>
  :root { ${VARIABLES_POR_FORMATO[formato.id] || ''} }
  ${estilosBase(formato.papel)}
  ${ESTILOS_PLANTILLA[formato.plantilla]}
</style>
</head>
<body>
  <div class="barra">
    <button type="button" onclick="print()">Imprimir</button>
    <span>${formato.nombre} · ${cantidad}</span>
    <small>Al imprimir elige papel de ${ancho} × ${alto} mm, márgenes: ninguno y escala: 100 %.</small>
  </div>
  ${paginas}
  <script>window.addEventListener('load', () => setTimeout(() => print(), 300));</script>
</body>
</html>`;
  }

  function abrirVentana() {
    const ventana = window.open('', '_blank');
    if (ventana) return ventana;
    const marco = document.createElement('iframe');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(marco);
    setTimeout(() => marco.remove(), 120000);
    return marco.contentWindow;
  }

  function imprimir({ formatoId, sorteo, participantes, generarQr }) {
    const boletos = boletosPorNumero(participantes);
    if (!boletos.length) return 0;
    const ventana = abrirVentana();
    ventana.document.open();
    ventana.document.write(documentoImprimible({ formato: formatoPorId(formatoId), sorteo, boletos, generarQr }));
    ventana.document.close();
    return boletos.length;
  }

  return { FORMATOS, imprimir, boletosPorNumero, documentoImprimible, formatoPorId };
})();
