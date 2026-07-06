// Chat do ENTREGADOR com a Central (o pessoal do LOGÍSTICA). 🔔 no topo + painel + responder + polling.
// Fala com a ponte do painel: action=mensagens (ler, ?apos=id) / action=enviarMensagem (escrever).
// Autocontido: só depende de window.AppEntrega (apiGet, getSavedDriverName) e AppUI (alertas).
(function () {
  var api = window.AppEntrega;
  if (!api || !api.getSavedDriverName) return;
  var driver = api.getSavedDriverName();
  if (!driver) return;

  var POLL_MS = 8000;
  var LAST_SEEN_KEY = 'app_entregas_chat_lastseen';
  var ultimoId = 0;          // maior id já carregado (base do polling)
  var mensagens = [];        // todas carregadas, em ordem cronológica
  var aberto = false;
  var primeiraCarga = true;

  function lastSeen() { try { return Number(localStorage.getItem(LAST_SEEN_KEY) || 0) || 0; } catch (e) { return 0; } }
  function setLastSeen(id) { try { localStorage.setItem(LAST_SEEN_KEY, String(id || 0)); } catch (e) {} }
  function ehMinha(m) { return String(m.autor || '').indexOf('entregador:') === 0; }
  function nomeAutor(m) { return ehMinha(m) ? 'Você' : (m.autorNome || 'Central'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function naoLidas() { var ls = lastSeen(); return mensagens.filter(function (m) { return m.id > ls && !ehMinha(m); }).length; }

  // ---- Pop-up ao chegar mensagem: card GRANDE no MEIO da tela, FICA até tocar (abre a conversa) ou
  // fechar no X. Não some sozinho. Funciona no iPhone web também. ----
  var toastEl = null;
  function mostrarToast(autor, corpo) {
    try {
      esconderToast(); // substitui um anterior, se houver
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(20,18,14,.45);display:flex;align-items:center;justify-content:center;padding:20px;';
      var card = document.createElement('div');
      card.style.cssText = 'background:#2d7a3e;color:#fff;border-radius:18px;padding:22px 20px 18px;max-width:420px;width:100%;box-shadow:0 14px 44px rgba(0,0,0,.45);position:relative;cursor:pointer;';
      card.innerHTML =
        '<button id="toastX" aria-label="Fechar" style="position:absolute;top:8px;right:10px;background:rgba(255,255,255,.22);border:0;color:#fff;font-size:22px;width:36px;height:36px;border-radius:50%;line-height:1;cursor:pointer;">×</button>' +
        '<div style="font-size:38px;text-align:center;margin-bottom:6px;">💬</div>' +
        '<div style="font-size:15px;font-weight:800;opacity:.95;margin-bottom:4px;">🔔 Mensagem de ' + esc(autor) + '</div>' +
        '<div style="font-size:18px;line-height:1.4;white-space:pre-wrap;word-break:break-word;">' + esc(corpo || '') + '</div>' +
        '<div style="margin-top:16px;text-align:center;background:rgba(255,255,255,.18);border-radius:10px;padding:11px;font-size:15px;font-weight:800;">Toque para abrir e responder</div>';
      card.addEventListener('click', function () { esconderToast(); abrir(); });
      card.querySelector('#toastX').addEventListener('click', function (e) { e.stopPropagation(); esconderToast(); });
      toastEl.appendChild(card);
      document.body.appendChild(toastEl);
    } catch (e) {}
  }
  function esconderToast() { try { if (toastEl) { toastEl.remove(); toastEl = null; } } catch (e) {} }

  // ---- Sininho no topo (com badge de não-lidas) ----
  var bell = document.createElement('button');
  bell.type = 'button'; bell.className = 'icon-btn'; bell.id = 'btnChatEnt'; bell.setAttribute('aria-label', 'Mensagens da Central');
  bell.style.position = 'relative';
  bell.innerHTML = '🔔<span id="chatEntBadge" style="display:none;position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#e53935;color:#fff;font-size:11px;font-weight:800;line-height:18px;text-align:center;box-shadow:0 0 0 2px #fff;">0</span>';
  var right = document.querySelector('.topbar-right');
  if (right) right.insertBefore(bell, right.firstChild); else document.body.appendChild(bell);
  var badgeEl = bell.querySelector('#chatEntBadge');

  // ---- Painel (overlay) ----
  var overlay = document.createElement('div');
  overlay.id = 'chatEntOverlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(20,18,14,.4);z-index:5000;';
  overlay.innerHTML =
    '<div id="chatEntModal" style="position:absolute;top:12px;bottom:12px;left:12px;right:12px;max-width:560px;margin-left:auto;margin-right:auto;display:flex;flex-direction:column;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 14px 44px rgba(0,0,0,.45);">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;background:#2d7a3e;color:#fff;">' +
        '<strong style="flex:1;font-size:16px;">💬 Mensagens da Central</strong>' +
        '<button type="button" id="chatEntFechar" style="background:none;border:0;color:#fff;font-size:26px;cursor:pointer;line-height:1;">×</button>' +
      '</div>' +
      '<div id="chatEntLista" style="flex:1;overflow-y:auto;padding:12px;background:#f3f3f0;"></div>' +
      '<div style="display:flex;gap:8px;padding:10px;border-top:1px solid #ddd;background:#fff;align-items:center;">' +
        '<button type="button" id="chatEntNudge" title="Chamar a atenção" style="background:#ffb300;border:0;border-radius:10px;width:46px;height:44px;font-size:20px;cursor:pointer;flex-shrink:0;">👋</button>' +
        '<input id="chatEntInput" type="text" placeholder="Escreva uma mensagem..." autocomplete="off" style="flex:1;min-width:0;padding:12px;border:1px solid #ccc;border-radius:10px;font-size:15px;" />' +
        '<button type="button" id="chatEntEnviar" style="background:#2d7a3e;color:#fff;border:0;border-radius:10px;padding:0 16px;height:44px;font-size:15px;font-weight:700;cursor:pointer;flex-shrink:0;">Enviar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) fechar(); }); // toca fora do modal = fecha
  var listaEl = overlay.querySelector('#chatEntLista');
  var inputEl = overlay.querySelector('#chatEntInput');

  function pintarBadge() {
    var n = naoLidas();
    badgeEl.textContent = n > 99 ? '99+' : String(n);
    badgeEl.style.display = n > 0 ? 'block' : 'none';
  }
  function render() {
    listaEl.innerHTML = mensagens.map(function (m) {
      var minha = ehMinha(m);
      return '<div style="display:flex;justify-content:' + (minha ? 'flex-end' : 'flex-start') + ';margin-bottom:8px;">' +
        '<div style="max-width:82%;background:' + (minha ? '#dcf8c6' : '#fff') + ';border-radius:12px;padding:8px 10px;box-shadow:0 1px 1px rgba(0,0,0,.12);">' +
          '<div style="font-size:11px;color:#2d7a3e;font-weight:700;margin-bottom:2px;">' + esc(nomeAutor(m)) + '</div>' +
          '<div style="font-size:15px;white-space:pre-wrap;word-break:break-word;">' + (ehNudge(m) ? '⚡ <b>Chamou a atenção!</b>' : esc(m.corpo)) + '</div>' +
        '</div></div>';
    }).join('') || '<div style="text-align:center;color:#888;margin-top:24px;">Nenhuma mensagem ainda.<br>A Central pode te chamar por aqui.</div>';
    listaEl.scrollTop = listaEl.scrollHeight;
  }
  function abrir() {
    esconderToast(); // abriu a conversa (por aqui ou pelo sininho) → fecha o pop-up
    aberto = true; overlay.style.display = 'block';
    if (mensagens.length) setLastSeen(mensagens[mensagens.length - 1].id);
    pintarBadge(); render();
    setTimeout(function () { try { inputEl.focus(); } catch (e) {} }, 120);
  }
  function fechar() { aberto = false; overlay.style.display = 'none'; }

  bell.addEventListener('click', abrir);
  overlay.querySelector('#chatEntFechar').addEventListener('click', fechar);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) fechar(); });

  async function enviar() {
    var texto = String(inputEl.value || '').trim();
    if (!texto) return;
    inputEl.value = '';
    try {
      var r = await api.apiGet({ action: 'enviarMensagem', entregador: driver, corpo: texto }, { retries: 2 });
      if (r && r.ok && r.mensagem) {
        mensagens.push(r.mensagem); if (r.mensagem.id > ultimoId) ultimoId = r.mensagem.id;
        setLastSeen(ultimoId); render(); pintarBadge();
      } else { inputEl.value = texto; await AppUI.alerta('Não consegui enviar. Tente de novo.'); }
    } catch (e) { inputEl.value = texto; await AppUI.alerta('Sem conexão pra enviar agora.'); }
  }
  overlay.querySelector('#chatEntEnviar').addEventListener('click', enviar);
  inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); enviar(); } });

  // ---- "Chamar a atenção" (tipo MSN): um toque faz a tela do outro TREMER + piscar + tocar ----
  var NUDGE = '⚡ Chamou a atenção!'; // a própria frase é o marcador → o painel já mostra bonitinho
  function ehNudge(m) { return m && m.corpo === NUDGE; }
  async function enviarNudge() {
    try {
      var r = await api.apiGet({ action: 'enviarMensagem', entregador: driver, corpo: NUDGE }, { retries: 2 });
      if (r && r.ok && r.mensagem) { mensagens.push(r.mensagem); if (r.mensagem.id > ultimoId) ultimoId = r.mensagem.id; setLastSeen(ultimoId); if (aberto) render(); }
    } catch (e) {}
  }
  overlay.querySelector('#chatEntNudge').addEventListener('click', enviarNudge);
  function bipAtencao() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      var ac = new Ctx();
      [0, 0.18, 0.36].forEach(function (t) {
        var o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = 880;
        o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.15);
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.16);
      });
      setTimeout(function () { try { ac.close(); } catch (e) {} }, 900);
    } catch (e) {}
  }
  function chamarAtencaoRecebida() {
    try { if (navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 120]); } catch (e) {}
    bipAtencao();
    document.body.classList.add('chat-treme');
    setTimeout(function () { document.body.classList.remove('chat-treme'); }, 800);
    mostrarToast('Central', '⚡ Chamou a sua ATENÇÃO!');
  }
  (function () {
    var st = document.createElement('style');
    st.textContent = '@keyframes chatTreme{0%,100%{transform:translate(0,0)}10%{transform:translate(-9px,4px)}20%{transform:translate(9px,-4px)}30%{transform:translate(-9px,-4px)}40%{transform:translate(9px,4px)}50%{transform:translate(-6px,3px)}60%{transform:translate(6px,-3px)}70%{transform:translate(-4px,-2px)}80%{transform:translate(4px,2px)}90%{transform:translate(-2px,1px)}}.chat-treme{animation:chatTreme .8s ease-in-out;}@media(prefers-reduced-motion:reduce){.chat-treme{animation:none}}';
    document.head.appendChild(st);
  })();

  async function puxar() {
    try {
      var r = await api.apiGet({ action: 'mensagens', entregador: driver, apos: ultimoId }, { retries: 1 });
      if (!r || !r.ok || !Array.isArray(r.mensagens)) { primeiraCarga = false; return; }
      if (r.mensagens.length) {
        for (var i = 0; i < r.mensagens.length; i++) { mensagens.push(r.mensagens[i]); if (r.mensagens[i].id > ultimoId) ultimoId = r.mensagens[i].id; }
        var novaDaCentral = r.mensagens.some(function (m) { return !ehMinha(m); });
        if (aberto) { setLastSeen(ultimoId); render(); }
        pintarBadge();
        // "Chamar atenção" recebido da Central → treme/pisca/som (mesmo com o chat aberto). Não na 1ª carga.
        if (!primeiraCarga && r.mensagens.some(function (m) { return !ehMinha(m) && ehNudge(m); })) chamarAtencaoRecebida();
        if (!aberto && novaDaCentral) {
          // POP-UP (banner) pra mensagem NORMAL (nudge já trata no chamarAtencaoRecebida acima).
          var ult = r.mensagens.filter(function (m) { return !ehMinha(m) && !ehNudge(m); }).slice(-1)[0];
          if (ult && (!primeiraCarga || naoLidas() > 0)) {
            try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) {}
            mostrarToast(nomeAutor(ult), ult.corpo);
            try {
              if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
                var LN = window.Capacitor.Plugins.LocalNotifications;
                if (LN && LN.schedule) LN.schedule({ notifications: [{ id: (Date.now() % 100000), title: 'Mensagem da Central', body: String(ult.corpo || '').slice(0, 140) }] });
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) { /* silencioso */ }
    primeiraCarga = false;
  }

  puxar();                       // 1ª carga (pop-up se tiver não-lida)
  setInterval(puxar, POLL_MS);   // e fica escutando
})();
