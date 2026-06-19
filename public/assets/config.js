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
// VIRADA FORÇADA (Bernardo, 19/06/2026): TODOS os aparelhos vão pro NOSSO SISTEMA (painel),
// via proxy same-origin /api/painel/. O rollback POR APARELHO (flag `app_planilha`) foi
// APOSENTADO: mesmo um celular que tinha ficado PRESO no fluxo antigo é trazido pro sistema
// no próximo carregamento (a gente apaga o flag). Sobrou só um escape de EMERGÊNCIA, NÃO
// grudento: abrir com ?planilha=1 usa o Apps Script SÓ naquele acesso e não fixa nada —
// recarregou normal, volta pro sistema. (Rollback de verdade agora = reverter este commit.)
//
// `app_api_url_override` = '/api/painel/' segue sendo o que o usandoPainel() lê (sync-reversa,
// espelho, UI), então no padrão a gente GRAVA ela.
// ====================================================================
try {
  var _q = new URLSearchParams(location.search);
  var _emergenciaAntigo = (_q.get('planilha') === '1' || _q.get('painel') === '0');
  localStorage.removeItem('app_planilha'); // limpa qualquer rollback que tenha ficado preso
  if (_emergenciaAntigo) {
    // EMERGÊNCIA: fluxo antigo (Apps Script) só neste acesso — não grava override, não fica preso.
    localStorage.removeItem('app_api_url_override');
  } else {
    // PADRÃO FORÇADO = sistema (painel).
    localStorage.setItem('app_api_url_override', '/api/painel/');
    window.APP_CONFIG.API_URL = '/api/painel/';
    window.APP_CONFIG.POST_URL = '/api/painel/';
    window.APP_CONFIG.API_MODE = 'json'; // proxy same-origin responde JSON puro (não dá JSONP)
  }
} catch (e) {
  // Se algo falhar, ainda assim força o sistema (não cai no Apps Script por acidente).
  try {
    window.APP_CONFIG.API_URL = '/api/painel/';
    window.APP_CONFIG.POST_URL = '/api/painel/';
    window.APP_CONFIG.API_MODE = 'json';
  } catch (e2) {}
}
