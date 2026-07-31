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

  async function goToEntregas(nome) {
    nome = String(nome || '').trim();
    if (!nome) return;
    // TODO MUNDO pede PIN — inclusive "Entregas CD" e "Lala N". Antes esses nomes pulavam o PIN
    // (não são pessoas, não têm telefone no cadastro). Isso funcionava enquanto o porteiro do painel
    // estava em `observa`; quando virou `enforce` eles ficaram TRANCADOS: sem PIN não sai token, e
    // sem token o servidor recusa tudo. O PIN deles é o OPERACIONAL, guardado no cofre do painel —
    // o escritório passa. (Pessoa de verdade continua usando os últimos 4 do telefone dela.)
    // Device-bind: se este aparelho já logou com ESTE entregador, entra direto (sem PIN).
    var ti = (api.getDriverTokenInfo && api.getDriverTokenInfo()) || null;
    while (!(ti && ti.nome === nome)) {
      // 1º acesso deste entregador neste aparelho → pede o PIN.
      var pin = await AppUI.perguntar('Digite seu PIN\n(os últimos 4 números do seu telefone)', {
        titulo: 'Entrar — ' + nome, inputmode: 'numeric', textoOk: 'Entrar'
      });
      if (pin == null) return; // cancelou → volta pra lista de nomes (NÃO entra sem acesso)

      var r = null, semResposta = false;
      try { r = await api.apiLogin(nome, String(pin).replace(/\D/g, '')); } catch (e) { semResposta = true; }
      if (r && r.ok && r.token) { api.saveDriverToken(r.token, nome); break; } // entrou

      // O texto antigo ("você entrou assim mesmo") era da fase de TESTES, quando o porteiro deixava
      // passar sem token. Hoje ele NÃO deixa: entrar sem token = app quebrado com erro genérico em
      // toda tela. Então uma recusa EXPLÍCITA do servidor barra e pergunta de novo...
      if (!semResposta && r) { await AppUI.alerta(r.erro || 'PIN incorreto. São os últimos 4 números do seu telefone.', { titulo: 'Não deu pra entrar', tom: 'warn' }); continue; }

      // ...mas se o sistema não respondeu (sem sinal), não dá pra saber se o PIN estava certo —
      // e ficar sem internet não pode virar porta trancada. Deixa entrar; as telas seguintes avisam
      // se faltar acesso.
      await AppUI.alerta('Não consegui falar com o sistema agora — você entrou assim mesmo. Se as telas pedirem acesso, confira a internet e entre de novo.', { tom: 'warn' });
      break;
    }
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
