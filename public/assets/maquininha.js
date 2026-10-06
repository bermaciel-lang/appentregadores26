// ====================================================================
// maquininha.js — "Qual maquininha você vai levar?" (06/10/2026)
//
// Pedido do dono: no INICIAR, depois do KM e da foto, o entregador escolhe a maquininha que leva
// (os 4 ÚLTIMOS dígitos, em ordem crescente) ou "Não levei maquininha", e confirma no OK. A mesma
// tela serve ao botão "Trocar maquininha".
//
// Só monta a tela e devolve a escolha — NADA de rede aqui (a lista vem do cache do aparelho e a
// gravação é do chamador, pela fila durável). Usa a casca visual dos modais do app (ui.js).
//
//   const r = await Maquininha.escolher({ lista, atual, obrigatorio })
//   r = { semMaquininha: true } | { id, terminal, final4 } | null (só quando NÃO é obrigatório)
// ====================================================================
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api; // node (réguas)
  root.Maquininha = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function final4(m) {
    var f = String((m && m.final4) || '').replace(/\D/g, '');
    if (f.length === 4) return f;
    return String((m && m.terminal) || '').replace(/\D/g, '').slice(-4);
  }

  // Ordem do dono: "em ordem alfabética" dos 4 dígitos — texto, então "0437" vem antes de "4007".
  // Dois terminais com o mesmo final (não acontece hoje) desempatam pelo número inteiro.
  function ordenar(lista) {
    return (Array.isArray(lista) ? lista : [])
      .filter(function (m) { return m && final4(m).length === 4; })
      .slice()
      .sort(function (a, b) {
        var fa = final4(a), fb = final4(b);
        if (fa !== fb) return fa < fb ? -1 : 1;
        var ta = String(a.terminal || ''), tb = String(b.terminal || '');
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });
  }

  // Finais repetidos na lista: aí o botão mostra o número inteiro, senão a escolha seria às cegas.
  function finaisRepetidos(lista) {
    var vistos = {}, rep = {};
    lista.forEach(function (m) { var f = final4(m); if (vistos[f]) rep[f] = 1; vistos[f] = 1; });
    return rep;
  }

  function escapar(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function mesmo(a, b) {
    if (!a || !b) return false;
    if (a.semMaquininha || b.semMaquininha) return !!a.semMaquininha && !!b.semMaquininha;
    return String(a.terminal || '') === String(b.terminal || '');
  }

  function escolher(opc) {
    opc = opc || {};
    var lista = ordenar(opc.lista);
    var rep = finaisRepetidos(lista);
    var atual = opc.atual || null;
    var obrigatorio = opc.obrigatorio !== false;
    return new Promise(function (resolve) {
      var selecionada = null;
      if (atual) {
        if (atual.semMaquininha) selecionada = { semMaquininha: true };
        else lista.forEach(function (m) { if (mesmo(m, atual)) selecionada = m; });
      }

      var overlay = document.createElement('div');
      overlay.className = 'app-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      var card = document.createElement('div');
      card.className = 'app-modal maq-modal';

      var html = '<div class="app-modal-title">💳 ' + escapar(opc.titulo || 'Qual maquininha você vai levar?') + '</div>';
      html += '<div class="app-modal-msg">' + escapar(opc.mensagem || 'Toque nos 4 últimos números da maquininha e depois em OK.') + '</div>';
      if (!lista.length) {
        html += '<div class="maq-aviso">A lista de maquininhas ainda não chegou neste aparelho. Se levou uma, escolha "Não levei" agora e troque depois em <b>Trocar maquininha</b> quando a internet voltar.</div>';
      }
      html += '<div class="maq-grade">';
      lista.forEach(function (m, i) {
        var f = final4(m);
        html += '<button type="button" class="maq-op" data-i="' + i + '" aria-pressed="false">'
          + '<span class="maq-num">' + escapar(f) + '</span>'
          + (rep[f] ? '<span class="maq-term">' + escapar(m.terminal) + '</span>' : '')
          + '</button>';
      });
      html += '</div>';
      html += '<button type="button" class="maq-op maq-sem" data-sem="1" aria-pressed="false">🚫 Não levei maquininha</button>';
      html += '<div class="app-modal-actions">'
        + (obrigatorio ? '' : '<button type="button" class="app-modal-btn ghost" data-acao="cancelar">Cancelar</button>')
        + '<button type="button" class="app-modal-btn primary" data-acao="ok" disabled>OK</button>'
        + '</div>';
      card.innerHTML = html;
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      try { document.body.style.overflow = 'hidden'; } catch (e) {}
      requestAnimationFrame(function () { overlay.classList.add('aberto'); });

      var btnOk = card.querySelector('[data-acao="ok"]');
      function pintar() {
        card.querySelectorAll('.maq-op').forEach(function (b) {
          var on = false;
          if (b.hasAttribute('data-sem')) on = !!(selecionada && selecionada.semMaquininha);
          else on = !!(selecionada && !selecionada.semMaquininha && lista[Number(b.getAttribute('data-i'))] === selecionada);
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        btnOk.disabled = !selecionada;
        btnOk.textContent = !selecionada ? 'OK'
          : selecionada.semMaquininha ? 'OK — sem maquininha'
          : 'OK — final ' + final4(selecionada);
      }
      pintar();

      var fechado = false;
      function fechar(valor) {
        if (fechado) return;
        fechado = true;
        overlay.classList.remove('aberto');
        try { if (!document.querySelector('.app-modal-overlay.aberto')) document.body.style.overflow = ''; } catch (e) {}
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 180);
        resolve(valor);
      }

      card.addEventListener('click', function (e) {
        var op = e.target.closest('.maq-op');
        if (op) {
          selecionada = op.hasAttribute('data-sem') ? { semMaquininha: true } : lista[Number(op.getAttribute('data-i'))];
          pintar();
          return;
        }
        var b = e.target.closest('[data-acao]');
        if (!b) return;
        if (b.getAttribute('data-acao') === 'cancelar') { fechar(null); return; }
        if (!selecionada) return;
        fechar(selecionada.semMaquininha ? { semMaquininha: true }
          : { id: selecionada.id != null ? selecionada.id : null, terminal: String(selecionada.terminal || ''), final4: final4(selecionada) });
      });
      // Toque fora só fecha quando a escolha NÃO é obrigatória (no Iniciar ela é).
      overlay.addEventListener('click', function (e) { if (e.target === overlay && !obrigatorio) fechar(null); });
    });
  }

  // Texto curto do botão da barra ("💳 Maquininha 4656").
  function rotulo(escolha) {
    if (!escolha) return '💳 Informar maquininha';
    if (escolha.semMaquininha) return '💳 Sem maquininha · trocar';
    return '💳 Maquininha ' + final4(escolha) + ' · trocar';
  }

  return { escolher: escolher, ordenar: ordenar, final4: final4, rotulo: rotulo };
});
