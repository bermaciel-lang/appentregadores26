(function () {
  const C = window.APP_CONFIG;

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
    const url = new URL(C.API_URL);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
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
    const res = await fetch('/api/proxy', {
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
    const result = await withCache('entregadores', async () => {
      const res = await apiGet({ action: 'entregadores' });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erro ao carregar entregadores');
      return Array.isArray(res.items) ? res.items : [];
    });
    return result;
  }

async function carregarEntregasPorEntregador(entregador) {
  const cacheName = 'entregas_' + String(entregador || '').trim().toLowerCase();

  try {
    const res = await apiGet({
      action: 'entregas',
      entregador
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
    return apiGet({ action: 'marcarEntregue', row, obs: obs || '' }, { retries: 3 });
  }

  async function apiMarcarNaoEntregue(row, obs) {
    return apiGet({ action: 'marcarNaoEntregue', row, obs: obs || '' }, { retries: 3 });
  }

async function apiMarcarCancelado(row, obs) {
    return apiGet({ action: 'marcarCancelado', row, obs: obs || '' }, { retries: 3 });
  }

  // Corrige o KM inicial/final já registrado (tipo = 'inicial' | 'final').
  async function apiEditarKm(entregador, tipo, km) {
    return apiGet({ action: 'editarKm', entregador: entregador, tipo: tipo, km: km }, { retries: 3 });
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
  // Com foto: tenta o POST 2x antes de desistir da foto.
  if (fotoBase64) {
    for (let i = 0; i < 2; i += 1) {
      try {
        const res = await postJson({ action: 'iniciarRota', entregador, kmInicial, fotoBase64: fotoBase64, fotoMimeType: fotoMimeType || 'image/jpeg' });
        if (res && res.ok) return res;
      } catch (e) { /* tenta de novo */ }
      await sleep(800 * (i + 1));
    }
    // Não subiu com foto: salva o KM e AVISA que a foto não foi (sem fingir sucesso).
    const res = await apiGet({ action: 'iniciarRota', entregador, kmInicial }, { retries: 1 });
    if (res && res.ok) return Object.assign({}, res, { semFoto: true });
    throw new Error((res && res.error) || 'Falha ao iniciar rota');
  }
  const res = await apiGet({ action: 'iniciarRota', entregador, kmInicial }, { retries: 1 });
  if (res && res.ok) return res;
  throw new Error((res && res.error) || 'Falha ao iniciar rota');
}

async function apiFinalizarRota(entregador, kmFinal, fotoBase64, fotoMimeType) {
  if (fotoBase64) {
    for (let i = 0; i < 2; i += 1) {
      try {
        const res = await postJson({ action: 'finalizarRota', entregador, kmFinal, fotoBase64: fotoBase64, fotoMimeType: fotoMimeType || 'image/jpeg' });
        if (res && res.ok) return res;
      } catch (e) { /* tenta de novo */ }
      await sleep(800 * (i + 1));
    }
    const res = await apiGet({ action: 'finalizarRota', entregador, kmFinal }, { retries: 1 });
    if (res && res.ok) return Object.assign({}, res, { semFoto: true });
    throw new Error((res && res.error) || 'Falha ao finalizar rota');
  }
  const res = await apiGet({ action: 'finalizarRota', entregador, kmFinal }, { retries: 1 });
  if (res && res.ok) return res;
  throw new Error((res && res.error) || 'Falha ao finalizar rota');
}


  function saveEntregasCache(entregador, items) {
    const cacheName = 'entregas_' + String(entregador || '').toLowerCase();
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
    apiEditarKm

  };
})();
