(function () {
  const C = window.APP_CONFIG;

  // Turno selecionado (MANHÃ/TARDE). Só é relevante no backend do PAINEL (Supabase), onde
  // manhã e tarde coexistem; no backend antigo (Apps Script) o turno é ignorado (rota única).
  function turnoPadrao() { return new Date().getHours() < 14 ? 'MANHÃ' : 'TARDE'; }
  function getTurno() { try { return sessionStorage.getItem('app_turno') || turnoPadrao(); } catch (e) { return turnoPadrao(); } }
  function setTurno(t) { try { sessionStorage.setItem('app_turno', t); } catch (e) {} }
  function usandoPainel() { try { return !!localStorage.getItem('app_api_url_override'); } catch (e) { return false; } }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function esc(text) {
    return String(text || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function avatarLetter(nome) {
    return String(nome || '').trim().charAt(0).toUpperCase() || '?';
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('pt-BR');
  }

  function formatTime(value) {
    if (!value) return '-';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function statusKey(status) {
    const st = String(status || '').trim().toLowerCase();
    if (st === 'indo para entrega') return 'start';
    if (st === 'entregue') return 'done';
    if (st === 'não entregue' || st === 'nao entregue') return 'fail';
    return 'pending';
  }

  function statusLabel(status) {
    const st = String(status || '').trim();
    return st || 'Pendente';
  }

  
function buildMapsUrl(item) {
    const endereco = String((item && item.endereco) || '').trim();
    if (!endereco) return '#';
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isAndroid) return 'google.navigation:q=' + encodeURIComponent(endereco);
    if (isIPhone) return 'comgooglemaps://?q=' + encodeURIComponent(endereco) + '&directionsmode=driving';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(endereco);
  }

  function buildWazeUrl(item) {
    const endereco = String((item && item.endereco) || '').trim();
    if (!endereco) return '#';
    return 'https://www.waze.com/ul?navigate=yes&q=' + encodeURIComponent(endereco);
  }

  function saveDriverName(nome) {
    localStorage.setItem(C.STORAGE_DRIVER_KEY, String(nome || '').trim());
  }

  function getSavedDriverName() {
    return (localStorage.getItem(C.STORAGE_DRIVER_KEY) || '').trim();
  }

  function clearSavedDriverName() {
    localStorage.removeItem(C.STORAGE_DRIVER_KEY);
  }

  // ---- Token do aparelho (Fase 2 / login por PIN) ----
  // Depois do 1º PIN certo, guardamos { token, nome } no aparelho (device-bind): nas próximas vezes
  // o mesmo entregador entra sem digitar PIN. O SERVIDOR descobre quem é pelo token — o nome mandado
  // é só referência. Trocar de entregador (outro nome) pede o PIN de novo.
  function saveDriverToken(token, nome) {
    try { localStorage.setItem(C.STORAGE_TOKEN_KEY, JSON.stringify({ token: String(token || ''), nome: String(nome || '').trim() })); } catch (e) {}
  }
  function getDriverTokenInfo() {
    try { var o = JSON.parse(localStorage.getItem(C.STORAGE_TOKEN_KEY) || 'null'); return (o && o.token) ? o : null; } catch (e) { return null; }
  }
  function clearDriverToken() {
    try { localStorage.removeItem(C.STORAGE_TOKEN_KEY); } catch (e) {}
  }
  // Login por PIN. Devolve { ok, token, nome } ou { ok:false, error }. Não anexa token (não tem ainda).
  async function apiLogin(nome, pin) {
    var aparelho = '';
    try { aparelho = (navigator.userAgent || '').slice(0, 120); } catch (e) {}
    return apiGet({ action: 'login', entregador: nome, pin: pin, aparelho: aparelho }, { retries: 1 });
  }

  function setAdminAuth(ok) {
    localStorage.setItem(C.STORAGE_ADMIN_AUTH_KEY, ok ? '1' : '0');
  }

  function getAdminAuth() {
    return localStorage.getItem(C.STORAGE_ADMIN_AUTH_KEY) === '1';
  }

  function cacheKey(key) {
    return C.STORAGE_CACHE_PREFIX + key;
  }

  function writeCache(key, value) {
    localStorage.setItem(cacheKey(key), JSON.stringify({
      ts: Date.now(),
      value
    }));
  }

  function readCache(key) {
    try {
      const raw = localStorage.getItem(cacheKey(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function getFreshCache(key) {
    const cached = readCache(key);
    if (!cached) return null;
    if ((Date.now() - Number(cached.ts || 0)) > C.CACHE_TTL_MS) return null;
    return cached.value;
  }

  function loadJSONP(url) {
    return new Promise((resolve, reject) => {
      const callback = 'cb' + Date.now() + Math.floor(Math.random() * 1000);
      const script = document.createElement('script');
      let finished = false;

      function cleanup() {
        if (finished) return;
        finished = true;
        try {
          if (script.parentNode) script.parentNode.removeChild(script);
        } catch (e) {}
        try {
          delete window[callback];
        } catch (e) {
          window[callback] = undefined;
        }
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Tempo esgotado ao chamar a API'));
      }, C.API_TIMEOUT_MS);

      window[callback] = (data) => {
        clearTimeout(timeout);
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error('Erro ao carregar JSONP'));
      };

      script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + callback;
      document.body.appendChild(script);
    });
  }

  function buildApiUrl(params) {
    // Aceita URL absoluta (Apps Script) OU caminho same-origin (/api/painel, no override).
    const url = new URL(C.API_URL, window.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    // Fase 2: anexa o token do aparelho em TODA request (menos o próprio login, que ainda não tem).
    // O servidor descobre quem é o entregador pelo token e ignora o nome mandado.
    try {
      if (!params || params.action !== 'login') {
        var ti = getDriverTokenInfo();
        if (ti && ti.token && !url.searchParams.has('token')) url.searchParams.set('token', ti.token);
      }
    } catch (e) { /* sem token → segue sem (modo observa no servidor deixa passar) */ }
    return url.toString();
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), C.API_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

async function postJson(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), C.API_TIMEOUT_MS);

  try {
    // Se houver override do painel neste aparelho, posta direto pra ele (cross-origin,
    // com CORS); senão, usa o proxy do Vercel que fala com o Apps Script antigo.
    const res = await fetch(C.POST_URL || '/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ===== Espelho pro PAINEL (Etapa C, ponte) =====
// Manda KM/foto pro NOSSO sistema ALÉM da planilha — pra essas infos aparecerem no painel
// (Resumo de rotas) sem depender de puxar da planilha depois. Só roda quando este aparelho
// está no fluxo ANTIGO (planilha): se já estiver no painel (override), o envio principal já
// vai pra lá e duplicar seria à toa. É BEST-EFFORT: dispara e não espera — não trava o
// entregador nem falha a ação se o painel estiver fora do ar (a planilha é a fonte principal).
// Obs.: só espelhamos KM/foto (iniciar/finalizar rota), que casam por data+turno+entregador.
// Os status de cada entrega (entregue/não) NÃO dá pra espelhar: o "row" da planilha é
// diferente do id do banco — isso só na virada completa (piloto Etapa C).
function espelharNoPainel(body) {
  try {
    if (usandoPainel()) return;
    fetch('/api/painel/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store'
    }).catch(function () {});
  } catch (e) {}
}

  async function apiGet(params, options) {
    const opt = options || {};
    const url = buildApiUrl(params);
    const retries = Number.isFinite(opt.retries) ? opt.retries : C.API_RETRY_COUNT;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        if (C.API_MODE === 'json') return await fetchJson(url);
        return await loadJSONP(url);
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await sleep(600 * (attempt + 1));
          continue;
        }
      }
    }

    throw lastError || new Error('Falha na API');
  }

  async function withCache(cacheName, fetcher) {
    const fresh = getFreshCache(cacheName);
    if (fresh) return { data: fresh, fromCache: true, stale: false };

    try {
      const data = await fetcher();
      writeCache(cacheName, data);
      return { data, fromCache: false, stale: false };
    } catch (error) {
      const fallback = readCache(cacheName);
      if (fallback && fallback.value) {
        return { data: fallback.value, fromCache: true, stale: true, error };
      }
      throw error;
    }
  }

  async function carregarEntregadores() {
    const result = await withCache('entregadores_' + getTurno(), async () => {
      const res = await apiGet({ action: 'entregadores', turno: getTurno() });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erro ao carregar entregadores');
      return Array.isArray(res.items) ? res.items : [];
    });
    return result;
  }

async function carregarEntregasPorEntregador(entregador) {
  const cacheName = 'entregas_' + getTurno() + '_' + String(entregador || '').trim().toLowerCase();

  try {
    const res = await apiGet({
      action: 'entregas',
      entregador,
      turno: getTurno()
    });

    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'Erro ao carregar entregas');
    }

    const items = Array.isArray(res.items) ? res.items : [];
    saveEntregasCache(entregador, items);

    return {
      data: items,
      stale: false,
      rotaIniciada: res.rotaIniciada || false,
      rotaInfo: res.rotaInfo || null
    };
  } catch (error) {
    const cached = getFreshCache(cacheName) || readCache(cacheName);

    if (cached) {
      const value = cached.value !== undefined ? cached.value : cached;
      if (Array.isArray(value)) {
        return {
          data: value,
          stale: true
        };
      }
    }

    throw error;
  }
}

  // Escritas de status: 3 tentativas (rede de celular oscila). É seguro repetir
  // porque marcar a mesma linha de novo grava o mesmo valor (não duplica nada).
  async function apiIniciarEntrega(row) {
    return apiGet({ action: 'iniciarEntrega', row }, { retries: 3 });
  }

  async function apiMarcarEntregue(row, obs) {
    // ts_device = hora do CELULAR no instante do toque. O painel guarda em entregue_em pra depois
    // comparar com a hora real por GPS (às vezes o entregador marca muito depois de entregar).
    return apiGet({ action: 'marcarEntregue', row, obs: obs || '', ts_device: new Date().toISOString() }, { retries: 3 });
  }

  async function apiMarcarNaoEntregue(row, obs) {
    return apiGet({ action: 'marcarNaoEntregue', row, obs: obs || '', ts_device: new Date().toISOString() }, { retries: 3 });
  }

async function apiMarcarCancelado(row, obs) {
    return apiGet({ action: 'marcarCancelado', row, obs: obs || '' }, { retries: 3 });
  }

  // Corrige o KM inicial/final já registrado (tipo = 'inicial' | 'final').
  async function apiEditarKm(entregador, tipo, km) {
    espelharNoPainel({ action: 'editarKm', entregador: entregador, tipo: tipo, km: km, turno: getTurno() });
    return apiGet({ action: 'editarKm', entregador: entregador, tipo: tipo, km: km, turno: getTurno() }, { retries: 3 });
  }

  // ===== Fila offline: se o envio falhar (sem sinal), guarda e reenvia sozinho =====
  function filaKey() { return C.STORAGE_CACHE_PREFIX + 'fila_v1'; }
  function filaLer() { try { return JSON.parse(localStorage.getItem(filaKey()) || '[]'); } catch (e) { return []; } }
  function filaSalvar(arr) { localStorage.setItem(filaKey(), JSON.stringify(Array.isArray(arr) ? arr : [])); }
  function enfileirar(params, meta) {
    const arr = filaLer();
    arr.push({ id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 7), params: params, meta: meta || {}, ts: Date.now() });
    filaSalvar(arr);
  }
  function filaRowsPendentes() {
    const set = new Set();
    filaLer().forEach((x) => { const r = Number(x.meta && x.meta.row); if (r) set.add(r); });
    return set;
  }
  let _processandoFila = false;
  async function processarFila() {
    if (_processandoFila) return;
    _processandoFila = true;
    try {
      const arr = filaLer();
      for (const item of arr.slice()) {
        try {
          const res = await apiGet(item.params, { retries: 1 });
          if (res && res.ok) { filaSalvar(filaLer().filter((x) => x.id !== item.id)); }
          else if (res && res.naoEncontrado) { filaSalvar(filaLer().filter((x) => x.id !== item.id)); } // parada não existe mais (rota refeita) -> descarta, não adianta repetir
          else break; // ainda falhando -> tenta depois
        } catch (e) { break; } // sem conexão -> tenta depois
      }
    } finally { _processandoFila = false; }
  }

  async function abrirWhatsapp(row) {
  const res = await apiGet({ action: 'whatsapp', row }, { retries: 0 });

  if (!res || !res.ok || !res.url) {
    throw new Error((res && res.error) || 'Não foi possível abrir o WhatsApp');
  }

  let url = String(res.url || '');
  const isAndroid = /Android/i.test(navigator.userAgent);

  if (isAndroid) {
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const phone = pathParts[0] || '';
      const text = parsed.searchParams.get('text') || '';

      if (phone) {
        url = 'whatsapp://send?phone=' + encodeURIComponent(phone) + '&text=' + encodeURIComponent(text);
      }
    } catch (e) {}
  }

  window.location.assign(url);
  return res;
}

async function apiIniciarRota(entregador, kmInicial, fotoBase64, fotoMimeType) {
  // Espelha pro nosso sistema (além da planilha) — KM inicial + foto de início.
  espelharNoPainel({ action: 'iniciarRota', entregador: entregador, kmInicial: kmInicial, turno: getTurno(), fotoBase64: fotoBase64 || '', fotoMimeType: fotoMimeType || 'image/jpeg' });
  // Com foto: tenta o POST 2x antes de desistir da foto.
  if (fotoBase64) {
    for (let i = 0; i < 2; i += 1) {
      try {
        const res = await postJson({ action: 'iniciarRota', entregador, kmInicial, turno: getTurno(), fotoBase64: fotoBase64, fotoMimeType: fotoMimeType || 'image/jpeg' });
        if (res && res.ok) return res;
      } catch (e) { /* tenta de novo */ }
      await sleep(800 * (i + 1));
    }
    // Não subiu com foto: salva o KM e AVISA que a foto não foi (sem fingir sucesso).
    const res = await apiGet({ action: 'iniciarRota', entregador, kmInicial, turno: getTurno() }, { retries: 1 });
    if (res && res.ok) return Object.assign({}, res, { semFoto: true });
    throw new Error((res && res.error) || 'Falha ao iniciar rota');
  }
  const res = await apiGet({ action: 'iniciarRota', entregador, kmInicial }, { retries: 1 });
  if (res && res.ok) return res;
  throw new Error((res && res.error) || 'Falha ao iniciar rota');
}

async function apiFinalizarRota(entregador, kmFinal, fotoBase64, fotoMimeType) {
  // Espelha pro nosso sistema (além da planilha) — KM final + foto de fim.
  espelharNoPainel({ action: 'finalizarRota', entregador: entregador, kmFinal: kmFinal, turno: getTurno(), fotoBase64: fotoBase64 || '', fotoMimeType: fotoMimeType || 'image/jpeg' });
  if (fotoBase64) {
    for (let i = 0; i < 2; i += 1) {
      try {
        const res = await postJson({ action: 'finalizarRota', entregador, kmFinal, turno: getTurno(), fotoBase64: fotoBase64, fotoMimeType: fotoMimeType || 'image/jpeg' });
        if (res && res.ok) return res;
      } catch (e) { /* tenta de novo */ }
      await sleep(800 * (i + 1));
    }
    const res = await apiGet({ action: 'finalizarRota', entregador, kmFinal, turno: getTurno() }, { retries: 1 });
    if (res && res.ok) return Object.assign({}, res, { semFoto: true });
    throw new Error((res && res.error) || 'Falha ao finalizar rota');
  }
  const res = await apiGet({ action: 'finalizarRota', entregador, kmFinal }, { retries: 1 });
  if (res && res.ok) return res;
  throw new Error((res && res.error) || 'Falha ao finalizar rota');
}


  function saveEntregasCache(entregador, items) {
    const cacheName = 'entregas_' + getTurno() + '_' + String(entregador || '').toLowerCase();
    writeCache(cacheName, Array.isArray(items) ? items : []);
  }

  async function carregarAdminPainel() {
    const result = await withCache('admin_painel', async () => {
      const res = await apiGet({ action: 'adminPainel' });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erro ao carregar painel');
      return res;
    });
    return result;
  }

  function agruparEntregas(items) {
    const lista = Array.isArray(items) ? items : [];
    const emRota = [];
    const pendentes = [];
    const concluidas = [];

    lista.forEach((item) => {
      const key = statusKey(item.status);
      if (key === 'start') emRota.push(item);
      else if (key === 'done' || key === 'fail') concluidas.push(item);
      else pendentes.push(item);
    });

    return { emRota, pendentes, concluidas };
  }

  function gerarResumoEntregas(items) {
    const grupos = agruparEntregas(items);
    return {
      total: (items || []).length,
      emRota: grupos.emRota.length,
      pendentes: grupos.pendentes.length,
      concluidas: grupos.concluidas.length
    };
  }

  window.AppEntrega = {
    esc,
    avatarLetter,
    formatDateTime,
    formatTime,
    statusKey,
    statusLabel,
    buildMapsUrl,
    buildWazeUrl,
    saveDriverName,
    getSavedDriverName,
    clearSavedDriverName,
    saveDriverToken,
    getDriverTokenInfo,
    clearDriverToken,
    apiLogin,
    saveEntregasCache,
    setAdminAuth,
    getAdminAuth,
    apiGet,
    carregarEntregadores,
    carregarEntregasPorEntregador,
    apiIniciarEntrega,
    apiMarcarEntregue,
    apiMarcarNaoEntregue,
    abrirWhatsapp,
    carregarAdminPainel,
    agruparEntregas,
    apiIniciarRota,
    apiFinalizarRota,
    apiMarcarCancelado,
    gerarResumoEntregas,
    enfileirar,
    processarFila,
    filaRowsPendentes,
    apiEditarKm,
    getTurno,
    setTurno,
    turnoPadrao,
    usandoPainel

  };
})();
