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
    // 28/10/2026: só quando MUDA (o token, ou o entregador) — ou a cada 12 h, para o aparelho em uso voltar a ser o do push se o
    // mesmo entregador abriu o app em outro celular. Era uma chamada a cada abertura do app para dizer a mesma coisa.
    PN.addListener('registration', function (t) {
      try {
        var nome = api && api.getSavedDriverName ? api.getSavedDriverName() : '';
        if (!nome || !t || !t.value) return;
        var chave = 'app_push_registrado_v1', agora = nome + '|' + t.value;
        try {
          var ult = JSON.parse(localStorage.getItem(chave) || 'null');
          if (ult && ult.v === agora && Date.now() - Number(ult.em || 0) < 12 * 3600 * 1000) return;
        } catch (e) {}
        api.apiGet({ action: 'registrarPush', entregador: nome, token_push: t.value }, { retries: 1 }).then(function (r) {
          if (r && r.ok) { try { localStorage.setItem(chave, JSON.stringify({ v: agora, em: Date.now() })); } catch (e) {} }
        }, function () {});
      } catch (e) {}
    });

    // Tocou na notificação → garante que abre a tela de entregas (onde fica o chat).
    PN.addListener('pushNotificationActionPerformed', function () {
      try { if (location.pathname.indexOf('/entregas') < 0) location.href = '/entregas/'; } catch (e) {}
    });
  } catch (e) { /* silencioso */ }
})();
