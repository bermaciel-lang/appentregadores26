# Recebimentos guardados antes da rede

O app grava todas as marcações de entrega e todas as declarações de pagamento do ato em uma transação IndexedDB. Aguarda o commit antes de atualizar o estado visual ou chamar o servidor. O valor, o timestamp e o grupo do comprovante são preservados nos reenvios.

As transações de escrita solicitam durability: strict e continuam aguardando o evento complete. Conforme a [especificação IndexedDB](https://w3c.github.io/IndexedDB/#transaction-durability-hint), essa preferência reduz a janela de perda em caso de queda do sistema ou de energia, ao solicitar persistência física antes do commit. É uma indicação ao navegador, não uma garantia contra falha de hardware; pode custar algum tempo e bateria. Leituras mantêm a durabilidade padrão.

fila-duravel.js mantém os registros por ID, em ordem transacional. Um ACK vira um registro de conclusão (tombstone; desde 28/10/2026 apagado depois de 3 dias, exceto o que protege a fila antiga — ver "Leva 2" abaixo); uma recusa mantém o payload e exige correção. Uma correção aceita pode resolver recusas anteriores do mesmo pedido e até seu timestamp, preservando recusas posteriores e outros pedidos.

A migração importa STORAGE_CACHE_PREFIX + fila_v1 sem apagar a cópia original do localStorage. IDs já conhecidos só são aceitos com conteúdo igual. O estado de transporte pg_fila e o erro temporário de envio não mudam a identidade do ato. Um tombstone impede que uma aba antiga reimporte um item já concluído. A interface usa um snapshot hidratado; a fonte continua sendo IndexedDB.

O envio exige Web Locks. Esse mecanismo coordena as abas do mesmo navegador e libera o consumidor quando a aba fecha. Não há fallback por relógio: uma aba suspensa poderia continuar enviando após expirar um lease. Sem Web Locks, o ato é guardado e a tela orienta atualizar o mesmo navegador; nenhum consumidor da fila é iniciado. Os dados de um navegador não são compartilhados automaticamente com outro.

A confirmação de pagamento espera até 20 segundos por tentativa, uma tentativa por ciclo (era 45 s, com uma tentativa extra; ver "Leva 2"). As demais chamadas mantêm 15 segundos. Um timeout não é ACK: os dados continuam aguardando confirmação. O servidor precisa continuar reconhecendo o mesmo ato de forma idempotente, porque uma resposta pode se perder depois da gravação.

Isto não protege contra o usuário apagar os dados do navegador ou contra a remoção do armazenamento pelo sistema operacional. O app atual não registra service worker, e vercel.json configura Cache-Control: no-cache (revalidação com ETag; até 28/10/2026 era no-store). Portanto, abrir ou recarregar a página completamente sem rede pode não funcionar. Isso é distinto da persistência da fila: os registros sobrevivem ao fechamento e são retomados quando o aplicativo voltar a carregar. Este ajuste não adiciona cache do shell nem service worker.

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


## Correções vinculadas por identidade — 09/09/2026

A refutação independente reproduziu perda de uma recusa nova quando o relógio do aparelho atrasava: o ACK anterior limpava registros por timestamp. O staging agora congela os IDs das declarações anteriores do mesmo pedido presentes no snapshot da fila, pendentes ou recusadas. Esse vetor entra na assinatura imutável do ato. Inclusões posteriores não entram nele.

O ACK da correção e a resolução dos alvos ainda recusados ocorrem no mesmo commit IndexedDB. Alvos ainda pendentes, outros pedidos e marcações de status permanecem. O tombstone resolvido indica resolvidaPor. Entradas legadas sem vetor só reconhecem a própria entrada. A renderização prioriza a pendência durável sobre memória visual, independentemente do relógio.

Régua de fila ampliada para 24 cenários: inclui duas abas com relógio regressivo e reload, legado sem vínculo e interrupção após escrever o ACK próprio ou o alvo, com rollback de ambos. Nenhuma consulta a serviço operacional nesses testes.


## Leva 2 — 28/10/2026 (o que mudou, sem afrouxar nenhuma garantia acima)

- **Porteiro fechado não trava mais a fila inteira.** `precisaLogin`/`montagemBloqueada`/`montagemIndisponivel` davam `break` e o ciclo seguinte começava pelo mesmo item: um toque de rota que não vale mais (republicada, ou de ontem sem o dia carimbado) segurava todas as entregas de trás para sempre. Agora trava só a rota daquele item (entregador|dia|turno, nas ações de status) ou o entregador do token (login), conta a tentativa no selo e segue com o resto. Cada item pulado por isso bloqueia a parada dele no ciclo: o `confirmarPagamento` nunca passa na frente do `marcarEntregue` do mesmo pedido.
- **`confirmarPagamento`: 20 s, sem tentativa interna.** Eram 45 s × 2 (~91 s segurando tudo atrás). Timeout continua não sendo ACK: o item fica e a fila repete no próximo ciclo. O servidor confere a chave do toque (`parada:ts_device`) antes da parte lenta (lib/erp-pagamento-na-entrega.ts), então repetir um toque que já gravou volta rápido.
- **"Rodar de novo".** Quem chama `processarFila` com um ciclo em voo marca uma nova volta; a promessa devolvida só resolve depois dela (o toque feito com o ciclo no fim não espera o próximo gatilho).
- **Faxina das lápides.** `limparLapides` apaga, em lotes e com respiro entre eles, só lápides (`estado === 'ack'`) cuja idade (`max(ackEm, ts)`) passa de 3 dias. Nunca apaga pendente nem recusado, nem a lápide de um ID que ainda está na fila antiga do localStorage (`fila_v1`, que a migração nunca apaga) — é essa lápide que impede a reimportação; fila antiga ilegível = não apaga nada. A tela roda a faxina com o app aberto e parado, no máximo 1× a cada 20 h, e para se a fila voltar a enviar. Medido (Edge, CPU 4×, 20 mil lápides): leitura 225 → 5 ms, toque 309 → 6 ms; o toque durante a faxina nunca passou do custo de antes dela.
- **ACKs recentes por cima da lista.** A lista do servidor pedida antes de um ACK não repinta o status antigo: a tela sobrepõe os ACKs de status (em memória) até aplicar uma lista pedida depois deles.
- **Fechar o app.** O keepalive também leva o `confirmarPagamento` quando ele é o único da parada e vem depois da única marcação dela — e só depois que a marcação respondeu ok. Sem ACK nenhum, como antes.
- Réguas: `scripts/test-leva2-fila.mjs` (12 cenários), `test-leva2-irmas.mjs`, `test-leva2-rota.mjs`, `test-leva2-abertura.mjs` e, no navegador, `test-leva2-navegador.mjs`; medidor `scripts/medir-lapides-faxina.mjs`.
