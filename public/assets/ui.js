// ====================================================================
// ui.js — Modal PRÓPRIO do app (substitui os prompt/alert/confirm NATIVOS
// do navegador, aquele cinza "appentregadores26.vercel.app diz", que fica
// feio e NÃO dá pra personalizar).
//
// Como usar (tudo é Promise — a tela "espera" a resposta com await, igual
// ao prompt/alert/confirm antigos, só que com a NOSSA cara):
//
//   await AppUI.alerta('Mensagem')                       -> avisa e segue
//   const ok = await AppUI.confirmar('Tem certeza?')     -> true/false
//   const txt = await AppUI.perguntar('Digite o KM')     -> texto ou null
//
// Opções (2º parâmetro, todas opcionais) = a parte PERSONALIZÁVEL:
//   { titulo, textoOk, textoCancelar, placeholder, valor,
//     inputmode, tipoCampo, tom }
//   tom = 'warn' (laranja) | 'danger' (vermelho) | 'success' (verde)
//         muda a cor do botão principal.
// ====================================================================
(function () {
  // Conta quantos modais estão abertos pra travar/destravar a rolagem do fundo.
  var abertos = 0;
  function travarFundo(travar) {
    abertos += travar ? 1 : -1;
    if (abertos < 0) abertos = 0;
    document.body.style.overflow = abertos > 0 ? 'hidden' : '';
  }

  // Escapa texto pra não quebrar o HTML (e não deixar passar tag de cliente).
  function escapar(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Monta, mostra e resolve um modal. `cfg.tipo` = 'alert' | 'confirm' | 'prompt'.
  // Resolve com: alert -> true | confirm -> true/false | prompt -> string/null.
  function abrir(cfg) {
    return new Promise(function (resolve) {
      var temInput = cfg.tipo === 'prompt';
      var temEscolha = cfg.tipo === 'escolher';
      var temCancelar = cfg.tipo !== 'alert'; // alert só tem o botão OK

      var overlay = document.createElement('div');
      overlay.className = 'app-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      var card = document.createElement('div');
      card.className = 'app-modal' + (cfg.tom ? ' tom-' + cfg.tom : '');

      var html = '';
      if (cfg.titulo) html += '<div class="app-modal-title">' + escapar(cfg.titulo) + '</div>';
      if (cfg.mensagem) html += '<div class="app-modal-msg">' + escapar(cfg.mensagem) + '</div>';
      if (temInput) {
        html += '<input class="app-modal-input"'
          + ' type="' + escapar(cfg.tipoCampo || 'text') + '"'
          + (cfg.inputmode ? ' inputmode="' + escapar(cfg.inputmode) + '"' : '')
          + ' placeholder="' + escapar(cfg.placeholder || '') + '"'
          + ' value="' + escapar(cfg.valor || '') + '"'
          + ' autocomplete="off" />';
      }
      if (temEscolha) {
        // Lista de opções (botões grandes, um embaixo do outro). Cada um resolve com seu "valor".
        html += '<div class="app-modal-opcoes">';
        (cfg.opcoes || []).forEach(function (op, i) {
          html += '<button type="button" class="app-modal-opcao' + (op.tom ? ' tom-' + op.tom : '') + '" data-idx="' + i + '">'
            + escapar(op.rotulo) + '</button>';
        });
        html += '</div>';
        html += '<div class="app-modal-actions">'
          + '<button type="button" class="app-modal-btn ghost" data-acao="cancelar">' + escapar(cfg.textoCancelar || 'Cancelar') + '</button>'
          + '</div>';
      } else {
        html += '<div class="app-modal-actions">';
        if (temCancelar) {
          html += '<button type="button" class="app-modal-btn ghost" data-acao="cancelar">'
            + escapar(cfg.textoCancelar || 'Cancelar') + '</button>';
        }
        html += '<button type="button" class="app-modal-btn primary" data-acao="ok">'
          + escapar(cfg.textoOk || 'OK') + '</button>';
        html += '</div>';
      }

      card.innerHTML = html;
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      travarFundo(true);

      var input = card.querySelector('.app-modal-input');

      // Anima a entrada (fade + leve subida) no quadro seguinte.
      requestAnimationFrame(function () { overlay.classList.add('aberto'); });

      var fechado = false;
      function fechar(valor) {
        if (fechado) return;
        fechado = true;
        overlay.classList.remove('aberto');
        travarFundo(false);
        document.removeEventListener('keydown', onTecla);
        // Espera a animação de saída antes de tirar do DOM.
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 180);
        resolve(valor);
      }
      function confirmar() { fechar(temInput ? input.value : true); }
      function cancelar() { fechar(temInput ? null : false); }

      // Clique nos botões.
      card.addEventListener('click', function (e) {
        // Opção escolhida (modal de escolha) -> resolve com o "valor" daquela opção.
        var op = e.target.closest('button[data-idx]');
        if (op) { fechar((cfg.opcoes || [])[Number(op.getAttribute('data-idx'))].valor); return; }
        var btn = e.target.closest('button[data-acao]');
        if (!btn) return;
        if (btn.getAttribute('data-acao') === 'ok') confirmar();
        else cancelar();
      });
      // Toque FORA do quadro = cancelar (no alert, apenas fecha).
      overlay.addEventListener('click', function (e) { if (e.target === overlay) cancelar(); });
      // Teclado: Esc cancela, Enter confirma.
      function onTecla(e) {
        if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
        else if (e.key === 'Enter' && !temEscolha) { e.preventDefault(); confirmar(); }
      }
      document.addEventListener('keydown', onTecla);

      // Foco: no campo (prompt), na 1ª opção (escolher) ou no botão principal.
      setTimeout(function () {
        if (input) { input.focus(); try { input.select(); } catch (e) {} }
        else { var alvo = card.querySelector('.app-modal-opcao') || card.querySelector('.app-modal-btn.primary'); if (alvo) alvo.focus(); }
      }, 60);
    });
  }

  window.AppUI = {
    alerta: function (mensagem, opc) {
      opc = opc || {};
      return abrir({ tipo: 'alert', mensagem: mensagem, titulo: opc.titulo, textoOk: opc.textoOk || 'Entendi', tom: opc.tom });
    },
    confirmar: function (mensagem, opc) {
      opc = opc || {};
      return abrir({ tipo: 'confirm', mensagem: mensagem, titulo: opc.titulo, textoOk: opc.textoOk || 'Confirmar', textoCancelar: opc.textoCancelar || 'Cancelar', tom: opc.tom });
    },
    perguntar: function (mensagem, opc) {
      opc = opc || {};
      return abrir({
        tipo: 'prompt', mensagem: mensagem, titulo: opc.titulo,
        valor: opc.valor, placeholder: opc.placeholder,
        inputmode: opc.inputmode, tipoCampo: opc.tipoCampo,
        textoOk: opc.textoOk || 'OK', textoCancelar: opc.textoCancelar || 'Cancelar', tom: opc.tom,
      });
    },
    // Escolha entre botões grandes. opcoes = [{ valor, rotulo, tom }].
    // Resolve com o `valor` da opção tocada, ou null se cancelar.
    //   const r = await AppUI.escolher('Como foi?', [{ valor:'a', rotulo:'Opção A' }, ...])
    escolher: function (mensagem, opcoes, opc) {
      opc = opc || {};
      return abrir({ tipo: 'escolher', mensagem: mensagem, titulo: opc.titulo, opcoes: opcoes || [], textoCancelar: opc.textoCancelar || 'Cancelar', tom: opc.tom });
    },
  };
})();
