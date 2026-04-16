(function () {
  const api = window.AppEntrega;
  const savedDriver = api.getSavedDriverName();

  const state = {
    driver: savedDriver,
    refreshTimer: null,
    gpsWatchId: null,
    lastGpsSend: 0,
    items: [],
    sendingAction: false,
    sendingRouteAction: false,
    rotaIniciada: sessionStorage.getItem('rota_iniciada_' + savedDriver) === '1',
    rotaFinalizada: sessionStorage.getItem('rota_finalizada_' + savedDriver) === '1'
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

    if (raw === null) return null;

    const value = String(raw).trim().replace(',', '.');

    if (!value) {
      alert('A quilometragem é obrigatória.');
      return undefined;
    }

    const num = Number(value);

    if (!Number.isFinite(num) || num < 0) {
      alert('Quilometragem inválida.');
      return undefined;
    }

    return value;
  }

  function pedirFotoObrigatoria() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'environment';

      input.addEventListener('change', async function () {
        const file = input.files && input.files[0];

        if (!file) {
          resolve(null);
          return;
        }

        try {
          const result = await compressImageToBase64(file, 200, 0.1);
          resolve(result);
        } catch (error) {
          console.error(error);
          alert('Não foi possível preparar a foto.');
          resolve(null);
        }
      });

      input.click();
    });
  }

  function renderEntregaCard(item) {
    const key = api.statusKey(item.status);
    const badgeClass = key === 'done' ? 'ok' : key === 'fail' ? 'fail' : key === 'start' ? 'warn' : '';
    const obsPedido = String(item.observacaoPedido || '').trim();

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

function renderList() {
    const resumo = api.gerarResumoEntregas(state.items);
    refreshInfo.textContent = `Total: ${resumo.total} • Em rota: ${resumo.emRota} • Entregues: ${state.items.filter((x) => api.statusKey(x.status) === 'done').length} • Não entregues: ${state.items.filter((x) => api.statusKey(x.status) === 'fail').length}`;

    if (!state.rotaIniciada) {
      sectionsRoot.innerHTML = '<div class="empty-box">Clique em "Iniciar entregas" para ver a lista de entregas.</div>';
      sectionsRoot.classList.remove('hidden');
      return;
    }

    sectionsRoot.innerHTML = `
      <section class="section-card">
        <div class="delivery-list">
          ${state.items.map(renderEntregaCard).join('')}
        </div>
      </section>
    `;

    sectionsRoot.classList.remove('hidden');
  }

  async function carregarTudo(showSkeleton) {
    if (showSkeleton) setLoading(true);
    errorBox.classList.add('hidden');

    try {
      const result = await api.carregarEntregasPorEntregador(state.driver);
      state.items = result.data || [];
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

    const km = pedirKm('Digite a quilometragem inicial do carro:');
    if (km === null || km === undefined) return;

    const foto = await pedirFotoObrigatoria();
    if (!foto) {
      alert('A foto é obrigatória para iniciar as entregas.');
      return;
    }

    state.sendingRouteAction = true;

    try {
      const res = await api.apiIniciarRota(state.driver, km, foto.base64, foto.mimeType);

      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Falha ao iniciar rota');
      }

      state.rotaIniciada = true;
      state.rotaFinalizada = false;
      sessionStorage.setItem('rota_iniciada_' + state.driver, '1');
      sessionStorage.removeItem('rota_finalizada_' + state.driver);

      await carregarTudo(false);
      alert('Rota iniciada com sucesso.');
} catch (error) {
      console.error(error);
      // Mesmo com erro no servidor, libera o entregador para trabalhar
      state.rotaIniciada = true;
      state.rotaFinalizada = false;
      sessionStorage.setItem('rota_iniciada_' + state.driver, '1');
      sessionStorage.removeItem('rota_finalizada_' + state.driver);
      await carregarTudo(false);
      alert('Rota iniciada. Houve um problema ao registrar no servidor, mas você já pode fazer as entregas.');
    } finally {
      state.sendingRouteAction = false;
    }
  }

  async function handleFinalizarRota() {
    if (state.sendingRouteAction) return;

    if (!state.rotaIniciada) {
      alert('Clique primeiro em "Iniciar entregas".');
      return;
    }

    const km = pedirKm('Digite a quilometragem final do carro:');
    if (km === null || km === undefined) return;

    const foto = await pedirFotoObrigatoria();
    if (!foto) {
      alert('A foto é obrigatória para finalizar a rota.');
      return;
    }

    state.sendingRouteAction = true;

    try {
      const res = await api.apiFinalizarRota(state.driver, km, foto.base64, foto.mimeType);

      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Falha ao finalizar rota');
      }

      state.rotaFinalizada = true;
      state.rotaIniciada = false;
      sessionStorage.setItem('rota_finalizada_' + state.driver, '1');
      sessionStorage.removeItem('rota_iniciada_' + state.driver);

      await carregarTudo(false);
      alert('Rota finalizada com sucesso.');
    } catch (error) {
      console.error(error);
      alert('Não foi possível finalizar a rota.');
    } finally {
      state.sendingRouteAction = false;
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

    if (act === 'maps') {
      try {
        if (api.statusKey(item.status) !== 'start') {
          const previous = updateLocalStatus(row, 'Indo para entrega');
          const res = await api.apiIniciarEntrega(row);
          if (!res || !res.ok) {
            restoreLocalItem(row, previous);
            throw new Error('Falha ao iniciar');
          }
        }

        openSameTab(api.buildMapsUrl(item));
      } catch (error) {
        console.error(error);
        alert('Não foi possível iniciar e abrir o Maps.');
      }
      return;
    }

    if (act === 'waze') {
      try {
        if (api.statusKey(item.status) !== 'start') {
          const previous = updateLocalStatus(row, 'Indo para entrega');
          const res = await api.apiIniciarEntrega(row);
          if (!res || !res.ok) {
            restoreLocalItem(row, previous);
            throw new Error('Falha ao iniciar');
          }
        }

        openSameTab(api.buildWazeUrl(item));
      } catch (error) {
        console.error(error);
        alert('Não foi possível iniciar e abrir o Waze.');
      }
      return;
    }

    if (act === 'whats') {
      try {
        await api.abrirWhatsapp(row);
      } catch (error) {
        console.error(error);
        alert('Não foi possível abrir o WhatsApp.');
      }
      return;
    }

    state.sendingAction = true;
    let previous = null;

    try {
      if (act === 'start') {
        previous = updateLocalStatus(row, 'Indo para entrega');
        const res = await api.apiIniciarEntrega(row);
        if (!res || !res.ok) throw new Error('Falha ao iniciar');
      } else if (act === 'done') {
        const obs = prompt('Observação da entrega:') || '';
        previous = updateLocalStatus(row, 'Entregue', obs);
        const res = await api.apiMarcarEntregue(row, obs);
        if (!res || !res.ok) throw new Error('Falha ao concluir');
      } else if (act === 'fail') {
        const obs = prompt('Motivo / observação:') || '';
        previous = updateLocalStatus(row, 'Não entregue', obs);
        const res = await api.apiMarcarNaoEntregue(row, obs);
        if (!res || !res.ok) throw new Error('Falha ao marcar não entregue');
      }

      window.setTimeout(function () {
        carregarTudo(false);
      }, 800);
    } catch (error) {
      console.error(error);
      restoreLocalItem(row, previous);
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
    sessionStorage.removeItem('rota_iniciada_' + state.driver);
    sessionStorage.removeItem('rota_finalizada_' + state.driver);
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