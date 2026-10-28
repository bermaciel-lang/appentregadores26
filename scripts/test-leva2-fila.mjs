// RÉGUA DA LEVA 2 (28/10/2026) — a FILA e o transporte. Código REAL (fila-duravel.js, core.js, funções de page-entregas.js) numa
// VM; IndexedDB, transporte e relógio fictícios. Roda: node scripts/test-leva2-fila.mjs
//
// O QUE ELA PROVA:
//   F1 porteiro fechado (rota não iniciada/republicada) trava SÓ a rota daquele item; as outras sobem (antes: `break` na fila
//      inteira, sempre no mesmo item — travada para sempre); e a tentativa conta no selo;
//   F2 o `confirmarPagamento` da parada travada pelo porteiro não passa na frente da marcação dela;
//   F3 `precisaLogin` trava só o entregador do token, e nada se perde;
//   F4 recusa de uma parada que SAIU da lista: guardada com quem era (cliente/pedido) e FORA da contagem de pendentes (antes:
//      sumia calada e travava o "fila esvaziou → recarrega");
//   F5 ACK recente fica por cima da lista pedida ANTES dele ("a tela volta atrás") e sai quando chega uma pedida depois;
//   F6 "rodar de novo": toque feito com o ciclo já no fim (reenviando o KM) sobe no mesmo processarFila;
//   F7 `confirmarPagamento` na fila: 20 s, sem tentativa interna (eram 45 s × 2);
//   F8 fechar o app: o keepalive leva também o pagamento, DEPOIS da resposta da marcação;
//   F9 lápides: as de mais de 3 dias saem, as recentes ficam, e a da fila antiga (`fila_v1`) NUNCA sai — sem ela, a fila antiga
//      ressuscitaria o ato; pendente e recusado nunca saem;
//   F10 localStorage cheio não derruba o toque (o cache é conforto; a fila é a fonte);
//   F11 login: o PIN vai no CORPO de um POST, nunca na URL; e não sobra caminho para a planilha antiga;
//   F12 contagem honesta do que ainda está só no aparelho (Finalizar/home).
import assert from 'node:assert/strict';
import { app, reguas, PREFIXO, copiar } from './_harness-leva2.mjs';

const { teste, rodar } = reguas('cenários da fila e do transporte (leva 2)');
const parada = (row, o = {}) => ({ row, numero: row, cliente: 'Cliente ' + row, pedido: 'LOJA-' + row, endereco: 'Rua ' + row, status: '', naEntrega: false, ...o });
const acao = (h, a, row, extra = {}) => h.api.enfileirar(Object.assign({ action: a, row, ts_device: '2026-10-28T12:00:00.000Z' }, extra), { row });

teste('F1 porteiro fechado trava só a ROTA daquele item; as outras sobem; a tentativa conta', async () => {
  const h = await app({ responder: async p => (p.turno === 'TARDE' && p.data === undefined && p.action === 'marcarEntregue')
    ? { ok: false, montagemBloqueada: true, error: 'Confira a montagem e inicie a rota antes de registrar entregas.' }
    : { ok: true } });
  // um toque de ONTEM, sem o dia carimbado, de uma rota da TARDE (o servidor procura a de hoje, ainda não iniciada)…
  await acao(h, 'marcarEntregue', 11, { turno: 'TARDE' });
  // …na frente das entregas de HOJE, da MANHÃ
  await acao(h, 'marcarEntregue', 21, { turno: 'MANHÃ', data: '2026-10-28' });
  await acao(h, 'iniciarEntrega', 22, { turno: 'MANHÃ', data: '2026-10-28' });
  for (let i = 0; i < 3; i++) await h.enviar();
  const de = r => h.calls.filter(c => Number(c.params.row) === r).length;
  assert.ok(de(21) >= 1 && de(22) >= 1, 'as entregas de hoje subiram (antes: presas atrás do item velho para sempre)');
  assert.deepEqual(h.fila().map(x => Number(x.params.row)), [11], 'só o item da rota fechada espera');
  assert.equal(h.fila()[0].precisaCorrigir, false, 'porteiro fechado não é recusa');
  assert.equal(h.api.filaStatusPendentes().size, 1);
  const p = h.api.filaStatusPendentes().get(11);
  assert.ok(p.tentativas >= 3, 'a tentativa conta (o selo passa a dizer "ainda não enviou")');
  assert.equal(de(11), 3, 'uma tentativa por ciclo, sem martelar');
});

teste('F2 o pagamento da parada travada pelo porteiro não passa na frente da marcação dela', async () => {
  const h = await app({ responder: async p => (p.action === 'marcarEntregue' && Number(p.row) === 31)
    ? { ok: false, montagemBloqueada: true, error: 'rota não iniciada' }
    : (p.action === 'confirmarPagamento' ? { ok: true, pagamento: { gravado: true } } : { ok: true }) });
  await acao(h, 'marcarEntregue', 31, { turno: 'MANHÃ' });
  await h.api.enfileirar(h.window.PgPorta.montarParams(31, '2026-10-28T12:00:00.000Z', { forma: 'dinheiro', valor: 10, digitado: true }, false), { row: 31 });
  await acao(h, 'marcarEntregue', 32, { turno: 'MANHÃ' }); // mesma rota: espera junto
  await h.api.enfileirar(h.window.PgPorta.montarParams(32, '2026-10-28T12:00:00.000Z', { forma: 'dinheiro', valor: 20, digitado: true }, false), { row: 32 });
  await h.enviar();
  assert.equal(h.calls.filter(c => c.params.action === 'confirmarPagamento').length, 0,
    'nenhuma declaração de dinheiro sobe antes da entrega da MESMA parada (31 nem 32)');
  assert.equal(h.fila().length, 4, 'nada se perde');
});

teste('F3 precisaLogin trava só o entregador do token; o outro sobe; nada se perde', async () => {
  const h = await app({ responder: async p => p.token === 'tok-ana' ? { ok: false, precisaLogin: true, error: 'x' } : { ok: true } });
  h.api.saveDriverName('Ana'); h.api.saveDriverToken('tok-ana', 'Ana');
  await acao(h, 'marcarEntregue', 41); await acao(h, 'marcarEntregue', 42);
  h.api.saveDriverName('Beto'); h.api.saveDriverToken('tok-beto', 'Beto');
  await acao(h, 'marcarEntregue', 43);
  await h.enviar();
  assert.equal(h.calls.filter(c => c.params.token === 'tok-ana').length, 1, 'a 1ª da Ana bate no porteiro; a 2ª nem vai');
  assert.equal(h.calls.filter(c => c.params.token === 'tok-beto').length, 1, 'o Beto sobe');
  assert.deepEqual(h.fila().map(x => Number(x.params.row)).sort(), [41, 42], 'as da Ana esperam o PIN dela');
});

teste('F4 recusa de parada que saiu da lista: guardada com quem era e fora da contagem de pendentes', async () => {
  const h = await app({ responder: async p => Number(p.row) === 51
    ? { ok: false, naoEncontrado: true, error: 'Entrega não encontrada: a rota foi refeita ou esta parada foi tirada da rota pelo escritório.' }
    : { ok: true } });
  h.state.items = [parada(51, { cliente: 'Maria Souza', pedido: 'LOJA-2851' }), parada(52)];
  h.escolher(([m, o, opc]) => /Confirmar entrega/.test((opc && opc.titulo) || '') ? 'maos' : null);
  h.semRede(true);
  await h.tocar('done', 51);
  await h.tocar('done', 52);
  h.semRede(false);
  await h.enviar();
  h.state.items = [parada(52, { status: 'Entregue' })]; // a lista nova não tem mais a 51 (foi para outro entregador)
  const p = h.api.filaStatusPendentes().get(51);
  assert.equal(p.recusado, true);
  assert.equal(p.cliente, 'Maria Souza', 'quem era a parada fica guardado no toque (a faixa do topo mostra)');
  assert.equal(p.pedido, 'LOJA-2851');
  assert.equal(h.api.filaRowsPendentes().size, 0, 'recusado não conta como pendente: o "fila esvaziou → recarrega" volta a funcionar');
  // o "Entendi" da faixa (data-act="okrecusa" com a row) descarta, mesmo sem cartão
  await h.tocar('okrecusa', 51);
  assert.equal(h.fila().length, 0);
});

teste('F5 ACK recente fica por cima da lista pedida ANTES dele e sai com a pedida depois', async () => {
  const h = await app();
  h.state.items = [parada(61), parada(62)];
  const listaVelha = [parada(61), parada(62)]; // um carregarTudo que leu o banco ANTES de o toque subir
  const pedidaAntes = h.api.proximaMarca();
  h.escolher(([m, o, opc]) => /Confirmar entrega/.test((opc && opc.titulo) || '') ? 'maos' : null);
  await h.tocar('start', 62);
  await h.enviar(); await h.assentar();
  assert.equal(h.fila().length, 0, 'subiu e saiu da fila');
  h.state.items = listaVelha; // a resposta velha chega e é aplicada (como `state.items = result.data`)
  h.api.esquecerAcksAte(pedidaAntes);
  assert.equal(h.statusNaTela(62), 'Indo para entrega', 'a resposta VELHA não desfaz na tela o que o servidor aceitou');
  const pedidaDepois = h.api.proximaMarca();
  h.state.items = [parada(61), parada(62, { status: 'Indo para entrega' })];
  h.api.esquecerAcksAte(pedidaDepois);
  assert.equal(h.api.acksRecentesDeStatus().size, 0, 'a lista pedida depois do ACK vale sozinha');
  h.state.items = [parada(61), parada(62, { status: '' })]; // o escritório desfez depois: a tela segue o servidor
  assert.equal(h.statusNaTela(62), '');
});

teste('F6 "rodar de novo": o toque feito durante o reenvio do KM sobe no mesmo processarFila', async () => {
  const store = new Map();
  store.ls = new Map([[PREFIXO + 'rota_pend_fim|Fictício', JSON.stringify({ action: 'finalizarRota', entregador: 'Fictício', kmFinal: 100, turno: 'MANHÃ', fotoBase64: '', ts_device: '2026-10-28T10:00:00.000Z' })]]);
  let soltar; const preso = new Promise(r => { soltar = r; });
  let chegou; const noKm = new Promise(r => { chegou = r; });
  const h = await app({ store, responder: async p => p.action === 'finalizarRota' ? (chegou(), await preso, { ok: true }) : { ok: true } });
  h.state.items = [parada(71)];
  h.escolher(([m, o, opc]) => /Confirmar entrega/.test((opc && opc.titulo) || '') ? 'maos' : null);
  const ciclo = h.enviar();          // fila vazia → vai direto ao reenvio do KM e fica preso nele
  await noKm;
  await h.tocar('done', 71);         // o toque chega com o ciclo JÁ no fim
  soltar();
  await ciclo;
  assert.ok(h.calls.some(c => c.params.action === 'marcarEntregue'), 'subiu no mesmo processarFila (antes: só no próximo gatilho)');
  assert.equal(h.fila().length, 0);
});

teste('F7 confirmarPagamento na fila: 20 s e uma tentativa por ciclo', async () => {
  const h = await app({ responder: async () => { throw Error('sem sinal'); } });
  await h.api.enfileirar(h.window.PgPorta.montarParams(81, '2026-10-28T12:00:00.000Z', { forma: 'dinheiro', valor: 10, digitado: true }, false), { row: 81 });
  h.transporte(async () => new Promise(() => {})); // pendurado: o orçamento é que decide
  const ciclo = h.enviar();
  await h.assentar();
  assert.ok(h.timeouts.includes(20000), 'orçamento de 20 s (era 45 s)');
  assert.ok(!h.timeouts.includes(45000));
  h.transporte(async () => { throw Error('sem sinal'); });
  void ciclo;
  const h2 = await app({ responder: async () => { throw Error('sem sinal'); } });
  await h2.api.enfileirar(h2.window.PgPorta.montarParams(82, '2026-10-28T12:00:00.000Z', { forma: 'dinheiro', valor: 10, digitado: true }, false), { row: 82 });
  await h2.enviar();
  assert.equal(h2.calls.length, 1, 'sem tentativa interna: a fila repete no próximo ciclo (eram 2 por ciclo)');
  assert.equal(h2.fila().length, 1, 'timeout não é ACK: continua guardado');
});

teste('F8 fechar o app: o keepalive leva o pagamento DEPOIS da resposta da marcação', async () => {
  const h = await app();
  h.semRede(true);
  await acao(h, 'marcarEntregue', 91);
  await h.api.enfileirar(h.window.PgPorta.montarParams(91, '2026-10-28T12:00:00.000Z', { forma: 'dinheiro', valor: 10, digitado: true }, false), { row: 91 });
  await acao(h, 'marcarEntregue', 92); await acao(h, 'desfazer', 92); // duas declarações de status: ordem não garantida → fica
  await h.assentar();
  const n = h.api.enviarPendentesNoFechamento();
  await h.assentar();
  const seq = h.keepalive.map(k => k.params.action + ':' + k.params.row);
  assert.deepEqual(seq, ['marcarEntregue:91', 'confirmarPagamento:91'], 'pagamento só depois da marcação; a row 92 fica para o consumidor serial');
  assert.ok(n >= 1);
  assert.equal(h.fila().length, 4, 'nenhum ack sem resposta do consumidor: tudo continua guardado');
  // e se a marcação NÃO respondeu ok, o pagamento não vai
  const h2 = await app({ responder: async p => p.action === 'marcarEntregue' ? { ok: false, error: 'boom' } : { ok: true } });
  h2.semRede(true);
  await acao(h2, 'marcarEntregue', 93);
  await h2.api.enfileirar(h2.window.PgPorta.montarParams(93, '2026-10-28T12:00:00.000Z', { forma: 'dinheiro', valor: 10, digitado: true }, false), { row: 93 });
  await h2.assentar();
  h2.api.enviarPendentesNoFechamento(); await h2.assentar();
  assert.deepEqual(h2.keepalive.map(k => k.params.action), ['marcarEntregue']);
});

teste('F9 lápides: velhas saem, recentes ficam, a da fila antiga nunca sai', async () => {
  const store = new Map();
  const legado = [{ id: 'legado-1', params: { action: 'marcarEntregue', row: 101 }, meta: { row: 101 }, ts: 1 }];
  store.ls = new Map([[PREFIXO + 'fila_v1', JSON.stringify(legado)]]);
  const h = await app({ store, inicio: '2026-10-20T12:00:00.000Z' });
  // o item da fila antiga foi importado; e mais dois atos de hoje (20/10)
  await acao(h, 'marcarEntregue', 102); await acao(h, 'marcarEntregue', 103);
  await h.enviar(); // os três sobem e viram lápide
  assert.equal(h.fila().length, 0);
  await acao(h, 'marcarEntregue', 104); // pendente (sem rede)
  h.semRede(true); await h.enviar();
  h.relogio.avancar(5 * 24 * 3600 * 1000); // 5 dias depois
  await acao(h, 'marcarEntregue', 105); h.semRede(false); await h.enviar(); // uma lápide RECENTE (ack hoje)
  const contar = () => new Promise((ok, erro) => {
    const r = store.idb.open(PREFIXO + 'fila_transacional_v1', 1);
    r.onsuccess = () => { const tx = r.result.transaction('itens'), req = tx.objectStore('itens').getAll();
      req.onsuccess = () => { ok(req.result.map(x => ({ id: x.id, estado: x.estado, row: x.params ? x.params.row : null }))); r.result.close(); }; };
    r.onerror = () => erro(r.error);
  });
  const antes = await contar();
  const r = await h.api.limparLapidesAntigas();
  const depois = await contar();
  assert.equal(r.apagadas, 2, 'as lápides de 5 dias (102 e 103) saíram: ' + JSON.stringify(r));
  assert.ok(depois.some(x => x.id === 'legado-1' && x.estado === 'ack'), 'a lápide do item da fila ANTIGA fica (protege da reimportação)');
  // ficam: a do legado e as duas confirmadas HOJE (a 104 ficou 5 dias pendente: a idade da lápide é a do ACK, não a do toque)
  assert.equal(depois.filter(x => x.estado === 'ack').length, 3, 'ficam: a do legado, a 104 (ACK de hoje) e a 105');
  assert.equal(antes.length - depois.length, r.apagadas);
  // a fila antiga continua no localStorage e NÃO ressuscita nada ao reabrir
  h.fechar();
  const reaberto = await app({ store, inicio: '2026-10-25T12:00:00.000Z' });
  assert.equal(reaberto.fila().length, 0, 'reabrir não reimporta o ato já confirmado da fila antiga');
  // pendente e recusado nunca saem
  reaberto.semRede(true);
  await acao(reaberto, 'marcarEntregue', 106);
  reaberto.relogio.avancar(10 * 24 * 3600 * 1000);
  await reaberto.api.limparLapidesAntigas();
  assert.deepEqual(reaberto.fila().map(x => Number(x.params.row)), [106], 'o pendente de 10 dias continua na fila');
});

teste('F10 localStorage cheio não derruba o toque', async () => {
  const h = await app();
  h.state.items = [parada(111)];
  h.escolher(([m, o, opc]) => /Confirmar entrega/.test((opc && opc.titulo) || '') ? 'maos' : null);
  const set = h.local.setItem;
  h.local.setItem = (k, v) => { if (String(k).indexOf(PREFIXO + 'entregas_') === 0) throw Object.assign(Error('QuotaExceededError'), { name: 'QuotaExceededError' }); return set(k, v); };
  h.ctx.localStorage.setItem = h.local.setItem;
  h.semRede(true);
  await h.tocar('done', 111);
  assert.equal(h.avisos.length, 0, 'nada de "Não foi possível concluir essa ação" para um toque guardado');
  assert.equal(h.statusNaTela(111), 'Entregue');
  assert.equal(h.fila().length, 1);
});

teste('F11 login: o PIN vai no corpo de um POST, nunca na URL', async () => {
  const h = await app({ responder: async p => p.action === 'login' ? { ok: true, token: 'tok-novo', nome: p.entregador } : { ok: true } });
  const r = await h.api.apiLogin('Ana', '1234');
  assert.equal(r.ok, true);
  const login = h.calls.find(c => c.params.action === 'login');
  assert.equal(login.metodo, 'POST');
  assert.doesNotMatch(login.url, /pin=|1234/, 'nada do PIN na URL');
  assert.equal(login.params.pin, '1234', 'o PIN vai no corpo');
  assert.equal(login.params.token, undefined, 'login nunca leva token');
  await h.api.apiGet({ action: 'loginAdmin', pin: '9999' });
  const adm = h.calls.find(c => c.params.action === 'loginAdmin');
  assert.equal(adm.metodo, 'POST', 'qualquer login, mesmo pelo apiGet, vai por POST');
  assert.doesNotMatch(adm.url, /9999/);
  assert.equal(typeof h.api.setAdminAuth, 'undefined', 'a senha local do /admin saiu');
  assert.equal(h.calls.some(c => /script\.google|api\/proxy/.test(c.url)), false);
});

teste('F12 contagem honesta do que ainda está só no aparelho', async () => {
  const store = new Map();
  store.ls = new Map([[PREFIXO + 'rota_pend_fim|Fictício', JSON.stringify({ action: 'finalizarRota', entregador: 'Fictício', kmFinal: 1, turno: 'MANHÃ', fotoBase64: 'x' })]]);
  const h = await app({ store, responder: async p => Number(p.row) === 122 ? { ok: false, naoEncontrado: true, error: 'fora' } : { ok: true } });
  h.semRede(true);
  await acao(h, 'marcarEntregue', 121); await acao(h, 'marcarEntregue', 122);
  let c = h.api.contarEnviosPendentes({ soDoAtivo: true });
  assert.deepEqual([c.fila, c.rota, c.total], [2, 1, 3]);
  h.semRede(false);
  h.transporte(async p => p.action === 'finalizarRota' ? { ok: false } : (Number(p.row) === 122 ? { ok: false, naoEncontrado: true, error: 'fora' } : { ok: true }));
  await h.enviar();
  c = h.api.contarEnviosPendentes({ soDoAtivo: true });
  assert.equal(c.fila, 0, 'recusado não conta como "falta enviar"');
  assert.equal(c.rota, 1, 'o KM/foto do fim ainda falta');
});

await rodar();
