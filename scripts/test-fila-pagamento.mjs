// Código real do app em VM, fetch e armazenamento fictícios. Não faz chamadas externas.
// node scripts/test-fila-pagamento.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const coreSource=fs.readFileSync(path.join(root,'public/assets/core.js'),'utf8');
const portaSource=fs.readFileSync(path.join(root,'public/assets/pagamento-porta.js'),'utf8');
const pageSource=fs.readFileSync(path.join(root,'public/assets/page-entregas.js'),'utf8');
const T0='2026-09-08T11:59:00.000Z',T1='2026-09-08T12:00:00.000Z',T2='2026-09-08T12:01:00.000Z',T3='2026-09-08T12:02:00.000Z';
const QUEUE='teste_fila_v1';
const paid={forma:'dinheiro',operadora:null,valor:95,digitado:true};
const forms=[{chave:'dinheiro',rotulo:'Dinheiro'},{chave:'credito-entrega',rotulo:'Crédito'}];
const copy=x=>JSON.parse(JSON.stringify(x));
const accepted={ok:true,pagamento:{gravado:true}};
const denied={ok:true,pagamento:{gravado:false,porque:'Confira o valor fictício'}};
function storage(map){return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
function pageFunction(name){
  // Extrai a declaração inteira, sem substituir lógica. O fechamento no mesmo nível de
  // indentação evita trazer inicialização da tela e timers de UI para um teste da fila.
  const match=pageSource.match(new RegExp('^  (?:async )?function '+name+'\\([^]*?^  }','m'));
  assert.ok(match,'Função real ausente: '+name);return match[0];
}
function harness({store=new Map(),handler=async()=>accepted}={}){
  const calls=[],alerts=[],timeouts=[],state={pgRespondido:{}};
  let transport=handler;
  const window={APP_CONFIG:{API_URL:'https://app.ficticio.invalid/api',API_MODE:'json',API_RETRY_COUNT:0,
    API_TIMEOUT_MS:15000,STORAGE_CACHE_PREFIX:'teste_',STORAGE_DRIVER_KEY:'teste_driver',STORAGE_TOKEN_KEY:'teste_token'},
    location:{origin:'https://app.ficticio.invalid'}};
  const ctx=vm.createContext({window,localStorage:storage(store),sessionStorage:storage(new Map()),
    navigator:{userAgent:'teste-node',onLine:true},URL,URLSearchParams,AbortController,Date,Map,Set,Number,String,Array,
    console,Response,queueMicrotask,
    // Acelera somente a espera entre retries; o relógio e o código de envio continuam reais.
    setTimeout:(fn,ms)=>{timeouts.push(ms);const timer={cancelled:false};if(ms<5000)queueMicrotask(()=>{if(!timer.cancelled)fn();});return timer;},
    clearTimeout:timer=>{if(timer)timer.cancelled=true;},
    fetch:async(url,options)=>{
      const parsed=new URL(url);assert.equal(parsed.origin,'https://app.ficticio.invalid');
      assert.equal(options.method,'GET');const params=Object.fromEntries(parsed.searchParams);
      calls.push(copy(params));const result=await transport(params,calls.length);
      return Response.json(result);
    }
  });
  vm.runInContext(coreSource,ctx,{filename:'public/assets/core.js'});
  vm.runInContext(portaSource,ctx,{filename:'public/assets/pagamento-porta.js'});
  const api=window.AppEntrega;
  const ui={alerta:async(message,options)=>{alerts.push({message,options});return true;}};
  Object.assign(ctx,{api,state,AppUI:ui});window.AppUI=ui;
  const page=vm.runInContext(pageFunction('pgRespostaAnterior')+'\n'+pageFunction('enviarConfirmacao')+
    '\n({pgRespostaAnterior,enviarConfirmacao});',ctx,{filename:'public/assets/page-entregas.js (funções reais)'});
  return {api,Pg:window.PgPorta,state,calls,alerts,store,
    timeouts,send:page.enviarConfirmacao,previous:page.pgRespostaAnterior,
    setHandler:h=>{transport=h;},queue:()=>JSON.parse(store.get(QUEUE)||'[]'),
    enqueue(row,tsDevice=T1,{refused=false,reason='Recusa fictícia',response=paid,action='confirmarPagamento'}={}){
      const params=action==='confirmarPagamento'?window.PgPorta.montarParams(row,tsDevice,response,true):{action,row,ts_device:tsDevice};
      api.enfileirar(params,{row,...(refused?{erroPagamento:reason}:{})});
      return JSON.parse(store.get(QUEUE)).at(-1).id;
    }};
}
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
const signatures=h=>h.queue().map(x=>[x.params.row,x.params.ts_device,x.precisaCorrigir,x.params.action]);

test('recusa no reenvio prevalece sobre pgRespondido e sobrevive ao reload',async()=>{
  const h=harness({handler:async()=>denied});await h.send(1,paid,T1,true);
  assert.equal(h.calls.length,0);assert.equal(h.state.pgRespondido[1].tsDevice,T1);
  assert.equal(h.previous(1,{}).rejeitada,false);
  await h.api.processarFila();assert.equal(h.queue().length,1);assert.equal(h.queue()[0].precisaCorrigir,true);
  const previous=h.previous(1,{});assert.equal(previous.rejeitada,true);assert.match(previous.erro,/valor fictício/);
  assert.equal(h.Pg.respostaCompleta(previous,forms),false);assert.match(h.Pg.fraseResposta(previous,forms),/Corrigir pagamento/);
  assert.equal(h.state.pgRespondido[1].valor,95,'memória continua presente: é a fila real que vence');
  const reloaded=harness({store:h.store});assert.equal(reloaded.previous(1,{}).rejeitada,true);
  const before=copy(reloaded.queue());await reloaded.api.processarFila();
  assert.deepEqual(reloaded.queue(),before);assert.equal(reloaded.calls.length,0,'recusa aguarda correção, não fica tentando sozinha');
});
test('correção direta aceita limpa somente recusas até seu timestamp e do mesmo pedido',async()=>{
  const h=harness();h.enqueue(1,T0,{refused:true});h.enqueue(1,T2,{refused:true});
  h.enqueue(1,T3,{refused:true,reason:'Recusa posterior'});h.enqueue(2,T0,{refused:true});
  h.enqueue(1,T1,{action:'marcarEntregue'});
  await h.send(1,{...paid,valor:100},T2,false);
  assert.deepEqual(signatures(h),[[1,T3,true,'confirmarPagamento'],[2,T0,true,'confirmarPagamento'],[1,T1,false,'marcarEntregue']]);
  assert.equal(h.previous(1,{}).erro,'Recusa posterior','nova recusa continua visível apesar da correção antiga aceita');
  assert.equal(h.previous(2,{}).rejeitada,true);
});
test('correção aceita pela fila limpa antigas e preserva recusa posterior/outro pedido',async()=>{
  const h=harness();h.enqueue(1,T0,{refused:true});h.enqueue(1,T2,{response:{...paid,valor:100}});
  h.enqueue(1,T3,{refused:true});h.enqueue(2,T0,{refused:true});
  await h.api.processarFila();
  assert.deepEqual(signatures(h),[[1,T3,true,'confirmarPagamento'],[2,T0,true,'confirmarPagamento']]);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].ts_device,T2);
});
test('timestamp inválido nunca autoriza apagar uma declaração',async()=>{
  const h=harness();h.enqueue(1,T1,{refused:true});h.enqueue(1,'invalido',{refused:true});
  const before=copy(h.queue());h.api.removerConfirmacoesRecusadas(1,'invalido');assert.deepEqual(h.queue(),before);
  h.api.removerConfirmacoesRecusadas(1,T2);assert.equal(h.queue().length,1);assert.equal(h.queue()[0].params.ts_device,'invalido');
});
test('ok sem pagamento.gravado===true não remove pagamento nem recusa anterior',async()=>{
  for(const response of [{ok:true},{ok:true,pagamento:{}},{ok:true,pagamento:{gravado:'true'}},{ok:true,pagamento:{gravado:1}}]){
    const h=harness({handler:async()=>response});h.enqueue(1,T0,{refused:true});h.enqueue(1,T2);
    const before=copy(h.queue());await h.api.processarFila();assert.deepEqual(h.queue(),before);
    const x=harness({handler:async()=>response});x.enqueue(1,T0,{refused:true});
    await x.send(1,paid,T2,false);assert.equal(x.queue().length,2);assert.equal(x.queue()[1].params.pg_fila,1);
    assert.equal(x.queue()[1].params.ts_device,T2);assert.equal(x.queue()[0].precisaCorrigir,true);
  }
});
test('falha de rede e reload preservam payload, timestamp e correção pendente',async()=>{
  const offline=async()=>{throw Error('Sem rede fictícia');};
  const h=harness({handler:offline});await h.send(1,paid,T1,false);
  assert.equal(h.calls.length,4,'tentativa inicial e três retries reais');
  assert.equal(h.queue().length,1);assert.equal(h.queue()[0].params.pg_fila,1);
  const before=copy(h.queue());await h.api.processarFila();assert.deepEqual(h.queue(),before);
  const reloaded=harness({store:h.store,handler:offline});assert.equal(reloaded.previous(1,{}).valor,95);
  await reloaded.api.processarFila();assert.deepEqual(reloaded.queue(),before);
  reloaded.setHandler(async()=>accepted);await reloaded.api.processarFila();assert.equal(reloaded.queue().length,0);
  assert.equal(reloaded.calls.at(-1).ts_device,T1);
});
test('pendência antiga não expira e erro transitório do pagamento não bloqueia entrega posterior',async()=>{
  const h=harness({handler:async p=>p.action==='confirmarPagamento'?{ok:false,tentarDepois:true}:{ok:true}});
  h.enqueue(1,T1);h.enqueue(2,T2,{action:'marcarEntregue'});
  const q=h.queue();q[0].ts=Date.now()-30*24*60*60*1000;h.store.set(QUEUE,JSON.stringify(q));
  await h.api.processarFila();assert.equal(h.queue().length,1);assert.equal(h.queue()[0].params.row,1);
  assert.equal(h.queue()[0].precisaCorrigir,false);assert.deepEqual(h.calls.map(x=>x.action),['confirmarPagamento','marcarEntregue']);
});
test('entrega não encontrada retém pagamento como recusa, mas remove marcação sem destino',async()=>{
  const h=harness({handler:async()=>({ok:false,naoEncontrado:true})});
  h.enqueue(1,T1);h.enqueue(2,T2,{action:'marcarEntregue'});await h.api.processarFila();
  assert.equal(h.queue().length,1);assert.equal(h.queue()[0].precisaCorrigir,true);
  assert.match(h.previous(1,{}).erro,/Entrega não encontrada/);
});
test('recusa direta preserva valor e mostra aviso; correção nova aceita deixa de mostrá-la',async()=>{
  const h=harness({handler:async()=>denied});await h.send(1,paid,T1,false);
  assert.equal(h.state.pgRespondido[1],undefined);assert.equal(h.queue()[0].params.pg_valor,'95.00');
  assert.equal(h.previous(1,{}).rejeitada,true);assert.equal(h.alerts.length,1);
  h.setHandler(async()=>accepted);await h.send(1,{...paid,valor:100},T2,false);
  assert.equal(h.queue().length,0);assert.equal(h.previous(1,{}).valor,100);
  assert.equal(h.Pg.respostaCompleta(h.previous(1,{}),forms),true);
});
test('recusa tardia de envio antigo não apaga resposta nova já aceita',async()=>{
  let release,started;
  const entered=new Promise(r=>{started=r;});
  const h=harness({handler:async p=>{
    if(p.ts_device===T1){started();return new Promise(r=>{release=r;});}return accepted;
  }});
  const old=h.send(1,paid,T1,false);await entered;
  await h.send(1,{...paid,valor:100},T2,false);release(denied);await old;
  assert.equal(h.queue().length,1,'recusa recebida tarde permanece auditável');
  assert.equal(h.queue()[0].precisaCorrigir,true);assert.equal(h.state.pgRespondido[1].tsDevice,T2);
  assert.equal(h.previous(1,{}).valor,100);assert.equal(h.previous(1,{}).rejeitada,undefined);
});
test('processarFila simultâneo não duplica tentativa e preserva recusa chegada durante envio',async()=>{
  let release,started;const entered=new Promise(r=>{started=r;});
  const h=harness({handler:async()=>{started();return new Promise(r=>{release=r;});}});
  h.enqueue(1,T1);const first=h.api.processarFila();await entered;
  h.enqueue(1,T3,{refused:true});await h.api.processarFila();assert.equal(h.calls.length,1);
  release(accepted);await first;assert.deepEqual(signatures(h),[[1,T3,true,'confirmarPagamento']]);
});
test('somente confirmarPagamento espera 45s, inclusive após recarregar a fila',async()=>{
  const h=harness();await h.send(1,paid,T1,false);
  assert.deepEqual(h.timeouts,[45000]);
  await h.api.apiGet({action:'marcarEntregue',row:1},{retries:0});
  assert.deepEqual(h.timeouts,[45000,15000]);
  h.enqueue(2,T2);const reloaded=harness({store:h.store});await reloaded.api.processarFila();
  assert.deepEqual(reloaded.timeouts,[45000]);assert.equal(reloaded.queue().length,0);
});
test('recebimento coletivo conserva intenção idêntica após falha e recarga',async()=>{
  const response={forma:'credito-entrega',operadora:null,valor:140,digitado:false,
    grupo:'1:'+T1,grupoRows:[1,2],cartaoAgrupado:true};
  const h=harness({handler:async()=>{throw Error('ACK perdido fictício');}});
  await h.send(1,response,T1,false);
  const payload=copy(h.queue()[0].params);
  const reloaded=harness({store:h.store});await reloaded.api.processarFila();
  assert.deepEqual(reloaded.calls[0],Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,String(v)])));
  assert.equal(reloaded.calls[0].pg_grupo,'1:'+T1);
  assert.equal(reloaded.calls[0].pg_valor,'140.00');assert.equal(reloaded.queue().length,0);
});
let failures=0;
for(const [name,run] of tests){try{await run();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+'\n'+e.stack);}}
console.log(`${tests.length-failures}/${tests.length} cenários da fila com código real; somente transporte e storage fictícios.`);
if(failures)process.exitCode=1;
