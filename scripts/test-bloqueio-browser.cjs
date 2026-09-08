const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
const {chromium}=await import(process.env.TEST_PLAYWRIGHT_MODULE);
const root=path.resolve('public'), server=http.createServer((req,res)=>{
 let p=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!p.startsWith(root)){res.writeHead(403).end();return}
 if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');
 if(!fs.existsSync(p)){res.writeHead(404).end();return}
 res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(p));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'msedge'});
const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage();
let blocked=true;
await ctx.addInitScript(()=>{localStorage.setItem('app_entregas_driver_name','Camila');sessionStorage.setItem('app_turno','MANHÃ');});
await ctx.route('**/api/**',route=>{
 const action=new URL(route.request().url()).searchParams.get('action');
 if(action==='entregadores')return route.fulfill({json:{ok:true,items:['Camila']}});
 if(action==='entregas'||action==='verificarMontagem')return route.fulfill({json:blocked?{ok:false,montagemBloqueada:true,error:'FINALIZE TODOS OS PEDIDOS E ASSINATURAS NO APP DE MONTAGEM PARA INICIAR A SUA ROTA',pendentes:[{pedido:'LOJA-TESTE',cliente:'Cliente de teste',tipo:'Loja'}]}:{ok:true,montagemVerificada:true,items:[],rotaIniciada:false}});
 return route.fulfill({json:{ok:true,items:[],mensagens:[]}});
});
try{
 await page.goto(base+'/entregas/');
 await page.getByText('FINALIZE TODOS OS PEDIDOS E ASSINATURAS NO APP DE MONTAGEM PARA INICIAR A SUA ROTA',{exact:false}).waitFor();
 assert.equal(await page.locator('#sectionsRoot').innerText(),'');
 await page.screenshot({path:path.join(process.env.TEST_ARTIFACT_DIR || '.', 'entregas-bloqueadas.png'),fullPage:true});
 blocked=false;await page.reload();await page.waitForTimeout(700);
 assert.equal(await page.getByText('FINALIZE TODOS OS PEDIDOS E ASSINATURAS',{exact:false}).count(),0);
 console.log('PASS navegador celular: pendências visíveis sem cartões de entrega; desbloqueia após confirmação');
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
