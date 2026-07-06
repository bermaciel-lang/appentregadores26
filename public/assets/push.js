// Push do app .apk (Firebase/FCM): registra o aparelho pra receber notificação de mensagem do chat
// MESMO com o app fechado. Só roda no app nativo (no site/navegador não faz nada). O servidor manda
// o push quando a Central escreve pro entregador (ver lib/fcm + lib/chat pushParaEntregador).
(function () {
  try {
    var Cap = window.Capacitor;
    if (!(Cap && Cap.isNativePlatform && Cap.isNativePlatform())) return; // só no .apk
    var PN = Cap.Plugins && Cap.Plugins.PushNotifications;
    if (!PN) return;
    var api = window.AppEntrega;

    // Canal de notificação "chat" (Android 8+). Importância alta = aparece + som.
    try { if (PN.createChannel) PN.createChannel({ id: 'chat', name: 'Mensagens do chat', importance: 5, visibility: 1 }); } catch (e) {}

    // Pede permissão e registra no FCM.
    PN.requestPermissions().then(function (r) { if (r && r.receive === 'granted') PN.register(); }).catch(function () {});

    // Recebeu o token do aparelho → manda pro servidor, amarrado ao entregador logado.
    PN.addListener('registration', function (t) {
      try {
        var nome = api && api.getSavedDriverName ? api.getSavedDriverName() : '';
        if (nome && t && t.value) api.apiGet({ action: 'registrarPush', entregador: nome, token_push: t.value }, { retries: 1 });
      } catch (e) {}
    });

    // Tocou na notificação → garante que abre a tela de entregas (onde fica o chat).
    PN.addListener('pushNotificationActionPerformed', function () {
      try { if (location.pathname.indexOf('/entregas') < 0) location.href = '/entregas/'; } catch (e) {}
    });
  } catch (e) { /* silencioso */ }
})();
