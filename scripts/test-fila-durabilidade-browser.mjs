import fs from 'node:fs';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.PLAYWRIGHT_MODULE
  || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
const source = fs.readFileSync(new URL('../public/assets/fila-duravel.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    assert.equal(new URL(route.request().url()).origin, 'https://durabilidade.ficticia.invalid');
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Teste local fictício</title>' });
  });
  await context.addInitScript(() => {
    window.transacoes = [];
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, modo, options) {
      const tx = original.call(this, stores, modo, options);
      const registro = { modo, pedido: options?.durability ?? 'default', observado: tx.durability, completo: false };
      tx.addEventListener('complete', () => { registro.completo = true; });
      window.transacoes.push(registro);
      return tx;
    };
  });
  const page = await context.newPage();
  await page.goto('https://durabilidade.ficticia.invalid/');
  async function abrir() {
    await page.addScriptTag({ content: source });
    await page.evaluate(async () => {
      window.fila = FilaDuravel.criar({ nome: 'teste-durabilidade', chaveLegada: 'teste-legado' });
      await fila.pronta();
    });
  }
  await abrir();
  const primeiro = await page.evaluate(async () => {
    const ids = await fila.adicionar([1, 2].map(row => ({
      params: { action: 'confirmarPagamento', row, pg_valor: 99.9, ts_device: '2026-09-09T03:00:00Z' },
      meta: { row },
    })));
    const depoisDoLote = structuredClone(transacoes);
    await fila.ack(ids[0]);
    return { ids, depoisDoLote, depoisDoAck: structuredClone(transacoes), pendentes: await fila.ler() };
  });
  const escritas = primeiro.depoisDoAck.filter(x => x.modo === 'readwrite');
  assert.ok(escritas.length >= 2, 'lote e ACK precisam passar pela transação');
  assert.ok(escritas.every(x => x.pedido === 'strict' && x.observado === 'strict' && x.completo));
  assert.ok(primeiro.depoisDoLote.every(x => x.completo), 'nenhum retorno antes de complete');
  assert.ok(primeiro.depoisDoAck.filter(x => x.modo === 'readonly').every(x => x.pedido === 'default'));
  assert.deepEqual(primeiro.pendentes.map(x => x.id), primeiro.ids.slice(1));
  await page.reload();
  await abrir();
  assert.deepEqual(await page.evaluate(async () => (await fila.ler()).map(x => x.id)), primeiro.ids.slice(1));
  console.log('PASS IndexedDB nativo: readwrite strict, commit aguardado, ACK e lote preservados após reload');
  await context.close();
} finally {
  await browser.close();
}
