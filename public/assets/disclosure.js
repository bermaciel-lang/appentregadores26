// AVISO PROMINENTE DE LOCALIZAÇÃO EM SEGUNDO PLANO (exigência do Google Play).
// Mostra, na abertura do app (só no .apk), uma explicação CLARA antes de o app usar a localização:
// coleta o GPS pra registrar o trajeto da rota, INCLUSIVE em segundo plano, e SÓ durante a rota.
// É o "prominent disclosure" que o Google exige aparecer antes do pedido de permissão. Aparece uma
// vez por aparelho (guardado no localStorage); reinstalar/limpar dados faz aparecer de novo (útil pro
// vídeo de revisão). No navegador/iPhone não roda (lá não há coleta em segundo plano).
(function () {
  'use strict';
  var Cap = window.Capacitor;
  if (!(Cap && Cap.isNativePlatform && Cap.isNativePlatform())) return; // só no app nativo
  var KEY = 'app_entregas_aviso_local_v1';
  try { if (localStorage.getItem(KEY) === '1') return; } catch (e) {}

  function mostrar() {
    var el = document.createElement('div');
    el.id = 'avisoLocal';
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(11,31,77,.55);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,Arial,sans-serif;';
    el.innerHTML =
      '<div style="background:#fff;max-width:440px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 14px 44px rgba(0,0,0,.4);">' +
        '<div style="background:#0b1f4d;color:#fff;padding:16px 20px;font-size:18px;font-weight:800;">📍 Uso da sua localização</div>' +
        '<div style="padding:18px 20px;color:#334155;font-size:15px;line-height:1.5;">' +
          'Enquanto a sua <b>rota de entrega</b> estiver em andamento, este app coleta a sua ' +
          '<b>localização (GPS)</b> para <b>registrar o trajeto</b> e calcular a quilometragem — ' +
          '<b>inclusive com o app fechado ou em segundo plano</b>.' +
          '<br><br>A coleta acontece <b>somente do "Iniciar rota" até o "Finalizar rota"</b>, ' +
          'com uma notificação fixa "Rota em andamento". Fora desse período, o app <b>não</b> ' +
          'coleta a sua localização.' +
        '</div>' +
        '<div style="padding:0 20px 20px;">' +
          '<button id="avisoLocalOk" type="button" style="width:100%;padding:14px;border:0;border-radius:12px;background:#16a34a;color:#fff;font-size:16px;font-weight:800;cursor:pointer;">Entendi, continuar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('#avisoLocalOk').addEventListener('click', function () {
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  if (document.body) mostrar();
  else document.addEventListener('DOMContentLoaded', mostrar);
})();
