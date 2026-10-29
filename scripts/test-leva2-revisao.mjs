// RÉGUA DA REVISÃO INDEPENDENTE DA LEVA 2 (28/10/2026) — os achados da revisão, um por cenário, com o CÓDIGO REAL numa VM
// (core.js, fila-duravel.js, pagamento-porta.js, funções de page-entregas.js e page-home.js); transporte, IndexedDB e relógio
// fictícios. Roda: node scripts/test-leva2-revisao.mjs   (APP_ASSETS_DIR=<dir> mede outra cópia dos assets)
//
//   V1  (material 1) a recarga que DESCOBRE a rota finalizada desliga o GPS; a que descobre a rota iniciada (e não finalizada) liga;
//   V2  (material 2) "✏️ Trocar a foto": manda `trocarFoto=1` e só diz "Foto enviada" com `fotoTrocada: true` do servidor;
//   V3  (3) o modal do pagamento diz de qual pedido é o valor quando a parada tocada é a paga online;
//   V4  (4) a irmã que sai do grupo com o modal aberto: a resposta é descartada e a pergunta refeita com o grupo novo;
//   V5  (5) o timeout do pagamento não para o ciclo: trava só aquela parada e as outras sobem;
//   V7  (7) a home tenta de novo quando a internet volta (e agenda nova tentativa a cada ~30 s enquanto houver pendente);
//   V9  (9) Desfazer de "Não entregue" é um a um;
//   V10 (10) o cache guarda a lista que a TELA mostra (com o ACK recente por cima), não a crua de uma resposta velha;
//   V11 (11) o "anterior" guardado no toque vem da vista (com o ACK por cima), não de `state.items` cru;
//   V12 (12) quem espera o processarFila espera só a passada atual; poll/volta ao app pedem a lista sem esperar a fila travada;
//   V13 "Trocar a foto" com o início/fim AINDA pendente no aparelho troca só a foto dentro do pendente (KM e hora originais, sem
//       `trocarFoto`); antes regravava o pendente com KM vazio e a hora da troca;
//   V14 a foto trocada enquanto o pendente sobe não é apagada nem regravada por cima pelo envio em voo;
//   V15 a recarga com o FIM ainda pendente no aparelho não apaga a marca de "fim confirmado" (sem pendente, apaga como antes).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { app, reguas, ler } from './_harness-leva2.mjs';

const { teste, rodar } = reguas('cenários da revisão independente da leva 2');
const SIMPLES = { perguntar: true, formas: [], simples: true, opcoes: ['maquininha', 'dinheiro', 'cheque', 'nao-pagou'] };
const parada = (row, o = {}) => ({ row, numero: row, cliente: 'Cliente ' + row, pedido: 'LOJA-' + row, endereco: 'Rua ' + row, status: '', naEntrega: false, ...o });
const respostas = (extra = {}) => ([msg, ops, opc]) => {
  const t = (opc && opc.titulo) || '';
  if (/Confirmar entrega/.test(t)) return 'maos';
  if (/te pagou/.test(t)) return 'dinheiro';
  if (/^Desfazer$/.test(t)) return 'sim';
  return extra.padrao === undefined ? null : extra.padrao;
};
const acoes = h => h.fila().map(x => x.params.action + ':' + x.params.row);
const entregas = (o = {}) => ({ ok: true, data: '2026-10-28', items: o.items || [parada(1), parada(2)], rotaIniciada: true, rotaFinalizada: false,
  rotaInfo: { kmInicial: 10, kmFinal: '', inicio: 'x', fim: null, fotoInicio: 'ok', fotoFim: null }, ...o });
async function comRecarga(opc = {}) {
  const gps = { ligar: 0, parar: 0 };
  const h = await app({ ...opc, extras: ['umaRecarga', 'reenviarFoto', 'filaDepoisLista'], dubles: {
    recarga: { ultimaAplicada: 0 }, ligarRastreio: () => { gps.ligar++; }, pararRastreio: () => { gps.parar++; },
    pedirFotoObrigatoria: async () => ({ base64: 'FOTO_NOVA', mimeType: 'image/jpeg' }), ...(opc.dubles || {})
  } });
  return { h, gps };
}

teste('V1 a recarga que descobre a rota finalizada desliga o GPS; a que descobre iniciada liga', async () => {
  const a = await comRecarga({ responder: async p => p.action === 'entregas' ? entregas({ rotaFinalizada: true }) : { ok: true } });
  a.h.state.rotaIniciada = true; a.h.state.rotaFinalizada = false; // a rota estava em andamento nesta tela
  await a.h.pagina.umaRecarga(false, false);
  assert.equal(a.h.state.rotaFinalizada, true);
  assert.equal(a.gps.parar, 1, 'finalizada (no painel ou em outra tela): o GPS e a notificação "Rota em andamento" desligam');
  assert.equal(a.gps.ligar, 0);
  const b = await comRecarga({ responder: async p => p.action === 'entregas' ? entregas() : { ok: true } });
  b.h.state.rotaIniciada = false; b.h.state.rotaFinalizada = false;
  await b.h.pagina.umaRecarga(false, false);
  assert.equal(b.gps.ligar, 1, 'a recarga descobriu a rota iniciada: liga o GPS');
  const c = await comRecarga({ responder: async p => p.action === 'entregas' ? entregas({ rotaFinalizada: true }) : { ok: true } });
  c.h.state.rotaIniciada = false; c.h.state.rotaFinalizada = false;
  await c.h.pagina.umaRecarga(false, false);
  assert.equal(c.gps.ligar, 0, 'iniciada E finalizada: nunca liga');
});

teste('V2 "Trocar a foto": manda trocarFoto=1 e só diz "Foto enviada" com fotoTrocada do servidor', async () => {
  const atual = await comRecarga({ responder: async p => p.action === 'iniciarRota' ? { ...entregas(), ok: true } : { ok: true } });
  atual.h.state.rotaInfo = { kmInicial: 10 };
  await atual.h.pagina.reenviarFoto('inicio');
  const pedido = atual.h.calls.find(c => c.params.action === 'iniciarRota');
  assert.equal(String(pedido.params.trocarFoto), '1', 'a troca é pedida explicitamente');
  assert.equal(atual.h.avisos.some(a => /Foto enviada/.test(a.mensagem)), false, 'servidor atual (não troca): nunca diz que enviou');
  assert.ok(atual.h.avisos.some(a => /não confirmou a troca/.test(a.mensagem)), 'diz a verdade: avise o escritório');
  const novo = await comRecarga({ responder: async p => p.action === 'iniciarRota' ? { ...entregas(), ok: true, fotoTrocada: true } : { ok: true } });
  novo.h.state.rotaInfo = { kmInicial: 10 };
  await novo.h.pagina.reenviarFoto('inicio');
  assert.ok(novo.h.avisos.some(a => /Foto enviada/.test(a.mensagem)), 'servidor da leva 3 confirmou a troca: "Foto enviada ✅"');
});

teste('V3 o modal diz de qual pedido é o valor quando a tocada é a paga online', async () => {
  const h = await app();
  h.state.pgCfg = SIMPLES;
  h.state.items = [parada(1, { numero: 5, naEntrega: false, valor: 40 }), parada(2, { numero: 5, naEntrega: true, valor: 80 })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('done', 1);
  const pergunta = h.abertos.find(d => /te pagou/.test((d.opc && d.opc.titulo) || ''));
  assert.match(pergunta.mensagem, /Pedido LOJA-2 — o LOJA-1 é pago online/);
  assert.match(pergunta.mensagem, /R\$\s?80,00/);
});

teste('V4 irmã que sai do grupo com o modal aberto: descarta a resposta e pergunta de novo', async () => {
  const h = await app();
  h.state.pgCfg = SIMPLES;
  h.state.items = [parada(1, { numero: 5, naEntrega: true, valor: 30 }), parada(2, { numero: 5, naEntrega: true, valor: 70 })];
  h.escolher(respostas());
  let vezes = 0;
  h.aoDialogo(([msg, ops, opc]) => { // na 1ª pergunta do pagamento chega o cancelamento da LOJA-2 pelo poll
    if (/te pagou/.test((opc && opc.titulo) || '') && ++vezes === 1) h.state.items[1].status = 'Cancelado';
  });
  h.semRede(true);
  await h.tocar('done', 1);
  const perguntas = h.abertos.filter(d => /te pagou/.test((d.opc && d.opc.titulo) || ''));
  assert.equal(perguntas.length, 2, 'perguntou de novo com o grupo de agora');
  assert.match(perguntas[0].mensagem, /2 pedidos/);
  assert.match(perguntas[1].mensagem, /Valor do pedido: R\$\s?30,00/);
  assert.deepEqual(acoes(h), ['marcarEntregue:1', 'confirmarPagamento:1']);
});

teste('V5 o timeout do pagamento trava só aquela parada; as outras sobem', async () => {
  const h = await app({ responder: async p => { if (p.action === 'confirmarPagamento') throw Error('AbortError fictício (20 s)'); return { ok: true }; } });
  await h.api.enfileirar(h.window.PgPorta.montarParams(1, '2026-10-28T12:00:00.000Z', { forma: 'dinheiro', valor: 10, digitado: true }, false), { row: 1 });
  await h.api.enfileirar({ action: 'marcarEntregue', row: 1, ts_device: '2026-10-28T12:00:01.000Z' }, { row: 1 }); // da MESMA parada: espera
  await h.api.enfileirar({ action: 'marcarEntregue', row: 2, ts_device: '2026-10-28T12:00:02.000Z' }, { row: 2 });
  await h.enviar();
  assert.ok(h.calls.some(c => c.params.action === 'marcarEntregue' && Number(c.params.row) === 2), 'a outra parada subiu (antes: o ciclo parava no timeout)');
  assert.equal(h.calls.some(c => c.params.action === 'marcarEntregue' && Number(c.params.row) === 1), false, 'o que vem atrás na MESMA parada espera');
  const pg = h.fila().find(x => x.params.action === 'confirmarPagamento');
  assert.equal(String(pg.params.pg_fila), '1', 'guardado para reenvio');
});

teste('V7 a home tenta de novo quando a internet volta e agenda nova tentativa enquanto houver pendente', async () => {
  let rede = false;
  const h = await app({ responder: async p => { if (!rede && p.action === 'marcarEntregue') throw Error('sem sinal'); return p.action === 'entregadores' ? { ok: true, items: ['Fictício'] } : { ok: true }; } });
  await h.api.enfileirar({ action: 'marcarEntregue', row: 1, ts_device: '2026-10-28T12:00:00.000Z' }, { row: 1 });
  const ouvintes = {}, agendados = [];
  h.window.addEventListener = (tipo, fn) => { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); };
  h.window.setTimeout = (fn, ms) => { agendados.push(ms); if (ms < 5000) queueMicrotask(fn); return agendados.length; };
  h.window.clearTimeout = () => {};
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, textContent: '', innerHTML: '', querySelectorAll: () => [],
    parentNode: { insertBefore() {}, firstChild: null }, setAttribute() {} });
  const elementos = {};
  h.ctx.document = { getElementById: id => elementos[id] || (elementos[id] = el()), createElement: () => el(), visibilityState: 'visible',
    addEventListener: (tipo, fn) => { (ouvintes['doc:' + tipo] = ouvintes['doc:' + tipo] || []).push(fn); }, removeEventListener() {} };
  h.window.document = h.ctx.document;
  h.window.location.search = '?escolher=1'; h.ctx.location = h.window.location;
  vm.runInContext(ler('page-home.js'), h.ctx, { filename: 'page-home.js' });
  for (let i = 0; i < 6; i++) await h.assentar();
  assert.equal(h.fila().length, 1, 'sem sinal: continua guardado');
  assert.ok(agendados.includes(30000), 'enquanto houver pendente, agenda outra tentativa em ~30 s');
  rede = true;
  for (const fn of ouvintes.online || []) fn();
  for (let i = 0; i < 6; i++) await h.assentar();
  assert.ok((ouvintes.online || []).length >= 1, 'a home ouve a internet voltar');
  assert.equal(h.fila().length, 0, 'a internet voltou: subiu da home (antes: só na próxima abertura)');
});

teste('V9 Desfazer de "Não entregue" é um a um', async () => {
  const h = await app();
  h.state.items = [parada(1, { numero: 5, status: 'Não entregue' }), parada(2, { numero: 5, status: 'Não entregue' })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('desfazer', 1);
  assert.deepEqual(acoes(h), ['desfazer:1'], 'dois "Cliente não estava" marcados separados não voltam juntos');
});

teste('V10 o cache guarda a lista da TELA (com o ACK recente por cima)', async () => {
  let h;
  const r = await comRecarga({ responder: async p => {
    if (p.action === 'entregas') { await h.api.processarFila(); return entregas({ items: [parada(1), parada(2)] }); } // o ACK chega no meio do pedido
    return { ok: true };
  } });
  h = r.h;
  h.state.items = [parada(1), parada(2)];
  await h.api.enfileirar({ action: 'marcarEntregue', row: 1, obs: 'Entregue em mãos', ts_device: '2026-10-28T12:00:00.000Z' }, { row: 1 });
  await h.pagina.umaRecarga(false, false);
  assert.equal(h.statusNaTela(1), 'Entregue', 'na tela: o ACK por cima da lista pedida antes dele');
  const chave = Object.keys(Object.fromEntries(h.store.ls)).find(k => /entregas_\d{4}-\d{2}-\d{2}_/.test(k));
  const cache = JSON.parse(h.store.ls.get(chave)).value;
  assert.equal(cache.find(x => x.row === 1).status, 'Entregue', 'no cache também (antes: a lista crua, com a entrega como pendente)');
  assert.equal(cache.some(x => x._fila), false, 'sem os detalhes internos da fila');
});

teste('V11 o "anterior" guardado no toque vem da vista, com o ACK por cima', async () => {
  const h = await app();
  h.state.items = [parada(1), parada(2)];
  await h.api.enfileirar({ action: 'marcarEntregue', row: 1, obs: 'Entregue em mãos', ts_device: '2026-10-28T12:00:00.000Z' }, { row: 1 });
  await h.enviar(); // subiu (ACK recente em memória)
  h.state.items = [parada(1), parada(2)]; // uma lista velha por baixo (pedida antes do ACK)
  assert.equal(h.statusNaTela(1), 'Entregue');
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('desfazer', 1);
  const desf = h.fila().find(x => x.params.action === 'desfazer');
  assert.equal(desf.meta.statusAnterior, 'Entregue', 'se o Desfazer for recusado, a tela volta para o que o servidor tem (antes: "pendente")');
});

teste('V12 quem espera o processarFila espera só a passada atual; a lista não espera a fila travada', async () => {
  const store = new Map();
  let soltar; const preso = new Promise(r => { soltar = r; });
  let chegou; const noKm = new Promise(r => { chegou = r; });
  const h = await app({ store, responder: async p => {
    if (p.action === 'finalizarRota') { chegou(); await preso; return { ok: true }; }
    if (p.action === 'marcarEntregue') return new Promise(() => {}); // a volta extra fica pendurada para sempre
    return { ok: true };
  } });
  h.local.setItem('leva2_rota_pend_fim|Fictício', JSON.stringify({ action: 'finalizarRota', entregador: 'Fictício', kmFinal: 1, turno: 'MANHÃ', fotoBase64: '' }));
  const primeira = h.enviar(); await noKm;
  await h.api.enfileirar({ action: 'marcarEntregue', row: 9, ts_device: '2026-10-28T12:00:00.000Z' }, { row: 9 });
  const esperando = h.api.processarFila(); // o "Corrigir pagamento" esperando, com a passada 1 no fim
  soltar();
  // com prazo de verdade: no código de antes a promessa só resolvia depois da volta extra (pendurada para sempre)
  const quem = await Promise.race([Promise.all([primeira, esperando]).then(() => 'voltou'), new Promise(r => setTimeout(() => r('travou'), 1500))]);
  assert.equal(quem, 'voltou', 'resolve no fim da passada atual, sem esperar a volta extra (pendurada)');
  // poll/volta ao app: a fila está pendurada e mesmo assim a lista é pedida (com prazo)
  let pedidas = 0;
  h.ctx.carregarTudo = () => { pedidas++; };
  const g = await comRecarga({ responder: async p => p.action === 'marcarEntregue' ? new Promise(() => {}) : { ok: true }, dubles: { carregarTudo: () => { pedidas++; } } });
  await g.h.api.enfileirar({ action: 'marcarEntregue', row: 3, ts_device: '2026-10-28T12:00:00.000Z' }, { row: 3 });
  await Promise.race([g.h.pagina.filaDepoisLista(), new Promise(r => setTimeout(r, 1500))]);
  assert.equal(pedidas, 1, 'a lista foi pedida mesmo com a fila travada (antes: esperava a fila inteira)');
});

const T0 = '2026-10-28T09:00:00.000Z'; // a hora do toque original no Iniciar/Finalizar
const pendente = (fase, o = {}) => ({ action: fase === 'inicio' ? 'iniciarRota' : 'finalizarRota', entregador: 'Fictício',
  [fase === 'inicio' ? 'kmInicial' : 'kmFinal']: 4321, turno: 'MANHÃ', data: '2026-10-28', fotoBase64: 'FOTO_VELHA',
  fotoMimeType: 'image/jpeg', ts_device: T0, ...o });
const chavePend = fase => 'leva2_rota_pend_' + fase + '|Fictício';

teste('V13 "Trocar a foto" com a etapa AINDA pendente: só a foto muda no pendente (KM e hora originais, sem trocarFoto)', async () => {
  for (const fase of ['inicio', 'fim']) {
    const km = fase === 'inicio' ? 'kmInicial' : 'kmFinal';
    const { h } = await comRecarga();
    h.semRede(true); // sem sinal: o pendente não sobe agora
    h.local.setItem(chavePend(fase), JSON.stringify(pendente(fase)));
    h.state.rotaInfo = {}; // o servidor ainda não tem a etapa: a tela não sabe o KM
    await Promise.race([h.pagina.reenviarFoto(fase), new Promise(r => setTimeout(r, 1500))]);
    const p = JSON.parse(h.local.getItem(chavePend(fase)));
    assert.equal(p.fotoBase64, 'FOTO_NOVA', fase + ': a foto nova ficou no pendente');
    assert.equal(p[km], 4321, fase + ': o KM digitado continua (antes: vazio)');
    assert.equal(p.ts_device, T0, fase + ': a hora do toque continua a original (antes: a hora da troca)');
    assert.equal(p.trocarFoto, undefined, fase + ': sem trocarFoto (o servidor ainda não tem a etapa)');
    assert.ok(h.avisos.some(a => /Foto trocada/.test(a.mensagem)), fase + ': diz que trocou no aparelho');
  }
});

teste('V14 a foto trocada enquanto o pendente sobe não é apagada nem regravada por cima pelo envio em voo', async () => {
  for (const resultado of ['falha', 'gravou']) {
    let soltar; const preso = new Promise(r => { soltar = r; });
    let chegou; const noEnvio = new Promise(r => { chegou = r; });
    const { h } = await comRecarga({ responder: async p => {
      if (p.action !== 'iniciarRota') return { ok: true };
      chegou(); await preso;
      if (resultado === 'falha') throw Error('caiu a conexão');
      return { ok: true, rotaInfo: { fotoConfirma: true, fotoInicio: 'ok' } }; // a etapa entrou com a foto que ESTE envio levava
    } });
    h.local.setItem(chavePend('inicio'), JSON.stringify(pendente('inicio')));
    const envio = h.enviar(); await noEnvio; // o pendente (com a foto velha) está subindo
    h.state.rotaInfo = {};
    await Promise.race([h.pagina.reenviarFoto('inicio'), new Promise(r => setTimeout(r, 1500))]); // trocou com o envio voando
    soltar(); await envio;
    for (let i = 0; i < 4; i++) { await h.api.processarFila(); await h.assentar(); }
    const p = JSON.parse(h.local.getItem(chavePend('inicio')) || 'null');
    if (resultado === 'falha') {
      assert.ok(p && p.fotoBase64 === 'FOTO_NOVA', 'falhou: o pendente continua com a foto NOVA (o envio em voo não regravou a velha)');
      assert.equal(p.kmInicial, 4321); assert.equal(p.ts_device, T0);
    } else {
      // a nova sobe como TROCA, com o KM e a hora originais (ou ainda está guardada assim, esperando a vez)
      const troca = h.calls.find(c => c.params.action === 'iniciarRota' && c.params.fotoBase64 === 'FOTO_NOVA');
      const comoTroca = x => x && String(x.trocarFoto) === '1' && Number(x.kmInicial) === 4321 && x.ts_device === T0;
      assert.ok(comoTroca(troca && troca.params) || (p && p.fotoBase64 === 'FOTO_NOVA' && comoTroca(p)),
        'gravou com a foto velha: a nova não é apagada — sobe como troca, com KM e hora originais');
    }
  }
});

teste('V15 a recarga com o FIM ainda pendente no aparelho não apaga a marca de "fim confirmado"', async () => {
  const { h, gps } = await comRecarga({ responder: async p => p.action === 'entregas' ? entregas({ rotaFinalizada: false }) : { ok: true } });
  h.local.setItem(chavePend('fim'), JSON.stringify(pendente('fim'))); // finalizou sem sinal: o fim ainda não subiu
  h.api.guardarFimConfirmado('Fictício', true);
  h.state.rotaIniciada = true; h.state.rotaFinalizada = true;
  await h.pagina.umaRecarga(false, false);
  assert.equal(h.api.fimConfirmado('Fictício'), true, 'a marca continua (antes: apagada — com o app morto nessa janela, GPS e notificação voltavam)');
  assert.equal(h.state.rotaFinalizada, true);
  assert.equal(gps.ligar, 0, 'e o GPS não religa');
  // sem pendente, o servidor dizendo "não finalizada" (o escritório reabriu a rota) apaga como antes
  h.local.removeItem(chavePend('fim'));
  await h.pagina.umaRecarga(false, false);
  assert.equal(h.api.fimConfirmado('Fictício'), false, 'sem pendente, o "não finalizada" do servidor vale');
});

await rodar();
