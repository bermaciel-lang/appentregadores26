// Código real do app e store IndexedDB em VM; transporte fictício e fake-indexeddb. Sem chamadas externas.
// node scripts/test-fila-pagamento.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import os from 'node:os';
import {webcrypto} from 'node:crypto';
const require=createRequire(import.meta.url);
let idb;try{idb=require('fake-indexeddb');}catch{idb=require(path.join(os.homedir(),'.codex/tmp/rota-idb-testes/node_modules/fake-indexeddb'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const filaSource=fs.readFileSync(path.join(root,'public/assets/fila-duravel.js'),'utf8');
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
async function harness({store=new Map(),handler=async()=>accepted}={}){
  const calls=[],alerts=[],timeouts=[],storageWrites=[],statusUpdates=[],state={pgRespondido:{},expandidos:new Set(),items:[],rotaIniciada:true};
  let storageFailure=false,readHook=null,abortAckPut=null;
  let transport=handler,queueStore;
  if(!store.idb)store.idb=new idb.IDBFactory();
  if(!store.locks)store.locks=new Map();
  const factory={open:(...args)=>{
    const req=store.idb.open(...args);req.addEventListener('success',()=>{
      const db=req.result,transaction=db.transaction.bind(db);
      db.transaction=(stores,mode,...opts)=>{const tx=transaction(stores,mode,...opts);
        if(storageFailure&&mode==='readwrite')queueMicrotask(()=>tx.abort());
        if(mode==='readwrite' && abortAckPut){
          const objectStore=tx.objectStore.bind(tx);
          tx.objectStore=name=>{const st=objectStore(name),put=st.put.bind(st);
            st.put=value=>{const request=put(value);if(abortAckPut(value))queueMicrotask(()=>tx.abort());return request;};return st;};
        }
        return tx;};
    });return req;
  }};
  const window={APP_CONFIG:{API_URL:'https://app.ficticio.invalid/api',API_MODE:'json',API_RETRY_COUNT:0,
    API_TIMEOUT_MS:15000,STORAGE_CACHE_PREFIX:'teste_',STORAGE_DRIVER_KEY:'teste_driver',STORAGE_TOKEN_KEY:'teste_token'},
    location:{origin:'https://app.ficticio.invalid'},setTimeout:()=>0,indexedDB:factory,addEventListener:()=>{}};
  const local=storage(store);
  const ctx=vm.createContext({window,localStorage:{...local,getItem:k=>{const value=local.getItem(k);if(k===QUEUE && readHook){const hook=readHook;readHook=null;hook();}return value;},setItem:(k,v)=>{
      if(storageFailure)throw Error('QuotaExceededError fictícia');
      storageWrites.push({key:k,value:v});local.setItem(k,v);
    }},sessionStorage:storage(new Map()),
    navigator:{userAgent:'teste-node',onLine:true,locks:{request:async(name,options,fn)=>{
      if(store.locks.has(name))return fn(null);store.locks.set(name,true);
      try{return await fn({name});}finally{store.locks.delete(name);}
    }}},indexedDB:factory,crypto:webcrypto,URL,URLSearchParams,AbortController,Date,Map,Set,Number,String,Array,
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
  vm.runInContext(filaSource,ctx,{filename:'public/assets/fila-duravel.js'});
  const criar=window.FilaDuravel.criar;
  window.FilaDuravel.criar=options=>{
    queueStore=criar(options);const add=queueStore.adicionar;
    queueStore.adicionar=async entries=>{const ids=await add(entries);storageWrites.push({key:QUEUE,value:'commit IndexedDB'});return ids;};
    return queueStore;
  };
  vm.runInContext(coreSource,ctx,{filename:'public/assets/core.js'});
  vm.runInContext(portaSource,ctx,{filename:'public/assets/pagamento-porta.js'});
  const api=window.AppEntrega;
  const ui={alerta:async(message,options)=>{alerts.push({message,options});return true;}};
  Object.assign(ctx,{api,state,AppUI:ui,renderList:()=>{},carregarTudo:()=>{},
    updateLocalStatus:(row,status,obs)=>{statusUpdates.push({row,status,obs});const item=state.items.find(x=>Number(x.row)===Number(row));if(item)item.status=status;},
    conferirGrupoValores:async x=>x,coletarPagamento:async()=>ctx.paymentAnswer,
  });window.AppUI=ui;
  ui.escolher=async()=>ctx.choice||'maos';
  ui.perguntar=async()=>'';
  const page=vm.runInContext(pageFunction('pgRespostaAnterior')+'\n'+pageFunction('guardarRecebimento')+'\n'+pageFunction('enviarRecebimentoGuardado')+'\n'+pageFunction('enviarConfirmacao')+'\n'+pageFunction('handleAction')+
    '\n({pgRespostaAnterior,enviarConfirmacao,guardarRecebimento,enviarRecebimentoGuardado,handleAction});',ctx,{filename:'public/assets/page-entregas.js (funções reais)'});
  await api.filaPronta();
  return {api,Pg:window.PgPorta,state,calls,alerts,store,storageWrites,statusUpdates,
    timeouts,send:page.enviarConfirmacao,previous:page.pgRespostaAnterior,
    stage:async(...args)=>copy(await page.guardarRecebimento(...args)),flush:page.enviarRecebimentoGuardado,action:page.handleAction,
    setStorageFailure:yes=>{storageFailure=yes;},abortAckOn:predicate=>{abortAckPut=predicate;},withoutLocks:()=>{delete ctx.navigator.locks;},setReadHook:hook=>{readHook=hook;},
    setAnswer:answer=>{ctx.paymentAnswer=answer;},setChoice:choice=>{ctx.choice=choice;},
    setHandler:h=>{transport=h;},queue:()=>copy(queueStore.snapshot()||[]),refresh:()=>queueStore.ler(),
    close:()=>{queueStore.fechar();store.locks.clear();},
    waitQueue:async n=>{for(let i=0;i<100&&queueStore.snapshot().length!==n;i++)await new Promise(r=>setImmediate(r));assert.equal(queueStore.snapshot().length,n);},
    async enqueue(row,tsDevice=T1,{refused=false,reason='Recusa fictícia',response=paid,action='confirmarPagamento'}={}){
      const params=action==='confirmarPagamento'?window.PgPorta.montarParams(row,tsDevice,response,true):{action,row,ts_device:tsDevice};
      return api.enfileirar(params,{row,...(refused?{erroPagamento:reason}:{})});
    }};
}
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
const signatures=h=>h.queue().map(x=>[x.params.row,x.params.ts_device,x.precisaCorrigir,x.params.action]);

test('recusa no reenvio prevalece sobre pgRespondido e sobrevive ao reload',async()=>{
  const h=await harness({handler:async()=>denied});await h.send(1,paid,T1,true);
  assert.equal(h.calls.length,0);assert.equal(h.state.pgRespondido[1].tsDevice,T1);
  assert.equal(h.previous(1,{}).rejeitada,false);
  await h.api.processarFila();assert.equal(h.queue().length,1);assert.equal(h.queue()[0].precisaCorrigir,true);
  const previous=h.previous(1,{});assert.equal(previous.rejeitada,true);assert.match(previous.erro,/valor fictício/);
  assert.equal(h.Pg.respostaCompleta(previous,forms),false);assert.match(h.Pg.fraseResposta(previous,forms),/Corrigir pagamento/);
  assert.equal(h.state.pgRespondido[1].valor,95,'memória continua presente: é a fila real que vence');
  const reloaded=await harness({store:h.store});assert.equal(reloaded.previous(1,{}).rejeitada,true);
  const before=copy(reloaded.queue());await reloaded.api.processarFila();
  assert.deepEqual(reloaded.queue(),before);assert.equal(reloaded.calls.length,0,'recusa aguarda correção, não fica tentando sozinha');
});
test('correção direta aceita resolve somente declarações do pedido vistas no staging, sem comparar relógio',async()=>{
  const h=await harness();await h.enqueue(1,T0,{refused:true});await h.enqueue(1,T2,{refused:true});
  await h.enqueue(1,T3,{refused:true,reason:'Recusa posterior'});await h.enqueue(2,T0,{refused:true});
  await h.enqueue(1,T1,{action:'marcarEntregue'});
  await h.send(1,{...paid,valor:100},T2,false);
  assert.deepEqual(signatures(h),[[2,T0,true,'confirmarPagamento']]);
  assert.equal(h.previous(1,{}).valor,100,'todos os IDs anteriores vistos foram corrigidos, independentemente do horário');
  assert.equal(h.previous(2,{}).rejeitada,true);
});
test('correção aceita pela fila limpa antigas e preserva recusa posterior/outro pedido',async()=>{
  const h=await harness();await h.enqueue(1,T0,{refused:true});await h.enqueue(1,T2,{response:{...paid,valor:100}});
  await h.enqueue(1,T3,{refused:true});await h.enqueue(2,T0,{refused:true});
  await h.api.processarFila();
  assert.deepEqual(signatures(h),[[1,T3,true,'confirmarPagamento'],[2,T0,true,'confirmarPagamento']]);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].ts_device,T2);
});
test('legado sem vínculo explícito confirma só a própria entrada, mesmo com hora posterior',async()=>{
  const store=new Map(),legacy=await harness();
  await legacy.enqueue(1,T1,{refused:true});await legacy.enqueue(1,T3);
  store.set(QUEUE,JSON.stringify(legacy.queue()));
  const h=await harness({store});await h.api.processarFila();
  assert.deepEqual(signatures(h),[[1,T1,true,'confirmarPagamento']]);
  assert.equal(h.api.removerConfirmacoesRecusadas,undefined,'não existe API de apagar por relógio');
});

test('ok sem pagamento.gravado===true não remove pagamento nem recusa anterior',async()=>{
  for(const response of [{ok:true},{ok:true,pagamento:{}},{ok:true,pagamento:{gravado:'true'}},{ok:true,pagamento:{gravado:1}}]){
    const h=await harness({handler:async()=>response});await h.enqueue(1,T0,{refused:true});await h.enqueue(1,T2);
    const before=copy(h.queue());await h.api.processarFila();assert.deepEqual(h.queue(),before);
    const x=await harness({handler:async()=>response});await x.enqueue(1,T0,{refused:true});
    await x.send(1,paid,T2,false);assert.equal(x.queue().length,2);assert.equal(x.queue()[1].params.pg_fila,1);
    assert.equal(x.queue()[1].params.ts_device,T2);assert.equal(x.queue()[0].precisaCorrigir,true);
  }
});
test('falha de rede e reload preservam payload, timestamp e correção pendente',async()=>{
  const offline=async()=>{throw Error('Sem rede fictícia');};
  const h=await harness({handler:offline});await h.send(1,paid,T1,false);
  assert.equal(h.calls.length,2,'consumidor único: tentativa inicial e um retry real');
  assert.equal(h.queue().length,1);assert.equal(h.queue()[0].params.pg_fila,1);
  const before=copy(h.queue());await h.api.processarFila();assert.deepEqual(h.queue(),before);
  const reloaded=await harness({store:h.store,handler:offline});assert.equal(reloaded.previous(1,{}).valor,95);
  await reloaded.api.processarFila();assert.deepEqual(reloaded.queue(),before);
  reloaded.setHandler(async()=>accepted);await reloaded.api.processarFila();assert.equal(reloaded.queue().length,0);
  assert.equal(reloaded.calls.at(-1).ts_device,T1);
});
test('pendência antiga não expira e erro transitório do pagamento não bloqueia entrega posterior',async()=>{
  const h=await harness({handler:async p=>p.action==='confirmarPagamento'?{ok:false,tentarDepois:true}:{ok:true}});
  await h.enqueue(1,T1);await h.enqueue(2,T2,{action:'marcarEntregue'});

  await h.api.processarFila();assert.equal(h.queue().length,1);assert.equal(h.queue()[0].params.row,1);
  assert.equal(h.queue()[0].precisaCorrigir,false);assert.deepEqual(h.calls.map(x=>x.action),['confirmarPagamento','marcarEntregue']);
});
test('entrega não encontrada retém pagamento como recusa, mas remove marcação sem destino',async()=>{
  const h=await harness({handler:async()=>({ok:false,naoEncontrado:true})});
  await h.enqueue(1,T1);await h.enqueue(2,T2,{action:'marcarEntregue'});await h.api.processarFila();
  assert.equal(h.queue().length,1);assert.equal(h.queue()[0].precisaCorrigir,true);
  assert.match(h.previous(1,{}).erro,/Entrega não encontrada/);
});
test('recusa direta preserva valor e mostra aviso; correção nova aceita deixa de mostrá-la',async()=>{
  const h=await harness({handler:async()=>denied});await h.send(1,paid,T1,false);
  assert.equal(h.state.pgRespondido[1],undefined);assert.equal(h.queue()[0].params.pg_valor,'95.00');
  assert.equal(h.previous(1,{}).rejeitada,true);assert.equal(h.alerts.length,1);
  h.setHandler(async()=>accepted);await h.send(1,{...paid,valor:100},T2,false);
  assert.equal(h.queue().length,0);assert.equal(h.previous(1,{}).valor,100);
  assert.equal(h.Pg.respostaCompleta(h.previous(1,{}),forms),true);
});
test('correção nova aguarda consumidor único e recusa antiga não apaga resposta nova',async()=>{
  let release,started;
  const entered=new Promise(r=>{started=r;});
  const h=await harness({handler:async p=>{
    if(p.ts_device===T1){started();return new Promise(r=>{release=r;});}return accepted;
  }});
  const old=h.send(1,paid,T1,false);await entered;
  const corrected=h.send(1,{...paid,valor:100},T2,false);await h.waitQueue(2);
  assert.equal(h.calls.length,1);assert.equal(h.queue().length,2,'ambas declarações guardadas enquanto a primeira não responde');
  release(denied);await Promise.all([old,corrected]);
  assert.equal(h.queue().length,0,'recusa antiga só sai após ACK da correção');
  assert.equal(h.state.pgRespondido[1].tsDevice,T2);assert.equal(h.previous(1,{}).valor,100);
});
test('processarFila simultâneo não duplica tentativa e preserva recusa chegada durante envio',async()=>{
  let release,started;const entered=new Promise(r=>{started=r;});
  const h=await harness({handler:async()=>{started();return new Promise(r=>{release=r;});}});
  await h.enqueue(1,T1);const first=h.api.processarFila();await entered;
  await h.enqueue(1,T3,{refused:true});const simultaneous=h.api.processarFila();assert.equal(simultaneous,first);assert.equal(h.calls.length,1);
  release(accepted);await Promise.all([first,simultaneous]);assert.deepEqual(signatures(h),[[1,T3,true,'confirmarPagamento']]);
});
test('ACK antigo preserva recusa de outra aba criada depois com relógio atrasado e no reload',async()=>{
  let release,started;const entered=new Promise(r=>{started=r;}),store=new Map();
  const a=await harness({store,handler:async()=>{started();return new Promise(r=>{release=r;});}});
  const b=await harness({store});await a.enqueue(1,T2);const sending=a.api.processarFila();await entered;
  const newId=await b.enqueue(1,T0,{refused:true,reason:'Recusa nova com relógio atrasado'});
  release(accepted);await sending;await b.refresh();
  assert.equal(b.queue().length,1);assert.equal(b.queue()[0].id,newId);
  a.state.pgRespondido[1]={...paid,tsDevice:T3};await a.refresh();
  assert.equal(a.previous(1,{}).rejeitada,true,'memória com hora maior não esconde a recusa durável');
  const reload=await harness({store});assert.equal(reload.queue()[0].id,newId);
  assert.equal(reload.previous(1,{}).rejeitada,true);
});

test('ACK de correção e recusas vinculadas é atômico nos dois pontos de interrupção',async()=>{
  for(const interromperAlvo of [false,true]){
    const h=await harness();const anterior=await h.enqueue(1,T3,{refused:true});
    const corrigida=await h.enqueue(1,T0,{response:{...paid,valor:100}});
    h.abortAckOn(value=>value.estado==='ack' && (interromperAlvo?value.id===anterior:value.id===corrigida));
    const result=await h.api.processarFila();assert.ok(result.erroArmazenamento);
    const reload=await harness({store:h.store});
    assert.deepEqual(reload.queue().map(x=>x.id),[anterior,corrigida],'ambos sobrevivem ao aborto de qualquer parte do ACK');
    await reload.api.processarFila();assert.equal(reload.queue().length,0);
  }
});

test('somente confirmarPagamento espera 45s, inclusive após recarregar a fila',async()=>{
  const h=await harness();await h.send(1,paid,T1,false);
  assert.deepEqual(h.timeouts,[45000]);
  await h.api.apiGet({action:'marcarEntregue',row:1},{retries:0});
  assert.deepEqual(h.timeouts,[45000,15000]);
  await h.enqueue(2,T2);const reloaded=await harness({store:h.store});await reloaded.api.processarFila();
  assert.deepEqual(reloaded.timeouts,[45000]);assert.equal(reloaded.queue().length,0);
});
test('recebimento coletivo conserva intenção idêntica após falha e recarga',async()=>{
  const response={forma:'credito-entrega',operadora:null,valor:140,digitado:false,
    grupo:'1:'+T1,grupoRows:[1,2],cartaoAgrupado:true};
  const h=await harness({handler:async()=>{throw Error('ACK perdido fictício');}});
  await h.send(1,response,T1,false);
  const payload=copy(h.queue()[0].params);
  const reloaded=await harness({store:h.store});await reloaded.api.processarFila();
  assert.deepEqual(reloaded.calls[0],Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,String(v)])));
  assert.equal(reloaded.calls[0].pg_grupo,'1:'+T1);
  assert.equal(reloaded.calls[0].pg_valor,'140.00');assert.equal(reloaded.queue().length,0);
});
test('fechar durante primeiro request conserva as 40 entradas do grupo antes de qualquer ACK',async()=>{
  let started;const entered=new Promise(r=>{started=r;});
  const h=await harness({handler:async()=>{
    assert.equal(h.queue().length,40,'20 marcações e 20 pagamentos já persistidos antes da primeira rede');
    assert.equal(h.storageWrites.filter(w=>w.key===QUEUE).length,1,'um único commit contém o ato inteiro');
    started();return new Promise(()=>{}); // simula fechar o processo com fetch ainda pendente
  }});
  const porRow={};
  h.state.items=Array.from({length:20},(_,i)=>({row:i+1,numero:7,status:'Indo para entrega',naEntrega:true}));
  for(const item of h.state.items)porRow[item.row]={...paid,valor:2000,grupo:'1:'+T1,grupoRows:h.state.items.map(x=>x.row)};
  h.setAnswer({porRow});h.action('done',1);await entered;
  const guardadas=copy(h.queue());h.close();const reloaded=await harness({store:h.store});
  assert.deepEqual(reloaded.queue(),guardadas,'reload sem catch/finally mantém IDs e payload integral');
  await reloaded.api.processarFila();
  assert.equal(reloaded.calls.length,40);assert.equal(reloaded.queue().length,0);
  assert.deepEqual(reloaded.calls.map(p=>p.action),[
    ...Array(20).fill('marcarEntregue'),...Array(20).fill('confirmarPagamento')
  ]);
  assert.deepEqual(reloaded.calls.map(p=>p.ts_device),Array(40).fill(guardadas[0].params.ts_device));
});
test('ACK parcial seguido de fechamento remove somente a entrada confirmada e conserva recusa posterior',async()=>{
  let started;const entered=new Promise(r=>{started=r;});
  const h=await harness({handler:async(p,n)=>{if(n===1)return {ok:true};started();return new Promise(()=>{});}});
  const pg={1:{...paid,valor:200,grupo:'grupo-parcial',grupoRows:[1,2]},2:{...paid,valor:200,grupo:'grupo-parcial',grupoRows:[1,2]}};
  const ids=await h.stage([{action:'marcarEntregue',row:1,ts_device:T1},{action:'marcarEntregue',row:2,ts_device:T1}],pg,T1);
  h.flush(ids);await entered;assert.deepEqual(h.queue().map(x=>x.id),ids.slice(1));
  const pending=copy(h.queue());h.close();const reloaded=await harness({store:h.store,handler:async p=>p.action==='confirmarPagamento'&&p.row==='2'?denied:accepted});
  await reloaded.api.processarFila();assert.equal(reloaded.queue().length,1);
  assert.equal(reloaded.queue()[0].id,pending[2].id);assert.equal(reloaded.queue()[0].precisaCorrigir,true);
  assert.deepEqual(reloaded.queue()[0].params,pending[2].params);
});
test('correção também está persistida quando o fetch não terminou',async()=>{
  let started;const entered=new Promise(r=>{started=r;});
  const h=await harness({handler:async()=>{started();return new Promise(()=>{});}});
  h.send(1,{...paid,valor:99.90},T2,false);await entered;
  h.close();const x=await harness({store:h.store});assert.equal(x.queue().length,1);
  assert.equal(x.queue()[0].params.pg_valor,'99.90');assert.equal(x.queue()[0].params.ts_device,T2);
  await x.api.processarFila();assert.equal(x.queue().length,0);
});
test('porta do menu de entrega em andamento guarda todo o grupo antes da rede',async()=>{
  let started;const entered=new Promise(r=>{started=r;});
  const h=await harness({handler:async()=>{started();return new Promise(()=>{});}});
  h.state.items=[{row:1,numero:1,status:'Indo para entrega',naEntrega:true},{row:2,numero:1,status:'Indo para entrega',naEntrega:true},
    {row:3,numero:2,status:'',naEntrega:false}];
  h.setChoice('done');h.setAnswer({porRow:{1:paid,2:paid}});
  h.action('start',3);await entered;
  assert.equal(h.queue().length,4);assert.deepEqual(h.queue().map(x=>x.params.action),['marcarEntregue','marcarEntregue','confirmarPagamento','confirmarPagamento']);
  assert.equal(h.storageWrites.filter(x=>x.key===QUEUE).length,1);
});
test('falha de armazenamento aborta antes da rede e de mostrar entrega concluída',async()=>{
  const h=await harness();h.state.items=[{row:1,numero:1,status:'Indo para entrega',naEntrega:true}];
  h.setAnswer({porRow:{1:paid}});h.setStorageFailure(true);await h.action('done',1);
  assert.equal(h.calls.length,0);assert.equal(h.statusUpdates.length,0);assert.equal(h.state.items[0].status,'Indo para entrega');
  assert.deepEqual(h.state.pgRespondido,{});assert.equal(h.alerts.length,1);assert.equal(h.queue().length,0);
});
test('fila ilegível nunca é sobrescrita ao guardar uma nova confirmação',async()=>{
  const h=await harness();h.store.set(QUEUE,'{fila-incompleta');
  await assert.rejects(()=>h.stage([],{1:paid},T1));assert.equal(h.store.get(QUEUE),'{fila-incompleta');
  assert.equal(h.calls.length,0);assert.deepEqual(h.state.pgRespondido,{});
});
test('resposta antiga de outro contexto não ressuscita item já corrigido e confirmado',async()=>{
  let started,release;const entered=new Promise(r=>{started=r;});
  const h=await harness({handler:async p=>{if(p.ts_device!==T1)return accepted;started();return new Promise(r=>{release=r;});}});
  const first=h.send(1,paid,T1,false);await entered;
  const reloaded=await harness({store:h.store,handler:async p=>p.ts_device===T1?denied:accepted});
  await reloaded.send(1,{...paid,valor:100},T2,false);assert.equal(reloaded.queue().length,2,'outra aba guardou mas não abriu segundo consumidor');
  release(denied);await first;await reloaded.refresh();assert.equal(reloaded.queue().length,0);
  assert.equal(reloaded.state.pgRespondido[1].valor,100);
});
test('sem Web Locks guarda o ato, mas não inicia envio nem confunde com ACK do servidor',async()=>{
  const h=await harness();h.withoutLocks();await h.send(1,paid,T1,false);
  assert.equal(h.calls.length,0);assert.equal(h.queue().length,1);
  assert.match(h.alerts[0].message,/Atualize este navegador/);
  assert.equal(h.api.filaEstado().sincronizacaoDisponivel,false);
});
test('duas abas adicionam sem sobrescrever e ACK não elimina o lote concorrente',async()=>{
  const store=new Map(),a=await harness({store}),b=await harness({store});
  const [idA,idB]=await Promise.all([a.stage([],{1:paid},T1),b.stage([],{2:paid},T2)]);
  await a.refresh();assert.deepEqual(a.queue().map(x=>x.params.row).sort(),[1,2]);
  assert.equal(new Set(a.queue().map(x=>x.id)).size,2);
  a.setHandler(async p=>p.row==='1'?accepted:{ok:false,tentarDepois:true});
  await a.api.processarFila();await b.refresh();
  assert.deepEqual(b.queue().map(x=>x.id),idB);
  assert.equal(b.queue()[0].params.pg_valor,'95.00');
});
let failures=0;
for(const [name,run] of tests){try{await run();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+'\n'+e.stack);}}
console.log(`${tests.length-failures}/${tests.length} cenários da fila com código real; somente transporte e storage fictícios.`);
if(failures)process.exitCode=1;
