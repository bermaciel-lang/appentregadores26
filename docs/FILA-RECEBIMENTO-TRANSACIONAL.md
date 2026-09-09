# Recebimentos guardados antes da rede

O app grava todas as marcações de entrega e todas as declarações de pagamento do ato em uma transação IndexedDB. Aguarda o commit antes de atualizar o estado visual ou chamar o servidor. O valor, o timestamp e o grupo do comprovante são preservados nos reenvios.

As transações de escrita solicitam durability: strict e continuam aguardando o evento complete. Conforme a [especificação IndexedDB](https://w3c.github.io/IndexedDB/#transaction-durability-hint), essa preferência reduz a janela de perda em caso de queda do sistema ou de energia, ao solicitar persistência física antes do commit. É uma indicação ao navegador, não uma garantia contra falha de hardware; pode custar algum tempo e bateria. Leituras mantêm a durabilidade padrão.

fila-duravel.js mantém os registros por ID, em ordem transacional. Um ACK vira um registro de conclusão permanente (tombstone); uma recusa mantém o payload e exige correção. Uma correção aceita pode resolver recusas anteriores do mesmo pedido e até seu timestamp, preservando recusas posteriores e outros pedidos.

A migração importa STORAGE_CACHE_PREFIX + fila_v1 sem apagar a cópia original do localStorage. IDs já conhecidos só são aceitos com conteúdo igual. O estado de transporte pg_fila e o erro temporário de envio não mudam a identidade do ato. Um tombstone impede que uma aba antiga reimporte um item já concluído. A interface usa um snapshot hidratado; a fonte continua sendo IndexedDB.

O envio exige Web Locks. Esse mecanismo coordena as abas do mesmo navegador e libera o consumidor quando a aba fecha. Não há fallback por relógio: uma aba suspensa poderia continuar enviando após expirar um lease. Sem Web Locks, o ato é guardado e a tela orienta atualizar o mesmo navegador; nenhum consumidor da fila é iniciado. Os dados de um navegador não são compartilhados automaticamente com outro.

A confirmação de pagamento espera até 45 segundos por tentativa. As demais chamadas mantêm 15 segundos. Um timeout não é ACK: os dados continuam aguardando confirmação. O servidor precisa continuar reconhecendo o mesmo ato de forma idempotente, porque uma resposta pode se perder depois da gravação.

Isto não protege contra o usuário apagar os dados do navegador ou contra a remoção do armazenamento pelo sistema operacional. O app atual não registra service worker, e vercel.json configura Cache-Control: no-store. Portanto, abrir ou recarregar a página completamente sem rede pode não funcionar. Isso é distinto da persistência da fila: os registros sobrevivem ao fechamento e são retomados quando o aplicativo voltar a carregar. Este ajuste não adiciona cache do shell nem service worker.

## Verificação local

O comando node scripts/test-fila-pagamento.mjs executa os arquivos reais da fila, do core e das duas portas de confirmação da página, com transporte fictício e IndexedDB em memória. O teste usa fake-indexeddb 6.2.5. Pode ser instalado somente para testes, fora das dependências de produção:

~~~powershell
npm install --ignore-scripts --no-save --prefix "$env:USERPROFILE/.codex/tmp/rota-idb-testes" fake-indexeddb@6.2.5
node scripts/test-fila-pagamento.mjs
node scripts/test-valor-atual.mjs
~~~

Cenários incluem fechamento com fetch pendente, grupo de 20 pedidos/40 registros, ACK parcial, recusa e correção, interrupção da transação, duas abas gravando e ausência de Web Locks.

A revisão independente também executou 9 cenários com IndexedDB nativo no Edge, duas páginas no mesmo BrowserContext e origem fictícia: concorrência de append/ACK, retomada após fechar a aba, rollback integral, migração interrompida e tombstones, 40 inclusões concorrentes, reenvios sem ACK, recusas, exclusividade com alteração do relógio e bloqueio de sincronização sem Web Locks.

O teste scripts/test-fila-durabilidade-browser.mjs usa Playwright e o Edge instalado, com origem fictícia e transporte bloqueado. Confere as transações IndexedDB nativas: escritas solicitam e expõem strict; o lote só retorna após complete, e ACK e fila permanecem corretos após reload. Pode receber PLAYWRIGHT_MODULE e PLAYWRIGHT_CHANNEL para usar uma instalação existente.
