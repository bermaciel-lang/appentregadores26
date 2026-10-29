/* Fila transacional do aparelho. Payload imutável; ACK é tombstone durável.
 * IndexedDB confirma o lote inteiro antes de liberar qualquer chamada de rede. */
(function () {
  'use strict';
  const copiar = x => JSON.parse(JSON.stringify(x));
  const canonico = x => Array.isArray(x) ? x.map(canonico) : x && typeof x === 'object'
    ? Object.fromEntries(Object.entries(x).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonico(v)])) : x;
  const uuid = () => crypto.randomUUID();
  function assinatura(item) {
    const params = { ...item.params }; delete params.pg_fila; // transporte não altera o ato declarado
    const meta = { ...(item.meta || {}) }; delete meta.erroPagamento;
    return JSON.stringify(canonico({ params, meta, ts: item.ts,
      ...(Array.isArray(item.declaracoesAnteriores)?{declaracoesAnteriores:item.declaracoesAnteriores}:{}) }));
  }
  function criar({ nome, chaveLegada, onChange }) {
    let banco, cache = null, erro = null, ultimoLegado = null;
    const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel(nome + ':mudancas') : null;
    const avisar = () => { if (canal) canal.postMessage({ mudou: true }); if (onChange) onChange(); };
    const abrir = () => new Promise((resolve,reject) => {
      if (!window.indexedDB) { reject(Error('Este navegador não disponibilizou o armazenamento de entregas.')); return; }
      const r = indexedDB.open(nome,1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('itens',{ keyPath:'id' }).createIndex('ordem','ordem',{ unique:true });
        d.createObjectStore('meta',{ keyPath:'chave' });
      };
      r.onerror = () => reject(r.error || Error('Não foi possível abrir a fila.'));
      r.onblocked = () => reject(Error('Outra versão do aplicativo está usando a fila. Reabra as abas de entregas.'));
      r.onsuccess = () => { banco=r.result; banco.onversionchange=()=>banco.close(); resolve(); };
    });
    function transacao(stores,modo,executar,relaxada) {
      return new Promise((resolve,reject) => {
        let tx,valor,motivo;
        try {
          // Prefere persistência física antes do complete para dados que não podem ser reconstruídos.
          // `relaxada` só para a faxina das lápides (28/10/2026): perder uma exclusão numa queda de energia só deixa a
          // lápide onde estava — nada que precise de disco antes do complete.
          tx=modo==='readwrite'
            ? banco.transaction(stores,modo,{durability:relaxada?'relaxed':'strict'})
            : banco.transaction(stores,modo);
          tx.oncomplete=()=>resolve(valor);
          tx.onabort=()=>reject(motivo || tx.error || Error('A gravação no aparelho foi interrompida.'));
          tx.onerror=()=>{};
          const falhar=e=>{motivo=e;try{tx.abort();}catch(_){}};
          executar(tx,v=>{valor=v;},falhar);
        } catch(e) { reject(e); }
      });
    }
    function inserirItens(itens) {
      return transacao(['itens','meta'],'readwrite',(tx,resultado,falhar)=>{
        const store=tx.objectStore('itens'),meta=tx.objectStore('meta');
        const seq=meta.get('sequencia'); let novos=0;
        seq.onsuccess=()=>{
          let ordem=Number(seq.result && seq.result.valor || 0);
          itens.forEach(item=>{
            const existente=store.get(item.id);
            existente.onsuccess=()=>{
              const sig=assinatura(item);
              if (existente.result) {
                if (existente.result.assinatura !== sig) falhar(Error('Há duas declarações diferentes com a mesma identificação local. A fila foi preservada.'));
                return; // inclui ACK: uma aba antiga nunca ressuscita esse item
              }
              ordem++;novos++;
              store.add({ ...copiar(item),assinatura:sig,ordem,estado:item.precisaCorrigir?'recusado':'pendente',
                reenviado:!!item.params.pg_fila });
              meta.put({chave:'sequencia',valor:ordem});
              resultado(novos);
            };
          });
          resultado(0);
        };
      });
    }
    async function importarLegado() {
      const raw=localStorage.getItem(chaveLegada);
      if (raw === ultimoLegado) return;
      const antigos=raw ? JSON.parse(raw) : [];
      if (!Array.isArray(antigos) || antigos.some(x=>!x || !x.id || !x.params || typeof x.params!=='object')) {
        throw Error('A fila antiga está ilegível e foi preservada. A equipe precisa conferir este aparelho.');
      }
      const novos=await inserirItens(antigos);
      // O original continua disponível. Só o commit acima autoriza marcar esta cópia como lida.
      ultimoLegado=raw;
      if(novos)avisar();
    }
    async function atualizarCache() {
      const registros=await transacao(['itens'],'readonly',(tx,result)=>{
        const req=tx.objectStore('itens').index('ordem').getAll();
        req.onsuccess=()=>result(req.result.filter(x=>x.estado!=='ack').map(x=>({
          id:x.id,params:{...x.params,...(x.reenviado?{pg_fila:1}:{})},meta:x.meta,ts:x.ts,
          precisaCorrigir:x.estado==='recusado',erro:x.erro||null,
        })));
      });
      cache=registros;erro=null;
      if(onChange)onChange();
      return copiar(cache);
    }
    let pronta;
    async function garantir() {
      if (!pronta) pronta=abrir().then(importarLegado).then(atualizarCache).catch(e=>{erro=e.message;pronta=null;throw e;});
      await pronta;
    }
    async function ler() {
      await garantir();await importarLegado();return atualizarCache();
    }
    async function adicionar(entradas) {
      // Congela o conteúdo imediatamente, antes de qualquer await de abertura/commit.
      const conhecidas=cache===null?[]:copiar(cache);
      const agora=Date.now(),novas=entradas.map(({params,meta})=>({
        id:uuid(),params:copiar(params),meta:copiar(meta||{}),ts:agora,
        precisaCorrigir:!!(meta&&meta.erroPagamento),erro:meta&&meta.erroPagamento||null,
        // Congela quais declarações esta correção viu, inclusive uma ainda aguardando resposta.
        // Uma inclusão posterior, mesmo com relógio atrasado, nunca entra nesse conjunto.
        declaracoesAnteriores:params.action==='confirmarPagamento'?conhecidas.filter(x=>
          x.params.action==='confirmarPagamento' && Number(x.params.row)===Number(params.row)).map(x=>x.id):[],
      }));
      if(!novas.length)return[];
      await garantir();await importarLegado();await inserirItens(novas);
      await atualizarCache();avisar();
      return novas.map(x=>x.id);
    }
    async function alterar(id,tipo,detalhe) {
      await garantir();
      await transacao(['itens'],'readwrite',(tx,resultado)=>{
        const store=tx.objectStore('itens'),req=store.get(id);
        req.onsuccess=()=>{
          const item=req.result;if(!item || item.estado==='ack')return;
          if(tipo==='ack'){
            // ACK e resolução das declarações visadas pertencem ao MESMO commit.
            // Legado sem vetor só confirma a própria entrada; relógio não prova sucessão.
            // `ackEm` (28/10/2026): a hora do ACK, para a faxina saber a idade da lápide (ver `limparLapides`).
            const tombstone=(x,resolvidaPor)=>({id:x.id,ordem:x.ordem,assinatura:x.assinatura,estado:'ack',ts:x.ts,ackEm:Date.now(),
              ...(resolvidaPor?{resolvidaPor}:{})});
            store.put(tombstone(item));
            if(item.params && item.params.action==='confirmarPagamento' && Array.isArray(item.declaracoesAnteriores)){
              for(const alvo of new Set(item.declaracoesAnteriores)){
                if(alvo===item.id)continue;
                const anterior=store.get(alvo);
                anterior.onsuccess=()=>{
                  const x=anterior.result;
                  if(x && x.estado==='recusado' && x.ordem<item.ordem && x.params &&
                    x.params.action==='confirmarPagamento' && Number(x.params.row)===Number(item.params.row)){
                    store.put(tombstone(x,item.id));
                  }
                };
              }
            }
          } else store.put({...item,...(tipo==='recusa'?{estado:'recusado',erro:detalhe}:{reenviado:true})});
        };
      });
      await atualizarCache();avisar();
    }
    /* ⭐ 28/10/2026 — A FAXINA DAS LÁPIDES (pedido do dono: "o app tem que continuar muito rápido").
     * Todo ACK virava lápide para sempre, e `atualizarCache` lê o índice inteiro a cada toque: 📏 Edge, CPU 4×, 20 mil lápides =
     * 204 ms por leitura e 217 ms por toque (0 lápides: 3 ms e 2 ms). Um entregador chega a 20 mil em menos de um ano.
     * Aqui saem as lápides de ato confirmado há mais de `antesDe` (o chamador passa ~3 dias), em lotes pequenos e com um respiro
     * entre eles — o toque nunca espera a faxina inteira. NUNCA sai:
     *   · item pendente ou recusado (só `estado === 'ack'`);
     *   · a lápide de um ID que ainda está na fila ANTIGA do localStorage (`chaveLegada`, a `fila_v1`, que a migração nunca apaga):
     *     é ela que impede `importarLegado` de ressuscitar o ato já confirmado (inserirItens pula ID conhecido). Fila antiga
     *     ilegível = não apaga nada (sem saber o que ela protege, não arrisca);
     *   · o que o chamador mandar proteger (`protegidos`).
     * `continuar()` é consultado antes de cada lote: o app para a faxina quando a fila volta a enviar ou a tela some. */
    async function limparLapides({ antesDe, protegidos, lote=200, continuar }={}) {
      await garantir();
      const corte=Number(antesDe);
      if (!Number.isFinite(corte)) return { apagadas:0, motivo:'sem data de corte' };
      const proteger=new Set(protegidos||[]);
      try {
        const raw=localStorage.getItem(chaveLegada);
        const antigos=raw ? JSON.parse(raw) : [];
        if (!Array.isArray(antigos)) return { apagadas:0, motivo:'fila antiga ilegível' };
        antigos.forEach(x=>{ if (x && x.id) proteger.add(x.id); });
      } catch (e) { return { apagadas:0, motivo:'fila antiga ilegível' }; }
      let apagadas=0, depoisDe=null, lotes=0;
      for (;;) {
        if (continuar && !continuar()) return { apagadas, lotes, interrompida:true };
        const r=await transacao(['itens'],'readwrite',(tx,resultado)=>{
          const idx=tx.objectStore('itens').index('ordem');
          const req=depoisDe===null ? idx.openCursor() : idx.openCursor(IDBKeyRange.lowerBound(depoisDe,true));
          let n=0, vistos=0, ultimo=depoisDe;
          resultado({ n:0, ultimo, fim:true });
          req.onsuccess=()=>{
            const c=req.result;
            if (!c) { resultado({ n, ultimo, fim:true }); return; }
            const x=c.value; ultimo=x.ordem; vistos++;
            const idade=Math.max(Number(x.ackEm)||0, Number(x.ts)||0);
            if (x.estado==='ack' && idade<corte && !proteger.has(x.id)) { c.delete(); n++; }
            if (vistos>=lote) { resultado({ n, ultimo, fim:false }); return; }
            c.continue();
          };
        },true);
        apagadas+=r.n; lotes++; depoisDe=r.ultimo;
        if (r.fim) break;
        await new Promise(ok=>setTimeout(ok,0)); // respiro: um toque que chegar agora passa antes do próximo lote
      }
      return { apagadas, lotes };
    }
    async function exclusivo(trabalho) {
      await garantir();
      if (!navigator.locks || !navigator.locks.request) {
        // Um lease por relógio pode expirar enquanto a outra aba ainda envia. Nunca arriscar.
        return { sincronizacaoIndisponivel: true };
      }
      return navigator.locks.request(nome+':envio',{ifAvailable:true},lock=>lock?trabalho(async()=>true):{ocupado:true});
    }
    if(canal)canal.onmessage=()=>ler().catch(e=>{erro=e.message;if(onChange)onChange();});
    window.addEventListener('storage',e=>{
      if(e.key===chaveLegada)ler().catch(error=>{erro=error.message;if(onChange)onChange();});
    });
    return { pronta:garantir,ler,adicionar,ack:id=>alterar(id,'ack'),recusar:(id,motivo)=>alterar(id,'recusa',motivo),
      marcarReenvio:id=>alterar(id,'reenvio'),exclusivo,limparLapides,
      snapshot:()=>cache===null?null:copiar(cache),estado:()=>({pronta:cache!==null,erro,sincronizacaoDisponivel:!!(navigator.locks&&navigator.locks.request)}),
      fechar:()=>{if(canal)canal.close();if(banco)banco.close();}
    };
  }
  window.FilaDuravel={criar};
})();
