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
// Se este celular tiver o override ligado, ele fala com o painel (via proxy /api/painel do
// próprio Vercel — evita bloqueio de HTTP→HTTPS). Quem NÃO ligar continua 100% no fluxo
// antigo (Apps Script). Pra ativar num aparelho, no console do navegador:
//   localStorage.setItem('app_api_url_override','/api/painel')
// Pra voltar ao antigo: localStorage.removeItem('app_api_url_override')
try {
  var _ov = localStorage.getItem('app_api_url_override');
  if (_ov) {
    window.APP_CONFIG.API_URL = _ov;
    window.APP_CONFIG.POST_URL = _ov;
    // Proxy same-origin (começa com "/") responde JSON puro — não dá pra usar JSONP nele.
    if (_ov.charAt(0) === '/') window.APP_CONFIG.API_MODE = 'json';
  }
} catch (e) {}