// RÉGUA DA LEVA 2 (28/10/2026) — abrir o app rápido e o código antigo fora. Roda: node scripts/test-leva2-abertura.mjs
//
// O QUE ELA PROVA:
//   A1 o atalho do <head> do index.html (reabre direto na rota sem esperar os 7 scripts) decide EXATAMENTE como a regra de
//      page-home.js `retomarSePuder`, numa matriz de 300+ estados do aparelho (sem isto as duas regras se separariam em silêncio);
//   A2 a home ENVIA a fila ao abrir (antes: quem finalizou sem sinal e reabriu caía na home e nada subia) e mostra quantos faltam;
//   A3 vercel.json: revalidação barata (no-cache + ETag) no que é página/arquivo, no-store só na API, e a função em São Paulo;
//   A4 o código antigo saiu: /painel, /admin, api/proxy.js, api/painel-data.js, a senha '1234', a URL da planilha e o escape
//      `?planilha=1`/`?painel=0` (que mandaria a fila para a planilha morta). O .apk de /download continua.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { app, reguas, RAIZ, ASSETS, ler, funcaoDaPagina, memoria } from './_harness-leva2.mjs';

const { teste, rodar } = reguas('cenários da abertura e do código antigo (leva 2)');
const PUBLICO = process.env.APP_PUBLIC_DIR || path.join(RAIZ, 'public');

teste('A1 o atalho do <head> decide igual à regra da home em todos os estados', async () => {
  const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
  const cabeca = html.slice(0, html.indexOf('</head>'));
  const m = cabeca.match(/<script>([^]*?)<\/script>/);
  assert.ok(m, 'o atalho inline existe no <head> do index.html (antes da fonte, do CSS e dos scripts)');
  assert.ok(cabeca.indexOf('<script>') < cabeca.indexOf('styles.css'), 'e vem ANTES do CSS');
  const atalho = m[1];
  const fonteHome = ler('page-home.js'), fonteCore = ler('core.js'), fonteCfg = ler('config.js'), fonteFila = ler('fila-duravel.js');
  const retomar = funcaoDaPagina(fonteHome, 'retomarSePuder');
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  let casos = 0, redirecionou = 0;
  const decidir = (estado, busca, quem) => {
    const ls = memoria(new Map(Object.entries(estado)));
    let destino = null;
    const location = { search: busca, origin: 'https://app.ficticio.invalid', replace: u => { destino = u; }, href: '' };
    const ctx = vm.createContext({ window: { location, localStorage: ls, setTimeout, addEventListener() {} }, location, localStorage: ls,
      sessionStorage: memoria(new Map()), URLSearchParams, URL, Intl, Date, JSON, Number, String, Object, Array, console, Map, Set,
      navigator: {}, indexedDB: undefined });
    ctx.window.window = ctx.window;
    if (quem === 'head') vm.runInContext(atalho, ctx);
    else {
      vm.runInContext(fonteCfg, ctx); vm.runInContext(fonteFila, ctx); vm.runInContext(fonteCore, ctx);
      ctx.api = ctx.window.AppEntrega;
      vm.runInContext(retomar + '\nretomarSePuder();', ctx);
    }
    return destino;
  };
  const agora = Date.now();
  for (const nome of ['', 'Ana']) for (const tok of ['v2', 'legado', 'legado-outro', 'nenhum']) for (const turno of ['MANHÃ', null])
    for (const ini of [true, false]) for (const fim of [false, true]) for (const ativ of [agora - 3600e3, agora - 4 * 3600e3, null])
      for (const busca of ['', '?escolher=1', '?x=1']) {
        const e = {};
        if (nome) e.app_entregas_driver_name = nome;
        if (tok === 'v2') e.app_entregas_tokens_v2 = JSON.stringify({ Ana: { token: 't' } });
        if (tok === 'legado') e.app_entregas_driver_token = JSON.stringify({ token: 't', nome: 'Ana' });
        if (tok === 'legado-outro') e.app_entregas_driver_token = JSON.stringify({ token: 't', nome: 'Beto' });
        if (turno) e['app_turno_v1_' + dia] = turno;
        const t = turno || (new Date().getHours() < 14 ? 'MANHÃ' : 'TARDE');
        if (ini) e['montagem_inicio_confirmado_v1_' + dia + '_' + t + '_Ana'] = '1';
        if (fim) e['rota_fim_confirmado_v1_' + dia + '_' + t + '_Ana'] = '1';
        if (ativ) e['app_atividade_v1_Ana'] = String(ativ);
        const a = decidir(e, busca, 'head'), b = decidir(e, busca, 'home');
        casos++; if (a) redirecionou++;
        assert.equal(a, b, 'o atalho e a home divergiram em ' + JSON.stringify({ nome, tok, turno, ini, fim, ativ: ativ ? Math.round((agora - ativ) / 3600e3) + 'h' : null, busca }));
      }
  assert.ok(casos >= 300 && redirecionou > 0, casos + ' casos, ' + redirecionou + ' redirecionaram');
});

teste('A2 a home envia a fila ao abrir e mostra quantos envios faltam', async () => {
  const h = await app({ responder: async p => p.action === 'entregadores' ? { ok: true, items: ['Fictício'] } : { ok: true } });
  h.semRede(true);
  await h.api.enfileirar({ action: 'marcarEntregue', row: 1, ts_device: '2026-10-28T12:00:00.000Z' }, { row: 1 });
  await h.api.enfileirar({ action: 'marcarEntregue', row: 2, ts_device: '2026-10-28T12:00:00.000Z' }, { row: 2 });
  h.semRede(false);
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, textContent: '', innerHTML: '',
    querySelectorAll: () => [], parentNode: { insertBefore(n) { caixas.push(n); }, firstChild: null }, setAttribute() {} });
  const caixas = [];
  const elementos = {};
  h.ctx.document = { getElementById: id => elementos[id] || (elementos[id] = el()), createElement: () => el(),
    visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  h.ctx.window.document = h.ctx.document;
  h.window.location.search = '?escolher=1'; // fica na home (não reabre direto na rota)
  h.ctx.location = h.window.location;
  vm.runInContext(ler('page-home.js'), h.ctx, { filename: 'page-home.js' });
  for (let i = 0; i < 6; i++) await h.assentar();
  assert.equal(h.calls.filter(c => c.params.action === 'marcarEntregue').length, 2, 'as marcações guardadas subiram da HOME');
  assert.equal(h.fila().length, 0);
});

teste('A3 vercel.json: revalidação barata, no-store só na API, função em São Paulo', async () => {
  const cfg = JSON.parse(fs.readFileSync(process.env.APP_VERCEL_JSON || path.join(RAIZ, 'vercel.json'), 'utf8'));
  assert.deepEqual(cfg.regions, ['gru1'], 'o proxy roda perto do painel e do entregador (antes: região padrão, nos EUA)');
  const cache = src => (cfg.headers || []).filter(r => new RegExp('^' + r.source.replace(/\(\?!api\/\)/, '(?!api/)').replace(/\(\.\*\)/g, '(.*)') + '$').test(src))
    .flatMap(r => r.headers).filter(x => x.key.toLowerCase() === 'cache-control').map(x => x.value);
  assert.deepEqual(cache('/assets/core.js'), ['no-cache'], 'arquivo do app: revalida (304), nunca serve versão velha');
  assert.deepEqual(cache('/entregas/'), ['no-cache']);
  assert.deepEqual(cache('/api/painel/'), ['no-store'], 'a API continua sem cache nenhum');
  assert.equal(JSON.stringify(cfg).includes('"no-store"') && cache('/').includes('no-store'), false);
});

teste('A4 o código antigo saiu (e o .apk ficou)', async () => {
  for (const f of ['public/painel/index.html', 'public/admin/index.html', 'public/assets/page-admin.js', 'api/proxy.js', 'api/painel-data.js'])
    assert.equal(fs.existsSync(path.join(RAIZ, f)), false, f + ' saiu');
  assert.equal(fs.existsSync(path.join(RAIZ, 'public/download/entregas.apk')), true, 'o .apk de instalação NÃO foi apagado');
  const cfg = ler('config.js');
  const cfgCodigo = cfg.replace(/\/\/.*$/gm, ''); // o comentário conta a história; o que vale é o código
  assert.doesNotMatch(cfgCodigo, /script\.google\.com|ADMIN_PASSWORD|'1234'|jsonp'/, 'sem planilha, sem senha do /admin, sem JSONP');
  assert.doesNotMatch(cfgCodigo, /get\('planilha'\)|get\('painel'\)/, 'sem o escape ?planilha=1 / ?painel=0');
  const ctx = vm.createContext({ window: {}, localStorage: memoria(new Map()), location: { search: '?planilha=1&painel=0' }, URLSearchParams });
  vm.runInContext(cfg, ctx);
  assert.equal(ctx.window.APP_CONFIG.API_URL, '/api/painel/', 'com ?planilha=1 continua no painel (antes: a fila iria para a planilha morta)');
  assert.equal(ctx.window.APP_CONFIG.API_MODE, 'json');
  const core = ler('core.js');
  assert.doesNotMatch(core, /\/api\/proxy'|loadJSONP\(|espelharNoPainel\(/, 'sem o proxy antigo, sem JSONP, sem o espelho da planilha');
  for (const pag of ['index.html', 'entregas/index.html'])
    assert.doesNotMatch(fs.readFileSync(path.join(PUBLICO, pag), 'utf8'), /page-admin\.js/);
});

await rodar();
console.log('assets=' + ASSETS);
