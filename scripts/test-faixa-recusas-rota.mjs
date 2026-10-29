// RÉGUA DE 29/10/2026 — A FAIXA VERMELHA DO TOPO SÓ MOSTRA RECUSA DA ROTA ABERTA. Roda: node scripts/test-faixa-recusas-rota.mjs
//
// O caso: às 07:22 o celular do Altacir abriu a rota da manhã com três avisos vermelhos — LOJA-750 (rota de 29/09) e LOJA-1592 /
// LOJA-1418 (rota de 12/10). Eram recusas ANTIGAS guardadas no aparelho; a faixa da leva 2 (28/10) mostrava toda recusa sem
// cartão, de qualquer dia. Código REAL (core.js + faixaRecusasSemCartao de page-entregas.js) na VM do harness da leva 2.
//
// O QUE ELA PROVA:
//   R1 recusa de outro DIA (com o dia carimbado, ou só pela hora do toque) não aparece na faixa;
//   R2 recusa de HOJE de outro TURNO não aparece na tela deste turno;
//   R3 recusa de HOJE, deste turno, de parada que saiu da lista CONTINUA aparecendo (é para ela que a faixa existe);
//   R4 a recusa antiga continua guardada e o "Entendi" segue descartando (nada some calado);
//   R5 core.js antigo em cache (sem `recusaDaRotaAtual`) não quebra a pintura: volta ao comportamento de antes.
import assert from 'node:assert/strict';
import { app, reguas } from './_harness-leva2.mjs';

const { teste, rodar } = reguas('faixa de recusas só da rota aberta (29/10)');
const recusaTudo = async () => ({ ok: false, naoEncontrado: true, error: 'Entrega não pertence a esta rota/turno.' });
const parada = (row, o = {}) => ({ row, numero: row, cliente: 'Cliente ' + row, pedido: 'LOJA-' + row, endereco: 'Rua ' + row, status: '', naEntrega: false, ...o });

async function cenario() {
  // relógio do harness: 28/10/2026 10:00 em Brasília (turno da MANHÃ)
  const h = await app({ responder: recusaTudo, extras: ['faixaRecusasSemCartao'] });
  const enf = (params, meta) => h.api.enfileirar(params, meta);
  await enf({ action: 'marcarEntregue', row: 14535, ts_device: '2026-09-29T16:40:04.801Z', turno: 'MANHÃ' }, { row: 14535, cliente: 'Fernanda', pedido: 'LOJA-750' }); // sem dia carimbado
  await enf({ action: 'marcarCancelado', row: 15690, ts_device: '2026-10-12T13:05:24.147Z', data: '2026-10-12', turno: 'MANHÃ' }, { row: 15690, pedido: 'LOJA-1592' });
  await enf({ action: 'marcarCancelado', row: 15691, ts_device: '2026-10-12T14:28:31.539Z', data: '2026-10-12', turno: 'MANHÃ' }, { row: 15691, pedido: 'LOJA-1418' });
  await enf({ action: 'marcarEntregue', row: 61, ts_device: '2026-10-28T12:00:00.000Z', data: '2026-10-28', turno: 'TARDE' }, { row: 61, pedido: 'LOJA-TARDE' });
  await enf({ action: 'marcarEntregue', row: 51, ts_device: '2026-10-28T12:30:00.000Z', data: '2026-10-28', turno: 'MANHÃ' }, { row: 51, cliente: 'Maria Souza', pedido: 'LOJA-2851' });
  await h.enviar();
  h.state.items = [parada(52)]; // a lista de hoje não tem nenhuma delas
  return h;
}

teste('R1–R3 a faixa mostra só a recusa de hoje, deste turno', async () => {
  const h = await cenario();
  const mapa = h.api.filaStatusPendentes();
  assert.equal([...mapa.values()].filter(p => p.recusado).length, 5, 'as cinco foram recusadas pelo servidor');
  const html = h.pagina.faixaRecusasSemCartao(h.vista());
  assert.match(html, /LOJA-2851/, 'R3 a de hoje, da manhã, que saiu da lista, aparece');
  for (const velho of ['LOJA-750', 'LOJA-1592', 'LOJA-1418']) assert.doesNotMatch(html, new RegExp(velho), 'R1 recusa antiga não aparece: ' + velho);
  assert.doesNotMatch(html, /LOJA-TARDE/, 'R2 recusa da tarde não aparece na tela da manhã');
  assert.equal(mapa.get(14535).dia, '2026-09-29', 'sem dia carimbado, vale o dia da hora do toque (em Brasília)');
  assert.equal(mapa.get(15690).dia, '2026-10-12');
});

teste('R4 a recusa antiga segue guardada e o "Entendi" descarta', async () => {
  const h = await cenario();
  assert.equal(h.fila().length, 5, 'nada foi apagado sozinho');
  await h.tocar('okrecusa', 15690);
  assert.deepEqual(h.fila().map(x => Number(x.params.row)).sort((a, b) => a - b), [51, 61, 14535, 15691]);
});

teste('R5 core.js antigo (sem recusaDaRotaAtual) não quebra a faixa', async () => {
  const h = await cenario();
  const original = h.api.recusaDaRotaAtual;
  try {
    delete h.api.recusaDaRotaAtual;
    const html = h.pagina.faixaRecusasSemCartao(h.vista());
    assert.match(html, /LOJA-2851/);
    assert.match(html, /LOJA-750/, 'sem a função nova, mostra como antes (sem erro)');
  } finally { h.api.recusaDaRotaAtual = original; }
});

await rodar();
