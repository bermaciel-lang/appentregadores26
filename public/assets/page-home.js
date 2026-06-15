(function () {
  const api = window.AppEntrega;
  const loadingEl = document.getElementById('loadingList');
  const listEl = document.getElementById('driverList');
  const errorEl = document.getElementById('errorBox');
  const savedDriverBox = document.getElementById('savedDriverBox');
  const warningBox = document.getElementById('warningBox');

  function showWarning(text) {
    warningBox.textContent = text;
    warningBox.classList.remove('hidden');
  }

  function hideWarning() {
    warningBox.classList.add('hidden');
    warningBox.textContent = '';
  }

  function goToEntregas(nome) {
    api.saveDriverName(nome);
    window.location.href = '/entregas/';
  }

  // Seletor de turno (MANHÃ/TARDE) — só no backend do painel (Supabase), onde os dois
  // turnos coexistem. O entregador escolhe antes de entrar; troca recarrega a lista.
  function renderTurno() {
    if (!api.usandoPainel || !api.usandoPainel()) return;
    let bar = document.getElementById('turnoBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'turnoBar';
      bar.style.cssText = 'display:flex;gap:8px;margin:12px 0;';
      listEl.parentNode.insertBefore(bar, listEl);
    }
    const atual = api.getTurno();
    bar.innerHTML = ['MANHÃ', 'TARDE'].map(function (t) {
      const on = t === atual;
      return '<button type="button" data-turno="' + t + '" style="flex:1;padding:12px;border-radius:10px;border:2px solid ' +
        (on ? '#16a34a' : '#ccc') + ';background:' + (on ? '#16a34a' : '#fff') + ';color:' + (on ? '#fff' : '#333') +
        ';font-weight:700;font-size:16px;cursor:pointer;">' + (t === 'MANHÃ' ? '🌅 Manhã' : '🌇 Tarde') + '</button>';
    }).join('');
    bar.querySelectorAll('[data-turno]').forEach(function (b) {
      b.addEventListener('click', function () { api.setTurno(b.getAttribute('data-turno')); init(); });
    });
  }

  function renderDrivers(items) {
    loadingEl.classList.add('hidden');
    listEl.classList.remove('hidden');
    listEl.innerHTML = (items || []).map((nome) => `
      <button class="driver-item" type="button" data-driver="${api.esc(nome)}">
        <div class="driver-main">
          <span class="avatar">${api.esc(api.avatarLetter(nome))}</span>
          <div>
            <div class="driver-name">${api.esc(nome)}</div>
            <div class="driver-subtitle">Toque para entrar nas entregas</div>
          </div>
        </div>
        <span class="chevron">›</span>
      </button>
    `).join('');

    listEl.querySelectorAll('[data-driver]').forEach((btn) => {
      btn.addEventListener('click', function () {
        goToEntregas(btn.getAttribute('data-driver'));
      });
    });
  }

  async function init() {
    try {
      renderTurno();
      const saved = api.getSavedDriverName();
      if (saved) {
        savedDriverBox.classList.add('hidden');
      }

      const result = await api.carregarEntregadores();
      const items = result.data || [];

      if (result.stale) {
        showWarning('A lista abriu pelo último cache salvo. A internet ou a API podem ter falhado agora.');
      } else {
        hideWarning();
      }

      // No backend do painel, NÃO pula direto: o entregador escolhe o turno primeiro.
      if (saved && items.includes(saved) && !(api.usandoPainel && api.usandoPainel())) {
        goToEntregas(saved);
        return;
      }

      renderDrivers(items);
    } catch (error) {
      console.error(error);
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
      errorEl.textContent = 'Não foi possível carregar a lista de entregadores.';
    }
  }

  init();
})();
