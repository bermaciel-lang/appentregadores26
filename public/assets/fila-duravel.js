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
    function transacao(stores,modo,executar) {
      return new Promise((resolve,reject) => {
        let tx,valor,motivo;
        try {
          // Prefere persistência física antes do complete para dados que não podem ser reconstruídos.
          tx=modo==='readwrite'
            ? banco.transaction(stores,modo,{durability:'strict'})
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
            const tombstone=(x,resolvidaPor)=>({id:x.id,ordem:x.ordem,assinatura:x.assinatura,estado:'ack',ts:x.ts,
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
      marcarReenvio:id=>alterar(id,'reenvio'),exclusivo,
      snapshot:()=>cache===null?null:copiar(cache),estado:()=>({pronta:cache!==null,erro,sincronizacaoDisponivel:!!(navigator.locks&&navigator.locks.request)}),
      fechar:()=>{if(canal)canal.close();if(banco)banco.close();}
    };
  }
  window.FilaDuravel={criar};
})();
