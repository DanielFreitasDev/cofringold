/* =========================================================================
   cofringold - Simulador de Renda Fixa
   JavaScript puro (ES moderno), sem dependencias externas.

   Organizado em modulos internos dentro de uma IIFE para nao poluir o escopo
   global. Optou-se por um unico arquivo classico (sem import/export) para que
   a pagina funcione abrindo o index.html diretamente, sem servidor local.

   Camadas:
     config    -> dados dos papeis, indexadores e tabelas tributarias
     format    -> formatadores e parsers (pt-BR)
     finance   -> conversao de taxas e motor de simulacao (juros compostos)
     charts    -> renderizacao SVG da evolucao, da composicao e da comparacao
     ui         -> leitura de entradas e atualizacao do DOM
     controller -> eventos, recalculo e tema
   ========================================================================= */
(function () {
  'use strict';

  /* ----------------------------- config -------------------------------- */

  // Papeis suportados. Cada um carrega suas regras tributarias e de garantia.
  // minTerm: carencia minima de resgate em meses (regras vigentes do CMN).
  var INSTRUMENTS = {
    cdb: {
      label: 'CDB', full: 'Certificado de Depósito Bancário',
      taxable: true, fgc: true, sovereign: false,
      indexers: ['cdi', 'pre', 'ipca'], defaultIndexer: 'cdi',
      minTerm: function () { return 0; },
      desc: 'Emitido por bancos. Tributado pelo IR e coberto pelo FGC.'
    },
    lci: {
      label: 'LCI', full: 'Letra de Crédito Imobiliário',
      taxable: false, fgc: true, sovereign: false,
      indexers: ['cdi', 'pre', 'ipca'], defaultIndexer: 'cdi',
      minTerm: function (ix) { return ix === 'ipca' ? 36 : 6; },
      desc: 'Lastro em crédito imobiliário. Isenta de IR para pessoa física.'
    },
    lca: {
      label: 'LCA', full: 'Letra de Crédito do Agronegócio',
      taxable: false, fgc: true, sovereign: false,
      indexers: ['cdi', 'pre', 'ipca'], defaultIndexer: 'cdi',
      minTerm: function (ix) { return ix === 'ipca' ? 12 : 6; },
      desc: 'Lastro no agronegócio. Isenta de IR para pessoa física.'
    },
    tesouro_ipca: {
      label: 'Tesouro IPCA+', full: 'Tesouro IPCA+ (NTN-B)',
      taxable: true, fgc: false, sovereign: true,
      indexers: ['ipca'], defaultIndexer: 'ipca',
      minTerm: function () { return 0; },
      desc: 'Título público indexado à inflação. IR regressivo, sem FGC.'
    },
    pre: {
      label: 'Prefixado', full: 'Tesouro Prefixado (LTN)',
      taxable: true, fgc: false, sovereign: true,
      indexers: ['pre'], defaultIndexer: 'pre',
      minTerm: function () { return 0; },
      desc: 'Título público com taxa fixa definida na compra. IR regressivo.'
    }
  };

  // Indexadores: definem como a taxa informada vira rendimento anual.
  var INDEXERS = {
    cdi: { label: '% do CDI', rateLabel: 'Percentual do CDI', suffix: '% do CDI',
           help: 'Quanto o papel rende em relação ao CDI.', def: 110 },
    pre: { label: 'Prefixado', rateLabel: 'Taxa prefixada', suffix: '% a.a.',
           help: 'Taxa fixa contratada, válida ao ano.', def: 13 },
    ipca: { label: 'IPCA+', rateLabel: 'Taxa real (IPCA +)', suffix: '% a.a.',
            help: 'Juro real pago acima da inflação medida pelo IPCA.', def: 6 }
  };

  var DAYS_PER_MONTH = 365 / 12;
  var FGC_LIMIT = 250000;

  // IOF regressivo dos primeiros 30 dias (sobre o rendimento). Apos 30 dias: 0.
  // No horizonte deste simulador (meses inteiros) o IOF e sempre zero;
  // a tabela fica documentada para fins educativos.
  var IOF_TABLE = [0, 96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53,
    50, 46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3, 0];

  /* ----------------------------- format -------------------------------- */

  var fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var fmtNum2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function brl(v) { return fmtBRL.format(isFinite(v) ? v : 0); }

  function money2(v) { return fmtNum2.format(isFinite(v) ? v : 0); }

  // Percentual a partir de um numero ja em escala de porcentagem (ex.: 93.5).
  function pct(v, dec) {
    var d = dec == null ? 1 : dec;
    return v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  }

  // Valor compacto para os eixos do grafico.
  function compactBRL(v) {
    var abs = Math.abs(v);
    if (abs >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (abs >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mil';
    return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  // Le um campo monetario mascarado e devolve o numero (centavos / 100).
  function readMoney(el) {
    var digits = (el.value || '').replace(/\D/g, '');
    return digits === '' ? 0 : parseInt(digits, 10) / 100;
  }

  // Reaplica a mascara monetaria no campo.
  function maskMoney(el) {
    var digits = (el.value || '').replace(/\D/g, '');
    var value = digits === '' ? 0 : parseInt(digits, 10) / 100;
    el.value = money2(value);
    return value;
  }

  // Converte texto pt-BR (com virgula decimal) em numero.
  function readDecimal(el) {
    var raw = (el.value || '').trim();
    if (raw === '') return NaN;
    if (raw.indexOf(',') > -1 && raw.indexOf('.') > -1) raw = raw.replace(/\./g, '');
    raw = raw.replace(',', '.').replace(/[^\d.]/g, '');
    var n = parseFloat(raw);
    return isNaN(n) ? NaN : n;
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Contagem animada de valores (feedback de mudanca de estado).
  function animateValue(el, to, formatter) {
    if (el._raf) cancelAnimationFrame(el._raf);
    var target = isFinite(to) ? to : 0;
    if (reduceMotion) { el.textContent = formatter(target); el._cur = target; return; }
    var from = el._cur || 0;
    el._cur = target;
    var dur = 600, start = null;
    function frame(now) {
      if (start === null) start = now;
      var p = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = formatter(from + (target - from) * e);
      if (p < 1) el._raf = requestAnimationFrame(frame);
    }
    el._raf = requestAnimationFrame(frame);
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  /* ----------------------------- finance ------------------------------- */

  // Aliquota de IR pela tabela regressiva, a partir do numero de dias.
  function irRateByDays(d) {
    if (d <= 180) return 0.225;
    if (d <= 360) return 0.20;
    if (d <= 720) return 0.175;
    return 0.15;
  }
  function irRateByMonths(m) { return irRateByDays(m * DAYS_PER_MONTH); }

  // Rendimento anual efetivo (decimal) conforme o indexador.
  // cdi e ipca chegam em decimal (ex.: 0.144 e 0.045).
  function effectiveAnnual(indexer, rate, cdi, ipca) {
    if (indexer === 'cdi') return cdi * (rate / 100);
    if (indexer === 'pre') return rate / 100;
    if (indexer === 'ipca') return (1 + ipca) * (1 + rate / 100) - 1;
    return 0;
  }

  // Motor de simulacao. Trata cada deposito como um lote independente, pois o
  // IR incide no resgate sobre o rendimento de cada lote conforme o tempo que
  // ele ficou aplicado. O resultado e agnostico de isencao: o imposto e sempre
  // calculado como "se fosse tributado" e a isencao e aplicada na apresentacao.
  //
  // Convencao: aporte no fim de cada mes (annuity ordinaria), padrao das
  // calculadoras de juros compostos. O aporte do mes so rende a partir do mes
  // seguinte; o valor inicial rende desde o primeiro mes.
  function simulate(P0, PM, months, monthlyRate) {
    months = clamp(Math.round(months), 1, 480);
    var im = monthlyRate;

    // Fatores de capitalizacao acumulados: f[j] = (1 + im)^j.
    var f = new Float64Array(months + 1);
    f[0] = 1;
    for (var j = 1; j <= months; j++) f[j] = f[j - 1] * (1 + im);

    var series = new Array(months);
    for (var t = 1; t <= months; t++) {
      var invested = P0 + PM * t;
      var yieldSum = 0, taxSum = 0;

      // Lote inicial: ficou aplicado por t meses.
      var y0 = P0 * (f[t] - 1);
      yieldSum += y0;
      taxSum += y0 * irRateByMonths(t);

      // Aportes no fim do mes: o aporte do mes k fica aplicado (t - k) meses.
      for (var k = 1; k <= t; k++) {
        var held = t - k;
        if (held <= 0) continue;
        var yk = PM * (f[held] - 1);
        yieldSum += yk;
        taxSum += yk * irRateByMonths(held);
      }

      series[t - 1] = {
        month: t,
        invested: invested,
        gross: invested + yieldSum,
        grossYield: yieldSum,
        taxIfTaxed: taxSum
      };
    }

    var last = series[months - 1];
    return {
      months: months,
      series: series,
      invested: last.invested,
      gross: last.gross,
      grossYield: last.grossYield,
      taxIfTaxed: last.taxIfTaxed
    };
  }

  /* ----------------------------- charts -------------------------------- */

  var SVGNS = 'http://www.w3.org/2000/svg';

  // Grafico de area da evolucao do patrimonio. Renderiza SVG em coordenadas de
  // pixel (viewBox = tamanho real) e reage ao ponteiro para exibir o tooltip.
  // Grafico de area reutilizavel. O modelo define duas series (lower e upper);
  // a banda entre elas recebe a cor de "juros"/"saldo" e a area abaixo de lower
  // recebe a cor de "investido" (omitida quando model.hideLower e verdadeiro).
  // model: { months, lower:[], upper:[], hideLower, title, rows(i) -> [{cls,label,value,total}] }
  function createAreaChart(container, tooltip, titleEl) {
    var geo = null;       // geometria do ultimo render, usada no hover
    var model = null;     // ultimo modelo de dados
    var hoverLine, hoverDotTotal, hoverDotPrincipal;
    var svg = container.querySelector('.chart__svg');

    function line(points) {
      var d = '';
      for (var i = 0; i < points.length; i++) {
        d += (i === 0 ? 'M' : 'L') + points[i][0].toFixed(2) + ' ' + points[i][1].toFixed(2) + ' ';
      }
      return d;
    }

    function niceMax(v) {
      if (v <= 0) return 1;
      var mag = Math.pow(10, Math.floor(Math.log10(v)));
      var nrm = v / mag;
      var step = nrm <= 1 ? 1 : nrm <= 2 ? 2 : nrm <= 2.5 ? 2.5 : nrm <= 5 ? 5 : 10;
      return step * mag;
    }

    function render() {
      if (!model) return;
      var w = container.clientWidth || 600;
      var h = container.clientHeight || 260;
      var pad = { top: 16, right: 14, bottom: 26, left: 58 };
      var plotW = Math.max(10, w - pad.left - pad.right);
      var plotH = Math.max(10, h - pad.top - pad.bottom);
      var n = model.months;
      var lower = model.lower, upper = model.upper;

      var peak = 1;
      for (var mi = 0; mi < n; mi++) if (upper[mi] > peak) peak = upper[mi];
      var maxVal = niceMax(peak);
      var baseY = pad.top + plotH;

      function xAt(i) { return pad.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW); }
      function yAt(v) { return pad.top + plotH - (v / maxVal) * plotH; }

      var topPts = [], lowPts = [];
      for (var i = 0; i < n; i++) {
        topPts.push([xAt(i), yAt(upper[i])]);
        lowPts.push([xAt(i), yAt(lower[i])]);
      }

      // Banda entre lower e upper.
      var band = line(topPts);
      for (var b = n - 1; b >= 0; b--) band += 'L' + lowPts[b][0].toFixed(2) + ' ' + lowPts[b][1].toFixed(2) + ' ';
      band += 'Z';

      // Area abaixo de lower (valor investido), apenas quando ha base.
      var lowerArea = line(lowPts) +
        'L' + lowPts[n - 1][0].toFixed(2) + ' ' + baseY.toFixed(2) +
        ' L' + lowPts[0][0].toFixed(2) + ' ' + baseY.toFixed(2) + ' Z';

      // Linhas de grade horizontais com rotulos de valor.
      var grid = '', steps = 4;
      for (var g = 0; g <= steps; g++) {
        var val = maxVal * g / steps;
        var gy = yAt(val);
        grid += '<line class="chart-grid-line" x1="' + pad.left + '" y1="' + gy.toFixed(1) +
                '" x2="' + (w - pad.right) + '" y2="' + gy.toFixed(1) + '"></line>';
        grid += '<text class="chart-ylabel" x="' + (pad.left - 8) + '" y="' + (gy + 4).toFixed(1) +
                '" text-anchor="end">' + compactBRL(val) + '</text>';
      }

      // Eixo X: meses (periodos curtos) ou anos.
      var xticks = '';
      if (n < 24) {
        var stepM = Math.max(1, Math.ceil(n / 6));
        for (var mm = 1; mm <= n; mm += stepM) {
          xticks += '<text class="chart-ylabel" x="' + xAt(mm - 1).toFixed(1) + '" y="' + (h - 6) +
                    '" text-anchor="middle">' + mm + '</text>';
        }
        xticks += '<text class="chart-ylabel" x="' + (w - pad.right) + '" y="' + (h - 6) + '" text-anchor="end" opacity="0.7">meses</text>';
      } else {
        var years = Math.round(n / 12);
        var stepY = Math.max(1, Math.ceil(years / 6));
        for (var yy = 0; yy <= years; yy += stepY) {
          var idx = yy === 0 ? 0 : yy * 12 - 1;
          if (idx > n - 1) idx = n - 1;
          xticks += '<text class="chart-ylabel" x="' + xAt(idx).toFixed(1) + '" y="' + (h - 6) +
                    '" text-anchor="middle">' + yy + '</text>';
        }
        xticks += '<text class="chart-ylabel" x="' + (w - pad.right) + '" y="' + (h - 6) + '" text-anchor="end" opacity="0.7">anos</text>';
      }

      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.innerHTML =
        grid +
        (model.hideLower ? '' : '<path class="area-principal" d="' + lowerArea + '"></path>') +
        '<path class="area-yield" d="' + band + '"></path>' +
        (model.hideLower ? '' : '<path class="line-principal" d="' + line(lowPts) + '"></path>') +
        '<path class="line-total" d="' + line(topPts) + '"></path>' +
        xticks +
        '<g class="hover-layer" hidden>' +
          '<line class="chart-cursor" y1="' + pad.top + '" y2="' + baseY + '"></line>' +
          '<circle class="chart-dot chart-dot--principal" r="4"' + (model.hideLower ? ' hidden' : '') + '></circle>' +
          '<circle class="chart-dot chart-dot--total" r="4.5"></circle>' +
        '</g>';

      var hl = svg.querySelector('.hover-layer');
      hoverLine = hl.querySelector('.chart-cursor');
      hoverDotPrincipal = hl.querySelector('.chart-dot--principal');
      hoverDotTotal = hl.querySelector('.chart-dot--total');

      geo = { pad: pad, plotW: plotW, n: n, xAt: xAt, yAt: yAt, lower: lower, upper: upper, hl: hl };

      // Anima o desenho da linha do topo (revela o crescimento).
      if (!reduceMotion) {
        var ln = svg.querySelector('.line-total');
        var len = ln.getTotalLength();
        ln.style.transition = 'none';
        ln.style.strokeDasharray = len;
        ln.style.strokeDashoffset = len;
        void ln.getBoundingClientRect();
        ln.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1)';
        ln.style.strokeDashoffset = '0';
      }

      if (titleEl) titleEl.textContent = model.title || '';
    }

    function showHoverAt(clientX) {
      if (!geo) return;
      var rect = container.getBoundingClientRect();
      var rel = (clientX - rect.left - geo.pad.left) / geo.plotW;
      var i = clamp(Math.round(rel * (geo.n - 1)), 0, geo.n - 1);
      var x = geo.xAt(i);

      geo.hl.removeAttribute('hidden');
      hoverLine.setAttribute('x1', x); hoverLine.setAttribute('x2', x);
      if (!model.hideLower) { hoverDotPrincipal.setAttribute('cx', x); hoverDotPrincipal.setAttribute('cy', geo.yAt(geo.lower[i])); }
      hoverDotTotal.setAttribute('cx', x); hoverDotTotal.setAttribute('cy', geo.yAt(geo.upper[i]));

      var t = i + 1;
      var yr = Math.floor((t - 1) / 12) + 1;
      var mo = ((t - 1) % 12) + 1;
      var rowsHtml = model.rows(i).map(function (r) {
        var dot = r.cls ? '<span class="dot dot--' + r.cls + '"></span>' : '';
        var rowCls = r.total ? 'tooltip__row tooltip__row--total' : 'tooltip__row';
        return '<div class="' + rowCls + '"><span>' + dot + r.label + '</span><span>' + brl(r.value) + '</span></div>';
      }).join('');
      tooltip.innerHTML = '<div class="tooltip__title">Mês ' + t + ' (ano ' + yr + ', mês ' + mo + ')</div>' + rowsHtml;

      tooltip.hidden = false;
      var tw = tooltip.offsetWidth;
      tooltip.style.left = clamp(x, tw / 2 + 4, rect.width - tw / 2 - 4) + 'px';
      tooltip.style.top = geo.yAt(geo.upper[i]) + 'px';
    }

    function hideHover() {
      tooltip.hidden = true;
      if (geo && geo.hl) geo.hl.setAttribute('hidden', '');
    }

    container.addEventListener('pointermove', function (e) { showHoverAt(e.clientX); });
    container.addEventListener('pointerleave', hideHover);

    // Reposiciona ao redimensionar (inclui quando a aba passa a ser visivel).
    var ro = new ResizeObserver(debounce(function () { render(); }, 120));
    ro.observe(container);

    return { update: function (m) { model = m; render(); } };
  }

  /* ----------------------------- ui ------------------------------------ */

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    form: $('simulator-form'),
    instrumentGroup: $('instrument-group'),
    instrumentHelp: $('instrument-help'),
    indexerGroup: $('indexer-group'),
    rateInput: $('rate-input'),
    rateLabel: $('rate-label'),
    rateSuffix: $('rate-suffix'),
    rateHelp: $('rate-help'),
    initial: $('initial-input'),
    monthly: $('monthly-input'),
    yearsRange: $('years-range'),
    yearsInput: $('years-input'),
    termHelp: $('term-help'),
    cdi: $('cdi-input'),
    ipca: $('ipca-input'),
    modeGroup: $('mode-group'),

    mNetTotal: $('m-net-total'),
    mInvested: $('m-invested'),
    mNetYield: $('m-net-yield'),
    mNetRate: $('m-net-rate'),
    mNetYieldFoot: $('m-net-yield-foot'),

    ledInvested: $('led-invested'),
    ledGrossYield: $('led-gross-yield'),
    ledIr: $('led-ir'),
    ledIof: $('led-iof'),
    ledNet: $('led-net'),

    donutCenter: $('donut-center'),
    donutTitle: $('donut-title'),
    segPrincipal: $('seg-principal'),
    segYield: $('seg-yield'),
    segTax: $('seg-tax'),

    rules: $('rules'),
    bars: $('bars'),
    insightText: $('insight-text'),
    yearTableBody: $('year-table-body'),
    areaCaption: $('area-caption'),
    live: $('live-summary')
  };

  var areaChart = createAreaChart($('area-chart'), $('area-tooltip'), $('area-svg-title'));

  // Estado das selecoes que nao sao campos de texto.
  var state = { instrument: 'cdb', indexer: 'cdi', mode: 'net' };

  function selectedRadio(name) {
    var r = el.form.querySelector('input[name="' + name + '"]:checked') ||
            document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : null;
  }

  // (Re)constroi os botoes de indexador conforme o papel selecionado.
  function buildIndexers(inst, keepCurrent) {
    var available = inst.indexers;
    var chosen = keepCurrent && available.indexOf(state.indexer) > -1 ? state.indexer : inst.defaultIndexer;
    state.indexer = chosen;

    el.indexerGroup.innerHTML = available.map(function (key) {
      var meta = INDEXERS[key];
      var checked = key === chosen ? ' checked' : '';
      return '<label class="segment">' +
               '<input type="radio" name="indexer" value="' + key + '"' + checked + '>' +
               '<span class="segment__face">' + meta.label + '</span>' +
             '</label>';
    }).join('');

    // Bloqueia o grupo quando ha apenas um indexador possivel.
    el.indexerGroup.style.opacity = available.length === 1 ? '0.7' : '1';
  }

  function applyIndexerLabels() {
    var meta = INDEXERS[state.indexer];
    el.rateLabel.textContent = meta.rateLabel;
    el.rateSuffix.textContent = meta.suffix;
    el.rateHelp.textContent = meta.help;
  }

  function updateRangeFill() {
    var min = +el.yearsRange.min, max = +el.yearsRange.max, val = +el.yearsRange.value;
    var fill = ((val - min) / (max - min)) * 100;
    el.yearsRange.style.setProperty('--range-fill', fill + '%');
  }

  // Monta a lista de regras (tributacao, IOF, garantia e carencia).
  function renderRules(inst, irHorizon, termMonths) {
    var items = [];

    if (inst.taxable) {
      items.push(rule('no', 'Tributado pelo Imposto de Renda',
        'Tabela regressiva. Neste prazo a alíquota é ' + pct(irHorizon * 100, 1) + ' sobre o rendimento.'));
    } else {
      items.push(rule('yes', 'Isento de Imposto de Renda',
        'Para pessoa física, todo o rendimento é livre de IR.'));
    }

    items.push(rule('yes', 'Sem IOF neste prazo',
      'O IOF só incide em resgates feitos antes de 30 dias.'));

    if (inst.fgc) {
      items.push(rule('yes', 'Cobertura do FGC',
        'Garantido até ' + brl(FGC_LIMIT) + ' por CPF e por instituição.'));
    } else {
      items.push(rule('info', 'Sem cobertura do FGC',
        'Risco soberano: a garantia é o próprio Tesouro Nacional.'));
    }

    var min = inst.minTerm(state.indexer);
    if (min > 0) {
      var ok = termMonths >= min;
      items.push(rule(ok ? 'yes' : 'no', 'Carência de ' + min + ' meses',
        'Prazo mínimo para resgate' + (ok ? '.' : '. O período atual é menor que a carência.')));
    } else {
      items.push(rule('info', 'Liquidez conforme o emissor',
        inst.sovereign ? 'Tesouro Direto recompra diariamente, com marcação a mercado.'
                       : 'A liquidez depende das condições do emissor.'));
    }

    el.rules.innerHTML = items.join('');

    function rule(kind, title, detail) {
      var glyph = kind === 'yes' ? '+' : kind === 'no' ? '!' : 'i';
      return '<li class="rule">' +
               '<span class="rule__icon rule__icon--' + kind + '" aria-hidden="true">' + glyph + '</span>' +
               '<span><strong>' + title + '</strong><br><span>' + detail + '</span></span>' +
             '</li>';
    }
  }

  // Atualiza o grafico de rosca da composicao no resgate.
  function renderDonut(invested, netYield, tax, net, gross) {
    var C = 2 * Math.PI * 48;
    function seg(elm, value, before) {
      var len = gross > 0 ? (value / gross) * C : 0;
      elm.style.strokeDasharray = len.toFixed(2) + ' ' + (C - len).toFixed(2);
      elm.style.strokeDashoffset = (-before).toFixed(2);
      return before + len;
    }
    var acc = 0;
    acc = seg(el.segPrincipal, invested, acc);
    acc = seg(el.segYield, netYield, acc);
    seg(el.segTax, tax, acc);
    animateValue(el.donutCenter, net, function (v) { return compactBRL(v); });
    el.donutTitle.textContent = 'Composição do valor bruto: investido ' + brl(invested) +
      ', juros líquido ' + brl(netYield) + ', imposto ' + brl(tax) + '.';
  }

  // Barras comparativas: mesmo rendimento bruto, imposto diferente por papel.
  function renderBars(exemptNet, taxedNet) {
    var rows = Object.keys(INSTRUMENTS).map(function (key) {
      var inst = INSTRUMENTS[key];
      return {
        key: key, label: inst.label, exempt: !inst.taxable,
        net: inst.taxable ? taxedNet : exemptNet,
        current: key === state.instrument
      };
    });
    rows.sort(function (a, b) { return b.net - a.net; });
    var max = rows[0].net || 1;

    el.bars.innerHTML = rows.map(function (r) {
      var w = clamp((r.net / max) * 100, 2, 100);
      var tag = r.exempt
        ? '<span class="bar__tag bar__tag--exempt">isento</span>'
        : '<span class="bar__tag bar__tag--taxed">tributado</span>';
      return '<div class="bar' + (r.exempt ? ' bar--exempt' : '') + (r.current ? ' bar--current' : '') + '">' +
               '<div class="bar__head">' +
                 '<span class="bar__name">' + r.label + ' ' + tag + '</span>' +
                 '<span class="bar__value">' + brl(r.net) + '</span>' +
               '</div>' +
               '<div class="bar__track"><span class="bar__fill" style="width:' + w.toFixed(1) + '%"></span></div>' +
             '</div>';
    }).join('');
  }

  // Texto de equivalencia entre tributado e isento (regra da taxa equivalente).
  function renderInsight(inst, indexer, rate, annual, irHorizon) {
    var factor = 1 - irHorizon;
    var html;
    if (inst.taxable) {
      if (indexer === 'cdi') {
        html = 'Depois do IR, este <strong>' + inst.label + '</strong> rende como uma LCI ou LCA isenta de cerca de <strong>' +
          pct(rate * factor, 1) + ' do CDI</strong>. Uma isenta acima disso rende mais.';
      } else {
        html = 'Depois do IR, este <strong>' + inst.label + '</strong> equivale a um título isento de cerca de <strong>' +
          pct(annual * 100 * factor, 2) + ' a.a.</strong>';
      }
    } else {
      if (indexer === 'cdi') {
        html = 'Por ser isento de IR, este <strong>' + inst.label + '</strong> rende como um CDB de cerca de <strong>' +
          pct(rate / factor, 1) + ' do CDI</strong>, já descontado o imposto.';
      } else {
        html = 'Por ser isento de IR, este <strong>' + inst.label + '</strong> rende como um título tributado de cerca de <strong>' +
          pct(annual * 100 / factor, 2) + ' a.a.</strong> antes do imposto.';
      }
    }
    el.insightText.innerHTML = html;
  }

  function renderTable(sim, taxable, P0, PM, years) {
    var rows = '';
    for (var y = 1; y <= years; y++) {
      var p = sim.series[y * 12 - 1];
      if (!p) break;
      var prevGY = y === 1 ? 0 : sim.series[(y - 1) * 12 - 1].grossYield;
      var jurosAno = p.grossYield - prevGY;
      var net = taxable ? p.gross - p.taxIfTaxed : p.gross;
      rows += '<tr>' +
                '<td>' + y + '</td>' +
                '<td>' + brl(p.invested) + '</td>' +
                '<td>' + brl(jurosAno) + '</td>' +
                '<td>' + brl(p.gross) + '</td>' +
                '<td class="td-net">' + brl(net) + '</td>' +
              '</tr>';
    }
    el.yearTableBody.innerHTML = rows;
  }

  /* --------------------------- controller ------------------------------ */

  function recalc() {
    var inst = INSTRUMENTS[state.instrument];

    // Periodo (clamp 1..40 anos).
    var years = clamp(Math.round(+el.yearsInput.value || 1), 1, 40);
    var months = years * 12;

    // Entradas numericas com validacao basica.
    var P0 = readMoney(el.initial);
    var PM = readMoney(el.monthly);

    var rate = readDecimal(el.rateInput);
    setInvalid(el.rateInput, isNaN(rate));
    if (isNaN(rate)) rate = 0;
    rate = Math.max(0, rate);

    var cdi = readDecimal(el.cdi);
    setInvalid(el.cdi, isNaN(cdi));
    if (isNaN(cdi)) cdi = 0;

    var ipca = readDecimal(el.ipca);
    setInvalid(el.ipca, isNaN(ipca));
    if (isNaN(ipca)) ipca = 0;

    var annual = effectiveAnnual(state.indexer, rate, cdi / 100, ipca / 100);
    annual = Math.max(-0.99, annual);
    var im = Math.pow(1 + annual, 1 / 12) - 1;

    var sim = simulate(P0, PM, months, im);

    var taxable = inst.taxable;
    var ir = taxable ? sim.taxIfTaxed : 0;
    var iof = 0;
    var net = sim.gross - ir - iof;
    var netYield = net - sim.invested;
    var irHorizon = irRateByMonths(months);

    // Metricas principais (com contagem animada).
    animateValue(el.mNetTotal, net, brl);
    animateValue(el.mInvested, sim.invested, brl);
    animateValue(el.mNetYield, netYield, brl);

    var rentLiq = sim.invested > 0 ? (netYield / sim.invested) * 100 : 0;
    el.mNetYieldFoot.textContent = 'equivale a ' + pct(rentLiq, 1) + ' sobre o investido';
    el.mNetRate.textContent = taxable ? 'após IR de ' + brl(ir) : 'isento de imposto';

    // Razao do resgate.
    el.ledInvested.textContent = brl(sim.invested);
    el.ledGrossYield.textContent = brl(sim.grossYield);
    el.ledIr.textContent = taxable ? brl(ir) : 'isento';
    el.ledIof.textContent = brl(iof);
    el.ledNet.textContent = brl(net);

    renderDonut(sim.invested, netYield, ir, net, sim.gross);
    renderRules(inst, irHorizon, months);

    var exemptNet = sim.gross;
    var taxedNet = sim.gross - sim.taxIfTaxed;
    renderBars(exemptNet, taxedNet);
    renderInsight(inst, state.indexer, rate, annual, irHorizon);
    renderTable(sim, taxable, P0, PM, years);

    // Serie para o grafico conforme o modo (liquido ou bruto).
    var invArr = new Array(months), topArr = new Array(months);
    for (var i = 0; i < months; i++) {
      var p = sim.series[i];
      invArr[i] = p.invested;
      topArr[i] = state.mode === 'gross' ? p.gross : (taxable ? p.gross - p.taxIfTaxed : p.gross);
    }
    var modeLabel = state.mode === 'gross' ? 'Total bruto' : 'Total líquido';
    el.areaCaption.textContent = 'Aportes e juros acumulados mês a mês, em valores ' +
      (state.mode === 'gross' ? 'brutos.' : 'líquidos.');
    areaChart.update({
      months: months, lower: invArr, upper: topArr, hideLower: false,
      title: 'Evolução do patrimônio em ' + years + ' anos. Valor final de ' + brl(topArr[months - 1]) + '.',
      rows: function (i) {
        return [
          { cls: 'principal', label: 'Investido', value: invArr[i] },
          { cls: 'yield', label: 'Juros', value: topArr[i] - invArr[i] },
          { label: modeLabel, value: topArr[i], total: true }
        ];
      }
    });

    // Carencia: avisa quando o prazo e menor que o minimo do papel.
    var minTerm = inst.minTerm(state.indexer);
    if (minTerm > 0 && months < minTerm) {
      el.termHelp.textContent = inst.label + ' ' + INDEXERS[state.indexer].label +
        ' exige carência mínima de ' + minTerm + ' meses (' + (minTerm / 12).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' anos).';
      el.termHelp.classList.add('field__help--warn');
    } else {
      el.termHelp.textContent = 'Aportes mensais aplicados do início ao fim do período.';
      el.termHelp.classList.remove('field__help--warn');
    }

    el.instrumentHelp.textContent = inst.full + '. ' + inst.desc;

    // Resumo acessivel.
    el.live.textContent = 'Simulação ' + inst.label + ' ' + INDEXERS[state.indexer].label +
      '. Em ' + years + ' anos: total líquido ' + brl(net) + ', investido ' + brl(sim.invested) +
      ', juros líquido ' + brl(netYield) + '.';
  }

  function setInvalid(input, invalid) {
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  var recalcDebounced = debounce(recalc, 120);

  /* ----------------------------- eventos ------------------------------- */

  function bindEvents() {
    // Tipo de investimento.
    el.instrumentGroup.addEventListener('change', function (e) {
      if (e.target.name !== 'instrument') return;
      state.instrument = e.target.value;
      var inst = INSTRUMENTS[state.instrument];
      buildIndexers(inst, true);
      applyIndexerLabels();
      // Ajusta a taxa ao padrao do indexador atual.
      el.rateInput.value = String(INDEXERS[state.indexer].def).replace('.', ',');
      recalc();
    });

    // Indexador (delegado, pois os botoes sao recriados).
    el.indexerGroup.addEventListener('change', function (e) {
      if (e.target.name !== 'indexer') return;
      state.indexer = e.target.value;
      applyIndexerLabels();
      el.rateInput.value = String(INDEXERS[state.indexer].def).replace('.', ',');
      recalc();
    });

    // Modo do grafico.
    el.modeGroup.addEventListener('change', function (e) {
      if (e.target.name !== 'mode') return;
      state.mode = e.target.value;
      recalc();
    });

    // Campos monetarios: mascara ao digitar.
    [el.initial, el.monthly].forEach(function (input) {
      input.addEventListener('input', function () { maskMoney(input); recalcDebounced(); });
      input.addEventListener('blur', function () { maskMoney(input); });
    });

    // Campos decimais.
    [el.rateInput, el.cdi, el.ipca].forEach(function (input) {
      input.addEventListener('input', recalcDebounced);
    });

    // Periodo: sincroniza range e numero.
    el.yearsRange.addEventListener('input', function () {
      el.yearsInput.value = el.yearsRange.value;
      updateRangeFill();
      recalcDebounced();
    });
    el.yearsInput.addEventListener('input', function () {
      var v = clamp(Math.round(+el.yearsInput.value || 1), 1, 40);
      el.yearsRange.value = v;
      updateRangeFill();
      recalcDebounced();
    });
    el.yearsInput.addEventListener('blur', function () {
      el.yearsInput.value = clamp(Math.round(+el.yearsInput.value || 1), 1, 40);
      updateRangeFill();
    });

    // Tema.
    $('theme-toggle').addEventListener('click', toggleTheme);
  }

  /* ----------------------------- tema ---------------------------------- */

  var THEME_KEY = 'capitaliza-theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var label = $('theme-toggle-label');
    if (label) label.textContent = theme === 'dark' ? 'Claro' : 'Escuro';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0c10' : '#f5f7f6');
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* armazenamento indisponivel */ }
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* ignora */ }
    if (saved === 'dark' || saved === 'light') {
      applyTheme(saved);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      applyTheme('light');
    } else {
      applyTheme('dark');
    }
  }

  /* ----------------------- juros compostos / simples ------------------- */

  // Taxa mensal a partir da taxa informada. Para juros simples com taxa anual
  // usa-se a taxa proporcional (anual / 12); para compostos, a taxa equivalente.
  function monthlyRateOf(ratePct, unit, type) {
    var r = ratePct / 100;
    if (unit === 'mensal') return r;
    return type === 'simples' ? r / 12 : Math.pow(1 + r, 1 / 12) - 1;
  }

  function simulateInterest(P0, PM, months, im, type, flow) {
    months = clamp(Math.round(months), 1, 600);
    var series = [], depletedAt = null, t;

    if (flow === 'aporte') {
      if (type === 'simples') {
        // Juros simples, aporte no fim do mes: cada deposito rende sobre o
        // proprio principal pelos meses que ficou aplicado.
        for (t = 1; t <= months; t++) {
          var inv = P0 + PM * t;
          var jur = im * (P0 * t + PM * t * (t - 1) / 2);
          series.push({ month: t, invested: inv, withdrawn: 0, balance: inv + jur, interest: jur });
        }
      } else {
        // Juros compostos, aporte no fim do mes (annuity ordinaria).
        var bal = P0, acc = P0;
        for (t = 1; t <= months; t++) {
          bal = bal * (1 + im) + PM;
          acc += PM;
          series.push({ month: t, invested: acc, withdrawn: 0, balance: bal, interest: bal - acc });
        }
      }
    } else {
      // Retiradas mensais a partir do valor inicial.
      var saldo = P0, taken = 0, juros = 0;
      for (t = 1; t <= months; t++) {
        var ganho = type === 'simples' ? P0 * im : saldo * im;
        var grown = saldo + ganho;
        juros += ganho;
        if (grown - PM <= 0) {
          taken += grown; // ultima retirada parcial
          series.push({ month: t, invested: P0, withdrawn: taken, balance: 0, interest: juros });
          depletedAt = t;
          break;
        }
        saldo = grown - PM;
        taken += PM;
        series.push({ month: t, invested: P0, withdrawn: taken, balance: saldo, interest: juros });
      }
    }

    var last = series[series.length - 1];
    return {
      months: series.length, series: series, depletedAt: depletedAt,
      balance: last.balance, invested: last.invested, withdrawn: last.withdrawn, interest: last.interest
    };
  }

  function describePeriod(months) {
    if (months < 12) return months + (months === 1 ? ' mês' : ' meses');
    var y = Math.floor(months / 12), m = months % 12;
    var txt = y + (y === 1 ? ' ano' : ' anos');
    if (m > 0) txt += ' e ' + m + (m === 1 ? ' mês' : ' meses');
    return txt;
  }

  function setupJuros() {
    var J = {
      form: $('juros-form'),
      monthlyLabel: $('ji-monthly-label'),
      initial: $('ji-initial'), monthly: $('ji-monthly'),
      rate: $('ji-rate'), rateUnit: $('ji-rate-unit'),
      period: $('ji-period'), periodUnit: $('ji-period-unit'),
      clear: $('ji-clear'),
      m1: $('ji-m1'), m1l: $('ji-m1-label'), m1f: $('ji-m1-foot'),
      m2: $('ji-m2'), m2l: $('ji-m2-label'), m2f: $('ji-m2-foot'),
      m3: $('ji-m3'), m3l: $('ji-m3-label'), m3f: $('ji-m3-foot'),
      chartSub: $('ji-chart-sub'), legend: $('ji-legend'),
      note: $('ji-note'), thead: $('ji-thead'), tbody: $('ji-tbody')
    };
    var chart = createAreaChart($('juros-chart'), $('juros-tooltip'), $('juros-svg-title'));
    var DEFAULTS = { initial: '1.000,00', monthly: '100,00', rate: '14,79' };

    function radio(name) { var r = J.form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : null; }
    function legendItem(cls, label) {
      return '<span class="legend__item"><span class="legend__swatch legend__swatch--' + cls + '"></span>' + label + '</span>';
    }

    function renderTable(sim, flow) {
      var head, body = '', i, p, prev;
      if (flow === 'aporte') {
        head = '<tr><th scope="col">Mês</th><th scope="col">Juros no mês</th><th scope="col">Total investido</th><th scope="col">Juros acumulado</th><th scope="col">Total acumulado</th></tr>';
        for (i = 0; i < sim.series.length; i++) {
          p = sim.series[i]; prev = i > 0 ? sim.series[i - 1].interest : 0;
          body += '<tr><td>' + p.month + '</td><td>' + brl(p.interest - prev) + '</td><td>' + brl(p.invested) +
                  '</td><td>' + brl(p.interest) + '</td><td class="td-net">' + brl(p.balance) + '</td></tr>';
        }
      } else {
        head = '<tr><th scope="col">Mês</th><th scope="col">Juros no mês</th><th scope="col">Total retirado</th><th scope="col">Saldo</th></tr>';
        for (i = 0; i < sim.series.length; i++) {
          p = sim.series[i]; prev = i > 0 ? sim.series[i - 1].interest : 0;
          body += '<tr><td>' + p.month + '</td><td>' + brl(p.interest - prev) + '</td><td>' + brl(p.withdrawn) +
                  '</td><td class="td-net">' + brl(p.balance) + '</td></tr>';
        }
      }
      J.thead.innerHTML = head;
      J.tbody.innerHTML = body;
    }

    function recalc() {
      var type = radio('ji-type') || 'compostos';
      var flow = radio('ji-flow') || 'aporte';
      var P0 = readMoney(J.initial);
      var PM = readMoney(J.monthly);
      var rate = readDecimal(J.rate); setInvalid(J.rate, isNaN(rate)); if (isNaN(rate)) rate = 0; rate = Math.max(0, rate);

      var maxUnit = J.periodUnit.value === 'anos' ? 50 : 600;
      var periodVal = clamp(Math.round(+J.period.value || 1), 1, maxUnit);
      var months = clamp(J.periodUnit.value === 'anos' ? periodVal * 12 : periodVal, 1, 600);

      var im = monthlyRateOf(rate, J.rateUnit.value, type);
      var sim = simulateInterest(P0, PM, months, im, type, flow);
      var n = sim.months;

      if (flow === 'aporte') {
        J.monthlyLabel.textContent = 'Valor mensal';
        J.m1l.textContent = 'Valor total final';
        J.m2l.textContent = 'Total investido';
        J.m3l.textContent = 'Total em juros';
        animateValue(J.m1, sim.balance, brl);
        animateValue(J.m2, sim.invested, brl);
        animateValue(J.m3, sim.interest, brl);
        J.m1f.textContent = 'em ' + describePeriod(months) + ', juros ' + type;
        J.m2f.textContent = PM > 0 ? 'aporte de ' + brl(PM) + ' por mês' : 'somente o valor inicial';
        J.m3f.textContent = sim.invested > 0 ? pct(sim.interest / sim.invested * 100, 1) + ' sobre o investido' : '';
        J.note.hidden = true;

        var inv = new Array(n), bal = new Array(n);
        for (var i = 0; i < n; i++) { inv[i] = sim.series[i].invested; bal[i] = sim.series[i].balance; }
        J.legend.innerHTML = legendItem('principal', 'Valor investido') + legendItem('yield', 'Juros');
        J.chartSub.textContent = 'Aportes e juros acumulados mês a mês.';
        chart.update({
          months: n, lower: inv, upper: bal, hideLower: false,
          title: 'Evolução do montante. Valor final de ' + brl(sim.balance) + '.',
          rows: function (k) {
            return [
              { cls: 'principal', label: 'Investido', value: sim.series[k].invested },
              { cls: 'yield', label: 'Juros', value: sim.series[k].interest },
              { label: 'Total', value: sim.series[k].balance, total: true }
            ];
          }
        });
      } else {
        J.monthlyLabel.textContent = 'Valor da retirada';
        J.m1l.textContent = 'Saldo final';
        J.m2l.textContent = 'Total retirado';
        J.m3l.textContent = 'Total em juros';
        animateValue(J.m1, sim.balance, brl);
        animateValue(J.m2, sim.withdrawn, brl);
        animateValue(J.m3, sim.interest, brl);
        J.m1f.textContent = sim.depletedAt ? 'saldo esgotado antes do fim' : 'após ' + describePeriod(n);
        J.m2f.textContent = 'retirada de ' + brl(PM) + ' por mês';
        J.m3f.textContent = 'rendimento sobre o saldo';

        if (sim.depletedAt) {
          J.note.hidden = false; J.note.className = 'note note--warn';
          J.note.innerHTML = 'O saldo se esgota no <strong>mês ' + sim.depletedAt + '</strong> (' + describePeriod(sim.depletedAt) + '), antes do fim do período informado.';
        } else if (sim.balance > P0) {
          J.note.hidden = false; J.note.className = 'note';
          J.note.innerHTML = 'As retiradas consomem só parte dos juros: o saldo ainda <strong>cresce</strong> ao longo do tempo.';
        } else {
          J.note.hidden = false; J.note.className = 'note';
          J.note.innerHTML = 'O saldo se mantém positivo durante todo o período informado.';
        }

        var zeros = new Array(n), sal = new Array(n);
        for (var z = 0; z < n; z++) { zeros[z] = 0; sal[z] = sim.series[z].balance; }
        J.legend.innerHTML = legendItem('yield', 'Saldo') + legendItem('principal', 'Total retirado');
        J.chartSub.textContent = 'Saldo restante a cada mês de retirada.';
        chart.update({
          months: n, lower: zeros, upper: sal, hideLower: true,
          title: 'Evolução do saldo com retiradas. Saldo final de ' + brl(sim.balance) + '.',
          rows: function (k) {
            return [
              { cls: 'yield', label: 'Saldo', value: sim.series[k].balance, total: true },
              { cls: 'principal', label: 'Total retirado', value: sim.series[k].withdrawn },
              { label: 'Juros acumulado', value: sim.series[k].interest }
            ];
          }
        });
      }

      renderTable(sim, flow);

      el.live.textContent = 'Juros ' + type + ', ' + flow + '. ' + (flow === 'aporte'
        ? 'Valor final ' + brl(sim.balance) + ', investido ' + brl(sim.invested) + ', juros ' + brl(sim.interest) + '.'
        : 'Saldo final ' + brl(sim.balance) + ', total retirado ' + brl(sim.withdrawn) + '.');
    }

    var recalcD = debounce(recalc, 120);

    J.form.addEventListener('submit', function (e) {
      e.preventDefault();
      recalc();
      if (window.matchMedia('(max-width: 980px)').matches) {
        var res = J.form.parentElement.querySelector('.results');
        if (res) res.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
    });
    $('ji-type').addEventListener('change', recalc);
    $('ji-flow').addEventListener('change', recalc);
    [J.initial, J.monthly].forEach(function (input) {
      input.addEventListener('input', function () { maskMoney(input); recalcD(); });
      input.addEventListener('blur', function () { maskMoney(input); });
    });
    J.rate.addEventListener('input', recalcD);
    J.period.addEventListener('input', recalcD);
    J.rateUnit.addEventListener('change', recalc);
    J.periodUnit.addEventListener('change', recalc);
    J.clear.addEventListener('click', function () {
      J.initial.value = DEFAULTS.initial; J.monthly.value = DEFAULTS.monthly; J.rate.value = DEFAULTS.rate;
      J.period.value = '12'; J.rateUnit.value = 'anual'; J.periodUnit.value = 'anos';
      J.form.querySelector('input[name="ji-type"][value="compostos"]').checked = true;
      J.form.querySelector('input[name="ji-flow"][value="aporte"]').checked = true;
      recalc();
    });

    recalc();
  }

  /* ----------------------- comparador de renda fixa -------------------- */

  // Rentabilidade liquida anual efetiva: anualiza o ganho liquido apos o IR.
  function netAnnualRate(grossAnnual, months, ir) {
    var years = months / 12;
    if (years <= 0) return 0;
    var grossTotal = Math.pow(1 + grossAnnual, years);
    var netTotal = 1 + (grossTotal - 1) * (1 - ir);
    return netTotal <= 0 ? -1 : Math.pow(netTotal, 1 / years) - 1;
  }

  function prazoLabel(months) {
    var days = months * DAYS_PER_MONTH;
    if (days <= 180) return 'Curto prazo (até 180 dias)';
    if (days <= 360) return 'Médio prazo (181 a 360 dias)';
    if (days <= 720) return 'Médio prazo (361 a 720 dias)';
    return 'Longo prazo (acima de 720 dias)';
  }

  function setupComparador() {
    var C = { form: $('cmp-form'), cdi: $('cmp-cdi'), ipca: $('cmp-ipca'), base: $('cmp-base'), verdict: $('cmp-verdict') };
    var MODE_HELP = { pre: 'taxa fixa contratada, ao ano', cdi: 'percentual do CDI', ipca: 'juro real acima do IPCA' };
    var refs = {};
    ['a', 'b'].forEach(function (s) {
      refs[s] = {
        type: $('cmp-' + s + '-type'), rate: $('cmp-' + s + '-rate'), months: $('cmp-' + s + '-months'),
        rateHelp: $('cmp-' + s + '-rate-help'), title: $('cmp-' + s + '-title'), net: $('cmp-' + s + '-net'),
        sub: $('cmp-' + s + '-sub'), gross: $('cmp-' + s + '-gross'), period: $('cmp-' + s + '-period'),
        prazo: $('cmp-' + s + '-prazo'), ir: $('cmp-' + s + '-ir'), card: $('cmp-card-' + s)
      };
    });

    function sideMode(s) {
      var r = C.form.querySelector('input[name="cmp-' + s + '-mode"]:checked');
      return r ? r.value : 'cdi';
    }

    function computeSide(s, cdi, ipca) {
      var ref = refs[s];
      var inst = INSTRUMENTS[ref.type.value];
      var mode = sideMode(s);
      var rate = readDecimal(ref.rate); setInvalid(ref.rate, isNaN(rate)); if (isNaN(rate)) rate = 0; rate = Math.max(0, rate);
      var months = clamp(Math.round(+ref.months.value || 1), 1, 600);
      var grossAnnual = effectiveAnnual(mode, rate, cdi / 100, ipca / 100);
      var ir = inst.taxable ? irRateByMonths(months) : 0;
      ref.rateHelp.textContent = MODE_HELP[mode];
      return { label: inst.label, taxable: inst.taxable, mode: mode, rate: rate, months: months,
               grossAnnual: grossAnnual, ir: ir, net: netAnnualRate(grossAnnual, months, ir) };
    }

    function paint(s, r) {
      var ref = refs[s];
      ref.title.textContent = r.label;
      if (r.mode === 'cdi') {
        ref.net.textContent = pct(r.rate * (1 - r.ir), 2) + ' do CDI';
        ref.sub.textContent = 'equivale a ' + pct(r.net * 100, 2) + ' a.a. já líquido';
      } else {
        ref.net.textContent = pct(r.net * 100, 2) + ' a.a.';
        ref.sub.textContent = r.mode === 'ipca' ? 'rendimento nominal líquido' : 'rendimento líquido anual';
      }
      ref.gross.textContent = pct(r.grossAnnual * 100, 2) + ' a.a.';
      ref.period.textContent = r.months + (r.months === 1 ? ' mês' : ' meses');
      ref.prazo.textContent = prazoLabel(r.months);
      if (r.taxable) {
        ref.ir.className = 'ir-box ir-box--taxed';
        ref.ir.textContent = 'Alíquota do IR: ' + pct(r.ir * 100, 1);
      } else {
        ref.ir.className = 'ir-box ir-box--exempt';
        ref.ir.textContent = 'Isento de Imposto de Renda.';
      }
      ref.card.classList.toggle('result-card--win', !!r.win);
    }

    function recalc() {
      var cdi = readDecimal(C.cdi); setInvalid(C.cdi, isNaN(cdi)); if (isNaN(cdi)) cdi = 0;
      var ipca = readDecimal(C.ipca); setInvalid(C.ipca, isNaN(ipca)); if (isNaN(ipca)) ipca = 0;
      C.base.textContent = 'Valores base utilizados: CDI ' + pct(cdi, 2) + ', IPCA ' + pct(ipca, 2) + '.';

      var ra = computeSide('a', cdi, ipca);
      var rb = computeSide('b', cdi, ipca);
      ra.win = ra.net > rb.net + 1e-9;
      rb.win = rb.net > ra.net + 1e-9;
      paint('a', ra); paint('b', rb);

      var diff = Math.abs(ra.net - rb.net) * 100;
      var dtxt = diff.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var verdict;
      if (diff < 0.01) {
        verdict = 'Nas taxas atuais, <strong>' + ra.label + '</strong> e <strong>' + rb.label +
          '</strong> rendem praticamente o mesmo, perto de <strong>' + pct(ra.net * 100, 2) + ' a.a.</strong> líquido.';
      } else {
        var win = ra.net > rb.net ? ra : rb;
        verdict = 'O investimento <strong>' + ra.label + '</strong> rende <strong>' + pct(ra.net * 100, 2) +
          ' a.a.</strong> líquido e o <strong>' + rb.label + '</strong> rende <strong>' + pct(rb.net * 100, 2) +
          ' a.a.</strong> Nas condições atuais, o <strong>' + win.label + '</strong> rende mais, cerca de <strong>' +
          dtxt + ' pontos percentuais ao ano</strong>. Essas condições são sazonais e podem mudar.';
      }
      C.verdict.innerHTML = verdict;
      el.live.textContent = 'Comparador: ' + ra.label + ' ' + pct(ra.net * 100, 2) + ' a.a. e ' +
        rb.label + ' ' + pct(rb.net * 100, 2) + ' a.a. líquido.';
    }

    var recalcD = debounce(recalc, 120);
    C.form.addEventListener('submit', function (e) { e.preventDefault(); recalc(); });
    C.form.addEventListener('input', function (e) {
      if (e.target.matches('input[type="text"], input[type="number"]')) recalcD();
    });
    C.form.addEventListener('change', function (e) {
      if (e.target.matches('select, input[type="radio"]')) recalc();
    });

    recalc();
  }

  /* ----------------------- acoes x renda fixa -------------------------- */

  var MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function monthYear(l) { return MONTHS_PT[l.month - 1] + '/' + l.year; }

  // Grafico de duas linhas independentes (acao x renda fixa), eixo X em anos.
  function createDualLineChart(container, tooltip, titleEl) {
    var geo = null, model = null, hoverLine, dotA, dotB;
    var svg = container.querySelector('.chart__svg');

    function lineD(pts) {
      var d = '';
      for (var i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + pts[i][0].toFixed(2) + ' ' + pts[i][1].toFixed(2) + ' ';
      return d;
    }
    function niceMax(v) {
      if (v <= 0) return 1;
      var mag = Math.pow(10, Math.floor(Math.log10(v)));
      var nr = v / mag, s = nr <= 1 ? 1 : nr <= 2 ? 2 : nr <= 2.5 ? 2.5 : nr <= 5 ? 5 : 10;
      return s * mag;
    }

    function render() {
      if (!model) return;
      var w = container.clientWidth || 600, h = container.clientHeight || 260;
      var pad = { top: 16, right: 14, bottom: 26, left: 64 };
      var plotW = Math.max(10, w - pad.left - pad.right), plotH = Math.max(10, h - pad.top - pad.bottom);
      var n = model.a.length, baseY = pad.top + plotH;

      var mx = 1;
      for (var k = 0; k < n; k++) { if (model.a[k] > mx) mx = model.a[k]; if (model.b[k] > mx) mx = model.b[k]; }
      var maxVal = niceMax(mx);

      function xAt(i) { return pad.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW); }
      function yAt(v) { return pad.top + plotH - (v / maxVal) * plotH; }

      var aPts = [], bPts = [];
      for (var i = 0; i < n; i++) { aPts.push([xAt(i), yAt(model.a[i])]); bPts.push([xAt(i), yAt(model.b[i])]); }

      var grid = '', steps = 4;
      for (var g = 0; g <= steps; g++) {
        var val = maxVal * g / steps, gy = yAt(val);
        grid += '<line class="chart-grid-line" x1="' + pad.left + '" y1="' + gy.toFixed(1) + '" x2="' + (w - pad.right) + '" y2="' + gy.toFixed(1) + '"></line>';
        grid += '<text class="chart-ylabel" x="' + (pad.left - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end">' + compactBRL(val) + '</text>';
      }

      var xticks = '', lastY = null;
      var spanY = model.labels[n - 1].year - model.labels[0].year;
      var stepY = Math.max(1, Math.ceil((spanY + 1) / 8));
      for (var t = 0; t < n; t++) {
        var L = model.labels[t];
        if (L.month === 1 || t === 0) {
          if (lastY === null || L.year - lastY >= stepY) {
            xticks += '<text class="chart-ylabel" x="' + xAt(t).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle">' + L.year + '</text>';
            lastY = L.year;
          }
        }
      }

      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.innerHTML = grid +
        '<path class="line-principal" d="' + lineD(bPts) + '"></path>' +
        '<path class="line-total" d="' + lineD(aPts) + '"></path>' +
        xticks +
        '<g class="hover-layer" hidden>' +
          '<line class="chart-cursor" y1="' + pad.top + '" y2="' + baseY + '"></line>' +
          '<circle class="chart-dot chart-dot--principal" r="4"></circle>' +
          '<circle class="chart-dot chart-dot--total" r="4.5"></circle>' +
        '</g>';

      var hl = svg.querySelector('.hover-layer');
      hoverLine = hl.querySelector('.chart-cursor');
      dotB = hl.querySelector('.chart-dot--principal');
      dotA = hl.querySelector('.chart-dot--total');
      geo = { pad: pad, plotW: plotW, n: n, xAt: xAt, yAt: yAt, a: model.a, b: model.b, hl: hl };

      if (!reduceMotion) {
        ['.line-total', '.line-principal'].forEach(function (sel) {
          var ln = svg.querySelector(sel), len = ln.getTotalLength();
          ln.style.transition = 'none'; ln.style.strokeDasharray = len; ln.style.strokeDashoffset = len;
          void ln.getBoundingClientRect();
          ln.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1)';
          ln.style.strokeDashoffset = '0';
        });
      }
      if (titleEl) titleEl.textContent = model.title || '';
    }

    function showHoverAt(cx) {
      if (!geo) return;
      var rect = container.getBoundingClientRect();
      var rel = (cx - rect.left - geo.pad.left) / geo.plotW;
      var i = clamp(Math.round(rel * (geo.n - 1)), 0, geo.n - 1);
      var x = geo.xAt(i);
      geo.hl.removeAttribute('hidden');
      hoverLine.setAttribute('x1', x); hoverLine.setAttribute('x2', x);
      dotA.setAttribute('cx', x); dotA.setAttribute('cy', geo.yAt(geo.a[i]));
      dotB.setAttribute('cx', x); dotB.setAttribute('cy', geo.yAt(geo.b[i]));
      tooltip.innerHTML = '<div class="tooltip__title">' + monthYear(model.labels[i]) + '</div>' +
        '<div class="tooltip__row"><span><span class="dot dot--yield"></span>' + model.aLabel + '</span><span>' + brl(geo.a[i]) + '</span></div>' +
        '<div class="tooltip__row"><span><span class="dot dot--principal"></span>' + model.bLabel + '</span><span>' + brl(geo.b[i]) + '</span></div>';
      tooltip.hidden = false;
      var tw = tooltip.offsetWidth;
      tooltip.style.left = clamp(x, tw / 2 + 4, rect.width - tw / 2 - 4) + 'px';
      tooltip.style.top = geo.yAt(Math.max(geo.a[i], geo.b[i])) + 'px';
    }
    function hideHover() { tooltip.hidden = true; if (geo && geo.hl) geo.hl.setAttribute('hidden', ''); }

    container.addEventListener('pointermove', function (e) { showHoverAt(e.clientX); });
    container.addEventListener('pointerleave', hideHover);
    var ro = new ResizeObserver(debounce(function () { render(); }, 120));
    ro.observe(container);
    return { update: function (m) { model = m; render(); } };
  }

  function setupAcoes() {
    var A = {
      form: $('acoes-form'), ticker: $('ac-ticker'), start: $('ac-start'), end: $('ac-end'),
      initial: $('ac-initial'), rate: $('ac-rate'), token: $('ac-token'), calc: $('ac-calc'),
      state: $('ac-state'), output: $('ac-output'),
      mStock: $('ac-m-stock'), mStockFoot: $('ac-m-stock-foot'),
      mRf: $('ac-m-rf'), mRfFoot: $('ac-m-rf-foot'),
      mDiff: $('ac-m-diff'), mDiffLabel: $('ac-m-diff-label'), mDiffFoot: $('ac-m-diff-foot'),
      legend: $('ac-legend'), chartTitle: $('ac-chart-title'), chartSub: $('ac-chart-sub'),
      note: $('ac-note'),
      bdPeriod: $('ac-bd-period'), bdInvested: $('ac-bd-invested'), bdPrice: $('ac-bd-price'),
      bdPriceVal: $('ac-bd-priceval'), bdDiv: $('ac-bd-div'), bdTotal: $('ac-bd-total')
    };
    var chart = createDualLineChart($('acoes-chart'), $('acoes-tooltip'), $('acoes-svg-title'));
    var TOKEN_KEY = 'capitaliza-brapi-token';
    try { var saved = localStorage.getItem(TOKEN_KEY); if (saved) A.token.value = saved; } catch (e) { /* ignora */ }

    function legendItem(cls, label) {
      return '<span class="legend__item"><span class="legend__swatch legend__swatch--' + cls + '"></span>' + label + '</span>';
    }
    function showState(html, kind) {
      A.output.hidden = true;
      A.state.hidden = false;
      A.state.className = 'ac-state' + (kind ? ' ac-state--' + kind : '');
      A.state.innerHTML = html;
    }

    // No plano gratuito da brapi, o historico completo vem sem token para estas.
    var FREE_TICKERS = 'PETR4, MGLU3, VALE3 e ITUB4';

    async function fetchBrapi(ticker, token) {
      var url = 'https://brapi.dev/api/quote/' + encodeURIComponent(ticker) + '?range=max&interval=1mo';
      if (token) url += '&token=' + encodeURIComponent(token);
      var res;
      try { res = await fetch(url); } catch (e) { throw { kind: 'network' }; }
      var data = null;
      try { data = await res.json(); } catch (e) { /* corpo nao-JSON */ }
      var msg = data && (data.message || (typeof data.error === 'string' ? data.error : null));
      if (!res.ok || (data && data.error)) {
        if (res.status === 401 || res.status === 403) throw { kind: 'token', msg: msg };
        if (res.status === 404) throw { kind: 'notfound', msg: msg };
        if (res.status === 402) throw { kind: 'plan', msg: msg };
        if (res.status === 400) throw { kind: 'badrequest', msg: msg };
        throw { kind: 'http', status: res.status, msg: msg };
      }
      var r = data && data.results && data.results[0];
      if (!r || !r.historicalDataPrice || !r.historicalDataPrice.length) throw { kind: 'nodata' };
      return r;
    }

    function errorMessage(err) {
      var k = err && err.kind;
      var extra = err && err.msg ? ' <span class="ac-apimsg">(' + err.msg + ')</span>' : '';
      var freeHint = ' No plano gratuito, o histórico completo vem sem token para <strong>' + FREE_TICKERS +
        '</strong>. Outras ações, como BBAS3, exigem um plano pago da brapi.dev.';
      if (k === 'token') return '<strong>Token ausente ou inválido.</strong>' + extra + freeHint;
      if (k === 'notfound') return '<strong>Ação não encontrada.</strong> Confira o código (exemplos: PETR4, ITUB4, VALE3).' + extra;
      if (k === 'plan' || k === 'badrequest') return '<strong>Seu plano da brapi não cobre esta ação.</strong>' + extra + freeHint;
      if (k === 'period') return '<strong>Sem dados suficientes</strong> para o período informado nesta ação. Tente um intervalo maior.';
      if (k === 'network') return '<strong>Falha de conexão com o brapi.dev.</strong> Verifique a internet. Se abriu o arquivo direto (file://), o navegador pode bloquear a requisição: sirva por um servidor local (ex.: <code>python3 -m http.server</code>).';
      return '<strong>Erro ao consultar a API.</strong> Tente novamente em instantes' + (err && err.status ? ' (status ' + err.status + ')' : '') + '.' + extra;
    }

    function computeComparison(r, startY, endY, initial, ratePct) {
      var hist = r.historicalDataPrice
        .filter(function (p) { return p && p.date && p.close > 0; })
        .sort(function (a, b) { return a.date - b.date; });
      var pts = hist.filter(function (p) {
        var y = new Date(p.date * 1000).getUTCFullYear();
        return y >= startY && y <= endY;
      });
      if (pts.length < 2) throw { kind: 'period' };

      var adj = pts.map(function (p) { return (p.adjustedClose && p.adjustedClose > 0) ? p.adjustedClose : p.close; });
      var n = pts.length;
      var startClose = pts[0].close, endClose = pts[n - 1].close;
      var startAdj = adj[0], endAdj = adj[n - 1];
      var im = Math.pow(1 + ratePct / 100, 1 / 12) - 1;

      var stockSeries = new Array(n), rfSeries = new Array(n), labels = new Array(n);
      for (var i = 0; i < n; i++) {
        stockSeries[i] = initial * (adj[i] / startAdj);
        rfSeries[i] = initial * Math.pow(1 + im, i);
        var d = new Date(pts[i].date * 1000);
        labels[i] = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
      }
      var stockFinal = initial * (endAdj / startAdj);
      var priceFinal = initial * (endClose / startClose);
      var rfFinal = initial * Math.pow(1 + im, n - 1);

      return {
        labels: labels, stockSeries: stockSeries, rfSeries: rfSeries,
        stockFinal: stockFinal, priceFinal: priceFinal, rfFinal: rfFinal,
        startClose: startClose, endClose: endClose,
        totalReturn: endAdj / startAdj - 1, priceReturn: endClose / startClose - 1, rfReturn: rfFinal / initial - 1,
        dividendGain: stockFinal - priceFinal,
        startLabel: labels[0], endLabel: labels[n - 1],
        availFromYear: new Date(hist[0].date * 1000).getUTCFullYear(), reqStartYear: startY
      };
    }

    function renderResult(c, ticker, initial) {
      A.state.hidden = true;
      A.output.hidden = false;

      var stockWins = c.stockFinal >= c.rfFinal;
      animateValue(A.mStock, c.stockFinal, brl);
      animateValue(A.mRf, c.rfFinal, brl);
      animateValue(A.mDiff, Math.abs(c.stockFinal - c.rfFinal), brl);
      A.mStockFoot.textContent = 'rentabilidade total ' + pct(c.totalReturn * 100, 1);
      A.mRfFoot.textContent = 'rentabilidade ' + pct(c.rfReturn * 100, 1);
      A.mDiffLabel.textContent = stockWins ? 'Ação rendeu mais' : 'Renda fixa rendeu mais';
      A.mDiffFoot.textContent = (stockWins ? ticker : 'a renda fixa') + ' no período';

      A.legend.innerHTML = legendItem('yield', ticker + ' (com dividendos)') + legendItem('principal', 'Renda fixa');
      A.chartSub.textContent = 'Valor de ' + brl(initial) + ' investido no início, ' + monthYear(c.startLabel) + ' a ' + monthYear(c.endLabel) + '.';
      chart.update({
        a: c.stockSeries, b: c.rfSeries, labels: c.labels,
        aLabel: ticker, bLabel: 'Renda fixa',
        title: 'Comparação de ' + ticker + ' (dividendos reinvestidos) com a renda fixa de ' + monthYear(c.startLabel) + ' a ' + monthYear(c.endLabel) + '.'
      });

      A.bdPeriod.textContent = monthYear(c.startLabel) + ' a ' + monthYear(c.endLabel);
      A.bdInvested.textContent = brl(initial);
      A.bdPrice.textContent = 'de ' + brl(c.startClose) + ' a ' + brl(c.endClose) + ' (' + pct(c.priceReturn * 100, 1) + ')';
      A.bdPriceVal.textContent = brl(c.priceFinal);
      A.bdDiv.textContent = '+ ' + brl(c.dividendGain);
      A.bdTotal.textContent = brl(c.stockFinal) + ' (' + pct(c.totalReturn * 100, 1) + ')';

      var warn = c.availFromYear > c.reqStartYear
        ? '<strong>Atenção:</strong> os dados desta ação começam em ' + c.availFromYear + ', então o período foi ajustado. '
        : '';
      A.note.innerHTML = warn +
        'A rentabilidade total usa o preço ajustado, que equivale a reinvestir todos os dividendos em novas ações e corrige desdobramentos. ' +
        'A comparação é bruta: o Tesouro paga IR regressivo no resgate (15% após 2 anos) e ações têm regras próprias de imposto. ' +
        'A taxa de renda fixa é considerada constante, uma simplificação. Dados: brapi.dev.';

      el.live.textContent = 'Comparação ' + ticker + ': ação ' + brl(c.stockFinal) + ', renda fixa ' + brl(c.rfFinal) + '.';
    }

    async function run() {
      var ticker = (A.ticker.value || '').trim().toUpperCase();
      var token = (A.token.value || '').trim();
      var startY = clamp(Math.round(+A.start.value || 2010), 1990, 2100);
      var endY = clamp(Math.round(+A.end.value || 2020), 1990, 2100);
      var initial = readMoney(A.initial);
      var rate = readDecimal(A.rate); if (isNaN(rate)) rate = 0; rate = Math.max(0, rate);

      if (!ticker) { showState('Informe o código da ação (exemplo: PETR4).', 'error'); return; }
      if (endY < startY) { showState('O ano final deve ser maior ou igual ao inicial.', 'error'); return; }
      if (initial <= 0) { showState('Informe um valor investido maior que zero.', 'error'); return; }
      if (token) { try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignora */ } }

      A.calc.disabled = true;
      var prevLabel = A.calc.textContent;
      A.calc.textContent = 'Buscando...';
      showState('<div class="ac-loading"><span class="ac-spin" aria-hidden="true"></span>Buscando histórico de ' + ticker + ' no brapi.dev...</div>', 'loading');
      try {
        var r = await fetchBrapi(ticker, token);
        renderResult(computeComparison(r, startY, endY, initial, rate), ticker, initial);
      } catch (err) {
        showState(errorMessage(err), 'error');
      } finally {
        A.calc.disabled = false;
        A.calc.textContent = prevLabel;
      }
    }

    A.form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
    A.initial.addEventListener('input', function () { maskMoney(A.initial); });
    A.initial.addEventListener('blur', function () { maskMoney(A.initial); });
  }

  /* ----------------------------- abas ---------------------------------- */

  function setupTabs() {
    var defs = [
      { tab: 'tab-rendafixa', view: 'view-rendafixa' },
      { tab: 'tab-juros', view: 'view-juros' },
      { tab: 'tab-comparador', view: 'view-comparador' },
      { tab: 'tab-acoes', view: 'view-acoes' }
    ];
    var tabs = defs.map(function (d) { return $(d.tab); });

    function activate(idx) {
      defs.forEach(function (d, i) {
        var on = i === idx;
        var tabEl = $(d.tab);
        tabEl.classList.toggle('is-active', on);
        tabEl.setAttribute('aria-selected', on ? 'true' : 'false');
        tabEl.tabIndex = on ? 0 : -1;
        $(d.view).classList.toggle('is-active', on);
      });
    }

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { activate(i); });
      t.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        tabs[next].focus();
        activate(next);
      });
    });
  }

  /* ----------------------------- init ---------------------------------- */

  function init() {
    initTheme();
    state.instrument = selectedRadio('instrument') || 'cdb';
    buildIndexers(INSTRUMENTS[state.instrument], false);
    applyIndexerLabels();
    state.mode = selectedRadio('mode') || 'net';
    updateRangeFill();
    bindEvents();
    recalc();
    setupJuros();
    setupComparador();
    setupAcoes();
    setupTabs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
