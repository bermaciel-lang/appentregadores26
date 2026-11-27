// RÉGUA — "Dividido" na pergunta única do pagamento na porta (27/11/2026). Rode da raiz: node scripts/test-pagamento-dividido.mjs
//
// Pedido da equipe (LOJA-5556): a cliente pagou R$ 50 em dinheiro e o resto no crédito, e o app só aceitava UMA forma — o entregador
// gravou "Dinheiro" no total. Agora a pergunta única tem "➗ Dividido (parte em dinheiro)": quanto foi em dinheiro → como pagou o resto
// (maquininha, PIX se o servidor oferece, cheque) → confere. O app manda a opção do resto em `pg_forma` e o dinheiro em `pg_div_dinheiro`;
// o painel escreve as duas partes na observação com a marca [PAGAMENTO DIVIDIDO] e acende o "!" (o pedido não é alterado).
//
// O QUE PROVA (lógica pura de public/assets/pagamento-porta.js, com uma AppUI de mentira, sem rede):
//   O. a opção só aparece quando o SERVIDOR a lista, com UM pedido na pergunta e o valor CONFERIDO; o app antigo (sem a opção) segue igual;
//   F. o fluxo inteiro, o Voltar (a pergunta principal volta), o valor inválido (zero, o pedido todo, mais que o pedido, ilegível), o
//      resto sem "dinheiro" nem "não pagou", o PIX só se o servidor o oferece;
//   P. o que vai ao servidor (`pg_div_dinheiro` com 2 casas, só na resposta dividida) e a frase do cartão;
//   M. reintrodução: cada regra plantada de volta numa CÓPIA do arquivo derruba uma cena.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const ORIGINAL = path.resolve("public/assets/pagamento-porta.js");
const LF = (t) => t.replace(/\r\n/g, "\n");

function carregar(arquivo) { delete require.cache[require.resolve(arquivo)]; return require(arquivo); }
function ui(passos) {
  const telas = [], avisos = [];
  return {
    telas, avisos,
    escolher: async (m, o, c) => { telas.push({ tipo: "escolher", m, o, c }); return passos.shift(); },
    perguntar: async (m, c) => { telas.push({ tipo: "perguntar", m, c }); return passos.shift(); },
    alerta: async (m, c) => { avisos.push({ m, c }); },
  };
}
const OPS_SERVIDOR = ["maquininha", "dinheiro", "cheque", "dividido", "nao-pagou"];
const item = (x = {}) => ({ row: 7, pedido: "LOJA-5556", naEntrega: true, pgFormaChave: "credito-entrega", valor: 142.76, valorConferido: true, ...x });
const cfg = (opcoes = OPS_SERVIDOR) => ({ perguntar: true, simples: true, opcoes });

async function cenas(Pg) {
  const feitas = [];
  const t = async (nome, fn) => { await fn(); feitas.push(nome); };
  const rotulos = (tela) => tela.o.map((o) => o.valor);

  // ═════════ O. AS OPÇÕES ═════════
  await t("O1 servidor lista 'dividido', um pedido, valor conferido → a opção aparece (antes de 'Não pagou')", async () => {
    const u = ui([null]);
    await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(), ui: u });
    assert.deepEqual(rotulos(u.telas[0]), ["maquininha", "dinheiro", "cheque", "dividido", "nao-pagou"]);
    assert.match(u.telas[0].o.find((o) => o.valor === "dividido").rotulo, /Dividido \(parte em dinheiro\)/);
  });
  await t("O2 duas irmãs pagas na porta → SEM 'dividido' (a divisão é de um pedido)", async () => {
    const u = ui([null]);
    await Pg.perguntarSimples({ item: item(), irmas: [item(), item({ row: 8, pedido: "LOJA-5557" })], cfg: cfg(), ui: u });
    assert.ok(!rotulos(u.telas[0]).includes("dividido"), JSON.stringify(rotulos(u.telas[0])));
  });
  await t("O3 valor NÃO conferido (sem sinal) ou sem valor → SEM 'dividido' (a conta do resto não tem base)", async () => {
    for (const x of [{ valorConferido: false }, { valor: null }, { valor: "" }, { valor: 0 }]) {
      const u = ui([null]);
      await Pg.perguntarSimples({ item: item(x), irmas: [item(x)], cfg: cfg(), ui: u });
      assert.ok(!rotulos(u.telas[0]).includes("dividido"), JSON.stringify(x));
    }
  });
  await t("O4 servidor antigo (lista sem 'dividido') → a pergunta é a de sempre", async () => {
    const u = ui(["maquininha"]);
    const r = await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(["maquininha", "dinheiro", "cheque", "nao-pagou"]), ui: u });
    assert.deepEqual(rotulos(u.telas[0]), ["maquininha", "dinheiro", "cheque", "nao-pagou"]);
    assert.equal(r.porRow[7].forma, "maquininha"); assert.equal(r.porRow[7].divDinheiro, undefined);
  });

  // ═════════ F. O FLUXO ═════════
  await t("F1 Dividido → R$ 50,00 em dinheiro → resto na maquininha → Confirmar: resposta com a opção do resto e o dinheiro", async () => {
    const u = ui(["dividido", "50,00", "maquininha", "sim"]);
    const r = await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(), ui: u });
    assert.equal(r.cancelado, false);
    assert.deepEqual(r.porRow[7], { forma: "maquininha", simples: true, valor: null, digitado: false, valorVisto: 142.76, divDinheiro: 50 });
    assert.match(u.telas[1].m, /Quanto o cliente pagou em DINHEIRO\?[\s\S]*o pedido é R\$\s?142,76/);
    assert.match(u.telas[2].m, /Dinheiro: R\$\s?50,00\nFalta: R\$\s?92,76/);
    assert.match(u.telas[3].m, /R\$\s?50,00 em DINHEIRO\n\+ R\$\s?92,76 em MAQUININHA\n= R\$\s?142,76/);
  });
  await t("F2 o resto oferece maquininha, PIX (só se o servidor oferece) e cheque — nunca dinheiro nem 'não pagou'", async () => {
    let u = ui(["dividido", "50", null, null, null]);
    await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(), ui: u });
    assert.deepEqual(rotulos(u.telas[2]), ["maquininha", "cheque"]);
    u = ui(["dividido", "50", null, null, null]);
    await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(["maquininha", "dinheiro", "pix", "cheque", "dividido", "nao-pagou"]), ui: u });
    assert.deepEqual(rotulos(u.telas[2]), ["maquininha", "pix", "cheque"]);
  });
  await t("F3 Voltar no valor → a pergunta principal volta; escolher Dinheiro grava SEM divisão", async () => {
    const u = ui(["dividido", null, "dinheiro"]);
    const r = await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(), ui: u });
    assert.equal(u.telas[2].c.titulo, "💳 O cliente te pagou de alguma forma?");
    assert.equal(r.porRow[7].forma, "dinheiro"); assert.equal(r.porRow[7].divDinheiro, undefined);
  });
  await t("F4 valor inválido (zero, o pedido todo, mais que o pedido, ilegível) → aviso e pergunta de novo; nada sai com valor errado", async () => {
    for (const ruim of ["0", "142,76", "200", "abc"]) {
      const u = ui(["dividido", ruim, "40", "cheque", "sim"]);
      const r = await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(), ui: u });
      assert.equal(u.avisos.length, 1, ruim); assert.match(u.avisos[0].m, /MAIOR que zero e MENOR que o pedido/);
      assert.deepEqual([r.porRow[7].forma, r.porRow[7].divDinheiro], ["cheque", 40], ruim);
    }
  });
  await t("F5 Voltar no resto ou na conferência → o valor é perguntado de novo (com o que ele digitou); Cancelar na principal = cancelado", async () => {
    let u = ui(["dividido", "50", null, "60", "maquininha", null, "70", "maquininha", "sim"]);
    let r = await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(), ui: u });
    assert.equal(r.porRow[7].divDinheiro, 70);
    assert.equal(u.telas[3].c.valor, "50");
    u = ui([null]);
    r = await Pg.perguntarSimples({ item: item(), irmas: [item()], cfg: cfg(), ui: u });
    assert.equal(r.cancelado, true);
  });

  // ═════════ P. O QUE VAI AO SERVIDOR ═════════
  await t("P1 montarParams: pg_div_dinheiro com 2 casas, junto da opção do resto (pergunta única); resposta comum não manda o campo", async () => {
    const p = Pg.montarParams(7, "ts", { forma: "maquininha", simples: true, valor: null, digitado: false, valorVisto: 142.76, divDinheiro: 50 }, false);
    assert.equal(p.pg_div_dinheiro, "50.00"); assert.equal(p.pg_forma, "maquininha"); assert.equal(p.pg_simples, 1); assert.equal(p.pg_valor, "");
    const comum = Pg.montarParams(7, "ts", { forma: "maquininha", simples: true, valor: null, digitado: false, valorVisto: 142.76 }, false);
    assert.ok(!("pg_div_dinheiro" in comum));
  });
  await t("P2 a frase do cartão diz as duas partes", async () => {
    assert.match(Pg.fraseResposta({ forma: "maquininha", simples: true, divDinheiro: 50 }), /Pagamento: 💵 R\$\s?50,00 \+ 💳 Maquininha ✓/);
    assert.equal(Pg.fraseResposta({ forma: "maquininha", simples: true }), "Pagamento: 💳 Maquininha ✓");
  });
  return feitas;
}

const PLANTIOS = [
  ["M1 'dividido' aparece com duas irmãs", "return Array.isArray(grupo) && grupo.length === 1 &&", "return Array.isArray(grupo) &&"],
  ["M2 'dividido' aparece com o valor não conferido", "grupo.length === 1 && valorConfirmado(grupo[0]) &&", "grupo.length === 1 &&"],
  ["M3 o valor igual ao pedido passa", "Math.round(d * 100) >= Math.round(total * 100)", "Math.round(d * 100) > Math.round(total * 100)"],
  ["M4 o dinheiro não vai ao servidor", "p.pg_div_dinheiro = valorParaServidor(r.divDinheiro);", ""],
  ["M5 o resto aceita dinheiro", "return OPCOES_DO_RESTO.indexOf(o.valor) >= 0;", "return o.valor !== 'nao-pagou';"],
  ["M6 o dinheiro some da resposta", "if (div) out.porRow[Number(x.row)].divDinheiro = div.dinheiro;", ""],
  ["M7 Voltar no valor cancela tudo (em vez de voltar à pergunta)", "esc = null; // Voltar: a pergunta principal de novo", "break;"],
];

const feitas = await cenas(carregar(ORIGINAL));
feitas.forEach((n, i) => console.log("ok", i + 1, n));
console.log("\nM. Reintrodução (cada defeito plantado numa CÓPIA derruba uma cena)");
const texto = LF(readFileSync(ORIGINAL, "utf8"));
const pasta = mkdtempSync(path.join(tmpdir(), "pg-dividido-"));
for (const [nome, de, para] of PLANTIOS) {
  if (!texto.includes(de)) { console.error(`FALHOU  o plantio "${nome}" não casa com o texto — conserte o plantio`); process.exit(1); }
  const copia = path.join(pasta, `m${PLANTIOS.findIndex((p) => p[0] === nome)}.js`);
  writeFileSync(copia, texto.replace(de, () => para));
  let caiu = null;
  try { await cenas(carregar(copia)); } catch (e) { caiu = e; }
  if (!caiu) { console.error(`FALHOU  o defeito plantado "${nome}" NÃO foi pego por nenhuma cena`); process.exit(1); }
  console.log(`  OK  plantio reprovado: ${nome}  (${String(caiu.message).split("\n")[0].slice(0, 80)})`);
}
console.log("\nTudo verde.");
