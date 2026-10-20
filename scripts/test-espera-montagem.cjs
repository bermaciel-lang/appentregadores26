/* 20/10/2026 — A ESPERA DA MONTAGEM (core.js esperarMontagem / verificarMontagemEsperando).
 * Montagem pendente → quadro com a lista do que falta → pergunta `montagemPronta` (leve) → pronta → `verificarMontagem` (a de sempre) abre.
 * Sem sinal/painel ocupado = continua esperando; painel antigo = cai para verificarMontagem; Voltar = esperaCancelada; tela escondida não pergunta. */
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const store = () => { const m = new Map(); return { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function montar(respostas, opts = {}) {
  const localStorage = store(), sessionStorage = store(); sessionStorage.setItem('app_turno', 'MANHÃ');
  const chamadas = [];
  const cfg = { API_URL: '/api/painel/', API_MODE: 'json', API_TIMEOUT_MS: 1000, API_RETRY_COUNT: 0, STORAGE_DRIVER_KEY: 'driver', STORAGE_CACHE_PREFIX: 'cache_', CACHE_TTL_MS: 100000 };
  const quadro = { aberto: false, textos: [], fechado: false, cancelar: null };
  const doc = { visibilityState: opts.escondida ? 'hidden' : 'visible', addEventListener() {}, removeEventListener() {} };
  let dormidas = 0;
  const rapido = (fn, ms) => { if (ms >= 10000) { dormidas++; if (opts.voltarNa && dormidas === opts.voltarNa) quadro.cancelar(); if (opts.escondida && dormidas > 3) doc.visibilityState = 'visible'; } return setTimeout(fn, 0); };
  const ctx = { console, URL, Date, Intl, AbortController, localStorage, sessionStorage, setTimeout: rapido, clearTimeout, navigator: {}, document: doc, location: { search: '' } };
  ctx.window = { APP_CONFIG: cfg, location: { origin: 'https://teste', search: '' }, setTimeout: rapido, clearTimeout,
    AppUI: { esperar(c) { quadro.aberto = true; quadro.textos.push(c.mensagem); let r; const cancelado = new Promise(x => (r = x)); quadro.cancelar = () => r(true);
      return { atualizar(m) { if (m != null) quadro.textos.push(m); }, fechar() { quadro.fechado = true; }, cancelado }; } } };
  ctx.fetch = async (url) => { const a = new URL(url, 'https://teste').searchParams.get('action'); chamadas.push(a);
    const fila = respostas[a] || []; const r = fila.length > 1 ? fila.shift() : fila[0]; if (r === 'offline') throw Error('offline'); return { ok: true, json: async () => r }; };
  vm.runInNewContext(fs.readFileSync('public/assets/core.js', 'utf8'), ctx);
  const api = ctx.window.AppEntrega; api.saveDriverName('Camila'); localStorage.setItem('app_api_url_override', '/api/painel/');
  return { api, chamadas, quadro };
}
const BLOQ = { ok: false, montagemBloqueada: true, error: 'FINALIZE…', pendentes: [], faltaLista: ['Pedido de Maria (LOJA-1): falta finalizar', 'OVOS: falta tocar em FINALIZAR OVOS'] };
const OK = { ok: true, montagemVerificada: true, montagemBloqueada: false, rotaIniciada: false };
(async () => {
  let n = 0; const ok = (m) => console.log('PASS', ++n, m);
  { // 1. pendente → espera com a lista → pronta → abre
    const t = montar({ verificarMontagem: [BLOQ, OK], montagemPronta: [{ ok: true, montagemPronta: false, faltaLista: ['OVOS: falta tocar em FINALIZAR OVOS'] }, { ok: true, montagemPronta: true }] });
    const r = await t.api.verificarMontagemEsperando('Camila', false);
    assert.equal(r.montagemVerificada, true); assert.ok(t.quadro.fechado);
    assert.match(t.quadro.textos[0], /Maria \(LOJA-1\)/); assert.match(t.quadro.textos[0], /OVOS/);
    assert.ok(t.quadro.textos.some(x => /OVOS/.test(x) && !/Maria/.test(x)), 'a lista se atualiza');
    assert.deepEqual(t.chamadas, ['verificarMontagem', 'montagemPronta', 'montagemPronta', 'verificarMontagem']);
    ok('pendente → quadro com nomes → atualiza → pronta → conferência de sempre abre');
  }
  { // 2. pronta pela leve mas a de sempre ainda bloqueia → continua esperando
    const t = montar({ verificarMontagem: [BLOQ, BLOQ, OK], montagemPronta: [{ ok: true, montagemPronta: true }] });
    const r = await t.api.verificarMontagemEsperando('Camila', false);
    assert.equal(r.montagemVerificada, true); assert.equal(t.chamadas.filter(c => c === 'verificarMontagem').length, 3);
    const i1 = t.chamadas.indexOf('verificarMontagem', 1), i2 = t.chamadas.indexOf('verificarMontagem', i1 + 1);
    assert.equal(i2 - i1 - 1, 5, 'depois da recusa, 4 "pronta" ignorados antes de conferir de novo (sem martelar a pesada)');
    ok('a leitura leve NUNCA abre sozinha; depois de uma recusa, espera ~1 min antes de conferir de novo');
  }
  { // 3. sem sinal na leve → segue esperando
    const t = montar({ verificarMontagem: [BLOQ, OK], montagemPronta: ['offline', { ok: false, tentarDepois: true }, { ok: true, montagemPronta: true }] });
    await t.api.verificarMontagemEsperando('Camila', false);
    ok('sem sinal / painel ocupado = continua esperando, sem susto');
  }
  { // 4. painel antigo (sem o campo) → cai para verificarMontagem
    const t = montar({ verificarMontagem: [BLOQ, OK], montagemPronta: [{ ok: true }] });
    const r = await t.api.verificarMontagemEsperando('Camila', false);
    assert.equal(r.montagemVerificada, true); assert.deepEqual(t.chamadas, ['verificarMontagem', 'montagemPronta', 'verificarMontagem']);
    ok('painel sem montagemPronta: usa a conferência de sempre');
  }
  { // 5. Voltar
    const t = montar({ verificarMontagem: [BLOQ], montagemPronta: [{ ok: true, montagemPronta: false }] }, { voltarNa: 2 });
    await assert.rejects(() => t.api.verificarMontagemEsperando('Camila', false), e => e.esperaCancelada === true && e.montagemBloqueada === true);
    assert.ok(t.quadro.fechado);
    ok('Voltar fecha o quadro e devolve o bloqueio marcado esperaCancelada');
  }
  { // 6. tela escondida não pergunta
    const t = montar({ verificarMontagem: [BLOQ, OK], montagemPronta: [{ ok: true, montagemPronta: true }] }, { escondida: true });
    await t.api.verificarMontagemEsperando('Camila', false);
    assert.equal(t.chamadas.filter(c => c === 'montagemPronta').length, 1, 'só perguntou depois de a tela voltar');
    ok('com a tela apagada/no bolso não gasta internet nem banco');
  }
  { // 7. erro que não é bloqueio sai como antes (sem quadro)
    const t = montar({ verificarMontagem: ['offline'] });
    await assert.rejects(() => t.api.verificarMontagemEsperando('Camila', false), e => e.bloqueioMontagem && e.semResposta);
    assert.equal(t.quadro.aberto, false);
    ok('sem resposta no 1º toque: o aviso de sempre, sem quadro de espera');
  }
  { // 8. rota pronta: mesma chamada de antes, nenhum quadro
    const t = montar({ verificarMontagem: [OK] });
    await t.api.verificarMontagemEsperando('Camila', false);
    assert.deepEqual(t.chamadas, ['verificarMontagem']); assert.equal(t.quadro.aberto, false);
    ok('rota pronta: o caminho do dedo é o mesmo (1 chamada)');
  }
  console.log(`✅ ${n}/8 cenários da espera da montagem`);
})().catch(e => { console.error(e); process.exit(1); });
