// Harness das réguas da LEVA 2 (28/10/2026) — o CÓDIGO REAL do app (fila-duravel.js, core.js, pagamento-porta.js e funções
// recortadas de page-entregas.js) numa VM, com IndexedDB simulado (fake-indexeddb), transporte fictício e relógio injetado.
// Nenhuma chamada a serviço de verdade: todo fetch passa por `responder` e qualquer origem fora da fictícia reprova.
//
// ⛔ APP_ASSETS_DIR aponta a régua para OUTRA cópia dos assets (a prova de que a régua reprova o código antigo: extrair a versão
// de antes num diretório e rodar com APP_ASSETS_DIR=<dir>). O eco "alvo=<dir>" é a auto-prova de que a cópia foi lida.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
let idb; try { idb = require('fake-indexeddb'); }
catch { idb = require(path.join(os.homedir(), '.codex/tmp/rota-idb-testes/node_modules/fake-indexeddb')); }
export const IDBKeyRange = idb.IDBKeyRange;

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS = process.env.APP_ASSETS_DIR || path.join(RAIZ, 'public/assets');
export const ler = nome => fs.readFileSync(path.join(ASSETS, nome), 'utf8');
export const copiar = x => JSON.parse(JSON.stringify(x));
export const ORIGEM = 'https://app.ficticio.invalid';
export const PREFIXO = 'leva2_';

export function funcaoDaPagina(fonte, nome) {
  const m = fonte.match(new RegExp('^  (?:async )?function ' + nome + '\\([^]*?^  }', 'm'));
  assert.ok(m, 'Função real ausente em page-entregas.js: ' + nome);
  return m[0];
}

export function memoria(map) {
  return {
    getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k),
    key: i => [...map.keys()][i] ?? null, get length() { return map.size; }
  };
}

export function relogio(inicio) {
  let agora = Date.parse(inicio);
  class DataFake extends Date {
    constructor(...args) { if (!args.length) super(agora); else super(...args); }
    static now() { return agora; }
  }
  return { Data: DataFake, avancar: ms => { agora += ms; }, agora: () => agora };
}

// As funções da página que os cenários usam (todas reais). As que mexem em DOM ficam de fora e ganham dublês abaixo.
export const FUNCOES_PAGINA = ['pgRespostaAnterior', 'metaDeStatus', 'itensComFila', 'guardarNaFila', 'agendarEnvio',
  'avisarSemSincronizacao', 'comEspera', 'avisarArmazenamento', 'guardarRecebimento', 'enviarRecebimentoGuardado',
  'acompanharEnvio', 'enviarConfirmacao', 'estadoDoEnvio', 'irmasAtivas', 'handleAction', 'executarAcao',
  'coletarPagamento', 'adiantarConferenciaPg', 'conferirGrupoValores', 'updateLocalStatus'];

export async function app({ store = new Map(), responder = async () => ({ ok: true }), inicio = '2026-10-28T13:00:00.000Z',
  semLocks = false, extras = [], dubles = {}, driver = 'Fictício', token = 'tok-ficticio', painel = true } = {}) {
  const calls = [], avisos = [], keepalive = [], abertos = [];
  let transporte = responder, semRede = false, banco;
  const rel = relogio(inicio);
  if (!store.idb) store.idb = new idb.IDBFactory();
  if (!store.locks) store.locks = new Map();
  if (!store.ls) store.ls = new Map();
  const fabrica = { open: (...a) => store.idb.open(...a) };
  const local = memoria(store.ls);
  const fonteFila = ler('fila-duravel.js'), fonteCore = ler('core.js'), fontePorta = ler('pagamento-porta.js'), fontePagina = ler('page-entregas.js');

  const window = {
    APP_CONFIG: {
      API_URL: ORIGEM + '/api/painel/', POST_URL: ORIGEM + '/api/painel/', API_MODE: 'json', API_RETRY_COUNT: 0,
      API_TIMEOUT_MS: 15000, STORAGE_CACHE_PREFIX: PREFIXO, STORAGE_DRIVER_KEY: PREFIXO + 'driver',
      STORAGE_TOKEN_KEY: PREFIXO + 'token', REFRESH_INTERVAL_MS: 60000, CACHE_TTL_MS: 300000
    },
    location: { origin: ORIGEM, search: '' },
    setTimeout: (fn, ms) => (ms < 5000 ? (queueMicrotask(fn), 1) : 0), clearTimeout: () => {},
    indexedDB: fabrica, addEventListener: () => {}, dispatchEvent: () => {}
  };
  const timeouts = [];
  const ctx = vm.createContext({
    window, localStorage: local, sessionStorage: memoria(new Map()),
    navigator: {
      userAgent: 'teste-node', onLine: true,
      locks: semLocks ? undefined : { request: async (nome, opc, fn) => {
        if (store.locks.has(nome)) return fn(null);
        store.locks.set(nome, true);
        try { return await fn({ name: nome }); } finally { store.locks.delete(nome); }
      } }
    },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    indexedDB: fabrica, IDBKeyRange: idb.IDBKeyRange, crypto: webcrypto, URL, URLSearchParams, AbortController,
    Date: rel.Data, Map, Set, Number, String, Array, Object, JSON, Boolean, Promise, Error, Math, Intl,
    console, Response, queueMicrotask,
    setTimeout: (fn, ms) => { timeouts.push(ms); const t = { c: false }; if (ms < 5000) queueMicrotask(() => { if (!t.c) fn(); }); return t; },
    clearTimeout: t => { if (t) t.c = true; },
    fetch: async (url, opcoes) => {
      const u = new URL(url, ORIGEM);
      assert.equal(u.origin, ORIGEM, 'nenhuma chamada sai para fora do fictício: ' + url);
      const metodo = (opcoes && opcoes.method) || 'GET';
      const params = Object.fromEntries(u.searchParams);
      if (metodo === 'POST') Object.assign(params, JSON.parse((opcoes && opcoes.body) || '{}'));
      const registro = { metodo, url: u.toString(), caminho: u.pathname, params: copiar(params) };
      if (opcoes && opcoes.keepalive) { keepalive.push(registro); const r = await transporte(params, calls.length, registro); return Response.json(r); }
      if (semRede) throw Error('Sem rede fictícia');
      calls.push(registro);
      const resposta = transporte(params, calls.length, registro);
      const sinal = opcoes && opcoes.signal;
      if (!sinal) return Response.json(await resposta);
      return Response.json(await Promise.race([resposta, new Promise((_, rej) => {
        if (sinal.aborted) return rej(Error('AbortError fictício'));
        sinal.addEventListener('abort', () => rej(Error('AbortError fictício')));
      })]));
    }
  });

  vm.runInContext(fonteFila, ctx, { filename: 'fila-duravel.js' });
  const criarOriginal = window.FilaDuravel.criar;
  window.FilaDuravel.criar = opc => { banco = criarOriginal(opc); return banco; };
  if (painel) local.setItem('app_api_url_override', '/api/painel/');
  local.setItem(PREFIXO + 'driver', driver);
  if (token) local.setItem('app_entregas_tokens_v2', JSON.stringify({ [driver]: { token, em: Date.now() } }));
  vm.runInContext(fonteCore, ctx, { filename: 'core.js' });
  vm.runInContext(fontePorta, ctx, { filename: 'pagamento-porta.js' });

  const api = window.AppEntrega;
  const ui = {
    alerta: async (mensagem, opc) => { avisos.push({ mensagem, opc }); if (opc && opc.aoAbrir) opc.aoAbrir(); return true; },
    escolher: async (...a) => { abertos.push({ tipo: 'escolher', mensagem: a[0], opcoes: a[1], opc: a[2] }); if (ctx.aoDialogo) await ctx.aoDialogo(a); return ctx.proximaEscolha ? ctx.proximaEscolha(a) : null; },
    perguntar: async (...a) => { abertos.push({ tipo: 'perguntar', mensagem: a[0], opc: a[1] }); if (ctx.aoDialogo) await ctx.aoDialogo(a); return ''; },
    confirmar: async () => true
  };
  window.AppUI = ui;
  const state = { driver, pgRespondido: {}, expandidos: new Set(), items: [], rotaIniciada: true, pgCfg: { perguntar: false, formas: [] }, conferidoEm: {} };
  const pintadas = [];
  Object.assign(ctx, {
    api, state, AppUI: ui,
    renderList: () => { pintadas.push(1); }, carregarTudo: () => { ctx.recargas = (ctx.recargas || 0) + 1; },
    openSameTab: async (u) => { ctx.mapasAbertos = (ctx.mapasAbertos || []).concat([u]); },
    setLoading: () => {}, setWarning: () => {}, salvarPgCfg: () => {}, pedirLoginDeNovo: async () => {},
    errorBox: { classList: { add() {}, remove() {} }, style: {}, textContent: '' },
    sectionsRoot: { innerHTML: '', classList: { add() {}, remove() {} }, querySelectorAll: () => [], querySelector: () => null },
    ...dubles
  });
  const nomes = [...new Set(FUNCOES_PAGINA.concat(extras))].filter(n => !Object.prototype.hasOwnProperty.call(dubles, n));
  const pagina = vm.runInContext(nomes.map(n => funcaoDaPagina(fontePagina, n)).join('\n') + '\n({' + nomes.join(',') + '});',
    ctx, { filename: 'page-entregas.js (funções reais)' });
  await api.filaPronta();

  const h = {
    api, state, calls, avisos, keepalive, abertos, pintadas, store, relogio: rel, ctx, pagina, timeouts, window, local,
    banco: () => banco,
    fila: () => copiar(banco.snapshot() || []),
    vista: () => copiar(pagina.itensComFila()),
    statusNaTela: row => (pagina.itensComFila().find(x => Number(x.row) === Number(row)) || {}).status,
    tocar: (act, row) => pagina.handleAction(act, row),
    enviar: () => api.processarFila(),
    escolher: fn => { ctx.proximaEscolha = typeof fn === 'function' ? fn : () => fn; },
    aoDialogo: fn => { ctx.aoDialogo = fn; },
    transporte: t => { transporte = t; },
    semRede: v => { semRede = v; },
    assentar: async () => { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); },
    fechar: () => { banco.fechar(); store.locks.clear(); }
  };
  return h;
}

export function reguas(titulo) {
  const testes = [];
  return {
    teste: (nome, fn) => testes.push([nome, fn]),
    async rodar() {
      console.log('alvo=' + ASSETS);
      let falhas = 0;
      for (const [nome, fn] of testes) {
        try { await fn(); console.log('PASS ' + nome); }
        catch (e) { falhas++; console.log('FAIL ' + nome + '\n' + (e && e.stack || e)); }
      }
      console.log((falhas ? '❌ ' : '✅ ') + (testes.length - falhas) + '/' + testes.length + ' ' + titulo);
      if (falhas) process.exitCode = 1;
    }
  };
}
