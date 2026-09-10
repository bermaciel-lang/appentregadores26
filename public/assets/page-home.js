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
    // MODO TOLERANTE (03/08): enquanto arrumamos os telefones/PINs do cadastro, NINGUÉM fica
    // trancado. Ainda pedimos o PIN (best-effort: acertou → guarda o token do aparelho e da próxima
    // entra direto), mas ERRAR / CANCELAR / ficar sem sinal NÃO barra mais — entra assim mesmo.
    // Device-bind: quem já logou nesse aparelho entra direto, sem repetir o PIN.
    //
    // ⚠️ LALA / CD TAMBÉM PEDEM PIN (26/08). Elas não são pessoas e não têm telefone, então o PIN
    // delas é o PIN OPERACIONAL que o escritório define (cofre ENTREGADOR_PIN_OPERACIONAL, no
    // painel). Antes o app PULAVA o PIN pra esses nomes — e, com o porteiro do painel em `enforce`,
    // isso virou porta trancada: sem PIN não sai token, sem token o servidor recusa a rota
    // ("Faça login com o PIN pra abrir a rota") e não havia lugar NENHUM pra digitar o PIN.
    var ehOperacional = /lala|\bcd\b/i.test(nome);
    var ti = (api.getDriverTokenInfo && api.getDriverTokenInfo()) || null;
    if (!(ti && ti.nome === nome)) {
      var pin = await AppUI.perguntar(
        ehOperacional
          ? 'Digite o PIN da operação\n(o PIN das rotas de Lalamove / CD — o escritório informa)'
          : 'Digite seu PIN\n(os últimos 4 números do seu telefone)',
        { titulo: 'Entrar — ' + nome, inputmode: 'numeric', textoOk: 'Entrar' }
      );
      if (pin != null) {
        // best-effort: só pra GANHAR o token quando o PIN estiver certo. Errou/sem sinal → segue e entra.
        // Mas se o servidor RECUSOU com um motivo, mostra o motivo — antes a pessoa entrava e via só
        // uma tela vazia, sem saber que o PIN é que estava errado.
        try {
          var r = await api.apiLogin(nome, String(pin).replace(/\D/g, ''));
          if (r && r.ok && r.token) api.saveDriverToken(r.token, nome);
          else if (r && r.erro) await AppUI.alerta(String(r.erro) + '\n\nVou abrir mesmo assim, mas se a lista vier vazia é isto: volte e digite o PIN certo.', { titulo: 'PIN não aceito', tom: 'warn' });
        } catch (e) { /* sem sinal → entra assim mesmo */ }
      }
    }
    api.saveDriverName(nome);
    try {
      await api.verificarMontagem(nome);
      window.location.href = '/entregas/';
    } catch (e) {
      // LOGIN recusado (token inválido/ausente): o token já foi apagado pelo core, então basta o
      // entregador tocar no nome de novo que o PIN é pedido. O título diz isso — antes vinha como
      // "Montagem da rota" e a equipe procurava pendência de montagem em vez do PIN.
      if (e && e.precisaLogin) {
        await AppUI.alerta(e.message + '\n\nToque no seu nome de novo e digite seu PIN (os últimos 4 números do seu telefone).', { titulo: 'Precisa entrar de novo', tom: 'warn' });
        return;
      }
      const detalhes = (e.pendentes || []).map(p => p.cliente + ' · ' + p.pedido + ' (' + p.tipo + ')').join('\n');
      await AppUI.alerta(e.message + (detalhes ? '\n\nPendentes:\n' + detalhes : ''), { titulo: 'Montagem da rota', tom: 'warn' });
    }
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
