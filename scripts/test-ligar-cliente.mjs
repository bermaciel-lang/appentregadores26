// RÉGUA DO BOTÃO "LIGAR" (05/11/2026) — o toque no Ligar do cartão aberto, com o CÓDIGO REAL de page-entregas.js numa VM
// (harness da leva 2: transporte, IndexedDB e relógio fictícios; `openSameTab` dublado grava o endereço que o app abriria).
// Roda: node scripts/test-ligar-cliente.mjs   (APP_ASSETS_DIR=<dir> mede outra cópia dos assets)
//
// POR QUE: o painel manda o telefone como está no pedido — em 05/11/2026, 674 de 682 paradas dos últimos 7 dias tinham 11 dígitos
// (DDD + número, sem o 55). O app discava `tel:31999990001`: sem o 0 + código da operadora, isso só completa quando o chip do
// entregador é do MESMO DDD do cliente. Com `+55` na frente (formato internacional) a ligação completa de qualquer chip para
// qualquer DDD — é o formato que a agenda do celular e o WhatsApp usam.
//
//   L1 DDD + celular (11 dígitos), com ou sem máscara → tel:+55…;
//   L2 já com 55 (12/13 dígitos) ou com "+" → não duplica o 55;
//   L3 fixo com DDD (10 dígitos) → tel:+55…;
//   L4 número sem DDD (8/9 dígitos) ou começando com 0 vai como veio (o discador mostra e o entregador decide);
//   L5 sem telefone: avisa e não abre nada; o Ligar não marca status nem grava nada na fila.
import assert from 'node:assert/strict';
import { app, reguas, ler } from './_harness-leva2.mjs';

const { teste, rodar } = reguas('cenários do botão Ligar');
// A função nova entra na VM só se existir — assim a régua roda (e REPROVA pelo número discado) na cópia antiga dos assets.
const extras = /\n  function telParaLigar\(/.test(ler('page-entregas.js')) ? ['telParaLigar'] : [];
const parada = (row, telefone) => ({ row, numero: row, cliente: 'Cliente ' + row, pedido: 'LOJA-' + row, endereco: 'Rua ' + row, status: '', naEntrega: false, telefone });

async function ligar(telefone) {
  const h = await app({ extras });
  h.state.items = [parada(1, telefone)];
  await h.tocar('ligar', 1);
  await h.assentar();
  return { h, abertos: h.ctx.mapasAbertos || [] };
}

teste('L1 DDD + celular (11 dígitos), com ou sem máscara, disca com +55', async () => {
  for (const bruto of ['31999990001', '(31) 99999-0001', '31 9 9999-0001', ' 31.99999.0001 ']) {
    const { abertos } = await ligar(bruto);
    assert.deepEqual(abertos, ['tel:+5531999990001'], 'telefone "' + bruto + '"');
  }
  const { abertos } = await ligar('11987654321'); // cliente de outro DDD: é o caso que não completava sem o +55
  assert.deepEqual(abertos, ['tel:+5511987654321']);
});

teste('L2 já com 55 ou com "+" não duplica o 55', async () => {
  for (const [bruto, esperado] of [['5531999990001', 'tel:+5531999990001'], ['+55 (31) 99999-0001', 'tel:+5531999990001'],
    ['553133334444', 'tel:+553133334444'], ['+351 912 345 678', 'tel:+351912345678'],
    ['(+351) 912 345 678', 'tel:+351912345678'], ['Tel: +55 31 99999-0001', 'tel:+5531999990001']]) {
    const { abertos } = await ligar(bruto);
    assert.deepEqual(abertos, [esperado], 'telefone "' + bruto + '"');
  }
  // DDD 55 (Santa Maria/RS) com 11 dígitos é número nacional: ganha o +55 na frente, não é confundido com o DDI
  const { abertos } = await ligar('55999990001');
  assert.deepEqual(abertos, ['tel:+5555999990001']);
});

teste('L3 fixo com DDD (10 dígitos) disca com +55', async () => {
  for (const [bruto, esperado] of [['(31) 3333-4444', 'tel:+553133334444'], ['5532221234', 'tel:+555532221234']]) { // o 2º: fixo do DDD 55
    const { abertos } = await ligar(bruto);
    assert.deepEqual(abertos, [esperado], 'telefone "' + bruto + '"');
  }
});

teste('L4 sem DDD ou começando com 0 vai como veio', async () => {
  for (const [bruto, esperado] of [['99999-0001', 'tel:999990001'], ['3333-4444', 'tel:33334444'], ['031999990001', 'tel:031999990001']]) {
    const { abertos } = await ligar(bruto);
    assert.deepEqual(abertos, [esperado], 'telefone "' + bruto + '"');
  }
});

teste('L5 sem telefone avisa e não abre nada; o Ligar não marca status nem grava na fila', async () => {
  for (const bruto of ['', null, undefined, ' - ']) {
    const { h, abertos } = await ligar(bruto);
    assert.deepEqual(abertos, [], 'nada aberto para "' + bruto + '"');
    assert.ok(h.avisos.some(a => /não tem telefone/.test(a.mensagem)), 'avisa que não tem telefone');
  }
  const { h } = await ligar('31999990001');
  assert.equal(h.statusNaTela(1), '', 'continua pendente');
  assert.deepEqual(h.fila(), [], 'nada na fila');
  assert.deepEqual(h.calls.filter(c => c.params.action !== 'entregas'), [], 'nenhuma chamada ao painel no toque');
});

await rodar();
