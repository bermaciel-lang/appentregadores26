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
        '<button type="button" id="chatEntAnexo" title="Enviar foto/áudio/arquivo" style="background:#eee;border:0;border-radius:10px;width:44px;height:44px;font-size:19px;cursor:pointer;flex-shrink:0;">📎</button>' +
        '<input type="file" id="chatEntFile" accept="image/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx" style="display:none;" />' +
        '<button type="button" id="chatEntNudge" title="Chamar a atenção" style="background:#ffb300;border:0;border-radius:10px;width:46px;height:44px;font-size:20px;cursor:pointer;flex-shrink:0;">👋</button>' +
        '<button type="button" id="chatEntMic" title="Segure para gravar áudio" style="background:#eef7f0;border:0;border-radius:10px;width:46px;height:44px;font-size:20px;cursor:pointer;flex-shrink:0;touch-action:none;-webkit-user-select:none;user-select:none;">🎤</button>' +
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
  // O Android às vezes manda o áudio SEM o "tipo" (MIME vazio) — aí o arquivo viraria um anexo
  // pra baixar em vez de um player. Pra não perder áudio nunca, a gente também reconhece pela
  // ponta do nome (extensão). Mapa ext -> MIME certo (usado no envio e na exibição).
  var EXT_AUDIO = {
    m4a: 'audio/mp4', mp4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', mpga: 'audio/mpeg',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', weba: 'audio/webm',
    amr: 'audio/amr', '3gp': 'audio/3gpp', '3gpp': 'audio/3gpp', caf: 'audio/x-caf'
  };
  function extDe(nome) { var m = /\.([a-z0-9]+)\s*$/i.exec(String(nome || '')); return m ? m[1].toLowerCase() : ''; }
  function mimeAudioPorNome(nome) { return EXT_AUDIO[extDe(nome)] || ''; }
  function ehAudio(tipo, nome) { return String(tipo || '').indexOf('audio/') === 0 || !!mimeAudioPorNome(nome); }

  function renderAnexo(m) {
    var a = m && m.anexo; if (!a || !a.url) return '';
    var t = String(a.tipo || ''), u = esc(a.url);
    if (t.indexOf('image/') === 0) return '<a href="' + u + '" target="_blank" rel="noopener"><img src="' + u + '" style="max-width:200px;max-height:230px;border-radius:8px;display:block;margin-top:4px;" /></a>';
    if (ehAudio(t, a.nome)) return '<audio controls preload="metadata" src="' + u + '" style="max-width:230px;margin-top:4px;"></audio>';
    return '<a href="' + u + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;color:#2d7a3e;font-weight:700;">📎 ' + esc(a.nome || 'arquivo') + '</a>';
  }
  function render() {
    listaEl.innerHTML = mensagens.map(function (m) {
      var minha = ehMinha(m);
      var corpoHtml = ehNudge(m) ? '<div style="font-size:15px;">⚡ <b>Chamou a atenção!</b></div>'
        : (m.corpo ? '<div style="font-size:15px;white-space:pre-wrap;word-break:break-word;">' + esc(m.corpo) + '</div>' : '');
      return '<div style="display:flex;justify-content:' + (minha ? 'flex-end' : 'flex-start') + ';margin-bottom:8px;">' +
        '<div style="max-width:82%;background:' + (minha ? '#dcf8c6' : '#fff') + ';border-radius:12px;padding:8px 10px;box-shadow:0 1px 1px rgba(0,0,0,.12);">' +
          '<div style="font-size:11px;color:#2d7a3e;font-weight:700;margin-bottom:2px;">' + esc(nomeAutor(m)) + '</div>' +
          corpoHtml + renderAnexo(m) +
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
      var agora = Date.now(), last = Number(localStorage.getItem('chat_nudge_last') || 0) || 0;
      var faltam = 5 * 60000 - (agora - last);
      if (faltam > 0) { await AppUI.alerta('Você já chamou a atenção faz pouco. Espere ' + Math.ceil(faltam / 60000) + ' min pra chamar de novo.'); return; }
      localStorage.setItem('chat_nudge_last', String(agora));
      var r = await api.apiGet({ action: 'enviarMensagem', entregador: driver, corpo: NUDGE }, { retries: 2 });
      if (r && r.ok && r.mensagem) { mensagens.push(r.mensagem); if (r.mensagem.id > ultimoId) ultimoId = r.mensagem.id; setLastSeen(ultimoId); if (aberto) render(); }
    } catch (e) {}
  }
  overlay.querySelector('#chatEntNudge').addEventListener('click', enviarNudge);

  // Enviar ANEXO (foto/áudio/arquivo): lê como base64 e manda pela ponte (POST, não querystring).
  var fileEl = overlay.querySelector('#chatEntFile'), anexoEl = overlay.querySelector('#chatEntAnexo');
  anexoEl.addEventListener('click', function () { fileEl.click(); });
  fileEl.addEventListener('change', function () { var f = fileEl.files && fileEl.files[0]; fileEl.value = ''; if (f) enviarArquivo(f); });
  async function enviarArquivo(file, btnFb) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { await AppUI.alerta('Arquivo muito grande (máximo 8 MB).'); return; }
    var fb = btnFb || anexoEl, fbOrig = fb.textContent; // ⏳ no botão que originou (📎 ou 🎤)
    fb.textContent = '⏳';
    try {
      var base64 = await new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result || '')); }; fr.onerror = rej; fr.readAsDataURL(file); });
      var ti = (api.getDriverTokenInfo && api.getDriverTokenInfo()) || null;
      // Tipo do arquivo: usa o que o celular deu; se veio vazio/genérico (comum em áudio gravado no
      // Android), deduz pela extensão do nome — assim o áudio sobe tocável (Content-Type certo).
      var tipoBruto = String(file.type || '');
      var tipo = (tipoBruto && tipoBruto !== 'application/octet-stream') ? tipoBruto
        : (mimeAudioPorNome(file.name) || tipoBruto || 'application/octet-stream');
      var body = { action: 'enviarAnexo', entregador: driver, arquivo: base64, nome: file.name || 'arquivo', tipo: tipo };
      if (ti && ti.token) body.token = ti.token;
      var r = await fetch('/api/painel/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }).then(function (x) { return x.json(); });
      if (r && r.ok && r.mensagem) { mensagens.push(r.mensagem); if (r.mensagem.id > ultimoId) ultimoId = r.mensagem.id; setLastSeen(ultimoId); render(); }
      else await AppUI.alerta('Não consegui enviar o arquivo. Tente de novo.');
    } catch (e) { await AppUI.alerta('Sem conexão pra enviar o arquivo agora.'); }
    fb.textContent = fbOrig;
  }

  // ====== GRAVAR ÁUDIO estilo WhatsApp: SEGURE o 🎤 pra gravar, SOLTE pra enviar, ARRASTE ◀ pra cancelar. ======
  // Usa o microfone do aparelho (getUserMedia + MediaRecorder). No navegador do celular funciona
  // direto; no .apk precisa da permissão RECORD_AUDIO no manifesto (senão o SO nega o microfone).
  (function () {
    var micBtn = overlay.querySelector('#chatEntMic');
    if (!micBtn) return;
    var temGravador = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    if (!temGravador) { micBtn.style.display = 'none'; return; } // navegador velho: some o 🎤, fica o 📎
    // No app (.apk): só mostra o 🎤 quando a flag estiver ligada — senão o .apk ANTIGO (sem a
    // permissão RECORD_AUDIO) mostraria um microfone que o SO nega. No navegador, sempre disponível.
    var cfgAudio = window.APP_CONFIG || {};
    var nativoApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (nativoApp && cfgAudio.GRAVAR_AUDIO_ATIVO !== true) { micBtn.style.display = 'none'; return; }

    var MIN_MS = 600;          // toque rápido sem querer → descarta
    var MAX_MS = 2 * 60000;    // teto de 2 min (não estourar o limite de 8 MB)
    var CANCEL_DX = -70;       // arrastar 70px pra esquerda = cancelar

    var stream = null, rec = null, chunks = [], t0 = 0, timer = null;
    var gravando = false, segurando = false, cancelar = false, ocupado = false, x0 = 0;
    var barra = null;

    function ehNativo() { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } }
    function escolherMime() {
      var cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
      for (var i = 0; i < cands.length; i++) { try { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {} }
      return '';
    }
    function extDoMime(m) { m = m || ''; return m.indexOf('webm') >= 0 ? 'webm' : (m.indexOf('mp4') >= 0 || m.indexOf('aac') >= 0) ? 'm4a' : m.indexOf('ogg') >= 0 ? 'ogg' : 'webm'; }
    function pararStream() { try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} stream = null; }

    function mostrarBarra() {
      if (barra) return;
      var modal = overlay.querySelector('#chatEntModal'); if (modal && !modal.style.position) modal.style.position = 'relative';
      barra = document.createElement('div');
      barra.style.cssText = 'position:absolute;left:8px;right:8px;bottom:8px;height:60px;z-index:20;display:flex;align-items:center;gap:10px;padding:0 14px;background:#2d7a3e;color:#fff;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.35);font-weight:700;';
      barra.innerHTML =
        '<span style="width:14px;height:14px;border-radius:50%;background:#ff5252;animation:micPulse 1s infinite;flex-shrink:0;"></span>' +
        '<span id="micTempo" style="font-variant-numeric:tabular-nums;min-width:42px;">0:00</span>' +
        '<span id="micDica" style="flex:1;font-weight:600;opacity:.95;font-size:14px;">◀ arraste para cancelar</span>' +
        '<span style="font-weight:800;font-size:14px;white-space:nowrap;">solte p/ enviar</span>';
      (modal || overlay).appendChild(barra);
    }
    function tirarBarra() { if (barra) { try { barra.remove(); } catch (e) {} barra = null; } }
    function pintarCancelar(on) {
      if (!barra) return;
      barra.style.background = on ? '#c62828' : '#2d7a3e';
      var d = barra.querySelector('#micDica'); if (d) d.textContent = on ? '🗑️ solte para CANCELAR' : '◀ arraste para cancelar';
    }
    function tick() {
      if (!barra) return;
      var s = Math.floor((Date.now() - t0) / 1000), el = barra.querySelector('#micTempo');
      if (el) el.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
      if (Date.now() - t0 >= MAX_MS) parar(); // teto → envia o que já gravou
    }
    function iniciarTick() { pararTick(); tick(); timer = setInterval(tick, 250); }
    function pararTick() { if (timer) { clearInterval(timer); timer = null; } }

    async function comecar(ev) {
      if (ocupado) return;
      ocupado = true; segurando = true; cancelar = false;
      x0 = ev.clientX || 0;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) {
        ocupado = false; segurando = false;
        AppUI.alerta('Não consegui usar o microfone. ' + (ehNativo() ? 'Talvez precise atualizar o app (nova versão).' : 'Libere o microfone pro site nas permissões do navegador.'));
        return;
      }
      if (!segurando) { pararStream(); ocupado = false; return; } // soltou antes do microfone liberar
      var mime = escolherMime();
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch (e) { try { rec = new MediaRecorder(stream); } catch (e2) { pararStream(); ocupado = false; segurando = false; AppUI.alerta('Este aparelho não deixa gravar áudio por aqui.'); return; } }
      chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        var mimeReal = (rec && rec.mimeType) || mime || 'audio/webm';
        var blob = new Blob(chunks, { type: mimeReal });
        var durou = Date.now() - t0;
        pararStream(); tirarBarra(); pararTick();
        gravando = false; ocupado = false;
        if (cancelar || durou < MIN_MS || !blob.size) {
          if (!cancelar && durou < MIN_MS) AppUI.alerta('Segure o botão do microfone pra gravar o áudio.');
          return; // descarta
        }
        var ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        enviarArquivo(new File([blob], 'voz_' + ts + '.' + extDoMime(mimeReal), { type: mimeReal }), micBtn);
      };
      gravando = true; t0 = Date.now();
      mostrarBarra(); iniciarTick();
      try { if (navigator.vibrate) navigator.vibrate(20); } catch (e) {}
      try { rec.start(); } catch (e) { rec.onstop = null; pararStream(); tirarBarra(); pararTick(); gravando = false; ocupado = false; AppUI.alerta('Não consegui iniciar a gravação.'); }
    }
    function mover(ev) { if (!gravando) return; cancelar = ((ev.clientX || 0) - x0) <= CANCEL_DX; pintarCancelar(cancelar); }
    function parar() {
      segurando = false;
      if (!gravando) return; // ainda esperando o microfone → comecar() vai abortar sozinho
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { pararStream(); tirarBarra(); pararTick(); gravando = false; ocupado = false; }
    }

    micBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); try { micBtn.setPointerCapture(e.pointerId); } catch (er) {} comecar(e); });
    micBtn.addEventListener('pointermove', mover);
    micBtn.addEventListener('pointerup', function (e) { e.preventDefault(); parar(); });
    micBtn.addEventListener('pointercancel', function () { parar(); });
    micBtn.addEventListener('lostpointercapture', function () { if (gravando || segurando) parar(); });
    micBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); }); // segurar não abre menu do sistema
  })();

  // Áudio destravado no 1º toque do usuário (iOS/Safari só tocam som depois de um gesto).
  var _ac = null;
  function destravarAudio() { try { var Ctx = window.AudioContext || window.webkitAudioContext; if (!_ac && Ctx) _ac = new Ctx(); if (_ac && _ac.state === 'suspended') _ac.resume(); } catch (e) {} }
  document.addEventListener('touchstart', destravarAudio, true);
  document.addEventListener('click', destravarAudio, true);
  function bipAtencao() {
    try {
      destravarAudio(); if (!_ac) return;
      var ac = _ac, t0 = ac.currentTime;
      [[0, 988], [0.16, 1319], [0.32, 988], [0.48, 1319], [0.64, 988]].forEach(function (p) {
        var o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = p[1];
        o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.0001, t0 + p[0]); g.gain.exponentialRampToValueAtTime(0.6, t0 + p[0] + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + p[0] + 0.14);
        o.start(t0 + p[0]); o.stop(t0 + p[0] + 0.15);
      });
    } catch (e) {}
  }
  function chamarAtencaoRecebida() {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 300]); } catch (e) {}
    bipAtencao();
    // Banner central que pulsa e some sozinho (sem tela vermelha).
    var el = document.createElement('div');
    el.className = 'nudge-banner-app';
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:#2d7a3e;color:#fff;padding:22px 26px;border-radius:16px;box-shadow:0 14px 44px rgba(0,0,0,.4);text-align:center;font-weight:800;pointer-events:none;max-width:88vw;';
    el.innerHTML = '<div style="font-size:34px;">⚡</div><div style="font-size:18px;margin-top:4px;">CHAMARAM A SUA ATENÇÃO!</div><div style="font-size:14px;opacity:.9;margin-top:2px;font-weight:600;">Verifique o chat</div>';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (e) {} }, 4000);
  }
  (function () {
    var st = document.createElement('style');
    st.textContent = '@keyframes chatTreme{0%,100%{transform:translate(0,0) rotate(0)}8%{transform:translate(-16px,6px) rotate(-1deg)}16%{transform:translate(16px,-6px) rotate(1deg)}24%{transform:translate(-16px,-6px) rotate(-1deg)}32%{transform:translate(16px,6px) rotate(1deg)}40%{transform:translate(-13px,5px)}50%{transform:translate(13px,-5px)}60%{transform:translate(-10px,-4px)}70%{transform:translate(10px,4px)}80%{transform:translate(-6px,2px)}90%{transform:translate(4px,-1px)}}.chat-treme{animation:chatTreme .7s cubic-bezier(.36,.07,.19,.97) 2;}@keyframes nudgeFlash{0%{opacity:0}12%{opacity:.95}26%{opacity:.15}40%{opacity:.95}54%{opacity:.15}68%{opacity:.9}100%{opacity:0}}.nudge-flash{animation:nudgeFlash 2.8s ease-in-out;}@keyframes nudgePulseA{0%{transform:translate(-50%,-50%) scale(.7);opacity:0}15%{transform:translate(-50%,-50%) scale(1.06);opacity:1}25%{transform:translate(-50%,-50%) scale(1)}85%{opacity:1}100%{opacity:0}}.nudge-banner-app{animation:nudgePulseA 4s ease-in-out}@keyframes micPulse{0%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}@media(prefers-reduced-motion:reduce){.chat-treme{animation:none}.nudge-flash{animation:none;opacity:.5}.nudge-banner-app{animation:none}}';
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
