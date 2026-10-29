// MEDIDOR (não é régua) — o custo das lápides da fila ANTES e DEPOIS da faxina (leva 2, 28/10/2026). Base: o medidor de lápides
// da revisão de 28/10. Edge sem janela, origem fictícia (nada sai da máquina), CPU 4× mais lenta (aproxima um celular médio).
//   node scripts/medir-lapides-faxina.mjs [caminho/do/fila-duravel.js]
// Mede, com 20 mil lápides VELHAS (> 3 dias) + 300 recentes: ler() e adicionar() (o toque) antes; quanto a faxina leva e o PIOR
// toque durante ela (ela é em lotes: o toque não espera a faxina inteira); e ler()/adicionar() depois.
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.env.PLAYWRIGHT_MODULE
  || path.resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
const source = fs.readFileSync(process.argv[2] || path.join(raiz, 'public/assets/fila-duravel.js'), 'utf8');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'https://lapides.ficticia.invalid') return route.abort();
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>bancada</title>' });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto('https://lapides.ficticia.invalid/');
  await page.addScriptTag({ content: source });
  const VELHAS = 20000, RECENTES = 300;
  await page.evaluate(async ({ VELHAS, RECENTES }) => {
    window.fila = FilaDuravel.criar({ nome: 'fila-medida', chaveLegada: 'legado-medida' });
    await fila.pronta();
    const agora = Date.now(), dia = 864e5;
    await new Promise((ok, erro) => {
      const r = indexedDB.open('fila-medida', 1);
      r.onsuccess = () => {
        const db = r.result, tx = db.transaction(['itens', 'meta'], 'readwrite'), st = tx.objectStore('itens');
        for (let i = 1; i <= VELHAS + RECENTES; i++) {
          const ts = i <= VELHAS ? agora - 30 * dia + i * 60000 : agora - 3600e3 + i; // 30 dias atrás … 1 h atrás
          const assinatura = JSON.stringify({ meta: { obsAnterior: 'Indo para entrega', row: 900000 + i, statusAnterior: 'Indo para entrega' },
            params: { action: 'marcarEntregue', data: '2026-10-28', entregador: 'Fulano de Tal', obs: 'Entregue na portaria (recebido por: porteiro João)', row: 900000 + i, ts_device: new Date(ts).toISOString(), turno: 'MANHÃ' }, ts });
          st.put({ id: crypto.randomUUID(), ordem: i, assinatura, estado: 'ack', ts, ackEm: ts });
        }
        tx.objectStore('meta').put({ chave: 'sequencia', valor: VELHAS + RECENTES });
        tx.oncomplete = () => { db.close(); ok(); }; tx.onerror = () => erro(tx.error);
      };
      r.onerror = () => erro(r.error);
    });
  }, { VELHAS, RECENTES });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const medir = () => page.evaluate(async () => {
    const med = async fn => { const v = []; for (let i = 0; i < 5; i++) { const a = performance.now(); await fn(); v.push(performance.now() - a); } v.sort((x, y) => x - y); return Math.round(v[2]); };
    const ler = await med(() => fila.ler());
    const add = await med(() => fila.adicionar([{ params: { action: 'marcarEntregue', row: 1, obs: 'x', ts_device: new Date().toISOString() }, meta: { row: 1 } }]));
    return { ler, add };
  });
  const antes = await medir();
  console.log(`ANTES  (${VELHAS} lápides velhas + ${RECENTES} recentes): ler()=${antes.ler} ms · adicionar() (o toque)=${antes.add} ms`);
  const faxina = await page.evaluate(async () => {
    if (!fila.limparLapides) return null;
    let pior = 0, toques = 0, parar = false;
    const tocar = async () => { while (!parar) { const a = performance.now(); await fila.adicionar([{ params: { action: 'iniciarEntrega', row: 2, ts_device: new Date().toISOString() }, meta: { row: 2 } }]); pior = Math.max(pior, performance.now() - a); toques++; await new Promise(r => setTimeout(r, 30)); } };
    const t0 = performance.now();
    const toc = tocar();
    const r = await fila.limparLapides({ antesDe: Date.now() - 3 * 864e5 });
    const dur = performance.now() - t0;
    parar = true; await toc;
    return { apagadas: r.apagadas, lotes: r.lotes, ms: Math.round(dur), piorToque: Math.round(pior), toques };
  });
  if (!faxina) console.log('FAXINA: este fila-duravel.js não tem limparLapides (versão de antes)');
  else {
    console.log(`FAXINA: ${faxina.apagadas} lápides em ${faxina.lotes} lotes, ${faxina.ms} ms no total (em segundo plano); pior toque DURANTE a faxina: ${faxina.piorToque} ms (${faxina.toques} toques)`);
    const depois = await medir();
    console.log(`DEPOIS: ler()=${depois.ler} ms · adicionar() (o toque)=${depois.add} ms  [Edge, CPU 4×, mediana de 5]`);
  }
} finally { await browser.close(); }
