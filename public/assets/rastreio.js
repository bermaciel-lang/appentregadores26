// ====================================================================
// RASTREAMENTO GPS DO ENTREGADOR (Fase 3 — rastreio ao vivo tipo Uber/iFood)
// Captura a posição durante a rota e manda em LOTE pro painel (/api/ping).
//  - No APP ANDROID (Capacitor): usa o plugin nativo de background-geolocation
//    (roda com a tela apagada, notificação fixa "Rota em andamento").
//  - No NAVEGADOR / iPhone (sem app): usa o GPS do navegador — só com o app ABERTO.
// Liga no "Iniciar entregas", desliga no "Finalizar". Objetivo nº 1: KM real preciso
// (o painel cola o trajeto na rua via OSRM). Aqui a gente só COLETA os pontos bons.
//
// ⛔ 28/10/2026 (revisão da leva 2):
//  - o TURNO vinha de `window.getTurno`, que NÃO EXISTE: todo ponto ia com turno vazio e sumia do mapa (que filtra por turno).
//    Agora quem liga passa dia e turno (page-entregas.js `ligarRastreio`), com `AppEntrega.getTurno()` de reserva;
//  - o id do rastreio NATIVO fica guardado no aparelho: quando o Android mata a tela e o app volta, o rastreio antigo (órfão,
//    com a notificação "Rota em andamento" presa) é desligado antes de ligar outro, e o Finalizar desliga os dois;
//  - o lote leva o TOKEN do entregador (o servidor da leva 3 passa a exigir; o atual ignora o campo);
//  - o id guardado é POR ROTA (entregador + dia + turno), e o parar desliga só o da própria rota. Com uma chave só por aparelho,
//    abrir a MANHÃ já finalizada ("Trocar turno") desligava o GPS da TARDE em andamento — e o mesmo trocando de entregador
//    no mesmo celular. A chave antiga (sem rota) ainda é desligada uma vez, na transição.
// ====================================================================
(function () {
  'use strict';

  var FLUSH_MS = 30000;     // manda o lote a cada 30s
  var MAX_FILA = 20;        // se acumular 20 pontos antes disso, manda já
  var CHAVE_WATCHER = 'rastreio_watcher_nativo_v1';     // LEGADO: uma chave só por aparelho (sem rota); sai na transição
  var PREFIXO_WATCHER = 'rastreio_watcher_nativo_v2|';  // + entregador|dia|turno
  var fila = [];
  var st = { ativo: false, entregador: '', data: '', turno: '', watchId: null, timer: null, nativo: false };

  function api() { return window.AppEntrega || null; }

  function dataLocal() {
    var a = api();
    if (a && a.diaSP) { try { return a.diaSP(); } catch (e) {} }
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function turnoAtual() {
    var a = api();
    try { return a && a.getTurno ? a.getTurno() : ''; } catch (e) { return ''; }
  }
  function tokenDoEntregador(nome) {
    var a = api();
    try {
      var ti = a && a.getDriverTokenInfo ? a.getDriverTokenInfo() : null;
      return ti && ti.token && String(ti.nome || '').trim() === String(nome || '').trim() ? ti.token : '';
    } catch (e) { return ''; }
  }

  function chaveDaRota(entregador, data, turno) { return PREFIXO_WATCHER + String(entregador || '').trim() + '|' + (data || '') + '|' + (turno || ''); }
  function lerWatcherGuardado(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
  function guardarWatcher(chave, id) { try { if (id == null) localStorage.removeItem(chave); else localStorage.setItem(chave, String(id)); } catch (e) {} }
  // Desliga e esquece o rastreio guardado numa chave (órfão de uma abertura anterior), menos o que esta tela está usando.
  function desligarGuardado(chave) {
    var guardado = lerWatcherGuardado(chave);
    if (guardado != null && String(guardado) !== String(st.watchId)) desligarNativo(guardado);
    guardarWatcher(chave, null);
  }
  function pluginNativo() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackgroundGeolocation; }
  // Desliga um rastreio nativo pelo id (o desta tela ou o órfão de uma abertura anterior). Nunca lança.
  function desligarNativo(id) {
    var BG = pluginNativo();
    if (!BG || id == null || id === '') return;
    try { var p = BG.removeWatcher({ id: id }); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  function enfileirar(lat, lng, acc, vel, rumo) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    fila.push({
      cid: st.entregador + '-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
      ts: new Date().toISOString(),
      lat: lat, lng: lng,
      precisao_m: (typeof acc === 'number' && !isNaN(acc)) ? Math.round(acc) : null,
      velocidade: (typeof vel === 'number' && !isNaN(vel) && vel >= 0) ? vel : null,
      rumo: (typeof rumo === 'number' && !isNaN(rumo)) ? rumo : null,
      bateria: null,
      is_moving: true
    });
    if (fila.length >= MAX_FILA) flush();
  }

  function flush() {
    if (!fila.length || !st.entregador) return;
    var lote = fila.splice(0, 100);
    var body = { entregador: st.entregador, data: st.data, turno: st.turno, pontos: lote };
    var token = tokenDoEntregador(st.entregador);
    if (token) body.token = token;
    fetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).then(function (r) {
      if (!r.ok) fila = lote.concat(fila);       // falhou -> devolve pra tentar de novo
    }).catch(function () {
      fila = lote.concat(fila);                  // sem sinal -> guarda e tenta depois
    });
  }

  function iniciar(entregador, data, turno) {
    if (st.ativo) return;
    st.entregador = entregador || (window.state && window.state.driver) || '';
    st.data = data || dataLocal();
    st.turno = turno || turnoAtual();
    if (!st.entregador) { console.warn('[rastreio] sem entregador — não inicia'); return; }
    st.ativo = true;

    var BG = pluginNativo();
    if (BG) {
      // APP ANDROID: plugin nativo (segundo plano, tela apagada). O rastreio que ficou de uma abertura anterior DESTA rota sai
      // antes (e o da chave antiga, sem rota). O de outra rota/entregador não é desta tela e fica.
      st.nativo = true;
      var chave = chaveDaRota(st.entregador, st.data, st.turno);
      desligarGuardado(chave);
      desligarGuardado(CHAVE_WATCHER);
      BG.addWatcher({
        backgroundMessage: 'Registrando o trajeto da rota.',
        backgroundTitle: 'Rota em andamento',
        requestPermissions: true,
        stale: false,
        distanceFilter: 15   // um ponto a cada ~15m de deslocamento (bateria + precisão)
      }, function (loc, err) {
        if (err) { console.warn('[rastreio] erro nativo', err); return; }
        if (loc) enfileirar(loc.latitude, loc.longitude, loc.accuracy, loc.speed, loc.bearing);
      }).then(function (id) {
        if (!st.ativo) { desligarNativo(id); return; } // parou enquanto ligava
        st.watchId = id; guardarWatcher(chave, id);
      }).catch(function (e) { console.warn('[rastreio] addWatcher', e); });
    } else if (window.APP_CONFIG && window.APP_CONFIG.RASTREIO_WEB && navigator.geolocation) {
      // NAVEGADOR/iPhone: só com o app ABERTO, e SÓ se RASTREIO_WEB estiver ligado.
      // Padrão = DESLIGADO no navegador, pra NÃO pedir permissão de GPS a todo mundo enquanto o
      // rastreamento é só do app Android. (Ligar depois, quando quisermos rastrear iPhone.)
      st.watchId = navigator.geolocation.watchPosition(function (pos) {
        var c = pos.coords;
        enfileirar(c.latitude, c.longitude, c.accuracy, c.speed, c.heading);
      }, function (e) { console.warn('[rastreio] erro web', e && e.message); },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    } else {
      // Sem app nativo (e web desligado) → não rastreia. Não afeta o fluxo do entregador hoje.
      st.ativo = false; return;
    }

    if (st.timer) clearInterval(st.timer);
    st.timer = setInterval(flush, FLUSH_MS);
    console.log('[rastreio] iniciado', st.entregador, st.data, st.turno, st.nativo ? '(nativo)' : '(web)');
  }

  // `parar(entregador, dia, turno)`: a rota que parou (a da tela). Sem argumentos, a do rastreio ligado.
  function parar(entregador, data, turno) {
    var rota = {
      entregador: String(entregador || st.entregador || (window.state && window.state.driver) || '').trim(),
      data: data || st.data || dataLocal(),
      turno: turno || st.turno || turnoAtual()
    };
    // O órfão DESTA rota (de uma abertura anterior) sai SEMPRE — mesmo que esta tela nunca tenha ligado o rastreio. O de OUTRA
    // rota fica: a TARDE em andamento quando se abre a MANHÃ já finalizada; outro entregador no mesmo celular.
    desligarGuardado(chaveDaRota(rota.entregador, rota.data, rota.turno));
    desligarGuardado(CHAVE_WATCHER); // legado, sem rota: sai como antes (uma vez, na transição)
    if (!st.ativo) return;
    if (String(st.entregador || '').trim() !== rota.entregador || st.data !== rota.data || st.turno !== rota.turno) return; // o ligado é de outra rota
    st.ativo = false;
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    if (st.nativo && st.watchId != null) desligarNativo(st.watchId);
    else if (st.watchId != null && navigator.geolocation) { try { navigator.geolocation.clearWatch(st.watchId); } catch (e) {} }
    st.watchId = null; st.nativo = false;
    flush(); // manda o que sobrou na fila
    console.log('[rastreio] parado');
  }

  // Manda o que sobrou se o app for fechado.
  window.addEventListener('pagehide', function () { if (st.ativo) flush(); });

  window.Rastreio = { iniciar: iniciar, parar: parar, _st: st, _fila: function () { return fila.slice(); }, _flush: flush };
})();
