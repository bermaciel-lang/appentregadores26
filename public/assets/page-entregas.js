(function () {
  const api = window.AppEntrega;
  const state = {
    driver: api.getSavedDriverName(),
    refreshTimer: null,
    gpsWatchId: null,
    lastGpsSend: 0,
    items: [],
    sendingAction: false
  };

  const driverTitle = document.getElementById('driverTitle');
  const driverNameText = document.getElementById('driverNameText');
  const gpsBadge = document.getElementById('gpsBadge');
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

  function sectionTemplate(title, count, badgeClass, items) {
    if (!items.length) {
      return `
        <section class="section-card">
          <div class="section-head">
            <h2 class="section-title">${title}</h2>
            <span class="badge ${badgeClass}">${count}</span>
          </div>
          <div class="empty-box">Nenhuma entrega nesta seção.</div>
        </section>
      `;
    }

    return `
      <section class="section-card">
        <div class="section-head">
          <h2 class="section-title">${title}</h2>
          <span class="badge ${badgeClass}">${count}</span>
        </div>
        <div class="delivery-list">
          ${items.map(renderEntregaCard).join('')}
        </div>
      </section>
    `;
  }

  function renderEntregaCard(item) {
    const key = api.statusKey(item.status);
    const cssClass = key === 'start' ? 'start' : key === 'done' ? 'done' : key === 'fail' ? 'fail' : 'pending';
    return `
      <article class="delivery-card ${cssClass}">
        <div class="delivery-top">
          <div>
            <h3 class="delivery-client">${api.esc(item.cliente)}</h3>
            <div class="small-muted">Pedido ${api.esc(item.pedido || '-')}</div>
          </div>
          <span class="badge ${key === 'done' ? 'ok' : key === 'fail' ? 'fail' : key === 'start' ? 'warn' : ''}">${api.esc(api.statusLabel(item.status))}</span>
        </div>
        <div class="delivery-meta">
          <div><span class="meta-label">Endereço:</span> ${api.esc(item.endereco || '-')}</div>
          <div><span class="meta-label">Horário:</span> ${api.esc(item.horario || '-')}</div>
          <div><span class="meta-label">Observação:</span> ${api.esc(item.observacao || '-')}</div>
        </div>
        <div class="action-grid">
          <button type="button" class="action-btn btn-start" data-act="start" data-row="${item.row}">🚚 Iniciar</button>
          <button type="button" class="action-btn btn-whats" data-act="whats" data-row="${item.row}">💬 WhatsApp</button>
          <button type="button" class="action-btn btn-done" data-act="done" data-row="${item.row}">✅ Entregue</button>
          <button type="button" class="action-btn btn-fail" data-act="fail" data-row="${item.row}">⛔ Não entregue</button>
          <button type="button" class="action-btn btn-maps" data-act="maps" data-row="${item.row}">📍 Maps</button>
          <button type="button" class="action-btn btn-waze" data-act="waze" data-row="${item.row}">🗺️ Waze</button>
        </div>
      </article>
    `;
  }

  function renderSections() {
    const grupos = api.agruparEntregas(state.items);
    const resumo = api.gerarResumoEntregas(state.items);

    refreshInfo.textContent = `Total: ${resumo.total} • Em rota: ${resumo.emRota} • Pendentes: ${resumo.pendentes} • Concluídas: ${resumo.concluidas}`;

    sectionsRoot.innerHTML = [
      sectionTemplate('Em rota', grupos.emRota.length, 'warn', grupos.emRota),
      sectionTemplate('Pendentes', grupos.pendentes.length, '', grupos.pendentes),
      sectionTemplate('Concluídas', grupos.concluidas.length, 'ok', grupos.concluidas)
    ].join('');

    sectionsRoot.classList.remove('hidden');
  }

  async function carregarTudo(showSkeleton) {
    if (showSkeleton) setLoading(true);
    errorBox.classList.add('hidden');

    try {
      const result = await api.carregarEntregasPorEntregador(state.driver);
      state.items = result.data || [];
      renderSections();

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

  async function handleAction(act, row) {
    if (state.sendingAction) return;
    state.sendingAction = true;

    try {
      const item = state.items.find((x) => Number(x.row) === Number(row));

      if (act === 'start') {
        const res = await api.apiIniciarEntrega(row);
        if (!res || !res.ok) throw new Error('Falha ao iniciar');
      } else if (act === 'maps') {
        const res = await api.apiIniciarEntrega(row);
        if (!res || !res.ok) throw new Error('Falha ao iniciar');
        if (item) window.open(api.buildMapsUrl(item), '_blank');
      } else if (act === 'waze') {
        const res = await api.apiIniciarEntrega(row);
        if (!res || !res.ok) throw new Error('Falha ao iniciar');
        if (item) window.open(api.buildWazeUrl(item), '_blank');
      } else if (act === 'done') {
        const obs = prompt('Observação da entrega:') || '';
        const res = await api.apiMarcarEntregue(row, obs);
        if (!res || !res.ok) throw new Error('Falha ao concluir');
      } else if (act === 'fail') {
        const obs = prompt('Motivo / observação:') || '';
        const res = await api.apiMarcarNaoEntregue(row, obs);
        if (!res || !res.ok) throw new Error('Falha ao marcar não entregue');
      } else if (act === 'whats') {
        await api.abrirWhatsapp(row);
        state.sendingAction = false;
        return;
      }

      await carregarTudo(false);
    } catch (error) {
      console.error(error);
      alert('Não foi possível concluir essa ação. Confira a conexão e tente de novo.');
    } finally {
      state.sendingAction = false;
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = window.setInterval(function () {
      if (document.visibilityState === 'visible') {
        carregarTudo(false);
      }
    }, window.APP_CONFIG.REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  function setGpsBadge(text, variant) {
    gpsBadge.textContent = text;
    gpsBadge.className = 'badge ' + (variant || '');
  }

  function startGPS() {
    if (!navigator.geolocation || !state.driver) {
      setGpsBadge('GPS não disponível', 'fail');
      return;
    }

    stopGPS();
    setGpsBadge('GPS ativo', 'ok');

    state.gpsWatchId = navigator.geolocation.watchPosition(async function (pos) {
      const now = Date.now();
      if (document.visibilityState !== 'visible') return;
      if ((now - state.lastGpsSend) < window.APP_CONFIG.GPS_THROTTLE_MS) return;

      state.lastGpsSend = now;
      try {
        await api.apiAtualizarLocalizacaoEntregador(state.driver, pos.coords.latitude, pos.coords.longitude);
        setGpsBadge('GPS atualizado ' + api.formatTime(new Date()), 'ok');
      } catch (error) {
        console.error(error);
        setGpsBadge('GPS com erro', 'warn');
      }
    }, function () {
      setGpsBadge('Permita o GPS', 'warn');
    }, {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 10000
    });
  }

  function stopGPS() {
    if (state.gpsWatchId !== null) navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
  }

  document.getElementById('btnVoltar').addEventListener('click', function () {
    window.location.href = '/';
  });

  document.getElementById('btnTrocar').addEventListener('click', function () {
    api.clearSavedDriverName();
    window.location.href = '/';
  });

  document.getElementById('btnAtualizarAgora').addEventListener('click', function () {
    carregarTudo(false);
  });

  document.getElementById('btnRefresh').addEventListener('click', function () {
    carregarTudo(false);
  });

  sectionsRoot.addEventListener('click', function (event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    handleAction(btn.getAttribute('data-act'), Number(btn.getAttribute('data-row')));
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      carregarTudo(false);
      startGPS();
    } else {
      stopGPS();
    }
  });

  window.addEventListener('beforeunload', function () {
    stopAutoRefresh();
    stopGPS();
  });

  (function init() {
    if (redirectIfNoDriver()) return;
    driverTitle.textContent = state.driver;
    driverNameText.textContent = state.driver;
    carregarTudo(true);
    startAutoRefresh();
    startGPS();
  })();
})();
