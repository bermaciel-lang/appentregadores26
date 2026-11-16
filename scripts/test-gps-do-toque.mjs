/* 15/11/2026 — GPS DO TOQUE (supervisor digital, DECISOES 15/11 item 11.7). Medido no banco: nenhuma parada tem `entregue_lat`,
 * porque a tela manda a marcação pela fila sem coordenada. O conserto (core.js `registrarGpsDoToque`) manda a posição DEPOIS, numa
 * chamada à parte, e só com o interruptor do painel ligado. Esta régua roda o core.js REAL em VM, sem rede e com relógio acelerado:
 *   G0 DESLIGADO até a lista de entregas dizer `gpsToque: true` (nem lê o GPS); a resposta `desligado` apaga na hora;
 *   G1 volta na hora (sem await) e nunca lança, nem com argumento torto;
 *   G2 NUNCA pede permissão: sem a localização precisa já autorizada, não lê GPS nem chama a rede (requestPermissions nunca);
 *   G3 com permissão: uma chamada `gpsDoToque` com linhas, ação, hora do toque, turno, lat, lng e precisão arredondada;
 *   G4 `aguardando` → tenta de novo em 15 s, 1 min, 3 min, 10 min e 30 min e desiste calado;
 *   G5 recusa de verdade não insiste; `tentarDepois` e rede caída insistem; nada vira erro solto (unhandledRejection);
 *   G6 no navegador, só com a permissão já concedida; GPS que falha ou plugin ausente = nada acontece;
 *   G7 a tela chama DEPOIS do commit na fila, com `try` e `typeof`, nas 3 portas (Entregue, porta 2 Entregue, porta 2 Não entregue).
 * Rode: node scripts/test-gps-do-toque.mjs   (APP_ASSETS_DIR=<cópia com defeito> para a prova de dente) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ASSETS = process.env.APP_ASSETS_DIR || 'public/assets';
console.log('alvo=' + ASSETS);
const fonteCore = fs.readFileSync(path.join(ASSETS, 'core.js'), 'utf8').replace(/^﻿/, '');
const fontePagina = fs.readFileSync(path.join(ASSETS, 'page-entregas.js'), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

const soltos = [];
process.on('unhandledRejection', (e) => soltos.push(String(e && e.message || e)));
const realSetTimeout = setTimeout;
const esperar = (ms = 40) => new Promise((r) => realSetTimeout(r, ms));

async function montar({ semLista = false, ligado = true, nativo = true, perm = 'granted', coarse = 'denied', posicao = { latitude: -19.9245, longitude: -43.9352, accuracy: 12.6 },
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
    const u = String(url);
    if (u.includes('action=entregas')) return { ok: true, status: 200, json: async () => ({ ok: true, data: '2026-11-16', items: [], rotaIniciada: true, gpsToque: ligado }) };
    chamadasRede.push(u);
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
  const api = ctx.window.AppEntrega;
  // o interruptor chega pelo caminho de verdade: a lista de entregas
  if (!semLista) await api.carregarEntregasPorEntregador('Altacir', { retries: 0 }).catch(() => {});
  return { api, chamadasRede, dormidas, log };
}
const params = (url) => Object.fromEntries(new URL(url).searchParams.entries());
let n = 0; const passou = (m) => { n++; console.log('PASS ' + m); };
const TS = '2026-11-16T13:12:00.000Z';

// G0 — interruptor do painel
{
  let t0 = await montar({ semLista: true });
  t0.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t0.log.check, 0); assert.equal(t0.log.getPos, 0); assert.equal(t0.chamadasRede.length, 0);
  passou('G0 a lista ainda não chegou (app aberto sem rede, rota do cache): desligado');
  let t = await montar({ ligado: false });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.log.check, 0, 'nem consulta a permissão'); assert.equal(t.log.getPos, 0); assert.equal(t.chamadasRede.length, 0);
  passou('G0 lista com gpsToque false (o padrão do painel): não toca no GPS nem na rede');
  t = await montar({ ligado: 'sim' });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.log.getPos, 0); passou('G0 só `true` liga (qualquer outro valor = desligado)');
  t = await montar({ respostas: [{ ok: true, desligado: true }] });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.chamadasRede.length, 1); assert.equal(t.log.getPos, 1);
  t.api.registrarGpsDoToque([8], 'done', TS); await esperar(60);
  assert.equal(t.log.getPos, 1, 'depois do desligado não lê mais o GPS'); assert.equal(t.chamadasRede.length, 1);
  passou('G0 painel respondeu desligado: o próximo toque já não lê o GPS');
}

// G1 — volta na hora, nunca lança
{
  const t = await montar();
  assert.equal(typeof t.api.registrarGpsDoToque, 'function', 'registrarGpsDoToque exportado');
  const r = t.api.registrarGpsDoToque([7, 8], 'done', TS);
  assert.equal(r, undefined); assert.equal(t.chamadasRede.length, 0, 'nenhuma rede no instante do toque');
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
  const t = await montar(op);
  t.api.registrarGpsDoToque([7], 'done', TS);
  await esperar(60);
  assert.equal(t.log.request, 0, 'nunca requestPermissions');
  assert.equal(t.log.getPos, 0, 'não lê GPS');
  assert.equal(t.chamadasRede.length, 0, 'não chama a rede');
  passou(`G2 ${rotulo}: não pergunta, não lê GPS, não chama a rede`);
}

// G3 — com permissão: uma chamada com os campos certos
{
  const t = await montar();
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

// G4 — aguardando: tenta de novo e para
{
  let t = await montar({ respostas: [{ ok: true, gravadas: 0, aguardando: true }, { ok: true, gravadas: 0, aguardando: true }, { ok: true, gravadas: 1, aguardando: false }] });
  t.api.registrarGpsDoToque([7], 'done', TS);
  await esperar(150);
  assert.equal(t.chamadasRede.length, 3, '3 tentativas até gravar');
  assert.ok(t.dormidas.includes(15000) && t.dormidas.includes(60000) && !t.dormidas.includes(180000), 'esperou 15 s e 1 min');
  passou('G4 aguardando, aguardando, gravou: 3 tentativas (15 s, 1 min) e para');
  t = await montar({ respostas: Array(10).fill({ ok: true, gravadas: 0, aguardando: true }) });
  t.api.registrarGpsDoToque([7], 'done', TS);
  await esperar(250);
  assert.equal(t.chamadasRede.length, 6, 'no máximo 6 tentativas');
  assert.ok([15000, 60000, 180000, 600000, 1800000].every((ms) => t.dormidas.includes(ms)));
  passou('G4 sempre aguardando: 6 tentativas (agora, 15 s, 1 min, 3 min, 10 min, 30 min) e desiste calado');
}

// G5 — recusa não insiste; tentarDepois e rede insistem; nada solto
{
  let t = await montar({ respostas: [{ ok: false, error: 'GPS do toque inválido.' }] });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(80);
  assert.equal(t.chamadasRede.length, 1); passou('G5 recusa de verdade: 1 chamada, não insiste');
  t = await montar({ respostas: [{ ok: false, precisaLogin: true, error: 'Faça login' }] });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(80);
  assert.equal(t.chamadasRede.length, 1); assert.equal(t.log.removeItem, 0, 'não apaga token nem nada do aparelho');
  passou('G5 precisaLogin: para e NÃO apaga o token (não usa o apiGet)');
  t = await montar({ respostas: [{ ok: false, tentarDepois: true }, 'rede', { ok: true, gravadas: 1 }] });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(150);
  assert.equal(t.chamadasRede.length, 3); passou('G5 tentarDepois e rede caída: tenta de novo até gravar');
  t = await montar({ respostas: Array(10).fill('rede') });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(250);
  assert.equal(t.chamadasRede.length, 6); passou('G5 sem rede o tempo todo: 6 tentativas e para, sem erro');
  t = await montar({ posErro: 'timeout' });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.chamadasRede.length, 0); passou('G5 GPS que falha: nada acontece');
  t = await montar({ semPlugin: true });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.chamadasRede.length, 0); passou('G5 app nativo sem o plugin de GPS: nada acontece');
}

// G6 — navegador (PWA): só com a permissão já concedida
{
  let t = await montar({ nativo: false, navPerm: 'prompt' });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.log.navGetPos, 0); assert.equal(t.chamadasRede.length, 0);
  passou('G6 navegador sem permissão concedida: não lê GPS (não abre o pedido do navegador)');
  t = await montar({ nativo: false, navPerm: 'granted' });
  t.api.registrarGpsDoToque([7], 'done', TS); await esperar(60);
  assert.equal(t.log.navGetPos, 1); assert.equal(t.chamadasRede.length, 1);
  passou('G6 navegador com permissão concedida: lê e manda');
}

// G7 — a tela chama nas 3 portas, DEPOIS do commit, com try e typeof (régua de texto: pega apagar, mover para antes ou tirar a guarda)
{
  const GUARDA = /try \{ if \(api && typeof api\.registrarGpsDoToque === 'function'\) api\.registrarGpsDoToque\(([^;]*)\); \} catch \(eGps\)/g;
  const achadas = [...fontePagina.matchAll(GUARDA)].map((m) => ({ args: m[1], i: m.index }));
  assert.equal(achadas.length, 3, 'as 3 chamadas, cada uma com try + typeof');
  assert.equal((fontePagina.match(/registrarGpsDoToque\(/g) || []).length, 3, 'nenhuma chamada sem a guarda');
  const antes = (i, marca) => { const j = fontePagina.lastIndexOf(marca, i); return j >= 0 && i - j < 1500; };
  const porArgs = (re) => achadas.find((a) => re.test(a.args));
  const principal = porArgs(/^rowsAlvo, act, tsDevice$/), p2done = porArgs(/^rowsA, 'done', tsA$/), p2nao = porArgs(/'fail', tsA$/);
  assert.ok(principal && p2done && p2nao, 'as 3 portas: principal, porta 2 Entregue, porta 2 Não entregue');
  assert.ok(antes(principal.i, 'else agendarEnvio();') && antes(principal.i, 'renderList();'), 'principal: depois do commit, da tela e do envio');
  assert.ok(antes(p2done.i, 'acompanharEnvio(ids);') && antes(p2done.i, 'await guardarRecebimento(marcacoes'), 'porta 2 Entregue: depois do commit');
  assert.ok(antes(p2nao.i, 'agendarEnvio();') && antes(p2nao.i, 'renderList();'), 'porta 2 Não entregue: depois do commit e da tela');
  assert.ok(!/await\s+api\.registrarGpsDoToque/.test(fontePagina), 'nunca com await');
  passou('G7 a tela chama nas 3 portas, depois do commit, com try e typeof, sem await');
}

await esperar(50);
assert.deepEqual(soltos, [], 'nenhuma promessa rejeitada solta');
passou('nenhum erro solto (unhandledRejection) em toda a régua');
console.log(`✅ ${n}/${n} conferências do GPS do toque`);
