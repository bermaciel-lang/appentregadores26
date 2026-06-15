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

// === Teste em paralelo do PAINEL (Etapa C) — override POR APARELHO ===
// Se este celular tiver uma URL salva em localStorage, ele fala com o painel em vez do
// Apps Script. Quem NÃO setar nada continua 100% no fluxo antigo. Pra ativar num aparelho,
// rode no console do navegador:
//   localStorage.setItem('app_api_url_override','https://SEU-PAINEL/api/entregador-app')
// Pra voltar ao antigo: localStorage.removeItem('app_api_url_override')
try {
  var _ov = localStorage.getItem('app_api_url_override');
  if (_ov) { window.APP_CONFIG.API_URL = _ov; window.APP_CONFIG.POST_URL = _ov; }
} catch (e) {}