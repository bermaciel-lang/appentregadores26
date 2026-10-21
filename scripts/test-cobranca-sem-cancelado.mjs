/* 21/10/2026 — caso Faní Moritz (rota do Luiz Fábio, 20/10): LOJA-2174 cancelado com o entregador na rua e refeito igual
 * (LOJA-2324); seguidos, mesmo cliente/endereço → MESMO número de parada (16). A cobrança somava os dois (R$ 233,70) e o
 * Entregue tentava marcar o cancelado. Régua: as irmãs da porta nunca incluem cancelado/saiu da rota. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const page = fs.readFileSync('public/assets/page-entregas.js', 'utf8');
const fn = (name) => { const m = page.match(new RegExp(String.raw`^  (?:async )?function ` + name + String.raw`\([^]*?^  }`, 'm')); assert.ok(m, 'função ausente: ' + name); return m[0]; };
const ctx = { console, window: {}, Intl, Date };
ctx.window = ctx;
ctx.APP_CONFIG = { API_URL: '/api/painel/', API_MODE: 'json', API_TIMEOUT_MS: 1000, API_RETRY_COUNT: 0, STORAGE_DRIVER_KEY: 'driver', STORAGE_CACHE_PREFIX: 'cache_', CACHE_TTL_MS: 1000 };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/assets/core.js', 'utf8').replace(/^﻿/, ''), Object.assign(ctx, {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: {}, document: {}, location: { search: '' }, setTimeout, clearTimeout, URL, AbortController,
}));
vm.runInContext(fs.readFileSync('public/assets/pagamento-porta.js', 'utf8'), ctx);
ctx.api = ctx.window.AppEntrega;
const irmasAtivas = vm.runInContext(fn('irmasAtivas') + '\nirmasAtivas', ctx);
const novo = { row: 16579, numero: 16, pedido: 'LOJA-2324', cliente: 'Faní Moritz', status: '', naEntrega: true, valor: 116.85 };
const cancelado = { row: 16468, numero: 16, pedido: 'LOJA-2174', cliente: 'Faní Moritz', status: 'Cancelado', naEntrega: true, valor: 116.85 };
const saiu = { ...cancelado, row: 9, status: 'Removida' };
const irma = { row: 17, numero: 16, pedido: 'LOJA-9', cliente: 'Faní Moritz', status: '', naEntrega: true, valor: 20 };
const J = (x) => JSON.parse(JSON.stringify(x)).map((y) => y.row);
let n = 0; const ok = (m) => console.log('PASS', ++n, m);
assert.deepEqual(J(irmasAtivas([novo, cancelado], novo)), [16579]); ok('cancelado com o mesmo número NÃO é irmã (Entregue/cobrança só do LOJA-2324)');
assert.deepEqual(J(irmasAtivas([novo, saiu, irma], novo)), [16579, 17]); ok('"saiu da minha rota" também não; irmã ativa continua junto');
assert.deepEqual(J(irmasAtivas([novo, cancelado], cancelado)), [16468]); ok('tocar no próprio cancelado: só ele (nunca arrasta o ativo)');
assert.deepEqual(J(irmasAtivas([{ ...novo, numero: null }, cancelado], { ...novo, numero: null })), [16579]); ok('sem número: só a própria');
const g = ctx.window.PgPorta.irmasNaPorta([novo, cancelado, saiu, irma]);
assert.deepEqual(J(g), [16579, 17]); ok('a soma da porta ignora cancelado/saiu da rota');
// a pergunta única mostra o valor certo
let texto = '';
await ctx.window.PgPorta.perguntarSimples({ item: novo, irmas: [novo, cancelado], cfg: { simples: true, opcoes: ['maquininha'] }, tsDevice: 't',
  ui: { escolher: async (m) => { texto = m; return null; } } });
assert.match(texto, /Valor do pedido: R\$\s?116,85/); assert.doesNotMatch(texto, /233/); ok('a pergunta diz "Valor do pedido: R$ 116,85" (antes: dos 2 pedidos, R$ 233,70)');
console.log(`✅ ${n}/6 cenários da cobrança sem pedido cancelado`);
