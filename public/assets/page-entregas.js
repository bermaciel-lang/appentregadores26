(function () {
  const api = window.AppEntrega;
  const savedDriver = api.getSavedDriverName();

  // Ícones SVG inline (crisp em qualquer tela, funcionam OFFLINE — sem webfont). Herdam a cor do
  // texto (currentColor) e o tamanho vem do 2º parâmetro. Traço grosso pra ficar legível no celular.
  const ICN = {
    play: 'M8 5v14l11-7z',
    pin: 'M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    nav: 'M3 11l18-8-8 18-2-8-8-2z',
    check: 'M4 12l5 5L20 6',
    x: 'M6 6l12 12M18 6L6 18',
    phone: 'M4 4h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2z',
    whats: 'M21 12a8 8 0 0 1-11.8 7L4 20l1-5.2A8 8 0 1 1 21 12z',
    cash: 'M2 6h20v12H2z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M6 12h.01 M18 12h.01',
    clock: 'M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    chevdown: 'M6 9l6 6 6-6',
    chevup: 'M6 15l6-6 6 6',
    drag: 'M8 9l4-4 4 4 M8 15l4 4 4-4',
    map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z M9 4v14 M15 6v14',
  };
  function ic(name, size, color) {
    const d = ICN[name] || ''; const s = size || 16;
    const fill = (name === 'play') ? 'currentColor' : 'none';
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="' + fill + '" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"' + (color ? ' style="color:' + color + '"' : '') + '>' + d.split(' M').map(function (seg, i) { return '<path d="' + (i ? 'M' + seg : seg) + '"/>'; }).join('') + '</svg>';
  }

  const state = {
    driver: savedDriver,
    refreshTimer: null,
    cancelTimer: null,
    items: [],
    rotaInfo: {}, // { kmInicial, kmFinal, fotoInicio, fotoFim, inicio, fim }
    // Trava de reentrância enquanto UM diálogo está aberto. ⛔ Até 23/09/2026 ela também cobria a
    // REDE (e havia um `state.enviando` que desabilitava os botões do cartão e escrevia "⏳ Enviando,
    // aguarde…"): era isso que deixava o entregador de mãos atadas por dezenas de segundos.
    sendingAction: false,
    // Texto do que a tela está ESPERANDO de propósito (conferência de dinheiro). Enquanto não é
    // null, os botões ficam desabilitados COM ESSE TEXTO no cartão — nunca em silêncio. Rede de
    // marcação nunca entra aqui: ela não espera ninguém.
    aguardando: null,
    // Este navegador não tem Web Locks: a fila GUARDA tudo mas não envia nada sozinha. O selo do
    // cartão passa a dizer isso em vez de "enviando…" — a tela não pode ficar verde calada.
    semSincronizacao: false,
    expandidos: new Set(), // rows com o cartão EXPANDIDO (Iniciar abre; Minimizar/marcar fecha)
    sendingRouteAction: false,
    // ⛔ 10/09/2026 — `sessionStorage` sozinho perdia a rota em andamento quando o Android matava o
    // WebView (rotineiro: GPS + câmera + WhatsApp). O entregador voltava numa área sem sinal, via
    // "Clique em Iniciar entregas" com a mercadoria no carro, e o Iniciar recusava por não
    // conseguir conferir a montagem. `inicioConfirmado` mora em `localStorage`, é por dia+turno+
    // entregador, e só é escrito quando o SERVIDOR confirmou o início — então não inventa rota.
    rotaIniciada: sessionStorage.getItem('rota_iniciada_' + savedDriver) === '1'
                  || (!!savedDriver && api.inicioConfirmado(savedDriver)),
    // ⛔ 28/10/2026 (revisão da leva 2) — e a rota JÁ FINALIZADA também vem do aparelho (`fimConfirmado`, localStorage, por
    // dia+turno+entregador, gravado quando o servidor confirmou o fim). Só com o `sessionStorage` (que o Android apaga ao matar o
    // WebView), reabrir depois do fim religava o GPS e a notificação "Rota em andamento" — o "início confirmado" fica no aparelho.
    rotaFinalizada: sessionStorage.getItem('rota_finalizada_' + savedDriver) === '1'
                    || (!!savedDriver && !!api.fimConfirmado && api.fimConfirmado(savedDriver)),
    // Pagamento na porta (05/09): { perguntar, formas } vem do servidor a cada `entregas` fresco;
    // guardado no aparelho para o modal funcionar SEM SINAL (a resposta sobe pela fila offline).
    pgCfg: lerPgCfg(),
    pgRespondido: {}, // row -> última resposta dada nesta sessão (pra "manter ou corrigir" ao remarcar)
    // 06/10/2026 — maquininha da rota: a escolha que vale (do aparelho ou do servidor) e se a rota tem pagamento na
    // entrega (false = "Não levei" automático; null = não sei → pergunta).
    maquininha: savedDriver ? api.lerEscolhaMaquininha(savedDriver) : null,
    precisaMaquininha: null,
    // ⛔ (revisão independente de 06/10, BLOQUEADOR) o painel JÁ conhece a maquininha? Só pergunta quando o servidor mandou o
    // campo alguma vez (lembrado no aparelho: o Iniciar sem sinal também sabe). Painel antigo = não pergunta nada.
    servidorMaq: (function () { try { return localStorage.getItem('maq_servidor_v1') === '1'; } catch (e) { return false; } })(),
    // 28/10/2026 — expandir um cartão pago na porta consultava a Instabuy AO VIVO toda vez: no máximo 1× por parada a cada 2 min.
    conferidoEm: {}
  };

  function lerPgCfg() {
    try { const c = JSON.parse(localStorage.getItem('pg_cfg_v1') || 'null'); if (c && typeof c === 'object') return { perguntar: c.perguntar === true, formas: Array.isArray(c.formas) ? c.formas : [], simples: c.simples === true, opcoes: Array.isArray(c.opcoes) ? c.opcoes : null }; } catch (e) {}
    return { perguntar: false, formas: [], simples: false, opcoes: null };
  }
  function salvarPgCfg(cfg) { try { localStorage.setItem('pg_cfg_v1', JSON.stringify(cfg)); } catch (e) {} }

  const driverTitle = document.getElementById('driverTitle');
  const driverNameText = document.getElementById('driverNameText');
  const loadingSections = document.getElementById('loadingSections');
  const sectionsRoot = document.getElementById('sectionsRoot');
  const errorBox = document.getElementById('errorBox');
  const refreshInfo = document.getElementById('refreshInfo');
  const warningBox = document.getElementById('warningBox');

  function redirectIfNoDriver() {
    if (!state.driver) {
      window.location.href = '/';
      return true;
    }
    return false;
  }

  function setLoading(show) {
    loadingSections.classList.toggle('hidden', !show);
    if (show) sectionsRoot.classList.add('hidden');
  }

  function setWarning(text) {
    if (!text) {
      warningBox.classList.add('hidden');
      warningBox.textContent = '';
      return;
    }
    warningBox.textContent = text;
    warningBox.classList.remove('hidden');
  }

  // O servidor recusou por LOGIN (token inválido/ausente — `precisaLogin`). O core já apagou o
  // token do aparelho; aqui a gente explica UMA vez e leva pra tela inicial, onde tocar no nome
  // pede o PIN. Antes isso virava "não foi possível verificar a montagem" e o entregador ficava
  // trancado sem saída (a home só pedia PIN quando o nome não batia com o token — e batia).
  // Guarda contra repetição: o poll, o visibilitychange e o online chamam carregarTudo em sequência.
  async function pedirLoginDeNovo(mensagem) {
    if (state.pedindoLogin) return;
    state.pedindoLogin = true;
    stopAutoRefresh();
    await AppUI.alerta(String(mensagem || 'Faça login com o PIN pra abrir a rota.') + '\n\nNa tela inicial, toque no seu nome e digite seu PIN (os últimos 4 números do seu telefone). O que você já marcou fica guardado no aparelho e sobe depois.', { titulo: 'Precisa entrar de novo', tom: 'warn' });
    window.location.href = '/';
  }

  function compressImageToBase64(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('Arquivo não informado'));
        return;
      }

      const reader = new FileReader();

      reader.onload = function (ev) {
        const img = new Image();

        img.onload = function () {
          const scale = Math.min(1, (maxWidth || 640) / img.width);
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const mimeType = 'image/jpeg';
          const dataUrl = canvas.toDataURL(mimeType, quality || 0.3);
          const base64 = (dataUrl.split(',')[1] || '').trim();

          resolve({ base64, mimeType });
        };

        img.onerror = function () {
          reject(new Error('Não foi possível carregar a imagem'));
        };

        img.src = ev.target.result;
      };

      reader.onerror = function () {
        reject(new Error('Não foi possível ler o arquivo'));
      };

      reader.readAsDataURL(file);
    });
  }

// Pede o KM ao entregador.
//  - obrigatorio = false (padrão): pode deixar vazio (segue sem registrar). Usado quando
//    NÃO há foto — aí o sistema usa o KM calculado.
//  - obrigatorio = true: NÃO aceita vazio nem inválido; fica pedindo até vir um número (ou
//    a pessoa cancelar). Usado quando ELA ENVIOU FOTO (o KM passa a ser obrigatório).
// Retorna: KM já no formato do servidor (PONTO decimal) | '' (sem KM) | null (cancelou).
async function pedirKm(mensagem, valorAtual, obrigatorio) {
  while (true) {
    const raw = await AppUI.perguntar(mensagem, {
      titulo: 'Quilometragem',
      valor: valorAtual || '',
      placeholder: 'Ex.: 12345',
      inputmode: 'decimal', // abre o teclado numérico no celular
      textoOk: 'Salvar',
      tom: obrigatorio ? 'warn' : undefined,
    });

    if (raw === null) return null; // cancelou -> aborta a ação

    let value = String(raw).trim().replace('.', ','); // padroniza com vírgula pra validar

    // EM BRANCO (não digitou NADA): o sistema usa o KM CALCULADO. Confirma antes de seguir.
    // OBS: 0 / 0,0 / 0,00 / 0.00 é leitura VÁLIDA (quem zerou o odômetro) e passa NORMAL, sem aviso.
    const vazio = !value;

    // Não-vazio e não é número válido:
    if (!vazio && !/^\d+(,\d+)?$/.test(value)) {
      if (obrigatorio) { valorAtual = value; await AppUI.alerta('KM inválido. Digite só números (ex.: 12345).', { titulo: 'KM inválido', tom: 'warn' }); continue; }
      await AppUI.alerta('KM inválido — seguindo sem registrar o KM. Avise o supervisor depois.', { titulo: 'KM inválido', tom: 'warn' });
      return '';
    }

    // Em branco -> pergunta se tem certeza (e avisa que vai usar o KM do sistema).
    if (vazio) {
      if (obrigatorio) {
        valorAtual = value;
        await AppUI.alerta('Você enviou a foto, então o KM é obrigatório. Digite o KM do carro.', { titulo: 'Falta o KM', tom: 'warn' });
        continue;
      }
      const seguirSemKm = await AppUI.confirmar(
        'O KM ficou EM BRANCO (você não digitou nada).\n\nSe seguir assim, o sistema vai considerar o KM CALCULADO (do sistema), NÃO o do seu carro.\n\nTem certeza que quer deixar sem o KM?',
        { titulo: '⚠️ KM em branco', tom: 'warn', textoOk: 'Sim, seguir sem KM', textoCancelar: 'Voltar e digitar' }
      );
      if (seguirSemKm) return '';    // confirmou: segue sem KM (usa o do sistema)
      valorAtual = value; continue;  // quer digitar de novo
    }

    // IMPORTANTE: manda com PONTO decimal. O servidor faz Number(km) e "123,5" virava NaN
    // -> o KM NÃO salvava (perdia a informação). "12345" e "123.5" salvam certo.
    return value.replace(',', '.');
  }
}

  // Foto que chegou DEPOIS de a rede de segurança já ter concluído "sem foto" (ver
  // pedirFotoObrigatoria). Não dá mais pra devolver pela Promise, então fica aqui, e quem pediu a
  // foto consulta antes de seguir "sem foto". Vale por pouco tempo: é a foto DESTE início/fim.
  let fotoAtrasada = null; // { result, ts }
  function pegarFotoAtrasada() {
    const f = fotoAtrasada; fotoAtrasada = null;
    return (f && (Date.now() - f.ts) < 3 * 60000) ? f.result : null;
  }

  // Abre a câmera e devolve { base64, mimeType } ou null (cancelou / sem foto).
  //
  // HISTÓRICO — este pedaço já perdeu foto duas vezes, sempre por ADIVINHAR o cancelamento pelo
  // relógio: no Android o `focus` (voltou pro app) chega ANTES do `change` (o arquivo), e um
  // corte fixo (1,5s no commit 4369610; depois 8s) descartava a foto que chegava depois. O app
  // oferecia "Iniciar sem foto?" com a foto tirada — e a foto ia pro lixo em silêncio. No iPhone
  // não havia fallback nenhum: cancelar a câmera deixava a Promise pendurada pra sempre.
  //
  // AGORA: quem diz que cancelou é o EVENTO `cancel` do <input type=file> (Chrome/WebView 113+,
  // Safari 16.4+), que dispara na hora e só quando NÃO veio arquivo. O relógio vira só REDE DE
  // SEGURANÇA pra WebView antiga sem `cancel`, com folga grande (30s depois de o app voltar), e
  // uma foto que chegue mesmo depois disso não é descartada: fica em `fotoAtrasada` pra quem
  // pediu usar antes de seguir sem foto.
  function pedirFotoObrigatoria() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';
      input.style.position = 'fixed';
      input.style.top = '-9999px';
      input.style.opacity = '0';
      document.body.appendChild(input);

      let resolved = false;
      let gotFile = false; // marca assim que uma foto chega (a rede de segurança nunca derruba foto boa)
      let redeArmada = false;
      let redeTimer = null;

      function encerrar(valor) {
        if (resolved) return;
        resolved = true;
        if (redeTimer) clearTimeout(redeTimer);
        window.removeEventListener('focus', aoVoltar);
        document.removeEventListener('visibilitychange', aoVoltar);
        // O input SÓ sai do DOM ao encerrar. Antes ele era removido no `change` antes de comprimir e
        // no fallback — aqui fica até o fim pra `input.files` continuar legível pela rede de segurança.
        if (input.parentNode) document.body.removeChild(input);
        resolve(valor);
      }

      input.addEventListener('change', async function () {
        const file = input.files && input.files[0];
        if (file) gotFile = true; // <- ANTES de comprimir, pra a rede de segurança não derrubar a foto boa
        if (!file) { encerrar(null); return; }
        let result = null;
        try {
          result = await compressImageToBase64(file, 800, 0.5);
        } catch (error) {
          console.error(error);
          await AppUI.alerta('Não foi possível preparar a foto. Tente tirar de novo.', { tom: 'warn' });
          encerrar(null);
          return;
        }
        if (resolved) {
          // Chegou DEPOIS de a rede de segurança ter concluído "sem foto" (WebView antiga, câmera
          // muito lenta). Não joga fora: quem pediu a foto confere `pegarFotoAtrasada()` antes de
          // seguir sem ela.
          console.warn('[foto] chegou atrasada, guardada pra quem pediu');
          fotoAtrasada = { result: result, ts: Date.now() };
          return;
        }
        encerrar(result);
      });

      // CANCELOU de verdade (voltou da câmera sem arquivo): o navegador avisa. Se por acaso o
      // `cancel` vier com arquivo já recebido (não deveria), a foto vence.
      input.addEventListener('cancel', function () {
        if (!gotFile && !(input.files && input.files.length)) encerrar(null);
      });

      // REDE DE SEGURANÇA (WebView sem `cancel`): quando o app volta a ficar visível/focado sem
      // arquivo, espera 30s antes de concluir "sem foto" — bem mais que qualquer câmera demora
      // pra entregar o arquivo. Numa WebView moderna o `cancel` resolve antes e isto nunca dispara.
      function aoVoltar() {
        if (document.visibilityState === 'hidden' || resolved || redeArmada) return;
        redeArmada = true;
        redeTimer = setTimeout(function () {
          if (resolved || gotFile || (input.files && input.files.length)) return;
          encerrar(null);
        }, 30000);
      }
      window.addEventListener('focus', aoVoltar);
      document.addEventListener('visibilitychange', aoVoltar);

      input.click();
    });
  }

  const fmtBRL = (n) => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Pagamento igual à folha frontal: na entrega mostra a FORMA + o VALOR a receber (e o troco, se
  // dinheiro); online mostra "Pago online"; cobrança sem forma = "Verificar pagamento".
  function pagamentoHtml(item, grande) {
    const forma = String(item.formaPagamento || '').trim();
    if (!forma) return ''; // reposição / sem cobrança
    if (item.naEntrega) {
      const tipo = forma.replace(/\s*NA ENTREGA\s*/i, '').trim() || 'na entrega';
      const troco = Number(item.troco) || 0;
      const trocoTxt = (troco > 0 && /dinheiro/i.test(forma)) ? ' · troco p/ ' + fmtBRL(troco) : '';
      const temValor = item.valor != null && item.valor !== '' && Number.isFinite(Number(item.valor));
      const prefixo = item.valorConferido === false ? 'Último valor salvo' : 'Receber';
      const valorTexto = temValor ? fmtBRL(item.valor) : 'Valor indisponível';
      const aviso = item.valorConferido === false ? '<br><small>Confira o valor antes de cobrar.</small>' : '';
      const linha = ic('cash', grande ? 18 : 16) + '<span>' + prefixo + ' <b>' + valorTexto + '</b> · ' + api.esc(tipo) + trocoTxt + aviso + '</span>';
      return grande ? '<div class="dc-pay-box"><div class="dc-pay cash">' + linha + '</div></div>' : '<div class="dc-pay cash">' + linha + '</div>';
    }
    if (/verificar/i.test(forma)) return '<div class="dc-pay verif">' + ic('clock', 15) + 'Verificar pagamento</div>';
    return '<div class="dc-pay on">' + ic('check', 15) + 'Pago online</div>';
  }

  // Ovos por tipo (mesmo critério da folha frontal), na ordem dúzia → dezena → pentes → econômico.
  function ovosHtml(ovos) {
    const o = ovos || {}; const parts = [];
    if (o.duzia) parts.push(o.duzia + '× DÚZIA');
    if (o.dezena) parts.push(o.dezena + '× DEZENA');
    if (o.pente20) parts.push(o.pente20 + '× PENTE 20');
    if (o.pente30) parts.push(o.pente30 + '× PENTE 30');
    if (o.eco) parts.push(o.eco + '× ECONÔMICO');
    return parts.length ? '<div class="dc-eggs">🥚 <span><b>Ovos:</b> ' + parts.join(' · ') + '</span></div>' : '';
  }

  const navBtn = (act, row, icon, label, dis) => '<button type="button" class="dc-navb" data-act="' + act + '" data-row="' + row + '" ' + dis + '>' + ic(icon, 20) + '<span>' + label + '</span></button>';
  const miniBtn = (act, row, icon, label, dis) => '<button type="button" class="dc-b" data-act="' + act + '" data-row="' + row + '" ' + dis + '>' + ic(icon, 16) + label + '</button>';

  // ===== A TELA É PINTADA A PARTIR DA FILA (23/09/2026) =====
  // `state.items` é o que o SERVIDOR mandou. A fila durável é o que o APARELHO já registrou e ainda
  // não teve resposta. Esta projeção põe a fila POR CIMA da lista do servidor. É ela que:
  //   1. faz o toque ficar verde NA HORA, sem nenhuma rede no caminho do dedo;
  //   2. impede o `carregarTudo` (poll de 60 s, voltar pro app, reconectar) de repintar por cima do
  //      que ainda está guardado — foi exatamente esse o defeito que o app de MONTAGEM teve ontem;
  //   3. DESFAZ só o item recusado: quando o servidor diz não, aquela declaração sai de `pendente`
  //      e a projeção devolve o `statusAnterior` que foi congelado no instante do toque.
  // Sobrevive a fechar o app, trocar de aba e ficar sem sinal, porque a fonte é o IndexedDB.
  // ⭐ 28/10/2026 — e os ACKs RECENTES por cima, quando a lista em `state.items` foi pedida ANTES deles (core.js
  // `acksRecentesDeStatus`): o item já saiu da fila, mas a resposta velha do servidor não pode desfazer na tela o que ele aceitou.
  function itensComFila() {
    const mapa = api.filaStatusPendentes && api.filaStatusPendentes();
    const acks = api.acksRecentesDeStatus ? api.acksRecentesDeStatus() : null;
    if ((!mapa || !mapa.size) && (!acks || !acks.size)) return state.items;
    return state.items.map(function (item) {
      const p = mapa && mapa.get(Number(item.row));
      if (!p) {
        const a = acks && acks.get(Number(item.row));
        if (!a) return item;
        return Object.assign({}, item, { status: a.alvo, observacaoPedido: a.obsAlvo || item.observacaoPedido,
          _saiuDaRota: !!a.saiuDaRota });
      }
      if (!p.recusado) {
        return Object.assign({}, item, { status: p.alvo, observacaoPedido: p.obsAlvo || item.observacaoPedido, _fila: p,
          _saiuDaRota: !!p.saiuDaRota });
      }
      // Recusado. Item legado (gravado antes deste commit) não tem `statusAnterior` guardado — aí a
      // tela não inventa um estado anterior: mostra o motivo e mantém o que o servidor diz.
      if (p.anterior === undefined) return Object.assign({}, item, { _fila: p });
      return Object.assign({}, item, {
        status: p.anterior,
        observacaoPedido: p.obsAnterior !== undefined ? p.obsAnterior : item.observacaoPedido,
        _fila: p
      });
    });
  }
  function itemVisivel(row) {
    return itensComFila().find(function (x) { return Number(x.row) === Number(row); });
  }

  // ⛔ ATÉ 23/09/2026 OS BOTÕES DO CARTÃO FICAVAM `disabled` ESPERANDO A REDE, com o texto
  // "⏳ Enviando, aguarde…". Com sinal ruim eram dezenas de segundos de cartão morto — a queixa do
  // dono ("às vezes não vai, aí tem que clicar de novo depois"). A REDE NUNCA MAIS DESABILITA BOTÃO.
  // Sobraram DUAS situações em que o toque não pode ser aceito, e as duas ficam VISÍVEIS na tela:
  //  1. armazenamento indisponível — o app não pode prometer que guardou, então não finge;
  //  2. `aguardando` — uma conferência DELIBERADA de dinheiro está em curso (Corrigir pagamento,
  //     e a conferência de valor que precede o modal de pagamento). Era aqui que o toque sumia em
  //     silêncio: a trava existia, mas nada na tela dizia por quê.
  // O selo "ainda não enviou" é o outro conserto desta volta: quando o servidor não está aceitando,
  // o cartão para de dizer "enviando…" (que soa resolvido) e diz a verdade — sem desfazer nada,
  // sem oferecer descarte, e continuando a reenviar sozinho.
  function estadoDoEnvio(naFila, pendenteLocal, filaDisponivel, aguardando, semSincronizacao) {
    const podeTocar = !!filaDisponivel && !aguardando;
    if (!filaDisponivel) return { podeTocar: podeTocar, classe: '', texto: 'Conferindo os dados guardados neste aparelho…', recusa: null };
    if (naFila && naFila.recusado) return { podeTocar: podeTocar, classe: '', texto: '', recusa: naFila.erro || 'O sistema não aceitou esta marcação.' };
    if (aguardando) return { podeTocar: podeTocar, classe: 'guardado', texto: aguardando, recusa: null };
    if (semSincronizacao && (naFila || pendenteLocal))
      return { podeTocar: podeTocar, classe: 'atraso', texto: 'guardado ✓ este navegador não envia sozinho', recusa: null };
    if (naFila && Number(naFila.tentativas) >= (api.AVISAR_NAO_PASSOU || 3))
      return { podeTocar: podeTocar, classe: 'atraso', texto: 'guardado ✓ ainda não enviou — continuo tentando', recusa: null };
    if (naFila || pendenteLocal) return { podeTocar: podeTocar, classe: 'guardado', texto: 'guardado ✓ enviando…', recusa: null };
    return { podeTocar: podeTocar, classe: '', texto: '', recusa: null };
  }

  function renderEntregaCard(item) {
    const row = Number(item.row);
    const key = api.statusKey(item.status);
    const resolvida = statusResolvido(item);
    const emAndamento = key === 'start';
    const expandido = state.expandidos.has(row);
    const naFila = item._fila || null;
    // 28/10/2026: as pendências são calculadas UMA vez por pintura (`pintarLista` põe em `_pendentesDaPintura`); antes cada cartão
    // copiava a fila inteira de novo (40 cartões = 40 cópias da fila a cada repintura).
    const pendentesLocais = _pendentesDaPintura !== undefined ? _pendentesDaPintura : api.filaRowsPendentes();
    const filaDisponivel = pendentesLocais !== null;
    const env = estadoDoEnvio(naFila, filaDisponivel && pendentesLocais.has(row), filaDisponivel, state.aguardando, state.semSincronizacao);
    const dis = env.podeTocar ? '' : 'disabled';
    const envioHtml = env.recusa
      ? '<div class="dc-recusa">⚠️ <span>' + api.esc(env.recusa)
        + '</span><button type="button" class="dc-recusa-ok" data-act="okrecusa" data-row="' + row + '">Entendi</button></div>'
      : (env.texto ? '<div class="dc-envio ' + env.classe + '">' + api.esc(env.texto) + '</div>' : '');
    const restr = String(item.restricao || '').trim();
    const restrHtml = restr ? '<span class="dc-restr">' + ic('clock', 12) + api.esc(restr) + '</span>' : '';
    const addr = String(item.endereco || '').trim();
    const addrHtml = addr ? '<div class="dc-addr">' + ic('pin', 15, '#94a3b8') + '<span>' + api.esc(addr) + (item.bairro ? ' — ' + api.esc(item.bairro) : '') + '</span></div>' : '';
    const obsE = api.esc(String(item.observacaoPedido || '').trim());
    const nome = api.esc(item.cliente || '');

    // RESOLVIDA e recolhida: discreta, pro olho ir pro que FALTA. Toca pra reabrir (corrigir marcação).
    // Uma RECUSA do servidor nunca cabe aqui: ela precisa do motivo e do "Entendi" na tela.
    if (resolvida && !expandido && !(naFila && naFila.recusado)) {
      const ok = key === 'done';
      // Balão INTEIRO verde claro (entregue) ou vermelho claro (não entregue/cancelado), baixinho.
      return '<article class="dc feito ' + (ok ? 'ok' : 'no') + ' dc-tap" data-act="expand" data-row="' + row + '">'
        + '<div class="dc-head">'
        + '<span class="dc-num ' + (ok ? 'ok' : 'nofeito') + '">' + (ok ? ic('check', 15) : (item.numero || '')) + '</span>'
        + '<span style="font-size:15px;color:' + (ok ? '#15803d' : '#b91c1c') + ';font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + nome + '</span>'
        + '<span class="badge ' + (ok ? 'ok' : 'fail') + '">' + api.esc(api.statusLabel(item.status, item)) + '</span>'
        + (naFila ? '<span class="dc-selo" title="guardado no aparelho, enviando">✓</span>' : '')
        + '</div></article>';
    }

    // Pagamento na porta: o que o entregador RESPONDEU (pra ele ver e corrigir tocando). Só em
    // pedido Entregue pago na porta, e só quando o servidor mandou perguntar.
    let pgHtml = '', btnPgCorrigir = '';
    if (key === 'done' && item.naEntrega && window.PgPorta && window.PgPorta.devePerguntar(state.pgCfg, item)) {
      const ant = pgRespostaAnterior(row, item);
      pgHtml = '<div class="dc-obs">' + api.esc(ant ? window.PgPorta.fraseResposta(ant, state.pgCfg.formas) : '💳 Pagamento na entrega: sem resposta') + '</div>';
      btnPgCorrigir = '<button type="button" class="dc-b desf sm" data-act="pgcorrigir" data-row="' + row + '" ' + dis + '>💳 ' + (ant ? 'Corrigir pagamento' : 'Informar pagamento') + '</button>';
    }
    // Sem o "…" de "Enviando": o rótulo não muda mais por causa da rede (ela não está no caminho).
    const btnEntregue = '<button type="button" class="dc-b ok sm" data-act="done" data-row="' + row + '" ' + dis + '>' + ic('check', 16) + 'Entregue</button>';
    const btnNao = '<button type="button" class="dc-b no sm" data-act="naoentregue" data-row="' + row + '" ' + dis + '>' + ic('x', 15) + 'Não entregue</button>';
    // Desfazer (apertou errado): só aparece se já foi INICIADA ou marcada — volta pra pendente.
    const btnDesfazer = key !== 'cancel' && (emAndamento || resolvida) ? '<button type="button" class="dc-b desf sm" data-act="desfazer" data-row="' + row + '" ' + dis + '>↩ Desfazer</button>' : '';

    // EXPANDIDA: tudo do pedido (pagamento → obs → congelado + ovos → produtos que rolam).
    if (expandido) {
      const cong = item.temCongelado ? '<div style="margin-top:10px"><span class="dc-flag">❄️ Tem congelado</span></div>' : '';
      const prods = Array.isArray(item.produtos) ? item.produtos : [];
      const prodList = prods.map((p) => (p.qtd || 1) + '× ' + api.esc(p.nome || '')).join('<br>');
      return '<article class="dc aberto' + (emAndamento ? ' indo' : '') + '">'
        + '<div class="dc-head"><span class="dc-num">' + (item.numero || '') + '</span>' + restrHtml
        + '<button type="button" class="dc-min" data-act="minimize" data-row="' + row + '">' + ic('chevup', 15) + 'Minimizar</button></div>'
        + '<div class="dc-name" style="font-size:19px">' + nome + '</div>'
        + addrHtml
        + '<div class="dc-nav">' + navBtn('ligar', row, 'phone', 'Ligar', dis) + navBtn('maps', row, 'pin', 'Maps', dis) + navBtn('waze', row, 'nav', 'Waze', dis) + navBtn('whats', row, 'whats', 'WhatsApp', dis) + '</div>'
        + '<div class="dc-sec">' + pagamentoHtml(item, true) + pgHtml
        + (obsE ? '<div class="dc-obs"><b>Obs:</b> ' + obsE + '</div>' : '')
        + cong + ovosHtml(item.ovos) + '</div>'
        + (prods.length ? '<div class="dc-prodhead"><span>Produtos (' + prods.length + ')</span><span style="font-weight:400;display:inline-flex;align-items:center;gap:4px">' + ic('drag', 13) + 'arraste</span></div><div class="dc-prodlist" data-prodrow="' + row + '">' + prodList + '</div>' : '')
        + envioHtml
        + '<div class="dc-btns" style="margin-top:12px">' + btnEntregue + btnNao + '</div>'
        + ((btnDesfazer || btnPgCorrigir) ? '<div class="dc-btns" style="margin-top:7px">' + btnDesfazer + btnPgCorrigir + '</div>' : '')
        + '</article>';
    }

    // RECOLHIDA (a fazer / em andamento): o essencial + botões pequenos. Toca no corpo pra expandir.
    const chev = '<span style="margin-left:auto;color:#94a3b8;display:inline-flex">' + ic('chevdown', 20) + '</span>';
    const linhaAndamento = emAndamento ? '<span class="dc-andlbl">' + ic('play', 13) + 'Em andamento</span>' : '';
    const btnIniciar = emAndamento ? '' : '<button type="button" class="dc-b ini" data-act="start" data-row="' + row + '" ' + dis + ' style="flex:1.4">' + ic('play', 16) + 'Iniciar</button>';
    return '<article class="dc ' + (emAndamento ? 'indo' : '') + '">'
      + '<div class="dc-head dc-tap" data-act="expand" data-row="' + row + '"><span class="dc-num">' + (item.numero || '') + '</span>' + restrHtml + linhaAndamento + chev + '</div>'
      + '<div class="dc-tap" data-act="expand" data-row="' + row + '"><div class="dc-name">' + nome + '</div>' + addrHtml + pagamentoHtml(item, false)
      + (obsE ? '<div class="dc-obs corta">' + obsE + '</div>' : '')
      + '<div class="dc-hint">' + ic('chevdown', 13) + 'toque para ver tudo do pedido</div></div>'
      + envioHtml
      + '<div class="dc-btns">' + btnIniciar + miniBtn('maps', row, 'pin', 'Maps', dis) + miniBtn('waze', row, 'nav', 'Waze', dis) + '</div>'
      + '<div class="dc-btns">' + btnEntregue + btnNao + '</div>'
      + (btnDesfazer ? '<div class="dc-btns" style="margin-top:7px">' + btnDesfazer + '</div>' : '')
      + '</article>';
  }

  // Uma entrega está "resolvida" se foi Entregue, Não entregue ou Cancelado.
  // ("Indo para entrega" e vazio NÃO contam como resolvida.)
  function statusResolvido(item) {
    const s = String(item && item.status || '').toLowerCase();
    return s.indexOf('entregue') >= 0 || s.indexOf('não entreg') >= 0 || s.indexOf('nao entreg') >= 0 || s.indexOf('cancel') >= 0 || s.indexOf('removid') >= 0;
  }

  // Cor + ✓ nos botões de Iniciar/Finalizar (topo) conforme o estado da rota.
  function atualizarBotoesRota() {
    atualizarBotaoMaquininha();
    const bi = document.getElementById('btnIniciarRota');
    const bf = document.getElementById('btnFinalizarRota');
    const ri = state.rotaInfo || {};
    // Linha de status: quadradinho (☑ feito / ☐ a fazer) + rótulo + KM/foto na MESMA linha.
    // FEITO = neutro e travado (não precisa apertar). A FAZER = chamativo (Finalizar = verde).
    const box = (on) => '<span class="rbox' + (on ? ' on' : '') + '">' + (on ? '✓' : '') + '</span>';
    const meta = (km, foto) => '<span class="rmeta">KM ' + (km ? api.esc(String(km)) : '—') + ' · Foto ' + (foto ? '✅' : '❌') + '</span>';
    if (bi) {
      if (state.rotaIniciada || state.rotaFinalizada) {
        bi.innerHTML = box(true) + '<span class="rlbl">Rota iniciada</span>' + meta(ri.kmInicial, ri.fotoInicio) + '<span class="redit">✏️</span>';
        bi.className = 'route-row route-done'; bi.disabled = false; // tocar edita KM/foto
      } else {
        bi.innerHTML = box(false) + '<span class="rlbl">Iniciar entregas</span>';
        bi.className = 'route-row route-cta'; bi.disabled = false;
      }
    }
    if (bf) {
      if (state.rotaFinalizada) {
        bf.innerHTML = box(true) + '<span class="rlbl">Rota finalizada</span>' + meta(ri.kmFinal, ri.fotoFim) + '<span class="redit">✏️</span>';
        bf.className = 'route-row route-done'; bf.disabled = false; // tocar edita KM/foto
      } else if (state.rotaIniciada) {
        bf.innerHTML = box(false) + '<span class="rlbl">Finalizar rota</span>';
        bf.className = 'route-row route-cta go'; bf.disabled = false;
      } else {
        bf.innerHTML = box(false) + '<span class="rlbl">Finalizar rota</span>';
        bf.className = 'route-row route-esperando'; bf.disabled = true; // só habilita depois de iniciar
      }
    }
  }

  // Painel "o que foi registrado" embaixo dos botões: KM + foto + editar/reenviar.
  function renderInfoRota() {
    const el = document.getElementById('infoRota');
    // KM/foto se editam tocando na LINHA de status (✏️). Aqui só o aviso de "salvo, falta subir" quando
    // o iniciar/finalizar ficou pendente de envio (sem internet) — pra tranquilizar que NADA se perdeu.
    // Quando o app já tentou muito e PAROU de tentar sozinho, o aviso não pode continuar dizendo
    // "sobe sozinho" — vira pedido de ação (a foto continua guardada, nada se perdeu).
    const st = (api.statusRotaPendente && api.statusRotaPendente()) || { pendente: !!(api.temRotaPendente && api.temRotaPendente()), desistiu: false };
    if (el) el.innerHTML = !st.pendente ? ''
      : st.desistiu
        ? '<div class="info-rota-linha" style="justify-content:center;color:#b91c1c;font-weight:700;">📷 A foto não subiu. Toque no botão da rota pra enviar de novo, ou avise o supervisor.</div>'
        // 28/10/2026: "sobem sozinhos" era meia verdade — com o app FECHADO nada sobe. Diz a condição de verdade.
        : '<div class="info-rota-linha" style="justify-content:center;color:#92400e;font-weight:700;">⏳ KM/foto guardados no aparelho — sobem com o app aberto e internet</div>';
    return;
    // eslint-disable-next-line no-unreachable
    const ri = state.rotaInfo || {};
    const temInicio = !!(ri.inicio || ri.kmInicial || state.rotaIniciada || state.rotaFinalizada);
    const temFim = !!(ri.fim || ri.kmFinal || state.rotaFinalizada);
    if (!temInicio && !temFim) { el.innerHTML = ''; return; }

    function linha(titulo, km, fotoOk, tipoKm, tipoFoto) {
      // KM/foto já aparecem no botão de status (acima). Aqui só as ações de corrigir, compactas.
      const qual = tipoKm === 'inicial' ? 'início' : 'fim';
      return `<div class="info-rota-linha">
        <span class="acoes-mini">
          <button type="button" class="mini-btn" data-info="km-${tipoKm}">✏️ KM do ${qual}</button>
          <button type="button" class="mini-btn" data-info="foto-${tipoFoto}">📷 ${fotoOk ? 'Trocar' : 'Enviar'} foto do ${qual}</button>
        </span>
      </div>`;
    }

    let html = '';
    if (temInicio) html += linha('Início registrado', ri.kmInicial, ri.fotoInicio, 'inicial', 'inicio');
    if (temFim) html += linha('Fim registrado', ri.kmFinal, ri.fotoFim, 'final', 'fim');
    el.innerHTML = html;
  }

  async function editarKm(tipo) { // 'inicial' | 'final'
    const atual = tipo === 'final' ? (state.rotaInfo.kmFinal || '') : (state.rotaInfo.kmInicial || '');
    const novo = await pedirKm('Corrigir o KM ' + (tipo === 'final' ? 'final' : 'inicial') + ':', atual);
    if (novo === null) return; // cancelou
    try {
      const res = await api.apiEditarKm(state.driver, tipo, novo);
      if (!res || !res.ok) throw new Error();
      await AppUI.alerta('KM atualizado. ✅', { tom: 'success' });
      await carregarTudo(false);
    } catch (e) { await AppUI.alerta('Não foi possível salvar o KM agora. Confira a conexão e tente de novo.', { tom: 'danger' }); }
  }

  async function reenviarFoto(tipo) { // 'inicio' | 'fim'
    const foto = await pedirFotoObrigatoria();
    if (!foto || !foto.base64) { await AppUI.alerta('Nenhuma foto selecionada.', { tom: 'warn' }); return; }
    // ⛔ 28/10/2026 (revisão da leva 2) — a etapa AINDA está pendente no aparelho (não subiu): troca só a foto DENTRO do pendente
    // (KM e hora do toque originais), sem `trocarFoto` e sem rede no toque; ela sobe com a fila. Antes o iniciar/finalizar era
    // chamado de novo e regravava o pendente com KM vazio e a hora da troca. Ver `trocarFotoNoPendente` (core.js).
    const noPendente = api.trocarFotoNoPendente ? api.trocarFotoNoPendente(tipo, state.driver, foto.base64, foto.mimeType) : null;
    if (noPendente) {
      try { renderInfoRota(); } catch (e) {}
      if (!noPendente.ok) { await AppUI.alerta('Não consegui guardar a foto nova: a memória do aparelho está cheia. A foto anterior continua guardada e sobe normalmente.', { titulo: 'Foto não trocada', tom: 'warn' }); return; }
      if (noPendente.parado) { await AppUI.alerta('A foto nova ficou guardada no aparelho, mas o envio desta etapa está parado' + (noPendente.recusa ? ' (o sistema recusou: ' + noPendente.recusa + ')' : '') + '. Avise o escritório.', { titulo: 'Foto trocada no aparelho', tom: 'warn' }); return; }
      agendarEnvio(); // sobe com a fila, sem esperar
      await AppUI.alerta('Foto trocada ✅\n\nA foto nova fica guardada no aparelho junto com o KM e a hora que você já registrou, e sobe com o app aberto e internet.', { titulo: 'Foto trocada no aparelho', tom: 'success' });
      return;
    }
    const km = tipo === 'fim' ? (state.rotaInfo.kmFinal || '') : (state.rotaInfo.kmInicial || '');
    try {
      // ⛔ 28/10/2026 (revisão da leva 2) — TROCAR é pedido explícito (`trocarFoto=1`): o replay do iniciarRota não mexe na foto já
      // gravada, e a tela dizia "Foto enviada ✅" assim mesmo. Agora só diz isso quando o servidor CONFIRMA a troca
      // (`fotoTrocada: true`, servidor da leva 3); sem a confirmação, diz a verdade.
      const res = tipo === 'fim'
        ? await api.apiFinalizarRota(state.driver, km, foto.base64, foto.mimeType, { trocarFoto: true })
        : await api.apiIniciarRota(state.driver, km, foto.base64, foto.mimeType, { trocarFoto: true });
      if (!res || !res.ok) throw new Error();
      // A foto NÃO se perde mais quando não sobe na hora: fica guardada no aparelho e o app tenta
      // sozinho. Por isso a mensagem não manda mais "tente de novo com sinal melhor" (o entregador
      // costumava ver isso com sinal ótimo, e refazer não adiantava nada).
      if (res.precisaLogin) await AppUI.alerta('A foto ficou GUARDADA no aparelho ✅\n\nO sistema pediu seu acesso de novo. Volte na tela inicial, toque no seu nome e digite seu PIN (os últimos 4 números do seu telefone) — aí ela sobe sozinha.', { titulo: 'Precisa entrar de novo', tom: 'warn' });
      else if (res.semFoto || res.pendenteEnvio) await AppUI.alerta('A foto ficou GUARDADA no aparelho ✅\n\nEla sobe sozinha quando a conexão permitir, com o app aberto. Não precisa tirar de novo.', { titulo: 'Guardada — sobe sozinha', tom: 'warn' });
      else if (res.fotoTrocada === true) await AppUI.alerta('Foto enviada. ✅', { tom: 'success' });
      else await AppUI.alerta('O sistema não confirmou a troca da foto: a foto que já estava pode ter ficado. Avise o escritório.', { titulo: 'Troca da foto não confirmada', tom: 'warn' });
      await carregarTudo(false);
    } catch (e) { await AppUI.alerta('Não foi possível enviar a foto agora.', { tom: 'danger' }); }
  }

  // ⭐ 28/10/2026 — PINTAR NO MÁXIMO UMA VEZ POR QUADRO. Um toque no Entregue de uma porta com 2 pedidos repintava a lista INTEIRA
  // (innerHTML de todos os cartões) várias vezes seguidas: uma por irmã, mais a da fila que gravou, mais a da trava que soltou — e
  // cada pintura copiava a fila uma vez por cartão. Agora `renderList()` só AGENDA: todas as chamadas do mesmo quadro viram UMA
  // pintura no próximo requestAnimationFrame (com a tela escondida ela espera a tela voltar — nada é pintado à toa).
  let _pinturaAgendada = 0;
  let _pendentesDaPintura; // as pendências da fila, calculadas 1× por pintura (lidas por `renderEntregaCard`)
  function renderList() {
    if (_pinturaAgendada) return;
    const raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (fn) { return window.setTimeout(fn, 16); };
    _pinturaAgendada = raf(function () { _pinturaAgendada = 0; pintarLista(); }) || 1;
  }

  // ⭐ 28/10/2026 — RECUSA SEM CARTÃO. A recusa de uma marcação aparece no cartão da parada; quando a parada SAIU da lista (tirada
  // da rota, movida para outro entregador), não havia cartão nenhum e a recusa sumia calada — e ainda travava a recarga da lista.
  // Aqui elas ganham uma faixa no topo, com quem era (cliente/pedido guardados no toque) e o "Entendi".
  function faixaRecusasSemCartao(vista) {
    const mapa = api.filaStatusPendentes && api.filaStatusPendentes();
    if (!mapa || !mapa.size) return '';
    const comCartao = new Set(vista.map(function (x) { return Number(x.row); }));
    const linhas = [];
    mapa.forEach(function (p, row) {
      if (!p.recusado || comCartao.has(Number(row))) return;
      const quem = [p.cliente, p.pedido].filter(Boolean).join(' · ') || ('parada ' + row);
      linhas.push('<div class="dc-recusa">⚠️ <span><b>' + api.esc(quem) + ':</b> ' + api.esc(p.erro || 'O sistema não aceitou esta marcação.')
        + '</span><button type="button" class="dc-recusa-ok" data-act="okrecusa" data-row="' + Number(row) + '">Entendi</button></div>');
    });
    return linhas.length ? '<div class="recusas-sem-cartao">' + linhas.join('') + '</div>' : '';
  }

  function pintarLista() {
    // Tudo abaixo lê a VISTA (servidor + fila do aparelho por cima), nunca `state.items` cru:
    // senão o contador e o lembrete de finalizar voltariam atrás a cada poll enquanto houvesse
    // marcação guardada esperando subir.
    const vista = itensComFila();
    const total = vista.length;
    const feitas = vista.filter(statusResolvido).length;
    refreshInfo.textContent = total ? `${feitas} de ${total} concluídas · ${total - feitas} a fazer` : 'Sem entregas neste turno.';

    atualizarBotoesRota();
    renderInfoRota();
    const faixa = faixaRecusasSemCartao(vista);

    if (!state.rotaIniciada) {
      sectionsRoot.innerHTML = faixa + '<div class="empty-box">Clique em "Iniciar entregas" para ver a lista de entregas.</div>';
      sectionsRoot.classList.remove('hidden');
      return;
    }

    // Lembrete quando todas as entregas estão marcadas (e a rota ainda não foi
    // finalizada). Fica NO TOPO, grande, fixo na tela e clicável (toca = finaliza).
    const todasMarcadas = vista.length > 0 && vista.every(statusResolvido);
    const lembrete = (todasMarcadas && !state.rotaFinalizada && !state.enviandoFim)
      ? '<button type="button" class="lembrete-finalizar" data-route="finalizar">✅ Todas as entregas marcadas!<br>👉 Toque aqui para FINALIZAR A ROTA</button>'
      : '';

    // Botão grande de Finalizar embaixo da lista.
    const fimEnviando = !!state.enviandoFim; // 28/10/2026: só durante o ENVIO do fim (a trava do fluxo cobre também o KM e a foto)
    const fimTxt = state.rotaFinalizada ? '✓ Rota finalizada' : (fimEnviando ? '⏳ Enviando…' : '🏁 Finalizar rota');
    const botaoFim = `<button type="button" class="btn-finalizar-bottom ${state.rotaFinalizada ? 'route-success' : ''}" data-route="finalizar" ${state.rotaFinalizada || fimEnviando ? 'disabled' : ''}>${fimTxt}</button>`;

    // A rolagem da lista de produtos de um cartão aberto não volta ao topo a cada repintura (28/10/2026).
    const rolagens = {};
    sectionsRoot.querySelectorAll('.dc-prodlist[data-prodrow]').forEach(function (el) { if (el.scrollTop) rolagens[el.getAttribute('data-prodrow')] = el.scrollTop; });
    _pendentesDaPintura = api.filaRowsPendentes();
    try {
      sectionsRoot.innerHTML = `
      ${faixa}
      ${lembrete}
      <div class="delivery-list">
        ${vista.map(renderEntregaCard).join('')}
      </div>
      ${botaoFim}
    `;
    } finally { _pendentesDaPintura = undefined; }
    Object.keys(rolagens).forEach(function (r) {
      const el = sectionsRoot.querySelector('.dc-prodlist[data-prodrow="' + r + '"]');
      if (el) el.scrollTop = rolagens[r];
    });

    sectionsRoot.classList.remove('hidden');
  }

  /* ⭐ 28/10/2026 — "A TELA VOLTA ATRÁS". `carregarTudo` corria em PARALELO com o envio da fila (poll, voltar ao app, fila
   * esvaziou, cada um disparava o seu), valia a ÚLTIMA resposta que chegasse, e `state.items = result.data` apagava o que o
   * aparelho sabia: uma lista pedida ANTES de um ACK, chegando depois dele, repintava a entrega como pendente.
   * Agora: UMA recarga em voo por vez (quem pede durante uma, ganha outra logo depois, pedida DEPOIS — nunca se perde o pedido);
   * cada recarga leva a marca do relógio lógico do instante em que foi PEDIDA; resposta de uma recarga mais velha do que a última
   * aplicada é descartada; e os ACKs recentes (core.js) ficam por cima até chegar uma lista pedida depois deles. O mesmo vale para
   * o início/fim da rota: uma lista pedida ANTES do Iniciar/Finalizar confirmado não des-inicia nem des-finaliza a tela.
   * `insistir` = uma tentativa extra de rede (abertura e o ↻); as recargas periódicas vão com zero (o próximo gatilho tenta). */
  const recarga = { emVoo: null, pendente: false, pendenteSkeleton: false, pendenteInsistir: false, ultimaAplicada: 0 };
  function carregarTudo(showSkeleton, insistir) {
    if (recarga.emVoo) {
      recarga.pendente = true;
      if (showSkeleton) { recarga.pendenteSkeleton = true; setLoading(true); }
      if (insistir || showSkeleton) recarga.pendenteInsistir = true;
      return recarga.emVoo;
    }
    recarga.emVoo = (async function () {
      let sk = !!showSkeleton, ins = !!(insistir || showSkeleton);
      for (let voltas = 0; voltas < 10; voltas++) {
        recarga.pendente = false; recarga.pendenteSkeleton = false; recarga.pendenteInsistir = false;
        await umaRecarga(sk, ins);
        if (!recarga.pendente) break;
        sk = recarga.pendenteSkeleton; ins = recarga.pendenteInsistir;
      }
    })().finally(function () { recarga.emVoo = null; });
    return recarga.emVoo;
  }

  async function umaRecarga(showSkeleton, insistir) {
    if (showSkeleton) setLoading(true);
    errorBox.classList.add('hidden');

    try {
      await api.filaPronta(); // hidrata antes de tratar pendência local como inexistente
      const pedidoEm = api.proximaMarca ? api.proximaMarca() : 0; // o instante em que a lista foi PEDIDA
      // (revisão da leva 2) quem grava o cache é a TELA, depois de aplicar, com os ACKs recentes por cima (ver abaixo)
      const result = await api.carregarEntregasPorEntregador(state.driver, { retries: insistir ? 1 : 0, gravarCache: false });
      if (pedidoEm && pedidoEm < recarga.ultimaAplicada) return; // chegou depois de uma mais nova: não pinta por cima
      recarga.ultimaAplicada = pedidoEm;
      // ACKs anteriores a ESTE pedido já estão na lista do servidor: saem de cima. (Cache não prova nada: não limpa.)
      if (!result.stale && api.esquecerAcksAte) api.esquecerAcksAte(pedidoEm);
      const pedidaAntesDaRota = pedidoEm && pedidoEm < (state.marcaRota || 0);
      const iniciadaAntes = state.rotaIniciada, finalizadaAntes = state.rotaFinalizada;
      state.items = result.data || [];
      // ⛔ (revisão da leva 2) O CACHE GUARDA O QUE A TELA MOSTRA: a lista com os ACKs recentes por cima (e a fila, que de qualquer
      // jeito é projetada de novo na leitura). Antes ia a lista CRUA desta resposta — pedida, talvez, antes de um ACK — e a
      // reabertura do app (que pinta o cache antes da rede) mostrava a entrega já confirmada como pendente.
      if (!result.stale) api.saveEntregasCache(state.driver, itensComFila().map(function (x) { const c = Object.assign({}, x); delete c._fila; return c; }));
      if (result.rotaInfo && !pedidaAntesDaRota) state.rotaInfo = result.rotaInfo;
      // Só a resposta FRESCA traz a configuração; com cofre 0 o servidor manda perguntar=false e o
      // modal some do aparelho no próximo poll (rollback sem deploy). No cache (stale) fica a última.
      if (result.pgConfig) { state.pgCfg = result.pgConfig; salvarPgCfg(result.pgConfig); }
      // 06/10/2026 — maquininha: a lista do cadastro fica no aparelho (o modal abre SEM rede) e a escolha do servidor
      // só vence a do aparelho se for mais nova (a do aparelho pode estar esperando subir na fila).
      if (result.maquininhas) api.salvarListaMaquininhas(result.maquininhas);
      if (result.servidorTemMaquininha) {
        state.servidorMaq = true;
        try { localStorage.setItem('maq_servidor_v1', '1'); } catch (e) {}
        if (!result.stale) state.precisaMaquininha = result.precisaMaquininha;
      }
      if (!result.stale) api.marcarAtividade(state.driver);
      if (result.maquininha !== undefined) state.maquininha = api.sincronizarEscolhaDoServidor(result.maquininha, state.driver);

      const assinaturaAtual = (result.data || []).map(x => x.row).sort().join(',');
      const assinaturaSalva = sessionStorage.getItem('rota_assinatura_' + state.driver);
      if (state.rotaIniciada && assinaturaSalva && assinaturaAtual !== assinaturaSalva) {
        state.rotaIniciada = false;
        sessionStorage.removeItem('rota_iniciada_' + state.driver);
        sessionStorage.removeItem('rota_assinatura_' + state.driver);
      }

      if (result.rotaIniciada && !state.rotaIniciada) {
        state.rotaIniciada = true;
        sessionStorage.setItem('rota_iniciada_' + state.driver, '1');
      } else if (api.usandoPainel() && !result.stale && !result.rotaIniciada && state.rotaIniciada && !pedidaAntesDaRota
                 && !(api.temRotaPendenteFase && api.temRotaPendenteFase('inicio'))) {
        // SÓ no fluxo do PAINEL (Etapa C), onde a resposta SEMPRE traz rotaIniciada de verdade.
        // No fluxo ANTIGO (Apps Script) a resposta NÃO traz esse campo (vem false), então isto
        // NÃO roda — senão "des-iniciava" a rota do entregador a cada refresh (bug reportado).
        // Aqui (painel) o servidor diz que a rota não está iniciada → libera o "Iniciar" de novo.
        //
        // ⛔ 10/09/2026 — E ERA AQUI QUE O APP DESFAZIA O QUE TINHA ACABADO DE SALVAR.
        // `handleIniciarRota` marca `state.rotaIniciada = true`, mostra "Rota iniciada e SALVA no
        // aparelho ✅" e TRÊS LINHAS DEPOIS chama `carregarTudo(false)`. Quando o envio ficou na
        // fila (foto não subiu, sinal ruim), o servidor AINDA NÃO SABE da rota e responde
        // `rotaIniciada: false` — e este ramo apagava o início. O entregador via a mensagem de
        // sucesso e o botão "Iniciar entregas" voltar, com as entregas trancadas.
        // ⭐ Por isso "no celular da outra pessoa funciona": lá o POST completa, o servidor grava o
        // `inicio`, e este ramo nunca dispara.
        // O guarda certo já existia e ninguém consultava: um início PENDENTE no aparelho significa
        // que o silêncio do servidor não é evidência de que a rota não começou. E ele não prende
        // para sempre — `temRotaPendenteFase` devolve false quando o item desiste, e desistir só
        // acontece depois que o KM subiu (aí o servidor tem `inicio` e nem chegamos aqui).
        state.rotaIniciada = false;
        sessionStorage.removeItem('rota_iniciada_' + state.driver);
        sessionStorage.removeItem('rota_assinatura_' + state.driver);
      }

      // MESMO cuidado acima, agora pra "finalizada" — ESTE bloco não existia (causa raiz do bug
      // "finalizei e depois de um tempo aparece em aberto de novo"): a sessão local (sessionStorage)
      // some quando o Android mata o app em segundo plano, e sem isto o app esquecia que já tinha
      // finalizado mesmo com o servidor já tendo o KM e a foto certinhos.
      // ⛔ (revisão da leva 2) e o mesmo guarda do bloco de baixo: com o FIM ainda pendente no aparelho, o `false` do servidor não
      // apaga a marca. Finalizou sem sinal → a recarga (4 s depois) pedia a lista antes de o fim subir → "não finalizada" apagava a
      // marca → se o Android matasse o app nessa janela, a reabertura religava o GPS e a notificação "Rota em andamento".
      if (result.rotaFinalizada === true) api.guardarFimConfirmado(state.driver, true);
      else if (result.rotaFinalizada === false && !result.stale && !pedidaAntesDaRota
               && !(api.temRotaPendenteFase && api.temRotaPendenteFase('fim'))) api.guardarFimConfirmado(state.driver, false);
      if (result.rotaFinalizada && !state.rotaFinalizada) {
        state.rotaFinalizada = true;
        sessionStorage.setItem('rota_finalizada_' + state.driver, '1');
      } else if (api.usandoPainel() && !result.stale && result.rotaFinalizada === false && state.rotaFinalizada && !pedidaAntesDaRota
                 && !(api.temRotaPendenteFase && api.temRotaPendenteFase('fim'))) {
        // Mesmo guarda do início: com um "finalizar" ainda na fila do aparelho, o servidor
        // legitimamente não sabe do fim — o `false` dele não desfaz o que está salvo aqui.
        // Servidor diz EXPLICITAMENTE que não está finalizada (ex.: supervisor reabriu a rota) —
        // libera de novo. `=== false` (não `!result.rotaFinalizada`) de propósito: se o app novo for
        // ao ar ANTES do servidor novo, a resposta ainda viria SEM este campo (undefined) — tratar
        // undefined igual a false desfaria rotas recém-finalizadas na mesma sessão por engano.
        state.rotaFinalizada = false;
        sessionStorage.removeItem('rota_finalizada_' + state.driver);
      }

      // ⛔ (revisão da leva 2) GPS acompanha o que a recarga descobriu: rota que ACABOU de virar finalizada desliga o rastreio (e a
      // notificação "Rota em andamento"); rota iniciada e não finalizada liga (idempotente — o rastreio ignora se já está ligado).
      if (state.rotaFinalizada && !finalizadaAntes) { try { pararRastreio(); } catch (e) {} }
      else if (!result.stale && state.rotaIniciada && !state.rotaFinalizada && (!iniciadaAntes || finalizadaAntes)) { try { ligarRastreio(); } catch (e) {} }

      renderList();

      if (result.stale) {
        setWarning('As entregas foram abertas pelo último cache salvo. A internet ou a API podem ter falhado agora.');
      } else {
        setWarning(state.items.some(x => x.naEntrega && x.valorConferido === false) ? 'Alguns valores não puderam ser conferidos. Confira antes de cobrar.' : '');
      }
    } catch (error) {
      console.error(error);
      if (error && error.precisaLogin) { await pedirLoginDeNovo(error.message); return; }
      errorBox.classList.remove('hidden');
      state.items = [];
      sectionsRoot.innerHTML = '';
      const detalhes = (error.pendentes || []).map(p => p.cliente + ' · ' + p.pedido + ' (' + p.tipo + ')').join('\n');
      errorBox.style.whiteSpace = 'pre-line';
      // O rodapé "após finalizar no app de montagem" só faz sentido quando o servidor DISSE que há
      // pendência. Sem resposta (sem sinal) a instrução mandava o entregador caçar pendência que não
      // existe; o certo é esperar a conexão e tocar em Atualizar.
      const rodape = (error.bloqueioMontagem && !error.semResposta)
        ? '\n\nApós finalizar no app de montagem, toque em Atualizar.'
        : '\n\nAssim que a internet voltar, toque em Atualizar.';
      errorBox.textContent = (error.bloqueioMontagem ? error.message : 'Não foi possível carregar as entregas deste entregador.') +
        (detalhes ? '\n\nPendentes:\n' + detalhes : '') + rodape;
    } finally {
      setLoading(false);
    }
  }

  // 28/10/2026: só MUDA a lista em memória. Quem chama grava o cache UMA vez por ato (`api.saveEntregasCache`) e pinta (`renderList`,
  // que já junta tudo num quadro) — antes cada irmã gravava a lista inteira no localStorage e repintava a tela inteira.
  // `nextObs === null` (Desfazer, "Ainda não fui") = volta a observação DO CLIENTE: a nota do toque ("Entregue em mãos") tinha
  // tomado o lugar dela no cartão, e o Desfazer apagava as duas ('').
  function updateLocalStatus(row, nextStatus, nextObs) {
    const index = state.items.findIndex((x) => Number(x.row) === Number(row));
    if (index < 0) return null;

    const previous = Object.assign({}, state.items[index]);
    const atual = state.items[index];
    const obsCliente = Object.prototype.hasOwnProperty.call(atual, 'obsCliente') ? atual.obsCliente : (atual.observacaoPedido || '');
    state.items[index] = Object.assign({}, atual, {
      status: nextStatus,
      // a tela lê 'observacaoPedido' (mesma chave da API); gravar em 'observacao' fazia a
      // observação digitada sumir até recarregar.
      observacaoPedido: nextObs === null ? obsCliente : (nextObs !== undefined ? nextObs : atual.observacaoPedido),
      obsCliente: obsCliente
    });
    return previous;
  }

  function restoreLocalItem(row, previous) {
    const index = state.items.findIndex((x) => Number(x.row) === Number(row));
    if (index < 0 || !previous) return;
    state.items[index] = previous;
    api.saveEntregasCache(state.driver, state.items);
    renderList();
  }

  async function openSameTab(url) {
    if (!url || url === '#') {
      await AppUI.alerta('Endereço não disponível para abrir.', { tom: 'warn' });
      return;
    }
    window.location.assign(url);
  }

  // Menu de correção do KM/foto — abre ao tocar na LINHA de "Rota iniciada"/"Rota finalizada" (o ✏️).
  async function menuEditarRota(fase) { // 'inicio' | 'fim'
    const opt = await AppUI.escolher('O que você quer corrigir?', [
      { valor: 'km', rotulo: '✏️ Editar o KM' },
      { valor: 'foto', rotulo: '📷 Trocar a foto' },
    ], { titulo: fase === 'inicio' ? 'Rota iniciada' : 'Rota finalizada' });
    if (opt === null) return;
    if (opt === 'km') await editarKm(fase === 'inicio' ? 'inicial' : 'final');
    else await reenviarFoto(fase);
  }

  // ⛔ 28/10/2026 — A TRAVA DO INICIAR COBRE O FLUXO INTEIRO. Ela era solta logo depois da conferência da montagem e só voltava
  // depois do KM e da foto: no meio (a câmera voltando, a foto sendo comprimida — sem diálogo na tela), um 2º toque em "Iniciar"
  // abria um 2º fluxo em paralelo (outro KM, outra foto). Agora vale do toque até o fim, inclusive o menu de corrigir KM/foto.
  async function handleIniciarRota() {
    if (state.sendingRouteAction) return;
    state.sendingRouteAction = true;
    const loadingRota = document.getElementById('loadingRota');
    const btnIniciarRota = document.getElementById('btnIniciarRota');
    try { await fluxoIniciarRota(loadingRota, btnIniciarRota); }
    finally {
      loadingRota.classList.add('hidden');
      btnIniciarRota.disabled = false;
      state.sendingRouteAction = false;
      renderList();
    }
  }
  async function fluxoIniciarRota(loadingRota, btnIniciarRota) {
    if (state.rotaIniciada) { await menuEditarRota('inicio'); return; } // já iniciada → tocar edita KM/foto
    // Já tem um "iniciar" SALVO nesta fase, esperando subir (sem internet ainda)? Não pede foto de
    // novo do zero — senão a segunda tentativa SOBRESCREVE a primeira, que ainda nem tentou subir.
    if (api.temRotaPendenteFase && api.temRotaPendenteFase('inicio')) {
      await AppUI.alerta('Você já iniciou a rota — o KM e a foto estão salvos no aparelho, esperando a internet voltar para enviar.\n\nNão precisa fazer de novo. Com o app aberto e a conexão de volta, sobe sozinho.', { titulo: 'Já salvo — aguardando envio', tom: 'warn' });
      return;
    }

    // CONFERE A MONTAGEM ANTES de pedir KM e foto. A trava da montagem (08/09) precisa do servidor
    // responder; se ela vier DEPOIS de o entregador digitar o KM e tirar a foto, uma falha de sinal
    // custava tudo o que ele tinha feito (a foto e o KM só existiam na memória — regressão do commit
    // 71d469e). Aqui, se o servidor não responder ou disser que tem pendência, ele ainda não digitou
    // nada: avisa e volta, sem perda. É o mesmo que a tela inicial já faz ao entrar (page-home.js).
    // (28/10/2026: é a ÚNICA conferência do app no Iniciar — a 2ª, que core.js repetia antes de subir o KM, saiu: o servidor
    // confere de novo no próprio `iniciarRota`.)
    loadingRota.textContent = '⏳ Conferindo a montagem da rota…';
    loadingRota.classList.remove('hidden');
    btnIniciarRota.disabled = true;
    try {
      // 20/10/2026: montagem pendente = quadro "Aguardando a montagem" com o que falta; segue sozinho para o KM quando ficar 100%.
      await (api.verificarMontagemEsperando || api.verificarMontagem)(state.driver, false);
    } catch (error) {
      if (error && error.precisaLogin) { await pedirLoginDeNovo(error.message); return; }
      if (error && error.esperaCancelada) return; // saiu da espera tocando em Voltar
      const detalhes = (error.pendentes || []).map(p => p.cliente + ' · ' + p.pedido + ' (' + p.tipo + ')').join('\n');
      await AppUI.alerta(error.message + (detalhes ? '\n\nPendentes:\n' + detalhes : ''), { titulo: 'Montagem da rota', tom: 'warn' });
      return;
    } finally {
      loadingRota.classList.add('hidden');
    }

    let km = await pedirKm('Digite a quilometragem inicial do carro.\n\nNas rotas sem foto, será considerado o KM calculado pelo sistema.');
    if (km === null) return; // cancelou o KM -> aborta

    let foto = await pedirFotoObrigatoria();
    if (!foto) foto = pegarFotoAtrasada(); // chegou depois da rede de segurança? não joga fora

    if (foto) {
      // REGRA: enviou FOTO -> o KM é OBRIGATÓRIO (antes muitos mandavam só a foto, sem KM).
      if (!km) {
        km = await pedirKm('Você enviou a foto. Agora informe o KM inicial do carro.\n\n(o KM é obrigatório quando há foto)', '', true);
        if (km === null) {
          await AppUI.alerta('Como você enviou a foto, o KM é obrigatório.\n\nNada foi enviado — tente de novo informando o KM.', { titulo: 'Falta o KM', tom: 'warn' });
          return; // não salva nada pela metade
        }
      }
    } else {
      // SEM foto: o KM pode ficar em branco (usa o calculado). Mas confirma a falta da foto.
      const segue = await AppUI.confirmar('A foto do KM inicial NÃO foi enviada.\n\nIniciar a rota mesmo assim, SEM foto? (avise o supervisor)', {
        titulo: '⚠️ Sem foto', tom: 'warn', textoOk: 'Iniciar sem foto', textoCancelar: 'Tirar foto',
      });
      if (!segue) return;
      // A foto pode ter chegado ENQUANTO a pergunta estava na tela (câmera muito lenta). Se veio e
      // o KM foi digitado, usa ela em vez de iniciar sem foto. (Sem KM a foto exigiria KM — aí
      // respeita a escolha "sem foto" que a pessoa acabou de fazer.)
      const tardia = pegarFotoAtrasada();
      if (tardia && km) foto = tardia;
    }

    // 06/10/2026 — "Qual maquininha você vai levar?" (pedido do dono), DEPOIS do KM e da foto. Sem rede: lista do
    // aparelho, gravação na fila durável. Rota sem pagamento na entrega = "Não levei" automático, sem modal.
    // ⛔ (revisão independente de 06/10, M2) O KM E A FOTO SÃO GUARDADOS ANTES DO MODAL: `apiIniciarRota` grava no aparelho de
    // forma SÍNCRONA (antes do 1º await) e o envio corre ENQUANTO o entregador escolhe a maquininha. Se o Android matar o app no
    // meio do modal, nada se perde (a regra do 71d469e: nada só na memória depois de uma etapa de gente).
    loadingRota.textContent = 'Enviando, aguarde um momento, não feche a página!';
    loadingRota.classList.remove('hidden');

    const envioInicio = api.apiIniciarRota(state.driver, km, foto ? foto.base64 : '', foto ? foto.mimeType : 'image/jpeg')
      .then(function (r) { return { r: r }; }, function (e) { return { e: e }; });
    try { api.setTurno(api.getTurno()); } catch (e) {} // o turno da rota que ele INICIOU fica fixo (a home reabre nele)
    await escolherMaquininhaNoInicio();

    // ⭐ 28/10/2026 — a lista aparece NA HORA (já está em memória desde a abertura) e a recarga corre atrás, sem segurar o aviso
    // (era `await carregarTudo` antes do aviso: mais uma ida e volta inteira ao servidor no caminho do entregador).
    const marcarIniciada = function () {
      state.rotaIniciada = true;
      state.rotaFinalizada = false;
      state.marcaRota = api.proximaMarca ? api.proximaMarca() : 0; // lista pedida antes disto não des-inicia a tela
      sessionStorage.setItem('rota_iniciada_' + state.driver, '1');
      sessionStorage.setItem('rota_assinatura_' + state.driver, state.items.map(x => x.row).sort().join(','));
      sessionStorage.removeItem('rota_finalizada_' + state.driver);
      renderList();
      carregarTudo(false);
    };
    try {
      const enviado = await envioInicio;
      if (enviado.e) throw enviado.e;
      const res = enviado.r;

      // ⛔ 10/09/2026 — O SERVIDOR RESPONDEU E RECUSOU: isso não é falta de sinal, e não pode virar
      // "iniciada e salva ✅". Cair no catch de baixo marcava a rota como iniciada localmente e
      // dizia "você já pode fazer as entregas" — com o servidor sem saber de rota nenhuma.
      if (res && res.recusadoPeloServidor) {
        await AppUI.alerta(res.error + '\n\nO KM e a foto continuam salvos no aparelho. Confira se o TURNO está certo e avise o supervisor — reenviar sozinho não resolve.',
          { titulo: 'A rota NÃO foi iniciada', tom: 'danger' });
        return;
      }
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Falha ao iniciar rota');
      }

      marcarIniciada();
      if (res.precisaLogin) {
        await AppUI.alerta('Rota iniciada e SALVA no aparelho ✅\n\nO sistema pediu seu acesso de novo. Volte na tela inicial, toque no seu nome e digite seu PIN (os últimos 4 números do seu telefone). O KM e a foto sobem sozinhos logo depois.', { titulo: 'Precisa entrar de novo', tom: 'warn' });
      } else if (res.pendenteEnvio) {
        await AppUI.alerta('Rota iniciada e SALVA no aparelho ✅\n\nVocê está sem internet agora — o KM e a foto sobem sozinhos quando a conexão voltar (com o app aberto). Pode fazer as entregas normalmente.', { titulo: 'Salvo — envia sozinho', tom: 'warn' });
      } else if (res.semFoto) {
        await AppUI.alerta('Rota iniciada e KM salvo ✅\n\nA foto ainda não subiu, mas ficou GUARDADA no aparelho e sobe sozinha. Não precisa iniciar de novo — pode seguir com as entregas.', { titulo: 'Iniciada — a foto sobe sozinha', tom: 'warn' });
      } else {
        await AppUI.alerta('Rota iniciada com sucesso. ✓', { tom: 'success' });
      }
    } catch (error) {
      console.error(error);
      if (error.bloqueioMontagem) {
        await carregarTudo(false);
        await AppUI.alerta(error.message, { titulo: 'Montagem da rota', tom: 'warn' });
        return;
      }
      marcarIniciada();
      await AppUI.alerta('Rota iniciada. Houve um problema ao registrar no servidor, mas você já pode fazer as entregas.', { tom: 'warn' });
    } finally {
      // Liga o rastreamento GPS da rota (não trava nada se falhar). 28/10/2026: com o dia e o TURNO certos (`window.getTurno` não
      // existia: os pontos iam sem turno e sumiam do mapa).
      try { if (state.rotaIniciada) ligarRastreio(); } catch (e) {}
    }
  }

  // ===== MAQUININHA DA ROTA (06/10/2026) =====
  // No INICIAR (depois do KM e da foto) e no botão "Trocar maquininha" ao lado de "Trocar entregador". Grava na hora
  // (aparelho + fila durável) e sobe em segundo plano como `definirMaquininha`; nada de rede no caminho do dedo.
  async function escolherMaquininhaNoInicio() {
    if (!window.Maquininha || !api.registrarMaquininha || !state.servidorMaq) return;
    let escolha;
    if (state.precisaMaquininha === false) escolha = { semMaquininha: true, automatico: true }; // rota sem pagamento na entrega
    else escolha = await window.Maquininha.escolher({ lista: api.lerListaMaquininhas(), atual: state.maquininha, obrigatorio: true });
    if (!escolha) return;
    await gravarMaquininha(escolha);
  }
  async function gravarMaquininha(escolha) {
    try { state.maquininha = await api.registrarMaquininha(escolha); agendarEnvio(); }
    catch (e) {
      console.error('[maquininha]', e);
      await AppUI.alerta('Não consegui guardar a maquininha neste aparelho. Toque em "Trocar maquininha" para informar de novo.', { titulo: 'Maquininha', tom: 'warn' });
    }
    atualizarBotaoMaquininha();
  }
  async function trocarMaquininha() {
    if (state.sendingAction || state.sendingRouteAction || !window.Maquininha) return;
    state.sendingAction = true;
    try {
      const escolha = await window.Maquininha.escolher({ lista: api.lerListaMaquininhas(), atual: state.maquininha, obrigatorio: false, titulo: 'Qual maquininha está com você?' });
      if (escolha) await gravarMaquininha(escolha);
    } finally { state.sendingAction = false; }
  }
  function atualizarBotaoMaquininha() {
    const b = document.getElementById('btnTrocarMaq');
    if (!b || !window.Maquininha) return;
    const mostrar = !!(state.servidorMaq && (state.rotaIniciada || state.rotaFinalizada));
    b.classList.toggle('hidden', !mostrar);
    b.textContent = window.Maquininha.rotulo(state.maquininha);
    // Rota iniciada sem a maquininha informada (app antigo no Iniciar, ou lista que não tinha chegado): chama a atenção.
    b.classList.toggle('maq-falta', mostrar && !state.maquininha && state.precisaMaquininha !== false);
  }

  // ⛔ 28/10/2026 — A TRAVA DO FINALIZAR COBRE O FLUXO INTEIRO (como o Iniciar): ela só era ligada DEPOIS do KM e da foto, e um 2º
  // toque no "Finalizar" (ou no lembrete do topo) no meio abria um 2º fluxo. E o texto do fim deixou de prometer o que não acontece:
  // "pode fechar o app tranquilo, sobe sozinho" — com o app FECHADO nada sobe, e a home nem enviava a fila.
  async function handleFinalizarRota() {
    if (state.sendingRouteAction) return;
    state.sendingRouteAction = true;
    const loadingRota = document.getElementById('loadingRota');
    const btnFinalizarRota = document.getElementById('btnFinalizarRota');
    try { await fluxoFinalizarRota(loadingRota, btnFinalizarRota); }
    finally {
      loadingRota.classList.add('hidden');
      btnFinalizarRota.disabled = false;
      state.enviandoFim = false;
      state.sendingRouteAction = false;
      renderList();
    }
  }
  // "Faltam N envios": o que ainda está SÓ neste aparelho (fila + KM/foto) do entregador da tela. Zero = nada a dizer.
  function linhaEnviosFaltando() {
    const c = api.contarEnviosPendentes ? api.contarEnviosPendentes({ soDoAtivo: true }) : null;
    if (!c || !c.total) return '';
    return '\n\n⚠️ Faltam ' + c.total + (c.total === 1 ? ' envio' : ' envios') + ' deste aparelho. Abra o app quando tiver internet — com o app fechado nada sobe.';
  }
  async function fluxoFinalizarRota(loadingRota, btnFinalizarRota) {
    if (state.rotaFinalizada) { await menuEditarRota('fim'); return; } // já finalizada → tocar edita KM/foto

    if (!state.rotaIniciada) {
      await AppUI.alerta('Clique primeiro em "Iniciar entregas".', { tom: 'warn' });
      return;
    }
    // ⭐ 28/10/2026 — a fila sobe JÁ, no toque: enquanto o entregador digita o KM e tira a foto, as marcações guardadas vão subindo.
    agendarEnvio();
    // Já tem um "finalizar" SALVO nesta fase, esperando subir (sem internet ainda)? Não pede foto de
    // novo do zero — é a causa do "mandei foto e ele pede outra": a sessão local esquece o que já foi
    // feito, mas o que estava salvo (esperando subir) ainda não confirmou, e uma 2ª tentativa SOBRESCREVE.
    if (api.temRotaPendenteFase && api.temRotaPendenteFase('fim')) {
      await AppUI.alerta('Você já finalizou a rota — o KM e a foto estão salvos no aparelho, esperando a internet para enviar.\n\nNão precisa fazer de novo: eles sobem com o app ABERTO e internet.' + linhaEnviosFaltando(), { titulo: 'Já salvo — aguardando envio', tom: 'warn' });
      return;
    }

    let km = await pedirKm('Digite a quilometragem final do carro.\n\nNas rotas sem foto, será considerado o KM calculado pelo sistema.');
    if (km === null) return; // cancelou o KM -> aborta

    let foto = await pedirFotoObrigatoria();
    if (!foto) foto = pegarFotoAtrasada(); // chegou depois da rede de segurança? não joga fora

    if (foto) {
      // REGRA: enviou FOTO -> o KM é OBRIGATÓRIO (antes muitos mandavam só a foto, sem KM).
      if (!km) {
        km = await pedirKm('Você enviou a foto. Agora informe o KM final do carro.\n\n(o KM é obrigatório quando há foto)', '', true);
        if (km === null) {
          await AppUI.alerta('Como você enviou a foto, o KM é obrigatório.\n\nNada foi enviado — tente de novo informando o KM.', { titulo: 'Falta o KM', tom: 'warn' });
          return; // não salva nada pela metade
        }
      }
    } else {
      // SEM foto: o KM pode ficar em branco (usa o calculado). Mas confirma a falta da foto.
      const segue = await AppUI.confirmar('A foto do KM final NÃO foi enviada.\n\nFinalizar a rota mesmo assim, SEM foto? (avise o supervisor)', {
        titulo: '⚠️ Sem foto', tom: 'warn', textoOk: 'Finalizar sem foto', textoCancelar: 'Tirar foto',
      });
      if (!segue) return;
      // Mesma proteção do iniciar: foto que chegou enquanto a pergunta estava na tela não se perde.
      const tardia = pegarFotoAtrasada();
      if (tardia && km) foto = tardia;
    }

    state.enviandoFim = true;
    loadingRota.textContent = 'Enviando, aguarde um momento, não feche a página!';
    loadingRota.classList.remove('hidden');
    btnFinalizarRota.disabled = true;
    renderList(); // o botão de baixo mostra "⏳ Enviando…"

    try {
      const res = await api.apiFinalizarRota(
        state.driver,
        km,
        foto ? foto.base64 : '',
        foto ? foto.mimeType : 'image/jpeg'
      );

      // ⛔ 10/09/2026 — O SERVIDOR RESPONDEU E RECUSOU: isso não é falta de sinal, e não pode virar
      // "salvo, sobe sozinho". Antes o entregador fechava o app achando estar resolvido enquanto a
      // foto era reenviada e recusada a cada poll, sem fim. Mostra o motivo do servidor e para.
      if (res && res.recusadoPeloServidor) {
        await AppUI.alerta(res.error + '\n\nO KM e a foto continuam salvos no aparelho. Avise o supervisor — reenviar sozinho não resolve.',
          { titulo: 'A rota NÃO foi finalizada', tom: 'danger' });
        return;
      }
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Falha ao finalizar rota');
      }

      state.rotaFinalizada = true;
      state.rotaIniciada = false;
      state.marcaRota = api.proximaMarca ? api.proximaMarca() : 0; // lista pedida antes disto não des-finaliza a tela
      api.guardarFimConfirmado(state.driver, true);
      sessionStorage.setItem('rota_finalizada_' + state.driver, '1');
      sessionStorage.removeItem('rota_iniciada_' + state.driver);
      sessionStorage.removeItem('rota_assinatura_' + state.driver);
      state.enviandoFim = false;
      // Desliga o rastreamento GPS (rota finalizada) — inclusive o do Android que ficou de uma abertura anterior do app.
      try { pararRastreio(); } catch (e) {}
      renderList();
      carregarTudo(false); // a recarga corre atrás; o aviso não espera por ela

      // ⭐ 28/10/2026 — o que AINDA não subiu deste aparelho (a fila disparada no toque já teve o tempo do KM e da foto).
      const falta = linhaEnviosFaltando();
      if (res.precisaLogin) {
        await AppUI.alerta('Rota finalizada e SALVA no aparelho ✅\n\nO sistema pediu seu acesso de novo. Volte na tela inicial, toque no seu nome e digite seu PIN (os últimos 4 números do seu telefone). O KM e a foto sobem logo depois, com o app aberto.' + falta, { titulo: 'Precisa entrar de novo', tom: 'warn' });
      } else if (res.pendenteEnvio) {
        // Sem internet AGORA: o KM e a foto FICARAM SALVOS no aparelho. Eles sobem quando o app estiver ABERTO com internet (a home
        // também envia ao abrir). NADA se perde — mas fechado, nada sobe: o aviso diz quantos faltam.
        await AppUI.alerta('Rota finalizada e SALVA no aparelho ✅\n\nVocê está sem internet agora. O KM e a foto ficam guardados neste aparelho e sobem quando o app estiver aberto com internet.' + (falta || '\n\nAbra o app quando tiver internet.'), { titulo: 'Salvo — falta enviar', tom: 'warn' });
      } else if (res.semFoto) {
        await AppUI.alerta('Rota finalizada e KM salvo ✅\n\nA foto ainda não subiu, mas ficou GUARDADA no aparelho e sobe com o app aberto e internet. Não precisa finalizar de novo.' + falta, { titulo: 'Finalizada — falta a foto', tom: 'warn' });
      } else if (falta) {
        await AppUI.alerta('Rota finalizada ✅' + falta, { titulo: 'Falta enviar', tom: 'warn' });
      } else {
        await AppUI.alerta('Rota finalizada com sucesso. ✓', { tom: 'success' });
      }
    } catch (error) {
      console.error(error);
      await AppUI.alerta('Não foi possível finalizar a rota. Tente de novo.', { tom: 'danger' });
    }
  }

  // GPS da rota (28/10/2026): dia e TURNO certos (antes `window.getTurno`, que não existe — os pontos iam sem turno e sumiam do
  // mapa), e o parar também desliga o rastreio que o Android manteve de uma abertura anterior do app (rastreio.js).
  function ligarRastreio() {
    if (!window.Rastreio) return;
    window.Rastreio.iniciar(state.driver, api.diaSP ? api.diaSP() : undefined, api.getTurno());
  }
  // (revisão da leva 2) o parar leva a rota DESTA tela: desliga só o rastreio dela, nunca o de outro turno/entregador.
  function pararRastreio() { if (window.Rastreio) window.Rastreio.parar(state.driver, api.diaSP ? api.diaSP() : undefined, api.getTurno()); }

  // ===== PAGAMENTO NA PORTA (05/09/2026) — o entregador confirma FORMA e VALOR ao marcar Entregue =====
  // O modal em si mora em pagamento-porta.js (PgPorta). Aqui: quando abre, com o que, e como a
  // resposta SOBE — como ação própria `confirmarPagamento`, logo DEPOIS do `marcarEntregue` da
  // mesma row e com o MESMO ts_device (a hora do toque é a hora que a Cielo vai procurar; e
  // `parada_id:ts_device` é a chave de idempotência do servidor: a fila pode reenviar sem duplicar).
  //
  // ⛔ As DUAS portas do marcarEntregue passam por aqui (o botão Entregue e o menu "você tem uma
  //    entrega em andamento"). Uma porta sem modal = dado pela metade.
  // Cancelar o pagamento cancela a confirmação da entrega: valor obrigatório.
  // Confere o valor quando há conexão. Sem confirmação, pede o valor recebido sem presumir o cache.
  // A entrega e a declaração continuam funcionando offline pela fila existente.

  // A resposta que já existe para esta row: dada nesta sessão, esperando na fila, ou a que o
  // servidor mandou (`pgConfirmado`, quando a API tiver o leitor). Serve para a tela 4 (manter/corrigir).
  function pgRespostaAnterior(row, item) {
    const r = Number(row);
    if (item && item.pgConfirmado && item.pgConfirmado.aprovacaoValor === 'rejeitado') {
      const c = item.pgConfirmado;
      return { forma: c.forma, operadora: c.operadora || null, valor: c.valor, digitado: c.digitado, aprovacao: 'rejeitado' };
    }
    const mem = state.pgRespondido[r];
    const q = api.filaParamsPendentes && api.filaParamsPendentes(r, 'confirmarPagamento');
    // O relógio do aparelho não decide qual pendência existe. A fila durável vence
    // a memória visual até ACK explícito ou correção vinculada aos seus IDs.
    const filaAtual = !!q;
    if (filaAtual) return { forma: q.pg_forma || '', operadora: q.pg_operadora || null, valor: q.pg_valor === '' || q.pg_valor == null ? null : Number(q.pg_valor), digitado: Number(q.pg_digitado) === 1, naoSei: Number(q.pg_naosei) === 1, valeNome: q.pg_vale_nome || null, cartaoAgrupado: q.pg_cartao_agrupado === 1, rejeitada: q.pg_recusado === true, erro: q.pg_recusa || null, simples: Number(q.pg_simples) === 1 };
    if (mem) return mem;
    const c = item && item.pgConfirmado;
    if (c && typeof c === 'object' && c.forma) return { forma: c.forma, operadora: c.operadora || null, valor: c.valor == null ? null : Number(c.valor), digitado: !!c.digitado, naoSei: c.desfecho === 'nao-sei', valeNome: c.valeNome || null, aprovacao: c.aprovacaoValor || null };
    return null;
  }

  // Consulta apenas os pedidos pagos na entrega que a pessoa está abrindo/conferindo.
  // A consulta regular da rota continua sem chamadas adicionais à Instabuy.
  async function conferirGrupoValores(grupo) {
    if (!api.usandoPainel()) return grupo;
    let atuais = [];
    try {
      if (navigator.onLine !== false) {
        // ⛔ 23/09/2026 (2ª volta) — ESTA CHAMADA USAVA O TIMEOUT GERAL (15 s) E FICAVA ENTRE O
        // DEDO E O MODAL DE PAGAMENTO: o "Como foi a entrega?" fechava e a tela ficava morta, sem
        // diálogo, sem selo, sem nada — justo nas entregas que envolvem dinheiro. O guarda
        // `navigator.onLine` só salva no offline TOTAL; no "sistema oscilando" que o dono descreveu
        // o `onLine` é `true` e o await ia até o fim. Agora o orçamento é curto (TEMPO_CONFERIR_MS)
        // e ela sai ADIANTADA, junto com o primeiro diálogo (ver `adiantarConferenciaPg`).
        const r = await api.apiGet({ action: 'conferirValores', rows: grupo.map(x => x.row).join(','),
          entregador: state.driver, turno: api.getTurno() }, { retries: 0, timeoutMs: api.TEMPO_CONFERIR_MS });
        if (r && r.ok && Array.isArray(r.items)) atuais = r.items;
      }
    } catch (e) { /* a declaração continua; o valor será informado pelo entregador */ }
    const conferidos = grupo.map(x => {
      const a = atuais.find(y => Number(y.row) === Number(x.row) && String(y.pedido) === String(x.pedido));
      const indice = state.items.findIndex(y => Number(y.row) === Number(x.row));
      const base = indice >= 0 ? state.items[indice] : x;
      // Preserva o status atual e rejeita uma resposta de valor anterior à já mostrada.
      const novo = api.manterValorMaisRecente({ ...base, ...(a || {}), valorConferido: !!a && a.valorConferido === true }, [base]);
      if (indice >= 0) state.items[indice] = novo;
      return novo;
    });
    api.saveEntregasCache(state.driver, state.items);
    renderList();
    return conferidos;
  }

  // Dispara a conferência de valor ANTES dos diálogos do entregador, para ela correr EM PARALELO
  // com os segundos que ele leva lendo "Como foi a entrega?" e "Quem recebeu?". É o que tira a
  // espera de rede do caminho do dedo sem tirar o valor conferido do modal de dinheiro: com a rede
  // normal a resposta já chegou quando o modal precisa dela. Nunca rejeita; se falhar ou estourar o
  // orçamento, devolve null e o modal abre no modo degradado (o entregador digita o valor).
  // 28/10/2026: decide pelo GRUPO da porta (a tocada pode ser paga online e a irmã, na porta) — ver `coletarPagamento`.
  function adiantarConferenciaPg(item, irmas) {
    try {
      const Pg = window.PgPorta;
      if (!Pg || !api.usandoPainel()) return null;
      if (state.pgCfg && state.pgCfg.simples && Pg.perguntarSimples) return null; // pergunta única: o valor não é perguntado
      const grupo = Pg.irmasNaPorta(irmas && irmas.length ? irmas : [item], item && item.row)
        .filter(function (x) { return Pg.devePerguntar(state.pgCfg, x); });
      if (!grupo.length) return null;
      const p = conferirGrupoValores(grupo);
      return p && p.then ? p.then(function (g) { return g; }, function () { return null; }) : null;
    } catch (e) { return null; }
  }

  // Abre o modal para o pedido tocado e as irmãs pagas na porta. Devolve { porRow } ou null quando
  // não há o que perguntar (cofre 0 / pago online / PgPorta não carregou).
  // `conferencia` = a promessa já em voo de `adiantarConferenciaPg`; aqui só se recolhe o que deu
  // tempo de chegar. Sem ela (correção de pagamento pela tela 4), a conferência sai agora.
  /* ⛔ 21/10/2026 — AS IRMÃS DA MESMA PORTA NUNCA INCLUEM PEDIDO CANCELADO (caso Faní Moritz, rota do Luiz Fábio, 20/10).
   * A loja cancelou o LOJA-2174 com ele na rua e refez o MESMO pedido (LOJA-2324); os dois ficaram seguidos, mesmo cliente e
   * endereço → o MESMO número de parada (16). As irmãs eram "todas com o mesmo número", e o cancelado entrava junto: a pergunta
   * da cobrança somava os dois ("Valor dos 2 pedidos: R$ 233,70" para um pedido de R$ 116,85) e o Entregue tentava marcar o
   * cancelado também. Agora: mesmo número E não cancelado/saiu da rota. A própria tocada sempre entra.
   * ⛔ 28/10/2026 — E NUNCA ARRASTAM PEDIDO JÁ DECIDIDO (revisão de 28/10). Mesmo endereço, um "Não entregue" (Cliente não estava,
   * ou o novo "Saiu da minha rota", que o servidor novo grava como "Não entregue") e outro pendente: tocar Entregue no pendente
   * marcava os DOIS e a pergunta somava "Valor dos 2 pedidos". Agora só entra junto a irmã no MESMO estado da tocada:
   *   · Iniciar/Entregue (modo padrão): a tocada ABERTA (pendente ou indo) e as irmãs abertas — pendente e indo são a mesma
   *     família porque o servidor só deixa UM "Indo" por entregador e a irmã que foi junto pode voltar como pendente. Tocada já
   *     decidida (corrigindo um "Não entregue", por exemplo) → só ela: um decidido nunca muda por tabela;
   *   · 'mesmoStatus' (Desfazer, "Ainda não fui", corrigir o pagamento): só as irmãs com EXATAMENTE o status da tocada.
   * Cancelado e "Saiu da minha rota" nunca andam junto, e tocar num deles mexe só nele. Quem grava RECALCULA o grupo logo antes
   * de gravar (a lista pode ter mudado com o diálogo aberto). Zero rede. */
  function irmasAtivas(vista, item, modo) {
    const k = (x) => api.statusKey(x && x.status);
    const fora = (x) => k(x) === 'cancel' || (api.ehSaiuDaRota ? api.ehSaiuDaRota(x) : /removid/i.test(String((x && x.status) || '')));
    if (!item || item.numero == null || fora(item)) return [item];
    const exato = modo === 'mesmoStatus';
    const aberta = (x) => k(x) === 'pending' || k(x) === 'start';
    if (!exato && !aberta(item)) return [item];
    // (revisão da leva 2) "Não entregue" é marcado UM A UM, então também volta um a um: dois "Cliente não estava" da mesma porta,
    // marcados separados, não podem voltar juntos num Desfazer só.
    if (exato && k(item) === 'fail') return [item];
    return vista.filter((x) => Number(x.numero) === Number(item.numero)
      && (Number(x.row) === Number(item.row) || (!fora(x) && (exato ? k(x) === k(item) : aberta(x)))));
  }

  /* ⛔ 28/10/2026 — A PERGUNTA DO PAGAMENTO ERA DECIDIDA SÓ PELA TOCADA. Mesma porta, A pago online e B na entrega: Entregue em A
   * marcava B também, SEM perguntar como B foi pago (o `devePerguntar` olhava só A). Agora decide pelo GRUPO: havendo qualquer
   * parada paga na porta entre as que vão junto, pergunta — e o modal abre com a tocada se ela for paga na porta, senão com a
   * primeira paga na porta. E relê cada parada de `state.items` NA HORA (o valor pode ter mudado com os diálogos abertos). */
  async function coletarPagamento(item, irmas, tsDevice, anterior, conferencia) {
    const Pg = window.PgPorta;
    const base = irmas && irmas.length ? irmas : [item];
    if (!Pg) {
      if (state.pgCfg && state.pgCfg.perguntar && base.some(function (x) { return x && x.naEntrega; })) {
        await AppUI.alerta('Atualize o app para informar o pagamento antes de salvar.', { tom: 'warn' });
        return { cancelado: true, porRow: {} };
      }
      return null;
    }
    const relidos = base.map(function (x) {
      const atual = x && state.items.find(function (y) { return Number(y.row) === Number(x.row); });
      return atual ? Object.assign({}, atual, { status: x.status, observacaoPedido: x.observacaoPedido, _fila: x._fila, _saiuDaRota: x._saiuDaRota }) : x;
    });
    let grupo = Pg.irmasNaPorta(relidos, item && item.row).filter(function (x) { return Pg.devePerguntar(state.pgCfg, x); });
    if (!grupo.length) return null;
    let alvo = grupo.find(function (x) { return Number(x.row) === Number(item.row); }) || grupo[0];
    if (Number(alvo.row) !== Number(item.row)) anterior = pgRespostaAnterior(alvo.row, alvo);
    // ⭐ 06/10/2026 — A PERGUNTA ÚNICA ("O cliente te pagou de alguma forma?"). Nenhuma rede antes dela: o valor não é
    // mais perguntado (o servidor usa o do pedido), então a conferência de valor não precisa mais ficar na frente do dedo.
    if (state.pgCfg && state.pgCfg.simples && Pg.perguntarSimples) {
      return Pg.perguntarSimples({ item: alvo, irmas: grupo, cfg: state.pgCfg, ui: window.AppUI, tsDevice, tocado: item });
    }
    if (api.usandoPainel()) {
      // ⛔ 23/09/2026 (2ª volta) — ESTA ESPERA ERA INVISÍVEL E LONGA: o "Como foi a entrega?"
      // fechava e a tela ficava morta até 15 s, sem diálogo, sem selo, sem botão cinza — justo nas
      // entregas que envolvem dinheiro, e o dedo nervoso tocava de novo. Agora ela (a) sai
      // adiantada e corre junto com os diálogos (`adiantarConferenciaPg`), (b) tem orçamento
      // curto (`TEMPO_CONFERIR_MS`), e (c) o que sobrar de espera aparece na tela. Continua sendo
      // uma espera de propósito: é ela que decide o valor oferecido no modal.
      const conferido = await comEspera('conferindo o valor a receber…', function () {
        return conferencia ? conferencia : conferirGrupoValores(grupo);
      });
      if (conferido && conferido.length) {
        const rows = new Set(grupo.map(function (x) { return Number(x.row); }));
        const doGrupo = conferido.filter(function (x) { return rows.has(Number(x.row)); });
        if (doGrupo.length) grupo = doGrupo;
      }
      alvo = grupo.find(function (x) { return Number(x.row) === Number(alvo.row); }) || alvo;
    }
    return Pg.perguntar({ item: alvo, irmas: grupo, cfg: state.pgCfg, ui: window.AppUI, tsDevice, anterior: anterior || undefined, tocado: item });
  }

  // Congela, NO INSTANTE DA GRAVAÇÃO, o estado que a parada tinha ANTES do toque. É isto que
  // permite DESFAZER só este item quando o servidor recusa, sem depender da lista em memória (que
  // até lá já pode ter sido recarregada várias vezes). Vive no `meta` do item da fila, que é
  // durável e imutável junto com o payload. Parada que não está na lista não ganha palpite: sem os
  // campos, a projeção cai no que o servidor disser.
  // 28/10/2026: e QUEM é (cliente/pedido) — a recusa de uma parada que depois saiu da lista ainda diz de quem era (faixa do topo).
  // (revisão da leva 2) lido da VISTA (fila e ACKs recentes por cima), não de `state.items` cru: com uma lista velha por baixo, a
  // recusa de um Desfazer devolvia um "anterior" que o servidor já não tinha (pendente, num pedido entregue) e convidava a marcar
  // de novo.
  function metaDeStatus(row) {
    const atual = itensComFila().find(function (x) { return Number(x.row) === Number(row); });
    if (!atual) return { row: Number(row) };
    return { row: Number(row), statusAnterior: atual.status || '', obsAnterior: atual.observacaoPedido || '',
      cliente: String(atual.cliente || '').slice(0, 80), pedido: String(atual.pedido || '').slice(0, 40) };
  }

  // ⭐ O CAMINHO DO DEDO. Grava a intenção na fila durável e volta. NENHUMA rede aqui: é o `await`
  // deste commit no IndexedDB — e só ele — que fica entre o toque e o verde na tela. Se a gravação
  // falhar, quem chama avisa e NÃO pinta nada: o app não finge o que não guardou.
  async function guardarNaFila(listaDeParams) {
    return api.enfileirarLote(listaDeParams.map(function (params) {
      return { params: params, meta: metaDeStatus(params.row) };
    }));
  }
  // Fora do caminho do dedo de propósito: o envio é serial e em segundo plano, e o entregador já
  // pode tocar a próxima entrega. Falhar aqui não perde nada — o item continua na fila.
  function agendarEnvio() {
    try {
      const p = api.processarFila();
      // ⛔ 23/09/2026 (2ª volta) — O RESULTADO ERA DESCARTADO AQUI. Em navegador SEM Web Locks a
      // fila devolve `sincronizacaoIndisponivel` e NÃO envia nada; como só o "Entregue" olhava
      // essa resposta (dentro de `enviarRecebimentoGuardado`), as OUTRAS marcações — Não entregue,
      // Cancelado, Iniciar, Desfazer e o Iniciar implícito do Maps/Waze — ficavam verdes com o selo
      // "guardado ✓ enviando…" PARA SEMPRE, sem nada chegar ao painel e sem um aviso sequer. A tela
      // mentia a rota inteira. Agora todo caminho passa por aqui: avisa uma vez e o selo diz a verdade.
      if (p && p.then) p.then(function (r) { if (r && r.sincronizacaoIndisponivel) avisarSemSincronizacao(); }, function () {});
    } catch (e) {}
  }
  // Uma vez por sessão o modal; o selo do cartão fica para sempre (é ele que impede a tela de mentir).
  async function avisarSemSincronizacao() {
    if (state.semSincronizacao) { renderList(); return; }
    state.semSincronizacao = true;
    renderList();
    await AppUI.alerta('Este navegador não consegue enviar sozinho. Suas marcações estão GUARDADAS no aparelho e nenhuma se perdeu, mas elas NÃO estão subindo: use o aplicativo (ou atualize o navegador) para enviá-las.',
      { titulo: 'Guardado, ainda não enviado', tom: 'warn' });
  }
  // Espera DELIBERADA (sempre de dinheiro) com a tela dizendo o que está acontecendo. O envio de
  // MARCAÇÃO nunca passa por aqui: ele não espera ninguém.
  async function comEspera(texto, trabalho) {
    state.aguardando = texto;
    renderList();
    try { return await trabalho(); }
    finally { state.aguardando = null; renderList(); }
  }
  async function avisarArmazenamento() {
    await AppUI.alerta('Não consegui guardar esta marcação no aparelho, então NÃO marquei nada. Tente de novo; se continuar, avise o supervisor.',
      { titulo: 'Não guardei', tom: 'danger' });
  }

  // Nenhuma chamada de rede antecede esta gravação do ATO INTEIRO no aparelho.
  async function guardarRecebimento(marcacoes, pgPorRow, tsDevice) {
    const entradas = marcacoes.map(params => ({ params, meta: metaDeStatus(params.row) }));
    for (const rk of Object.keys(pgPorRow || {})) {
      const r = Number(rk), resposta = pgPorRow[r];
      if (resposta) entradas.push({ params: window.PgPorta.montarParams(r, tsDevice, resposta, false), meta: { row: r } });
    }
    const ids = await api.enfileirarLote(entradas);
    // O estado visual só muda depois que a gravação local foi confirmada.
    for (const rk of Object.keys(pgPorRow || {})) {
      const r = Number(rk);
      if (pgPorRow[r]) state.pgRespondido[r] = { ...pgPorRow[r], tsDevice };
    }
    return ids;
  }
  // (revisão da leva 2) `processarFila` devolve só a PASSADA ATUAL. Em segundo plano (o toque normal), se os meus itens ainda estão
  // pendentes e há uma volta correndo, acompanho a próxima — a recusa de dinheiro continua avisando. A espera deliberada do
  // "Corrigir pagamento" (`soEstaPassada`, com a tela dizendo "conferindo o pagamento…") fica só na passada atual.
  async function enviarRecebimentoGuardado(ids, soEstaPassada) {
    let resultado = await api.processarFila();
    if (resultado && resultado.erroArmazenamento) throw new Error(resultado.erroArmazenamento);
    let restantes = await api.filaPorIds(ids);
    for (let voltas = 0; !soEstaPassada && voltas < 5 && restantes.some(x => !x.precisaCorrigir); voltas++) {
      const emVoo = api.passadaEmVoo && api.passadaEmVoo();
      if (!emVoo) break; // nenhuma volta correndo: o próximo gatilho envia
      resultado = await emVoo;
      if (resultado && resultado.erroArmazenamento) throw new Error(resultado.erroArmazenamento);
      restantes = await api.filaPorIds(ids);
    }
    // ⛔ 28/10/2026 — só RECUSA DE PAGAMENTO abre este aviso. A recusa da MARCAÇÃO (parada tirada da rota: `naoEncontrado`) entrava
    // aqui também e abria "Pagamento precisa de conferência" num pedido sem pagamento nenhum — um modal no meio da rua com o
    // texto errado. A recusa da marcação aparece no cartão (ou na faixa do topo, se o cartão saiu da lista).
    const recusados = restantes.filter(x => x.precisaCorrigir && x.params && x.params.action === 'confirmarPagamento');
    for (const x of recusados) {
      const row = Number(x.params.row);
      if (state.pgRespondido[row] && state.pgRespondido[row].tsDevice === x.params.ts_device) delete state.pgRespondido[row];
    }
    if (recusados.length) {
      await AppUI.alerta('Pagamento precisa de conferência: ' + (recusados[0].erro || 'Confira os dados com a equipe.') +
        ' A declaração continua guardada no aparelho.', { titulo: 'Conferir pagamento', tom: 'warn' });
    } else if (resultado && resultado.sincronizacaoIndisponivel && restantes.length) {
      await AppUI.alerta('A sincronização não está disponível nesta versão do navegador. Atualize este navegador para enviar os registros. Os dados continuam guardados nele.',
        { titulo: 'Guardado no aparelho', tom: 'warn' });
    }
    // ⛔ 23/09/2026 — AQUI EXISTIA UM TERCEIRO AVISO ("Aguardando envio…") para o caso NORMAL de a
    // internet estar ruim. Era um modal no meio da rua a cada entrega marcada sem sinal, justamente
    // o que o dono pediu para acabar: "o entregador não pode perceber nada". O selo discreto
    // "guardado ✓ enviando…" no cartão já diz a mesma coisa sem parar ninguém. Os dois avisos
    // acima FICAM: recusa de pagamento é dinheiro, e sem Web Locks nada sobe nunca.
    return restantes;
  }
  // Acompanha EM SEGUNDO PLANO o que já foi guardado. A regra de dinheiro é a mesma de sempre
  // (recusa do `confirmarPagamento` fica guardada e avisa para conferir); o que mudou é só o
  // momento — isto não fica mais entre o dedo do entregador e o verde na tela.
  function acompanharEnvio(ids) {
    Promise.resolve().then(function () { return enviarRecebimentoGuardado(ids); })
      .catch(function (e) { console.error('[envio]', e); });
  }
  // Correção unitária usa o mesmo staging; sem resposta ("manter"), não cria outro ato.
  async function enviarConfirmacao(row, resposta, tsDevice, marcacaoNaFila) {
    if (!window.PgPorta || !resposta) return;
    const r = Number(row);
    const ids = await guardarRecebimento([], { [r]: resposta }, tsDevice);
    if (!marcacaoNaFila) await enviarRecebimentoGuardado(ids, true);
  }

  async function handleAction(act, row) {
    // Expandir/minimizar o cartão — só VISUAL, não mexe em status nem rede; vale a qualquer momento
    // (inclusive com a entrega em andamento, como o Bernardo pediu).
    if (act === 'expand' || act === 'minimize') {
      if (act === 'expand') state.expandidos.add(Number(row)); else state.expandidos.delete(Number(row));
      renderList();
      if (act === 'expand') {
        const alvo = state.items.find(x => Number(x.row) === Number(row));
        // 28/10/2026: no máximo 1× por parada a cada 2 min (era a Instabuy ao vivo a cada expandir).
        const conferidos = state.conferidoEm || (state.conferidoEm = {});
        if (alvo && alvo.naEntrega && !(Date.now() - (conferidos[Number(row)] || 0) < 2 * 60 * 1000)) {
          conferidos[Number(row)] = Date.now();
          await conferirGrupoValores([alvo]);
        }
      }
      return;
    }
    // O servidor recusou esta marcação e o entregador acabou de ler o motivo. Tira a declaração da
    // fila (ela já foi desfeita na tela pela projeção), devolve a parada ao estado anterior também
    // no cache do aparelho e resincroniza a lista. Nada aqui espera rede.
    if (act === 'okrecusa') {
      const mapa = api.filaStatusPendentes && api.filaStatusPendentes();
      const p = mapa && mapa.get(Number(row));
      if (!p || !p.recusado) { renderList(); return; }
      if (p.anterior !== undefined && updateLocalStatus(Number(row), p.anterior, p.obsAnterior || '')) api.saveEntregasCache(state.driver, state.items);
      try { await api.filaDescartarStatus(p.id); } catch (e) { console.error('[recusa]', e); }
      renderList();
      window.setTimeout(function () { carregarTudo(false); }, 0);
      return;
    }

    // ⛔ 23/09/2026 (2ª volta) — ESTE COMENTÁRIO MENTIA. Ele prometia uma trava "enquanto UM
    // diálogo está aberto", mas `state.sendingAction = true` só era executado LÁ EMBAIXO, depois
    // de TODOS os diálogos. Durante o "Como foi a entrega?", o "Quem recebeu?" e o modal de
    // pagamento não havia trava nenhuma: dois toques viravam DOIS atos — e, no pago na porta, DUAS
    // declarações de dinheiro para a mesma entrega, com `ts_device` diferentes. Agora a trava é
    // de verdade e cobre o ato inteiro, do primeiro diálogo até o fim.
    // Ela NUNCA espera rede de marcação (isso era o defeito velho): só diálogo, e as esperas
    // deliberadas de dinheiro — que a partir de hoje APARECEM na tela (`state.aguardando`) em vez
    // de engolir o toque em silêncio.
    if (state.sendingAction) return;
    state.sendingAction = true;
    try { await executarAcao(act, row); }
    finally { state.sendingAction = false; renderList(); }
  }

  // O ato em si. Só é alcançado com a trava de reentrância JÁ ligada (ver `handleAction`).
  async function executarAcao(act, row) {
    try { api.marcarAtividade(state.driver); } catch (e) {}
    // A lista com a fila do aparelho POR CIMA. Todas as decisões de status abaixo (já está em
    // andamento? já está no status alvo?) têm de ver o que o entregador acabou de tocar, mesmo que
    // o servidor ainda não saiba.
    const vistaAgora = itensComFila();
    const item = vistaAgora.find((x) => Number(x.row) === Number(row));
    if (!item) return;
    // ⭐ 28/10/2026 — O GRUPO É RECALCULADO NA HORA DE GRAVAR. Entre o toque e a gravação há diálogos (segundos, às vezes minutos)
    // e a lista pode mudar: uma recarga, um cancelamento, a irmã marcada por outro caminho. Grava só quem CONTINUA no grupo (mesmo
    // estado, ver `irmasAtivas`) E estava no grupo que o entregador viu/respondeu (`vistoAntes`); a tocada sempre.
    const grupoNaHora = (alvo, modo, vistoAntes) => {
      const vista = itensComFila();
      const atual = vista.find((x) => Number(x.row) === Number(alvo.row)) || alvo;
      const viu = vistoAntes ? new Set(vistoAntes.map((x) => Number(x.row))) : null;
      return irmasAtivas(vista, atual, modo).filter((x) => Number(x.row) === Number(alvo.row) || !viu || viu.has(Number(x.row)));
    };
    // Parada paga na porta que vai junto SEM resposta do pagamento (o grupo mudou entre o modal e a gravação) não é marcada por
    // tabela: fica para o entregador tocar nela. "Manter" (a resposta anterior vale) conta como respondida.
    const semRespostaDePagamento = (x, pgRes) => !!(window.PgPorta && window.PgPorta.devePerguntar(state.pgCfg, x))
      && !(pgRes && pgRes.manteve) && !(pgRes && pgRes.porRow && pgRes.porRow[Number(x.row)]);
    const soDasRows = (porRow, rows) => {
      if (!porRow) return null;
      const out = {};
      Object.keys(porRow).forEach((r) => { if (rows.indexOf(Number(r)) >= 0) out[r] = porRow[r]; });
      return out;
    };
    // ⛔ (revisão da leva 2) O GRUPO MUDOU COM O MODAL ABERTO (um cancelamento chegou pelo poll, a irmã foi marcada por outro
    // caminho): a resposta foi dada para OUTRO conjunto de pedidos ("Valor dos 2 pedidos" com um deles já fora). Descarta e
    // pergunta de novo com o grupo de agora — tudo local, sem rede. Compara as paradas PAGAS NA PORTA de antes e de agora.
    const portaDe = (grupo, rowTocada) => {
      const Pg = window.PgPorta;
      if (!Pg) return '';
      return Pg.irmasNaPorta(grupo || [], rowTocada).filter((x) => Pg.devePerguntar(state.pgCfg, x)).map((x) => Number(x.row)).sort().join(',');
    };
    // O conjunto perguntado é FOTOGRAFADO antes de o modal abrir (texto com as rows): o cancelamento que chega pelo poll muda o
    // próprio objeto da parada em `state.items`, e comparar depois com os mesmos objetos não veria mudança nenhuma.
    const perguntarComGrupoEstavel = async (alvo, irmasIniciais, ts, anterior, conferencia) => {
      let irmas = grupoNaHora(alvo, undefined, irmasIniciais); // o grupo de AGORA (os diálogos de antes levaram segundos)
      let perguntada = portaDe(irmas, alvo.row);
      let res = await coletarPagamento(alvo, irmas, ts, anterior, conferencia);
      for (let refez = 0; refez < 3 && !(res && res.cancelado); refez++) {
        const agora = grupoNaHora(alvo, undefined, null);
        const portaAgora = portaDe(agora, alvo.row);
        if (perguntada === portaAgora) break;
        irmas = agora; perguntada = portaAgora;
        res = await coletarPagamento(alvo, irmas, ts, pgRespostaAnterior(alvo.row, alvo), null);
      }
      return { res, irmas };
    };
    // ⛔ 28/10/2026 — DESFAZER (e "Ainda não fui"): o servidor ANULA a declaração de pagamento da parada (anularPorDesfazer). A
    // resposta guardada na tela tem de sair junto, senão a próxima entrega oferecia "Manter" e nenhuma declaração nova subia.
    // E a observação do CLIENTE volta para o cartão (`updateLocalStatus(r, '', null)`), em vez de ser apagada.
    const desfazerLocal = (r) => {
      updateLocalStatus(r, '', null);
      delete state.pgRespondido[r];
      const it = state.items.find((x) => Number(x.row) === Number(r));
      if (it && it.pgConfirmado) it.pgConfirmado = null;
      state.expandidos.delete(r);
    };

    // Corrigir a resposta de pagamento de uma entrega JÁ marcada (tela 4 do desenho). Não mexe em
    // status; sobe uma confirmação nova com ts próprio — no servidor vira ato 'corrigiu'.
    if (act === 'pgcorrigir') {
      const tsC = new Date().toISOString();
      // (revisão de 06/10, menor 1) na pergunta única a correção vale para as IRMÃS pagas na porta (mesmo número = mesma porta,
      // um pagamento) — corrigir "Não pagou" num cartão e deixar a irmã como "Não pagou" mandaria cobrar o cliente
      // (28/10/2026: só as irmãs no MESMO status — as que foram entregues junto.)
      const simplesC = !!(state.pgCfg && state.pgCfg.simples);
      const irmasC = simplesC ? irmasAtivas(vistaAgora, item, 'mesmoStatus') : [item];
      const resC = await coletarPagamento(item, irmasC, tsC, pgRespostaAnterior(row, item));
      if (!resC || resC.manteve || resC.cancelado) return;
      // Pergunta única: não há valor digitado para o servidor recusar — grava e segue, sem espera na frente do dedo.
      if (simplesC) {
        try { const idsC = await guardarRecebimento([], resC.porRow, tsC); renderList(); acompanharEnvio(idsC); }
        catch (error) { await avisarArmazenamento(); }
        return;
      }
      // A correção de pagamento de uma entrega JÁ marcada continua ESPERANDO a resposta de
      // propósito: é uma conferência deliberada de dinheiro, fora do "clicou e vai", e é esperando
      // que o entregador descobre na hora se a correção também foi recusada.
      // ⛔ 23/09/2026 (2ª volta) — ESSA ESPERA ERA CEGA. `enviarConfirmacao` drena a fila INTEIRA,
      // e a fila agora é o caminho normal de TODOS os toques: com sinal ruim ela carrega o acúmulo
      // da rota e a espera vira minutos. Enquanto isso a trava de reentrância engolia, SEM NADA NA
      // TELA, qualquer toque em qualquer cartão — a queixa do dono reaparecendo por outra porta.
      // Agora a espera se anuncia: o cartão diz "conferindo o pagamento…" e os botões ficam
      // desabilitados COM ESSE TEXTO, em vez de aceitar o dedo e não fazer nada.
      try { await comEspera('conferindo o pagamento…', function () { return enviarConfirmacao(row, resC.porRow[Number(row)], tsC, false); }); }
      catch (error) { await AppUI.alerta('Não foi possível guardar o pagamento no aparelho. Mantenha esta tela aberta e tente novamente.', { tom: 'danger' }); }
      return;
    }

    // Ligar pro cliente (abre o discador do celular). Sem telefone → avisa.
    if (act === 'ligar') {
      const tel = String(item.telefone || '').replace(/[^\d+]/g, '');
      if (!tel) { await AppUI.alerta('Este pedido não tem telefone cadastrado.', { tom: 'warn' }); return; }
      await openSameTab('tel:' + tel);
      return;
    }

    // DESFAZER (apertou errado): volta a entrega pra PENDENTE. Vale pra Iniciar/Entregue/Não entregue.
    // Agrupa as duplicadas (mesmo número). Best-effort: a que falhar vai pra fila offline.
    // 28/10/2026: só as irmãs no MESMO status da tocada (as que foram marcadas junto), e com a hora do toque (`ts_device`).
    if (act === 'desfazer') {
      const esc = await AppUI.escolher('Desfazer a marcação desta entrega? Ela volta a ficar PENDENTE (como se nada tivesse sido tocado).', [
        { valor: 'sim', rotulo: '↩ Sim, desfazer', tom: 'danger' },
      ], { titulo: 'Desfazer' });
      if (esc === null) return;
      const alvo = grupoNaHora(item, 'mesmoStatus', irmasAtivas(vistaAgora, item, 'mesmoStatus')).map((x) => Number(x.row));
      const tsD = new Date().toISOString();
      // Mesmo caminho instantâneo das outras marcações: grava e pinta. Antes eram até 3 tentativas
      // de rede POR LINHA (15 s cada no timeout) antes de a tela responder.
      try { await guardarNaFila(alvo.map((r) => ({ action: 'desfazer', row: Number(r), ts_device: tsD }))); }
      catch (e) { await avisarArmazenamento(); return; }
      alvo.forEach((r) => desfazerLocal(r));
      api.saveEntregasCache(state.driver, state.items);
      renderList();
      agendarEnvio();
      return;
    }

    // "Não entregue" abre DUAS opções: 🙋 cliente não estava (= antigo "não recebeu") OU 🚫 cancelado/
    // mudou de rota (= antigo "cancelado"). Cada uma vai pro sistema igual antes; a opção vira a observação.
    let obsPreset = null;
    if (act === 'naoentregue') {
      const esc = await AppUI.escolher('O que aconteceu com esta entrega?', [
        { valor: 'fail', rotulo: '🙋 Cliente não estava / não recebeu', tom: 'success' },
        // 19/10/2026 (dono): era "🚫 Pedido cancelado / mudou de rota". Não é cancelamento — o pedido foi adiado ou foi para
        // outra rota; o painel mostra "Trocou de rota/adiado". Cancelamento de verdade vem do cliente ou da equipe.
        { valor: 'cancel', rotulo: '↪️ Saiu da minha rota', tom: 'danger' },
      ], { titulo: 'Não entregue' });
      if (esc === null) return; // fechou sem escolher → não marca nada
      act = esc === 'fail' ? 'fail' : 'cancelado';
      obsPreset = esc === 'fail' ? 'Cliente não estava / não recebeu' : 'Saiu da minha rota';
    }

    if ((act === 'start' || act === 'maps' || act === 'waze') && !state.rotaIniciada) {
      await AppUI.alerta('Clique primeiro em "Iniciar entregas".', { tom: 'warn' });
      return;
    }

    // START: se JÁ existe OUTRA entrega "Indo para entrega", EXIGE resolver ela primeiro (Entregue /
    // Não entregue / voltar pra pendente) — pra não sumir com o status por esquecimento. Só então inicia
    // esta. (Substitui o reset silencioso por uma decisão consciente, como o Bernardo pediu.)
    if (act === 'start') {
      const outras = [...new Map(
        vistaAgora.filter((x) => api.statusKey(x.status) === 'start' && Number(x.numero) !== Number(item.numero)).map((x) => [Number(x.numero), x])
      ).values()];
      for (const ant of outras) {
        // A conferência de valor sai ANTES do diálogo e corre em paralelo com ele (ver
        // `adiantarConferenciaPg`). Se a pessoa não escolher "Entregue", a resposta é só descartada
        // — é uma leitura, não muda nada no servidor.
        const irmasA = irmasAtivas(vistaAgora, ant);
        const conferenciaA = adiantarConferenciaPg(ant, irmasA);
        const esc = await AppUI.escolher('Você ainda está indo para "' + (ant.cliente || 'outro cliente') + '". Antes de iniciar a próxima, o que aconteceu com essa entrega?', [
          { valor: 'done', rotulo: '✅ Entregue', tom: 'success' },
          { valor: 'nao', rotulo: '⛔ Não entregue', tom: 'danger' },
          { valor: 'pend', rotulo: '↩ Ainda não fui — voltar pra pendente' },
        ], { titulo: 'Você tem uma entrega em andamento' });
        if (esc === null) return; // fechou → NÃO inicia a nova
        const tsA = new Date().toISOString();
        // ⛔ PORTA 2 do marcarEntregue: sem isto, marcar "Entregue" por aqui pularia a confirmação
        // de pagamento e viraria porta dos fundos. Mesma função, mesmo ts_device.
        const estavelA = esc === 'done' ? await perguntarComGrupoEstavel(ant, irmasA, tsA, pgRespostaAnterior(ant.row, ant), conferenciaA) : null;
        const pgA = estavelA ? estavelA.res : null;
        if (pgA && pgA.cancelado) return;
        if (esc === 'done') {
          try {
            const finalA = grupoNaHora(ant, undefined, estavelA.irmas)
              .filter((x) => Number(x.row) === Number(ant.row) || !semRespostaDePagamento(x, pgA));
            const rowsA = finalA.map((x) => Number(x.row));
            const marcacoes = rowsA.map((r) => ({ action: 'marcarEntregue', row: r, obs: 'Entregue', ts_device: tsA }));
            const ids = await guardarRecebimento(marcacoes, pgA && !pgA.manteve ? soDasRows(pgA.porRow, rowsA) : null, tsA);
            rowsA.forEach((r) => { updateLocalStatus(r, 'Entregue', 'Entregue'); state.expandidos.delete(r); });
            api.saveEntregasCache(state.driver, state.items);
            renderList();
            // NÃO espera: o entregador resolveu a pendência e já segue para a próxima entrega.
            acompanharEnvio(ids);
          } catch (error) {
            await avisarArmazenamento();
            return;
          }
          continue;
        }
        // Só 'nao' e 'pend' chegam aqui (o 'done' sempre sai no `continue` acima), e nestes dois
        // `pgA` é sempre null — por isso o `enviarConfirmacao` que existia neste laço era código
        // morto e saiu junto. Um commit único para o grupo inteiro, sem rede.
        // (28/10/2026: "Ainda não fui" = desfazer das irmãs no MESMO status, com `ts_device`; "Não entregue" = as abertas.)
        const finalA = esc === 'nao' ? grupoNaHora(ant, undefined, irmasA) : grupoNaHora(ant, 'mesmoStatus', irmasAtivas(vistaAgora, ant, 'mesmoStatus'));
        try {
          await guardarNaFila(finalA.map(x => (esc === 'nao'
            ? { action: 'marcarNaoEntregue', row: Number(x.row), obs: 'Não entregue', ts_device: tsA }
            : { action: 'desfazer', row: Number(x.row), ts_device: tsA })));
        } catch (e) { await avisarArmazenamento(); return; }
        for (const x of finalA) {
          const r = Number(x.row);
          if (esc === 'nao') { updateLocalStatus(r, 'Não entregue', 'Não entregue'); state.expandidos.delete(r); }
          else desfazerLocal(r);
        }
        api.saveEntregasCache(state.driver, state.items);
        renderList();
        agendarEnvio();
      }
    }

    // Conferir o valor na Instabuy é útil (o entregador vê quanto cobrar), mas NÃO pode ficar entre
    // o dedo e o verde do INICIAR: sem `await`, ele atualiza o cartão quando chegar.
    if (act === 'start' && item.naEntrega) { try { const q = conferirGrupoValores([item]); if (q && q.catch) q.catch(function () {}); } catch (e) {} }

    // Pergunta a observação ANTES de mostrar "Enviando…". A observação é OPCIONAL: tocar
    // "Pular" segue sem ela (mesmo comportamento de antes, só que com nome claro no botão).
    let nextStatus = null, obs;
    // Hora do APARELHO no toque. Para o Entregue ela nasce ANTES do modal de pagamento, porque a
    // confirmação viaja com o MESMO ts_device do marcarEntregue (chave de idempotência no servidor).
    let tsDevice = null, pgPorRow = null, pgRes = null;
    let irmasPg = null, conferenciaPg = null;
    if (act === 'done') {
      // ⭐ A ÚNICA rede que ainda precede um diálogo (`conferirValores`, que decide o valor do
      // modal de dinheiro) sai AGORA, ADIANTADA, e corre em paralelo com os segundos que o
      // entregador leva lendo os diálogos abaixo. Antes ela esperava ENTRE o "Como foi a entrega?"
      // e o modal de pagamento, com o timeout geral de 15 s e a tela morta. Aqui nada é esperado:
      // só disparado. Quem recolhe (e mostra a espera que sobrar) é o `coletarPagamento`.
      irmasPg = irmasAtivas(vistaAgora, item);
      conferenciaPg = adiantarConferenciaPg(item, irmasPg);
      // 3 opções rápidas pra registrar COMO foi a entrega. Cancelar aqui ABORTA (não marca).
      const tipo = await AppUI.escolher('Como foi a entrega?', [
        { valor: 'maos', rotulo: '🤝 Entregue em mãos', tom: 'success' },
        { valor: 'portaria', rotulo: '🏢 Entregue na portaria' },
        { valor: 'terceiros', rotulo: '👤 Entregue para terceiros' },
      ], { titulo: '✅ Confirmar entrega' });
      if (tipo === null) return; // cancelou -> NÃO marca como entregue

      if (tipo === 'maos') {
        obs = 'Entregue em mãos';
      } else {
        // Portaria/terceiros: pergunta QUEM recebeu (nome é opcional — pode tocar "Pular").
        const base = tipo === 'portaria' ? 'Entregue na portaria' : 'Entregue para terceiros';
        const nome = await AppUI.perguntar('Quem recebeu? (nome da pessoa)', {
          titulo: tipo === 'portaria' ? '🏢 Entregue na portaria' : '👤 Entregue para terceiros',
          placeholder: 'Ex.: porteiro João',
          textoOk: 'Confirmar',
          textoCancelar: 'Pular',
        });
        // Texto vai concatenado pra coluna "Observações" do Rotas do dia (obs_entregador).
        // Esse mesmo texto/estrutura serve depois pro WhatsApp automático ao cliente.
        obs = (nome && nome.trim()) ? (base + ' (recebido por: ' + nome.trim() + ')') : base;
      }
      nextStatus = 'Entregue';
      // ⛔ PORTA 1: "💳 Como o cliente pagou?" — só para pedido pago NA PORTA e só quando o servidor
      // mandou perguntar. Sem uma resposta completa, não confirma a entrega.
      tsDevice = new Date().toISOString();
      const estavel = await perguntarComGrupoEstavel(item, irmasPg, tsDevice, pgRespostaAnterior(row, item), conferenciaPg);
      pgRes = estavel.res; irmasPg = estavel.irmas;
      if (pgRes && pgRes.cancelado) return;
      pgPorRow = pgRes && !pgRes.manteve ? pgRes.porRow : null;
    }
    else if (act === 'fail') { obs = obsPreset != null ? obsPreset : ((await AppUI.perguntar('Motivo / observação:', { titulo: 'Cliente não estava', tom: 'danger', placeholder: 'Ex.: cliente ausente', textoOk: 'Marcar', textoCancelar: 'Pular' })) || ''); nextStatus = 'Não entregue'; }
    // 28/10/2026: "Saiu da minha rota" pinta 'Não entregue' (o servidor novo grava assim, sem pagar, com ↩ Desfazer); era 'Removida'.
    else if (act === 'cancelado') { obs = obsPreset != null ? obsPreset : ((await AppUI.perguntar('Por que saiu da sua rota?', { titulo: 'Saiu da minha rota', tom: 'warn', placeholder: 'Ex.: cliente pediu para amanhã', textoOk: 'Confirmar', textoCancelar: 'Pular' })) || ''); nextStatus = 'Não entregue'; }
    else if (act === 'start') { nextStatus = 'Indo para entrega'; state.expandidos.add(Number(row)); }

    try {
      // Maps/Waze: abre o mapa (navega pra fora) e, se a parada está PENDENTE e tem endereço, marca "Indo".
      // ⛔ 28/10/2026 — antes marcava "Indo" em QUALQUER status: abrir o mapa num cartão Entregue (expandido para ver o endereço)
      // mandava `iniciarEntrega`, e o servidor trocava "Entregue" por "Indo para entrega". Sem endereço o mapa nem abria e a
      // marcação já tinha ido. Agora, fora de "pendente com endereço", só abre o mapa.
      if (act === 'maps' || act === 'waze') {
        const url = act === 'maps' ? api.buildMapsUrl(item) : api.buildWazeUrl(item);
        if (api.statusKey(item.status) === 'pending' && url && url !== '#') {
          // Antes o mapa só abria DEPOIS de `apiIniciarEntrega` responder (3 tentativas × 15 s).
          // Agora grava, pinta e abre; o envio corre atrás.
          try {
            await guardarNaFila([{ action: 'iniciarEntrega', row: Number(row), ts_device: new Date().toISOString() }]);
            updateLocalStatus(row, 'Indo para entrega'); api.saveEntregasCache(state.driver, state.items); renderList(); agendarEnvio();
          }
          catch (e) { console.error('[fila]', e); /* o mapa abre assim mesmo; a marcação não fingiu */ }
        }
        await openSameTab(url);
        return;
      }

      // WhatsApp: erro tratado AQUI, não no catch lá embaixo — o catch geral diz "tente de novo", e
      // quando o painel recusa por telefone errado tentar de novo não resolve nada (o cadastro é que
      // está errado). Com a marca `doServidor`, mostra o motivo de verdade; falha de internet segue
      // caindo no texto genérico.
      if (act === 'whats') {
        try { await api.abrirWhatsapp(row); }
        catch (e) {
          var motivo = (e && e.doServidor) ? e.message : 'Não foi possível abrir o WhatsApp. Tente de novo.';
          await AppUI.alerta(motivo, { titulo: 'WhatsApp', tom: 'warn' });
        }
        return;
      }

      // Hora do APARELHO no instante do toque (ISO). Vai junto no envio; e SE cair na FILA offline,
      // é reenviada COM ESTE horário quando a internet voltar. Assim o servidor carimba o entregue_em
      // pela hora do CLIQUE (horaEntregaValida usa ts_device) — e não pela hora em que a conexão
      // voltou. Sem isso, marcar várias entregues offline e reconectar subia TODAS com o mesmo horário.
      if (!tsDevice) tsDevice = new Date().toISOString();
      // DUPLICADAS vão JUNTAS ao INICIAR / ENTREGAR: pedidos do mesmo cliente+endereço têm o MESMO
      // `numero` (o painel já colapsa e manda). O entregador vai a UM lugar só, então tocar Iniciar/
      // Entregue numa marca as do mesmo número de uma vez — 28/10/2026: só as que estão no MESMO estado (abertas), recalculadas
      // AGORA (ver `grupoNaHora`). (Não-entregue/Saiu da rota seguem 1 a 1.)
      const irmas = (act === 'start' || act === 'done') ? grupoNaHora(item, undefined, act === 'done' ? irmasPg : null) : [item];
      // Só as que ainda NÃO estão no status alvo (a própria tocada sempre entra) — evita remarcar/enfileirar à toa.
      const rowsAlvo = irmas
        .filter((x) => Number(x.row) === Number(row) || api.statusKey(x.status) !== api.statusKey(nextStatus))
        .filter((x) => act !== 'done' || Number(x.row) === Number(row) || !semRespostaDePagamento(x, pgRes))
        .map((x) => Number(x.row));
      if (act === 'done') pgPorRow = soDasRows(pgPorRow, rowsAlvo);
      const paramsDe = (r) => act === 'start' ? { action: 'iniciarEntrega', row: r, ts_device: tsDevice }
        : act === 'done' ? { action: 'marcarEntregue', row: r, obs: obs || '', ts_device: tsDevice }
        : act === 'fail' ? { action: 'marcarNaoEntregue', row: r, obs: obs || '', ts_device: tsDevice }
        : { action: 'marcarCancelado', row: r, obs: obs || '', ts_device: tsDevice };

      // ⭐ UM ÚNICO COMMIT no aparelho, com o ATO INTEIRO (todas as irmãs do mesmo número e, no
      // Entregue, a declaração de pagamento do grupo). É o único `await` entre o dedo e a tela.
      // Falhar aqui NÃO pode virar verde: avisa e sai sem marcar nada.
      let idsRecebimento = null;
      try {
        if (act === 'done') idsRecebimento = await guardarRecebimento(rowsAlvo.map(paramsDe), pgPorRow, tsDevice);
        else await guardarNaFila(rowsAlvo.map(paramsDe));
      } catch (error) {
        console.error('[fila]', error);
        await avisarArmazenamento();
        return;
      }
      rowsAlvo.forEach((r) => updateLocalStatus(r, nextStatus, obs)); // já deixa TODAS marcadas na tela
      // Ao MARCAR (entregue/não entregue/cancelado) o cartão MINIMIZA sozinho (Bernardo). Iniciar NÃO
      // minimiza — pelo contrário, expande (feito acima). Tocar de novo num concluído reabre pra corrigir.
      if (act === 'done' || act === 'fail' || act === 'cancelado') rowsAlvo.forEach((r) => state.expandidos.delete(r));
      api.saveEntregasCache(state.driver, state.items); // UMA gravação do cache por ato (28/10/2026)
      renderList();
      // ⛔ DAQUI PARA BAIXO NÃO EXISTE MAIS REDE NO CAMINHO DO DEDO.
      // O envio corre em segundo plano e o entregador já pode tocar a próxima entrega.
      // E NADA de `carregarTudo` agora (era `setTimeout(..., 800)`): recarregar logo depois do toque
      // repinta a lista com o que o servidor AINDA NÃO SABE — o mesmo defeito que derrubou o app de
      // montagem ontem. A lista se recarrega sozinha quando a fila esvazia (ouvinte lá embaixo).
      if (idsRecebimento) acompanharEnvio(idsRecebimento);
      else agendarEnvio();
    } catch (error) {
      console.error(error);
      await AppUI.alerta('Não foi possível concluir essa ação. Tente de novo.', { tom: 'danger' });
    }
  }

  // A fila mudou (gravou, subiu, foi recusada, ou outra aba mexeu). Repinta sempre — é assim que o
  // selo "guardado ✓ enviando…" some sozinho e que uma recusa aparece sem ninguém pedir.
  // E SÓ AQUI a lista se recarrega do servidor: quando a fila ESVAZIA. Recarregar com fila cheia é
  // o que repintaria por cima do que o entregador acabou de tocar.
  let _filaPendentes = 0;
  window.addEventListener('fila-entregas-mudou', function () {
    renderList();
    const rows = api.filaRowsPendentes();
    if (rows === null) return;
    if (_filaPendentes > 0 && rows.size === 0) window.setTimeout(function () { carregarTudo(false); }, 250);
    _filaPendentes = rows.size;
  });

  // ⛔ 28/10/2026 — UMA CONSULTA DE CADA VEZ, E A LISTA DEPOIS DA FILA. O poll disparava a fila e a lista em PARALELO (a lista
  // podia ser lida antes de as marcações subirem — "a tela volta atrás") e, com sinal ruim, a rodada seguinte começava com a
  // anterior ainda tentando. Agora: fila primeiro, lista depois (como o `online` já fazia), e um tique com o anterior em voo é pulado.
  let _pollEmVoo = false;
  // (revisão da leva 2) com PRAZO: com sinal ruim a fila pode levar dezenas de segundos, e a lista não espera mais que 4 s por
  // ela — os ACKs recentes por cima já impedem que uma lista pedida antes de um ACK pinte o passado.
  function filaDepoisLista() {
    const recarregar = function () { return carregarTudo(false); };
    const prazo = new Promise(function (ok) { window.setTimeout(ok, 4000); });
    return Promise.race([api.processarFila(), prazo]).then(recarregar, recarregar);
  }
  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = window.setInterval(function () {
      if (document.visibilityState !== 'visible' || _pollEmVoo) return;
      _pollEmVoo = true;
      filaDepoisLista().finally(function () { _pollEmVoo = false; });
    }, window.APP_CONFIG.REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  // 28/10/2026: uma consulta de cada vez (a de 15 s empilhava com 3 tentativas × 15 s), e nada de nova consulta com o aviso aberto.
  let _cancelEmVoo = false;
  async function verificarCancelamentos() {
    if (!state.driver || document.visibilityState !== 'visible' || _cancelEmVoo) return;
    _cancelEmVoo = true;
    try {
      var avisos = await api.carregarCancelamentosDaRota(state.driver);
      for (var i = 0; i < avisos.length; i++) {
        var a = avisos[i], chave = 'cancelamento-entregador:' + a.id + ':' + a.canceladoEm;
        if (sessionStorage.getItem(chave)) continue;
        var item = state.items.find(function (x) { return Number(x.row) === Number(a.id); });
        if (item) item.status = 'Cancelado';
        api.saveEntregasCache(state.driver, state.items); renderList();
        var titulo = 'PEDIDO CANCELADO NA RUA';
        var corpo = (a.pedido || '') + ' · ' + (a.cliente || '') + '. Não entregue. Leve o pedido de volta ao depósito; ele entra em PEDIDOS QUE VOLTARAM e esta entrega continua no seu pagamento.';
        try {
          var LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
          if (LN && LN.schedule) await LN.schedule({ notifications: [{ id: 700000 + (Number(a.id) % 200000), title: titulo, body: corpo, schedule: { at: new Date(Date.now() + 300) } }] });
        } catch (e) {}
        // ⛔ 28/10/2026 — o aviso só conta como VISTO depois que APARECEU (`aoAbrir`; antes era marcado antes de abrir — com a tela
        // escondida ou um toque duplo no fundo ele sumia sem ninguém ler), e o toque no fundo NÃO fecha: só o "Entendi".
        await AppUI.alerta(corpo, { titulo: titulo, tom: 'danger', fecharNoFundo: false,
          aoAbrir: function () { try { sessionStorage.setItem(chave, '1'); } catch (e) {} } });
        break;
      }
    } catch (e) { /* rede/Instabuy: tenta no próximo ciclo sem mexer na rota */ }
    finally { _cancelEmVoo = false; }
  }

  function startCancelRefresh() {
    if (state.cancelTimer) clearInterval(state.cancelTimer);
    verificarCancelamentos();
    state.cancelTimer = window.setInterval(verificarCancelamentos, 15000);
  }

  document.getElementById('btnTrocar').addEventListener('click', function () {
    sessionStorage.removeItem('rota_iniciada_' + state.driver);
    sessionStorage.removeItem('rota_finalizada_' + state.driver);
    sessionStorage.removeItem('rota_assinatura_' + state.driver);
    api.clearSavedDriverName();
    // ⛔ 06/10/2026 — TROCAR DE ENTREGADOR NÃO APAGA MAIS O TOKEN. Apagar era o que fazia o PIN ser pedido a cada troca
    // (inclusive para voltar), e o que deixava a fila guardada por este entregador sem identidade para subir. Cada
    // entregador tem o seu token no aparelho (core.js) e a fila sobe com o de quem fez. O token inválido no servidor,
    // motivo antigo daqui, agora é apagado quando o SERVIDOR recusa — só aquele.
    window.location.href = '/?escolher=1';
  });

  // Botão "Trocar turno" (só no backend do painel, onde manhã/tarde coexistem). Volta pra
  // home, onde o entregador escolhe o turno e o nome de novo. Não apaga o entregador salvo.
  if (api.usandoPainel && api.usandoPainel()) {
    const btnTrocar = document.getElementById('btnTrocar');
    if (btnTrocar && !document.getElementById('btnTrocarTurno')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'btnTrocarTurno';
      b.className = 'ghost-sm';
      b.textContent = '🔄 Trocar turno';
      b.addEventListener('click', function () { window.location.href = '/?escolher=1'; });
      btnTrocar.parentNode.insertBefore(b, btnTrocar);
    }
  }

  // "Trocar maquininha" AO LADO de "Trocar entregador" (pedido do dono, 06/10/2026). Só aparece com a rota iniciada.
  (function () {
    const btnTrocar = document.getElementById('btnTrocar');
    if (!btnTrocar || document.getElementById('btnTrocarMaq')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnTrocarMaq';
    b.className = 'ghost-sm hidden';
    b.addEventListener('click', function () { trocarMaquininha(); });
    btnTrocar.parentNode.insertBefore(b, btnTrocar.nextSibling);
  })();

  document.getElementById('btnIniciarRota').addEventListener('click', function () {
    handleIniciarRota();
  });

  document.getElementById('btnFinalizarRota').addEventListener('click', function () {
    handleFinalizarRota();
  });

  document.getElementById('btnRefresh').addEventListener('click', function () {
    api.processarFila();
    carregarTudo(true); // mostra "Carregando…" como feedback de que clicou
  });

  document.getElementById('infoRota').addEventListener('click', function (event) {
    const btn = event.target.closest('button[data-info]');
    if (!btn) return;
    const acao = btn.getAttribute('data-info');
    if (acao === 'km-inicial') editarKm('inicial');
    else if (acao === 'km-final') editarKm('final');
    else if (acao === 'foto-inicio') reenviarFoto('inicio');
    else if (acao === 'foto-fim') reenviarFoto('fim');
  });

  sectionsRoot.addEventListener('click', function (event) {
    const fin = event.target.closest('button[data-route="finalizar"]');
    if (fin) { handleFinalizarRota(); return; }
    // [data-act] em QUALQUER elemento (botões + a área "toque para expandir" do cartão). O closest pega
    // o mais interno, então tocar num botão dentro do corpo dispara a AÇÃO do botão, não o expandir.
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    handleAction(btn.getAttribute('data-act'), Number(btn.getAttribute('data-row')));
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      filaDepoisLista(); // 28/10/2026: a fila primeiro, a lista depois (eram as duas em paralelo)
    } else {
      despedida(); // no Android trocar de app costuma dar só `hidden`, sem `pagehide`
    }
  });

  // Quando a internet volta, reenvia o que ficou pendente na fila.
  window.addEventListener('online', function () {
    filaDepoisLista();
  });

  // Fechou / trocou de app com coisa na fila: último empurrão com `keepalive` (o navegador termina
  // a requisição mesmo depois de a página morrer). É só um ATALHO — quem garante é a fila, que
  // continua guardada e reenvia ao reabrir. Nenhum ack é escrito sem resposta, então nada se perde
  // nem duplica de efeito (marcar a mesma linha de novo grava o mesmo valor).
  function despedida() {
    try { if (api.enviarPendentesNoFechamento) api.enviarPendentesNoFechamento(); } catch (e) {}
  }
  window.addEventListener('pagehide', despedida);

  window.addEventListener('beforeunload', function () {
    stopAutoRefresh();
    if (state.cancelTimer) clearInterval(state.cancelTimer);
    despedida();
  });

  // ---- Gate de permissões (SÓ no app .apk / nativo): exige NOTIFICAÇÕES + LOCALIZAÇÃO antes de abrir
  // as entregas. No site (navegador) NÃO bloqueia nada — abre normal como hoje. ----
  function ehNativo() { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } }
  async function pedirNotifNativo() {
    try { var LN = window.Capacitor.Plugins.LocalNotifications; if (LN && LN.requestPermissions) { var r = await LN.requestPermissions(); return r && r.display === 'granted' ? 'granted' : 'denied'; } } catch (e) {}
    return 'unsupported';
  }
  async function pedirLocalNativo() {
    try { var G = window.Capacitor.Plugins.Geolocation; if (G && G.requestPermissions) { var r = await G.requestPermissions(); return r && (r.location === 'granted' || r.coarseLocation === 'granted') ? 'granted' : 'denied'; } } catch (e) {}
    return 'unsupported';
  }
  async function jaTemPermissoes() {
    try {
      var LN = window.Capacitor.Plugins.LocalNotifications, G = window.Capacitor.Plugins.Geolocation;
      var n = (LN && LN.checkPermissions) ? await LN.checkPermissions() : { display: 'granted' };
      var g = (G && G.checkPermissions) ? await G.checkPermissions() : { location: 'prompt' };
      return (n.display === 'granted') && (g.location === 'granted' || g.coarseLocation === 'granted');
    } catch (e) { return false; }
  }
  async function exigirPermissoes() {
    if (!ehNativo()) return;              // site/navegador: não bloqueia (por enquanto)
    if (await jaTemPermissoes()) return;  // já concedidas: abre direto
    await new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#111;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;gap:16px;';
      ov.innerHTML =
        '<div style="font-size:46px;">🔔📍</div>' +
        '<div style="font-size:20px;font-weight:800;">Ative 2 permissões pra começar</div>' +
        '<div id="pgMsg" style="font-size:16px;line-height:1.5;max-width:330px;opacity:.92;">O app precisa das <b>notificações</b> (pra a Central te chamar) e da <b>localização</b> (pro KM e o rastreio). Toque abaixo e escolha <b>Permitir</b>.</div>' +
        '<button id="pgBtn" style="background:#2d7a3e;color:#fff;border:0;border-radius:12px;padding:16px 30px;font-size:17px;font-weight:800;">Ativar e permitir</button>';
      document.body.appendChild(ov);
      var btn = ov.querySelector('#pgBtn'), msg = ov.querySelector('#pgMsg');
      btn.addEventListener('click', async function () {
        btn.disabled = true; btn.textContent = 'Pedindo...';
        var notif = await pedirNotifNativo();
        var local = await pedirLocalNativo();
        var okN = (notif === 'granted' || notif === 'unsupported');
        var okL = (local === 'granted' || local === 'unsupported');
        if (okN && okL) { ov.remove(); resolve(); return; }
        btn.disabled = false; btn.textContent = 'Tentar de novo';
        var f = []; if (!okN) f.push('Notificações'); if (!okL) f.push('Localização');
        msg.innerHTML = 'Faltou liberar: <b>' + f.join(' e ') + '</b>.<br>Se você negou antes, abra <b>Configurações do Android → Apps → Entregas → Permissões</b>, libere, e volte pra tocar em Tentar de novo.';
      });
    });
  }

  // Reporta ao SISTEMA se este aparelho está com GPS/notificações LIGADOS ou DESLIGADOS (o painel
  // mostra quem está ok e quem não). Não bloqueia nada; vale no app e no site.
  async function reportarPermissoes() {
    try {
      var plat = ehNativo() ? 'app' : 'web';
      var gps = 'desconhecido', notif = 'desconhecido';
      if (ehNativo()) {
        try { var G = window.Capacitor.Plugins.Geolocation, g = (G && G.checkPermissions) ? await G.checkPermissions() : null; if (g) gps = (g.location === 'granted' || g.coarseLocation === 'granted') ? 'on' : 'off'; } catch (e) {}
        try { var LN = window.Capacitor.Plugins.LocalNotifications, n = (LN && LN.checkPermissions) ? await LN.checkPermissions() : null; if (n) notif = (n.display === 'granted') ? 'on' : 'off'; } catch (e) {}
      } else {
        try { if (navigator.permissions && navigator.permissions.query) { var r = await navigator.permissions.query({ name: 'geolocation' }); gps = r.state === 'granted' ? 'on' : (r.state === 'denied' ? 'off' : 'desconhecido'); } } catch (e) {}
        try { notif = (typeof Notification === 'undefined') ? 'desconhecido' : (Notification.permission === 'granted' ? 'on' : (Notification.permission === 'denied' ? 'off' : 'desconhecido')); } catch (e) {}
      }
      // ⭐ 28/10/2026 — só manda quando MUDA (ou a cada 12 h, para outro aparelho do mesmo entregador não deixar o painel com o
      // estado dele para sempre). Era uma chamada a cada abertura da tela, para dizer a mesma coisa.
      const chave = 'app_permissoes_enviadas_v1|' + String(state.driver || '').trim().toLowerCase();
      const agora = gps + '|' + notif + '|' + plat;
      try {
        const ult = JSON.parse(localStorage.getItem(chave) || 'null');
        if (ult && ult.v === agora && Date.now() - Number(ult.em || 0) < 12 * 3600 * 1000) return;
      } catch (e) {}
      const res = await api.apiGet({ action: 'permissoes', entregador: state.driver, gps: gps, notif: notif, plataforma: plat }, { retries: 0 });
      if (res && res.ok) { try { localStorage.setItem(chave, JSON.stringify({ v: agora, em: Date.now() })); } catch (e) {} }
    } catch (e) {}
  }

  // ===== Mapa de CONFERÊNCIA da rota (Leaflet) — o entregador confere antes de sair =====
  // Mostra: pinos numerados na ordem da rota (cor = status), o CD (🏭), a casa dele (🏠), a linha
  // da sequência e a posição AO VIVO dele (🔵, GPS do aparelho — o gate de permissões já pediu).
  // Objetivo: pegar endereço geocodificado ERRADO (pino fora do lugar) ANTES de iniciar a rota.
  const mapaState = { map: null, camadas: null, gpsWatch: null, gpsMarker: null };

  function corDaParada(status) {
    const k = api.statusKey(status);
    return k === 'done' ? '#16a34a' : k === 'fail' ? '#dc2626' : k === 'start' ? '#d97706' : '#2563eb';
  }
  function pinNumerado(n, cor) {
    return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      html: '<div style="width:26px;height:26px;border-radius:50%;background:' + cor + ';color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);">' + n + '</div>' });
  }
  function pinEmoji(emoji) {
    return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      html: '<div style="font-size:24px;line-height:30px;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));">' + emoji + '</div>' });
  }

  function pararGpsMapa() {
    if (mapaState.gpsWatch != null && navigator.geolocation) { navigator.geolocation.clearWatch(mapaState.gpsWatch); mapaState.gpsWatch = null; }
  }
  function iniciarGpsMapa() {
    if (!navigator.geolocation) return;
    pararGpsMapa();
    mapaState.gpsWatch = navigator.geolocation.watchPosition(function (pos) {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (!mapaState.gpsMarker) {
        mapaState.gpsMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).bindPopup('Você (GPS)').addTo(mapaState.map);
      } else { mapaState.gpsMarker.setLatLng(ll); }
    }, function () { /* sem permissão/sinal → mapa segue sem o ponto azul */ }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  }
  function fecharMapa() { document.getElementById('mapaOverlay').classList.add('hidden'); pararGpsMapa(); }

  // 06/10/2026 — o Leaflet saiu do <head> (travava a tela de entregas inteira até baixar) e carrega SÓ aqui, na 1ª vez
  // que o entregador abre o mapa. Mesma versão e mesmos hashes de integridade de antes.
  let _leaflet = null;
  function carregarLeaflet() {
    if (typeof L !== 'undefined') return Promise.resolve(true);
    if (_leaflet) return _leaflet;
    _leaflet = new Promise(function (resolve) {
      // (revisão de 06/10, menor 6) o CSS também é esperado (sem ele os ladrilhos saem quebrados), e uma 2ª tentativa reaproveita
      // o que já está na página em vez de pendurar outro <script>
      let css = document.getElementById('leaflet-css');
      if (!css) {
        css = document.createElement('link'); css.id = 'leaflet-css';
        css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='; css.crossOrigin = '';
        document.head.appendChild(css);
      }
      const cssPronto = new Promise(function (ok) { if (css.sheet) ok(); else { css.addEventListener('load', ok); css.addEventListener('error', ok); setTimeout(ok, 8000); } });
      let js = document.getElementById('leaflet-js');
      const fim = function (ok) { if (!ok) { _leaflet = null; if (js && js.parentNode) js.parentNode.removeChild(js); } cssPronto.then(function () { resolve(ok && typeof L !== 'undefined'); }); };
      if (!js) {
        js = document.createElement('script'); js.id = 'leaflet-js';
        js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        js.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='; js.crossOrigin = '';
        document.head.appendChild(js);
      }
      js.addEventListener('load', function () { fim(true); });
      js.addEventListener('error', function () { fim(false); });
      setTimeout(function () { if (typeof L === 'undefined') fim(false); }, 20000);
    });
    return _leaflet;
  }

  async function abrirMapa() {
    const overlay = document.getElementById('mapaOverlay');
    const info = document.getElementById('mapaInfo');
    overlay.classList.remove('hidden');
    info.textContent = 'Carregando o mapa…';
    if (!(await carregarLeaflet())) { info.textContent = 'Não foi possível carregar o mapa (sem internet?). Feche e tente de novo.'; return; }
    info.textContent = 'Carregando a rota…';

    if (!mapaState.map) {
      mapaState.map = L.map('mapaLeaflet');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapaState.map);
    }
    const map = mapaState.map;
    setTimeout(function () { map.invalidateSize(); }, 120); // o container estava hidden → recalcula tamanho

    if (mapaState.camadas) map.removeLayer(mapaState.camadas);
    const grupo = L.layerGroup().addTo(map);
    mapaState.camadas = grupo;

    let res;
    try { res = await api.apiGet({ action: 'mapaRota', entregador: state.driver, turno: api.getTurno() }); }
    catch (e) { info.textContent = 'Não foi possível carregar a rota.'; return; }
    if (!res || !res.ok) { info.textContent = 'Não foi possível carregar a rota.'; return; }

    const paradas = Array.isArray(res.paradas) ? res.paradas : [];
    // Duplicadas (mesmo cliente+endereço = mesmo `numero`) viram UM pino só e contam UMA vez. O CD e a
    // casa NÃO entram aqui (vêm de res.cd/res.casa, adicionados à parte) — então não são contados.
    function chaveDedup(p, i) {
      if (p.numero != null && p.numero !== '') return 'n' + p.numero;
      const e = String(p.endereco || '').trim().toLowerCase();
      return e ? 'e' + e + '|' + String(p.cliente || '').trim().toLowerCase() : 'i' + i;
    }
    function dedup(arr) {
      const seen = {}, out = [];
      arr.forEach(function (p, i) { const k = chaveDedup(p, i); if (!seen[k]) { seen[k] = 1; out.push(p); } });
      return out;
    }
    const comCoord = dedup(paradas.filter(function (p) { return p.lat != null && p.lng != null; }));
    const semCoord = dedup(paradas.filter(function (p) { return p.lat == null || p.lng == null; }));
    const pts = [], linha = [];

    if (res.cd && res.cd.lat != null) { L.marker([res.cd.lat, res.cd.lng], { icon: pinEmoji('🏭') }).bindPopup('CD (saída da rota)').addTo(grupo); pts.push([res.cd.lat, res.cd.lng]); linha.push([res.cd.lat, res.cd.lng]); }
    // Pinos no MESMO ponto (mesmo prédio, apartamentos diferentes) se escondem um atrás do outro — foi o
    // caso da Leia (nº8 e nº9 na mesma coord → a 8 sumia sob a 9). Desloca ~8m em círculo os repetidos
    // pra TODOS aparecerem; a LINHA da rota continua na coordenada REAL (não distorce o trajeto).
    const usadosCoord = {};
    comCoord.forEach(function (p, i) {
      const num = p.numero || p.ordem || (i + 1);
      let mlat = p.lat, mlng = p.lng;
      const ck = Number(p.lat).toFixed(5) + ',' + Number(p.lng).toFixed(5);
      const n = usadosCoord[ck] || 0; usadosCoord[ck] = n + 1;
      if (n > 0) { const ang = n * 1.25; mlat += 0.00009 * Math.cos(ang); mlng += 0.00009 * Math.sin(ang); }
      L.marker([mlat, mlng], { icon: pinNumerado(num, corDaParada(p.status)) })
        .bindPopup('<b>' + num + '. ' + api.esc(p.cliente || '') + '</b><br>' + api.esc(p.endereco || '')).addTo(grupo);
      linha.push([p.lat, p.lng]); pts.push([mlat, mlng]);
    });
    if (res.casa && res.casa.lat != null) { L.marker([res.casa.lat, res.casa.lng], { icon: pinEmoji('🏠') }).bindPopup('Sua casa (fim da rota)').addTo(grupo); linha.push([res.casa.lat, res.casa.lng]); pts.push([res.casa.lat, res.casa.lng]); }
    if (linha.length >= 2) L.polyline(linha, { color: '#2563eb', weight: 3, opacity: 0.6, dashArray: '6,6' }).addTo(grupo);

    if (pts.length) map.fitBounds(pts, { padding: [40, 40] }); else map.setView([-19.92, -43.94], 12);

    let txt = comCoord.length + ' entrega(s) no mapa';
    if (semCoord.length) txt += ' · ⚠️ ' + semCoord.length + ' sem localização: ' + semCoord.map(function (p) { return p.cliente; }).join(', ') + ' — endereço pode estar errado, avise o responsável.';
    info.textContent = txt;

    iniciarGpsMapa();
  }

  const btnMapaRota = document.getElementById('btnMapaRota');
  if (btnMapaRota) btnMapaRota.addEventListener('click', abrirMapa);
  const btnFecharMapa = document.getElementById('btnFecharMapa');
  if (btnFecharMapa) btnFecharMapa.addEventListener('click', fecharMapa);

  // ⭐ 28/10/2026 — ABRIR NA HORA: com a rota já começada hoje, a lista guardada de HOJE (mesma chave do plano B offline) aparece
  // antes da rede — com os valores marcados como NÃO conferidos (o modal de dinheiro não confia neles) — e a recarga corre atrás,
  // sem o esqueleto. Antes: tela de "carregando" até o servidor responder (com sinal ruim, segundos com a mercadoria no carro).
  function pintarListaGuardada() {
    if (!state.rotaIniciada || state.rotaFinalizada || !api.lerEntregasGuardadas) return false;
    const guardada = api.lerEntregasGuardadas(state.driver);
    if (!guardada || !guardada.length) return false;
    state.items = guardada.map(function (x) { return Object.assign({}, x, { valorConferido: false }); });
    const info = api.lerRotaInfoGuardada && api.lerRotaInfoGuardada(state.driver);
    if (info) state.rotaInfo = info;
    setLoading(false);
    renderList();
    return true;
  }

  // ⭐ 28/10/2026 — a faxina das lápides da fila (fila-duravel.js `limparLapides`): com o app aberto e PARADO, no máximo 1× a cada
  // 20 h, em lotes, desistindo da vez se a fila estiver enviando, se houver um ato em curso ou se a tela sumir. Nunca no toque.
  function agendarFaxinaDasLapides() {
    try {
      const chave = 'fila_lapides_faxina_v1';
      if (Date.now() - Number(localStorage.getItem(chave) || 0) < 20 * 3600 * 1000) return;
      const ocioso = window.requestIdleCallback ? function (fn) { window.requestIdleCallback(fn, { timeout: 60000 }); } : function (fn) { window.setTimeout(fn, 0); };
      let tentativas = 0;
      const livre = function () { return document.visibilityState === 'visible' && !state.sendingAction && !state.sendingRouteAction; };
      const rodar = function () {
        if (!livre() || (api.filaEmEnvio && api.filaEmEnvio())) { if (++tentativas < 10) window.setTimeout(function () { ocioso(rodar); }, 60000); return; }
        api.limparLapidesAntigas(livre).then(function (r) {
          if (r && !r.interrompida) { try { localStorage.setItem(chave, String(Date.now())); } catch (e) {} }
          else if (++tentativas < 10) window.setTimeout(function () { ocioso(rodar); }, 60000);
        }).catch(function (e) { console.warn('[faxina]', e); });
      };
      window.setTimeout(function () { ocioso(rodar); }, 30000);
    } catch (e) {}
  }

  (async function init() {
    if (redirectIfNoDriver()) return;
    if (driverTitle) driverTitle.textContent = state.driver + ' - ' + (api.getTurno() === 'MANHÃ' ? 'Manhã' : 'Tarde'); // nome + turno na faixa azul
    if (driverNameText) driverNameText.textContent = state.driver; // (elemento antigo removido do HTML; no-op)
    // ⛔ 28/10/2026 — a fila sobe ANTES de esperar as permissões: o porteiro de permissões (.apk) segurava o envio inteiro até
    // alguém tocar em "Permitir". E a lista guardada de hoje já aparece (ver `pintarListaGuardada`).
    api.processarFila(); // sobe o que ficou pendente de envios anteriores
    const pintouGuardada = pintarListaGuardada();
    await exigirPermissoes();            // .apk: exige notificação + localização; site: passa direto
    reportarPermissoes();                // conta pro sistema se GPS/notif estão on/off (só quando muda)
    carregarTudo(!pintouGuardada, true);
    startAutoRefresh();
    startCancelRefresh();
    // GPS (28/10/2026): rota em andamento ao abrir a tela (o Android matou o app, o entregador reabriu) → o rastreio volta a ligar.
    // (revisão da leva 2) e nunca numa rota já FINALIZADA (o fim lembrado no aparelho conta, não só o da sessão); se ela acabou, o
    // rastreio órfão do Android, se houver, é desligado.
    if (state.rotaIniciada && !state.rotaFinalizada && !(api.fimConfirmado && api.fimConfirmado(state.driver))) { try { ligarRastreio(); } catch (e) {} }
    else if (state.rotaFinalizada) { try { pararRastreio(); } catch (e) {} }
    agendarFaxinaDasLapides();
  })();
})();
