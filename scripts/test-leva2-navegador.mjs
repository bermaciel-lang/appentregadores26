// RÉGUA DE NAVEGADOR DA LEVA 2 (28/10/2026) — a TELA de verdade (public/ servido num servidor local, Edge sem janela via
// Playwright), com a API do painel DUBLADA no próprio navegador (nada sai da máquina: tudo que não é 127.0.0.1 é abortado).
// Roda: node scripts/test-leva2-navegador.mjs   (PLAYWRIGHT_MODULE / PLAYWRIGHT_CHANNEL / APP_PUBLIC_DIR opcionais)
//
// O QUE ELA PROVA:
//   N1 toque duplo: o 2º toque que cai no diálogo recém-aberto (na 1ª opção) NÃO escolhe nada; depois de ~350 ms a opção vale;
//   N2 o aviso "PEDIDO CANCELADO NA RUA" não fecha com toque no fundo, e só conta como visto depois de aparecer;
//   N3 a recusa de uma parada que saiu da lista aparece numa faixa no topo, com o cliente, e o "Entendi" a tira;
//   N4 no máximo UMA pintura da lista por quadro (antes: várias seguidas no mesmo toque);
//   N5 rota começada hoje: a lista guardada aparece ANTES da resposta do servidor (antes: esqueleto até a rede responder);
//   N6 o chat não pergunta com a tela escondida e, fechado, pergunta a cada ~30 s (antes: a cada 8 s, sempre);
//   N7 chat: `cid` gerado no aparelho, mensagem repetida (mesmo id) não duplica, marca de lidas por entregador;
//   N8 a foto anexada no chat é reduzida no aparelho (antes subia crua e passava do limite de 4,5 MB da Vercel);
//   N9 `permissoes` só sobe quando muda (antes: a cada abertura da tela).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLICO = path.resolve(process.env.APP_PUBLIC_DIR || path.join(RAIZ, 'public'));
const runtime = process.env.PLAYWRIGHT_MODULE
  || path.resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
console.log('alvo=' + PUBLICO);

const tipos = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
const servidor = http.createServer((req, res) => {
  let p = path.join(PUBLICO, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(PUBLICO)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', tipos[path.extname(p)] || 'application/octet-stream');
  res.end(fs.readFileSync(p));
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + servidor.address().port;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });

const paradas = n => Array.from({ length: n }, (_, i) => ({ row: i + 1, numero: i + 1, pedido: 'LOJA-' + (i + 1), cliente: 'Cliente ' + (i + 1),
  endereco: 'Rua Teste, ' + (i + 1), status: '', naEntrega: false, produtos: [{ qtd: 1, nome: 'Alface' }] }));

async function abrir({ itens = paradas(5), respostaMarcar = () => ({ ok: true }), avisos = [], atrasoEntregas = 0, cache = null, relogio = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const api = { itens, avisos, respostaMarcar, chamadas: [], atrasoEntregas };
  await ctx.addInitScript(({ cache }) => {
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    localStorage.setItem('app_entregas_driver_name', 'Ana');
    localStorage.setItem('app_entregas_tokens_v2', JSON.stringify({ Ana: { token: 'tok-ana', em: Date.now() } }));
    localStorage.setItem('app_turno_v1_' + dia, 'MANHÃ');
    localStorage.setItem('montagem_inicio_confirmado_v1_' + dia + '_MANHÃ_Ana', '1');
    localStorage.setItem('app_atividade_v1_Ana', String(Date.now()));
    localStorage.setItem('app_dia_servidor_v1', dia);
    if (cache) localStorage.setItem('app_entregas_cache_v3_entregas_' + dia + '_MANHÃ_ana', JSON.stringify({ ts: Date.now(), value: cache }));
  }, { cache });
  await ctx.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== BASE) return route.abort();
    if (!u.pathname.startsWith('/api/')) return route.continue();
    const p = Object.fromEntries(u.searchParams);
    if (route.request().method() === 'POST') Object.assign(p, JSON.parse(route.request().postData() || '{}'));
    api.chamadas.push({ acao: p.action, row: p.row, em: Date.now(), cid: p.cid });
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/ping') return json({ ok: true });
    switch (p.action) {
      case 'entregas':
        if (api.atrasoEntregas) await new Promise(r => setTimeout(r, api.atrasoEntregas));
        return json({ ok: true, data: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()), items: api.itens,
          rotaIniciada: true, rotaFinalizada: false, rotaInfo: { kmInicial: 10, kmFinal: '', inicio: 'x', fim: null, fotoInicio: 'ok', fotoFim: null },
          perguntarPagamento: false, formasNaPorta: [] });
      case 'cancelamentos': return json({ ok: true, avisos: api.avisos });
      case 'mensagens': return json({ ok: true, mensagens: api.mensagens || [] });
      case 'enviarMensagem': return json({ ok: true, mensagem: { id: 900, autor: 'entregador:Ana', autorNome: 'Você', corpo: p.corpo } });
      case 'marcarEntregue': case 'iniciarEntrega': case 'marcarNaoEntregue': case 'marcarCancelado': case 'desfazer':
        return json(api.respostaMarcar(p));
      default: return json({ ok: true });
    }
  });
  const page = await ctx.newPage();
  if (relogio) await page.clock.install({ time: Date.now() });
  await page.goto(BASE + '/entregas/');
  return { ctx, page, api, fechar: () => ctx.close() };
}

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
const cartao = (page, cliente) => page.locator('article.dc', { hasText: cliente });

teste('N1 toque duplo: o 2º toque no diálogo recém-aberto não escolhe nada', async () => {
  const t = await abrir();
  try {
    const { page } = t;
    await cartao(page, 'Cliente 1').getByRole('button', { name: 'Entregue' }).first().waitFor();
    await cartao(page, 'Cliente 1').getByRole('button', { name: 'Entregue' }).first().click();
    // o diálogo acabou de abrir: o "2º toque" cai exatamente na 1ª opção, na mesma hora
    const caixa = await page.evaluate(() => { const b = document.querySelector('.app-modal-opcao'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(caixa.x, caixa.y);
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.app-modal-overlay.aberto .app-modal-opcao').count() > 0, true, 'o diálogo continua aberto: o toque duplo não escolheu "Entregue em mãos"');
    assert.equal(await page.locator('article.dc.feito', { hasText: 'Cliente 1' }).count(), 0, 'e nada foi marcado');
    await page.waitForTimeout(400);
    await page.locator('.app-modal-opcao').first().click();
    await page.locator('article.dc.feito', { hasText: 'Cliente 1' }).waitFor({ timeout: 3000 });
  } finally { await t.fechar(); }
});

teste('N2 o aviso de cancelado não fecha com toque no fundo e só conta como visto depois de aparecer', async () => {
  const t = await abrir({ avisos: [{ id: 2, pedido: 'LOJA-2', cliente: 'Cliente 2', canceladoEm: '2026-10-28T12:00:00Z' }] });
  try {
    const { page } = t;
    await page.getByText('PEDIDO CANCELADO NA RUA').waitFor({ timeout: 5000 });
    const visto = await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('cancelamento-entregador:')).length);
    assert.equal(visto, 1, 'visto = depois de aparecer');
    await page.waitForTimeout(400);
    await page.mouse.click(8, 8); // no fundo escuro, longe do cartão
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('PEDIDO CANCELADO NA RUA').count(), 1, 'o toque no fundo NÃO fecha o aviso');
    await page.getByRole('button', { name: 'Entendi' }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('PEDIDO CANCELADO NA RUA').count(), 0);
  } finally { await t.fechar(); }
});

teste('N3 recusa de parada que saiu da lista: faixa no topo com o cliente, e o Entendi tira', async () => {
  const t = await abrir({ respostaMarcar: p => Number(p.row) === 5
    ? { ok: false, naoEncontrado: true, error: 'Entrega não encontrada: a parada foi tirada da rota pelo escritório.' } : { ok: true } });
  try {
    const { page, api } = t;
    await cartao(page, 'Cliente 5').getByRole('button', { name: 'Entregue' }).first().click();
    await page.waitForTimeout(400);
    await page.locator('.app-modal-opcao').first().click(); // "Entregue em mãos"
    await page.locator('.dc-recusa').first().waitFor({ timeout: 5000 }); // a recusa no cartão
    api.itens = paradas(4); // a lista nova não tem a parada 5
    await page.locator('#btnRefresh').click();
    const faixa = page.locator('.recusas-sem-cartao');
    await faixa.waitFor({ timeout: 5000 });
    assert.match(await faixa.innerText(), /Cliente 5/, 'diz de quem era');
    await faixa.getByRole('button', { name: 'Entendi' }).click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.recusas-sem-cartao').count(), 0);
  } finally { await t.fechar(); }
});

teste('N4 no máximo uma pintura da lista por quadro', async () => {
  const itens = paradas(Number(process.env.LEVA2_PARADAS) || 5); itens[4].numero = 4; // a 4 e a 5 são a mesma porta
  const t = await abrir({ itens });
  try {
    const { page } = t;
    await cartao(page, 'Cliente 4').getByRole('button', { name: 'Entregue' }).first().waitFor();
    await page.evaluate(() => {
      window.__quadro = 0; window.__pinturas = {};
      const tique = () => { window.__quadro++; requestAnimationFrame(tique); }; requestAnimationFrame(tique);
      new MutationObserver(regs => { for (const r of regs) if (r.addedNodes.length) window.__pinturas[window.__quadro] = (window.__pinturas[window.__quadro] || 0) + 1; })
        .observe(document.getElementById('sectionsRoot'), { childList: true });
    });
    await cartao(page, 'Cliente 4').getByRole('button', { name: 'Entregue' }).first().click();
    await page.waitForTimeout(400);
    // do toque na opção até o cartão ficar verde, medido DENTRO da página (CPU 4× mais lenta, como um celular médio)
    const cdp = await t.ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const ms = await page.evaluate(() => new Promise(ok => {
      const t0 = performance.now();
      const mo = new MutationObserver(() => { if (document.querySelector('article.dc.feito')) { mo.disconnect(); ok(Math.round(performance.now() - t0)); } });
      mo.observe(document.getElementById('sectionsRoot'), { childList: true, subtree: true });
      document.querySelector('.app-modal-opcao').click();
    }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('   medido: toque → cartão verde em ' + ms + ' ms (CPU 4×)');
    await page.waitForTimeout(1500);
    const p = await page.evaluate(() => window.__pinturas);
    const max = Math.max(0, ...Object.values(p)), total = Object.values(p).reduce((a, b) => a + b, 0);
    console.log('   medido: ' + total + ' pinturas da lista no toque (máx ' + max + ' no mesmo quadro)');
    assert.ok(max <= 1, 'mais de uma pintura no mesmo quadro: ' + JSON.stringify(p));
  } finally { await t.fechar(); }
});

teste('N5 rota começada hoje: a lista guardada aparece antes da resposta do servidor', async () => {
  const t = await abrir({ cache: paradas(3), atrasoEntregas: 4000 });
  try {
    const { page } = t;
    const inicio = Date.now();
    await cartao(page, 'Cliente 2').waitFor({ timeout: 2500 });
    console.log('   medido: lista na tela em ' + (Date.now() - inicio) + ' ms com o servidor demorando 4000 ms');
  } finally { await t.fechar(); }
});

teste('N6 o chat não pergunta com a tela escondida; fechado, a cada ~30 s', async () => {
  const t = await abrir({ relogio: true });
  try {
    const { page, api } = t;
    // O relógio da página é fictício; a rede, não: depois de cada avanço, um respiro REAL para a consulta chegar à dublê.
    const andar = async ms => { await page.clock.runFor(ms); await page.waitForTimeout(400); };
    await andar(2000);
    const msgs = () => api.chamadas.filter(c => c.acao === 'mensagens').length;
    const base = msgs();
    assert.ok(base >= 1, 'a 1ª carga do chat aconteceu');
    await andar(25000);
    assert.equal(msgs() - base, 0, 'chat fechado: nada em 25 s (antes: a cada 8 s)');
    await andar(10000);
    assert.equal(msgs() - base, 1, 'e uma consulta por volta dos 30 s');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const escondida = msgs();
    await andar(120000);
    assert.equal(msgs() - escondida, 0, 'tela escondida: nenhuma consulta do chat em 2 min');
  } finally { await t.fechar(); }
});

teste('N7 chat: mensagem com id gerado no aparelho (cid), repetida não duplica, "lidas" por entregador', async () => {
  const t = await abrir();
  try {
    const { page, api } = t;
    const repetida = { id: 77, autor: 'central', autorNome: 'Central', corpo: 'Passe no CD' };
    api.mensagens = [repetida, repetida];
    await page.locator('#btnChatEnt').click();
    await page.locator('#chatEntLista').getByText('Passe no CD').first().waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#chatEntLista').getByText('Passe no CD').count(), 1, 'a mesma mensagem (mesmo id) aparece uma vez');
    await page.locator('#chatEntInput').fill('Chegando');
    await page.locator('#chatEntEnviar').click();
    await page.locator('#chatEntLista').getByText('Chegando').waitFor({ timeout: 5000 });
    const envio = api.chamadas.find(c => c.acao === 'enviarMensagem');
    assert.ok(envio && envio.cid && envio.cid.length >= 8, 'a mensagem leva o cid gerado no aparelho');
    const lidas = await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('app_entregas_chat_lastseen') === 0));
    assert.ok(lidas.includes('app_entregas_chat_lastseen|ana'), 'a marca de lidas é do entregador: ' + lidas.join(','));
  } finally { await t.fechar(); }
});

teste('N8 foto anexada no chat é reduzida antes de subir (cabe no limite da Vercel)', async () => {
  const t = await abrir();
  try {
    const { page } = t;
    const r = await page.evaluate(async () => {
      // "foto de câmera": 4000×3000 com ruído (comprime mal, como foto de verdade), JPEG de alta qualidade
      const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
      const g = c.getContext('2d'), img = g.createImageData(4000, 3000), d = img.data;
      let x = 12345; for (let i = 0; i < d.length; i += 4) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = x & 255; d[i + 1] = (x >> 8) & 255; d[i + 2] = (x >> 16) & 255; d[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.95));
      const file = new File([blob], 'foto.jpg', { type: 'image/jpeg' });
      const z = await window.AppEntrega.comprimirImagem(file, 1600, 0.7);
      return { cru: file.size, reduzida: z.bytes, tipo: z.mimeType };
    });
    console.log('   medido: foto de ' + Math.round(r.cru / 1024) + ' KB → ' + Math.round(r.reduzida / 1024) + ' KB (' + r.tipo + ')');
    assert.equal(r.tipo, 'image/jpeg');
    assert.ok(r.cru * 1.37 > 4.5 * 1024 * 1024, 'a foto crua NÃO caberia (é o defeito)');
    assert.ok(r.reduzida * 1.37 < 4.5 * 1024 * 1024, 'o corpo em base64 cabe nos 4,5 MB da Vercel');
    assert.ok(r.reduzida < r.cru / 3);
  } finally { await t.fechar(); }
});

teste('N9 permissões só sobem quando mudam (não a cada abertura)', async () => {
  const t = await abrir();
  try {
    const { page, api } = t;
    await page.waitForTimeout(1500);
    const n1 = api.chamadas.filter(c => c.acao === 'permissoes').length;
    await page.reload();
    await page.waitForTimeout(1500);
    const n2 = api.chamadas.filter(c => c.acao === 'permissoes').length;
    assert.equal(n1, 1, 'na 1ª abertura, conta');
    assert.equal(n2, 1, 'reabrir com as mesmas permissões não manda de novo');
  } finally { await t.fechar(); }
});

let falhas = 0;
try {
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('PASS ' + nome); }
    catch (e) { falhas++; console.log('FAIL ' + nome + '\n' + (e && e.stack || e)); }
  }
} finally { await browser.close(); await new Promise(r => servidor.close(r)); }
console.log((falhas ? '❌ ' : '✅ ') + (testes.length - falhas) + '/' + testes.length + ' cenários de navegador (leva 2)');
if (falhas) process.exitCode = 1;
