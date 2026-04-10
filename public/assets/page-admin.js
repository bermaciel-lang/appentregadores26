(function () {
  const api = window.AppEntrega;

  function askPassword() {
    if (api.getAdminAuth()) return true;
    const senha = prompt('Digite a senha do admin:');
    if (senha === null) {
      window.location.href = '/';
      return false;
    }
    if (senha !== window.APP_CONFIG.ADMIN_PASSWORD) {
      alert('Senha inválida.');
      window.location.href = '/';
      return false;
    }
    api.setAdminAuth(true);
    return true;
  }

  if (!askPassword()) return;

  const state = {
    map: null,
    markers: [],
    refreshTimer: null
  };

  const statDrivers = document.getElementById('statDrivers');
  const statDone = document.getElementById('statDone');
  const statPending = document.getElementById('statPending');
  const progressRoot = document.getElementById('progressRoot');
  const mapInfo = document.getElementById('mapInfo');
  const lastUpdate = document.getElementById('lastUpdate');
  const warningBox = document.getElementById('warningBox');

  function setWarning(text) {
    if (!text) {
      warningBox.classList.add('hidden');
      warningBox.textContent = '';
      return;
    }
    warningBox.textContent = text;
    warningBox.classList.remove('hidden');
  }

  function ensureMap() {
    if (state.map) return;
    state.map = L.map('map').setView([-19.92, -43.94], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(state.map);
  }

  function clearMarkers() {
    if (!state.map) return;
    state.markers.forEach((marker) => state.map.removeLayer(marker));
    state.markers = [];
  }

  function getEntregaColor(status) {
    const st = String(status || '').trim().toLowerCase();
    if (st === 'entregue') return '#22c55e';
    if (st === 'indo para entrega') return '#f59e0b';
    if (st === 'não entregue' || st === 'nao entregue') return '#ef4444';
    return '#9ca3af';
  }

  function createEntregaIcon(color) {
    return L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:' + color + ';border:2px solid white;box-shadow:0 1px 6px rgba(0,0,0,.25)"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
  }

  function createDriverIcon(nome) {
    const letra = api.avatarLetter(nome);
    return L.divIcon({
      className: '',
      html: '<div style="width:26px;height:26px;border-radius:50%;background:#1d4ed8;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.25)">' + api.esc(letra) + '</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  function renderMap(entregas, entregadores) {
    ensureMap();
    clearMarkers();

    const bounds = [];

    (entregas || []).forEach(function (item) {
      if (item.lat == null || item.lng == null || item.lat === '' || item.lng === '') return;
      const marker = L.marker([Number(item.lat), Number(item.lng)], {
        icon: createEntregaIcon(getEntregaColor(item.status))
      }).addTo(state.map);

      marker.bindPopup(
        '<strong>Cliente: ' + api.esc(item.nome || item.cliente || '-') + '</strong><br>' +
        'Status: ' + api.esc(api.statusLabel(item.status)) + '<br>' +
        'Hora: ' + api.esc(api.formatTime(item.inicio || item.horario || ''))
      );

      state.markers.push(marker);
      bounds.push([Number(item.lat), Number(item.lng)]);
    });

    (entregadores || []).forEach(function (item) {
      if (item.lat == null || item.lng == null || item.lat === '' || item.lng === '') return;
      const marker = L.marker([Number(item.lat), Number(item.lng)], {
        icon: createDriverIcon(item.nome)
      }).addTo(state.map);

      marker.bindPopup(
        '<strong>Entregador: ' + api.esc(item.nome || '-') + '</strong><br>' +
        'Início: ' + api.esc(String(item.inicio || '-')) + '<br>' +
        'Fim: ' + api.esc(String(item.fim || '-'))
      );

      state.markers.push(marker);
      bounds.push([Number(item.lat), Number(item.lng)]);
    });

    if (bounds.length) {
      state.map.fitBounds(bounds, { padding: [30, 30] });
      mapInfo.textContent = entregas.length + ' entrega(s) + ' + entregadores.length + ' entregador(es).';
    } else {
      mapInfo.textContent = 'Sem coordenadas disponíveis no momento.';
    }
  }

  function renderProgress(entregadores) {
    progressRoot.innerHTML = (entregadores || []).map(function (item) {
      const total = Number(item.total || item.entregasTotais || 0);
      const realizadas = Number(item.realizadas || item.entregasRealizadas || 0);
      const percent = total ? Math.round((realizadas / total) * 100) : 0;
      const gpsText = (item.lat != null && item.lng != null && item.lat !== '' && item.lng !== '') ? 'GPS disponível' : 'Sem GPS';

      return `
        <article class="driver-progress-item">
          <div class="progress-head">
            <div>
              <div class="progress-name">${api.esc(item.nome)}</div>
              <div class="small-muted">${realizadas} de ${total} realizadas • ${gpsText}</div>
            </div>
            <strong>${percent}%</strong>
          </div>
          <div class="progress-bar"><span style="width:${percent}%"></span></div>
        </article>
      `;
    }).join('');
  }

  async function carregarPainel() {
    lastUpdate.textContent = 'Atualizando...';

    try {
      const result = await api.carregarAdminPainel();
      const res = result.data || {};
      const entregadores = res.entregadores || [];
      const entregas = res.entregas || [];

      const concluidas = entregas.filter((e) => String(e.status || '').trim().toLowerCase() === 'entregue').length;
      const pendentesOuRota = entregas.filter((e) => String(e.status || '').trim().toLowerCase() !== 'entregue').length;

      statDrivers.textContent = String(entregadores.length);
      statDone.textContent = String(concluidas);
      statPending.textContent = String(pendentesOuRota);

      renderMap(entregas, entregadores);
      renderProgress(entregadores);
      lastUpdate.textContent = 'Atualizado em ' + new Date().toLocaleString('pt-BR');

      if (result.stale) {
        setWarning('O painel abriu pelo último cache salvo. A internet ou a API podem ter falhado agora.');
      } else {
        setWarning('');
      }
    } catch (error) {
      console.error(error);
      lastUpdate.textContent = 'Erro ao carregar painel';
      mapInfo.textContent = 'Não foi possível carregar o mapa.';
      progressRoot.innerHTML = '<div class="empty-box">Não foi possível carregar o painel.</div>';
    }
  }

  function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function () {
      if (document.visibilityState === 'visible') carregarPainel();
    }, window.APP_CONFIG.REFRESH_INTERVAL_MS);
  }

  document.getElementById('btnVoltar').addEventListener('click', function () {
    window.location.href = '/';
  });

  document.getElementById('btnRefresh').addEventListener('click', function () {
    carregarPainel();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') carregarPainel();
  });

  carregarPainel();
  startAutoRefresh();
})();
