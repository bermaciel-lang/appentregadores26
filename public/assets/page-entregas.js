(function () {
  const api = window.AppEntrega;
  const savedDriver = api.getSavedDriverName();

  const state = {
    driver: savedDriver,
    refreshTimer: null,
    items: [],
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

function pedirKm(mensagem) {
  const raw = prompt(mensagem);

  if (raw === null) return null; // cancelou -> aborta a ação

  let value = String(raw).trim();

  // KM NÃO é obrigatório: se deixar vazio, segue sem registrar (não trava a rota).
  if (!value) return '';

  // troca ponto por vírgula
  value = value.replace('.', ',');

  // se digitou algo que não é número, avisa mas SEGUE sem KM (não bloqueia).
  if (!/^\d+(,\d+)?$/.test(value)) {
    alert('KM inválido — seguindo sem registrar o KM. Avise o supervisor depois.');
    return '';
  }

  return value;
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
          alert('Não foi possível preparar a foto. Tente tirar de novo.');
          resolved = true;
          resolve(null);
        }
      });

// Fallback: só conclui "sem foto" se NENHUMA foto chegou (e com folga de tempo,
// pra câmeras lentas não perderem a foto). Apenas não-iOS.
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!isIOS) {
        window.addEventListener('focus', function onFocus() {
          window.removeEventListener('focus', onFocus);
          setTimeout(function () {
            if (!resolved && !gotFile) {
              resolved = true;
              if (input.parentNode) document.body.removeChild(input);
              resolve(null);
            }
          }, 1500);
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

  function renderList() {
    const resumo = api.gerarResumoEntregas(state.items);
    refreshInfo.textContent = `Total: ${resumo.total} • Em rota: ${resumo.emRota} • Entregues: ${state.items.filter((x) => api.statusKey(x.status) === 'done').length} • Não entregues: ${state.items.filter((x) => api.statusKey(x.status) === 'fail').length}`;

    atualizarBotoesRota();

    if (!state.rotaIniciada) {
      sectionsRoot.innerHTML = '<div class="empty-box">Clique em "Iniciar entregas" para ver a lista de entregas.</div>';
      sectionsRoot.classList.remove('hidden');
      return;
    }

    // Lembrete quando todas as entregas estão marcadas (e a rota ainda não foi finalizada).
    const todasMarcadas = state.items.length > 0 && state.items.every(statusResolvido);
    const lembrete = (todasMarcadas && !state.rotaFinalizada)
      ? '<div class="lembrete-finalizar">✅ Todas as entregas foram marcadas! Não esqueça de clicar em <b>FINALIZAR ROTA</b> 👇</div>'
      : '';

    // Botão grande de Finalizar embaixo da lista.
    const fimEnviando = state.sendingRouteAction;
    const fimTxt = state.rotaFinalizada ? '✓ Rota finalizada' : (fimEnviando ? '⏳ Enviando…' : '🏁 Finalizar rota');
    const botaoFim = `<button type="button" class="btn-finalizar-bottom ${state.rotaFinalizada ? 'route-success' : ''}" data-route="finalizar" ${state.rotaFinalizada || fimEnviando ? 'disabled' : ''}>${fimTxt}</button>`;

    sectionsRoot.innerHTML = `
      <section class="section-card">
        <div class="delivery-list">
          ${state.items.map(renderEntregaCard).join('')}
        </div>
      </section>
      ${lembrete}
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
      observacao: nextObs !== undefined ? nextObs : state.items[index].observacao
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

  function openSameTab(url) {
    if (!url || url === '#') {
      alert('Endereço não disponível para abrir.');
      return;
    }
    window.location.assign(url);
  }

  async function handleIniciarRota() {
    if (state.sendingRouteAction) return;
    if (state.rotaIniciada) {
      alert('A rota já foi iniciada.');
      return;
    }

    const km = pedirKm('Digite a quilometragem inicial do carro (pode deixar em branco se não der):');
    if (km === null) return; // só aborta se cancelar

    // Foto NÃO bloqueia: se não der pra tirar, a rota inicia mesmo assim.
    const foto = await pedirFotoObrigatoria();

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
      if (res.semFoto) alert('Rota iniciada e KM salvo ✅ — MAS a foto não subiu. Quando tiver sinal melhor, inicie a rota de novo só pra enviar a foto, ou avise o supervisor.');
      else alert('Rota iniciada com sucesso.');
    } catch (error) {
      console.error(error);
      state.rotaIniciada = true;
      state.rotaFinalizada = false;
      sessionStorage.setItem('rota_iniciada_' + state.driver, '1');
      const assinaturaRotaErr = state.items.map(x => x.row).sort().join(',');
      sessionStorage.setItem('rota_assinatura_' + state.driver, assinaturaRotaErr);
      sessionStorage.removeItem('rota_finalizada_' + state.driver);
      await carregarTudo(false);
      alert('Rota iniciada. Houve um problema ao registrar no servidor, mas você já pode fazer as entregas.');
    } finally {
loadingRota.classList.add('hidden');
btnIniciarRota.disabled = false;
      state.sendingRouteAction = false;
    }
  }

async function handleFinalizarRota() {
  if (state.sendingRouteAction) return;

  if (!state.rotaIniciada) {
    alert('Clique primeiro em "Iniciar entregas".');
    return;
  }

  const km = pedirKm('Digite a quilometragem final do carro (pode deixar em branco se não der):');
  if (km === null) return; // só aborta se cancelar

  // Foto NÃO bloqueia: se não der pra tirar, a rota finaliza mesmo assim.
  const foto = await pedirFotoObrigatoria();

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

    await carregarTudo(false);
    if (res.semFoto) alert('Rota finalizada e KM salvo ✅ — MAS a foto não subiu. Quando tiver sinal melhor, finalize de novo só pra enviar a foto, ou avise o supervisor.');
    else alert('Rota finalizada com sucesso. ✓');
  } catch (error) {
    console.error(error);
    alert('Não foi possível finalizar a rota. Tente de novo.');
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
      alert('Clique primeiro em "Iniciar entregas".');
      return;
    }

    // Pergunta a observação ANTES de mostrar "Enviando…".
    let nextStatus = null, obs;
    if (act === 'done') { obs = prompt('Observação da entrega:') || ''; nextStatus = 'Entregue'; }
    else if (act === 'fail') { obs = prompt('Motivo / observação:') || ''; nextStatus = 'Não entregue'; }
    else if (act === 'cancelado') { obs = prompt('Motivo do cancelamento:') || ''; nextStatus = 'Cancelado'; }
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
        openSameTab(act === 'maps' ? api.buildMapsUrl(item) : api.buildWazeUrl(item));
        return;
      }

      if (act === 'whats') { await api.abrirWhatsapp(row); return; }

      // Status (Iniciar / Entregue / Não entregue / Cancelado):
      const params = act === 'start' ? { action: 'iniciarEntrega', row: row }
        : act === 'done' ? { action: 'marcarEntregue', row: row, obs: obs || '' }
        : act === 'fail' ? { action: 'marcarNaoEntregue', row: row, obs: obs || '' }
        : { action: 'marcarCancelado', row: row, obs: obs || '' };

      updateLocalStatus(row, nextStatus, obs); // já deixa marcado na tela
      try {
        const res = await api.apiGet(params, { retries: 3 });
        if (!res || !res.ok) throw new Error('falhou');
        window.setTimeout(function () { carregarTudo(false); }, 800);
      } catch (e2) {
        // NÃO desmarca: guarda na fila e reenvia sozinho quando a internet voltar.
        api.enfileirar(params, { row: Number(row) });
        alert('Sem conexão agora. ✅ A marcação foi guardada e será enviada sozinha quando a internet voltar (fica como "⏳ Aguardando envio").');
      }
    } catch (error) {
      console.error(error);
      alert('Não foi possível concluir essa ação. Tente de novo.');
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

  document.getElementById('btnVoltar').addEventListener('click', function () {
    window.location.href = '/';
  });

  document.getElementById('btnTrocar').addEventListener('click', function () {
    sessionStorage.removeItem('rota_iniciada_' + state.driver);
    sessionStorage.removeItem('rota_finalizada_' + state.driver);
    sessionStorage.removeItem('rota_assinatura_' + state.driver);
    api.clearSavedDriverName();
    window.location.href = '/';
  });

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

  (function init() {
    if (redirectIfNoDriver()) return;
    driverTitle.textContent = state.driver;
    driverNameText.textContent = state.driver;
    api.processarFila(); // sobe o que ficou pendente de envios anteriores
    carregarTudo(true);
    startAutoRefresh();
  })();
})();