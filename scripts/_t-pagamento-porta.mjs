import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
// ⛔ CAMINHO FIXO AQUI JÁ MATOU ESTA RÉGUA. A régua de MUTAÇÃO (_t-pagamento-porta-reintroducao.mjs)
// planta defeitos numa CÓPIA e a aponta por PG_PORTA_PATH; se este require ignorar a variável, a
// régua testa o ORIGINAL a cada rodada, todo defeito plantado "fica verde", e a mutação vira ruído.
// Aconteceu em 09/09 e de novo em 10/09/2026. Não voltar a fixar o caminho.
const ALVO=process.env.PG_PORTA_PATH || "../public/assets/pagamento-porta.js";
const Pg=createRequire(import.meta.url)(ALVO);
console.log("alvo="+ALVO); // a mutação CONFERE este eco — é a auto-prova de que o mutante foi lido
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
r=(await flow(["diferente",{grupo:"vale"},{forma:"bling-822307"},"sim","100"])).r;assert.equal(r.porRow[1].forma,"bling-822307");  // vale != cartao; valor igual nao pergunta
r=(await flow(["diferente",{grupo:"vale"},{forma:"vale",operadora:"outra"},"Vale Fictício","sim","90","sim"])).r;
assert.equal(r.porRow[1].valeNome,"Vale Fictício");
r=(await flow(["diferente",{grupo:"vale"},null,null])).r;assert.equal(r.cancelado,true);
r=(await flow(["diferente",{forma:"nao-pagou"},"sim"])).r;
assert.equal(r.porRow[1].forma,"nao-pagou");assert.equal(r.porRow[1].valor,null);
const zero={...item,valor:0};r=(await flow(["igual"],{item:zero,irmas:[zero]})).r;assert.equal(r.porRow[1].valor,0);
const offline={...item,valorConferido:false};assert.deepEqual(Pg.opcoesTela1(offline,[offline],forms).map(x=>x.valor),["diferente"]);
r=(await flow(["diferente",{forma:"dinheiro"},"sim","65"],{item:offline,irmas:[offline]})).r;assert.equal(r.porRow[1].valor,65);  // sem valor confirmado nao ha o que comparar
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
// Os buracos que a revisao adversarial de 09/09 achou (nunca voltar a comparar em reais):
assert.equal(Pg.discrepante(1668.30,166.83),true,"virgula andando uma casa: float dizia que NAO travava");
assert.equal(Pg.discrepante(2.12,21.20),true,"10x menor exato tambem escapava por float");
assert.equal(Pg.discrepante(2042.60,204.26),true,"o mesmo no primeiro caso real");
// ── MODAL DE DIFERENCA ────────────────────────────────────────────────────────────────────────
assert.equal(Pg.valorDivergente(100,100,"credito-entrega"),false,"igual nao pergunta");
assert.equal(Pg.valorDivergente(100.004,100,"credito-entrega"),false,"menos de 1 centavo nao e erro de digitacao");
assert.equal(Pg.valorDivergente(95,100,"credito-entrega"),true,"a menos pergunta");
assert.equal(Pg.valorDivergente(120,100,"credito-entrega"),true,"a mais no cartao pergunta");
assert.equal(Pg.valorDivergente(150,100,"dinheiro"),false,"DINHEIRO a mais e troco: nao pergunta");
assert.equal(Pg.valorDivergente(90,100,"dinheiro"),true,"dinheiro a MENOS pergunta");
assert.equal(Pg.valorDivergente(50,0,"dinheiro"),false,"sem valor de pedido nao pergunta");
// Teto do troco: sem ele "1668" num pedido de R$ 166,83 passava CALADO por ser "dinheiro a mais".
assert.equal(Pg.TROCO_MAX_CENTAVOS,20000);
assert.equal(Pg.valorDivergente(1668,166.83,"dinheiro"),true,"troco de R$ 1.501 nao e troco: pergunta");
assert.equal(Pg.valorDivergente(200,21.20,"dinheiro"),false,"nota de R$ 200 em pedido pequeno e troco de verdade");
assert.equal(Pg.valorDivergente(200,189.50,"dinheiro"),false,"o caso comum do dia nao pergunta");
assert.equal(Pg.valorDivergente(366.83,166.83,"dinheiro"),false,"exatamente R$ 200 de troco ainda passa");
assert.equal(Pg.valorDivergente(366.84,166.83,"dinheiro"),true,"um centavo acima do teto ja pergunta");
// TRAVA vale mesmo sem valor conferido (modo degradado) - era onde o erro real passava.
const semConf={...item,valorConferido:false};
let deg=await flow(["diferente",{grupo:"cartao"},"20426","204,26"],{item:semConf,irmas:[semConf]});
assert.ok(deg.u.avisos.some(m=>/MUITO longe/.test(m)),"offline tambem trava os 100x");
assert.equal(deg.r.porRow[1].valor,204.26,"e aceita o valor corrigido");
// Esgotar as tentativas avisa em vez de sumir com a entrega.
let esgota=await flow(["diferente",{grupo:"cartao"},"20426","20426","20426","20426","20426","20426"]);
assert.equal(esgota.r.cancelado,true);
assert.ok(esgota.u.avisos.some(m=>/NÃO foi salva/.test(m)),"avisa que a entrega nao foi salva");
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
// Relativo ao MÓDULO, não ao cwd: rodar de `scripts/` fazia a régua crashar, e a mutação lia o
// crash como "VERMELHO como devia" — falso vermelho que escondia 4 defeitos plantados.
const page=readFileSync(new URL("../public/assets/page-entregas.js",import.meta.url),"utf8");
for(const guard of ["if (pgA && pgA.cancelado) return;","if (pgRes && pgRes.cancelado) return;","resC.cancelado"])assert.ok(page.includes(guard),guard);
// ===== A trava de 10x NÃO pode recusar o troco que a própria tela manda declarar (10/09/2026) ===
// A tela diz "informe o total recebido em dinheiro, ANTES de devolver o troco". Num pedido pequeno
// pago com nota grande, obedecer era cair na trava e a ENTREGA NÃO ERA SALVA (6 voltas).
{const p1990={...item,valor:19.90,pgFormaChave:"dinheiro"};
 const troco=await flow(["diferente",{forma:"dinheiro"},"200"],{item:p1990,irmas:[p1990]});
 assert.equal(troco.r.porRow[1].valor,200,"nota de R$200 num pedido de R$19,90 tem de ser salva");
 assert.ok(!troco.r.cancelado,"declarar o dinheiro bruto nao pode abortar a entrega");
 assert.equal(troco.u.avisos.length,0,"declarar o dinheiro bruto nao pode gerar aviso de trava");}
// ...e a isenção NÃO pode enfraquecer a trava contra o erro real (vírgula andando casas).
assert.equal(Pg.discrepante(20426,204.26,"dinheiro"),true,"R$20.426 num pedido de R$204,26 continua travando");
assert.equal(Pg.discrepante(16680,166.83,"dinheiro"),true,"R$16.680 num pedido de R$166,83 continua travando");
assert.equal(Pg.discrepante(200,19.90,"dinheiro"),false,"troco de R$180,10 e plausivel");
assert.equal(Pg.discrepante(200,19.90,"credito-entrega"),true,"no CARTAO nao existe troco: continua travando");
assert.equal(Pg.discrepante(300,19.90,"dinheiro"),true,"acima do teto de R$200 de troco volta a travar");
assert.equal(Pg.discrepante(1,19.90,"dinheiro"),true,"dinheiro A MENOS nao tem isencao");

// ===== Os 4 PONTOS CEGOS que a régua de mutação achou em 10/09/2026, agora cobertos =====
// Antes deles, plantar cada um destes defeitos deixava esta régua VERDE. Não remover sem antes
// conferir na mutação que o defeito correspondente volta a ficar vermelho por outro caminho.

// 1. Cancelar o menu "MANTER ou CORRIGIR" (só aparece quando já há declaração anterior válida)
//    tem de abortar declarando `cancelado`. Sem isso a correção seguia calada e a entrega era
//    marcada como se o pagamento tivesse sido reconfirmado.
for(const x of [null,false,undefined]){const g=await flow([x],{anterior:{forma:"credito-entrega",valor:80,digitado:true}});
 assert.equal(g.r.cancelado,true,"cancelar o manter/corrigir tem de devolver cancelado");
 assert.equal(g.r.manteve,false,"cancelar o manter/corrigir nao pode contar como manter");
 assert.deepEqual(g.r.porRow,{},"cancelar o manter/corrigir nao pode declarar pagamento");}

// 2. Exceção dentro do modal NÃO pode vazar: vazando, derruba o "Entregue" inteiro (a entrega
//    some sem ninguém ver). Tem de virar `cancelado` + um aviso ao entregador.
{const uExplode={telas:[],avisos:[],escolher:async()=>{throw new Error("modal explodiu");},
  perguntar:async()=>null,alerta:async(m)=>{uExplode.avisos.push(m);return true;}};
 let saiu=null;
 try{saiu=await Pg.perguntar({item,irmas:[item],cfg,ui:uExplode,tsDevice:ts});}
 catch(e){assert.fail("excecao no modal VAZOU e derrubaria o Entregue: "+e.message);}
 assert.equal(saiu.cancelado,true,"excecao no modal tem de virar cancelado");
 assert.deepEqual(saiu.porRow,{},"excecao no modal nao pode declarar pagamento");
 assert.ok(uExplode.avisos.length>0,"excecao no modal tem de avisar o entregador");}

// 3. Valor DIGITADO tem de chegar marcado como digitado. `digitado:false` num valor que a pessoa
//    escreveu inventa uma fonte que não existe — o painel passa a tratar palpite como conferência.
{const d=await flow(["diferente",{grupo:"cartao"},"95,00","sim"]);
 assert.equal(d.r.porRow[1].valor,95);
 assert.equal(d.r.porRow[1].digitado,true,"valor escrito pelo entregador tem de vir digitado:true");}

// 4. O `ui.js` real resolve `false` (não `null`) no cancelar. Tratar só `null` fazia o cancelamento
//    virar resposta válida e o app seguir perguntando até esgotar as voltas. O sinal de que o
//    defeito voltou é o entregador levar aviso de "não foi salva" onde devia sair calado.
{const c=await flow(["diferente",{forma:"dinheiro"},"sim",false]);
 assert.equal(c.r.cancelado,true,"cancelar com false tem de abortar");
 assert.equal(c.u.avisos.length,0,"cancelar com false tem de sair na hora, sem esgotar as voltas");}

console.log("PASS app: trava 10x, modal de valor, modal de conta, parse, cofre, grupos, cartão único com identidade fiscal, formas proibidas inclusive cache antigo, vale identificado, valor obrigatório, cancelamento, correção, comprovante offline e os 4 pontos cegos de 10/09.");
