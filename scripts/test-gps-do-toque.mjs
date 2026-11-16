/* 15/11/2026 — GPS DO TOQUE (supervisor digital, DECISOES 15/11 item 11.7). Medido no banco: nenhuma parada tem `entregue_lat`,
 * porque a tela manda a marcação pela fila sem coordenada. O conserto (core.js `registrarGpsDoToque`) manda a posição DEPOIS, numa
 * chamada à parte. Esta régua roda o core.js REAL em VM, sem rede e com relógio acelerado, e prova o contrato de segurança:
 *   G1 volta na hora (sem await) e nunca lança, nem com argumento torto;
 *   G2 NUNCA pede permissão: sem a localização precisa já autorizada, não lê GPS nem chama a rede (requestPermissions nunca);
 *   G3 com permissão: uma chamada `gpsDoToque` com linhas, ação, hora do toque, turno, lat, lng e precisão arredondada;
 *   G4 `aguardando` (a marcação ainda na fila) → tenta de novo em 15 s, 1 min, 3 min e desiste calado;
 *   G5 recusa de verdade não insiste; `tentarDepois` e rede caída insistem; nada vira erro solto (unhandledRejection);
 *   G6 no navegador, só com a permissão já concedida; GPS que falha ou plugin ausente = nada acontece.
 * Rode: node scripts/test-gps-do-toque.mjs   (APP_ASSETS_DIR=<cópia com defeito> para a prova de dente) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ASSETS = process.env.APP_ASSETS_DIR || 'public/assets';
console.log('alvo=' + ASSETS);
const fonteCore = fs.readFileSync(path.join(ASSETS, 'core.js'), 'utf8').replace(/^﻿/, '');

const soltos = [];
process.on('unhandledRejection', (e) => soltos.push(String(e && e.message || e)));
const realSetTimeout = setTimeout;
const esperar = (ms = 40) => new Promise((r) => realSetTimeout(r, ms));

function montar({ nativo = true, perm = 'granted', coarse = 'denied', posicao = { latitude: -19.9245, longitude: -43.9352, accuracy: 12.6 },
  posErro = null, semPlugin = false, respostas = [], navPerm = 'granted' } = {}) {
  const chamadasRede = []; const dormidas = []; const log = { check: 0, request: 0, getPos: 0, navGetPos: 0, removeItem: 0 };
  const fila = [...respostas];
  const ctx = { console, Intl, Date, URL, AbortController, clearTimeout };
  ctx.window = ctx;
  ctx.APP_CONFIG = { API_URL: '/api/painel/', API_MODE: 'json', API_TIMEOUT_MS: 1000, API_RETRY_COUNT: 0, STORAGE_DRIVER_KEY: 'driver', STORAGE_TOKEN_KEY: 'tok', STORAGE_CACHE_PREFIX: 'cache_', CACHE_TTL_MS: 1000 };
  ctx.location = { search: '', origin: 'https://app.teste' };
  ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() { log.removeItem++; } };
  ctx.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  ctx.document = {};
  // relógio acelerado: toda espera longa vira 2 ms, mas guardamos quanto foi pedido
  ctx.setTimeout = (fn, ms) => { if (ms >= 1000) dormidas.push(ms); return realSetTimeout(fn, ms >= 1000 ? 2 : ms); };
  ctx.fetch = async (url) => {
    chamadasRede.push(String(url));
    const r = fila.length ? fila.shift() : { ok: true, gravadas: 1, aguardando: false };
    if (r === 'rede') throw new Error('sem rede');
    return { ok: true, status: 200, json: async () => r };
  };
  ctx.navigator = nativo ? {} : {
    permissions: { query: async () => ({ state: navPerm }) },
    geolocation: { getCurrentPosition: (ok, erro) => { log.navGetPos++; if (posErro) erro(new Error(posErro)); else ok({ coords: posicao }); } },
  };
  if (nativo) {
    ctx.Capacitor = {
      isNativePlatform: () => true,
      Plugins: semPlugin ? {} : { Geolocation: {
        checkPermissions: async () => { log.check++; return { location: perm, coarseLocation: coarse }; },
        requestPermissions: async () => { log.request++; return { location: 'granted' }; },
        getCurrentPosition: async () => { log.getPos++; if (posErro) throw new Error(posErro); return { coords: posicao }; },
      } },
    };
  }
  vm.createContext(ctx);
  vm.runInContext(fonteCore, ctx);
  return { api: ctx.window.AppEntrega, chamadasRede, dormidas, log };
}
const params = (url) => Object.fromEntries(new URL(url).searchParams.entries());
let n = 0; const passou = (m) => { n++; console.log('PASS ' + m); };
const TS = '2026-11-16T13:12:00.000Z';

// G1 — volta na hora, nunca lança
{
  const t = montar();
  assert.equal(typeof t.api.registrarGpsDoToque, 'function', 'registrarGpsDoToque exportado');
  const antes = t.chamadasRede.length;
  const r = t.api.registrarGpsDoToque([7, 8], 'done', TS);
  assert.equal(r, undefined); assert.equal(t.chamadasRede.length, antes, 'nenhuma rede no instante do toque');
  passou('G1 volta na hora (sem await, sem rede no instante do toque)');
  for (const args of [[[], 'done', TS], [[7], 'start', TS], [[7], 'done', ''], [null, 'fail', TS], [['x', -1, 0], 'done', TS], [undefined, undefined, undefined]]) {
    assert.doesNotThrow(() => t.api.registrarGpsDoToque(...args));
  }
  await esperar(80);
  assert.equal(t.chamadasRede.length, 1, 'só a chamada válida foi à rede');
  passou('G1 argumento torto não lança e não chama a rede');
}

// G2 — nunca pede permissão
for (const [rotulo, op] of [['permissão ainda não respondida (prompt)', { perm: 'prompt' }], ['negada', { perm: 'denied' }], ['só aproximada (coarse)', { perm: 'denied', coarse: 'granted' }]]) {
  const t = montar(op);
  t.api.registrarGpsDoToque([7], 'done', TS);
  await esperar(60);
  assert.equal(t.log.request, 0, 'nunca requestPermissions');
  assert.equal(t.log.getPos, 0, 'não lê GPS');
  assert.equal(t.chamadasRede.length, 0, 'não chama a rede');
  passou(`G2 ${rotulo}: não pergunta, não lê GPS, não chama a rede`);
}

// G3 — com permissão: uma chamada com os campos certos
{
  const t = montar();
  t.api.registrarGpsDoToque([7, 8], 'fail', TS);
  await esperar(60);
  assert.equal(t.chamadasRede.length, 1);
  const p = params(t.chamadasRede[0]);
  assert.equal(p.action, 'gpsDoToque'); assert.equal(p.acao, 'fail'); assert.equal(p.rows, '7,8'); assert.equal(p.ts_device, TS);
  assert.ok(p.turno === 'MANHÃ' || p.turno === 'TARDE', 'turno do toque vai junto');
  assert.equal(Number(p.lat), -19.9245); assert.equal(Number(p.lng), -43.9352); assert.equal(p.precisao, '13');
  assert.ok(new URL(t.chamadasRede[0]).pathname.startsWith('/api/painel'), 'pelo proxy de sempre');
  assert.equal(t.log.request, 0); assert.equal(t.log.check, 1); assert.equal(t.log.getPos, 1);
  passou('G3 com a precisa autorizada: 1 chamada gpsDoToque com linhas, ação, hora, turno, lat, lng e precisão arredondada');
}

// G4 — aguardando: tenta de novo 15 s, 1 min, 3 min e para
{
  let t = montar({ respostas: [{ ok: true, gravadas: 0, aguardando: true }, { ok: true, gravadas: 0, aguardando: true }, { ok: true, gravadas: 1, aguardando: false }] });
  t.api.registrarGpsDoToque([7], 'done', TS);
  await esperar(150);
  assert.equal(t.chamadasRede.length, 3, '3 tentativas até gravar');
  assert.ok(t.dormidas.includes(15000) && t.dormidas.includes(60000) && !t.dormidas.includes(180000), 'esperou 15 s e 1 min');
  passou('G4 aguardando, aguardando, gravou: 3 tentativas (15 s, 1 min) e para');
  t = montar({ respostas: Array(10).fill({ ok: true, gravadas: 0, aguardando: true }) });
  t.api.registrarGpsDoToque([7], 'done', TS);
  await esperar(200);
  assert.equal(t.chamadasRede.length, 4, 'no máximo 4 tentativas');
  assert.ok([15000, 60000, 180000].every((ms) => t.dormidas.includes(ms)));
  passou('G4 sempre aguardando: 4 tentativas (agora, 15 s, 1 min, 3 min) e desiste calado');
}

// G5 — recusa não insiste; tentarDepois e rede insistem; nada solto
{
  let t = montar({ respostas: [{ ok: false, error: 'GPS do toque inválido.' }] });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(80);
  assert.equal(t.chamadasRede.length, 1); passou('G5 recusa de verdade: 1 chamada, não insiste');
  t = montar({ respostas: [{ ok: false, precisaLogin: true, error: 'Faça login' }] });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(80);
  assert.equal(t.chamadasRede.length, 1); assert.equal(t.log.removeItem, 0, 'não apaga token nem nada do aparelho');
  passou('G5 precisaLogin: para e NÃO apaga o token (não usa o apiGet)');
  t = montar({ respostas: [{ ok: false, tentarDepois: true }, 'rede', { ok: true, gravadas: 1 }] });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(150);
  assert.equal(t.chamadasRede.length, 3); passou('G5 tentarDepois e rede caída: tenta de novo até gravar');
  t = montar({ respostas: ['rede', 'rede', 'rede', 'rede', 'rede'] });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(200);
  assert.equal(t.chamadasRede.length, 4); passou('G5 sem rede o tempo todo: 4 tentativas e para, sem erro');
  t = montar({ posErro: 'timeout' });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.chamadasRede.length, 0); passou('G5 GPS que falha: nada acontece');
  t = montar({ semPlugin: true });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.chamadasRede.length, 0); passou('G5 app nativo sem o plugin de GPS: nada acontece');
}

// G6 — navegador (PWA): só com a permissão já concedida
{
  let t = montar({ nativo: false, navPerm: 'prompt' });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.log.navGetPos, 0); assert.equal(t.chamadasRede.length, 0);
  passou('G6 navegador sem permissão concedida: não lê GPS (não abre o pedido do navegador)');
  t = montar({ nativo: false, navPerm: 'granted' });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.log.navGetPos, 1); assert.equal(t.chamadasRede.length, 1);
  passou('G6 navegador com permissão concedida: lê e manda');
}

await esperar(50);
assert.deepEqual(soltos, [], 'nenhuma promessa rejeitada solta');
passou('nenhum erro solto (unhandledRejection) em toda a régua');
console.log(`✅ ${n}/${n} conferências do GPS do toque`);
