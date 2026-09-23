// Régua do TOQUE INSTANTÂNEO (23/09/2026) — o pedido do dono: "clicou, ficou verde na hora, e já
// libera para clicar em iniciar a próxima entrega", sem nunca perder a informação.
//
// Roda o CÓDIGO REAL (core.js, fila-duravel.js, pagamento-porta.js e as funções de page-entregas.js)
// em VM, com IndexedDB simulado (fake-indexeddb), transporte fictício e RELÓGIO INJETADO. Nenhuma
// chamada a serviço de verdade.
//
//   node scripts/_t-toque-instantaneo.mjs
//
// ⛔ APP_ASSETS_DIR existe para a régua de MUTAÇÃO (_t-toque-instantaneo-reintroducao.mjs) apontar
// esta régua para uma CÓPIA com defeito plantado. Se este arquivo voltar a fixar o caminho, todo
// defeito plantado "fica verde" e a mutação vira ruído — já aconteceu duas vezes com a régua do
// pagamento na porta (09/09 e 10/09). O eco "alvo=<dir>" abaixo é a auto-prova de que o mutante
// foi mesmo lido.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
let idb; try { idb = require('fake-indexeddb'); }
catch { idb = require(path.join(os.homedir(), '.codex/tmp/rota-idb-testes/node_modules/fake-indexeddb')); }

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = process.env.APP_ASSETS_DIR || path.join(raiz, 'public/assets');
console.log('alvo=' + ASSETS);

const ler = nome => fs.readFileSync(path.join(ASSETS, nome), 'utf8');
const fonteFila = ler('fila-duravel.js');
const fonteCore = ler('core.js');
const fontePorta = ler('pagamento-porta.js');
const fontePagina = ler('page-entregas.js');
const copiar = x => JSON.parse(JSON.stringify(x));

// Mesma extração de test-fila-pagamento.mjs: pega a DECLARAÇÃO inteira da função real, sem
// reescrever lógica nenhuma. Se o recorte falhar, falha alto — teste que some é pior que teste que
// reprova.
function funcaoDaPagina(nome) {
  const m = fontePagina.match(new RegExp('^  (?:async )?function ' + nome + '\\([^]*?^  }', 'm'));
  assert.ok(m, 'Função real ausente em page-entregas.js: ' + nome);
  return m[0];
}
const FUNCOES = ['pgRespostaAnterior', 'metaDeStatus', 'itensComFila', 'guardarNaFila', 'agendarEnvio',
  'avisarArmazenamento', 'guardarRecebimento', 'enviarRecebimentoGuardado', 'acompanharEnvio',
  'enviarConfirmacao', 'handleAction'];

const PREFIXO = 'toque_';
const FILA_LEGADA = PREFIXO + 'fila_v1';
const aceito = { ok: true };
const pagoAceito = { ok: true, pagamento: { gravado: true } };
const pagamento = { forma: 'dinheiro', operadora: null, valor: 95, digitado: true };

function memoria(map) {
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}

// RELÓGIO INJETADO: o app carimba `ts_device` com `new Date().toISOString()`. Aqui ele anda só
// quando o teste manda, para provar que o carimbo é o do TOQUE e não o do envio.
function relogio(inicio) {
  let agora = Date.parse(inicio);
  class DataFake extends Date {
    constructor(...args) { if (!args.length) super(agora); else super(...args); }
    static now() { return agora; }
  }
  return { Data: DataFake, avancar: ms => { agora += ms; }, iso: () => new Date(agora).toISOString() };
}

async function app({ store = new Map(), responder = async () => aceito, inicio = '2026-09-23T10:20:00.000Z' } = {}) {
  const calls = [], avisos = [], keepalive = [];
  let transporte = responder, semRede = false, falhaArmazenamento = false, banco;
  const rel = relogio(inicio);
  if (!store.idb) store.idb = new idb.IDBFactory();
  if (!store.locks) store.locks = new Map();
  const fabrica = { open: (...a) => store.idb.open(...a) };
  const local = memoria(store);

  const window = {
    APP_CONFIG: {
      API_URL: 'https://app.ficticio.invalid/api', API_MODE: 'json', API_RETRY_COUNT: 0,
      API_TIMEOUT_MS: 15000, STORAGE_CACHE_PREFIX: PREFIXO, STORAGE_DRIVER_KEY: PREFIXO + 'driver',
      STORAGE_TOKEN_KEY: PREFIXO + 'token', REFRESH_INTERVAL_MS: 60000
    },
    location: { origin: 'https://app.ficticio.invalid' },
    setTimeout: () => 0, indexedDB: fabrica, addEventListener: () => {}, dispatchEvent: () => {}
  };
  const ctx = vm.createContext({
    window,
    localStorage: {
      ...local,
      setItem: (k, v) => { if (falhaArmazenamento) throw Error('QuotaExceededError fictícia'); local.setItem(k, v); }
    },
    sessionStorage: memoria(new Map()),
    navigator: {
      userAgent: 'teste-node', onLine: true,
      locks: { request: async (nome, opc, fn) => {
        if (store.locks.has(nome)) return fn(null);
        store.locks.set(nome, true);
        try { return await fn({ name: nome }); } finally { store.locks.delete(nome); }
      } }
    },
    indexedDB: fabrica, crypto: webcrypto, URL, URLSearchParams, AbortController,
    Date: rel.Data, Map, Set, Number, String, Array, Object, JSON, Boolean, Promise, Error,
    console, Response, queueMicrotask,
    setTimeout: (fn, ms) => { const t = { cancelado: false }; if (ms < 5000) queueMicrotask(() => { if (!t.cancelado) fn(); }); return t; },
    clearTimeout: t => { if (t) t.cancelado = true; },
    fetch: async (url, opcoes) => {
      const u = new URL(url);
      assert.equal(u.origin, 'https://app.ficticio.invalid', 'nenhuma chamada sai para fora do fictício');
      const params = Object.fromEntries(u.searchParams);
      if (opcoes && opcoes.keepalive) { keepalive.push(copiar(params)); return Response.json(aceito); }
      // Sem rede = a requisição NÃO chega ao servidor. Por isso ela não entra em `calls`: `calls` é
      // "quantas vezes o servidor foi tocado", e é sobre isso que os cenários de duplicação falam.
      if (semRede) throw Error('Sem rede fictícia');
      calls.push(copiar(params));
      return Response.json(await transporte(params, calls.length));
    }
  });

  vm.runInContext(fonteFila, ctx, { filename: 'fila-duravel.js' });
  const criarOriginal = window.FilaDuravel.criar;
  window.FilaDuravel.criar = opc => { banco = criarOriginal(opc); return banco; };
  vm.runInContext(fonteCore, ctx, { filename: 'core.js' });
  vm.runInContext(fontePorta, ctx, { filename: 'pagamento-porta.js' });

  const api = window.AppEntrega;
  const ui = { alerta: async (mensagem, opc) => { avisos.push({ mensagem, opc }); return true; } };
  const state = { driver: 'Fictício', pgRespondido: {}, expandidos: new Set(), items: [], rotaIniciada: true, pgCfg: { perguntar: false, formas: [] } };
  const recarregadas = [];
  Object.assign(ctx, {
    api, state, AppUI: ui, renderList: () => {}, carregarTudo: () => { recarregadas.push(1); },
    updateLocalStatus: (row, status, obs) => {
      const i = state.items.find(x => Number(x.row) === Number(row));
      if (i) { i.status = status; if (obs !== undefined) i.observacaoPedido = obs; }
    },
    conferirGrupoValores: async x => x,
    coletarPagamento: async () => ctx.respostaPagamento
  });
  window.AppUI = ui;
  ui.escolher = async () => (ctx.escolha === undefined ? 'maos' : ctx.escolha);
  ui.perguntar = async () => '';

  const pagina = vm.runInContext(FUNCOES.map(funcaoDaPagina).join('\n') + '\n({' + FUNCOES.join(',') + '});',
    ctx, { filename: 'page-entregas.js (funções reais)' });
  await api.filaPronta();

  return {
    api, state, calls, avisos, keepalive, store, recarregadas, relogio: rel,
    vista: () => copiar(pagina.itensComFila()),
    statusNaTela: row => (pagina.itensComFila().find(x => Number(x.row) === Number(row)) || {}).status,
    filaDoItem: row => (pagina.itensComFila().find(x => Number(x.row) === Number(row)) || {})._fila || null,
    fila: () => copiar(banco.snapshot() || []),
    tocar: pagina.handleAction,
    enviar: () => api.processarFila(),
    definirResposta: r => { ctx.respostaPagamento = r; },
    definirEscolha: e => { ctx.escolha = e; },
    definirTransporte: t => { transporte = t; },
    semRede: v => { semRede = v; },
    falharArmazenamento: v => { falhaArmazenamento = v; },
    // Deixa o envio em segundo plano (disparado pelo próprio toque) terminar antes de conferir.
    assentar: async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); },
    fechar: () => { banco.fechar(); store.locks.clear(); }
  };
}

const paradas = () => ([
  { row: 1, numero: 1, cliente: 'Cliente A', status: '', naEntrega: false },
  { row: 2, numero: 2, cliente: 'Cliente B', status: '', naEntrega: false },
  { row: 3, numero: 3, cliente: 'Cliente C', status: '', naEntrega: false }
]);

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. TOQUE PINTA SEM REDE
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('o toque pinta a tela sem NENHUMA chamada de rede no caminho do dedo', async () => {
  // Qualquer fetch feito ANTES do commit reprova: a resposta abaixo explode se for chamada.
  let redeUsada = false;
  const h = await app({ responder: async () => { redeUsada = true; return aceito; } });
  h.state.items = paradas();
  h.semRede(true); // e ainda por cima não há internet nenhuma
  await h.tocar('done', 1);
  assert.equal(h.statusNaTela(1), 'Entregue', 'ficou verde na hora, sem servidor');
  assert.equal(h.fila().length, 1, 'um toque = um item na fila');
  assert.equal(h.fila()[0].params.action, 'marcarEntregue');
  assert.equal(redeUsada, false, 'nenhuma resposta de servidor participou da pintura');
  // E já libera o próximo: o segundo toque também volta e também pinta.
  await h.tocar('start', 2);
  assert.equal(h.statusNaTela(2), 'Indo para entrega');
  assert.equal(h.fila().length, 2);
});

teste('com a rede PENDURADA para sempre, o toque volta na mesma hora', async () => {
  // É o caso que o dono descreveu: sinal ruim, o servidor aceita a conexão e não responde. Antes,
  // `handleAction` ficava preso em `apiGet` (3 tentativas × 15 s) e o cartão ficava morto.
  // O cronômetro aqui é o de VERDADE (fora da VM): se algum `await` de rede voltar para o caminho
  // do dedo, este cenário fica VERMELHO em vez de pendurar a régua inteira.
  const h = await app({ responder: async () => new Promise(() => {}) });
  h.state.items = paradas();
  const corrida = Promise.race([
    (async () => { await h.tocar('done', 1); await h.tocar('start', 2); await h.tocar('done', 2); return 'voltou'; })(),
    new Promise(r => setTimeout(() => r('travou'), 3000))
  ]);
  assert.equal(await corrida, 'voltou', 'o toque NÃO pode esperar a rede');
  assert.equal(h.statusNaTela(1), 'Entregue');
  assert.equal(h.statusNaTela(2), 'Entregue');
  assert.equal(h.fila().length, 3, 'e os três atos estão guardados');
});

teste('o carimbo é a hora do TOQUE, não a do envio', async () => {
  const h = await app({ inicio: '2026-09-23T10:20:00.000Z' });
  h.state.items = paradas();
  h.semRede(true);
  await h.tocar('done', 1);
  h.relogio.avancar(3 * 60 * 60 * 1000); // três horas presas sem sinal
  await h.tocar('done', 2);
  const carimbos = h.fila().map(x => x.params.ts_device);
  assert.equal(carimbos[0], '2026-09-23T10:20:00.000Z');
  assert.equal(carimbos[1], '2026-09-23T13:20:00.000Z');
  await h.assentar();
  assert.equal(h.calls.length, 0, 'sem rede, o servidor não foi tocado nenhuma vez');
  h.semRede(false);
  h.relogio.avancar(60 * 60 * 1000); // e a internet só voltou uma hora depois
  await h.enviar();
  assert.deepEqual(h.calls.map(x => x.ts_device), carimbos, 'o reenvio conserva a hora de cada clique');
  assert.equal(h.fila().length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. NUNCA PERDER
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('item sai da fila só depois que o envio confirma; a tela não pisca no meio', async () => {
  const h = await app();
  h.state.items = paradas();
  h.semRede(true);
  await h.tocar('done', 1);
  assert.equal(h.fila().length, 1);
  await h.enviar();
  assert.equal(h.fila().length, 1, 'sem resposta, NADA sai da fila');
  assert.equal(h.statusNaTela(1), 'Entregue', 'e a tela continua verde');
  h.semRede(false);
  await h.enviar();
  assert.equal(h.fila().length, 0, 'confirmou: aí sim sai');
  assert.equal(h.statusNaTela(1), 'Entregue', 'e continua verde, agora pelo próprio cache local');
});

teste('internet caindo no meio não perde e não duplica, mesmo fechando e reabrindo o app', async () => {
  const h = await app();
  h.state.items = paradas();
  h.semRede(true);
  await h.tocar('done', 1);
  await h.tocar('start', 2);
  await h.enviar();
  const guardado = h.fila();
  assert.equal(guardado.length, 2);
  h.fechar(); // o entregador fecha o app com a fila cheia

  const voltou = await app({ store: h.store });
  assert.deepEqual(voltou.fila().map(x => x.id), guardado.map(x => x.id), 'mesmos IDs: nada foi recriado');
  assert.deepEqual(voltou.fila().map(x => x.params), guardado.map(x => x.params), 'payload intacto');
  await voltou.enviar();
  assert.equal(voltou.fila().length, 0);
  assert.equal(voltou.calls.length, 2, 'cada toque subiu UMA vez — dois toques, duas chamadas');
  assert.deepEqual(voltou.calls.map(x => x.action).sort(), ['iniciarEntrega', 'marcarEntregue']);
});

teste('armazenamento indisponível: avisa e NÃO finge que marcou', async () => {
  const h = await app();
  h.state.items = paradas();
  h.falharArmazenamento(true);
  // A fila em IndexedDB continua de pé; o que quebra é a gravação. Força o caminho de erro na
  // inclusão abortando a transação de escrita.
  const original = h.store.idb.open.bind(h.store.idb);
  h.store.idb.open = (...a) => {
    const req = original(...a);
    req.addEventListener('success', () => {
      const db = req.result, tx = db.transaction.bind(db);
      db.transaction = (lojas, modo, ...o) => { const t = tx(lojas, modo, ...o); if (modo === 'readwrite') queueMicrotask(() => { try { t.abort(); } catch (e) {} }); return t; };
    });
    return req;
  };
  const h2 = await app({ store: h.store });
  h2.state.items = paradas();
  await h2.tocar('done', 1);
  assert.equal(h2.statusNaTela(1), '', 'nada ficou verde');
  assert.equal(h2.fila().length, 0, 'nada entrou na fila');
  assert.equal(h2.calls.length, 0, 'e nada foi mandado para o servidor');
  assert.equal(h2.avisos.length, 1, 'o entregador é avisado — o app não mente');
  assert.match(h2.avisos[0].mensagem, /NÃO marquei nada/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. CONFLITO / RECUSA DO SERVIDOR
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('recusa desfaz SÓ aquele item e mantém o resto', async () => {
  const h = await app({
    responder: async p => (Number(p.row) === 1
      ? { ok: false, naoEncontrado: true, error: 'Entrega não pertence a esta rota/turno.' }
      : aceito)
  });
  h.state.items = paradas();
  h.state.items[0].status = 'Indo para entrega'; // estado anterior REAL da parada recusada
  h.semRede(true); // os dois toques acontecem sem sinal: é o pior caso da rua
  await h.tocar('done', 1);
  await h.tocar('done', 2);
  assert.equal(h.statusNaTela(1), 'Entregue', 'verde na hora, antes de qualquer resposta');
  assert.equal(h.statusNaTela(2), 'Entregue');
  h.semRede(false);
  await h.enviar();
  assert.equal(h.statusNaTela(1), 'Indo para entrega', 'desfez exatamente o que o servidor recusou');
  assert.equal(h.filaDoItem(1).recusado, true);
  assert.match(h.filaDoItem(1).erro, /rota\/turno/);
  assert.equal(h.statusNaTela(2), 'Entregue', 'a entrega aceita continua verde');
  assert.equal(h.filaDoItem(2), null, 'e saiu da fila');
  assert.equal(h.avisos.length, 0, 'sem modal travando a rua: o motivo fica no cartão');
  // "Entendi" tira a recusa da fila sem mandar nada de novo para o servidor.
  const antes = h.calls.length;
  await h.tocar('okrecusa', 1);
  assert.equal(h.fila().length, 0);
  assert.equal(h.calls.length, antes, 'reconhecer a recusa não reenvia nada');
});

teste('um item recusado não congela os de trás na fila', async () => {
  // O painel devolve exceção como `{ok:false, error:<técnico>}` com HTTP 200. Antes disso o
  // consumidor dava `break` e TODOS os itens seguintes ficavam presos atrás — e no dia seguinte
  // saíam como naoEncontrado e sumiam (diário de 15/09: 73 entregas de 5 entregadores).
  const h = await app({ responder: async p => (Number(p.row) === 1 ? { ok: false, error: 'boom fictício' } : aceito) });
  h.state.items = paradas();
  await h.tocar('done', 1);
  await h.tocar('done', 2);
  await h.tocar('done', 3);
  await h.enviar();
  assert.deepEqual(h.fila().map(x => Number(x.params.row)), [1], 'só o envenenado ficou');
  assert.equal(h.statusNaTela(2), 'Entregue');
  assert.equal(h.statusNaTela(3), 'Entregue');
  assert.equal(h.filaDoItem(1).recusado, false, 'ainda não é recusa: pode ser erro passageiro');
});

teste('erro ambíguo que não passa NUNCA vira recusa visível em vez de reenviar para sempre', async () => {
  const h = await app({ responder: async () => ({ ok: false, error: 'o sistema não aceitou' }) });
  h.state.items = paradas();
  h.state.items[0].status = 'Indo para entrega';
  await h.tocar('done', 1);
  for (let i = 0; i < 12; i++) await h.enviar();
  assert.equal(h.filaDoItem(1).recusado, true, 'depois de insistir, o entregador precisa SABER');
  assert.match(h.filaDoItem(1).erro, /não aceitou/);
  assert.equal(h.statusNaTela(1), 'Indo para entrega', 'e a tela desfaz aquele item');
  const antes = h.calls.length;
  await h.enviar();
  assert.equal(h.calls.length, antes, 'recusado não fica batendo no servidor');
});

teste('porteiro fechado (login/montagem) NÃO é recusa: guarda tudo e tenta depois', async () => {
  for (const fechado of [{ ok: false, precisaLogin: true }, { ok: false, montagemBloqueada: true, error: 'Inicie a rota.' }]) {
    const h = await app({ responder: async () => fechado });
    h.state.items = paradas();
    await h.tocar('done', 1);
    await h.tocar('done', 2);
    for (let i = 0; i < 15; i++) await h.enviar();
    assert.equal(h.fila().length, 2, 'nada foi descartado nem marcado como recusa');
    assert.equal(h.fila().every(x => !x.precisaCorrigir), true);
    assert.equal(h.statusNaTela(1), 'Entregue', 'e o que o entregador fez continua na tela');
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. PAGAMENTO NA PORTA CONTINUA ÍNTEGRO
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('pagamento na porta: mesma transação, mesmo ts_device, e a recusa avisa sem derrubar a entrega', async () => {
  const h = await app({ responder: async p => (p.action === 'confirmarPagamento'
    ? { ok: true, pagamento: { gravado: false, porque: 'Confira o valor fictício' } } : aceito) });
  h.state.items = paradas();
  h.state.items[0].naEntrega = true;
  h.definirResposta({ porRow: { 1: pagamento } });
  await h.tocar('done', 1);
  const guardado = h.fila();
  assert.deepEqual(guardado.map(x => x.params.action), ['marcarEntregue', 'confirmarPagamento'],
    'a marcação e a declaração saem no MESMO ato, nessa ordem');
  assert.equal(guardado[0].params.ts_device, guardado[1].params.ts_device,
    'mesmo ts_device: é a chave de idempotência do servidor');
  assert.equal(guardado[1].params.pg_valor, '95.00');
  await h.enviar();
  // a ENTREGA foi aceita e saiu; o PAGAMENTO foi recusado e ficou, exigindo correção.
  assert.deepEqual(h.fila().map(x => x.params.action), ['confirmarPagamento']);
  assert.equal(h.fila()[0].precisaCorrigir, true);
  assert.equal(h.statusNaTela(1), 'Entregue', 'recusa de pagamento NUNCA derruba a entrega');
});

teste('recusa de pagamento continua avisando para conferir (regra de dinheiro intocada)', async () => {
  const h = await app({ responder: async p => (p.action === 'confirmarPagamento'
    ? { ok: true, pagamento: { gravado: false, porque: 'Confira o valor fictício' } } : aceito) });
  h.state.items = paradas();
  h.state.items[0].naEntrega = true;
  h.definirResposta({ porRow: { 1: pagamento } });
  await h.tocar('done', 1);
  await h.enviar();
  // O aviso chega em segundo plano (acompanharEnvio), então basta deixar as microtarefas correrem.
  for (let i = 0; i < 40 && !h.avisos.length; i++) await new Promise(r => setImmediate(r));
  assert.equal(h.avisos.length, 1, 'dinheiro recusado sempre avisa');
  assert.match(h.avisos[0].mensagem, /Conferir|conferência|valor fictício/i);
});

teste('marcação sem pagamento não gera aviso nenhum na rua', async () => {
  const h = await app();
  h.state.items = paradas();
  h.semRede(true);
  await h.tocar('done', 1);
  await h.tocar('naoentregue', 2);
  await h.enviar();
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  assert.equal(h.avisos.length, 0, 'sem sinal não pode virar modal a cada entrega');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. A LISTA NÃO REPINTA POR CIMA DO QUE ESTÁ NA FILA
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('recarregar a lista do servidor não desfaz o que ainda está guardado', async () => {
  const h = await app();
  h.state.items = paradas();
  h.semRede(true);
  await h.tocar('done', 1);
  // O poll chega e traz a lista do servidor, que AINDA não sabe da entrega.
  h.state.items = paradas();
  assert.equal(h.statusNaTela(1), 'Entregue', 'a fila do aparelho vence a lista do servidor');
  h.semRede(false);
  await h.enviar();
  h.state.items = paradas().map(x => (x.row === 1 ? { ...x, status: 'Entregue' } : x));
  assert.equal(h.statusNaTela(1), 'Entregue');
  assert.equal(h.filaDoItem(1), null);
});

teste('o toque não dispara recarga imediata da lista', async () => {
  const h = await app();
  h.state.items = paradas();
  await h.tocar('done', 1);
  await h.tocar('start', 2);
  assert.equal(h.recarregadas.length, 0, 'recarregar logo depois do toque é o que repinta por cima');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6. FECHAMENTO COM KEEPALIVE
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('fechar o app dispara keepalive só do que é seguro repetir', async () => {
  const h = await app();
  h.state.items = paradas();
  h.semRede(true);
  await h.tocar('done', 1);
  await h.tocar('done', 2);
  await h.tocar('desfazer', 2); // agora a row 2 tem DUAS declarações: a ordem não é garantida
  await h.assentar();
  const enviados = h.api.enviarPendentesNoFechamento();
  assert.equal(enviados, 1, 'só a row com uma única declaração pendente');
  assert.deepEqual(h.keepalive.map(x => Number(x.row)), [1]);
  // Nada saiu da fila: sem resposta não há prova de gravação.
  assert.equal(h.fila().length, 3);
  h.fechar();
  const voltou = await app({ store: h.store });
  assert.equal(voltou.fila().length, 3, 'reabrir encontra tudo e reenvia');
  await voltou.enviar();
  assert.equal(voltou.fila().length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 7. DUPLICAÇÃO
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('tocar duas vezes não cria dois atos para a mesma coisa nem some com nada', async () => {
  const h = await app();
  h.state.items = paradas();
  h.semRede(true);
  await h.tocar('done', 1);
  await h.tocar('done', 1); // dedo nervoso: o entregador acha que não foi
  assert.equal(h.fila().length, 2, 'cada toque é um item próprio — nenhum é engolido');
  assert.equal(new Set(h.fila().map(x => x.id)).size, 2, 'IDs distintos: nenhum sobrescreve o outro');
  h.semRede(false);
  await h.enviar();
  assert.equal(h.fila().length, 0);
  // Marcar a mesma linha de novo grava o mesmo valor: o efeito no servidor é um só.
  assert.deepEqual(h.calls.map(x => [x.action, x.row]), [['marcarEntregue', '1'], ['marcarEntregue', '1']]);
  assert.equal(h.statusNaTela(1), 'Entregue');
});

let falhas = 0;
for (const [nome, rodar] of testes) {
  try { await rodar(); console.log('PASS ' + nome); }
  catch (e) { falhas++; console.error('FAIL ' + nome + '\n' + e.stack); }
}
console.log(`${testes.length - falhas}/${testes.length} cenários do toque instantâneo com código real; só transporte, armazenamento e relógio fictícios.`);
if (falhas) process.exitCode = 1;
