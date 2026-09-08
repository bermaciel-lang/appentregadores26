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
r=(await flow(["diferente",{grupo:"cartao"},"95,00"])).r;
assert.equal(r.porRow[1].forma,"credito-entrega");assert.equal(r.porRow[1].cartaoAgrupado,true);assert.equal(r.porRow[1].valor,95);
r=(await flow(["diferente",{grupo:"cartao"},{forma:"debito-entrega"},"90"],{item:{...item,pgFormaChave:"dinheiro"},irmas:[{...item,pgFormaChave:"dinheiro"}]})).r;
assert.equal(r.porRow[1].forma,"debito-entrega");assert.equal(r.porRow[1].cartaoAgrupado,undefined);
let f=await flow(["diferente",{forma:"dinheiro"},"","abc","95"]);
assert.equal(f.r.porRow[1].valor,95);assert.equal(f.u.avisos.length,2);
for(const raw of [null,false])assert.equal((await flow(["diferente",{forma:"dinheiro"},raw])).r.cancelado,true);
r=(await flow(["diferente",{grupo:"vale"},{forma:"bling-822307"},"100"])).r;assert.equal(r.porRow[1].forma,"bling-822307");
r=(await flow(["diferente",{grupo:"vale"},{forma:"vale",operadora:"outra"},"Vale Fictício","90"])).r;
assert.equal(r.porRow[1].valeNome,"Vale Fictício");
r=(await flow(["diferente",{grupo:"vale"},null,null])).r;assert.equal(r.cancelado,true);
r=(await flow(["diferente",{forma:"nao-pagou"},"sim"])).r;
assert.equal(r.porRow[1].forma,"nao-pagou");assert.equal(r.porRow[1].valor,null);
const zero={...item,valor:0};r=(await flow(["igual"],{item:zero,irmas:[zero]})).r;assert.equal(r.porRow[1].valor,0);
const offline={...item,valorConferido:false};assert.deepEqual(Pg.opcoesTela1(offline,[offline],forms).map(x=>x.valor),["diferente"]);
r=(await flow(["diferente",{forma:"dinheiro"},"65"],{item:offline,irmas:[offline]})).r;assert.equal(r.porRow[1].valor,65);
r=(await flow(["manter"],{anterior:{forma:"credito-entrega",valor:80,digitado:true}})).r;assert.equal(r.manteve,true);
r=(await flow([{forma:"dinheiro"},"75"],{anterior:{forma:"credito-entrega",valor:null,naoSei:true}})).r;assert.equal(r.porRow[1].valor,75,"resposta vazia anterior não permite manter");
r=(await flow([{forma:"dinheiro"},"75"],{anterior:{forma:"credito-entrega",valor:80,aprovacao:"rejeitado"}})).r;assert.equal(r.porRow[1].valor,75);
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
const page=readFileSync("public/assets/page-entregas.js","utf8");
for(const guard of ["if (pgA && pgA.cancelado) return;","if (pgRes && pgRes.cancelado) return;","resC.cancelado"])assert.ok(page.includes(guard),guard);
console.log("PASS app: parse, cofre, grupos, cartão único com identidade fiscal, formas proibidas inclusive cache antigo, vale identificado, valor obrigatório, cancelamento, correção e comprovante offline.");
