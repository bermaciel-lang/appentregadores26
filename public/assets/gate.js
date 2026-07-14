// ============================================================================
// PORTEIRO DE PERMISSÕES (gate.js)
// Só deixa o app ABRIR se LOCALIZAÇÃO e NOTIFICAÇÕES estiverem ativadas.
// Enquanto faltar alguma, mostra uma tela cheia por cima explicando, com botões:
//   • "Ativar agora"               → pede a permissão que falta (janela do Android)
//   • "Abrir configurações do app" → atalho pra tela de permissões do celular,
//     usado quando o usuário JÁ negou antes e o Android não pergunta mais.
// Assim que as duas ficam ok (inclusive ao VOLTAR das configurações), a tela some
// sozinha e o app segue normal.
//
// SÓ roda no APP Android (Capacitor). No navegador/iPhone não faz NADA — lá o app
// continua funcionando como sempre (navegador não tem "configurações do app" pra abrir).
// Kill-switch: pôr APP_CONFIG.EXIGIR_PERMISSOES = false no config.js desliga tudo
// (deploy de 1 linha, sem gerar .apk).
// ============================================================================
(function () {
  'use strict';

  var Cap = window.Capacitor;
  var nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  if (!nativo) return; // navegador/iPhone: não gateia

  var cfg = window.APP_CONFIG || {};
  if (cfg.EXIGIR_PERMISSOES === false) return; // desligado por config

  var P = (Cap && Cap.Plugins) || {};
  var Geo = P.Geolocation;              // @capacitor/geolocation
  var Push = P.PushNotifications;       // @capacitor/push-notifications
  var BG = P.BackgroundGeolocation;     // @capacitor-community/background-geolocation (tem openSettings)

  var overlay = null;      // elemento da tela (null = ainda não montado)
  var pollTimer = null;    // re-checagem periódica (pega permissão concedida "por fora")

  // ---- Checa as permissões. Cada campo: true (ok) | false (falta) | null (não dá pra saber).
  // "não dá pra saber" (plugin ausente/erro) NÃO bloqueia — senão um app sem o plugin travaria pra sempre.
  async function checar() {
    var loc = null, notif = null, locRaw = '', notifRaw = '';
    try {
      if (Geo && Geo.checkPermissions) {
        var pl = await Geo.checkPermissions();
        locRaw = (pl && pl.location) || '';
        loc = !!(pl && (pl.location === 'granted' || pl.coarseLocation === 'granted'));
      }
    } catch (e) { loc = null; }
    try {
      if (Push && Push.checkPermissions) {
        var pn = await Push.checkPermissions();
        notifRaw = (pn && pn.receive) || '';
        notif = !!(pn && pn.receive === 'granted');
      }
    } catch (e) { notif = null; }
    return { loc: loc, notif: notif, locRaw: locRaw, notifRaw: notifRaw };
  }

  function falta(st) { return st.loc === false || st.notif === false; }

  // ---- Pede as permissões que faltam (janelas do Android, uma de cada vez). ----
  async function pedirPermissoes() {
    var st = await checar();
    if (st.loc === false && Geo && Geo.requestPermissions) {
      try { await Geo.requestPermissions(); } catch (e) {}
    }
    st = await checar();
    if (st.notif === false && Push && Push.requestPermissions) {
      try { await Push.requestPermissions(); } catch (e) {}
    }
    await avaliar();
  }

  // ---- Abre a tela de configurações do app (pra quando o usuário já negou "não perguntar de novo"). ----
  async function abrirConfiguracoes() {
    try {
      if (BG && BG.openSettings) { await BG.openSettings(); return; }
    } catch (e) {}
    // Sem o plugin, avisa pra abrir na mão (raro — o app usa esse plugin no rastreio).
    try {
      var d = overlay && overlay.querySelector('#gtDica');
      if (d) d.textContent = 'Abra Configurações do celular → Apps → Entregas Orgânico do Chico → Permissões.';
    } catch (e) {}
  }

  // ---- Monta a tela (uma vez) e devolve os pedaços que mudam. ----
  function montarOverlay() {
    var el = document.createElement('div');
    el.id = 'gatePermissoes';
    el.setAttribute('role', 'dialog');
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000', 'background:#f8fafc',
      'display:flex', 'flex-direction:column', 'font-family:Inter,system-ui,Arial,sans-serif',
      'color:#0f172a', '-webkit-user-select:none', 'user-select:none'
    ].join(';');
    el.innerHTML =
      '<div style="background:#0b1f4d;color:#fff;padding:18px 20px;">' +
        '<div style="font-size:13px;opacity:.85;letter-spacing:.3px;">ENTREGAS ORGÂNICO DO CHICO</div>' +
        '<div style="font-size:20px;font-weight:800;margin-top:2px;">Ative para usar o app</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px;">' +
        '<p style="margin:0;font-size:15px;line-height:1.45;color:#334155;">' +
          'Para registrar suas entregas e te avisar das mensagens, o app precisa de ' +
          '<b>localização</b> e <b>notificações</b> ligadas. Toque em <b>Ativar agora</b> e permita.' +
        '</p>' +
        '<div id="gtLinhaLoc"   style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font-size:15px;font-weight:600;"></div>' +
        '<div id="gtLinhaNotif" style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font-size:15px;font-weight:600;"></div>' +
        '<div id="gtDica" style="font-size:13px;color:#64748b;line-height:1.4;min-height:18px;"></div>' +
      '</div>' +
      '<div style="padding:16px 20px 22px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #e2e8f0;background:#fff;">' +
        '<button id="gtBtnAtivar" type="button" style="width:100%;padding:15px;border:0;border-radius:12px;background:#16a34a;color:#fff;font-size:16px;font-weight:800;cursor:pointer;">Ativar agora</button>' +
        '<button id="gtBtnConfig" type="button" style="width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;font-size:15px;font-weight:700;cursor:pointer;">⚙️ Abrir configurações do app</button>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('#gtBtnAtivar').addEventListener('click', pedirPermissoes);
    el.querySelector('#gtBtnConfig').addEventListener('click', abrirConfiguracoes);
    return el;
  }

  function pintarLinha(linha, ok, rotulo) {
    if (!linha) return;
    if (ok) {
      linha.style.color = '#166534';
      linha.style.borderColor = '#bbf7d0';
      linha.style.background = '#f0fdf4';
      linha.innerHTML = '✅ <span>' + rotulo + '</span><span style="margin-left:auto;font-weight:800;color:#16a34a;">Ativada</span>';
    } else {
      linha.style.color = '#7f1d1d';
      linha.style.borderColor = '#fecaca';
      linha.style.background = '#fef2f2';
      linha.innerHTML = '⛔ <span>' + rotulo + '</span><span style="margin-left:auto;font-weight:800;color:#dc2626;">Desativada</span>';
    }
  }

  function mostrar(st) {
    if (!overlay) overlay = montarOverlay();
    overlay.style.display = 'flex';
    pintarLinha(overlay.querySelector('#gtLinhaLoc'), st.loc !== false, '📍 Localização');
    pintarLinha(overlay.querySelector('#gtLinhaNotif'), st.notif !== false, '🔔 Notificações');
    // Se o Android não pergunta mais (usuário negou de vez), aponta pro atalho das configurações.
    var negou = st.locRaw === 'denied' || st.notifRaw === 'denied';
    var dica = overlay.querySelector('#gtDica');
    if (dica) dica.textContent = negou
      ? 'Se a janela de permissão não aparecer, toque em “Abrir configurações do app” e ligue por lá.'
      : '';
    iniciarPoll();
  }

  function esconder() {
    if (overlay) overlay.style.display = 'none';
    pararPoll();
  }

  function visivel() { return !!(overlay && overlay.style.display !== 'none'); }

  async function avaliar() {
    var st = await checar();
    if (falta(st)) mostrar(st);
    else esconder();
  }

  function iniciarPoll() { if (!pollTimer) pollTimer = setInterval(avaliar, 1500); }
  function pararPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // Roda a avaliação agora + um poll curto (pega plugin que inicializa um pouco depois do boot).
  function ciclo() {
    avaliar();
    iniciarPoll();
    setTimeout(function () { if (!visivel()) pararPoll(); }, 6000);
  }

  // Re-checa ao voltar pro app (ex.: usuário foi nas configurações, ligou e voltou).
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ciclo(); });
  window.addEventListener('focus', function () { avaliar(); });

  ciclo();
})();
