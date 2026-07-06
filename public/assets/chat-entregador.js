// Chat do ENTREGADOR com a Central (o pessoal do LOGÍSTICA). 🔔 no topo + painel + responder + polling.
// Fala com a ponte do painel: action=mensagens (ler, ?apos=id) / action=enviarMensagem (escrever).
// Autocontido: só depende de window.AppEntrega (apiGet, getSavedDriverName) e AppUI (alertas).
(function () {
  var api = window.AppEntrega;
  if (!api || !api.getSavedDriverName) return;
  var driver = api.getSavedDriverName();
  if (!driver) return;

  var POLL_MS = 15000;
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
    '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:#fff;max-width:600px;margin:0 auto;">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;background:#2d7a3e;color:#fff;">' +
        '<strong style="flex:1;font-size:16px;">💬 Mensagens da Central</strong>' +
        '<button type="button" id="chatEntFechar" style="background:none;border:0;color:#fff;font-size:26px;cursor:pointer;line-height:1;">×</button>' +
      '</div>' +
      '<div id="chatEntLista" style="flex:1;overflow-y:auto;padding:12px;background:#f3f3f0;"></div>' +
      '<div style="display:flex;gap:8px;padding:10px;border-top:1px solid #ddd;background:#fff;">' +
        '<input id="chatEntInput" type="text" placeholder="Escreva uma mensagem..." autocomplete="off" style="flex:1;padding:12px;border:1px solid #ccc;border-radius:10px;font-size:15px;" />' +
        '<button type="button" id="chatEntEnviar" style="background:#2d7a3e;color:#fff;border:0;border-radius:10px;padding:0 18px;font-size:15px;font-weight:700;cursor:pointer;">Enviar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
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
          '<div style="font-size:15px;white-space:pre-wrap;word-break:break-word;">' + esc(m.corpo) + '</div>' +
        '</div></div>';
    }).join('') || '<div style="text-align:center;color:#888;margin-top:24px;">Nenhuma mensagem ainda.<br>A Central pode te chamar por aqui.</div>';
    listaEl.scrollTop = listaEl.scrollHeight;
  }
  function abrir() {
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

  async function puxar() {
    try {
      var r = await api.apiGet({ action: 'mensagens', entregador: driver, apos: ultimoId }, { retries: 1 });
      if (!r || !r.ok || !Array.isArray(r.mensagens)) { primeiraCarga = false; return; }
      if (r.mensagens.length) {
        for (var i = 0; i < r.mensagens.length; i++) { mensagens.push(r.mensagens[i]); if (r.mensagens[i].id > ultimoId) ultimoId = r.mensagens[i].id; }
        var novaDaCentral = r.mensagens.some(function (m) { return !ehMinha(m); });
        if (aberto) { setLastSeen(ultimoId); render(); }
        pintarBadge();
        if (!aberto && novaDaCentral) {
          try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) {}
          // Pop-up ao ABRIR o app: se há não-lidas na 1ª carga, mostra o painel uma vez.
          if (primeiraCarga && naoLidas() > 0) { abrir(); }
          else if (!primeiraCarga) {
            // App .apk: notificação NATIVA pra ele ver mesmo com o app em segundo plano.
            try {
              if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
                var LN = window.Capacitor.Plugins.LocalNotifications;
                var ult = r.mensagens.filter(function (m) { return !ehMinha(m); }).slice(-1)[0];
                if (LN && LN.schedule && ult) LN.schedule({ notifications: [{ id: (Date.now() % 100000), title: 'Mensagem da Central', body: String(ult.corpo || '').slice(0, 140) }] });
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
