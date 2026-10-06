(function () {
  const C = window.APP_CONFIG;

  // Turno selecionado (MANHÃ/TARDE). Só é relevante no backend do PAINEL (Supabase), onde
  // manhã e tarde coexistem; no backend antigo (Apps Script) o turno é ignorado (rota única).
  function turnoPadrao() { return new Date().getHours() < 14 ? 'MANHÃ' : 'TARDE'; }
  // ⛔ 10/09/2026 — O TURNO MORRIA E O APP VOLTAVA NO TURNO DO RELÓGIO.
  // Ele vivia só no `sessionStorage`, que o Android apaga ao matar o WebView — e o momento de maior
  // risco é justamente a CÂMERA, que é outro app: o entregador tira a foto do KM e volta para um app
  // que esqueceu em que turno estava. Depois das 14h, `turnoPadrao()` responde TARDE para uma rota
  // da MANHÃ; o servidor lê o cabeçalho do turno errado, responde "rota não iniciada", e o app
  // apaga o início (o outro conserto deste commit). É o "envia mas não libera" que o dono relatou.
  // 📏 A impressão digital está nos dados: em 27/08 o Daniel e Heloisa aparece com início às 15:04
  // no turno MANHÃ (km 156) e às 15:05 no TARDE (km 22251) — um minuto depois, ele tentando de novo.
  // Agora o turno é lembrado em `localStorage` POR DIA: sobrevive ao kill, e não vaza para amanhã.
  function diaSP() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
  function chaveTurno() { return 'app_turno_v1_' + diaSP(); }
  // 🗓️ MESMO vazamento do turno acima, na chave do cache da ROTA — e esta tinha ficado de fora.
  // Sem o dia, `entregas_MANHÃ_<nome>` de ontem sobrevive à virada. O plano B offline (linha ~496)
  // lê com `readCache`, que IGNORA a validade de 5 min, então qualquer idade serve: quem já tinha
  // iniciado a rota de HOJE (a trava `inicioConfirmado` deixa passar) e cuja chamada falhava
  // recebia a ROTA DE ONTEM. Foi o que pegou o Daniel e Heloisa e o Cristiano em 15/09/2026.
  // Com o dia na chave o vazamento fica impossível por construção, não por vigilância.
  // Uma função só porque os dois lados tinham se separado: quem lia fazia `.trim()` e quem
  // gravava não — nome com espaço sobrando gravava numa chave e lia de outra.
  function chaveCacheEntregas(entregador) {
    return 'entregas_' + diaSP() + '_' + getTurno() + '_' + String(entregador || '').trim().toLowerCase();
  }
  function getTurno() {
    try {
      var doDia = localStorage.getItem(chaveTurno());
      if (doDia) return doDia;
      return sessionStorage.getItem('app_turno') || turnoPadrao(); // sessão viva ainda vale
    } catch (e) { return turnoPadrao(); }
  }
  function setTurno(t) {
    try { sessionStorage.setItem('app_turno', t); } catch (e) {}
    try { localStorage.setItem(chaveTurno(), t); } catch (e) {}
  }
  // O entregador já ESCOLHEU o turno hoje neste aparelho? (é o que deixa o app reabrir direto na rota — page-home.js)
  function turnoEscolhidoHoje() { try { return !!localStorage.getItem(chaveTurno()); } catch (e) { return false; } }
  function usandoPainel() { try { return !!localStorage.getItem('app_api_url_override'); } catch (e) { return false; } }

  // ⏱️ Orçamento da conferência de valor do pagamento na porta (`conferirValores`). É a ÚNICA
  // chamada de rede que ainda acontece ANTES de um diálogo do entregador — é ela que decide o valor
  // oferecido no modal de dinheiro. Com o timeout geral (15 s) ela virava tela morta no meio da rua:
  // o "Como foi a entrega?" fechava e nada aparecia. Aqui ela é curta E sai adiantada, em paralelo
  // com o diálogo que o entregador está lendo (ver `adiantarConferenciaPg` em page-entregas.js).
  // Se não der tempo, o modal abre no modo degradado: o entregador DIGITA o valor, com a trava de
  // 10x sobre o valor de referência. Nada de dinheiro afrouxa; só a espera é que tem limite.
  const TEMPO_CONFERIR_MS = Number(C.API_CONFERIR_TIMEOUT_MS) > 0 ? Number(C.API_CONFERIR_TIMEOUT_MS) : 6000;

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
    if (st.indexOf('cancel') >= 0) return 'cancel';
    return 'pending';
  }

  function statusLabel(status) {
    const st = String(status || '').trim();
    return st || 'Pendente';
  }

  
  // enderecoNav = endereço SEM complemento (apto/bloco) — o complemento atrapalha o Maps/Waze acharem
  // o ponto certo. Fallback pro endereço completo (app velho / pedido antigo sem o campo).
  function enderecoNavDe(item) { return String((item && (item.enderecoNav || item.endereco)) || '').trim(); }

function buildMapsUrl(item) {
    const endereco = enderecoNavDe(item);
    if (!endereco) return '#';
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isAndroid) return 'google.navigation:q=' + encodeURIComponent(endereco);
    if (isIPhone) return 'comgooglemaps://?q=' + encodeURIComponent(endereco) + '&directionsmode=driving';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(endereco);
  }

  function buildWazeUrl(item) {
    const endereco = enderecoNavDe(item);
    if (!endereco) return '#';
    return 'https://www.waze.com/ul?navigate=yes&q=' + encodeURIComponent(endereco);
  }

  function saveDriverName(nome) {
    const novo = String(nome || '').trim();
    // ⛔ (revisão independente de 06/10, M4) quem SAI do aparelho ganha a hora da saída no token dele: o token continua servindo
    // para subir a fila DELE, mas para ENTRAR sem PIN só vale por PRAZO_TOKEN_DE_OUTRO_MS (ver `temToken`).
    try {
      const ant = (localStorage.getItem(C.STORAGE_DRIVER_KEY) || '').trim();
      if (ant && ant !== novo) { const o = lerTokens(); if (o[ant]) { o[ant].saiu = Date.now(); gravarTokens(o); } }
    } catch (e) {}
    localStorage.setItem(C.STORAGE_DRIVER_KEY, novo);
  }

  function getSavedDriverName() {
    return (localStorage.getItem(C.STORAGE_DRIVER_KEY) || '').trim();
  }

  function clearSavedDriverName() {
    localStorage.removeItem(C.STORAGE_DRIVER_KEY);
  }

  // ---- Token do aparelho (Fase 2 / login por PIN) ----
  // Depois do 1º PIN certo, guardamos o token no aparelho (device-bind): nas próximas vezes o mesmo
  // entregador entra sem digitar PIN. O SERVIDOR descobre quem é pelo token — o nome mandado é só
  // referência.
  //
  // ⛔ 06/10/2026 — UM TOKEN POR ENTREGADOR, NÃO UM SÓ POR APARELHO. Até hoje o aparelho guardava
  // UM token e o "Trocar entregador" apagava. Com o celular passando de mão (casal, folguista, o
  // celular do CD), três defeitos vinham juntos:
  //   1. o PIN era pedido a CADA troca, inclusive para voltar ao entregador de antes (a queixa do dono:
  //      "às vezes pede o PIN várias vezes");
  //   2. a fila do aparelho guardada pelo entregador A subia com o token de B: o servidor resolve o
  //      entregador PELO TOKEN, achava que a parada de A não era da rota de B (`naoEncontrado`) e a
  //      marcação de A virava RECUSA — e o "Entendi" de A, depois, a apagava. Entrega real perdida;
  //   3. o KM/foto pendente de A (ver rota_pend) era lido como se fosse de B.
  // Agora cada entregador tem o seu token no aparelho, a fila e o KM/foto sobem com o token de QUEM
  // fez, e trocar de entregador não apaga nada. O token só sai quando o SERVIDOR diz que ele não vale.
  const STORAGE_TOKENS_KEY = 'app_entregas_tokens_v2';
  function nomeLimpo(nome) { return String(nome || '').trim(); }
  function lerTokens() {
    try { const o = JSON.parse(localStorage.getItem(STORAGE_TOKENS_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  }
  function gravarTokens(o) { try { localStorage.setItem(STORAGE_TOKENS_KEY, JSON.stringify(o || {})); } catch (e) {} }
  function tokenLegado() {
    try { var o = JSON.parse(localStorage.getItem(C.STORAGE_TOKEN_KEY) || 'null'); return (o && o.token) ? o : null; } catch (e) { return null; }
  }
  // Token guardado para ESTE entregador (ou null). Lê também a chave antiga (um token só), para o
  // aparelho que atualizar o app não ter de digitar o PIN de novo.
  function tokenDe(nome) {
    const n = nomeLimpo(nome);
    if (!n) return null;
    const t = lerTokens()[n];
    if (t && t.token) return String(t.token);
    const leg = tokenLegado();
    return (leg && nomeLimpo(leg.nome) === n) ? String(leg.token) : null;
  }
  function saveDriverToken(token, nome) {
    const n = nomeLimpo(nome);
    if (!n || !token) return;
    const o = lerTokens(); o[n] = { token: String(token), em: Date.now() }; gravarTokens(o);
    try { localStorage.setItem(C.STORAGE_TOKEN_KEY, JSON.stringify({ token: String(token), nome: n })); } catch (e) {}
  }
  // { token, nome } do entregador ATIVO (o nome salvo), ou null.
  function getDriverTokenInfo() {
    const nome = getSavedDriverName();
    const t = tokenDe(nome);
    return t ? { token: t, nome: nome } : null;
  }
  // ⛔ (revisão independente de 06/10, M4) ENTRAR sem PIN: o entregador ATIVO sempre (o celular pessoal nunca pede de novo — o
  // device-bind de sempre); um entregador que JÁ SAIU deste aparelho só dentro de 16 h (o mesmo turno/dia, no celular passado de
  // mão). Depois disso pede o PIN dele — o token continua guardado e servindo para subir a fila que ele deixou aqui.
  const PRAZO_TOKEN_DE_OUTRO_MS = 16 * 3600 * 1000;
  function temToken(nome) {
    const n = nomeLimpo(nome);
    if (!tokenDe(n)) return false;
    if (n === getSavedDriverName()) return true;
    const t = lerTokens()[n];
    if (!t) return true; // só a chave antiga (de um token só): é do último ativo
    const desde = Number(t.saiu || t.em || 0);
    return Date.now() - desde < PRAZO_TOKEN_DE_OUTRO_MS;
  }
  // Apaga o token de UM entregador (padrão: o ativo). Só é chamado quando o servidor recusou aquele
  // token — nunca por trocar de entregador.
  function clearDriverToken(nome) {
    const n = nomeLimpo(nome !== undefined ? nome : getSavedDriverName());
    const o = lerTokens();
    if (n && o[n]) { delete o[n]; gravarTokens(o); }
    const leg = tokenLegado();
    if (leg && (!n || nomeLimpo(leg.nome) === n)) { try { localStorage.removeItem(C.STORAGE_TOKEN_KEY); } catch (e) {} }
  }
  // O servidor recusou por LOGIN (`precisaLogin`): token ausente ou inválido.
  // Apaga AQUI, no lugar único por onde toda resposta passa, o token QUE FOI USADO nesta chamada —
  // assim a home volta a pedir o PIN só para quem precisa. Antes apagava "o" token do aparelho,
  // mesmo quando a chamada era da fila de OUTRO entregador.
  // ⚠️ Desde 06/10/2026 o servidor NÃO responde mais `precisaLogin` quando é o BANCO que falha ao
  // conferir o token (antes respondia, e o app apagava um token bom — PIN pedido de novo sem motivo):
  // isso agora volta como `tentarDepois`. Então `precisaLogin` aqui é token que não vale mesmo.
  // Não lança: quem chama decide o que fazer com a resposta (a fila offline, por exemplo, só espera).
  // `enviado` = { nome, token } que foi NA chamada. Só apaga se o aparelho ainda guarda ESSE token para esse nome (revisão de
  // 06/10, menor 5: um PIN digitado enquanto a chamada estava no ar não pode ser apagado pela resposta velha).
  function tratarPrecisaLogin(res, enviado) {
    if (res && res.precisaLogin) {
      if (enviado && enviado.nome && tokenDe(enviado.nome) === enviado.token) clearDriverToken(enviado.nome);
      return true;
    }
    return false;
  }
  // Erro de LOGIN pra subir até a tela. NUNCA vira `erroMontagem`: são problemas diferentes, com
  // soluções diferentes (PIN × app de montagem), e a mensagem certa poupa a equipe de investigar
  // a coisa errada.
  function erroLogin(res) {
    const e = new Error(res && res.error || 'Faça login com o PIN pra abrir a rota.');
    e.precisaLogin = true;
    return e;
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

  // 🧹 Contrapeso de `chaveCacheEntregas`: pôr o dia na chave (e908924) parou o vazamento da rota
  // de ontem, mas passou a criar uma entrada NOVA por dia — e nada apagava as velhas. Antes a
  // chave era reaproveitada e se sobrescrevia sozinha; sem esta limpeza o aparelho acumularia
  // rota antiga até estourar o localStorage, e `writeCache` não tem proteção contra estouro.
  // Só casa a rota: `entregadores_` e `fila_transacional_v1` NÃO começam com `entregas_`, então
  // a lista de nomes, a FILA OFFLINE e o KM+foto pendentes ficam intocados.
  function limparCacheEntregasDeOutrosDias() {
    try {
      const base = cacheKey('entregas_');
      const deHoje = base + diaSP() + '_';
      const velhas = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.indexOf(base) === 0 && k.indexOf(deHoje) !== 0) velhas.push(k);
      }
      for (const k of velhas) { try { localStorage.removeItem(k); } catch (e) {} }
    } catch (e) {}
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

  function loadJSONP(url, timeoutMs = C.API_TIMEOUT_MS) {
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
      }, timeoutMs);

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

  // De QUEM é o token que vai nesta chamada. O servidor resolve o entregador PELO TOKEN e IGNORA o
  // nome mandado — então o token tem de ser o de quem FEZ o ato. Um item da fila carrega o nome de
  // quem tocou (`params.entregador`, carimbado em `enfileirarLote`); o resto da tela é do entregador
  // ATIVO. Login nunca leva token. Sem token para aquele nome = vai sem (o servidor decide).
  // (Antes: só o token do ATIVO, e nunca o de um anterior — o token da Leia sobrepunha "Entregas CD"
  // e a rota do OUTRO aparecia. Continua impossível: cada nome só usa o próprio token.)
  function tokenParaChamada(params) {
    try {
      if (params && (params.action === 'login' || params.action === 'loginAdmin')) return null;
      const alvo = nomeLimpo(params && params.entregador) || getSavedDriverName();
      const t = tokenDe(alvo);
      return t ? { token: t, nome: alvo } : null;
    } catch (e) { return null; }
  }

  function buildApiUrl(params) {
    // Aceita URL absoluta (Apps Script) OU caminho same-origin (/api/painel, no override).
    const url = new URL(C.API_URL, window.location.origin);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    const t = tokenParaChamada(params);
    if (t && !url.searchParams.has('token')) url.searchParams.set('token', t.token);
    return url.toString();
  }

  async function fetchJson(url, timeoutMs = C.API_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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

// O TOKEN do aparelho no CORPO do POST. O buildApiUrl (GET) já anexava o token; o POST não — e o
// POST é justamente por onde a FOTO sobe (base64 não cabe em querystring). Enquanto o porteiro do
// painel esteve em modo `observa` isso passou batido; quando virou `enforce` (31/07) TODO POST sem
// token passou a ser recusado com `precisaLogin` → a foto parava de subir enquanto o KM (que vai
// pelo GET, com token) subia normalmente. O entregador via "a foto não subiu, tente com sinal
// melhor" estando com sinal ótimo. Mesma regra do GET: só manda o token quando ele é do entregador
// ATIVO (senão o token de um entregador anterior agiria em nome do atual) e nunca no login.
function corpoComToken(body) {
  const b = Object.assign({}, body || {});
  if (!b.token) { const t = tokenParaChamada(b); if (t) b.token = t.token; }
  return b;
}

async function postJson(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), C.API_TIMEOUT_MS);

  try {
    // Se houver override do painel neste aparelho, posta direto pra ele (cross-origin,
    // com CORS); senão, usa o proxy do Vercel que fala com o Apps Script antigo.
    const enviado = tokenParaChamada(body); // o token que VAI nesta chamada (comparado na volta, não relido)
    const res = await fetch(C.POST_URL || '/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(corpoComToken(body)),
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    tratarPrecisaLogin(data, enviado); // mesma regra do GET: token recusado → apaga ESSE token (se ainda for o mesmo)
    return data;
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
      body: JSON.stringify(corpoComToken(body)),
      cache: 'no-store'
    }).catch(function () {});
  } catch (e) {}
}

  // 🕛 Quando o app NÃO manda `turno`, o painel CHUTA pelo relógio dele — e ele vira TARDE às
  // 12:00 enquanto o app só vira às 14:00 (`turnoPadrao`, linha 6). Nessas 2 horas a marcação de
  // uma rota da MANHÃ batia no portão que procura a rota da TARDE, era RECUSADA, o app dizia
  // "sem conexão" (page-entregas), a fila congelava atrás dela (o `else break` do consumirFila) e
  // no dia seguinte o item saía como `naoEncontrado` e era DESCARTADO calado.
  // 📏 Medido em 15/09/2026: 73 entregas de 5 entregadores sem nenhum registro. A prova foi a
  // própria rota da Ana Carolina — o `finalizarRota` das 13:45 gravou normal porque MANDA o turno,
  // enquanto as entregas dela desde 11:07 sumiram porque não mandavam.
  // A lista é exatamente a que o painel filtra por turno (portão `alvo` do route.ts).
  // Entra no `apiGet` E no `enfileirarLote` — os dois acontecem no instante do toque, então a fila
  // guarda o turno em que a entrega REALMENTE foi feita, não o de quando ela conseguir subir.
  const ACOES_QUE_PRECISAM_DO_TURNO = ['iniciarEntrega', 'marcarEntregue', 'marcarNaoEntregue', 'marcarCancelado', 'desfazer', 'definirMaquininha'];
  // 🗓️ 06/10/2026 — e o DIA também. Sem `data`, o painel usa o dia em que a marcação CHEGA: um item
  // que ficou na fila de um dia para o outro (celular sem sinal até a manhã seguinte) procurava a
  // parada no dia errado, voltava `naoEncontrado` e virava recusa numa rota que nem aparece mais na
  // tela. Só carimba quando o relógio do aparelho concorda com o dia que o SERVIDOR mandou na última
  // lista (`lembrarDiaDoServidor`): aparelho com data errada continua no comportamento de antes.
  function lembrarDiaDoServidor(dia) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) return;
    try { localStorage.setItem('app_dia_servidor_v1', String(dia)); } catch (e) {}
  }
  function diaConfiavel() {
    const d = diaSP();
    try { return localStorage.getItem('app_dia_servidor_v1') === d ? d : null; } catch (e) { return null; }
  }
  function comTurno(params) {
    if (!params || !ACOES_QUE_PRECISAM_DO_TURNO.includes(params.action)) return params;
    const extra = {};
    if (!params.turno) extra.turno = getTurno();
    if (!params.data) { const d = diaConfiavel(); if (d) extra.data = d; }
    return Object.keys(extra).length ? Object.assign({}, params, extra) : params;
  }

  async function apiGet(paramsOriginais, options) {
    const params = comTurno(paramsOriginais);
    const opt = options || {};
    const url = buildApiUrl(params);
    const enviado = tokenParaChamada(params); // o token que vai na URL — é ESTE que o `precisaLogin` da volta recusa
    // Um recebimento coletivo consulta até 20 pedidos antes da primeira gravação.
    // A fila conserva o mesmo ato; não iniciar retries enquanto a conferência ainda roda.
    // `opt.timeoutMs` existe para a ÚNICA chamada que ainda precede um diálogo do entregador (a
    // conferência de valor do pagamento na porta): lá 15 s de espera é tela morta na rua, e o
    // modal sabe seguir sem o valor conferido (o entregador digita). Ver TEMPO_CONFERIR_MS.
    const timeoutMs = Number.isFinite(opt.timeoutMs) && opt.timeoutMs > 0 ? opt.timeoutMs
      : (params && params.action === 'confirmarPagamento' ? 45000 : C.API_TIMEOUT_MS);
    const retries = Number.isFinite(opt.retries) ? opt.retries : C.API_RETRY_COUNT;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        // As DUAS frentes de 09/09 entram aqui: o timeout longo da fila (recebimento coletivo
        // consulta até 20 pedidos antes da 1ª gravação) E a limpeza do token recusado.
        const res = (C.API_MODE === 'json') ? await fetchJson(url, timeoutMs) : await loadJSONP(url, timeoutMs);
        tratarPrecisaLogin(res, enviado); // token recusado → apaga ESSE token (a home volta a pedir o PIN dele)
        return res;
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
    // O dia entra na chave: o plano B (cache vencido quando a rede falha) não pode mostrar a lista de ONTEM.
    const result = await withCache('entregadores_' + diaSP() + '_' + getTurno(), async () => {
      const res = await apiGet({ action: 'entregadores', turno: getTurno() });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erro ao carregar entregadores');
      return Array.isArray(res.items) ? res.items : [];
    });
    return result;
  }

  function chaveInicioConfirmado(entregador) {
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    return 'montagem_inicio_confirmado_v1_' + dia + '_' + getTurno() + '_' + String(entregador).trim();
  }
  function inicioConfirmado(entregador) {
    try { return localStorage.getItem(chaveInicioConfirmado(entregador)) === '1'; } catch { return false; }
  }
  function guardarInicioConfirmado(entregador, iniciado) {
    try {
      if (iniciado) localStorage.setItem(chaveInicioConfirmado(entregador), '1');
      else localStorage.removeItem(chaveInicioConfirmado(entregador));
    } catch {}
  }
  // ⭐ 06/10/2026 (revisão independente, M3) a rota JÁ FINALIZADA hoje, lembrada no aparelho (a sessão morre com o app): a home
  // não reabre direto numa rota que acabou. E a ÚLTIMA ATIVIDADE de cada entregador: só se reabre direto quem usou há pouco.
  function chaveFimConfirmado(entregador) { return 'rota_fim_confirmado_v1_' + diaSP() + '_' + getTurno() + '_' + nomeLimpo(entregador); }
  function fimConfirmado(entregador) { try { return localStorage.getItem(chaveFimConfirmado(entregador)) === '1'; } catch (e) { return false; } }
  function guardarFimConfirmado(entregador, fim) {
    try { if (fim) localStorage.setItem(chaveFimConfirmado(entregador), '1'); else localStorage.removeItem(chaveFimConfirmado(entregador)); } catch (e) {}
  }
  function marcarAtividade(entregador) { try { localStorage.setItem('app_atividade_v1_' + nomeLimpo(entregador || getSavedDriverName()), String(Date.now())); } catch (e) {} }
  function atividadeRecente(entregador, prazoMs) {
    try { const t = Number(localStorage.getItem('app_atividade_v1_' + nomeLimpo(entregador)) || 0); return t > 0 && Date.now() - t < prazoMs; } catch (e) { return false; }
  }
  function erroMontagem(res) {
    const e = new Error(res && res.error || 'Não foi possível verificar a montagem. Confira a internet e tente novamente.');
    e.bloqueioMontagem = true;
    // Distingue BLOQUEIO DE VERDADE (o servidor respondeu "tem pendência na montagem") de FALTA DE
    // RESPOSTA (sem sinal / timeout / proxy fora). Quem chama precisa saber a diferença: no primeiro
    // caso tem que PARAR; no segundo pode GUARDAR o que o entregador já fez e tentar de novo depois.
    // Antes os dois viravam a mesma coisa e o app jogava fora KM+foto por causa de sinal ruim.
    e.montagemBloqueada = !!(res && res.montagemBloqueada);
    e.semResposta = !res;
    e.pendentes = res && res.pendentes || [];
    return e;
  }
  async function verificarMontagem(entregador, permitirEmAndamento = true) {
    try {
      const res = await apiGet({ action: 'verificarMontagem', entregador, turno: getTurno() }, { retries: 0 });
      // Recusa de LOGIN sai como erro de login, antes de qualquer leitura de montagem.
      if (res && res.precisaLogin) throw erroLogin(res);
      if (res && res.montagemBloqueada) {
        guardarInicioConfirmado(entregador, false);
        throw erroMontagem(res);
      }
      if (!res || !res.ok || (!res.montagemVerificada && !res.demo)) throw erroMontagem(res);
      if (res.rotaIniciada !== undefined) guardarInicioConfirmado(entregador, res.rotaIniciada);
      return res;
    } catch (error) {
      // Sem token válido o servidor recusa TUDO — abrir pelo cache não ajudaria (nenhuma marcação
      // subiria) e transformar em "montagem" mandaria a equipe investigar o problema errado.
      if (error && error.precisaLogin) throw error;
      if (permitirEmAndamento && inicioConfirmado(entregador)) return { ok: true, rotaIniciada: true, offline: true };
      throw error.bloqueioMontagem ? error : erroMontagem();
    }
  }

// Uma consulta sob demanda na Instabuy pode ser mais nova que o espelho usado no poll.
// Preserve só o valor dessa mesma parada até a captura do espelho alcançá-la; edição ERP sempre vence.
function manterValorMaisRecente(item, anteriores) {
  const anterior = anteriores.find(x => Number(x.row) === Number(item.row) && x.pedido === item.pedido);
  if (!anterior || item.valorConferido !== true) return item;
  const consulta = Date.parse(anterior.valorConsultadoEm || '');
  const novaConsulta = Date.parse(item.valorConsultadoEm || '');
  const captura = Date.parse(item.valorFonteEm || '');
  const respostaAtrasada = Number.isFinite(consulta) && Number.isFinite(novaConsulta) && consulta > novaConsulta;
  const espelhoAtrasado = anterior.valorFonte === 'instabuy' && item.valorFonte === 'espelho' &&
    Number.isFinite(consulta) && (!Number.isFinite(captura) || captura < consulta);
  if (!respostaAtrasada && !espelhoAtrasado) return item;
  const novo = { ...item };
  for (const k of ['valor','valorConferido','valorFonte','valorFonteEm','valorConsultadoEm','valorAlterado','valorAnterior','itensRemovidos','produtos'])
    if (Object.hasOwn(anterior,k)) novo[k] = anterior[k];
  return novo;
}

async function carregarEntregasPorEntregador(entregador) {
  const cacheName = chaveCacheEntregas(entregador);

  try {
    const res = await apiGet({
      action: 'entregas',
      entregador,
      turno: getTurno()
    });

    if (res && res.precisaLogin) throw erroLogin(res); // login ≠ montagem (ver erroLogin)
    if (res && (res.montagemBloqueada || res.montagemIndisponivel)) {
      if (res.montagemBloqueada) guardarInicioConfirmado(entregador, false);
      throw erroMontagem(res);
    }
    if (!res || !res.ok) throw new Error((res && res.error) || 'Erro ao carregar entregas');
    guardarInicioConfirmado(entregador, !!res.rotaIniciada);
    lembrarDiaDoServidor(res.data);

    const ultimoCache = readCache(cacheName);
    const anteriores = ultimoCache && Array.isArray(ultimoCache.value) ? ultimoCache.value : [];
    const items = (Array.isArray(res.items) ? res.items : []).map(item => manterValorMaisRecente(item, anteriores));
    saveEntregasCache(entregador, items);

    return {
      data: items,
      stale: false,
      rotaIniciada: res.rotaIniciada || false,
      // ⛔ 10/09/2026 — ESTE CAMPO NUNCA FOI REPASSADO, e o bloco que o lê em `page-entregas.js`
      // (a reconciliação do commit e2078bf, "finalizei e depois aparece em aberto de novo") era
      // CÓDIGO MORTO desde que nasceu: `git log -S'rotaFinalizada' -- public/assets/core.js` volta
      // vazio. Sem ele, quem perde a sessão depois de finalizar vê o botão verde "🏁 Finalizar
      // rota" de novo e refaz KM + foto — e o segundo envio SOBRESCREVE o carimbo, o KM e a foto
      // do fim. Fica `undefined` quando o servidor não manda: a tela só desfaz com `=== false`.
      rotaFinalizada: res.rotaFinalizada,
      rotaInfo: res.rotaInfo || null,
      // Pagamento na porta (05/09): o servidor diz se PERGUNTA (cofre ENTREGADOR_CONFIRMA_PAGAMENTO
      // ≥ 1) e manda a lista de formas do banco — o app não tem lista escrita nele. Só vem na
      // resposta FRESCA; no cache (stale) a tela mantém a última configuração que viu.
      pgConfig: { perguntar: res.perguntarPagamento === true, formas: Array.isArray(res.formasNaPorta) ? res.formasNaPorta : [],
        // 06/10/2026: UMA pergunta só ("O cliente te pagou de alguma forma?"). Quem liga é o servidor
        // (cofre ENTREGADOR_PAGAMENTO_SIMPLES); servidor antigo não manda o campo = fluxo de antes.
        simples: res.pagamentoSimples === true, opcoes: Array.isArray(res.pagamentoSimplesOpcoes) ? res.pagamentoSimplesOpcoes : null },
      // 06/10/2026 — maquininha da rota. `maquininhas` = cadastro ativo (Logística › Maquininhas);
      // `maquininha` = a que o servidor já tem para este entregador/dia/turno; `precisaMaquininha`
      // = a rota tem pagamento na entrega (false = "Não levei" automático; null = não deu para saber).
      maquininhas: Array.isArray(res.maquininhas) ? res.maquininhas : null,
      maquininha: res.maquininha === undefined ? undefined : (res.maquininha || null),
      // ⛔ (revisão independente de 06/10, BLOQUEADOR) servidor que NÃO conhece a maquininha (o painel antigo durante o deploy) não
      // manda o campo: fica `undefined` e o app NÃO pergunta nada (perguntar com a lista vazia gravaria "não levei" falso para todos)
      servidorTemMaquininha: Object.prototype.hasOwnProperty.call(res, 'precisaMaquininha'),
      precisaMaquininha: typeof res.precisaMaquininha === 'boolean' ? res.precisaMaquininha : (Object.prototype.hasOwnProperty.call(res, 'precisaMaquininha') ? null : undefined)
    };
  } catch (error) {
    // Recusa de LOGIN sobe como está: nem cache, nem "montagem". A tela manda pedir o PIN.
    if (error && error.precisaLogin) throw error;
    // Só uma rota cujo INÍCIO foi confirmado pelo servidor hoje pode abrir offline.
    if (!inicioConfirmado(entregador)) throw error.bloqueioMontagem ? error : erroMontagem();
    const cached = getFreshCache(cacheName) || readCache(cacheName);

    if (cached) {
      const value = cached.value !== undefined ? cached.value : cached;
      if (Array.isArray(value)) {
        return {
          data: value.map(item => ({ ...item, valorConferido: false })),
          stale: true
        };
      }
    }

    throw error;
  }
}

// Poll leve e separado da lista: cancelamento urgente não espera o refresh de 60 s
// e uma Instabuy lenta não congela os cards nem o envio da fila offline.
async function carregarCancelamentosDaRota(entregador) {
  const res = await apiGet({ action: 'cancelamentos', entregador, turno: getTurno() });
  if (res && res.precisaLogin) throw erroLogin(res);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Erro ao carregar cancelamentos');
  return Array.isArray(res.avisos) ? res.avisos : [];
}

  // Posição instantânea do celular (best-effort). Aceita um fix recente (maximumAge) pra NÃO travar
  // a marcação esperando GPS. Tenta o nativo (Capacitor) e cai no navegador. Devolve {lat,lng,precisao} ou null.
  async function posicaoAtual() {
    try {
      var Cap = window.Capacitor;
      if (Cap && Cap.Plugins && Cap.Plugins.Geolocation && Cap.isNativePlatform && Cap.isNativePlatform()) {
        var pn = await Cap.Plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 4000, maximumAge: 60000 });
        if (pn && pn.coords) return { lat: pn.coords.latitude, lng: pn.coords.longitude, precisao: pn.coords.accuracy };
      }
    } catch (e) {}
    try {
      if (navigator.geolocation) {
        return await new Promise(function (resolve) {
          var done = false;
          var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 4000);
          navigator.geolocation.getCurrentPosition(
            function (pos) { if (done) return; done = true; clearTimeout(t); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precisao: pos.coords.accuracy }); },
            function () { if (done) return; done = true; clearTimeout(t); resolve(null); },
            { enableHighAccuracy: true, timeout: 4000, maximumAge: 60000 }
          );
        });
      }
    } catch (e) {}
    return null;
  }

  // Escritas de status: 3 tentativas (rede de celular oscila). É seguro repetir
  // porque marcar a mesma linha de novo grava o mesmo valor (não duplica nada).
  async function apiIniciarEntrega(row) {
    return apiGet({ action: 'iniciarEntrega', row }, { retries: 3 });
  }

  async function apiMarcarEntregue(row, obs) {
    // ts_device = hora do CELULAR no toque; entregue_lat/lng = ONDE ele estava (anti-fraude, pra
    // cruzar depois com o endereço do cliente). Tudo best-effort: sem GPS, manda só a hora.
    var params = { action: 'marcarEntregue', row: row, obs: obs || '', ts_device: new Date().toISOString() };
    try {
      var pos = await posicaoAtual();
      if (pos) { params.entregue_lat = pos.lat; params.entregue_lng = pos.lng; if (pos.precisao != null) params.entregue_precisao = Math.round(pos.precisao); }
    } catch (e) {}
    return apiGet(params, { retries: 3 });
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

  // ===== Fila do aparelho: IndexedDB é a autoridade; o snapshot só serve à renderização =====
  const bancoFila = window.FilaDuravel && window.FilaDuravel.criar({
    nome: (C.STORAGE_CACHE_PREFIX || 'entregas_') + 'fila_transacional_v1',
    chaveLegada: (C.STORAGE_CACHE_PREFIX || '') + 'fila_v1',
    onChange: () => {
      if (window.dispatchEvent && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('fila-entregas-mudou'));
    }
  });
  async function filaPronta() {
    if (!bancoFila) throw new Error('O armazenamento de entregas não foi carregado. Reabra o aplicativo.');
    await bancoFila.pronta();
  }
  function filaEstado() { return bancoFila ? bancoFila.estado() : { pronta: false, erro: 'Armazenamento indisponível' }; }
  // `comTurno` aqui (e não na hora de enviar) é o que faz a fila carimbar o turno do TOQUE: um item
  // que só conseguir subir às 15h continua dizendo que a entrega foi da MANHÃ. Ver `comTurno`.
  // E carimba QUEM tocou (`entregador`): é por ele que o envio escolhe o token (`tokenParaChamada`).
  // Sem isto, um item de A guardado antes de "Trocar entregador" subiria com o token de B.
  async function enfileirarLote(entradas) {
    await filaPronta();
    const quem = getSavedDriverName();
    return bancoFila.adicionar((entradas || []).map(e => {
      const p = comTurno(e && e.params);
      return Object.assign({}, e, { params: (p && !p.entregador && quem) ? Object.assign({}, p, { entregador: quem }) : p });
    }));
  }
  // Um item da fila só sobe com o token de quem o fez. Item de OUTRO entregador sem token guardado
  // neste aparelho espera (ele entra de novo e sobe sozinho) — nunca vai com o token errado.
  function podeEnviarAgora(item) {
    const dono = nomeLimpo(item && item.params && item.params.entregador);
    if (!dono || dono === getSavedDriverName()) return true;
    return !!tokenDe(dono);
  }
  async function enfileirar(params, meta) { return (await enfileirarLote([{ params, meta }]))[0]; }
  async function filaPorIds(ids) {
    await filaPronta();const alvo = new Set(ids);return (await bancoFila.ler()).filter(x => alvo.has(x.id));
  }
  // ⭐ (revisão independente de 06/10, M5) marcações de OUTRO entregador presas neste aparelho por falta do PIN dele (o servidor
  // recusou o token, ou ele nunca entrou aqui): a home MOSTRA, para ele entrar com o PIN e elas subirem. [{ nome, n }]
  function filaPresaDeOutros() {
    const fila = bancoFila && bancoFila.snapshot();
    if (!fila) return [];
    const ativo = getSavedDriverName(), por = new Map();
    fila.forEach(x => {
      const dono = nomeLimpo(x && x.params && x.params.entregador);
      if (!dono || dono === ativo || tokenDe(dono)) return;
      por.set(dono, (por.get(dono) || 0) + 1);
    });
    return [...por].map(([nome, n]) => ({ nome, n }));
  }
  // Só o que é do entregador ATIVO (ou item antigo, sem dono): a fila guardada por OUTRO entregador
  // neste aparelho não pode impedir a tela de saber que a fila DESTE esvaziou.
  function doAtivo(x) {
    const dono = nomeLimpo(x && x.params && x.params.entregador);
    return !dono || dono === getSavedDriverName();
  }
  function filaRowsPendentes() {
    const fila = bancoFila && bancoFila.snapshot();
    if (fila === null || !bancoFila) return null; // desconhecida não é uma fila vazia
    return new Set(fila.filter(doAtivo).map(x => Number(x.meta && x.meta.row)).filter(Boolean));
  }
  function filaParamsPendentes(row, action) {
    let achado = null;const fila = bancoFila && bancoFila.snapshot();
    if (!fila) return null;
    fila.forEach(x => {
      if (x.params.action === action && Number(x.params.row) === Number(row))
        achado = { ...x.params, pg_recusado: !!x.precisaCorrigir, pg_recusa: x.erro || null };
    });
    return achado;
  }

  // ===== 23/09/2026 — A FILA VIROU O CAMINHO NORMAL DO TOQUE =====
  // Até hoje o dedo do entregador esperava a REDE: `handleAction` desabilitava os botões, mandava
  // `apiGet(..., {retries:3})` POR LINHA em série e só caía na fila quando a chamada FALHAVA — com
  // sinal ruim, 3 tentativas × 15 s de timeout = dezenas de segundos de botão morto. Era a queixa
  // do dono: "clica em ENTREGUE, demora, às vezes não vai, aí tem que clicar de novo depois".
  // Agora o toque grava na fila durável (IndexedDB) e a TELA É PINTADA A PARTIR DA FILA. Nenhuma
  // chamada de rede fica no caminho do dedo.
  //
  // Estas são as ações que MUDAM O STATUS de uma parada (as do cartão). O pagamento na porta NÃO
  // entra aqui: ele tem estado próprio (`filaParamsPendentes`) e regras de dinheiro próprias.
  const ACOES_DE_STATUS = Object.freeze({
    iniciarEntrega: 'Indo para entrega',
    marcarEntregue: 'Entregue',
    marcarNaoEntregue: 'Não entregue',
    marcarCancelado: 'Cancelado',
    desfazer: ''
  });
  // Projeção da fila sobre a lista que veio do servidor: row -> o que o aparelho JÁ registrou.
  // `alvo` = status que o toque declarou (a tela pinta ele na hora, sem rede).
  // `anterior` = status que a parada tinha ANTES do toque, congelado no meta do item no instante da
  //   gravação. É com ele que a tela DESFAZ só aquele item quando o servidor recusa.
  // Vale a ÚLTIMA declaração de cada row (a fila é lida em ordem transacional), que é o que o
  // entregador tocou por último. Devolve `null` — e não um mapa vazio — enquanto a fila não
  // hidratou: "não sei" não pode virar "não tem nada guardado".
  function filaStatusPendentes() {
    const fila = bancoFila && bancoFila.snapshot();
    if (!bancoFila || fila === null) return null;
    const mapa = new Map();
    fila.forEach(x => {
      const acao = x.params && x.params.action;
      if (!Object.prototype.hasOwnProperty.call(ACOES_DE_STATUS, acao)) return;
      if (!doAtivo(x)) return; // (revisão de 06/10, menor 8) a intenção guardada por OUTRO entregador não pinta este cartão
      const row = Number(x.params.row);
      if (!row) return;
      const meta = x.meta || {};
      mapa.set(row, {
        id: x.id, row, action: acao,
        alvo: ACOES_DE_STATUS[acao],
        obsAlvo: x.params.obs || '',
        // Item legado (gravado antes deste commit) não tem `statusAnterior`: aí a tela não inventa
        // um estado anterior — devolve undefined e quem lê cai no status do servidor.
        anterior: Object.prototype.hasOwnProperty.call(meta, 'statusAnterior') ? meta.statusAnterior : undefined,
        obsAnterior: meta.obsAnterior,
        recusado: !!x.precisaCorrigir,
        erro: x.erro || null,
        // Quantos ciclos seguidos este item tentou subir e o servidor devolveu `ok:false` ambíguo.
        // NÃO é recusa e NÃO desfaz nada: serve só para o selo do cartão parar de dizer
        // "enviando…" e passar a dizer a verdade ("ainda não enviou"). Ver `consumirFila`.
        tentativas: tentativasDoItem(x.id)
      });
    });
    return mapa;
  }
  // Tira da fila um item de STATUS que o servidor recusou, depois que o entregador leu o motivo.
  // Só de status: uma recusa de PAGAMENTO continua exigindo correção (regra de dinheiro intocada).
  // ⛔ ISTO APAGA A MARCAÇÃO DO APARELHO. Por isso só pode alcançar uma recusa DETERMINÍSTICA —
  // `naoEncontrado`, em que o servidor DISSE que aquela parada não é desta rota/turno. Um
  // `ok:false` ambíguo (servidor engasgado) NUNCA chega aqui: ele não marca `precisaCorrigir`,
  // continua na fila e continua sendo reenviado. Ver `consumirFila`.
  async function filaDescartarStatus(id) {
    await filaPronta();
    const item = (await bancoFila.ler()).find(x => x.id === id);
    if (!item || !item.precisaCorrigir) return false;
    if (!Object.prototype.hasOwnProperty.call(ACOES_DE_STATUS, item.params && item.params.action)) return false;
    await bancoFila.ack(id);
    return true;
  }
  let _processamentoFila = null;
  function processarFila() {
    if (_processamentoFila) return _processamentoFila;
    _keepaliveFeito = false; // o app voltou a viver: o disparo de fechamento pode acontecer de novo
    _processamentoFila = filaPronta().then(() => bancoFila.exclusivo(consumirFila)).catch(error => {
      console.error('[fila]', error);
      return { erroArmazenamento: 'Não foi possível atualizar a fila do aparelho. As declarações precisam de conferência.' };
    }).finally(() => { _processamentoFila = null; });
    return _processamentoFila;
  }
  // ⛔ 23/09/2026 (2ª volta) — AQUI EXISTIA `MAX_AMBIGUAS_STATUS = 12`: depois de 12 ciclos sem
  // passar, um `ok:false` AMBÍGUO virava RECUSA DURÁVEL, a tela desfazia a marcação e o único botão
  // oferecido ("Entendi") APAGAVA a declaração do aparelho. Só que o catch de topo do painel devolve
  // QUALQUER exceção como `{ok:false, error:<técnico>}` com HTTP 200: "o servidor disse não" e "o
  // servidor engasgou" são o MESMO texto. Uma janela de deploy/banco fora transformava a entrega
  // REAL do entregador em "o sistema não aceitou", ele tocava Entendi e a informação morria — o
  // oposto do "nunca perder". E o contador era por CICLO de dreno, não por tempo: todo toque dispara
  // um dreno, então "12 ciclos" eram 12 paradas de rota, não os ~12 min que o comentário prometia.
  //
  // Agora ambíguo NUNCA vira recusa. Ele continua na fila, continua sendo reenviado para sempre, e
  // a única coisa que muda é o SELO do cartão: depois de N ciclos ele para de dizer "enviando…" e
  // passa a dizer "ainda não enviou". Quem desfaz a tela é só a recusa DETERMINÍSTICA do servidor
  // (`naoEncontrado`). Contagem em memória, por item; reabrir o app zera — é só texto de selo.
  const AVISAR_NAO_PASSOU = 3;
  const _naoPassaram = new Map();
  function tentativasDoItem(id) { return _naoPassaram.get(id) || 0; }
  async function consumirFila(continua) {
    const tentados = new Set();
    // ⛔ 23/09/2026 (2ª volta) — A ORDEM DENTRO DA MESMA PARADA É SAGRADA. O `continue` que
    // consertou o CONGELAMENTO da fila (um item envenenado travava todos os de trás) deixava o item
    // SEGUINTE DA MESMA row passar na frente do que falhou; no ciclo seguinte o pulado subia por
    // cima e o efeito final no servidor virava a intenção ANTIGA. Em português de rua: o entregador
    // aperta Entregue sem querer, toca DESFAZER, vê a tela certa — e o escritório recebe "Entregue",
    // com o pagamento já anulado pelo desfazer. O mesmo pulo mandava o `confirmarPagamento` na
    // frente do `marcarEntregue` do mesmo pedido, contra o que o painel documenta por escrito
    // (erp-pagamento-na-entrega.ts: "a fila é FIFO e PARA no primeiro ok:false").
    // Conserto: o pulo vale só para OUTRAS paradas. A row do item que não passou fica bloqueada
    // até o próximo ciclo, então dentro de uma parada a fila continua estritamente FIFO.
    const rowsBloqueadas = new Set();
    const bloquearRow = it => { const r = Number(it.params && it.params.row); if (r) rowsBloqueadas.add(r); };
    for (;;) {
      const item = (await bancoFila.ler()).find(x => !x.precisaCorrigir && !tentados.has(x.id) &&
        !rowsBloqueadas.has(Number(x.params && x.params.row)) && podeEnviarAgora(x));
      if (!item || !await continua()) break;
      tentados.add(item.id);
      const pagamento = item.params.action === 'confirmarPagamento';
      let res;
      try { res = await apiGet(item.params, { retries: 1 }); }
      catch (error) {
        // Exceção = sem resposta (sem sinal, timeout, proxy fora). Não é recusa: nada é perdido,
        // nada é marcado, e parar aqui é certo — se a rede caiu, os itens de trás também não vão.
        if (pagamento) await bancoFila.marcarReenvio(item.id);
        break;
      }
      if (pagamento && res && res.ok && res.pagamento && res.pagamento.gravado === false) {
        await bancoFila.recusar(item.id, res.pagamento.porque || 'Pagamento precisa de correção.');
      } else if (res && res.ok) {
        if (pagamento && (!res.pagamento || res.pagamento.gravado !== true)) {
          await bancoFila.marcarReenvio(item.id);bloquearRow(item);continue;
        }
        _naoPassaram.delete(item.id);
        await bancoFila.ack(item.id);
      } else if (res && res.naoEncontrado && pagamento) {
        _naoPassaram.delete(item.id);
        await bancoFila.recusar(item.id, 'Entrega não encontrada. A equipe precisa conferir este pagamento.');
      } else if (res && res.naoEncontrado) {
        // ⛔ 23/09/2026 — ATÉ HOJE ISTO ERA `ack`: a marcação era DESCARTADA EM SILÊNCIO e a tela
        // continuava VERDE para uma parada que o servidor tinha recusado (tirada da rota, refeita,
        // ou de outro turno). O entregador nunca sabia; o escritório também não. Agora vira recusa
        // durável: a tela desfaz SÓ aquele item e mostra o motivo, sem modal que trave a rua.
        // É a ÚNICA recusa de status que existe — e por ser DETERMINÍSTICA (o servidor procurou e
        // disse que a parada não é desta rota/turno) é a única que o "Entendi" pode descartar.
        _naoPassaram.delete(item.id);
        await bancoFila.recusar(item.id, (res.error && String(res.error)) ||
          'Esta parada não está mais na sua rota. Se você entregou, avise o escritório.');
      } else if (pagamento) {
        await bancoFila.marcarReenvio(item.id);bloquearRow(item);continue;
      } else if (res && (res.precisaLogin || res.montagemBloqueada || res.montagemIndisponivel)) {
        // Porteiro fechado (login/montagem/rota não iniciada): NÃO é recusa deste ato e vale para a
        // fila inteira. Guarda tudo como está e para — o próximo ciclo tenta de novo.
        break;
      } else {
        // `ok:false` AMBÍGUO — pode ser recusa e pode ser o servidor engasgado; o painel devolve os
        // dois com o mesmo formato. Então: não descarta, não recusa, não desfaz a tela. Conta a
        // tentativa (só para o selo do cartão ficar honesto), bloqueia ESTA parada até o próximo
        // ciclo e segue para as OUTRAS — que é o conserto do congelamento da fila sem inverter a
        // ordem dentro da parada. O item continua guardado e continua sendo reenviado para sempre.
        _naoPassaram.set(item.id, tentativasDoItem(item.id) + 1);
        bloquearRow(item);
        continue;
      }
    }
    try { await reenviarRotaPendente(); } catch (e) {}
    return { erroArmazenamento: null };
  }

  // ===== FECHOU O APP COM COISA NA FILA =====
  // `keepalive` deixa o navegador terminar a requisição depois que a página morre. É o último
  // recurso do "nunca perder": a fila já garante o reenvio ao reabrir, isto só encurta a espera.
  // Regras para não virar fonte de erro:
  //  - só ações de STATUS (marcar a mesma linha de novo grava o mesmo valor; é idempotente);
  //  - só rows com UMA única declaração pendente — duas (ex.: Entregue depois Desfazer) chegariam
  //    sem ordem garantida e o resultado final poderia ficar invertido;
  //  - NENHUM ack é escrito: sem resposta não há prova de gravação, então o item continua na fila
  //    e sobe de novo no próximo ciclo (o servidor aguenta, é update).
  const MAX_KEEPALIVE = 6;
  let _keepaliveFeito = false;
  function enviarPendentesNoFechamento() {
    try {
      if (_keepaliveFeito || C.API_MODE !== 'json') return 0;
      const fila = bancoFila && bancoFila.snapshot();
      if (!fila || !fila.length) return 0;
      const porRow = new Map();
      fila.forEach(x => {
        const acao = x.params && x.params.action;
        if (x.precisaCorrigir || !Object.prototype.hasOwnProperty.call(ACOES_DE_STATUS, acao)) return;
        if (!podeEnviarAgora(x)) return; // item de outro entregador sem token aqui: espera, nunca vai com o token errado
        const row = Number(x.params.row);
        if (!row) return;
        porRow.set(row, (porRow.get(row) || []).concat([x]));
      });
      let enviados = 0;
      for (const itens of porRow.values()) {
        if (enviados >= MAX_KEEPALIVE) break;
        if (itens.length !== 1) continue; // ambíguo na ordem → deixa para o consumidor serial
        try { fetch(buildApiUrl(itens[0].params), { method: 'GET', keepalive: true, cache: 'no-store' }).catch(function () {}); enviados++; }
        catch (e) { /* o item continua na fila */ }
      }
      if (enviados) _keepaliveFeito = true;
      return enviados;
    } catch (e) { return 0; }
  }

  async function abrirWhatsapp(row) {
  const res = await apiGet({ action: 'whatsapp', row }, { retries: 0 });

  // O painel RECUSOU e escreveu um texto PRA O ENTREGADOR (ex.: telefone do cliente fora do padrão →
  // não abre, pra não mandar mensagem pra um estranho). Só mostramos a mensagem quando ela vem com
  // `aoEntregador` — o catch de topo da rota devolve `error` com a mensagem TÉCNICA da exceção, e isso
  // não pode aparecer na tela de quem está na rua. Sem a marca, cai no genérico "tente de novo".
  if (res && res.ok === false && res.aoEntregador && res.error) {
    const err = new Error(String(res.error));
    err.doServidor = true;
    throw err;
  }
  if (!res || !res.ok || !res.url) {
    throw new Error('Não foi possível abrir o WhatsApp');
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

// ===== INICIAR/FINALIZAR ROTA — À PROVA DE QUEDA DE CONEXÃO =====
// O KM + foto são PERSISTIDOS no localStorage ANTES de tentar enviar. Se a internet cair, NADA se
// perde: fica salvo e reenvia sozinho (reenviarRotaPendente roda dentro do processarFila = poll +
// online + abrir o app). Nunca lança erro nem finge sucesso. Chave por fase ('inicio'|'fim').
// ⛔ 06/10/2026 — A CHAVE ERA SÓ A FASE ('inicio'|'fim'), UMA POR APARELHO. Com o celular trocando de
// mão, o "iniciar" pendente de A fazia B ouvir "Você já iniciou a rota" (e não conseguir iniciar a
// dele), e o reenvio subia o KM/foto de A com o token de B — o servidor gravava na rota de B. Agora a
// chave é POR ENTREGADOR, e o reenvio usa o token de quem fez (`corpoComToken` lê `entregador`).
// A chave antiga (sem nome) é migrada na primeira leitura, pelo nome que está dentro dela.
const PREFIXO_ROTA_PEND = C.STORAGE_CACHE_PREFIX + 'rota_pend_';
function rotaPendKey(fase, entregador) { return PREFIXO_ROTA_PEND + fase + '|' + nomeLimpo(entregador); }
function migrarRotaPendLegada(fase) {
  try {
    const velha = PREFIXO_ROTA_PEND + fase;
    const raw = localStorage.getItem(velha);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p && p.entregador) {
      const atual = localStorage.getItem(rotaPendKey(fase, p.entregador));
      let novo = !atual;
      // (revisão de 06/10, menor 7) já existe a chave nova (voltou de uma versão anterior do app?): fica o toque MAIS NOVO
      if (atual) { try { novo = String(p.ts_device || '') > String(JSON.parse(atual).ts_device || ''); } catch (e) { novo = false; } }
      if (novo) localStorage.setItem(rotaPendKey(fase, p.entregador), raw);
    }
    localStorage.removeItem(velha);
  } catch (e) {}
}
function salvarRotaPend(fase, payload) {
  const chave = rotaPendKey(fase, payload && payload.entregador);
  try { localStorage.setItem(chave, JSON.stringify(payload)); return true; }
  catch (e) {
    // localStorage cheio (foto grande) → guarda SEM a foto, pra ao menos o KM não se perder.
    try { localStorage.setItem(chave, JSON.stringify(Object.assign({}, payload, { fotoBase64: '' }))); } catch (e2) {}
    return false;
  }
}
function lerRotaPend(fase, entregador) {
  migrarRotaPendLegada(fase);
  try { return JSON.parse(localStorage.getItem(rotaPendKey(fase, entregador !== undefined ? entregador : getSavedDriverName())) || 'null'); } catch (e) { return null; }
}
function limparRotaPend(fase, entregador) { try { localStorage.removeItem(rotaPendKey(fase, entregador !== undefined ? entregador : getSavedDriverName())); } catch (e) {} }
// Todos os pendentes guardados neste aparelho, de qualquer entregador: [{ fase, entregador, payload }].
function todosRotaPend() {
  migrarRotaPendLegada('inicio'); migrarRotaPendLegada('fim');
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(PREFIXO_ROTA_PEND) !== 0) continue;
      const resto = k.slice(PREFIXO_ROTA_PEND.length), bar = resto.indexOf('|');
      if (bar < 0) continue;
      let payload = null; try { payload = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
      if (payload) out.push({ fase: resto.slice(0, bar), entregador: resto.slice(bar + 1), payload });
    }
  } catch (e) {}
  return out;
}
function temRotaPendente() { return !!(lerRotaPend('inicio') || lerRotaPend('fim')); }
// `pendente` = tem algo salvo esperando subir. `desistiu` = já tentou sozinho MAX_TENTATIVAS_FOTO
// vezes e parou — a tela NÃO pode mais dizer "sobe sozinho", tem que pedir ação de gente.
function statusRotaPendente() {
  const i = lerRotaPend('inicio');
  const f = lerRotaPend('fim');
  return { pendente: !!(i || f), desistiu: !!((i && i.desistiu) || (f && f.desistiu)) };
}
// Já existe um iniciar/finalizar SALVO nesta fase específica, esperando subir? Usado pra NÃO pedir
// KM/foto de novo (e não sobrescrever o que já está na fila) quando a tela reabre "como se" nada
// tivesse sido feito — a causa raiz de pedir foto 2x.
// Só bloqueia enquanto ainda há esperança de subir sozinho. Se já desistiu, o entregador PODE
// refazer (tirar a foto de novo) — o KM dessa tentativa já subiu, então não se perde nada.
function temRotaPendenteFase(fase) { const p = lerRotaPend(fase); return !!(p && !p.desistiu); }

// Envia UM payload de rota (iniciar/finalizar). NUNCA lança. Devolve o res (ok), `{ok:false,
// precisaLogin:true}` quando o porteiro recusou, ou null (não subiu).
// Com foto: POST 2x; se não subir, tenta salvar SÓ o KM (sem foto) pra a rota ao menos fechar.
async function enviarRotaPayload(payload) {
  let recusadoPorLogin = false;
  // ⛔ 10/09/2026 — RECUSA DO SERVIDOR VIRAVA "VOCÊ ESTÁ SEM INTERNET".
  // Só três respostas eram distinguidas: ok, precisaLogin e montagem*. Qualquer outro
  // `{ok:false, error:...}` — "Rota não iniciada neste turno", validação, exceção do servidor —
  // caía no mesmo `return null` de "não subiu". A tela então afirmava "SALVA ✅ … você está sem
  // internet … pode fechar o app" com sinal cheio, o fim nunca era gravado, e a cada poll a foto
  // subia de novo para ser recusada de novo, para sempre. Agora a recusa sobe como recusa.
  const recusa = (res) => (res && res.ok === false && res.error && !res.precisaLogin && !res.tentarDepois
    && !res.montagemBloqueada && !res.montagemIndisponivel)
    ? Object.assign({}, res, { recusadoPeloServidor: true }) : null;
  let recusadoPeloServidor = null;
  if (payload && payload.fotoBase64) {
    for (let i = 0; i < 2; i += 1) {
      try {
        const res = await postJson(payload);
        if (res && (res.montagemBloqueada || res.montagemIndisponivel)) return res;
        if (res && res.ok) return res;
        // Recusa do PORTEIRO não é falta de sinal: repetir o upload da foto não muda nada
        // (só gasta dados e tempo do entregador). Para na hora e avisa quem chamou.
        if (res && res.precisaLogin) { recusadoPorLogin = true; break; }
        // Recusa de NEGÓCIO também não melhora com repetição: o servidor respondeu e disse não.
        const r = recusa(res); if (r) { recusadoPeloServidor = r; break; }
      } catch (e) { /* tenta de novo */ }
      await sleep(800 * (i + 1));
    }
    const semF = { action: payload.action, entregador: payload.entregador, turno: payload.turno };
    if (payload.data) semF.data = payload.data;
    if (payload.kmInicial != null) semF.kmInicial = payload.kmInicial;
    if (payload.kmFinal != null) semF.kmFinal = payload.kmFinal;
    if (payload.ts_device) semF.ts_device = payload.ts_device; // preserva a hora do CLIQUE mesmo no fallback sem foto
    try {
      const res = await apiGet(semF, { retries: 1 });
      if (res && (res.montagemBloqueada || res.montagemIndisponivel)) return res;
      if (res && res.ok) return Object.assign({}, res, { semFoto: true });
      if (res && res.precisaLogin) recusadoPorLogin = true;
      recusadoPeloServidor = recusa(res) || recusadoPeloServidor;
    } catch (e) {}
    if (recusadoPorLogin) return { ok: false, precisaLogin: true };
    return recusadoPeloServidor || null;
  }
  const semF2 = { action: payload.action, entregador: payload.entregador, turno: payload.turno };
  if (payload.data) semF2.data = payload.data;
  if (payload.kmInicial != null) semF2.kmInicial = payload.kmInicial;
  if (payload.kmFinal != null) semF2.kmFinal = payload.kmFinal;
  if (payload.ts_device) semF2.ts_device = payload.ts_device;
  try {
    const res = await apiGet(semF2, { retries: 1 });
    if (res && (res.montagemBloqueada || res.montagemIndisponivel)) return res;
    if (res && res.ok) return res;
    if (res && res.precisaLogin) recusadoPorLogin = true;
    recusadoPeloServidor = recusa(res) || recusadoPeloServidor;
  } catch (e) {}
  if (recusadoPorLogin) return { ok: false, precisaLogin: true };
  return recusadoPeloServidor || null;
}

// Quantas vezes o app tenta subir SOZINHO uma foto que ficou pra trás (o poll roda a cada 60s,
// então ~20 tentativas ≈ 20 min). Depois disso ele PARA de tentar sozinho — mas NÃO joga a foto
// fora: ela continua salva e a tela mostra o aviso pra reenviar na mão / avisar o supervisor.
const MAX_TENTATIVAS_FOTO = 20;

// Reenvia o que ficou pendente de iniciar/finalizar (chamado dentro do processarFila).
// ⛔ (revisão independente de 06/10, menor 2) o iniciar/finalizar que a TELA está enviando agora não é reenviado em paralelo pela
// fila (duas fotos subindo juntas com sinal ruim, e uma gravação velha de `tentativas` ressuscitando o pendente já limpo).
const _rotaEmVoo = new Set();
async function comRotaEmVoo(fase, entregador, trabalho) {
  const k = fase + '|' + nomeLimpo(entregador);
  _rotaEmVoo.add(k);
  try { return await trabalho(); } finally { _rotaEmVoo.delete(k); }
}
async function reenviarRotaPendente() {
  // De TODOS os entregadores que usaram este aparelho, cada um com o próprio token. O de quem não
  // tem token guardado aqui espera (subiria sem identidade e o servidor recusaria).
  for (const { fase, entregador, payload: p } of todosRotaPend()) {
    if (!p || p.desistiu) continue;
    if (_rotaEmVoo.has(fase + '|' + nomeLimpo(entregador))) continue;
    if (entregador !== getSavedDriverName() && !tokenDe(entregador)) continue;
    const res = await enviarRotaPayload(p);
    if (!res || !res.ok) continue;                                       // nem o KM subiu → tenta de novo depois
    if (!res.semFoto || !p.fotoBase64) { limparRotaPend(fase, entregador); continue; } // subiu inteiro → limpa
    // O KM subiu e a FOTO não. Antes isto era tratado como sucesso e a foto era APAGADA do
    // aparelho (perdida de vez). Agora ela fica salva e continua tentando sozinha.
    const n = Number(p.tentativas || 0) + 1;
    salvarRotaPend(fase, Object.assign({}, p, { tentativas: n, desistiu: n >= MAX_TENTATIVAS_FOTO }));
  }
}

function apiIniciarRota(entregador, kmInicial, fotoBase64, fotoMimeType) {
  // ⚠️ SÍNCRONO até salvar o KM/foto (o `_apiIniciarRota` grava antes do 1º await): quem chama pode abrir um diálogo DEPOIS de
  // chamar e o KM/foto já estão no aparelho (ver o modal da maquininha em page-entregas.js).
  return comRotaEmVoo('inicio', entregador, () => _apiIniciarRota(entregador, kmInicial, fotoBase64, fotoMimeType));
}
async function _apiIniciarRota(entregador, kmInicial, fotoBase64, fotoMimeType) {
  // ts_device = hora do CELULAR no toque (mesma proteção do marcarEntregue): se ficar na fila e
  // reenviar só depois, o carimbo continua sendo o do CLIQUE, não o do reenvio.
  const payload = { action: 'iniciarRota', entregador: entregador, kmInicial: kmInicial, turno: getTurno(), fotoBase64: fotoBase64 || '', fotoMimeType: fotoMimeType || 'image/jpeg', ts_device: new Date().toISOString() };
  { const d = diaConfiavel(); if (d) payload.data = d; } // o dia do TOQUE (ver comTurno): reenviado amanhã, não vira o início de amanhã
  // 1) PERSISTE ANTES DE QUALQUER REDE. Regressão de 08/09 (commit 71d469e): a conferência da
  //    montagem entrou ANTES deste salvar, e como ela lança quando não há resposta, KM + foto (que
  //    só existiam na memória) iam pro lixo. Cenário real: garagem do CD, sinal ruim, o entregador
  //    digita o KM, tira a foto, toca Iniciar, 15s depois "não foi possível verificar a montagem" —
  //    e tinha que refazer tudo. Salvo aqui, nada mais se perde, aconteça o que acontecer abaixo.
  const salvouCompleto = salvarRotaPend('inicio', payload);
  // 2) Confere a montagem (best-effort). BLOQUEIO de verdade (o servidor disse "tem pendência") →
  //    para aqui, sem subir foto à toa (o servidor recusaria de qualquer jeito). SEM RESPOSTA (sem
  //    sinal, timeout) → NÃO para: o próprio iniciarRota é conferido de novo no servidor, então
  //    seguir é seguro; e se o envio também não subir, fica salvo e reenvia sozinho (processarFila).
  //    A tela já conferiu a montagem ANTES de pedir KM/foto (page-entregas.js) — esta é a 2ª rede.
  try { await verificarMontagem(entregador, false); }
  catch (e) {
    if (e && e.montagemBloqueada) {
      salvarRotaPend('inicio', Object.assign({}, payload, { desistiu: true }));
      throw e;
    }
    // sem resposta → segue pro envio (o servidor confere a montagem no iniciarRota)
  }
  espelharNoPainel(payload);
  const res = await enviarRotaPayload(payload);
  if (res && (res.montagemBloqueada || res.montagemIndisponivel)) {
    salvarRotaPend(payload.action === "iniciarRota" ? "inicio" : "fim", Object.assign({}, payload, { desistiu: true }));
    throw erroMontagem(res);
  }
  if (res && res.ok) guardarInicioConfirmado(entregador, true); // o servidor confirmou o início, mesmo se a foto ficou pendente
  if (res && res.ok && !res.semFoto) { limparRotaPend('inicio', entregador); return res; }
  if (res && res.ok) return res; // KM subiu, foto NÃO → deixa salva no aparelho pra subir sozinha
  // O servidor RESPONDEU e recusou: não é falta de sinal. Mentir "salvo, sobe sozinho" fazia o
  // entregador fechar o app achando que estava resolvido, e a foto era reenviada a cada poll para
  // ser recusada de novo, sem fim. Marca `desistiu` (para o reenvio automático) e devolve o motivo.
  if (res && res.recusadoPeloServidor) {
    salvarRotaPend('inicio', Object.assign({}, payload, { desistiu: true, recusa: res.error }));
    return { ok: false, error: res.error, recusadoPeloServidor: true };
  }
  return { ok: true, pendenteEnvio: true, semFotoLocal: !salvouCompleto, precisaLogin: !!(res && res.precisaLogin) };
}

function apiFinalizarRota(entregador, kmFinal, fotoBase64, fotoMimeType) {
  return comRotaEmVoo('fim', entregador, () => _apiFinalizarRota(entregador, kmFinal, fotoBase64, fotoMimeType));
}
async function _apiFinalizarRota(entregador, kmFinal, fotoBase64, fotoMimeType) {
  const payload = { action: 'finalizarRota', entregador: entregador, kmFinal: kmFinal, turno: getTurno(), fotoBase64: fotoBase64 || '', fotoMimeType: fotoMimeType || 'image/jpeg', ts_device: new Date().toISOString() };
  { const d = diaConfiavel(); if (d) payload.data = d; }
  const salvouCompleto = salvarRotaPend('fim', payload); // PERSISTE antes de enviar (não perde KM/foto)
  espelharNoPainel(payload);
  const res = await enviarRotaPayload(payload);
  if (res && (res.montagemBloqueada || res.montagemIndisponivel)) {
    salvarRotaPend(payload.action === "iniciarRota" ? "inicio" : "fim", Object.assign({}, payload, { desistiu: true }));
    throw erroMontagem(res);
  }
  if (res && res.ok && !res.semFoto) { limparRotaPend('fim', entregador); return res; }
  if (res && res.ok) return res; // KM subiu, foto NÃO → deixa salva no aparelho pra subir sozinha
  if (res && res.recusadoPeloServidor) { // ver o comentário em apiIniciarRota
    salvarRotaPend('fim', Object.assign({}, payload, { desistiu: true, recusa: res.error }));
    return { ok: false, error: res.error, recusadoPeloServidor: true };
  }
  return { ok: true, pendenteEnvio: true, semFotoLocal: !salvouCompleto, precisaLogin: !!(res && res.precisaLogin) };
}


  function saveEntregasCache(entregador, items) {
    limparCacheEntregasDeOutrosDias();
    const cacheName = chaveCacheEntregas(entregador);
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
      else if (key === 'done' || key === 'fail' || key === 'cancel') concluidas.push(item);
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

  // ===== MAQUININHA DA ROTA (06/10/2026) =====
  // Pedido do dono: ao iniciar, o entregador diz qual maquininha leva (os 4 últimos dígitos). É o
  // que deixa a conciliação da Cielo saber QUEM passou o cartão: venda no terminal X às 10:42 ↔
  // entrega do pedido Y às 10:40 pelo entregador que levou o X.
  // Rede NUNCA no caminho do dedo: a lista vem do cache do aparelho (renovada a cada lista de
  // entregas), a escolha grava na hora (localStorage + fila durável) e sobe em segundo plano como a
  // ação `definirMaquininha`. Trocar depois = nova escolha; vale a ÚLTIMA (pela hora do toque).
  const CHAVE_LISTA_MAQ = 'maq_lista_v1';
  function lerListaMaquininhas() {
    try { const l = JSON.parse(localStorage.getItem(CHAVE_LISTA_MAQ) || 'null'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function salvarListaMaquininhas(lista) {
    if (!Array.isArray(lista)) return;
    try { localStorage.setItem(CHAVE_LISTA_MAQ, JSON.stringify(lista.filter(m => m && m.terminal))); } catch (e) {}
  }
  function chaveEscolhaMaq(entregador) {
    return 'maq_escolha_v1_' + diaSP() + '_' + getTurno() + '_' + nomeLimpo(entregador || getSavedDriverName());
  }
  // O que ESTE aparelho escolheu hoje/neste turno (ou null). Vence o do servidor enquanto não subiu.
  function lerEscolhaMaquininha(entregador) {
    try { const o = JSON.parse(localStorage.getItem(chaveEscolhaMaq(entregador)) || 'null'); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; }
  }
  // escolha = { semMaquininha: true, automatico? } | { id, terminal, final4 }. Devolve a escolha gravada.
  // Grava PRIMEIRO na fila durável (é ela que garante a subida); se a fila falhar, lança e nada é pintado.
  async function registrarMaquininha(escolha) {
    const ts = new Date().toISOString();
    const sem = !!(escolha && escolha.semMaquininha);
    const reg = sem
      ? { semMaquininha: true, automatico: !!escolha.automatico, em: ts }
      : { semMaquininha: false, id: escolha.id != null ? Number(escolha.id) : null, terminal: String(escolha.terminal || ''), final4: String(escolha.final4 || String(escolha.terminal || '').slice(-4)), em: ts };
    const params = { action: 'definirMaquininha', ts_device: ts, sem: sem ? 1 : 0, auto: reg.automatico ? 1 : 0 };
    if (!sem) { params.terminal = reg.terminal; if (reg.id) params.maquininha_id = reg.id; }
    await enfileirar(params, { maquininha: true });
    try { localStorage.setItem(chaveEscolhaMaq(), JSON.stringify(reg)); } catch (e) {}
    return reg;
  }
  // A escolha que o SERVIDOR devolveu na lista (já subiu): guarda local se for mais nova que a do aparelho.
  function sincronizarEscolhaDoServidor(doServidor, entregador) {
    if (!doServidor || typeof doServidor !== 'object') return lerEscolhaMaquininha(entregador);
    const local = lerEscolhaMaquininha(entregador);
    const tServ = Date.parse(doServidor.em || ''), tLocal = Date.parse((local && local.em) || '');
    if (!local || (Number.isFinite(tServ) && (!Number.isFinite(tLocal) || tServ > tLocal))) {
      const reg = doServidor.semMaquininha
        ? { semMaquininha: true, automatico: !!doServidor.automatico, em: doServidor.em || '' }
        : { semMaquininha: false, id: doServidor.id != null ? Number(doServidor.id) : null, terminal: String(doServidor.terminal || ''), final4: String(doServidor.final4 || String(doServidor.terminal || '').slice(-4)), em: doServidor.em || '' };
      try { localStorage.setItem(chaveEscolhaMaq(entregador), JSON.stringify(reg)); } catch (e) {}
      return reg;
    }
    return local;
  }

  window.AppEntrega = {
    temToken,
    fimConfirmado,
    guardarFimConfirmado,
    marcarAtividade,
    atividadeRecente,
    filaPresaDeOutros,
    lerListaMaquininhas,
    salvarListaMaquininhas,
    lerEscolhaMaquininha,
    registrarMaquininha,
    sincronizarEscolhaDoServidor,
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
    verificarMontagem,
    manterValorMaisRecente,
    carregarEntregasPorEntregador,
    carregarCancelamentosDaRota,
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
    enfileirarLote,
    filaPorIds,
    filaPronta,
    filaEstado,
    processarFila,
    filaRowsPendentes,
    filaParamsPendentes,
    filaStatusPendentes,
    filaDescartarStatus,
    enviarPendentesNoFechamento,
    ACOES_DE_STATUS,
    AVISAR_NAO_PASSOU,
    TEMPO_CONFERIR_MS,
    reenviarRotaPendente,
    temRotaPendente,
    temRotaPendenteFase,
    inicioConfirmado, // 10/09: a tela usa pra saber que a rota do dia JA foi confirmada (localStorage, sobrevive ao kill)
    statusRotaPendente,
    apiEditarKm,
    getTurno,
    setTurno,
    turnoPadrao,
    turnoEscolhidoHoje,
    usandoPainel

  };
})();
