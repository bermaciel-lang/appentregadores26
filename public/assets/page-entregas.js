(function () {
  const api = window.AppEntrega;
  const savedDriver = api.getSavedDriverName();

  const state = {
    driver: savedDriver,
    refreshTimer: null,
    items: [],
    rotaInfo: {}, // { kmInicial, kmFinal, fotoInicio, fotoFim, inicio, fim }
    sendingAction: false,
    enviando: null, // { row, act } -> mostra "Enviando..." no card
    sendingRouteAction: false,
    rotaIniciada: sessionStorage.getItem('rota_iniciada_' + savedDriver) === '1',
    rotaFinalizada: sessionStorage.getItem('rota_finalizada_' + savedDriver) === '1'
  };

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
      let gotFile = false; // marca assim que uma foto chega (evita o fallback descartá-la)

      input.addEventListener('change', async function () {
        if (resolved) return;
        const file = input.files && input.files[0];
        if (file) gotFile = true; // <- ANTES de comprimir, pra o fallback não derrubar a foto boa
        if (input.parentNode) document.body.removeChild(input);

        if (!file) {
          resolved = true;
          resolve(null);
          return;
        }

        try {
          const result = await compressImageToBase64(file, 800, 0.5);
          resolved = true;
          resolve(result);
        } catch (error) {
          console.error(error);
          await AppUI.alerta('Não foi possível preparar a foto. Tente tirar de novo.', { tom: 'warn' });
          resolved = true;
          resolve(null);
        }
      });

// Fallback (só não-iOS): detecta quando o entregador CANCELOU a câmera (voltou sem foto).
// No Android o evento 'focus' (volta pro app) chega ANTES do 'change' (o arquivo da foto),
// e em celular/câmera mais lentos a foto demora vários segundos. O corte fixo de 1,5s
// DESCARTAVA a foto que chegava depois (a foto "não ia"). Agora ficamos CHECANDO se a foto
// apareceu e só concluímos "sem foto" depois de ~8s sem nenhum arquivo. Se a foto chegar,
// quem resolve é o handler de 'change' (com a foto).
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!isIOS) {
        window.addEventListener('focus', function onFocus() {
          window.removeEventListener('focus', onFocus);
          let tentativas = 0;
          const iv = setInterval(function () {
            // Foto chegou (ou está chegando) -> para de checar e deixa o 'change' resolver com ela.
            if (resolved || gotFile || (input.files && input.files.length)) { clearInterval(iv); return; }
            if (++tentativas >= 16) { // ~8s sem nenhum arquivo -> assume que cancelou
              clearInterval(iv);
              if (!resolved) {
                resolved = true;
                if (input.parentNode) document.body.removeChild(input);
                resolve(null);
              }
            }
          }, 500);
        });
      }

      input.click();
    });
  }

  function renderEntregaCard(item) {
    const key = api.statusKey(item.status);
    const badgeClass = key === 'done' ? 'ok' : key === 'fail' ? 'fail' : key === 'start' ? 'warn' : '';
    const obsPedido = String(item.observacaoPedido || '').trim();

    // Feedback visual: esta entrega está sendo enviada? ou aguardando reenvio (offline)?
    const enviandoEsta = state.enviando && Number(state.enviando.row) === Number(item.row);
    const pendente = !enviandoEsta && api.filaRowsPendentes && api.filaRowsPendentes().has(Number(item.row));
    const dis = enviandoEsta ? 'disabled' : '';
    const statusBanner = enviandoEsta
      ? '<div class="delivery-meta" style="color:#92400e;font-weight:600;">⏳ Enviando, aguarde…</div>'
      : (pendente ? '<div class="delivery-meta" style="color:#92400e;font-weight:600;">⏳ Aguardando envio (vai subir sozinho quando a internet voltar)</div>' : '');

    let obsHtml = '';

    if (obsPedido) {
      if (obsPedido.length > 120) {
        obsHtml = `
          <div class="delivery-meta">
            <details>
              <summary><span class="meta-label">Observação</span></summary>
              <div class="top-gap">${api.esc(obsPedido)}</div>
            </details>
          </div>
        `;
      } else {
        obsHtml = `
          <div class="delivery-meta">
            <div><span class="meta-label">Observação:</span> ${api.esc(obsPedido)}</div>
          </div>
        `;
      }
    }

    return `
      <article class="delivery-card ${key}">
        <div class="delivery-top">
          <div>
            <h3 class="delivery-client">${api.esc(item.cliente)}</h3>
          </div>
          <span class="badge ${badgeClass}">${api.esc(api.statusLabel(item.status))}</span>
        </div>

        ${obsHtml}
        ${statusBanner}

        <div class="acoes c2">
          <button type="button" class="action-btn btn-start" data-act="start" data-row="${item.row}" ${dis}>🚚 Iniciar</button>
          <button type="button" class="action-btn btn-whats" data-act="whats" data-row="${item.row}" ${dis}>💬 WhatsApp</button>
        </div>
        <div class="acoes c3">
          <button type="button" class="action-btn btn-done" data-act="done" data-row="${item.row}" ${dis}>${enviandoEsta && state.enviando.act === 'done' ? '⏳…' : '✅ Entregue'}</button>
          <button type="button" class="action-btn btn-cancelado" data-act="cancelado" data-row="${item.row}" ${dis}>✖ Cancelado</button>
          <button type="button" class="action-btn btn-fail" data-act="fail" data-row="${item.row}" ${dis}>⛔ Não recebeu</button>
        </div>
        <div class="acoes c2">
          <button type="button" class="action-btn btn-maps" data-act="maps" data-row="${item.row}" ${dis}>📍 Maps</button>
          <button type="button" class="action-btn btn-waze" data-act="waze" data-row="${item.row}" ${dis}>🗺️ Waze</button>
        </div>
      </article>
    `;
  }

  // Uma entrega está "resolvida" se foi Entregue, Não entregue ou Cancelado.
  // ("Indo para entrega" e vazio NÃO contam como resolvida.)
  function statusResolvido(item) {
    const s = String(item && item.status || '').toLowerCase();
    return s.indexOf('entregue') >= 0 || s.indexOf('não entreg') >= 0 || s.indexOf('nao entreg') >= 0 || s.indexOf('cancel') >= 0;
  }

  // Cor + ✓ nos botões de Iniciar/Finalizar (topo) conforme o estado da rota.
  function atualizarBotoesRota() {
    const bi = document.getElementById('btnIniciarRota');
    const bf = document.getElementById('btnFinalizarRota');
    if (bi) {
      if (state.rotaIniciada || state.rotaFinalizada) { bi.textContent = '✓ Rota iniciada'; bi.classList.add('route-success'); bi.disabled = true; }
      else { bi.textContent = 'Iniciar entregas'; bi.classList.remove('route-success'); bi.disabled = false; }
    }
    if (bf) {
      bf.classList.remove('route-ready', 'route-success');
      if (state.rotaFinalizada) { bf.textContent = '✓ Rota finalizada'; bf.classList.add('route-success'); bf.disabled = true; }
      else if (state.rotaIniciada) { bf.textContent = 'Finalizar rota'; bf.classList.add('route-ready'); bf.disabled = false; }
      else { bf.textContent = 'Finalizar rota'; bf.disabled = false; }
    }
  }

  // Painel "o que foi registrado" embaixo dos botões: KM + foto + editar/reenviar.
  function renderInfoRota() {
    const el = document.getElementById('infoRota');
    if (!el) return;
    const ri = state.rotaInfo || {};
    const temInicio = !!(ri.inicio || ri.kmInicial || state.rotaIniciada || state.rotaFinalizada);
    const temFim = !!(ri.fim || ri.kmFinal || state.rotaFinalizada);
    if (!temInicio && !temFim) { el.innerHTML = ''; return; }

    function linha(titulo, km, fotoOk, tipoKm, tipoFoto) {
      return `<div class="info-rota-linha">
        <span><b>${titulo}:</b> KM ${km ? api.esc(km) : '—'} · Foto ${fotoOk ? '✅ enviada' : '❌ não enviada'}</span>
        <span class="acoes-mini">
          <button type="button" class="mini-btn" data-info="km-${tipoKm}">✏️ Editar KM</button>
          <button type="button" class="mini-btn" data-info="foto-${tipoFoto}">📷 ${fotoOk ? 'Reenviar' : 'Enviar'} foto</button>
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
    const km = tipo === 'fim' ? (state.rotaInfo.kmFinal || '') : (state.rotaInfo.kmInicial || '');
    const foto = await pedirFotoObrigatoria();
    if (!foto || !foto.base64) { await AppUI.alerta('Nenhuma foto selecionada.', { tom: 'warn' }); return; }
    try {
      const res = tipo === 'fim'
        ? await api.apiFinalizarRota(state.driver, km, foto.base64, foto.mimeType)
        : await api.apiIniciarRota(state.driver, km, foto.base64, foto.mimeType);
      if (!res || !res.ok) throw new Error();
      if (res.semFoto) await AppUI.alerta('A foto ainda não subiu — tente de novo com sinal melhor.', { tom: 'warn' });
      else await AppUI.alerta('Foto enviada. ✅', { tom: 'success' });
      await carregarTudo(false);
    } catch (e) { await AppUI.alerta('Não foi possível enviar a foto agora.', { tom: 'danger' }); }
  }

  function renderList() {
    const resumo = api.gerarResumoEntregas(state.items);
    refreshInfo.textContent = `Total: ${resumo.total} • Em rota: ${resumo.emRota} • Entregues: ${state.items.filter((x) => api.statusKey(x.status) === 'done').length} • Não entregues: ${state.items.filter((x) => api.statusKey(x.status) === 'fail').length}`;

    atualizarBotoesRota();
    renderInfoRota();

    if (!state.rotaIniciada) {
      sectionsRoot.innerHTML = '<div class="empty-box">Clique em "Iniciar entregas" para ver a lista de entregas.</div>';
      sectionsRoot.classList.remove('hidden');
      return;
    }

    // Lembrete quando todas as entregas estão marcadas (e a rota ainda não foi
    // finalizada). Fica NO TOPO, grande, fixo na tela e clicável (toca = finaliza).
    const todasMarcadas = state.items.length > 0 && state.items.every(statusResolvido);
    const lembrete = (todasMarcadas && !state.rotaFinalizada && !state.sendingRouteAction)
      ? '<button type="button" class="lembrete-finalizar" data-route="finalizar">✅ Todas as entregas marcadas!<br>👉 Toque aqui para FINALIZAR A ROTA</button>'
      : '';

    // Botão grande de Finalizar embaixo da lista.
    const fimEnviando = state.sendingRouteAction;
    const fimTxt = state.rotaFinalizada ? '✓ Rota finalizada' : (fimEnviando ? '⏳ Enviando…' : '🏁 Finalizar rota');
    const botaoFim = `<button type="button" class="btn-finalizar-bottom ${state.rotaFinalizada ? 'route-success' : ''}" data-route="finalizar" ${state.rotaFinalizada || fimEnviando ? 'disabled' : ''}>${fimTxt}</button>`;

    sectionsRoot.innerHTML = `
      ${lembrete}
      <section class="section-card">
        <div class="delivery-list">
          ${state.items.map(renderEntregaCard).join('')}
        </div>
      </section>
      ${botaoFim}
    `;

    sectionsRoot.classList.remove('hidden');
  }

  async function carregarTudo(showSkeleton) {
    if (showSkeleton) setLoading(true);
    errorBox.classList.add('hidden');

    try {
      const result = await api.carregarEntregasPorEntregador(state.driver);
      state.items = result.data || [];
      if (result.rotaInfo) state.rotaInfo = result.rotaInfo;

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
      } else if (api.usandoPainel() && !result.stale && !result.rotaIniciada && state.rotaIniciada) {
        // SÓ no fluxo do PAINEL (Etapa C), onde a resposta SEMPRE traz rotaIniciada de verdade.
        // No fluxo ANTIGO (Apps Script) a resposta NÃO traz esse campo (vem false), então isto
        // NÃO roda — senão "des-iniciava" a rota do entregador a cada refresh (bug reportado).
        // Aqui (painel) o servidor diz que a rota não está iniciada → libera o "Iniciar" de novo.
        state.rotaIniciada = false;
        sessionStorage.removeItem('rota_iniciada_' + state.driver);
        sessionStorage.removeItem('rota_assinatura_' + state.driver);
      }

      renderList();

      if (result.stale) {
        setWarning('As entregas foram abertas pelo último cache salvo. A internet ou a API podem ter falhado agora.');
      } else {
        setWarning('');
      }
    } catch (error) {
      console.error(error);
      errorBox.classList.remove('hidden');
      errorBox.textContent = 'Não foi possível carregar as entregas deste entregador.';
    } finally {
      setLoading(false);
    }
  }

  function updateLocalStatus(row, nextStatus, nextObs) {
    const index = state.items.findIndex((x) => Number(x.row) === Number(row));
    if (index < 0) return null;

    const previous = Object.assign({}, state.items[index]);
    state.items[index] = Object.assign({}, state.items[index], {
      status: nextStatus,
      // a tela lê 'observacaoPedido' (mesma chave da API); gravar em 'observacao' fazia a
      // observação digitada sumir até recarregar.
      observacaoPedido: nextObs !== undefined ? nextObs : state.items[index].observacaoPedido
    });

    api.saveEntregasCache(state.driver, state.items);
    renderList();
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

  async function handleIniciarRota() {
    if (state.sendingRouteAction) return;
    if (state.rotaIniciada) {
      await AppUI.alerta('A rota já foi iniciada.', { tom: 'warn' });
      return;
    }

    let km = await pedirKm('Digite a quilometragem inicial do carro.\n\nNas rotas sem foto, será considerado o KM calculado pelo sistema.');
    if (km === null) return; // cancelou o KM -> aborta

    const foto = await pedirFotoObrigatoria();

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
    }

    state.sendingRouteAction = true;
const loadingRota = document.getElementById('loadingRota');
const btnIniciarRota = document.getElementById('btnIniciarRota');

loadingRota.textContent = 'Enviando, aguarde um momento, não feche a página!';
loadingRota.classList.remove('hidden');
btnIniciarRota.disabled = true;

    try {
      const res = await api.apiIniciarRota(state.driver, km, foto ? foto.base64 : '', foto ? foto.mimeType : 'image/jpeg');

      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Falha ao iniciar rota');
      }

      state.rotaIniciada = true;
      state.rotaFinalizada = false;
      sessionStorage.setItem('rota_iniciada_' + state.driver, '1');
      const assinaturaRota = state.items.map(x => x.row).sort().join(',');
      sessionStorage.setItem('rota_assinatura_' + state.driver, assinaturaRota);
      sessionStorage.removeItem('rota_finalizada_' + state.driver);

      await carregarTudo(false);
      if (res.semFoto) await AppUI.alerta('Rota iniciada e KM salvo ✅ — MAS a foto não subiu. Quando tiver sinal melhor, inicie a rota de novo só pra enviar a foto, ou avise o supervisor.', { tom: 'warn' });
      else await AppUI.alerta('Rota iniciada com sucesso. ✓', { tom: 'success' });
    } catch (error) {
      console.error(error);
      state.rotaIniciada = true;
      state.rotaFinalizada = false;
      sessionStorage.setItem('rota_iniciada_' + state.driver, '1');
      const assinaturaRotaErr = state.items.map(x => x.row).sort().join(',');
      sessionStorage.setItem('rota_assinatura_' + state.driver, assinaturaRotaErr);
      sessionStorage.removeItem('rota_finalizada_' + state.driver);
      await carregarTudo(false);
      await AppUI.alerta('Rota iniciada. Houve um problema ao registrar no servidor, mas você já pode fazer as entregas.', { tom: 'warn' });
    } finally {
loadingRota.classList.add('hidden');
btnIniciarRota.disabled = false;
      state.sendingRouteAction = false;
    }
    // Liga o rastreamento GPS da rota (não trava nada se falhar).
    try { if (state.rotaIniciada && window.Rastreio) window.Rastreio.iniciar(state.driver); } catch (e) {}
  }

async function handleFinalizarRota() {
  if (state.sendingRouteAction) return;

  if (!state.rotaIniciada) {
    await AppUI.alerta('Clique primeiro em "Iniciar entregas".', { tom: 'warn' });
    return;
  }

  let km = await pedirKm('Digite a quilometragem final do carro.\n\nNas rotas sem foto, será considerado o KM calculado pelo sistema.');
  if (km === null) return; // cancelou o KM -> aborta

  const foto = await pedirFotoObrigatoria();

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
  }

  state.sendingRouteAction = true;

  const loadingRota = document.getElementById('loadingRota');
  const btnFinalizarRota = document.getElementById('btnFinalizarRota');

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

    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'Falha ao finalizar rota');
    }

    state.rotaFinalizada = true;
    state.rotaIniciada = false;
    sessionStorage.setItem('rota_finalizada_' + state.driver, '1');
    sessionStorage.removeItem('rota_iniciada_' + state.driver);
    sessionStorage.removeItem('rota_assinatura_' + state.driver);
    // Desliga o rastreamento GPS (rota finalizada).
    try { if (window.Rastreio) window.Rastreio.parar(); } catch (e) {}

    await carregarTudo(false);
    if (res.semFoto) await AppUI.alerta('Rota finalizada e KM salvo ✅ — MAS a foto não subiu. Quando tiver sinal melhor, finalize de novo só pra enviar a foto, ou avise o supervisor.', { tom: 'warn' });
    else await AppUI.alerta('Rota finalizada com sucesso. ✓', { tom: 'success' });
  } catch (error) {
    console.error(error);
    await AppUI.alerta('Não foi possível finalizar a rota. Tente de novo.', { tom: 'danger' });
  } finally {
    loadingRota.classList.add('hidden');
    btnFinalizarRota.disabled = false;
    state.sendingRouteAction = false;
    renderList();
  }
}

  async function handleAction(act, row) {
    if (state.sendingAction) return;

    const item = state.items.find((x) => Number(x.row) === Number(row));
    if (!item) return;

    if ((act === 'start' || act === 'maps' || act === 'waze') && !state.rotaIniciada) {
      await AppUI.alerta('Clique primeiro em "Iniciar entregas".', { tom: 'warn' });
      return;
    }

    // Pergunta a observação ANTES de mostrar "Enviando…". A observação é OPCIONAL: tocar
    // "Pular" segue sem ela (mesmo comportamento de antes, só que com nome claro no botão).
    let nextStatus = null, obs;
    if (act === 'done') {
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
    }
    else if (act === 'fail') { obs = (await AppUI.perguntar('Motivo / observação:', { titulo: '⛔ Não recebeu', tom: 'danger', placeholder: 'Ex.: cliente ausente', textoOk: 'Marcar', textoCancelar: 'Pular' })) || ''; nextStatus = 'Não entregue'; }
    else if (act === 'cancelado') { obs = (await AppUI.perguntar('Motivo do cancelamento:', { titulo: '✖ Cancelado', tom: 'warn', placeholder: 'Ex.: pedido duplicado', textoOk: 'Confirmar cancelamento', textoCancelar: 'Pular' })) || ''; nextStatus = 'Cancelado'; }
    else if (act === 'start') { nextStatus = 'Indo para entrega'; }

    state.sendingAction = true;
    state.enviando = { row: Number(row), act };
    renderList(); // mostra "⏳ Enviando…" no card na hora

    try {
      // Maps/Waze: marca "indo" e abre o mapa (navega pra fora).
      if (act === 'maps' || act === 'waze') {
        if (api.statusKey(item.status) !== 'start') {
          updateLocalStatus(row, 'Indo para entrega');
          try { const r = await api.apiIniciarEntrega(row); if (!r || !r.ok) throw new Error('x'); }
          catch (e) { api.enfileirar({ action: 'iniciarEntrega', row: row }, { row: Number(row) }); }
        }
        await openSameTab(act === 'maps' ? api.buildMapsUrl(item) : api.buildWazeUrl(item));
        return;
      }

      if (act === 'whats') { await api.abrirWhatsapp(row); return; }

      // Hora do APARELHO no instante do toque (ISO). Vai junto no envio; e SE cair na FILA offline,
      // é reenviada COM ESTE horário quando a internet voltar. Assim o servidor carimba o entregue_em
      // pela hora do CLIQUE (horaEntregaValida usa ts_device) — e não pela hora em que a conexão
      // voltou. Sem isso, marcar várias entregues offline e reconectar subia TODAS com o mesmo horário.
      const tsDevice = new Date().toISOString();
      // Status (Iniciar / Entregue / Não entregue / Cancelado):
      const params = act === 'start' ? { action: 'iniciarEntrega', row: row, ts_device: tsDevice }
        : act === 'done' ? { action: 'marcarEntregue', row: row, obs: obs || '', ts_device: tsDevice }
        : act === 'fail' ? { action: 'marcarNaoEntregue', row: row, obs: obs || '', ts_device: tsDevice }
        : { action: 'marcarCancelado', row: row, obs: obs || '', ts_device: tsDevice };

      updateLocalStatus(row, nextStatus, obs); // já deixa marcado na tela
      try {
        const res = await api.apiGet(params, { retries: 3 });
        if (!res || !res.ok) throw new Error('falhou');
        window.setTimeout(function () { carregarTudo(false); }, 800);
      } catch (e2) {
        // NÃO desmarca: guarda na fila e reenvia sozinho quando a internet voltar.
        api.enfileirar(params, { row: Number(row) });
        await AppUI.alerta('Sem conexão agora. ✅ A marcação foi guardada e será enviada sozinha quando a internet voltar (fica como "⏳ Aguardando envio").', { titulo: 'Sem conexão', tom: 'warn' });
      }
    } catch (error) {
      console.error(error);
      await AppUI.alerta('Não foi possível concluir essa ação. Tente de novo.', { tom: 'danger' });
    } finally {
      state.sendingAction = false;
      state.enviando = null;
      renderList();
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = window.setInterval(function () {
      if (document.visibilityState === 'visible') {
        api.processarFila();
        carregarTudo(false);
      }
    }, window.APP_CONFIG.REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  document.getElementById('btnTrocar').addEventListener('click', function () {
    sessionStorage.removeItem('rota_iniciada_' + state.driver);
    sessionStorage.removeItem('rota_finalizada_' + state.driver);
    sessionStorage.removeItem('rota_assinatura_' + state.driver);
    api.clearSavedDriverName();
    window.location.href = '/';
  });

  // Botão "Trocar turno" (só no backend do painel, onde manhã/tarde coexistem). Volta pra
  // home, onde o entregador escolhe o turno e o nome de novo. Não apaga o entregador salvo.
  if (api.usandoPainel && api.usandoPainel()) {
    const btnTrocar = document.getElementById('btnTrocar');
    if (btnTrocar && !document.getElementById('btnTrocarTurno')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'btnTrocarTurno';
      b.className = 'ghost-btn';
      b.textContent = '🔄 Trocar turno (' + (api.getTurno() === 'MANHÃ' ? 'Manhã' : 'Tarde') + ')';
      b.addEventListener('click', function () { window.location.href = '/'; });
      btnTrocar.parentNode.insertBefore(b, btnTrocar);
    }
  }

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
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    handleAction(btn.getAttribute('data-act'), Number(btn.getAttribute('data-row')));
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      api.processarFila();
      carregarTudo(false);
    }
  });

  // Quando a internet volta, reenvia o que ficou pendente na fila.
  window.addEventListener('online', function () {
    api.processarFila().then(function () { carregarTudo(false); });
  });

  window.addEventListener('beforeunload', function () {
    stopAutoRefresh();
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
      api.apiGet({ action: 'permissoes', entregador: state.driver, gps: gps, notif: notif, plataforma: plat }, { retries: 1 });
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

  async function abrirMapa() {
    const overlay = document.getElementById('mapaOverlay');
    const info = document.getElementById('mapaInfo');
    overlay.classList.remove('hidden');
    info.textContent = 'Carregando a rota…';
    if (typeof L === 'undefined') { info.textContent = 'Não foi possível carregar o mapa (sem internet?).'; return; }

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
    const comCoord = paradas.filter(function (p) { return p.lat != null && p.lng != null; });
    const semCoord = paradas.filter(function (p) { return p.lat == null || p.lng == null; });
    const pts = [], linha = [];

    if (res.cd && res.cd.lat != null) { L.marker([res.cd.lat, res.cd.lng], { icon: pinEmoji('🏭') }).bindPopup('CD (saída da rota)').addTo(grupo); pts.push([res.cd.lat, res.cd.lng]); linha.push([res.cd.lat, res.cd.lng]); }
    comCoord.forEach(function (p, i) {
      const ll = [p.lat, p.lng];
      L.marker(ll, { icon: pinNumerado(p.ordem || (i + 1), corDaParada(p.status)) })
        .bindPopup('<b>' + (p.ordem || (i + 1)) + '. ' + api.esc(p.cliente || '') + '</b><br>' + api.esc(p.endereco || '')).addTo(grupo);
      linha.push(ll); pts.push(ll);
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

  (async function init() {
    if (redirectIfNoDriver()) return;
    if (driverTitle) driverTitle.textContent = state.driver; // título virou fixo "Tela do entregador"
    if (driverNameText) driverNameText.textContent = state.driver; // nome único, no cartão
    await exigirPermissoes();            // .apk: exige notificação + localização; site: passa direto
    reportarPermissoes();                // conta pro sistema se GPS/notif estão on/off
    api.processarFila(); // sobe o que ficou pendente de envios anteriores
    carregarTudo(true);
    startAutoRefresh();
  })();
})();