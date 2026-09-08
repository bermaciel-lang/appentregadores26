import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url), Pg=require("../public/assets/pagamento-porta.js");
const item={row:1,pedido:"LOJA-7",naEntrega:true,formaPagamento:"CREDITO NA ENTREGA",pgFormaChave:"credito-entrega",valor:100,valorConferido:false};
const formas=[{chave:"credito-entrega",rotulo:"Crédito"}], cfg={perguntar:true,formas};
let grupo=[item,{...item,row:2,valorConferido:true,valor:20}];grupo.soma=120;
assert.deepEqual(Pg.opcoesTela1(item,grupo,formas).map(x=>x.valor),["diferente"]);
assert.ok(!Pg.opcoesTela1(grupo[1],grupo,formas).some(x=>x.valor==="tudo"));
assert.ok(Pg.mensagemTela1(item,formas).includes("não foi confirmado"));
for(const [resposta,esperado] of [[null,null],["80,00",80]]){
 const passos=["diferente",{forma:"credito-entrega",operadora:null},resposta], telas=[];
 const ui={escolher:async()=>passos.shift(),perguntar:async(m,o)=>{telas.push(o);return passos.shift();},alerta:async()=>true};
 const r=await Pg.perguntar({item,irmas:[item],cfg,ui,tsDevice:"2026-09-08T23:00:00Z"});
 assert.equal(telas[0].valor,"");assert.equal(telas[0].textoCancelar,"Cancelar");
 if(esperado===null)assert.equal(r.cancelado,true); else assert.equal(r.porRow[1].valor,esperado);
 if(esperado!==null)assert.equal(r.porRow[1].digitado,true);
}
const zero={...item,valor:0,valorConferido:true};
assert.ok(Pg.opcoesTela1(zero,[zero],formas).some(x=>x.valor==="igual"));
assert.ok(!Pg.opcoesTela1({...zero,valor:null},[zero],formas).some(x=>x.valor==="igual"));
console.log("OK: valor não confirmado nunca vira pagamento implícito; pode informar comprovante offline; zero confirmado continua válido.");

const {readFileSync}=await import("node:fs"),{runInNewContext}=await import("node:vm");
const src=readFileSync("public/assets/core.js","utf8");
const bloco=src.slice(src.indexOf("function manterValorMaisRecente("),src.indexOf("async function carregarEntregasPorEntregador("));
const manter=runInNewContext(bloco+";manterValorMaisRecente",{Date,Number});
const recente={row:9,pedido:"ABCD-1234",valor:80,valorFonte:"instabuy",valorConferido:true,valorConsultadoEm:"2026-09-08T21:00:00Z"};
const espelho={row:9,pedido:"ABCD-1234",valor:100,valorFonte:"espelho",valorConferido:true,valorFonteEm:"2026-09-08T20:50:00Z"};
assert.equal(manter(espelho,[recente]).valor,80,"poll atrasado não desfaz leitura sob demanda");
assert.equal(manter({...espelho,valor:70,valorFonte:"erp"},[recente]).valor,70,"edição ERP sempre vence");
assert.equal(manter({...espelho,valor:60,valorFonteEm:"2026-09-08T21:01:00Z"},[recente]).valor,60,"captura nova substitui");
assert.equal(manter({...espelho,pedido:"OUTRO"},[recente]).valor,100,"não cruza pedidos");
assert.equal(manter({...espelho,valorConferido:false},[recente]).valorConferido,false,"erro não promove cache a confirmado");
console.log("OK: poll preserva consulta Instabuy mais recente, mas aceita edição ERP e nova sincronização.");

for (const fonte of ["loja","erp"]) {
 const anterior={...recente,valorFonte:fonte,produtos:[{nome:"Alface",qtd:1}]};
 const atrasado={...espelho,valorFonte:fonte,valorConsultadoEm:"2026-09-08T20:59:00Z",produtos:[{nome:"Alface",qtd:2}]};
 assert.equal(manter(atrasado,[anterior]).valor,80,fonte+": resposta atrasada não regride");
 assert.equal(manter(atrasado,[anterior]).produtos[0].qtd,1,fonte+": produtos acompanham snapshot novo");
 assert.equal(manter({...atrasado,valor:60,valorConsultadoEm:"2026-09-08T21:01:00Z"},[anterior]).valor,60,fonte+": edição mais nova entra");
}
{
 const passos=["corrigir",{forma:"credito-entrega",operadora:null},null],campos=[];
 const ui={escolher:async()=>passos.shift(),perguntar:async(m,o)=>{campos.push(o);return passos.shift();},alerta:async()=>true};
 const r=await Pg.perguntar({item,irmas:[item],cfg,ui,tsDevice:"2026-09-08T23:00:00Z",anterior:{forma:"credito-entrega",valor:80,digitado:true}});
 assert.equal(campos[0].valor,"");assert.equal(r.cancelado,true,"corrigir offline não substitui80 por cache100");
}
console.log("OK: respostas fora de ordem em loja/ERP e correção offline da declaração anterior.");

const invalido=manter(espelho,[{...recente,valorConferido:false}]);
assert.equal(invalido.valor,80);
assert.equal(invalido.valorConferido,false,"poll de espelho atrasado não revalida consulta invalidada");
console.log("OK: valor preservado sempre carrega a mesma evidência, inclusive conferência inválida.");
