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

  let _indo = false; // dois toques no nome não abrem dois PINs
  async function goToEntregas(nome, jaPediuDeNovo) {
    nome = String(nome || '').trim();
    if (!nome) return;
    if (_indo && !jaPediuDeNovo) return;
    _indo = true;
    try { await entrar(nome, jaPediuDeNovo); } finally { _indo = false; }
  }
  async function entrar(nome, jaPediuDeNovo) {
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
    // 06/10/2026: o aparelho guarda o token de CADA entregador (core.js) — quem já entrou neste celular volta sem PIN,
    // mesmo depois de outro ter usado o app. O PIN só é pedido para quem ainda não tem token aqui.
    if (!api.temToken(nome)) {
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
    // (revisão independente de 06/10, M3) o turno NÃO é fixado aqui: só no toque do botão do turno ou no INICIAR da rota
    // (page-entregas.js). Fixar na entrada prendia o motorista da tarde que abriu o app às 11h na rota da MANHÃ.
    // A rota DESTE entregador já começou hoje (confirmado pelo servidor e lembrado no aparelho): entra direto, sem esperar
    // a rede — a tela de entregas confere o resto sozinha. Era mais uma espera de rede entre o dedo e a rota.
    if (api.inicioConfirmado && api.inicioConfirmado(nome)) { window.location.href = '/entregas/'; return; }
    try {
      // 20/10/2026: montagem pendente = quadro "Aguardando a montagem" com o que falta; abre sozinho quando ficar 100% (core.js).
      await (api.verificarMontagemEsperando || api.verificarMontagem)(nome);
      window.location.href = '/entregas/';
    } catch (e) {
      // LOGIN recusado (token inválido/ausente): o token já foi apagado pelo core, então basta o
      // entregador tocar no nome de novo que o PIN é pedido. O título diz isso — antes vinha como
      // "Montagem da rota" e a equipe procurava pendência de montagem em vez do PIN.
      if (e && e.precisaLogin) {
        // O token deste entregador já foi apagado pelo core (o servidor disse que não vale). Em vez de mandar tocar no
        // nome de novo, pede o PIN AQUI MESMO, uma vez (06/10/2026 — era mais um "faz tudo de novo").
        if (!jaPediuDeNovo) {
          await AppUI.alerta('Seu acesso neste aparelho expirou. Digite seu PIN de novo (os últimos 4 números do seu telefone).', { titulo: 'Precisa entrar de novo', tom: 'warn' });
          return entrar(nome, true);
        }
        await AppUI.alerta(e.message + '\n\nToque no seu nome de novo e digite seu PIN (os últimos 4 números do seu telefone).', { titulo: 'Precisa entrar de novo', tom: 'warn' });
        return;
      }
      if (e && e.esperaCancelada) return; // saiu da espera tocando em Voltar
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

  // ⛔ 06/10/2026 — "O ENTREGADOR FECHA O APP SEM QUERER E AO ABRIR TEM QUE FAZER TUDO DE NOVO" (queixa do dono).
  // O .apk sempre abre aqui (`/`), e no painel esta tela NUNCA pulava: a cada reabertura era escolher o turno, achar o
  // nome na lista, esperar a conferência da montagem… com a mercadoria no carro. Agora: se este aparelho já tem
  // entregador escolhido, com o token DELE, e o turno de HOJE já foi escolhido, volta DIRETO para a rota (sem rede).
  // "Trocar turno"/"Trocar entregador" chegam aqui com ?escolher=1 e aí a tela fica, como sempre.
  // ⛔ (revisão independente de 06/10, M3) só reabre direto o que é claramente "a rota em andamento DESTE aparelho": a rota começou
  // hoje neste turno (confirmado pelo servidor), não foi finalizada, e o app foi usado nas últimas 3 h. Celular passado para outro
  // entregador depois do turno, rota que acabou, ou o escape de emergência (?planilha=1 / ?painel=0) → a tela de escolha, como
  // sempre.
  // ⚠️ 28/10/2026: a MESMA regra roda antes, no <head> do index.html (sem esperar os 7 scripts) — a régua
  // scripts/test-leva2-abertura.mjs confere que as duas decidem igual. Mexeu aqui, mexa lá.
  function retomarSePuder() {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('escolher') === '1') return false;
      const saved = api.getSavedDriverName();
      if (!saved || !api.temToken(saved) || !api.turnoEscolhidoHoje()) return false;
      if (!api.inicioConfirmado(saved) || api.fimConfirmado(saved)) return false;
      if (!api.atividadeRecente(saved, 3 * 3600 * 1000)) return false;
      window.location.replace('/entregas/');
      return true;
    } catch (e) { return false; }
  }

  // ⭐ (revisão independente de 06/10, M5) marcações de OUTRO entregador presas neste aparelho por falta do PIN dele: avisa com o
  // nome, para ele tocar no nome e digitar o PIN — aí elas sobem sozinhas.
  async function avisarFilaPresa() {
    try {
      await api.filaPronta();
      const presas = api.filaPresaDeOutros();
      if (!presas.length) return;
      const box = document.getElementById('savedDriverBox');
      if (!box) return;
      box.textContent = '⚠️ Marcações guardadas neste aparelho esperando o PIN: ' + presas.map(function (x) { return x.nome + ' (' + x.n + ')'; }).join(', ')
        + '. Quem for, toque no seu nome e digite o PIN — elas sobem sozinhas.';
      box.classList.remove('hidden');
    } catch (e) {}
  }

  // ⭐ 28/10/2026 — A HOME TAMBÉM ENVIA. Quem finalizou sem sinal fechava o app achando que "sobe sozinho"; ao reabrir caía aqui, e
  // a home NÃO enviava a fila: as marcações e o KM/foto só subiam quando ele entrasse de novo na rota. Agora a home dispara o envio
  // ao abrir (sem esperar nada) e mostra quantos envios ainda estão só neste aparelho, atualizando enquanto sobem.
  // Devolve quantos envios ADIANTA tentar agora (os que esperam o PIN não contam).
  function pintarEnviosPendentes() {
    try {
      let box = document.getElementById('enviosPendentesBox');
      const c = api.contarEnviosPendentes ? api.contarEnviosPendentes() : null;
      const n = c && c.conhecida ? c.total : 0;
      if (!n) { if (box) box.classList.add('hidden'); return n; }
      if (!box) {
        box = document.createElement('div');
        box.id = 'enviosPendentesBox';
        box.className = 'warning-box';
        listEl.parentNode.insertBefore(box, listEl.parentNode.firstChild);
      }
      // ⛔ (revisão da leva 2) sem o token do entregador (o servidor pediu o PIN de novo e o token foi apagado), o que falta só sobe
      // depois do PIN: o aviso diz isso (antes falava em internet) e a home não fica tentando à toa.
      const semPin = Math.min(n, Number(c.semToken) || 0);
      box.textContent = semPin
        ? '🔑 ' + (semPin === 1 ? '1 envio deste aparelho espera' : semPin + ' envios deste aparelho esperam') + ' o seu PIN. Toque no seu nome e digite o PIN (os últimos 4 números do seu telefone): aí ' + (semPin === 1 ? 'ele sobe.' : 'eles sobem.')
          + (n > semPin ? ' Os outros ' + (n - semPin) + ' sobem com o app aberto e internet.' : '')
        : '⏳ Faltam ' + n + (n === 1 ? ' envio' : ' envios') + ' deste aparelho (entregas, pagamento ou KM/foto). Deixe o app aberto com internet até este aviso sumir.';
      box.classList.remove('hidden');
      return n - semPin;
    } catch (e) { return 0; }
  }
  // ⛔ 28/10/2026 (revisão da leva 2) — a home tentava UMA vez: sem sinal naquela hora, nada mais subia até o entregador entrar na
  // rota. Agora tenta de novo quando a internet volta (`online`), quando a tela volta a aparecer e a cada ~30 s enquanto houver
  // pendente — e para quando esvazia. Uma tentativa de cada vez (`processarFila` já não sobrepõe).
  const REPETIR_HOME_MS = 30000;
  let _repetirHome = null;
  function tentarEnviarDaHome() {
    if (_repetirHome) { window.clearTimeout(_repetirHome); _repetirHome = null; }
    if (document.visibilityState === 'hidden') return; // volta pelo visibilitychange
    const depois = function () {
      const n = pintarEnviosPendentes();
      if (n > 0) _repetirHome = window.setTimeout(tentarEnviarDaHome, REPETIR_HOME_MS);
    };
    if (!pintarEnviosPendentes()) return; // nada a mandar, ou tudo esperando o PIN: tentar não adianta (sem o token, o servidor recusa)
    try { api.processarFila().then(depois, depois); } catch (e) { depois(); }
  }
  async function enviarPendentesDaHome() {
    try {
      await api.filaPronta();
      pintarEnviosPendentes();
      window.addEventListener('fila-entregas-mudou', pintarEnviosPendentes);
      window.addEventListener('online', tentarEnviarDaHome);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') tentarEnviarDaHome(); });
      tentarEnviarDaHome();
    } catch (e) {}
  }

  async function init() {
    try {
      renderTurno();
      const saved = api.getSavedDriverName();
      if (saved) {
        savedDriverBox.classList.add('hidden');
      }
      avisarFilaPresa();

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

  if (!retomarSePuder()) { enviarPendentesDaHome(); init(); }
})();
