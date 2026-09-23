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
  'avisarSemSincronizacao', 'comEspera', 'avisarArmazenamento', 'guardarRecebimento',
  'enviarRecebimentoGuardado', 'acompanharEnvio', 'enviarConfirmacao', 'estadoDoEnvio',
  'handleAction', 'executarAcao'];
// Só nos cenários que provam a CONFERÊNCIA DE VALOR (a última rede que precede um diálogo). Nos
// outros, `coletarPagamento`/`conferirGrupoValores` continuam fictícios — senão todo cenário
// passaria a depender do modal de dinheiro, que tem régua própria (_t-pagamento-porta.mjs).
const FUNCOES_PG = ['conferirGrupoValores', 'adiantarConferenciaPg', 'coletarPagamento'];

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

async function app({ store = new Map(), responder = async () => aceito, inicio = '2026-09-23T10:20:00.000Z',
  pgReal = false, semLocks = false, conferirMs = 0 } = {}) {
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
      ...(conferirMs ? { API_CONFERIR_TIMEOUT_MS: conferirMs } : {}),
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
      // `semLocks` = navegador antigo sem Web Locks. A fila devolve `sincronizacaoIndisponivel`
      // e NÃO envia nada; o que importa é que a tela não minta sobre isso.
      locks: semLocks ? undefined : { request: async (nome, opc, fn) => {
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
      // O fetch de verdade ABORTA quando o sinal dispara; o fictício ignorava o sinal, então
      // nenhum cenário conseguia provar que um ORÇAMENTO de tempo é mesmo cumprido. Agora ele
      // corre a resposta contra o abort, igual ao navegador.
      const resposta = transporte(params, calls.length);
      const sinal = opcoes && opcoes.signal;
      if (!sinal) return Response.json(await resposta);
      return Response.json(await Promise.race([resposta, new Promise((_, rejeitar) => {
        if (sinal.aborted) return rejeitar(Error('AbortError fictício'));
        sinal.addEventListener('abort', () => rejeitar(Error('AbortError fictício')));
      })]));
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
    adiantarConferenciaPg: () => null,
    coletarPagamento: async () => ctx.respostaPagamento
  });
  window.AppUI = ui;
  const dialogos = [];
  // `aoDialogo` deixa o cenário olhar o mundo NO INSTANTE em que um diálogo abre — é assim que se
  // prova que a conferência de valor saiu ANTES dele, e não entre ele e o modal de dinheiro.
  // O `await` deixa o cenário SEGURAR um diálogo aberto — é assim que se prova que a trava de
  // reentrância cobre mesmo o tempo em que o entregador está lendo a pergunta.
  ui.escolher = async (...a) => { dialogos.push(a[0]); if (ctx.aoDialogo) await ctx.aoDialogo(a[0]); return (ctx.escolha === undefined ? 'maos' : ctx.escolha); };
  ui.perguntar = async (...a) => { dialogos.push(a[0]); if (ctx.aoDialogo) await ctx.aoDialogo(a[0]); return ''; };

  if (pgReal) {
    // O MODAL tem régua própria; aqui o que está sob prova é a CONFERÊNCIA DE VALOR que o precede.
    window.PgPorta.perguntar = async () => ctx.respostaPagamento;
    local.setItem('app_api_url_override', 'https://app.ficticio.invalid/api'); // usandoPainel() = true
    state.pgCfg = { perguntar: true, formas: [{ id: 'dinheiro', rotulo: 'Dinheiro' }] };
  }
  const nomes = FUNCOES.concat(pgReal ? FUNCOES_PG : []);
  const pagina = vm.runInContext(nomes.map(funcaoDaPagina).join('\n') + '\n({' + nomes.join(',') + '});',
    ctx, { filename: 'page-entregas.js (funções reais)' });
  await api.filaPronta();

  return {
    api, state, calls, avisos, keepalive, store, recarregadas, relogio: rel, dialogos,
    definirAoDialogo: fn => { ctx.aoDialogo = fn; },
    // O selo REAL do cartão (mesma função que o `renderEntregaCard` chama), para os cenários
    // poderem afirmar o que o entregador LÊ e se o botão aceita o dedo.
    selo: row => {
      const pend = api.filaRowsPendentes();
      const disp = pend !== null;
      const naFila = (pagina.itensComFila().find(x => Number(x.row) === Number(row)) || {})._fila || null;
      return pagina.estadoDoEnvio(naFila, disp && pend.has(Number(row)), disp, state.aguardando, state.semSincronizacao);
    },
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

// ⛔ 23/09/2026 (2ª volta) — ESTE CENÁRIO FIXAVA O DEFEITO. Ele exigia que 12 respostas ambíguas
// virassem RECUSA DURÁVEL; só que o painel devolve QUALQUER exceção como {ok:false,error:<técnico>}
// com HTTP 200 (route.ts:906, e route.ts:620 no marcar), então "o servidor disse não" e "o servidor
// engasgou" chegam IGUAIS. Com isso, uma janela de deploy/banco fora transformava a entrega REAL do
// entregador em faixa vermelha, a tela desfazia, e o botão "Entendi" APAGAVA a declaração do
// aparelho (filaDescartarStatus → bancoFila.ack). Era o contrário do "nunca perder" que o dono
// pediu. E o contador era por CICLO de dreno, e todo toque dispara um dreno: "12 ciclos" eram 12
// paradas de rota, não os ~12 min que o comentário prometia. O cenário agora exige o OPOSTO.
teste('erro ambíguo do servidor NUNCA vira recusa nem deixa apagar a marcação do aparelho', async () => {
  const h = await app({ responder: async () => ({ ok: false, error: 'TypeError: fetch failed' }) });
  h.state.items = paradas();
  h.state.items[0].status = 'Indo para entrega';
  await h.tocar('done', 1);
  for (let i = 0; i < 30; i++) await h.enviar();
  assert.equal(h.filaDoItem(1).recusado, false, 'por mais que insista, ambíguo não é recusa');
  assert.equal(h.statusNaTela(1), 'Entregue', 'e a tela NÃO desfaz o que o entregador fez');
  assert.equal(h.fila().length, 1, 'a marcação continua guardada no aparelho');
  assert.equal(h.avisos.length, 0, 'sem modal de erro técnico no meio da rua');
  // O selo PARA de dizer "enviando…" (que soa resolvido) e passa a dizer a verdade.
  assert.match(h.selo(1).texto, /ainda não enviou/);
  assert.equal(h.selo(1).recusa, null, 'e não é faixa de recusa: não há nada para o entregador resolver');
  assert.equal(h.selo(1).podeTocar, true, 'o cartão continua aceitando o dedo');
  // E não existe caminho de DESCARTE: o "Entendi" só alcança recusa determinística.
  await h.tocar('okrecusa', 1);
  assert.equal(h.fila().length, 1, 'nada pode APAGAR uma marcação que o servidor nunca recusou');
  // Quando o servidor volta, ela sobe sozinha. Nada se perdeu.
  h.definirTransporte(async () => aceito);
  await h.enviar();
  assert.equal(h.fila().length, 0);
  assert.equal(h.statusNaTela(1), 'Entregue');
  assert.equal(h.calls.filter(x => x.action === 'marcarEntregue').length > 1, true, 'insistiu até passar');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3.b ORDEM DENTRO DA MESMA PARADA (pular um item não pode inverter o que o entregador tocou)
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('falha passageira não deixa o toque seguinte da MESMA parada passar na frente', async () => {
  // O `continue` que consertou o congelamento da fila também deixava o item SEGUINTE da mesma
  // parada subir antes do que falhou — e no ciclo seguinte o pulado subia POR CIMA. O entregador
  // apertava errado, corrigia com Desfazer, via a tela certa, e o escritório recebia "Entregue"
  // (com o pagamento já anulado pelo desfazer, que o painel não reverte: anularPorDesfazer).
  for (const correcao of ['desfazer', 'naoentregue']) {
    let quebrado = true;
    const h = await app({ responder: async p => (quebrado && p.action === 'marcarEntregue'
      ? { ok: false, error: 'falha transitória fictícia no banco' } : aceito) });
    h.state.items = paradas();
    await h.tocar('done', 1);            // apertou errado
    h.definirEscolha(correcao === 'desfazer' ? 'sim' : 'fail');
    await h.tocar(correcao, 1);          // e corrigiu, na MESMA parada
    await h.enviar();
    await h.enviar();
    const noMeio = h.calls.filter(x => Number(x.row) === 1).map(x => x.action);
    assert.equal(new Set(noMeio).size, 1,
      'enquanto o 1º não passa, o 2º da MESMA parada espera atrás: ' + noMeio.join(' -> '));
    quebrado = false;
    await h.enviar();
    await h.enviar();
    const ordem = h.calls.filter(x => Number(x.row) === 1).map(x => x.action);
    const esperado = correcao === 'desfazer' ? 'desfazer' : 'marcarNaoEntregue';
    assert.equal(ordem[ordem.length - 1], esperado,
      'o ÚLTIMO efeito no servidor tem de ser o ÚLTIMO toque do entregador: ' + ordem.join(' -> '));
    assert.equal(h.fila().length, 0, 'e a fila esvaziou');
    h.definirEscolha(undefined);
  }
});

teste('um item envenenado NÃO congela as OUTRAS paradas (o conserto que motivou tudo)', async () => {
  // O outro lado da mesma moeda: bloquear a PARADA não pode voltar a bloquear a FILA.
  const h = await app({ responder: async p => (Number(p.row) === 1 ? { ok: false, error: 'boom fictício' } : aceito) });
  h.state.items = paradas();
  await h.tocar('done', 1);
  await h.tocar('done', 2);
  await h.tocar('done', 3);
  await h.enviar();
  assert.deepEqual(h.fila().map(x => Number(x.params.row)), [1], 'só a parada envenenada ficou');
  assert.equal(h.statusNaTela(2), 'Entregue');
  assert.equal(h.statusNaTela(3), 'Entregue');
});

teste('o pagamento não sobe antes da entrega da MESMA parada', async () => {
  // O painel desenha as respostas em cima desta premissa, por escrito
  // (erp-pagamento-na-entrega.ts: "a fila é FIFO e PARA no primeiro ok:false"): com `nao-pagou` e
  // status != 'entregue' ele devolve tentarDepois, que no consumidor vira `marcarReenvio` — e
  // `marcarReenvio` projeta pg_fila=1, que o painel grava no livro do dinheiro como
  // "enviado_da_fila". Uma declaração que subiu de PRIMEIRA ficaria registrada como vinda de fila.
  let quebrado = true;
  const h = await app({ responder: async p => {
    if (p.action === 'marcarEntregue' && quebrado) return { ok: false, error: 'boom fictício' };
    return p.action === 'confirmarPagamento' ? pagoAceito : aceito;
  } });
  h.state.items = paradas();
  h.state.items[0].naEntrega = true;
  h.definirResposta({ porRow: { 1: pagamento } });
  await h.tocar('done', 1);
  await h.enviar();
  await h.enviar();
  assert.deepEqual(h.calls.map(x => x.action), ['marcarEntregue', 'marcarEntregue'],
    'a declaração de dinheiro espera ATRÁS da entrega da mesma parada');
  quebrado = false;
  await h.enviar();
  assert.deepEqual(h.calls.map(x => x.action).slice(-2), ['marcarEntregue', 'confirmarPagamento']);
  assert.equal(h.fila().length, 0);
  const decl = h.calls.find(x => x.action === 'confirmarPagamento');
  assert.equal(String(decl.pg_fila), '0', 'subiu de primeira: o livro não pode registrar como vinda da fila');
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
    // ⛔ 23/09/2026 (2ª volta) — sem esta linha o cenário não distinguia mais nada: depois que
    // "ambíguo" deixou de virar recusa, tratar o porteiro como ambíguo passava VERDE aqui. Só que
    // porteiro fechado vale para a FILA INTEIRA (login caído, rota não iniciada): o ciclo tem de
    // PARAR no primeiro, e não bater uma vez por parada enquanto a porta está trancada.
    await h.assentar();
    const antes = h.calls.length;
    await h.enviar();
    assert.equal(h.calls.length - antes, 1, 'o ciclo para no primeiro: a porta está fechada para todos');
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 8. A ÚLTIMA REDE QUE PRECEDE UM DIÁLOGO: a conferência de valor do pagamento na porta
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('a conferência de valor sai ANTES dos diálogos, não entre eles', async () => {
  // Ela é a única rede que ainda precede um diálogo, porque é ela que decide o valor oferecido no
  // modal de dinheiro. O defeito era a POSIÇÃO: ela corria DEPOIS do "Como foi a entrega?" e ANTES
  // do modal de pagamento, com o timeout geral de 15 s — tela morta, sem diálogo, sem selo, sem
  // botão cinza, justo nas entregas que envolvem dinheiro. Agora ela sai adiantada e corre JUNTO.
  const marcas = [];
  const h = await app({ pgReal: true, responder: async p => {
    if (p.action === 'conferirValores') { marcas.push('conferiu'); return { ok: true, items: [] }; }
    return p.action === 'confirmarPagamento' ? pagoAceito : aceito;
  } });
  h.state.items = paradas();
  h.state.items[0].naEntrega = true;
  h.definirResposta({ porRow: { 1: pagamento } });
  h.definirAoDialogo(() => { marcas.push('dialogo'); });
  await h.tocar('done', 1);
  assert.equal(marcas[0], 'conferiu', 'a rede sai PRIMEIRO e corre em paralelo: ' + marcas.join(' -> '));
  assert.ok(marcas.includes('dialogo'), 'e os diálogos aconteceram mesmo');
  assert.equal(h.calls.filter(x => x.action === 'conferirValores').length, 1, 'uma conferência só: não repete no modal');
  assert.deepEqual(h.fila().map(x => x.params.action), ['marcarEntregue', 'confirmarPagamento']);
  assert.equal(h.statusNaTela(1), 'Entregue');
  // e o orçamento dela é CURTO — não o geral de 15 s que deixava a tela morta.
  assert.ok(h.api.TEMPO_CONFERIR_MS > 0 && h.api.TEMPO_CONFERIR_MS * 2 <= 15000,
    'orçamento próprio e curto, não o timeout geral (é ' + h.api.TEMPO_CONFERIR_MS + ' ms)');
});

teste('conferência pendurada não trava o ato: estoura o orçamento e o modal abre mesmo assim', async () => {
  // "O sistema oscila" = navigator.onLine é TRUE e a resposta não vem. O guarda de offline não
  // salva disso; quem salva é o orçamento. Passa do orçamento → modo degradado (o entregador
  // digita o valor, com a trava de 10x que a régua do pagamento na porta guarda).
  const h = await app({ pgReal: true, conferirMs: 1000, responder: async p => {
    if (p.action === 'conferirValores') return new Promise(() => {}); // nunca responde
    return p.action === 'confirmarPagamento' ? pagoAceito : aceito;
  } });
  h.state.items = paradas();
  h.state.items[0].naEntrega = true;
  h.definirResposta({ porRow: { 1: pagamento } });
  // A corrida é de propósito: sem o orçamento, o ato NÃO termina — e "não termina" tem de virar
  // cenário VERMELHO, não a régua inteira pendurando (que na prova por mutação leria como crash).
  const toque = h.tocar('done', 1);
  const quem = await Promise.race([
    toque.then(() => 'terminou'),
    (async () => { for (let i = 0; i < 300; i++) await new Promise(r => setImmediate(r)); return 'pendurou'; })()
  ]);
  assert.equal(quem, 'terminou', 'a conferência pendurada não pode segurar o ato do entregador');
  await toque;
  assert.equal(h.statusNaTela(1), 'Entregue', 'o ato foi até o fim com a conferência pendurada');
  assert.deepEqual(h.fila().map(x => x.params.action), ['marcarEntregue', 'confirmarPagamento']);
  assert.equal(h.state.aguardando, null, 'e a tela foi liberada: nada fica preso em "conferindo"');
});

teste('a espera deliberada de dinheiro APARECE na tela e não engole o toque em silêncio', async () => {
  // pgcorrigir espera de propósito (é conferência de dinheiro), mas `enviarConfirmacao` drena a
  // FILA INTEIRA — e a fila agora é o caminho normal de todos os toques, então com sinal ruim ela
  // carrega o acúmulo da rota. Antes, durante esses minutos, a trava de reentrância engolia
  // qualquer toque SEM NADA NA TELA: a queixa do dono voltando por outra porta.
  let liberar; const presa = new Promise(r => { liberar = r; });
  const h = await app({ responder: async p => {
    if (p.action === 'marcarEntregue') { await presa; return aceito; }
    return p.action === 'confirmarPagamento' ? pagoAceito : aceito;
  } });
  h.state.items = paradas();
  h.state.items[0].naEntrega = true;
  h.definirResposta(null);
  await h.tocar('done', 2);               // uma marcação comum fica presa na fila
  h.definirResposta({ porRow: { 1: pagamento } });
  const correcao = h.tocar('pgcorrigir', 1);
  await h.assentar();
  assert.match(h.selo(1).texto, /conferindo o pagamento/, 'a espera se ANUNCIA');
  assert.equal(h.selo(1).podeTocar, false, 'e o botão fica cinza COM motivo, em vez de aceitar o dedo e não fazer nada');
  assert.equal(h.selo(3).podeTocar, false, 'vale para a tela inteira: nenhum cartão finge estar livre');
  liberar();
  await correcao;
  assert.equal(h.state.aguardando, null);
  assert.equal(h.selo(1).podeTocar, true, 'e libera assim que a conferência termina');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 9. NAVEGADOR SEM WEB LOCKS: guardar sem enviar não pode virar tela verde calada
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('sem Web Locks o app avisa e o selo diz a verdade — nada fica verde mentindo', async () => {
  // Sem Web Locks a fila devolve `sincronizacaoIndisponivel` e NÃO envia. Só o "Entregue" olhava
  // essa resposta; Não entregue, Cancelado, Iniciar, Desfazer e o Iniciar do Maps ficavam com o
  // selo "guardado ✓ enviando…" a rota inteira, sem nada chegar ao painel e sem um aviso sequer.
  for (const caminho of ['naoentregue', 'start', 'desfazer']) {
    const h = await app({ semLocks: true });
    h.state.items = paradas();
    if (caminho === 'desfazer') { h.state.items[1].status = 'Entregue'; h.definirEscolha('sim'); }
    if (caminho === 'naoentregue') h.definirEscolha('fail');
    await h.tocar(caminho, 2);
    await h.assentar();
    assert.equal(h.fila().length, 1, caminho + ': guardado no aparelho — nada se perdeu');
    assert.equal(h.calls.length, 0, caminho + ': e nada subiu, que é justamente o ponto');
    assert.equal(h.avisos.length, 1, caminho + ': o entregador PRECISA saber que não está subindo');
    assert.match(h.selo(2).texto, /não envia sozinho/, caminho + ': e o selo para de dizer "enviando…"');
    h.definirEscolha(undefined);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 10. A TRAVA DE REENTRÂNCIA COBRE OS DIÁLOGOS (o comentário virou verdade)
// ─────────────────────────────────────────────────────────────────────────────────────────────
teste('dois toques com o diálogo ABERTO não viram dois atos', async () => {
  // A trava dizia valer "enquanto um diálogo está aberto", mas `state.sendingAction = true` só
  // rodava DEPOIS de todos eles. Dois toques viravam dois atos — e no pago na porta, DUAS
  // declarações de dinheiro para a mesma entrega, com ts_device diferentes.
  let liberar; const preso = new Promise(r => { liberar = r; });
  const h = await app();
  h.state.items = paradas();
  h.semRede(true);
  let vezes = 0;
  h.definirAoDialogo(() => { vezes++; return vezes === 1 ? preso : null; });
  const primeiro = h.tocar('done', 1);
  await h.assentar();
  assert.equal(vezes, 1, 'o primeiro diálogo está aberto');
  await h.tocar('done', 1);   // dedo nervoso, com a pergunta ainda na tela
  await h.tocar('start', 2);  // e em outro cartão também
  assert.equal(vezes, 1, 'nenhum SEGUNDO diálogo abriu por cima do primeiro');
  assert.equal(h.fila().length, 0, 'e nenhum ato foi gravado enquanto o primeiro não terminou');
  liberar();
  await primeiro;
  assert.equal(h.fila().length, 1, 'um toque, um ato');
  assert.equal(h.statusNaTela(1), 'Entregue');
  // terminado o ato, a tela volta a aceitar o dedo na hora
  await h.tocar('start', 2);
  assert.equal(h.statusNaTela(2), 'Indo para entrega');
});

let falhas = 0;
for (const [nome, rodar] of testes) {
  try { await rodar(); console.log('PASS ' + nome); }
  catch (e) { falhas++; console.error('FAIL ' + nome + '\n' + e.stack); }
}
console.log(`${testes.length - falhas}/${testes.length} cenários do toque instantâneo com código real; só transporte, armazenamento e relógio fictícios.`);
if (falhas) process.exitCode = 1;
