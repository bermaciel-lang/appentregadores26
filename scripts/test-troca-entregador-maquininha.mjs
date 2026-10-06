// RÉGUA (06/10/2026) — troca de entregador sem confusão, PIN por pessoa, KM/foto por pessoa, maquininha e a pergunta única.
// Código REAL do app (core.js, fila-duravel.js, pagamento-porta.js, maquininha.js) numa VM; transporte e IndexedDB fictícios.
// Roda: node scripts/test-troca-entregador-maquininha.mjs
//
// O QUE ELA PROVA
//   T1 cada entregador tem o SEU token no aparelho (trocar não apaga; o token antigo, de uma chave só, ainda vale);
//   T2 a fila sobe com o token de QUEM tocou — o item de A não vai com o token de B; sem token de A, espera;
//   T3 `precisaLogin` apaga só o token USADO naquela chamada;
//   T4 o KM/foto pendente é POR ENTREGADOR (B não vê o "já iniciou" de A; a chave antiga migra);
//   T5 a maquininha: grava na fila (`definirMaquininha`) com turno/dono, lê de volta, e a do servidor só vence se for mais nova;
//   T6 o DIA só vai junto quando o relógio do aparelho concorda com o do servidor;
//   T7 a pergunta única: um toque, todas as irmãs pagas na porta, `pg_simples=1` e valor VAZIO (o servidor completa);
//   T8 a lista da maquininha em ordem dos 4 últimos dígitos ("0437" antes de "3879").
// DEFEITOS PLANTADOS (06/10, um por vez, todos vermelhos — ver o relatório da sessão):
//   a) `tokenParaChamada` ignorando `params.entregador` → T2 ❌;  b) `podeEnviarAgora` sempre true → T2 ❌;
//   c) `tratarPrecisaLogin` apagando o token do ATIVO → T3 ❌;  d) `rotaPendKey` sem o nome → T4 ❌;
//   e) `montarParams` mandando o valor na pergunta única → T7 ❌.
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
const ler=f=>fs.readFileSync(path.join(root,'public/assets',f),'utf8');
const filaSource=ler('fila-duravel.js'),coreSource=ler('core.js'),portaSource=ler('pagamento-porta.js'),maqSource=ler('maquininha.js');
const copy=x=>JSON.parse(JSON.stringify(x));
function storage(map){return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),
  key:i=>[...map.keys()][i]??null,get length(){return map.size;}};}

async function harness({store=new Map(),handler=async()=>({ok:true})}={}){
  const calls=[];let transport=handler;
  if(!store.idb)store.idb=new idb.IDBFactory();
  if(!store.locks)store.locks=new Map();
  const window={APP_CONFIG:{API_URL:'https://app.ficticio.invalid/api',API_MODE:'json',API_RETRY_COUNT:0,API_TIMEOUT_MS:15000,
    STORAGE_CACHE_PREFIX:'teste_',STORAGE_DRIVER_KEY:'teste_driver',STORAGE_TOKEN_KEY:'teste_token'},
    location:{origin:'https://app.ficticio.invalid'},setTimeout:()=>0,indexedDB:{open:(...a)=>store.idb.open(...a)},addEventListener:()=>{}};
  const local=storage(store.ls||(store.ls=new Map()));
  const ctx=vm.createContext({window,localStorage:local,sessionStorage:storage(new Map()),
    navigator:{userAgent:'teste-node',onLine:true,locks:{request:async(name,options,fn)=>{
      if(store.locks.has(name))return fn(null);store.locks.set(name,true);
      try{return await fn({name});}finally{store.locks.delete(name);}}}},
    indexedDB:window.indexedDB,crypto:webcrypto,URL,URLSearchParams,AbortController,Date,Map,Set,Number,String,Array,Intl,
    console,Response,queueMicrotask,
    setTimeout:(fn,ms)=>{const t={c:false};if(ms<5000)queueMicrotask(()=>{if(!t.c)fn();});return t;},clearTimeout:t=>{if(t)t.c=true;},
    fetch:async(url,options)=>{const u=new URL(url);const params=Object.fromEntries(u.searchParams);
      if(options&&options.method==='POST'){Object.assign(params,JSON.parse(options.body||'{}'));}
      calls.push(copy(params));return Response.json(await transport(params,calls.length));}
  });
  vm.runInContext(filaSource,ctx,{filename:'fila-duravel.js'});
  vm.runInContext(coreSource,ctx,{filename:'core.js'});
  vm.runInContext(portaSource,ctx,{filename:'pagamento-porta.js'});
  vm.runInContext(maqSource,ctx,{filename:'maquininha.js'});
  const api=window.AppEntrega;await api.filaPronta();
  return {api,Pg:window.PgPorta,Maq:window.Maquininha,calls,store,local,setHandler:h=>{transport=h;},window};
}
const tests=[];const test=(n,f)=>tests.push([n,f]);
const diaSP=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());

test('T1 cada entregador tem o seu token; trocar não apaga; o token da chave antiga ainda vale',async()=>{
  const h=await harness();
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  h.api.saveDriverName('Beto');h.api.saveDriverToken('tok-beto','Beto');
  assert.equal(h.api.temToken('Ana'),true,'o token da Ana sobrevive à troca para o Beto');
  assert.equal(h.api.getDriverTokenInfo().token,'tok-beto');
  const g=await harness();g.local.setItem('teste_token',JSON.stringify({token:'tok-velho',nome:'Caio'}));
  assert.equal(g.api.temToken('Caio'),true,'quem atualizou o app não digita o PIN de novo');
  assert.equal(g.api.temToken('Ana'),false);
});

test('T2 a fila sobe com o token de QUEM tocou; sem o token dele, espera',async()=>{
  const h=await harness();
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  await h.api.enfileirar({action:'marcarEntregue',row:11,ts_device:'2026-10-06T13:00:00.000Z'},{row:11});
  h.api.saveDriverName('Beto');h.api.saveDriverToken('tok-beto','Beto');
  await h.api.enfileirar({action:'marcarEntregue',row:22,ts_device:'2026-10-06T13:05:00.000Z'},{row:22});
  await h.api.processarFila();
  const porRow=Object.fromEntries(h.calls.map(c=>[c.row,c]));
  assert.equal(porRow['11'].token,'tok-ana','o item da Ana sobe com o token DA ANA (antes ia com o do Beto e virava recusa)');
  assert.equal(porRow['22'].token,'tok-beto');
  // sem token da Ana neste aparelho: o item dela ESPERA, nunca vai com o do Beto
  const g=await harness();
  g.api.saveDriverName('Ana');g.api.saveDriverToken('tok-ana','Ana');
  await g.api.enfileirar({action:'marcarEntregue',row:33,ts_device:'2026-10-06T13:00:00.000Z'},{row:33});
  g.api.clearDriverToken('Ana');g.api.saveDriverName('Beto');g.api.saveDriverToken('tok-beto','Beto');
  await g.api.processarFila();
  assert.equal(g.calls.filter(c=>c.row==='33').length,0,'o item da Ana não sobe sem a identidade dela');
  assert.equal(g.api.filaRowsPendentes().size,0,'…e não conta como pendência do Beto');
});

test('T3 precisaLogin apaga só o token usado naquela chamada',async()=>{
  const h=await harness({handler:async p=>p.token==='tok-ana'?{ok:false,precisaLogin:true,error:'x'}:{ok:true}});
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  await h.api.enfileirar({action:'marcarEntregue',row:44,ts_device:'2026-10-06T13:00:00.000Z'},{row:44});
  h.api.saveDriverName('Beto');h.api.saveDriverToken('tok-beto','Beto');
  await h.api.processarFila();
  assert.equal(h.api.temToken('Ana'),false,'o token recusado (da Ana) sai');
  assert.equal(h.api.temToken('Beto'),true,'o do Beto (ativo) fica');
});

test('T4 o KM/foto pendente é por entregador, e a chave antiga migra',async()=>{
  const h=await harness({handler:async()=>{throw new Error('sem sinal');}});
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  const r=await h.api.apiIniciarRota('Ana','123','','image/jpeg');
  assert.equal(r.pendenteEnvio,true);
  assert.equal(h.api.temRotaPendenteFase('inicio'),true,'a Ana vê o início dela guardado');
  h.api.saveDriverName('Beto');
  assert.equal(h.api.temRotaPendenteFase('inicio'),false,'o Beto NÃO ouve "você já iniciou a rota" por causa da Ana');
  const g=await harness();
  g.local.setItem('teste_rota_pend_inicio',JSON.stringify({action:'iniciarRota',entregador:'Caio',kmInicial:'5',turno:'MANHÃ'}));
  g.api.saveDriverName('Caio');
  assert.equal(g.api.temRotaPendenteFase('inicio'),true,'o pendente da chave antiga (sem nome) migra para o dono dele');
  assert.equal(g.local.getItem('teste_rota_pend_inicio'),null);
});

test('T5 maquininha: grava na fila com turno e dono; a do servidor só vence se for mais nova',async()=>{
  const h=await harness();
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  const reg=await h.api.registrarMaquininha({id:2,terminal:'1504656',final4:'4656'});
  assert.equal(reg.final4,'4656');
  const fila=copy((await h.api.filaPorIds([])).length===0?[]:[]);void fila;
  await h.api.processarFila();
  const c=h.calls.find(x=>x.action==='definirMaquininha');
  assert.ok(c,'a escolha subiu como definirMaquininha');
  assert.equal(c.terminal,'1504656');assert.equal(c.maquininha_id,'2');assert.equal(c.sem,'0');assert.ok(c.turno);assert.equal(c.entregador,'Ana');assert.equal(c.token,'tok-ana');
  assert.equal(h.api.lerEscolhaMaquininha().final4,'4656');
  const velha={semMaquininha:true,automatico:true,em:'2020-01-01T00:00:00.000Z'};
  assert.equal(h.api.sincronizarEscolhaDoServidor(velha,'Ana').final4,'4656','a do servidor mais VELHA não passa por cima');
  const nova={semMaquininha:false,id:5,terminal:'1504640',final4:'4640',em:new Date(Date.now()+60000).toISOString()};
  assert.equal(h.api.sincronizarEscolhaDoServidor(nova,'Ana').final4,'4640','a do servidor mais NOVA (corrigida no painel) vence');
  await h.api.registrarMaquininha({semMaquininha:true,automatico:true});
  await h.api.processarFila();
  const sem=h.calls.filter(x=>x.action==='definirMaquininha').pop();
  assert.equal(sem.sem,'1');assert.equal(sem.auto,'1');assert.equal(sem.terminal,undefined);
});

test('T6 o dia só vai junto quando o aparelho concorda com o servidor',async()=>{
  const h=await harness();
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  await h.api.enfileirar({action:'marcarEntregue',row:55,ts_device:'2026-10-06T13:00:00.000Z'},{row:55});
  h.local.setItem('app_dia_servidor_v1',diaSP());
  await h.api.enfileirar({action:'marcarEntregue',row:56,ts_device:'2026-10-06T13:00:00.000Z'},{row:56});
  h.local.setItem('app_dia_servidor_v1','1999-01-01');
  await h.api.enfileirar({action:'marcarEntregue',row:57,ts_device:'2026-10-06T13:00:00.000Z'},{row:57});
  await h.api.processarFila();
  const por=Object.fromEntries(h.calls.map(c=>[c.row,c]));
  assert.equal(por['55'].data,undefined,'sem o dia do servidor, vai sem (o de antes)');
  assert.equal(por['56'].data,diaSP(),'relógio do aparelho = dia do servidor → o dia do toque vai junto');
  assert.equal(por['57'].data,undefined,'aparelho com data diferente do servidor → não arrisca');
});

test('T7 a pergunta única: um toque, todas as irmãs pagas na porta, valor vazio',async()=>{
  const h=await harness();
  let perguntas=0,msg='';
  let opsVistas='';
  const ui={escolher:async(m,ops,o)=>{perguntas++;msg=(o&&o.titulo||'')+' '+m;opsVistas=JSON.stringify(ops.map(o=>o.valor));return 'maquininha';}};
  const item={row:7,naEntrega:true,valor:50};const irma={row:8,naEntrega:true,valor:40.5};const online={row:9,naEntrega:false,valor:10};
  const r=await h.Pg.perguntarSimples({item,irmas:[item,irma,online],cfg:{perguntar:true,simples:true,opcoes:null},ui});
  assert.equal(perguntas,1,'UMA pergunta');
  assert.equal(opsVistas,JSON.stringify(['maquininha','dinheiro','cheque','nao-pagou']),'as 4 opções do dono, nessa ordem');
  assert.match(msg,/O cliente te pagou de alguma forma\?/);assert.match(msg,/90,50/);
  assert.deepEqual(Object.keys(r.porRow).map(Number).sort(),[7,8],'as duas pagas na porta; a online fica de fora');
  const p=h.Pg.montarParams(7,'2026-10-06T13:00:00.000Z',r.porRow[7],false);
  assert.equal(p.pg_simples,1);assert.equal(p.pg_valor,'');assert.equal(p.pg_forma,'maquininha');assert.equal(p.pg_digitado,0);
  assert.equal(h.Pg.montarParams(7,'2026-10-06T13:00:00.000Z',{forma:'dinheiro',simples:true,valor:50,digitado:true},false).pg_valor,'','na pergunta única o valor NUNCA vai do aparelho (o servidor usa o do pedido)');
  assert.equal(h.Pg.fraseResposta(r.porRow[7],[]),'Pagamento: 💳 Maquininha ✓');
  const cancel=await h.Pg.perguntarSimples({item,irmas:[item],cfg:{perguntar:true,simples:true},ui:{escolher:async()=>null}});
  assert.equal(cancel.cancelado,true,'cancelar não confirma a entrega');
  const comPix=h.Pg.opcoesSimples({opcoes:['maquininha','dinheiro','pix','cheque','nao-pagou']}).map(o=>o.valor);
  assert.deepEqual(comPix,['maquininha','dinheiro','pix','cheque','nao-pagou']);
});

test('T8 a lista da maquininha pelos 4 últimos dígitos, como texto',async()=>{
  const h=await harness();
  const lista=['1274040','1504656','0437794','1273879','0437512','1274007'].map((t,i)=>({id:i+1,terminal:t}));
  assert.deepEqual(h.Maq.ordenar(lista).map(m=>h.Maq.final4(m)),['3879','4007','4040','4656','7512','7794']);
  assert.equal(h.Maq.rotulo(null),'💳 Informar maquininha');
  assert.equal(h.Maq.rotulo({final4:'4656'}),'💳 Maquininha 4656 · trocar');
});

// ===== Os cenários da revisão independente de 06/10 =====
test('R1 servidor que não conhece a maquininha: o app não pergunta (campo ausente ≠ "precisa")',async()=>{
  const antigo=await harness({handler:async p=>p.action==='entregas'?{ok:true,items:[],rotaIniciada:false}:{ok:true}});
  antigo.api.saveDriverName('Ana');antigo.api.saveDriverToken('tok-ana','Ana');
  const r=await antigo.api.carregarEntregasPorEntregador('Ana');
  assert.equal(r.servidorTemMaquininha,false,'painel antigo: não sabe da maquininha');
  assert.equal(r.precisaMaquininha,undefined,'…e o "precisa" fica INDEFINIDO, não null (null = pergunta)');
  const novo=await harness({handler:async p=>p.action==='entregas'?{ok:true,items:[],rotaIniciada:false,precisaMaquininha:false,maquininhas:[]}:{ok:true}});
  novo.api.saveDriverName('Ana');novo.api.saveDriverToken('tok-ana','Ana');
  const r2=await novo.api.carregarEntregasPorEntregador('Ana');
  assert.equal(r2.servidorTemMaquininha,true);assert.equal(r2.precisaMaquininha,false);
});

test('R2 pagamento recusado pelo servidor nunca aparece verde, nem na pergunta única',async()=>{
  const h=await harness();
  assert.match(h.Pg.fraseResposta({simples:true,forma:'maquininha',rejeitada:true,erro:'Forma não ativa'},[]),/Corrigir pagamento/);
  assert.equal(h.Pg.opcoesSimples({opcoes:['boleto']}).length,4,'opções desconhecidas → as 4 do dono, nunca modal vazio');
});

test('R3 token de quem SAIU do aparelho: entra sem PIN só no prazo; a fila dele sobe sempre',async()=>{
  const h=await harness();
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  await h.api.enfileirar({action:'marcarEntregue',row:71,ts_device:'2026-10-06T13:00:00.000Z'},{row:71});
  h.api.saveDriverName('Beto');h.api.saveDriverToken('tok-beto','Beto');
  assert.equal(h.api.temToken('Ana'),true,'logo depois da troca a Ana volta sem PIN');
  const o=JSON.parse(h.local.getItem('app_entregas_tokens_v2'));o.Ana.saiu=Date.now()-17*3600*1000;h.local.setItem('app_entregas_tokens_v2',JSON.stringify(o));
  assert.equal(h.api.temToken('Ana'),false,'17 h depois: a Ana precisa do PIN para ENTRAR');
  assert.equal(h.api.temToken('Beto'),true,'o ativo nunca expira (celular pessoal não pede PIN de novo)');
  await h.api.processarFila();
  assert.equal(h.calls.find(c=>c.row==='71').token,'tok-ana','…mas a fila que a Ana deixou ainda sobe com o token dela');
});

test('R4 precisaLogin só apaga o token se ainda for o MESMO que foi na chamada',async()=>{
  let h;
  h=await harness({handler:async p=>{ if(p.action==='marcarEntregue'){ h.api.saveDriverToken('tok-novo','Ana'); return {ok:false,precisaLogin:true}; } return {ok:true}; }});
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-velho','Ana');
  await h.api.enfileirar({action:'marcarEntregue',row:81,ts_device:'2026-10-06T13:00:00.000Z'},{row:81});
  await h.api.processarFila();
  assert.equal(h.api.getDriverTokenInfo().token,'tok-novo','o PIN digitado durante a chamada não é apagado pela resposta velha');
});

test('R5 marcações presas de outro entregador aparecem com o nome',async()=>{
  const h=await harness();
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  await h.api.enfileirar({action:'marcarEntregue',row:91,ts_device:'2026-10-06T13:00:00.000Z'},{row:91});
  await h.api.enfileirar({action:'marcarEntregue',row:92,ts_device:'2026-10-06T13:01:00.000Z'},{row:92});
  h.api.clearDriverToken('Ana');h.api.saveDriverName('Beto');h.api.saveDriverToken('tok-beto','Beto');
  assert.equal(JSON.stringify(h.api.filaPresaDeOutros()),JSON.stringify([{nome:'Ana',n:2}]));
});

test('R6 o iniciar que a tela está enviando não é reenviado em paralelo pela fila',async()=>{
  let liberar;const travado=new Promise(r=>{liberar=r;});
  const h=await harness({handler:async p=>{ if(p.action==='iniciarRota'){ await travado; return {ok:true}; } if(p.action==='verificarMontagem') return {ok:true,montagemVerificada:true}; return {ok:true}; }});
  h.api.saveDriverName('Ana');h.api.saveDriverToken('tok-ana','Ana');
  const envio=h.api.apiIniciarRota('Ana','123','','image/jpeg');
  assert.equal(h.api.temRotaPendenteFase('inicio'),true,'o KM já está no aparelho ANTES de qualquer resposta (síncrono)');
  const dreno=h.api.processarFila();
  await new Promise(r=>setTimeout(r,20));
  liberar();await envio;await dreno;
  assert.equal(h.calls.filter(c=>c.action==='iniciarRota').length,1,'um envio só — a fila pulou o que estava em voo');
});

test('R7 rota finalizada e atividade: lembradas no aparelho para a home decidir se reabre',async()=>{
  const h=await harness();
  h.api.saveDriverName('Ana');
  assert.equal(h.api.fimConfirmado('Ana'),false);h.api.guardarFimConfirmado('Ana',true);assert.equal(h.api.fimConfirmado('Ana'),true);
  assert.equal(h.api.atividadeRecente('Ana',1000),false);h.api.marcarAtividade('Ana');assert.equal(h.api.atividadeRecente('Ana',3600000),true);
});

let falhas=0;
for(const [nome,fn] of tests){
  try{await fn();console.log('PASS '+nome);}catch(e){falhas++;console.log('FAIL '+nome+'\n   '+(e&&e.stack||e));}
}
console.log(falhas?`❌ ${falhas} de ${tests.length} falharam`:`✅ ${tests.length}/${tests.length} cenários de troca de entregador, maquininha e pergunta única`);
if(falhas)process.exit(1);
