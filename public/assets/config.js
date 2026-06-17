// Valores BASE = fluxo ANTIGO (planilha/Apps Script). Servem de ROLLBACK: se um aparelho voltar
// pro antigo, é isto que vale.
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbytI4amCTInP7RB0nJb0PIOHt85YK3_L_7ZTJsv4IpnCZKNvbRYAVFzd2HXGevki5ls/exec',
  API_MODE: 'jsonp',
  ADMIN_PASSWORD: '1234',
  REFRESH_INTERVAL_MS: 60000,
  GPS_THROTTLE_MS: 30000,
  API_TIMEOUT_MS: 15000,
  API_RETRY_COUNT: 2,
  CACHE_TTL_MS: 300000,
  STORAGE_DRIVER_KEY: 'app_entregas_driver_name',
  STORAGE_ADMIN_AUTH_KEY: 'app_entregas_admin_auth',
  STORAGE_CACHE_PREFIX: 'app_entregas_cache_v3_'
};

// ====================================================================
// VIRADA (Etapa C): o PADRÃO agora é o NOSSO SISTEMA (painel), via proxy same-origin
// /api/painel/ (o proxy do Vercel evita o bloqueio HTTP→HTTPS). O fluxo antigo (planilha)
// fica como ROLLBACK POR APARELHO.
//
//   • Voltar UM aparelho pro antigo:  abrir o app com  ?planilha=1   (ou ?painel=0)
//   • Voltar pro sistema (padrão):    abrir o app com  ?painel=1     (ou ?planilha=0)
//   Fica gravado no aparelho até trocar de novo.
//
// Importante: a chave `app_api_url_override` continua sendo o que o usandoPainel() lê pra
// saber que está no fluxo-novo (sync-reversa, espelho, UI). Por isso, no padrão a gente
// GRAVA ela = '/api/painel/'; no rollback a gente REMOVE.
// ====================================================================
try {
  var _q = new URLSearchParams(location.search);
  if (_q.get('planilha') === '1' || _q.get('painel') === '0') {   // ROLLBACK pro antigo
    localStorage.setItem('app_planilha', '1');
    localStorage.removeItem('app_api_url_override');
  }
  if (_q.get('painel') === '1' || _q.get('planilha') === '0') {   // VOLTAR pro padrão (sistema)
    localStorage.removeItem('app_planilha');
    localStorage.setItem('app_api_url_override', '/api/painel/');
  }
} catch (e) {}

try {
  var _rollback = localStorage.getItem('app_planilha') === '1';
  // Padrão = sistema: se o aparelho não pediu rollback e ainda não tem o override, grava ele.
  if (!_rollback && !localStorage.getItem('app_api_url_override')) {
    localStorage.setItem('app_api_url_override', '/api/painel/');
  }
  var _ov = _rollback ? null : localStorage.getItem('app_api_url_override');
  if (_ov) {
    window.APP_CONFIG.API_URL = _ov;
    window.APP_CONFIG.POST_URL = _ov;
    // Proxy same-origin (começa com "/") responde JSON puro — não dá pra usar JSONP nele.
    if (_ov.charAt(0) === '/') window.APP_CONFIG.API_MODE = 'json';
  }
  // se _rollback: mantém os valores BASE (Apps Script) acima = fluxo antigo
} catch (e) {}
