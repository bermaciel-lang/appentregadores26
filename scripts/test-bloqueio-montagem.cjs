const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const store=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const localStorage=store(),sessionStorage=store();sessionStorage.setItem('app_turno','MANHÃ');
let response,offline=false,posts=0;
const cfg={API_URL:'/api/painel/',API_MODE:'json',API_TIMEOUT_MS:1000,API_RETRY_COUNT:0,STORAGE_DRIVER_KEY:'driver',STORAGE_CACHE_PREFIX:'cache_',CACHE_TTL_MS:100000};
const ctx={console,URL,Date,Intl,AbortController,localStorage,sessionStorage,setTimeout,clearTimeout,navigator:{},document:{},location:{search:''}};
ctx.window={APP_CONFIG:cfg,location:{origin:'https://teste',search:''},setTimeout,clearTimeout};
ctx.fetch=async(url,opts)=>{if(opts?.method==='POST')posts++;if(offline)throw Error('offline');return{ok:true,json:async()=>response}};
vm.runInNewContext(fs.readFileSync('public/assets/core.js','utf8'),ctx);
const api=ctx.window.AppEntrega;api.saveDriverName('Camila');localStorage.setItem('app_api_url_override','/api/painel/');
(async()=>{
 response={ok:true,items:[{row:1,cliente:'teste'}],rotaIniciada:false};
 await api.carregarEntregasPorEntregador('Camila'); // cria cache de entregas, mas não permissão de saída
 offline=true;
 await assert.rejects(()=>api.carregarEntregasPorEntregador('Camila'),e=>e.bloqueioMontagem);
 offline=false;response={ok:false,montagemBloqueada:true,error:'FINALIZE',pendentes:[{pedido:'LOJA-1'}]};
 await assert.rejects(()=>api.verificarMontagem('Camila'),/FINALIZE/);
 await assert.rejects(()=>api.carregarEntregasPorEntregador('Camila'),/FINALIZE/);
 await assert.rejects(()=>api.apiIniciarRota('Camila',10,'foto'),/FINALIZE/);assert.equal(posts,0);
 response={ok:true,montagemVerificada:true,rotaIniciada:false};assert.equal((await api.verificarMontagem('Camila')).ok,true);
 await api.apiIniciarRota('Camila',10,'');
 offline=true;assert.equal((await api.verificarMontagem('Camila')).rotaIniciada,true);offline=false;
 response={ok:true,items:[{row:1}],rotaIniciada:true};await api.carregarEntregasPorEntregador('Camila');
 offline=true;assert.equal((await api.carregarEntregasPorEntregador('Camila')).stale,true);
 assert.equal((await api.verificarMontagem('Camila')).rotaIniciada,true);
 api.setTurno('TARDE');await assert.rejects(()=>api.carregarEntregasPorEntregador('Camila'),e=>e.bloqueioMontagem);
 console.log('PASS frontend: cache não contorna trava; início bloqueado não envia; iniciou confirmado segue offline; outro turno não herda liberação');
})().catch(e=>{console.error(e);process.exitCode=1});
