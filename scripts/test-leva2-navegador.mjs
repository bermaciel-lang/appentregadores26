// RÉGUA DE NAVEGADOR DA LEVA 2 (28/10/2026) — a TELA de verdade (public/ servido num servidor local, Edge sem janela via
// Playwright), com a API do painel DUBLADA no próprio navegador (nada sai da máquina: tudo que não é 127.0.0.1 é abortado).
// Roda: node scripts/test-leva2-navegador.mjs   (PLAYWRIGHT_MODULE / PLAYWRIGHT_CHANNEL / APP_PUBLIC_DIR opcionais)
//
// O QUE ELA PROVA:
//   N1 toque duplo: o 2º toque, no MESMO ponto do 1º, cai no diálogo recém-aberto e NÃO decide nada; depois de ~350 ms vale;
//   N1b (revisão) um toque rápido de propósito em OUTRO lugar do diálogo vale (antes: todo toque da janela era ignorado);
//   N2 o aviso "PEDIDO CANCELADO NA RUA" não fecha com toque no fundo nem com o Enter que chega junto (revisão), e só conta
//      como visto depois de aparecer;
//   N3 a recusa de uma parada que saiu da lista aparece numa faixa no topo, com o cliente, e o "Entendi" a tira;
//   N4 no máximo UMA pintura da lista por quadro (antes: várias seguidas no mesmo toque);
//   N5 rota começada hoje: a lista guardada aparece ANTES da resposta do servidor (antes: esqueleto até a rede responder);
//   N6 o chat não pergunta com a tela escondida e, fechado, pergunta a cada ~30 s (antes: a cada 8 s, sempre);
//   N7 chat: `cid` gerado no aparelho, mensagem repetida (mesmo id) não duplica, marca de lidas por entregador;
//   N8 a foto anexada no chat é reduzida no aparelho (antes subia crua e passava do limite de 4,5 MB da Vercel);
//   N9 `permissoes` só sobe quando muda (antes: a cada abertura da tela);
//   N7b (revisão) o reenvio à mão do chat depois de "Sem conexão" leva o MESMO cid (antes: um novo — a 1ª podia ter gravado);
//   N10 (revisão) o GPS não religa numa rota já finalizada (o fim lembrado no aparelho), liga na rota em andamento, e a recarga
//      que descobre o fim o desliga (antes: reabrir depois do fim religava o GPS e a notificação "Rota em andamento");
//   N11 (revisão) abrir a MANHÃ já finalizada ("Trocar turno") não desliga o GPS da TARDE em andamento (o id é por rota).
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

async function abrir({ itens = paradas(5), respostaMarcar = () => ({ ok: true }), avisos = [], atrasoEntregas = 0, cache = null, relogio = false,
  finalizada = false, fimLembrado = false, gpsNativo = false, antes = null, mensagens = [], turno = 'MANHÃ', fixarTurno = true,
  finalizadaPorTurno = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const api = { itens, avisos, respostaMarcar, chamadas: [], atrasoEntregas, rotaFinalizada: finalizada, falharEnvio: 0, mensagens, finalizadaPorTurno };
  // O plugin nativo do GPS dublado (rastreio.js usa `Capacitor.Plugins.BackgroundGeolocation` quando existe). Sem
  // `isNativePlatform`: o resto do app (porteiro de permissões, push, aviso de privacidade) continua achando que é o navegador.
  // Os ids contam no aparelho (localStorage): o rastreio nativo sobrevive à tela recarregada, como no Android.
  if (gpsNativo) await ctx.addInitScript(() => {
    window.__gps = { ligou: 0, desligou: [] };
    window.Capacitor = { Plugins: { BackgroundGeolocation: {
      addWatcher: () => { window.__gps.ligou++; const n = Number(localStorage.getItem('__gps_ids') || 0) + 1; localStorage.setItem('__gps_ids', String(n)); return Promise.resolve('w' + n); },
      removeWatcher: ({ id }) => { window.__gps.desligou.push(id); return Promise.resolve(); } } } };
  });
  if (antes) await ctx.addInitScript(antes); // roda antes de qualquer script da página
  await ctx.addInitScript(({ cache, fimLembrado, turno, fixarTurno }) => {
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    localStorage.setItem('app_entregas_driver_name', 'Ana');
    localStorage.setItem('app_entregas_tokens_v2', JSON.stringify({ Ana: { token: 'tok-ana', em: Date.now() } }));
    // `fixarTurno: false` = o turno só é posto na 1ª abertura (a régua troca o turno e recarrega, como o "Trocar turno")
    if (fixarTurno || !localStorage.getItem('app_turno_v1_' + dia)) localStorage.setItem('app_turno_v1_' + dia, turno);
    localStorage.setItem('montagem_inicio_confirmado_v1_' + dia + '_MANHÃ_Ana', '1');
    localStorage.setItem('app_atividade_v1_Ana', String(Date.now()));
    localStorage.setItem('app_dia_servidor_v1', dia);
    if (cache) localStorage.setItem('app_entregas_cache_v3_entregas_' + dia + '_MANHÃ_ana', JSON.stringify({ ts: Date.now(), value: cache }));
    // o fim da rota que o servidor confirmou fica no aparelho (o sessionStorage morre quando o Android mata o app)
    if (fimLembrado) localStorage.setItem('rota_fim_confirmado_v1_' + dia + '_MANHÃ_Ana', '1');
  }, { cache, fimLembrado, turno, fixarTurno });
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
        { const fin = api.finalizadaPorTurno ? !!api.finalizadaPorTurno[p.turno] : api.rotaFinalizada;
          return json({ ok: true, data: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()), items: api.itens,
            rotaIniciada: true, rotaFinalizada: fin,
            rotaInfo: { kmInicial: 10, kmFinal: fin ? 30 : '', inicio: 'x', fim: fin ? 'y' : null, fotoInicio: 'ok', fotoFim: fin ? 'ok' : null },
            perguntarPagamento: false, formasNaPorta: [] }); }
      case 'cancelamentos': return json({ ok: true, avisos: api.avisos });
      case 'mensagens': return json({ ok: true, mensagens: api.mensagens || [] });
      case 'enviarMensagem':
        if (api.falharEnvio > 0) { api.falharEnvio--; return route.abort(); } // sem sinal: o app mostra "Sem conexão"
        return json({ ok: true, mensagem: { id: 900, autor: 'entregador:Ana', autorNome: 'Você', corpo: p.corpo } });
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

// O ponto central do botão "Entregue" de um cartão, para tocar com o "dedo" do Playwright num lugar exato da tela. Mede com a
// tela parada (rede quieta: nenhuma faixa nova empurrando a lista) e confere que o ponto É o botão — senão o toque cairia em
// outra coisa (endereço → Maps) e a régua falharia por motivo nenhum.
async function pontoDoEntregue(page, cliente) {
  const botao = cartao(page, cliente).getByRole('button', { name: 'Entregue' }).first();
  await botao.waitFor();
  await page.waitForLoadState('networkidle').catch(() => {});
  await botao.scrollIntoViewIfNeeded();
  const b = await botao.boundingBox();
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const noPonto = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); const bt = el && el.closest('button'); return bt ? bt.textContent.trim() : String(el && el.className); }, p);
  assert.match(noPonto, /Entregue/, 'o ponto do 1º toque é o botão Entregue (achei: ' + noPonto + ')');
  return p;
}
// Marca, dentro da página, QUANDO o diálogo apareceu e quando cada clique chegou (para provar que o toque caiu na janela de 350 ms).
const relogioDoDialogo = (page) => page.evaluate(() => {
  window.__dialogoEm = null; window.__cliques = [];
  new MutationObserver((regs) => { for (const r of regs) for (const n of r.addedNodes) if (n.classList && n.classList.contains('app-modal-overlay') && window.__dialogoEm == null) window.__dialogoEm = performance.now(); })
    .observe(document.body, { childList: true });
  document.addEventListener('click', () => window.__cliques.push(performance.now()), true);
});

// (revisão da leva 2) O toque duplo de verdade: o 2º toque cai NO MESMO PONTO do 1º — no fundo do diálogo (= Cancelar) ou numa
// opção que estiver ali. Esse é ignorado. (Antes desta régua o "2º toque" era simulado direto na 1ª opção — e TODO toque da janela
// era ignorado, inclusive o de propósito em outro lugar: ver N1b.)
teste('N1 toque duplo: o 2º toque, no mesmo ponto, não decide nada no diálogo recém-aberto', async () => {
  const t = await abrir();
  try {
    const { page } = t;
    const p = await pontoDoEntregue(page, 'Cliente 1');
    await page.mouse.click(p.x, p.y); // abre o "Como foi a entrega?"
    await page.locator('.app-modal-overlay', { hasText: 'Como foi a entrega?' }).waitFor({ state: 'attached', timeout: 5000 });
    await page.mouse.click(p.x, p.y); // o 2º toque do dedo nervoso, no mesmo lugar
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.app-modal-overlay.aberto .app-modal-opcao').count() > 0, true, 'o diálogo continua aberto (o 2º toque não cancelou nem escolheu)');
    assert.equal(await page.locator('article.dc.feito', { hasText: 'Cliente 1' }).count(), 0, 'e nada foi marcado');
    await page.waitForTimeout(400);
    await page.locator('.app-modal-opcao').first().click();
    await page.locator('article.dc.feito', { hasText: 'Cliente 1' }).waitFor({ timeout: 3000 });
  } finally { await t.fechar(); }
});

teste('N1b toque rápido de propósito em outro lugar do diálogo vale (só o do mesmo ponto é ignorado)', async () => {
  const t = await abrir();
  try {
    const { page } = t;
    const p = await pontoDoEntregue(page, 'Cliente 1');
    await relogioDoDialogo(page);
    await page.mouse.click(p.x, p.y);
    await page.locator('.app-modal-overlay', { hasText: 'Como foi a entrega?' }).waitFor({ state: 'attached', timeout: 5000 });
    // a opção mais LONGE do ponto do 1º toque, tocada na hora (dentro dos 350 ms)
    const alvo = await page.evaluate(({ x, y }) => {
      let melhor = null;
      document.querySelectorAll('.app-modal-opcao').forEach((b) => {
        const r = b.getBoundingClientRect(), c = { x: r.x + r.width / 2, y: r.y + r.height / 2, texto: b.textContent };
        c.d = Math.hypot(c.x - x, c.y - y);
        if (!melhor || c.d > melhor.d) melhor = c;
      });
      return melhor;
    }, p);
    await page.mouse.click(alvo.x, alvo.y);
    const atraso = await page.evaluate(() => window.__cliques[window.__cliques.length - 1] - window.__dialogoEm);
    console.log('   medido: 2º toque ' + Math.round(atraso) + ' ms depois de o diálogo abrir, a ' + Math.round(alvo.d) + ' px do 1º');
    assert.ok(alvo.d > 60, 'a opção tocada está longe do 1º toque');
    assert.ok(atraso < 350, 'o toque caiu DENTRO da janela de 350 ms (senão a régua não prova nada)');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.app-modal-overlay.aberto', { hasText: 'Como foi a entrega?' }).count(), 0,
      'o toque rápido em outro lugar foi aceito ("' + alvo.texto + '") e o diálogo seguiu');
  } finally { await t.fechar(); }
});

teste('N2 o aviso de cancelado não fecha com toque no fundo nem com o Enter que chega junto, e só conta como visto depois de aparecer', async () => {
  const t = await abrir({ avisos: [{ id: 2, pedido: 'LOJA-2', cliente: 'Cliente 2', canceladoEm: '2026-10-28T12:00:00Z' }],
    // (revisão da leva 2) um Enter que chega JUNTO com o aviso (que abriu sozinho, sem toque) não o fecha sem ser lido
    antes: () => new MutationObserver((regs, mo) => {
      for (const r of regs) for (const n of r.addedNodes) if (n.classList && n.classList.contains('app-modal-overlay') && /CANCELADO NA RUA/.test(n.textContent)) {
        mo.disconnect(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); window.__enterDisparado = true;
      }
    }).observe(document, { childList: true, subtree: true }) });
  try {
    const { page } = t;
    await page.waitForFunction(() => window.__enterDisparado === true, null, { timeout: 5000 });
    await page.waitForTimeout(400); // o fechar tira o quadro do DOM em 180 ms
    assert.equal(await page.getByText('PEDIDO CANCELADO NA RUA').count(), 1, 'o Enter dentro da janela não fechou o aviso automático');
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
  // A mensagem já está no servidor quando o app abre (antes a régua a punha DEPOIS de abrir e disputava corrida com a 1ª
  // consulta do chat: quando a consulta perdia, o pop-up "Mensagem de Central" cobria o botão do chat e o clique travava).
  const repetida = { id: 77, autor: 'central', autorNome: 'Central', corpo: 'Passe no CD' };
  const t = await abrir({ mensagens: [repetida, repetida] });
  try {
    const { page, api } = t;
    await page.getByText('Toque para abrir e responder').click(); // o pop-up da mensagem nova abre a conversa
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

teste('N7b chat: o reenvio à mão depois de "Sem conexão" leva o MESMO cid', async () => {
  const t = await abrir();
  try {
    const { page, api } = t;
    await page.locator('#btnChatEnt').click();
    await page.locator('#chatEntInput').fill('Estou no portão');
    api.falharEnvio = 3; // as 3 tentativas da 1ª vez caem (sem sinal)
    await page.locator('#chatEntEnviar').click();
    await page.getByText('Sem conexão pra enviar agora.').waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Entendi' }).click();
    assert.equal(await page.locator('#chatEntInput').inputValue(), 'Estou no portão', 'o texto voltou ao campo');
    await page.locator('#chatEntEnviar').click(); // reenviar à mão
    await page.locator('#chatEntLista').getByText('Estou no portão').waitFor({ timeout: 5000 });
    const envios = api.chamadas.filter(c => c.acao === 'enviarMensagem');
    const cids = [...new Set(envios.map(c => c.cid))];
    assert.equal(envios.length, 4, '3 tentativas que caíram + o reenvio');
    assert.equal(cids.length, 1, 'todas com o mesmo cid (o servidor reconhece a repetição): ' + cids.join(', '));
  } finally { await t.fechar(); }
});

teste('N10 GPS: não religa numa rota já finalizada; liga na rota em andamento; a recarga que descobre o fim desliga', async () => {
  // a) finalizou, o Android matou o app e ele foi reaberto: o fim está lembrado no aparelho (o sessionStorage morreu)
  const a = await abrir({ gpsNativo: true, finalizada: true, fimLembrado: true });
  try {
    await a.page.waitForTimeout(1500);
    assert.equal(await a.page.evaluate(() => window.__gps.ligou), 0, 'rota finalizada: o GPS e a notificação "Rota em andamento" não religam');
  } finally { await a.fechar(); }
  // b) rota em andamento: liga ao abrir
  const b = await abrir({ gpsNativo: true });
  try {
    await b.page.waitForTimeout(1500);
    assert.equal(await b.page.evaluate(() => window.__gps.ligou), 1, 'rota em andamento: liga uma vez');
    // c) a rota foi finalizada em outro lugar (no painel, em outro aparelho): a recarga descobre e desliga
    b.api.rotaFinalizada = true;
    await b.page.locator('#btnRefresh').click();
    await b.page.waitForTimeout(1500);
    assert.deepEqual(await b.page.evaluate(() => window.__gps.desligou), ['w1'], 'a recarga que descobriu o fim desligou o rastreio');
    assert.equal(await b.page.evaluate(() => window.__gps.ligou), 1, 'e não religou');
  } finally { await b.fechar(); }
});

teste('N11 GPS: abrir a MANHÃ já finalizada ("Trocar turno") não desliga o GPS da TARDE em andamento', async () => {
  const t = await abrir({ gpsNativo: true, turno: 'TARDE', fixarTurno: false, finalizadaPorTurno: { 'MANHÃ': true, 'TARDE': false },
    antes: () => {
      const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      localStorage.setItem('montagem_inicio_confirmado_v1_' + dia + '_TARDE_Ana', '1');
      localStorage.setItem('rota_fim_confirmado_v1_' + dia + '_MANHÃ_Ana', '1'); // a MANHÃ acabou mais cedo
    } });
  try {
    const { page } = t;
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.__gps.ligou), 1, 'a TARDE em andamento ligou o GPS');
    await page.evaluate(() => localStorage.setItem('app_turno_v1_' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()), 'MANHÃ'));
    await page.reload(); // "Trocar turno": a tela da MANHÃ, já finalizada (o rastreio nativo da TARDE continua no Android)
    await page.waitForTimeout(1500);
    assert.deepEqual(await page.evaluate(() => window.__gps.desligou), [], 'o GPS da TARDE continua (antes: desligado ao abrir a MANHÃ finalizada)');
  } finally { await t.fechar(); }
});

let falhas = 0;
const so = process.env.LEVA2_SO ? new RegExp(process.env.LEVA2_SO) : null; // ex.: LEVA2_SO="^N(7|10)" roda só esses
if (so) testes.splice(0, testes.length, ...testes.filter(([nome]) => so.test(nome)));
try {
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('PASS ' + nome); }
    catch (e) { falhas++; console.log('FAIL ' + nome + '\n' + (e && e.stack || e)); }
  }
} finally { await browser.close(); await new Promise(r => servidor.close(r)); }
console.log((falhas ? '❌ ' : '✅ ') + (testes.length - falhas) + '/' + testes.length + ' cenários de navegador (leva 2)');
if (falhas) process.exitCode = 1;
