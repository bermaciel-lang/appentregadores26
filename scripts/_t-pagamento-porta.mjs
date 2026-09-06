// Régua do modal "Como o cliente pagou?" (public/assets/pagamento-porta.js) — roda em node puro,
// sem navegador: um AppUI de mentira responde as telas e a gente confere o que o modal MONTA e o
// que vai no PAYLOAD. Também confere, por leitura estática, que as DUAS portas do marcarEntregue
// em page-entregas.js passam pela confirmação.
//
//   node scripts/_t-pagamento-porta.mjs                → verde/vermelho + process.exitCode
//   PG_PORTA_PATH=<arquivo> node scripts/...           → roda contra outra cópia (reintrodução)
//
// ⭐ Régua só vale provada por reintrodução: scripts/_t-pagamento-porta-reintroducao.mjs planta
//    defeitos numa CÓPIA, exige VERMELHO aqui, e confere com cmp que o original não mudou.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(here, '..');
const alvo = process.env.PG_PORTA_PATH || path.join(raiz, 'public', 'assets', 'pagamento-porta.js');
const require = createRequire(import.meta.url);
const Pg = require(alvo);

let falhas = 0, ok = 0;
function t(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falhas++; console.log('  ❌ ' + nome + (detalhe !== undefined ? ' → ' + JSON.stringify(detalhe) : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// AppUI de mentira: cada chamada consome a próxima resposta do roteiro e registra o que foi mostrado.
function uiFake(roteiro) {
  const chamadas = [];
  const prox = (tipo, args) => {
    chamadas.push({ tipo, args });
    if (!roteiro.length) throw new Error('roteiro acabou em ' + tipo);
    const r = roteiro.shift();
    if (r instanceof Error) throw r;
    return Promise.resolve(r);
  };
  return {
    chamadas,
    escolher: (msg, ops, opc) => prox('escolher', { msg, ops, opc }),
    perguntar: (msg, opc) => prox('perguntar', { msg, opc }),
    alerta: (msg, opc) => { chamadas.push({ tipo: 'alerta', args: { msg, opc } }); return Promise.resolve(true); },
  };
}

const formas = [
  { chave: 'credito-entrega', rotulo: 'Crédito', tom: 'success' },
  { chave: 'debito-entrega', rotulo: 'Débito' },
  { chave: 'dinheiro', rotulo: 'Dinheiro' },
  { chave: 'vale', operadora: 'alelo', rotulo: 'Alelo' },
  { chave: 'vale', operadora: 'vr', rotulo: 'VR' },
  { chave: 'pix', rotulo: 'PIX na hora' },
];
const cfg = { perguntar: true, formas };
const item = { row: 4321, numero: 7, naEntrega: true, formaPagamento: 'CREDITO NA ENTREGA', valor: 189.5, troco: 0, pgFormaChave: 'credito-entrega' };
const TS = '2026-09-05T17:07:00.000Z';

console.log('\n── parseValor');
t('189,50 → 189.5', Pg.parseValor('189,50') === 189.5);
t('189.50 → 189.5', Pg.parseValor('189.50') === 189.5);
t('R$ 1.234,56 → 1234.56', Pg.parseValor('R$ 1.234,56') === 1234.56);
t('1,234.56 → 1234.56', Pg.parseValor('1,234.56') === 1234.56);
t('"" → null', Pg.parseValor('') === null);
t('abc → null', Pg.parseValor('abc') === null);
t('-5 → null', Pg.parseValor('-5') === null);
t('189,555 (3 casas) → null', Pg.parseValor('189,555') === null);
t('valorParaServidor(189.5) = "189.50" (PONTO)', Pg.valorParaServidor(189.5) === '189.50');
t('valorParaServidor(null) = ""', Pg.valorParaServidor(null) === '');

console.log('\n── devePerguntar (o cofre manda)');
t('cofre 0 → não pergunta', Pg.devePerguntar({ perguntar: false, formas }, item) === false);
t('sem cfg → não pergunta', Pg.devePerguntar(null, item) === false);
t('pago online → não pergunta', Pg.devePerguntar(cfg, { ...item, naEntrega: false }) === false);
t('na porta + cofre ≥1 → pergunta', Pg.devePerguntar(cfg, item) === true);
t('perguntar:"true" (string) NÃO vale', Pg.devePerguntar({ perguntar: 'true', formas }, item) === false);

console.log('\n── o que a tela 1 monta');
{
  const ops = Pg.opcoesTela1(item, null, formas);
  t('1º botão = "✓ Pagou R$ 189,50 no CRÉDITO" (1 toque)', ops[0] && ops[0].valor === 'igual' && /Pagou R\$ 189,50 no CRÉDITO/.test(ops[0].rotulo), ops[0]);
  t('1º botão tem tom success (foco automático do ui.js)', ops[0] && ops[0].tom === 'success');
  t('2º botão = Foi diferente', ops[1] && ops[1].valor === 'diferente');
  t('só 2 botões (o "não sei" é o Cancelar)', ops.length === 2);
  const g = [item, { ...item, row: 4322, valor: 122.9 }]; g.soma = 312.4;
  const opsG = Pg.opcoesTela1(item, g, formas);
  t('irmãs: 1º botão = "Pagou tudo junto: R$ 312,40"', opsG[0].valor === 'tudo' && /312,40/.test(opsG[0].rotulo), opsG[0]);
  t('irmãs: 3 botões', opsG.length === 3);
  const opsS = Pg.opcoesTela1({ ...item, pgFormaChave: null }, null, formas);
  t('sem forma declarada: só "Informar como pagou"', opsS.length === 1 && opsS[0].valor === 'diferente');
  t('mensagem tela 1 mostra pedido e forma', /Pedido R\$ 189,50 · CRÉDITO/.test(Pg.mensagemTela1(item, formas)), Pg.mensagemTela1(item, formas));
  t('dinheiro com troco mostra "troco p/"', /troco p\/ R\$ 200,00/.test(Pg.mensagemTela1({ ...item, pgFormaChave: 'dinheiro', troco: 200 }, formas)));
  t('sem lista do servidor cai no texto do item ("CREDITO")', /no CREDITO/.test(Pg.opcoesTela1(item, null, [])[0].rotulo));
}

console.log('\n── o que a tela 2 monta');
{
  const ops = Pg.opcoesTela2(item, formas);
  t('a declarada vem PRIMEIRO com "(como no pedido)"', ops[0].valor.forma === 'credito-entrega' && /como no pedido/.test(ops[0].rotulo), ops[0]);
  t('todas as formas do servidor estão lá (6)', ops.length === 6);
  t('vale carrega a operadora', ops.some((o) => o.valor.forma === 'vale' && o.valor.operadora === 'alelo'));
  const opsV = Pg.opcoesTela2({ ...item, pgFormaChave: 'vale', pgOperadora: 'vr' }, formas);
  t('declarada vale/vr marca SÓ o VR', opsV[0].valor.operadora === 'vr' && !/como no pedido/.test(opsV.find((o) => o.valor.operadora === 'alelo').rotulo));
}

console.log('\n── payload (montarParams)');
{
  const p = Pg.montarParams(4321, TS, { forma: 'credito-entrega', operadora: null, valor: 189.5, digitado: false }, false);
  t('caso comum', eq(p, { action: 'confirmarPagamento', row: 4321, ts_device: TS, pg_forma: 'credito-entrega', pg_valor: '189.50', pg_digitado: 0, pg_fila: 0 }), p);
  const n = Pg.montarParams(4321, TS, { forma: 'credito-entrega', valor: null, digitado: false, naoSei: true }, true);
  t('não sei: pg_valor "" + pg_naosei 1 + pg_fila 1', n.pg_valor === '' && n.pg_naosei === 1 && n.pg_fila === 1, n);
  const d = Pg.montarParams('4321', TS, { forma: 'vale', operadora: 'alelo', valor: 185, digitado: true, grupo: '4321:' + TS }, false);
  t('vale/alelo digitado em grupo', d.row === 4321 && d.pg_operadora === 'alelo' && d.pg_digitado === 1 && d.pg_grupo === '4321:' + TS && d.pg_valor === '185.00', d);
  t('sem operadora → chave pg_operadora nem existe', !('pg_operadora' in p) && !('pg_grupo' in p) && !('pg_naosei' in p) && !('pg_grupo_rows' in p));
  // contrato §5: com grupo, as rows do comprovante viajam em pg_grupo_rows (CSV) — é por elas que o servidor soma
  const g = Pg.montarParams(4321, TS, { forma: 'credito-entrega', operadora: null, valor: 312.4, digitado: false, grupo: '4321:' + TS, grupoRows: [4321, 4322] }, false);
  t('grupo: pg_grupo_rows = "4321,4322"', g.pg_grupo_rows === '4321,4322', g);
  t('pg_valor NUNCA leva vírgula', !/,/.test(String(d.pg_valor)) && !/,/.test(String(p.pg_valor)));
}

console.log('\n── o fluxo (AppUI de mentira)');
async function fluxo() {
  // a) caso comum = 1 toque
  { const ui = uiFake(['igual']); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('caso comum: 1 chamada ao modal', ui.chamadas.length === 1, ui.chamadas.length);
    t('caso comum: forma declarada, valor do pedido, digitado=false', eq(r.porRow[4321], { forma: 'credito-entrega', operadora: null, valor: 189.5, digitado: false }), r.porRow[4321]);
    t('caso comum: Cancelar do modal diz "Não sei / não vi"', ui.chamadas[0].args.opc.textoCancelar === 'Não sei / não vi'); }
  // b) fechar o overlay / cancelar = não sei (NUNCA aborta)
  { const ui = uiFake([null]); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('fechar overlay → naoSei (e não null/aborta)', r.porRow[4321] && r.porRow[4321].naoSei === true && r.porRow[4321].valor === null, r.porRow[4321]); }
  // b2) o ui.js REAL resolvia `false` no cancelar (medido 05/09): tem de valer como "não sei" também
  { const ui = uiFake([false]); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('cancelar = false (ui.js real) → naoSei, 1 modal só', r.porRow[4321].naoSei === true && ui.chamadas.length === 1, { r: r.porRow[4321], n: ui.chamadas.length }); }
  { const ui = uiFake(['diferente', false, 'igual']); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('tela 2 cancel=false volta à tela 1 (não vira forma)', ui.chamadas.length === 3 && r.porRow[4321].forma === 'credito-entrega' && r.porRow[4321].digitado === false, ui.chamadas.map((c) => c.tipo)); }
  // c) foi diferente: outra forma + valor digitado
  { const ui = uiFake(['diferente', { forma: 'debito-entrega', operadora: null }, '185,00']); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('diferente: 3 telas (escolher, escolher, perguntar)', ui.chamadas.map((c) => c.tipo).join(',') === 'escolher,escolher,perguntar', ui.chamadas.map((c) => c.tipo));
    t('diferente: débito · 185 · digitado=true', eq(r.porRow[4321], { forma: 'debito-entrega', operadora: null, valor: 185, digitado: true }), r.porRow[4321]);
    t('tela 3 pede o valor EXATO do comprovante', /EXATAMENTE/.test(ui.chamadas[2].args.msg) && /COMPROVANTE/.test(ui.chamadas[2].args.msg));
    t('tela 3 pré-preenche 189,50 com teclado decimal', ui.chamadas[2].args.opc.valor === '189,50' && ui.chamadas[2].args.opc.inputmode === 'decimal');
    t('tela 3 Cancelar = "É esse mesmo"', ui.chamadas[2].args.opc.textoCancelar === 'É esse mesmo'); }
  // d) "É esse mesmo" aceita o pré-preenchido, digitado=false
  { const ui = uiFake(['diferente', { forma: 'debito-entrega', operadora: null }, null]); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('"É esse mesmo": valor do pedido, digitado=false', r.porRow[4321].valor === 189.5 && r.porRow[4321].digitado === false, r.porRow[4321]); }
  // e) digitou o MESMO valor → aceitou, não digitou
  { const ui = uiFake(['diferente', { forma: 'debito-entrega', operadora: null }, '189,50']); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('digitou igual ao pré-preenchido → digitado=false', r.porRow[4321].digitado === false); }
  // f) valor inválido → alerta e pede de novo
  { const ui = uiFake(['diferente', { forma: 'debito-entrega', operadora: null }, 'abc', '190']); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('inválido → alerta + repete; depois 190 digitado', ui.chamadas.some((c) => c.tipo === 'alerta') && r.porRow[4321].valor === 190 && r.porRow[4321].digitado === true, r.porRow[4321]); }
  // g) valor apagado = não sei o valor (forma continua)
  { const ui = uiFake(['diferente', { forma: 'pix', operadora: null }, '   ']); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('vazio → forma pix, valor null, sem naoSei', r.porRow[4321].forma === 'pix' && r.porRow[4321].valor === null && !r.porRow[4321].naoSei, r.porRow[4321]); }
  // h) dinheiro pergunta "Quanto recebeu?"
  { const ui = uiFake(['diferente', { forma: 'dinheiro', operadora: null }, '200']); await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('dinheiro: tela 3 pergunta quanto RECEBEU', /RECEBEU/.test(ui.chamadas[2].args.msg)); }
  // i) irmãs: "pagou tudo junto"
  { const irma = { ...item, row: 4322, valor: 122.9 };
    const ui = uiFake(['tudo']); const r = await Pg.perguntar({ item, irmas: [item, irma], cfg, ui, tsDevice: TS });
    t('tudo junto: 1 toque responde as 2 rows', Object.keys(r.porRow).length === 2 && ui.chamadas.length === 1);
    t('tudo junto: valor = soma, grupo = row:ts, digitado=false', r.porRow[4321].valor === 312.4 && r.porRow[4322].valor === 312.4 && r.porRow[4321].grupo === '4321:' + TS && r.porRow[4322].grupo === '4321:' + TS && r.porRow[4322].digitado === false, r.porRow);
    t('tudo junto: as rows do grupo viajam nas DUAS respostas (grupoRows) e viram pg_grupo_rows', eq(r.porRow[4321].grupoRows, [4321, 4322]) && eq(r.porRow[4322].grupoRows, [4321, 4322]) && Pg.montarParams(4322, TS, r.porRow[4322], false).pg_grupo_rows === '4321,4322', r.porRow[4322]); }
  // j) irmãs: uma a uma
  { const irma = { ...item, row: 4322, valor: 122.9 };
    const ui = uiFake(['igual', 'igual']); const r = await Pg.perguntar({ item, irmas: [item, irma], cfg, ui, tsDevice: TS });
    t('irmãs 1 a 1: 2 modais, cada um com o seu valor', ui.chamadas.length === 2 && r.porRow[4321].valor === 189.5 && r.porRow[4322].valor === 122.9 && !r.porRow[4322].grupo);
    t('irmãs: título mostra "1 de 2" / "2 de 2"', /1 de 2/.test(ui.chamadas[0].args.opc.titulo) && /2 de 2/.test(ui.chamadas[1].args.opc.titulo));
    t('irmãs: só a PRIMEIRA tela ganha o "tudo junto"', ui.chamadas[0].args.ops[0].valor === 'tudo' && ui.chamadas[1].args.ops[0].valor !== 'tudo'); }
  // k) irmã paga online NÃO entra
  { const online = { ...item, row: 4323, naEntrega: false };
    const ui = uiFake(['igual']); const r = await Pg.perguntar({ item, irmas: [item, online], cfg, ui, tsDevice: TS });
    t('irmã online fica fora (1 modal, 1 row)', ui.chamadas.length === 1 && Object.keys(r.porRow).length === 1 && !ui.chamadas[0].args.ops.some((o) => o.valor === 'tudo')); }
  // l) sem forma declarada → direto na tela 2
  { const ui = uiFake([{ forma: 'credito-entrega', operadora: null }, null]); const r = await Pg.perguntar({ item: { ...item, pgFormaChave: null }, irmas: [], cfg, ui, tsDevice: TS });
    t('sem pgFormaChave: 1ª tela já é a da forma', /forma de pagamento/i.test(ui.chamadas[0].args.msg) && r.porRow[4321].forma === 'credito-entrega'); }
  // m) o modal QUEBRA → naoSei, nunca lança
  { const ui = uiFake([new Error('AppUI morreu')]); let lancou = false, r = null;
    try { r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS }); } catch (e) { lancou = true; }
    t('exceção no modal → não lança, devolve naoSei com obs', !lancou && r && r.porRow[4321].naoSei === true && r.porRow[4321].obs === 'erro-no-modal', r && r.porRow); }
  { let lancou = false; try { await Pg.perguntar({ item, irmas: [item], cfg, ui: null, tsDevice: TS }); } catch (e) { lancou = true; }
    t('sem AppUI → não lança', !lancou); }
  // n) já respondeu antes (tela 4)
  { const anterior = { forma: 'credito-entrega', operadora: null, valor: 189.5, digitado: false };
    const ui = uiFake(['manter']); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS, anterior });
    t('tela 4 "manter": manteve=true, resposta null (não reenvia)', r.manteve === true && r.porRow[4321] === null && ui.chamadas.length === 1);
    t('tela 4 mostra a resposta anterior', /Crédito · R\$ 189,50/.test(ui.chamadas[0].args.msg), ui.chamadas[0].args.msg);
    const ui2 = uiFake(['corrigir', { forma: 'debito-entrega', operadora: null }, null]); const r2 = await Pg.perguntar({ item, irmas: [item], cfg, ui: ui2, tsDevice: TS, anterior });
    t('tela 4 "corrigir": pula a tela 1, vai direto à forma', /forma de pagamento/i.test(ui2.chamadas[1].args.msg) && r2.porRow[4321].forma === 'debito-entrega' && r2.manteve === false);
    const ui3 = uiFake([null]); const r3 = await Pg.perguntar({ item, irmas: [item], cfg, ui: ui3, tsDevice: TS, anterior });
    t('tela 4 fechar = manter', r3.manteve === true); }
  // o) voltar entre telas não vira loop infinito
  { const rot = []; for (let i = 0; i < 40; i++) rot.push('diferente', null);
    const ui = uiFake(rot); const r = await Pg.perguntar({ item, irmas: [item], cfg, ui, tsDevice: TS });
    t('voltar sem fim → desiste em MAX_VOLTAS e devolve naoSei', r.porRow[4321].naoSei === true && ui.chamadas.length <= Pg.MAX_VOLTAS * 2, ui.chamadas.length); }
  // p) servidor sem lista de formas: ainda pergunta o valor
  { const ui = uiFake(['diferente', '150']); const r = await Pg.perguntar({ item, irmas: [item], cfg: { perguntar: true, formas: [] }, ui, tsDevice: TS });
    t('formas vazias: pula a tela 2, pergunta só o valor', ui.chamadas.map((c) => c.tipo).join(',') === 'escolher,perguntar' && r.porRow[4321].valor === 150 && r.porRow[4321].forma === 'credito-entrega'); }
  // q) frase do cartão
  t('fraseResposta ✓', Pg.fraseResposta({ forma: 'credito-entrega', valor: 189.5, digitado: false }, formas) === '💳 Crédito · R$ 189,50 ✓');
  t('fraseResposta digitado', /\(digitado\)/.test(Pg.fraseResposta({ forma: 'vale', operadora: 'vr', valor: 185, digitado: true }, formas)) && /VR/.test(Pg.fraseResposta({ forma: 'vale', operadora: 'vr', valor: 185, digitado: true }, formas)));
  t('fraseResposta não sei', /não soube/.test(Pg.fraseResposta({ naoSei: true }, formas)));
}

function portas() {
  console.log('\n── as DUAS portas em page-entregas.js (leitura estática)');
  const src = readFileSync(path.join(raiz, 'public', 'assets', 'page-entregas.js'), 'utf8');
  const linhas = src.split('\n');
  const idx = []; linhas.forEach((l, i) => { if (/action:\s*'marcarEntregue'/.test(l)) idx.push(i); });
  t('há exatamente 2 lugares que montam marcarEntregue', idx.length === 2, idx.map((i) => i + 1));
  for (const i of idx) {
    const janela = linhas.slice(i, i + 30).join('\n');
    t('linha ' + (i + 1) + ': enviarConfirmacao nas 30 linhas seguintes', /enviarConfirmacao\(/.test(janela));
  }
  const antes = (i) => linhas.slice(Math.max(0, i - 60), i).join('\n');
  for (const i of idx) t('linha ' + (i + 1) + ': coletarPagamento ANTES do envio', /coletarPagamento\(/.test(antes(i)));
  t('index.html carrega pagamento-porta.js antes de page-entregas.js', (() => { const h = readFileSync(path.join(raiz, 'public', 'entregas', 'index.html'), 'utf8'); return h.indexOf('pagamento-porta.js') > 0 && h.indexOf('pagamento-porta.js') < h.indexOf('page-entregas.js') && h.indexOf('ui.js') < h.indexOf('pagamento-porta.js'); })());
  const core = readFileSync(path.join(raiz, 'public', 'assets', 'core.js'), 'utf8');
  t('core.js repassa perguntarPagamento/formasNaPorta como pgConfig', /pgConfig:\s*\{\s*perguntar:\s*res\.perguntarPagamento === true/.test(core));
  // ⛔ a fila é FIFO e PARA no primeiro ok:false; um confirmarPagamento preso (cofre ilegível por
  // horas) não pode segurar as ENTREGAS atrás dele. O ramo tem de vir ANTES do `else break`.
  { const fila = core.slice(core.indexOf('async function processarFila'), core.indexOf('async function processarFila') + 2500);
    const iSkip = fila.indexOf("item.params.action === 'confirmarPagamento'"), iBreak = fila.indexOf('else break;');
    t('processarFila: confirmarPagamento com ok:false é PULADO (continue), não trava a fila', iSkip > 0 && iBreak > iSkip && /confirmarPagamento'\)\s*\{[\s\S]{0,400}continue;/.test(fila), { iSkip, iBreak }); }
  // ui.js: o cancelar de `escolher` tem de resolver NULL (o que os 5 chamadores testam). Até 05/09
  // resolvia false e "Cancelar" em "Não entregue" marcava CANCELADO.
  const ui = readFileSync(path.join(raiz, 'public', 'assets', 'ui.js'), 'utf8');
  t('ui.js: cancelar de escolher resolve null', /function cancelar\(\) \{ fechar\(\(temInput \|\| temEscolha\) \? null : false\); \}/.test(ui));
}

// Uma exceção no meio do fluxo é FALHA (e não "saída 1 sem placar") — senão a reintrodução não a lê.
try { await fluxo(); } catch (e) { falhas++; console.log('  ❌ o fluxo LANÇOU: ' + (e && e.stack || e)); }
try { portas(); } catch (e) { falhas++; console.log('  ❌ a leitura estática LANÇOU: ' + (e && e.stack || e)); }
console.log('\n' + (falhas ? '🔴 VERMELHO: ' + falhas + ' falha(s), ' + ok + ' ok' : '🟢 VERDE: ' + ok + ' ok'));
process.exitCode = falhas ? 1 : 0;
