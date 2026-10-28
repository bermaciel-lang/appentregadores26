// RÉGUA DA LEVA 2 (28/10/2026) — irmãs da mesma porta, pergunta do pagamento pelo grupo, "Saiu da minha rota", Maps/Waze e os
// menores do Desfazer. Código REAL (core.js, fila-duravel.js, pagamento-porta.js, funções de page-entregas.js) numa VM; transporte
// e IndexedDB fictícios. Roda: node scripts/test-leva2-irmas.mjs   (APP_ASSETS_DIR=<dir> para medir outra cópia dos assets)
//
// O QUE ELA PROVA (achados confirmados pela revisão de 28/10):
//   I1 "Cliente não estava" na mesma porta NÃO vai junto no Entregue da irmã (antes: marcava os dois e somava "Valor dos 2");
//   I2 "Saiu da minha rota" tocado no aparelho pinta 'Não entregue', diz "Saiu da minha rota" e não vai junto;
//   I3 o "Saiu" do servidor novo ("Não entregue" + marcador) fica fora do grupo e da soma da porta;
//   I4 Desfazer: só as irmãs no MESMO status, com ts_device, e a observação do CLIENTE volta para o cartão;
//   I5 o grupo é RECALCULADO na hora de gravar (a irmã decidida com o diálogo aberto não vai por tabela);
//   I6 a pergunta do pagamento é decidida pelo GRUPO (A online + B na porta → pergunta e grava a de B, com pg_valor_visto);
//   I7 reposição/manual (rep:/manual:) nunca abre a pergunta do pagamento;
//   I8 Desfazer limpa a resposta de pagamento guardada (senão o "Manter" deixava a entrega refeita sem declaração);
//   I9 Maps/Waze só marcam "Indo" em parada PENDENTE com endereço (antes: num cartão Entregue, viravam "Indo");
//   I10 "Ainda não fui": desfaz só as irmãs em andamento, com ts_device.
import assert from 'node:assert/strict';
import { app, reguas } from './_harness-leva2.mjs';

const { teste, rodar } = reguas('cenários das irmãs, do pagamento pelo grupo e do Saiu da minha rota (leva 2)');
const SIMPLES = { perguntar: true, formas: [], simples: true, opcoes: ['maquininha', 'dinheiro', 'cheque', 'nao-pagou'] };
// Diálogos: "Como foi a entrega?" → mãos; pergunta do pagamento → dinheiro; "Não entregue" → conforme o cenário.
const respostas = (extra = {}) => ([msg, ops, opc]) => {
  const t = (opc && opc.titulo) || '';
  if (/Confirmar entrega/.test(t)) return 'maos';
  if (/te pagou/.test(t)) return 'dinheiro';
  if (/^Não entregue$/.test(t)) return extra.naoEntregue || 'fail';
  if (/^Desfazer$/.test(t)) return 'sim';
  if (/entrega em andamento/.test(t)) return extra.andamento || 'pend';
  return extra.padrao === undefined ? null : extra.padrao;
};
const parada = (row, o = {}) => ({ row, numero: 5, cliente: 'Cliente ' + row, pedido: 'LOJA-' + row, endereco: 'Rua A, ' + row, status: '', naEntrega: false, ...o });
const acoes = h => h.fila().map(x => x.params.action + ':' + x.params.row);

teste('I1 "Cliente não estava" na mesma porta NÃO vai junto no Entregue da irmã', async () => {
  const h = await app();
  h.state.items = [parada(1), parada(2, { status: 'Não entregue' })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('done', 1);
  assert.deepEqual(acoes(h), ['marcarEntregue:1'], 'só a tocada: a irmã já decidida não muda por tabela');
  assert.equal(h.statusNaTela(2), 'Não entregue');
});

teste('I2 "Saiu da minha rota" pinta Não entregue, mostra o nome tocado e não vai junto', async () => {
  const h = await app();
  h.state.items = [parada(1), parada(2)];
  h.escolher(respostas({ naoEntregue: 'cancel' }));
  h.semRede(true);
  await h.tocar('naoentregue', 2);
  const v2 = h.vista().find(x => x.row === 2);
  assert.equal(v2.status, 'Não entregue', 'era "Removida": o servidor novo grava Não entregue e mostra ↩ Desfazer');
  assert.equal(h.api.statusLabel(v2.status, v2), 'Saiu da minha rota');
  assert.equal(h.api.statusKey(v2.status), 'fail', 'statusKey fail = o cartão mostra o ↩ Desfazer');
  await h.tocar('done', 1);
  assert.deepEqual(acoes(h), ['marcarCancelado:2', 'marcarEntregue:1'], 'o Entregue da irmã não arrasta o que saiu da rota');
});

teste('I3 o "Saiu" do servidor novo fica fora do grupo e da soma da porta', async () => {
  const h = await app();
  h.state.pgCfg = SIMPLES;
  h.state.items = [parada(1, { naEntrega: true, valor: 50 }),
    parada(2, { naEntrega: true, valor: 30, status: 'Não entregue', observacaoPedido: 'Portão azul · Saiu da rota do entregador (removido do pagamento)' })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('done', 1);
  const pergunta = h.abertos.find(d => /te pagou/.test((d.opc && d.opc.titulo) || ''));
  assert.ok(pergunta, 'a pergunta do pagamento abriu');
  assert.match(pergunta.mensagem, /Valor do pedido: R\$\s?50,00/);
  assert.doesNotMatch(pergunta.mensagem, /2 pedidos|80,00/, 'nada de "Valor dos 2 pedidos: R$ 80,00"');
  assert.deepEqual(acoes(h), ['marcarEntregue:1', 'confirmarPagamento:1']);
});

teste('I4 Desfazer: só o mesmo status, com ts_device, e a observação do cliente volta', async () => {
  const h = await app();
  h.state.items = [parada(1, { observacaoPedido: 'Portão azul' }), parada(2, { observacaoPedido: 'Ap 101' }), parada(3, { status: 'Não entregue' })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('done', 1); // 1 e 2 (abertas) vão juntas; a 3 (decidida) fica
  assert.deepEqual(acoes(h), ['marcarEntregue:1', 'marcarEntregue:2']);
  assert.equal(h.state.items[0].observacaoPedido, 'Entregue em mãos', 'a nota do toque aparece no cartão (como antes)');
  await h.tocar('desfazer', 1);
  assert.deepEqual(acoes(h).slice(2), ['desfazer:1', 'desfazer:2'], 'desfaz as que foram juntas — nunca a "Não entregue"');
  const desf = h.fila().filter(x => x.params.action === 'desfazer');
  assert.ok(desf.every(x => typeof x.params.ts_device === 'string' && x.params.ts_device.length > 10), 'desfazer leva a hora do toque');
  assert.equal(h.statusNaTela(1), '');
  assert.equal(h.state.items[0].observacaoPedido, 'Portão azul', 'a observação do CLIENTE volta (antes: apagada)');
  assert.equal(h.state.items[1].observacaoPedido, 'Ap 101');
  assert.equal(h.statusNaTela(3), 'Não entregue');
});

teste('I5 o grupo é recalculado na hora de gravar', async () => {
  const h = await app();
  h.state.items = [parada(1), parada(2)];
  h.escolher(respostas());
  h.semRede(true);
  // Com o "Como foi a entrega?" aberto, a irmã é decidida (outra marcação, recarga, cancelamento…)
  h.aoDialogo(([msg, ops, opc]) => { if (/Confirmar entrega/.test((opc && opc.titulo) || '')) h.state.items[1].status = 'Não entregue'; });
  await h.tocar('done', 1);
  assert.deepEqual(acoes(h), ['marcarEntregue:1'], 'a irmã decidida no meio do diálogo não vai por tabela');
});

teste('I6 a pergunta do pagamento é decidida pelo GRUPO (A online, B na porta)', async () => {
  const h = await app();
  h.state.pgCfg = SIMPLES;
  h.state.items = [parada(1, { naEntrega: false, valor: 40 }), parada(2, { naEntrega: true, valor: 80 })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('done', 1);
  const pergunta = h.abertos.find(d => /te pagou/.test((d.opc && d.opc.titulo) || ''));
  assert.ok(pergunta, 'perguntou: há pedido pago na porta no grupo (antes: decidido só pela tocada, paga online)');
  assert.match(pergunta.mensagem, /Valor do pedido: R\$\s?80,00/);
  assert.deepEqual(acoes(h), ['marcarEntregue:1', 'marcarEntregue:2', 'confirmarPagamento:2']);
  const pg = h.fila().find(x => x.params.action === 'confirmarPagamento').params;
  assert.equal(pg.pg_forma, 'dinheiro');
  assert.equal(pg.pg_valor_visto, '80.00', 'manda o valor que o modal mostrou');
});

teste('I6b o modal avisa quando o valor não foi conferido agora', async () => {
  const h = await app();
  h.state.pgCfg = SIMPLES;
  h.state.items = [parada(1, { naEntrega: true, valor: 80, valorConferido: false })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('done', 1);
  const pergunta = h.abertos.find(d => /te pagou/.test((d.opc && d.opc.titulo) || ''));
  assert.match(pergunta.mensagem, /não conferido/i);
});

teste('I7 reposição/manual não abre a pergunta do pagamento', async () => {
  const h = await app();
  h.state.pgCfg = SIMPLES;
  h.state.items = [parada(1, { pedido: 'rep:12', naEntrega: true, valor: 0 }), parada(2, { pedido: 'manual:7', numero: 6, naEntrega: true })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('done', 1);
  await h.tocar('done', 2);
  assert.equal(h.abertos.filter(d => /te pagou/.test((d.opc && d.opc.titulo) || '')).length, 0, 'o servidor sempre recusaria');
  assert.deepEqual(acoes(h), ['marcarEntregue:1', 'marcarEntregue:2']);
});

teste('I8 Desfazer limpa a resposta de pagamento guardada', async () => {
  const h = await app();
  h.state.pgCfg = { perguntar: true, formas: [{ chave: 'dinheiro', rotulo: 'Dinheiro' }] };
  h.state.items = [parada(1, { naEntrega: true, valor: 95, status: 'Entregue', pgConfirmado: { forma: 'dinheiro', valor: 95, digitado: true } })];
  h.state.pgRespondido[1] = { forma: 'dinheiro', valor: 95, digitado: true };
  // uma declaração ainda na fila, ANTES do desfazer
  await h.api.enfileirar(h.window.PgPorta.montarParams(1, '2026-10-28T12:00:00.000Z', { forma: 'dinheiro', valor: 95, digitado: true }, false), { row: 1 });
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('desfazer', 1);
  assert.equal(h.state.pgRespondido[1], undefined, 'a resposta guardada na tela saiu');
  assert.equal(h.state.items[0].pgConfirmado, null, 'a do servidor (já anulada pelo desfazer) também');
  assert.equal(h.pagina.pgRespostaAnterior(1, h.state.items[0]), null, 'e a que ficou na fila ANTES do desfazer não vale mais');
});

teste('I9 Maps/Waze só marcam "Indo" em parada pendente com endereço', async () => {
  const h = await app();
  h.state.items = [parada(1, { status: 'Entregue', numero: 1 }), parada(2, { numero: 2 }), parada(3, { numero: 3, endereco: '' })];
  h.escolher(respostas());
  h.semRede(true);
  await h.tocar('maps', 1);
  assert.equal(h.statusNaTela(1), 'Entregue', 'abrir o mapa num cartão Entregue não o transforma em "Indo"');
  await h.tocar('waze', 2);
  assert.equal(h.statusNaTela(2), 'Indo para entrega', 'pendente com endereço: marca e abre');
  await h.tocar('maps', 3);
  assert.equal(h.statusNaTela(3), '', 'sem endereço: nada marcado');
  assert.deepEqual(acoes(h), ['iniciarEntrega:2']);
  assert.equal((h.ctx.mapasAbertos || []).length, 3, 'o mapa abre nos três casos');
});

teste('I10 "Ainda não fui" desfaz só as irmãs em andamento, com ts_device', async () => {
  const h = await app();
  h.state.items = [parada(1, { status: 'Indo para entrega', numero: 1, observacaoPedido: 'Casa amarela' }),
    parada(2, { status: 'Entregue', numero: 1 }), parada(3, { numero: 2 })];
  h.escolher(respostas({ andamento: 'pend' }));
  h.semRede(true);
  await h.tocar('start', 3);
  assert.deepEqual(acoes(h), ['desfazer:1', 'iniciarEntrega:3'], 'a irmã Entregue não é desfeita por tabela');
  assert.ok(h.fila()[0].params.ts_device, 'desfazer com a hora do toque');
  assert.equal(h.state.items[0].observacaoPedido, 'Casa amarela');
  assert.equal(h.statusNaTela(2), 'Entregue');
});

await rodar();
