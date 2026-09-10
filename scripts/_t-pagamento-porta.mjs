import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const Pg=createRequire(import.meta.url)("../public/assets/pagamento-porta.js");
const forms=[
 {chave:"credito-entrega",rotulo:"Cartão de Crédito"},{chave:"debito-entrega",rotulo:"Cartão de Débito"},
 {chave:"dinheiro",rotulo:"Dinheiro"},{chave:"bling-800431",rotulo:"Cheque"},
 {chave:"bling-822307",rotulo:"Alelo"},{chave:"bling-1207605",rotulo:"VR"},{chave:"bling-1014165",rotulo:"Pluxee"},{chave:"bling-1139437",rotulo:"Ticket"},
 {chave:"vale",operadora:"outra",rotulo:"Outro vale"},{chave:"nao-pagou",rotulo:"NÃO PAGOU"},
 {chave:"credito-online",rotulo:"Crédito online"},{chave:"pix",rotulo:"Pix Instabuy"},{chave:"bling-4936197",rotulo:"PIX CIELO"},{chave:"bling-2892828",rotulo:"Link de Pagamento - Múltiplas Formas"}
];
const item={row:1,numero:1,pedido:"TEST-1",naEntrega:true,pgFormaChave:"credito-entrega",valor:100,valorConferido:true};
const cfg={perguntar:true,formas:forms},ts="2026-09-08T12:00:00Z";
function ui(steps){const telas=[],avisos=[];return {telas,avisos,escolher:async(m,o,c)=>{telas.push({m,o,c});return steps.shift();},perguntar:async(m,c)=>{telas.push({m,c});return steps.shift();},alerta:async(m)=>{avisos.push(m);return true;}};}
async function flow(steps,extra={}){const u=ui(steps);return {u,r:await Pg.perguntar({item,irmas:[item],cfg,ui:u,tsDevice:ts,...extra})};}
for(const [s,n] of [["189,50",189.5],["189.50",189.5],["R$ 189,50",189.5],["1.234,56",1234.56],["1,234.56",1234.56],["1234",1234],["0",0],["",null],["abc",null],["-2",null],["1e3",null],["2,345",null]])assert.equal(Pg.parseValor(s),n,s);
assert.equal(Pg.valorParaServidor(null),"");assert.equal(Pg.valorParaServidor(95.5),"95.50");
assert.equal(Pg.devePerguntar(cfg,item),true);assert.equal(Pg.devePerguntar({...cfg,perguntar:false},item),false);
assert.equal(Pg.devePerguntar(cfg,{...item,naEntrega:false}),false);
assert.equal(Pg.irmasNaPorta([item,item,{...item,row:2,naEntrega:false}]).length,1);
const ops=Pg.opcoesTela2(item,forms);assert.equal(ops.filter(x=>x.rotulo==="Crédito/Débito").length,1);
assert.equal(ops.filter(x=>x.valor.grupo==="vale").length,1);
assert.ok(ops.some(x=>x.rotulo==="Cheque"));
assert.ok(!JSON.stringify(ops).includes("Instabuy")&&!JSON.stringify(ops).includes("online")&&!JSON.stringify(ops).includes("Múltiplas"));
let {r}=await flow(["igual"]);assert.equal(r.porRow[1].valor,100);assert.equal(r.porRow[1].cartaoAgrupado,true);
for(const x of [null,false,undefined]){r=(await flow([x])).r;assert.equal(r.cancelado,true);assert.deepEqual(r.porRow,{});}
r=(await flow(["diferente",{grupo:"cartao"},"95,00","sim"])).r;  // 95 != 100 -> confirma valor
assert.equal(r.porRow[1].forma,"credito-entrega");assert.equal(r.porRow[1].cartaoAgrupado,true);assert.equal(r.porRow[1].valor,95);
r=(await flow(["diferente",{grupo:"cartao"},{forma:"debito-entrega"},"sim","90","sim"],{item:{...item,pgFormaChave:"dinheiro"},irmas:[{...item,pgFormaChave:"dinheiro"}]})).r;  // dinheiro->cartao e 90!=100
assert.equal(r.porRow[1].forma,"debito-entrega");assert.equal(r.porRow[1].cartaoAgrupado,undefined);
let f=await flow(["diferente",{forma:"dinheiro"},"sim","","abc","95","sim"]);  // troca conta + 95<100
assert.equal(f.r.porRow[1].valor,95);assert.equal(f.u.avisos.length,2);
for(const raw of [null,false])assert.equal((await flow(["diferente",{forma:"dinheiro"},"sim",raw])).r.cancelado,true);
r=(await flow(["diferente",{grupo:"vale"},{forma:"bling-822307"},"sim","100"])).r;  // vale != cartao; valor igual nao perguntaassert.equal(r.porRow[1].forma,"bling-822307");
r=(await flow(["diferente",{grupo:"vale"},{forma:"vale",operadora:"outra"},"Vale Fictício","sim","90","sim"])).r;
assert.equal(r.porRow[1].valeNome,"Vale Fictício");
r=(await flow(["diferente",{grupo:"vale"},null,null])).r;assert.equal(r.cancelado,true);
r=(await flow(["diferente",{forma:"nao-pagou"},"sim"])).r;
assert.equal(r.porRow[1].forma,"nao-pagou");assert.equal(r.porRow[1].valor,null);
const zero={...item,valor:0};r=(await flow(["igual"],{item:zero,irmas:[zero]})).r;assert.equal(r.porRow[1].valor,0);
const offline={...item,valorConferido:false};assert.deepEqual(Pg.opcoesTela1(offline,[offline],forms).map(x=>x.valor),["diferente"]);
r=(await flow(["diferente",{forma:"dinheiro"},"sim","65"],{item:offline,irmas:[offline]})).r;  // sem valor confirmado nao ha o que compararassert.equal(r.porRow[1].valor,65);
r=(await flow(["manter"],{anterior:{forma:"credito-entrega",valor:80,digitado:true}})).r;assert.equal(r.manteve,true);
r=(await flow([{forma:"dinheiro"},"sim","75","sim"],{anterior:{forma:"credito-entrega",valor:null,naoSei:true}})).r;assert.equal(r.porRow[1].valor,75,"resposta vazia anterior não permite manter");
r=(await flow([{forma:"dinheiro"},"sim","75","sim"],{anterior:{forma:"credito-entrega",valor:80,aprovacao:"rejeitado"}})).r;assert.equal(r.porRow[1].valor,75);
const sisters=[item,{...item,row:2,pedido:"TEST-2",valor:20,pgFormaChave:"debito-entrega"}];
r=(await flow(["tudo"],{irmas:sisters})).r;assert.equal(r.porRow[1].valor,120);assert.equal(r.porRow[2].forma,"debito-entrega");assert.deepEqual(r.porRow[1].grupoRows,[1,2]);
const mixed=[item,{...item,row:2,pgFormaChave:"dinheiro"}];mixed.soma=200;assert.ok(!Pg.opcoesTela1(item,mixed,forms).some(x=>x.valor==="tudo"));
r=(await flow(["igual",null],{irmas:sisters})).r;assert.equal(r.cancelado,true);assert.deepEqual(r.porRow,{});
for(const k of ["credito-online","pix","bling-4936197","bling-2892828"]){
 const x={...item,pgFormaChave:k};assert.ok(!Pg.opcoesTela1(x,[x],forms).some(o=>o.valor==="igual"));
}
const params=Pg.montarParams(1,ts,{forma:"vale",operadora:"outra",valeNome:"OutroFictício",valor:10,digitado:true},true);
assert.equal(params.pg_vale_nome,"OutroFictício");assert.equal(params.pg_valor,"10.00");assert.equal(params.pg_fila,1);
assert.equal(Pg.montarParams(1,ts,{forma:"credito-entrega",valor:10,cartaoAgrupado:true},false).pg_cartao_agrupado,1);
assert.equal(Pg.respostaCompleta({forma:"vale",operadora:"outra",valor:10},forms),false);
assert.ok(Pg.fraseResposta({forma:"credito-entrega",valor:10},forms).includes("Crédito/Débito"));
// ── TRAVA DE DISCREPANCIA (dono, 09/09/2026): 10x pra mais ou pra menos nao salva ─────────────
// Os casos reais da Alteracoes Rota eram 100x (virgula esquecida): R$ 20.426,00 num pedido de
// R$ 204,26 e R$ 16.680,00 num de R$ 166,83.
assert.equal(Pg.FATOR_TRAVA,10);
assert.equal(Pg.discrepante(20426,204.26),true,"o caso real do dono (100x) trava");
assert.equal(Pg.discrepante(16680,166.83),true,"o segundo caso real trava");
assert.equal(Pg.discrepante(1000,100),true,"exatamente 10x trava");
assert.equal(Pg.discrepante(10,100),true,"exatamente 10x menor trava");
assert.equal(Pg.discrepante(999.99,100),false,"abaixo de 10x passa (com confirmacao)");
assert.equal(Pg.discrepante(10.01,100),false,"acima de 1/10 passa (com confirmacao)");
assert.equal(Pg.discrepante(5000,0),false,"pedido sem valor: nao ha com o que comparar");
assert.equal(Pg.discrepante(5000,null),false,"pedido nulo nao trava");
// ── MODAL DE DIFERENCA ────────────────────────────────────────────────────────────────────────
assert.equal(Pg.valorDivergente(100,100,"credito-entrega"),false,"igual nao pergunta");
assert.equal(Pg.valorDivergente(100.004,100,"credito-entrega"),false,"menos de 1 centavo nao e erro de digitacao");
assert.equal(Pg.valorDivergente(95,100,"credito-entrega"),true,"a menos pergunta");
assert.equal(Pg.valorDivergente(120,100,"credito-entrega"),true,"a mais no cartao pergunta");
assert.equal(Pg.valorDivergente(150,100,"dinheiro"),false,"DINHEIRO a mais e troco: nao pergunta");
assert.equal(Pg.valorDivergente(90,100,"dinheiro"),true,"dinheiro a MENOS pergunta");
assert.equal(Pg.valorDivergente(50,0,"dinheiro"),false,"sem valor de pedido nao pergunta");
// ── Pelos fluxos: o valor travado NAO e salvo, e o app pede de novo ───────────────────────────
let trava=await flow(["diferente",{grupo:"cartao"},"10000","100"]);
assert.equal(trava.r.porRow[1].valor,100,"depois da trava, o valor corrigido e salvo");
assert.ok(trava.u.avisos.some(m=>/MUITO longe/.test(m)),"a trava avisa por que recusou");
// Recusar a confirmacao volta pro campo do valor, sem salvar o numero errado.
let volta=await flow(["diferente",{grupo:"cartao"},"95","nao","100"]);
assert.equal(volta.r.porRow[1].valor,100,"'corrigir' descarta o valor divergente");
// Dinheiro a mais nao pede confirmacao nenhuma (troco).
const itDin={...item,pgFormaChave:"dinheiro"};
let dinMais=await flow(["diferente",{forma:"dinheiro"},"150"],{item:itDin,irmas:[itDin]});
assert.equal(dinMais.r.porRow[1].valor,150,"dinheiro a mais passa direto");
const page=readFileSync("public/assets/page-entregas.js","utf8");
for(const guard of ["if (pgA && pgA.cancelado) return;","if (pgRes && pgRes.cancelado) return;","resC.cancelado"])assert.ok(page.includes(guard),guard);
console.log("PASS app: trava 10x, modal de valor, modal de conta, parse, cofre, grupos, cartão único com identidade fiscal, formas proibidas inclusive cache antigo, vale identificado, valor obrigatório, cancelamento, correção e comprovante offline.");
