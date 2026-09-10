// Código real do core.js em VM; só fetch e storage são fictícios. Não faz chamada externa.
// node scripts/test-rota-offline.cjs
//
// Cobre os consertos de 09/09 (branch fix/foto-login-velocidade):
//  1) KM + foto NÃO se perdem quando a conferência da montagem fica sem resposta (sinal ruim).
//  2) `precisaLogin` limpa o token do aparelho e NUNCA vira mensagem de montagem.
//  3) Quando o fallback só-KM responde que a foto JÁ está no servidor, o pendente é limpo
//     (nada de reenviar a mesma foto 20x com a tela dizendo "não subiu" e "Foto ✅" ao mesmo tempo).
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

function harness() {
  const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
  const localStorage = store(), sessionStorage = store(); sessionStorage.setItem('app_turno', 'MANHÃ');
  const h = { localStorage, posts: 0, gets: [], modo: 'ok', respostas: {} };
  const cfg = { API_URL: '/api/painel/', POST_URL: '/api/painel/', API_MODE: 'json', API_TIMEOUT_MS: 1000, API_TIMEOUT_FOTO_MS: 1000, API_RETRY_COUNT: 0, STORAGE_DRIVER_KEY: 'driver', STORAGE_TOKEN_KEY: 'token', STORAGE_CACHE_PREFIX: 'cache_', CACHE_TTL_MS: 100000 };
  const ctx = { console, URL, Date, Intl, AbortController, localStorage, sessionStorage, setTimeout, clearTimeout, navigator: {}, document: {}, location: { search: '' } };
  ctx.window = { APP_CONFIG: cfg, location: { origin: 'https://teste', search: '' }, setTimeout, clearTimeout };
  // `modo`: 'ok' responde h.respostas[action]; 'offline' lança em tudo; 'foto-timeout' lança SÓ no
  // POST (a foto não sobe) e responde os GETs normalmente.
  ctx.fetch = async (url, opts) => {
    const ehPost = opts && opts.method === 'POST';
    if (ehPost) h.posts++;
    if (h.modo === 'offline') throw Error('offline');
    if (h.modo === 'foto-timeout' && ehPost) { const e = Error('timeout'); e.name = 'AbortError'; throw e; }
    const action = ehPost ? JSON.parse(opts.body).action : new URL(url, 'https://teste').searchParams.get('action');
    if (!ehPost) h.gets.push(action);
    const r = h.respostas[action] || h.respostas['*'] || { ok: true };
    return { ok: true, json: async () => (typeof r === 'function' ? r() : r) };
  };
  vm.runInNewContext(fs.readFileSync('public/assets/core.js', 'utf8'), ctx);
  h.api = ctx.window.AppEntrega;
  h.api.saveDriverName('Camila'); localStorage.setItem('app_api_url_override', '/api/painel/');
  h.pend = fase => JSON.parse(localStorage.getItem('cache_rota_pend_' + fase) || 'null');
  return h;
}
const OK_MONTAGEM = { ok: true, montagemVerificada: true, montagemBloqueada: false, rotaIniciada: false };
const BLOQUEADA = { ok: false, montagemBloqueada: true, error: 'FINALIZE', pendentes: [{ pedido: 'LOJA-1' }] };
const PRECISA_LOGIN = { ok: false, precisaLogin: true, error: 'Faça login com o PIN pra abrir a rota.' };

(async () => {
  // ---- 1) Sinal cai na conferência da montagem: KM + foto ficam SALVOS e o app não lança ----
  {
    const h = harness(); h.modo = 'offline';
    const res = await h.api.apiIniciarRota('Camila', 12345, 'FOTO-BASE64', 'image/jpeg');
    assert.equal(res.ok, true); assert.equal(res.pendenteEnvio, true);
    const p = h.pend('inicio');
    assert.ok(p, 'o payload precisa estar persistido');
    assert.equal(p.kmInicial, 12345); assert.equal(p.fotoBase64, 'FOTO-BASE64');
    assert.ok(!p.desistiu, 'sem resposta não é desistência: reenvia sozinho');
    // Voltou o sinal: o reenvio automático sobe o pendente e limpa.
    h.modo = 'ok'; h.respostas = { '*': { ok: true, rotaInfo: { fotoInicio: 'ok' } } };
    await h.api.reenviarRotaPendente();
    assert.equal(h.pend('inicio'), null, 'subiu inteiro → pendente limpo');
    console.log('PASS 1: montagem sem resposta não descarta KM/foto; reenvia quando a internet volta');
  }
  // ---- 1b) Bloqueio DE VERDADE continua parando ANTES de subir a foto (0 POST) ----
  {
    const h = harness(); h.respostas = { verificarMontagem: BLOQUEADA };
    await assert.rejects(() => h.api.apiIniciarRota('Camila', 10, 'FOTO'), /FINALIZE/);
    assert.equal(h.posts, 0, 'bloqueado não sobe foto à toa');
    assert.equal(h.pend('inicio').desistiu, true, 'bloqueado não fica reenviando sozinho');
    console.log('PASS 1b: montagem bloqueada continua parando sem gastar upload');
  }
  // ---- 2) precisaLogin limpa o token e não vira "montagem" ----
  {
    const h = harness(); h.api.saveDriverToken('tok-velho', 'Camila');
    assert.ok(h.api.getDriverTokenInfo(), 'token guardado antes');
    h.respostas = { entregas: PRECISA_LOGIN };
    await assert.rejects(() => h.api.carregarEntregasPorEntregador('Camila'), e => e.precisaLogin === true && !e.bloqueioMontagem && /PIN/.test(e.message));
    assert.equal(h.api.getDriverTokenInfo(), null, 'token inválido foi apagado → a home pede o PIN');
    h.api.saveDriverToken('tok-velho', 'Camila');
    h.respostas = { verificarMontagem: PRECISA_LOGIN };
    await assert.rejects(() => h.api.verificarMontagem('Camila'), e => e.precisaLogin === true && !e.bloqueioMontagem);
    assert.equal(h.api.getDriverTokenInfo(), null);
    // Mesmo com início confirmado hoje (permitirEmAndamento), precisaLogin NÃO abre pelo cache:
    // sem token o servidor recusa tudo, a única saída é o PIN.
    h.api.saveDriverToken('tok-velho', 'Camila');
    h.respostas = { verificarMontagem: { ...OK_MONTAGEM, rotaIniciada: true } };
    await h.api.verificarMontagem('Camila');
    h.respostas = { verificarMontagem: PRECISA_LOGIN };
    await assert.rejects(() => h.api.verificarMontagem('Camila'), e => e.precisaLogin === true);
    console.log('PASS 2: precisaLogin apaga o token e sai como erro de LOGIN, nunca de montagem');
  }
  // ---- 3) Foto já no servidor (POST subiu mas a resposta se perdeu): o fallback diz fotoInicio=ok → limpa ----
  {
    const h = harness(); h.modo = 'foto-timeout';
    h.respostas = { verificarMontagem: OK_MONTAGEM, iniciarRota: { ok: true, rotaIniciada: true, rotaInfo: { kmInicial: 10, fotoInicio: 'ok' } } };
    const res = await h.api.apiIniciarRota('Camila', 10, 'FOTO', 'image/jpeg');
    assert.equal(res.ok, true); assert.ok(!res.semFoto, 'servidor já tem a foto → não é "sem foto"');
    assert.equal(h.pend('inicio'), null, 'pendente limpo: nada a reenviar');
    // Mesmo cenário, mas o servidor NÃO tem a foto → continua pendente (comportamento antigo, certo).
    const h2 = harness(); h2.modo = 'foto-timeout';
    h2.respostas = { verificarMontagem: OK_MONTAGEM, iniciarRota: { ok: true, rotaIniciada: true, rotaInfo: { kmInicial: 10, fotoInicio: null } } };
    const res2 = await h2.api.apiIniciarRota('Camila', 10, 'FOTO', 'image/jpeg');
    assert.equal(res2.semFoto, true); assert.ok(h2.pend('inicio'), 'foto ainda não subiu → fica salva pra reenviar');
    // TROCAR a foto (o servidor já tinha uma ANTES): o "ok" do servidor é da foto velha, não prova
    // que a nova subiu → a nova continua pendente.
    const h3 = harness(); h3.modo = 'foto-timeout';
    h3.respostas = { verificarMontagem: { ...OK_MONTAGEM, rotaIniciada: true }, iniciarRota: { ok: true, rotaIniciada: true, rotaInfo: { fotoInicio: 'ok' } } };
    const res3 = await h3.api.apiIniciarRota('Camila', 10, 'FOTO-NOVA', 'image/jpeg', { jaTinhaFoto: true });
    assert.equal(res3.semFoto, true); assert.equal(h3.pend('inicio').fotoBase64, 'FOTO-NOVA');
    // Reconciliação pelo poll: o pendente "desistiu" de dias atrás some quando o servidor mostra a foto.
    const h4 = harness();
    h4.localStorage.setItem('cache_rota_pend_fim', JSON.stringify({ action: 'finalizarRota', fotoBase64: 'X', desistiu: true }));
    h4.api.reconciliarRotaPendente({ fotoInicio: null, fotoFim: 'ok' });
    assert.equal(h4.pend('fim'), null);
    h4.localStorage.setItem('cache_rota_pend_fim', JSON.stringify({ action: 'finalizarRota', fotoBase64: 'X', jaTinhaFoto: true }));
    h4.api.reconciliarRotaPendente({ fotoFim: 'ok' });
    assert.ok(h4.pend('fim'), 'troca de foto não é reconciliada pelo ok da foto antiga');
    console.log('PASS 3: foto que já está no servidor limpa o pendente; foto de verdade pendente continua salva');
  }
  console.log('PASS frontend: KM/foto sobrevivem a sinal ruim; precisaLogin pede PIN; sem reupload em loop');
})().catch(e => { console.error(e); process.exitCode = 1; });
