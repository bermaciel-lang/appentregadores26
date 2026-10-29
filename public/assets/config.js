// Configuração do app de entregas. Todo aparelho fala com o NOSSO sistema (o painel) pelo proxy same-origin /api/painel/
// (api/painel.js na Vercel).
//
// ⛔ 28/10/2026 — SAIU O FLUXO ANTIGO. Este arquivo ainda levava a URL do Apps Script da planilha (o "rollback" de 19/06), o modo
// JSONP, a senha '1234' da página /admin e o escape de emergência `?planilha=1` / `?painel=0`. O escape não era inofensivo: um
// acesso com ele mandaria a FILA do aparelho (entregas, pagamentos) para a planilha morta. A planilha, o /admin, o /painel e os
// proxies antigos (api/proxy.js, api/painel-data.js) saíram do projeto (decisão do dono). A tela de administração de verdade é a
// do painel. Rollback de verdade = reverter o commit.
window.APP_CONFIG = {
  API_URL: '/api/painel/',
  POST_URL: '/api/painel/',
  API_MODE: 'json', // o proxy responde JSON puro
  REFRESH_INTERVAL_MS: 60000,
  GPS_THROTTLE_MS: 30000,
  API_TIMEOUT_MS: 15000,
  API_RETRY_COUNT: 2,
  CACHE_TTL_MS: 300000,
  STORAGE_DRIVER_KEY: 'app_entregas_driver_name',
  STORAGE_TOKEN_KEY: 'app_entregas_driver_token',
  STORAGE_CACHE_PREFIX: 'app_entregas_cache_v3_',
  // Porteiro de permissões (gate.js): só abre o app (no .apk Android) se LOCALIZAÇÃO e
  // NOTIFICAÇÕES estiverem ativadas. Kill-switch: pôr false desliga o porteiro na hora
  // (deploy de 1 linha). No navegador/iPhone o porteiro nunca roda, independente disto.
  EXIGIR_PERMISSOES: true,
  // Gravar áudio no chat (segurar o 🎤). No NAVEGADOR funciona sempre. No .apk precisa da
  // permissão RECORD_AUDIO (só existe a partir do .apk novo) — por isso o 🎤 fica ESCONDIDO
  // no app até LIGAR esta flag (deploy de 1 linha), depois que o .apk novo estiver circulando.
  GRAVAR_AUDIO_ATIVO: false
};

// `app_api_url_override` = '/api/painel/' é o que `usandoPainel()` (core.js) lê — gravado sempre. E some qualquer rollback antigo
// que tenha ficado preso no aparelho (`app_planilha`).
try {
  localStorage.removeItem('app_planilha');
  localStorage.setItem('app_api_url_override', '/api/painel/');
} catch (e) { /* sem localStorage: o app segue no painel do mesmo jeito (a URL acima) */ }
