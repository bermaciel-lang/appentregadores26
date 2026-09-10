// Pagamento na entrega: forma permitida, vale identificado e valor obrigatório.
// Cancelar interrompe a confirmação; não transforma ausência em pagamento.
// As respostas completas usam a fila existente, inclusive sem internet.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api; // node (réguas)
  root.PgPorta = api;                                                                  // navegador
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var MAX_VOLTAS = 6;

  // ORDEM DO DONO (09/09/2026): "caso a forma de pagamento ou o valor seja diferente do que esta
  // no pedido, que abra tipo um modal enorme perguntando se ele confirma o valor e a conta. O
  // ideal e travar o valor se for muito discrepante, tipo 10x menor ou 10x maior."
  //
  // POR QUE 10x PEGA O ERRO REAL: os casos que chegaram na Alteracoes Rota em 09/09 eram
  // R$ 20.426,00 num pedido de R$ 204,26 e R$ 16.680,00 num de R$ 166,83 - 100x os dois. E a
  // virgula esquecida, nao um valor "meio diferente". A trava em 10x pega isso com folga e ainda
  // deixa passar diferenca de verdade (pedido mudou na porta, cliente levou mais um item).
  var FATOR_TRAVA = 10;

  // Troco plausivel. Serve de TETO para a isencao do dinheiro (ver `valorDivergente`).
  var TROCO_MAX_CENTAVOS = 20000; // R$ 200

  // Dinheiro em CENTAVOS INTEIROS. Comparar em reais com ponto flutuante abria um buraco medido
  // pela revisao: 166.83 * 10 = 1668.3000000000002, entao "1668,30" (a virgula andando uma casa,
  // que e o erro real) ficava ABAIXO da trava e passava. Em centavos, 16683 * 10 = 166830 e o
  // mesmo valor trava. Nunca voltar a comparar reais aqui.
  function centavos(v) {
    var n = Number(v);
    return isFinite(n) ? Math.round(n * 100) : NaN;
  }

  // Fora desta faixa o app RECUSA e manda conferir - nao e confirmacao, e trava.
  // `pedido <= 0` = nao ha com o que comparar: nada trava.
  //
  // ⛔ 10/09/2026 — A TRAVA ESTAVA RECUSANDO O DINHEIRO QUE A PROPRIA TELA MANDA DECLARAR.
  // `telaValor` diz, com estas palavras: "Informe o total recebido em dinheiro, ANTES de devolver
  // o troco". Num pedido de R$ 19,90 pago com nota de R$ 200, o entregador obedecia e digitava 200
  // -- e 200 >= 19,90 x 10 travava. Seis voltas de "Valor nao confere" e a ENTREGA NAO ERA SALVA.
  // Medido pela revisao: R$ 9,90 com nota de R$ 100 e R$ 4,99 com R$ 50 caem igual; ja R$ 200 num
  // pedido de R$ 21,20 passava, entao o furo dependia so do tamanho do pedido.
  // A isencao aqui e a MESMA de `valorDivergente`, com o MESMO teto de troco: dinheiro A MAIS, ate
  // R$ 200 de diferenca. Ela NAO enfraquece a trava contra o erro real -- os casos que a motivaram
  // (R$ 20.426,00 num pedido de R$ 204,26; R$ 16.680,00 num de R$ 166,83) tem diferenca de milhares
  // de reais, muito acima do teto, e continuam travando.
  function discrepante(informado, pedido, forma) {
    var i = centavos(informado), p = centavos(pedido);
    if (!isFinite(i) || !isFinite(p) || p <= 0 || i < 0) return false;
    if (ehDinheiro(forma) && i > p && (i - p) <= TROCO_MAX_CENTAVOS) return false;
    return i >= p * FATOR_TRAVA || i * FATOR_TRAVA <= p;
  }

  // Diferenca que merece o modal grande. Um centavo nao e erro de digitacao.
  // DINHEIRO A MAIS NAO E DIFERENCA: o cliente da R$ 200 num pedido de R$ 189,50 e leva troco - a
  // propria tela do painel diz que "diferencas em dinheiro podem incluir troco e nao exigem
  // aprovacao de valor". Cobrar confirmacao ai seria alarde em cima do caso mais comum do dia.
  function valorDivergente(informado, pedido, forma) {
    var i = centavos(informado), p = centavos(pedido);
    if (!isFinite(i) || !isFinite(p) || p <= 0) return false;
    if (Math.abs(i - p) < 1) return false;
    // A isencao do dinheiro tem TETO. Sem ele (revisao 09/09) "1668" num pedido de R$ 166,83
    // passava calado, porque era "dinheiro a mais": ninguem entrega R$ 1.501 de troco. Ate
    // R$ 200 de troco e nota grande em pedido pequeno (R$ 200 num pedido de R$ 21,20); acima
    // disso e virgula errada, e vai pro modal.
    if (ehDinheiro(forma) && i > p && (i - p) <= TROCO_MAX_CENTAVOS) return false;
    return true;
  }

  function fmtBRL(n) {
    var v = Number(n) || 0;
    // toLocaleString pode não existir com pt-BR em node antigo; o fallback monta na mão.
    try { return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch (e) { return 'R$ ' + v.toFixed(2).replace('.', ','); }
  }

  // Valor digitado → número (2 casas) ou null (vazio / inválido).
  // Aceita "189,50", "189.50", "R$ 189,50", " 1.234,56 " e "1234". Quando vêm ponto E vírgula, o
  // ÚLTIMO é o decimal (1.234,56 → 1234.56 · 1,234.56 → 1234.56). Só um separador = decimal
  // (mesma regra do KM em page-entregas.js: "123.5" e "123,5" são o mesmo número).
  function parseValor(txt) {
    var s = String(txt == null ? '' : txt).replace(/[R$\s]/gi, '').trim();
    if (!s) return null;
    var iv = s.lastIndexOf(','), ip = s.lastIndexOf('.');
    if (iv >= 0 && ip >= 0) {
      s = iv > ip ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (iv >= 0) {
      s = s.replace(',', '.');
    }
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    var n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }

  // Valor no formato do SERVIDOR (PONTO decimal, 2 casas). "" = não sei. Mesma lição do KM:
  // o servidor faz Number(); "189,50" viraria NaN e a informação se perderia.
  function valorParaServidor(v) {
    if (v === null || v === undefined || v === '') return '';
    var n = Number(v);
    return isFinite(n) ? n.toFixed(2) : '';
  }

  // Rótulo da forma para o botão. Procura na lista do servidor (formasNaPorta); sem lista, cai
  // no texto que o app já mostra ("CREDITO NA ENTREGA" → "CREDITO").
  function rotuloForma(chave, operadora, formas, textoDoItem) {
    var lista = Array.isArray(formas) ? formas : [];
    for (var i = 0; i < lista.length; i++) {
      var f = lista[i];
      if (f && f.chave === chave && (operadora ? f.operadora === operadora : !f.operadora)) return String(f.rotulo || chave);
    }
    for (var j = 0; j < lista.length; j++) if (lista[j] && lista[j].chave === chave) return String(lista[j].rotulo || chave);
    var t = String(textoDoItem || '').replace(/\s*NA ENTREGA\s*/i, '').trim();
    return t || String(chave || 'na entrega');
  }

  function ehDinheiro(chave) { return /dinheiro|cash|money/i.test(String(chave || '')); }

  // "Cancelou" o modal: Cancelar, toque fora, Esc. ⚠️ O ui.js do app resolvia `false` (não `null`)
  // no cancelar de `escolher` até 05/09 — tratar só `null` fazia o "Não sei" virar "Foi diferente"
  // (medido no harness com o ui.js real). Aqui os dois valem, para não depender da versão do ui.js.
  function cancelou(v) { return v === null || v === undefined || v === false; }

  // O modal só aparece quando o SERVIDOR mandou perguntar (cofre ≥ 1) E o pedido é pago na porta.
  // Cofre em 0 = nada muda no app (rollback sem deploy).
  function devePerguntar(cfg, item) {
    return !!(cfg && cfg.perguntar === true && item && item.naEntrega);
  }

  // Irmãs pagas na porta (mesmo cliente+endereço = mesmo `numero`), sem repetir row.
  function irmasNaPorta(irmas) {
    var vistas = {}, out = [];
    (Array.isArray(irmas) ? irmas : []).forEach(function (x) {
      if (!x || !x.naEntrega) return;
      var r = Number(x.row);
      if (vistas[r]) return;
      vistas[r] = 1; out.push(x);
    });
    return out;
  }

  // Valor do pedido que serve de REFERENCIA para a TRAVA de 10x.
  // ⚠️ Diferente de `valorConfirmado`: aqui aceita valor NAO conferido (offline, cache, falha do
  // conferirValores). A revisao de 09/09 mostrou que era exatamente no modo degradado que a trava
  // sumia — e e nele que o entregador e OBRIGADO a digitar, porque a tela nem oferece "Pagou R$ X".
  // Valor velho serve de referencia para 10x sem risco: pedido nenhum muda dez vezes de tamanho.
  // O MODAL de diferenca continua exigindo `valorConfirmado` — com valor possivelmente velho,
  // perguntar "esta diferente" a cada entrega seria alarde em cima de dado que a casa nao garante.
  function valorReferencia(item) {
    var n = item && item.valor != null && item.valor !== '' ? Number(item.valor) : NaN;
    return isFinite(n) && n > 0 ? n : null;
  }

  function valorConfirmado(item) {
    return item && item.valorConferido !== false && item.valor != null && item.valor !== '' &&
      isFinite(Number(item.valor)) && Number(item.valor) >= 0;
  }

  function cartao(chave) { return chave === 'credito-entrega' || chave === 'debito-entrega'; }
  function equivalentes(a, b) { return a === b || (cartao(a) && cartao(b)); }
  function proibida(f) {
    if (!f) return true;
    if (['credito-online', 'pix', 'bling-4936197', 'bling-2892828'].indexOf(f.chave) >= 0) return true;
    var n = String(f.rotulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return /credito.*online|pix.*(instabuy|cielo)|link.*pagamento.*multiplas.*formas/.test(n);
  }
  function ehVale(f) {
    return f.chave === 'vale' || ['bling-822307', 'bling-1207605', 'bling-1014165', 'bling-1139437'].indexOf(f.chave) >= 0;
  }
  function formasPermitidas(formas) { return (formas || []).filter(function (f) { return f && f.chave && !proibida(f); }); }
  function formaResolvida(item, formas) {
    return formasPermitidas(formas).some(function (f) {
      return f.chave === item.pgFormaChave && (!f.operadora || f.operadora === item.pgOperadora) &&
        !(f.chave === 'vale' && (!item.pgOperadora || item.pgOperadora === 'outra'));
    });
  }
  function respostaCompleta(r, formas) {
    return !!r && !r.naoSei && !r.rejeitada && r.aprovacao !== 'rejeitado' && formasPermitidas(formas).some(function (f) {
      return f.chave === r.forma && (!f.operadora || f.operadora === r.operadora);
    }) && (r.forma === 'nao-pagou' || (r.valor != null && isFinite(Number(r.valor)) && Number(r.valor) >= 0 &&
      (r.forma !== 'vale' || (r.operadora && (r.operadora !== 'outra' || String(r.valeNome || '').trim().length >= 2)))));
  }

  // ---- As telas (o que cada uma MONTA, sem tocar em DOM: são dados para AppUI.escolher) ----

  // Tela 1 — o caso comum. Cancelar (ou fechar o overlay) = "Não sei / não vi".
  function opcoesTela1(item, grupo, formas) {
    var forma = item.pgFormaChave || null;
    var rot = cartao(forma) ? 'Crédito/Débito' : rotuloForma(forma, item.pgOperadora || null, formas, item.formaPagamento);
    var ops = [];
    if (grupo && grupo.length > 1 && formaResolvida(item, formas) && grupo.every(function (x) { return valorConfirmado(x) && equivalentes(x.pgFormaChave, forma) && x.pgOperadora === item.pgOperadora; })) {
      ops.push({ valor: 'tudo', rotulo: '✓ Pagou tudo junto: ' + fmtBRL(grupo.soma) + ' no ' + rot.toUpperCase() + ' (' + grupo.length + ' pedidos)', tom: 'success' });
    }
    // O 1º botão é o caso comum e ganha o tom verde (e o foco automático do ui.js).
    if (formaResolvida(item, formas) && valorConfirmado(item)) ops.push({ valor: 'igual', rotulo: '✓ Pagou ' + fmtBRL(item.valor) + ' no ' + rot.toUpperCase(), tom: ops.length ? undefined : 'success' });
    ops.push({ valor: 'diferente', rotulo: forma ? '✏️ Foi diferente (outra forma ou outro valor)' : '✏️ Informar como pagou' });
    return ops;
  }

  function mensagemTela1(item, formas) {
    var forma = item.pgFormaChave || null;
    var rot = cartao(forma) ? 'Crédito/Débito' : rotuloForma(forma, item.pgOperadora || null, formas, item.formaPagamento);
    var troco = Number(item.troco) || 0;
    var linha = valorConfirmado(item)
      ? 'Pedido ' + fmtBRL(item.valor) + (forma ? ' · ' + rot.toUpperCase() : ' · forma não informada')
      : 'O valor atual do pedido não foi confirmado. Informe o valor realmente recebido, igual no comprovante.';
    if (troco > 0 && ehDinheiro(forma || item.formaPagamento)) linha += '\ntroco p/ ' + fmtBRL(troco);
    return linha;
  }

  // Tela 2 — a forma. A declarada vem PRIMEIRO, marcada "(como no pedido)".
  function opcoesTela2(item, formas) {
    var lista = formasPermitidas(formas), ops = [], temCartao = false, temVale = false;
    lista.forEach(function (f) {
      if (cartao(f.chave)) {
        if (!temCartao) ops.push({ valor: { grupo: 'cartao' }, rotulo: 'Crédito/Débito' });
        temCartao = true; return;
      }
      if (ehVale(f)) {
        if (!temVale) ops.push({ valor: { grupo: 'vale' }, rotulo: 'Vale — escolher operadora' });
        temVale = true; return;
      }
      ops.push({ valor: { forma: f.chave, operadora: f.operadora || null }, rotulo: f.rotulo || f.chave });
    });
    return ops;
  }

  // ---- O payload que vai pro servidor (querystring, como o resto do app) ----
  // resposta = { forma, operadora, valor (number|null), digitado (bool), grupo?, obs?, naoSei? }
  function montarParams(row, tsDevice, resposta, fila) {
    var r = resposta || {};
    var p = {
      action: 'confirmarPagamento',
      row: Number(row),
      ts_device: tsDevice,
      pg_forma: r.forma || '',
      pg_valor: r.naoSei ? '' : valorParaServidor(r.valor),
      pg_digitado: r.digitado ? 1 : 0,
      pg_fila: fila ? 1 : 0,
    };
    if (r.operadora) p.pg_operadora = r.operadora;
    if (r.valeNome) p.pg_vale_nome = String(r.valeNome).slice(0,80);
    if (r.cartaoAgrupado) p.pg_cartao_agrupado = 1;
    if (r.grupo) p.pg_grupo = r.grupo;
    // As rows que o MESMO comprovante cobre (contrato §5, `pg_grupo_rows`): é por elas que o
    // servidor soma os totais do grupo e compara soma × comprovante. Sem isto (revisão 05/09) o
    // servidor recebia o total do comprovante e comparava com UM pedido só.
    if (r.grupo && Array.isArray(r.grupoRows) && r.grupoRows.length) p.pg_grupo_rows = r.grupoRows.map(Number).filter(function (n) { return n > 0; }).join(',');
    if (r.obs) p.pg_obs = String(r.obs).slice(0, 200);
    if (r.naoSei) p.pg_naosei = 1;
    return p;
  }

  // Frase curta para o cartão ("💳 Crédito · R$ 189,50 ✓").
  function fraseResposta(resposta, formas) {
    var r = resposta || {};
    if (r.rejeitada || r.aprovacao === 'rejeitado') return '⚠️ Corrigir pagamento: ' + (r.erro || 'valor rejeitado pela equipe');
    if (r.naoSei) return '💳 Pagamento: não soube dizer';
    if (r.forma === 'nao-pagou') return '⚠️ NÃO PAGOU';
    var rot = cartao(r.forma) ? 'Crédito/Débito' : (r.valeNome || rotuloForma(r.forma, r.operadora, formas, r.forma));
    var v = (r.valor === null || r.valor === undefined) ? 'valor não informado' : fmtBRL(r.valor);
    return '💳 ' + rot + ' · ' + v + (r.digitado ? ' (digitado)' : ' ✓');
  }

  async function perguntar(ctx) {
    var item = ctx.item, ui = ctx.ui, formas = formasPermitidas((ctx.cfg || {}).formas);
    var out = { porRow: {}, manteve: false, cancelado: false };
    try {
      var grupo = irmasNaPorta(ctx.irmas && ctx.irmas.length ? ctx.irmas : [item]);
      if (!grupo.length) grupo = [item];
      grupo.soma = grupo.reduce(function (s, x) { return s + Number(x.valor || 0); }, 0);
      var anteriorValido = respostaCompleta(ctx.anterior, formas);
      if (ctx.anterior && anteriorValido) {
        var esc = await ui.escolher('Você já informou: ' + fraseResposta(ctx.anterior, formas) + '\nQuer manter ou corrigir?', [
          { valor: 'manter', rotulo: 'Manter', tom: 'success' }, { valor: 'corrigir', rotulo: 'Corrigir' }
        ], { titulo: 'Pagamento na entrega', textoCancelar: 'Cancelar' });
        if (cancelou(esc)) return { porRow: {}, manteve: false, cancelado: true };
        if (esc === 'manter') { out.manteve = true; return out; }
      }
      for (var i = 0; i < grupo.length; i++) {
        var r = await perguntarUm(grupo[i], ui, formas, i === 0 && !ctx.anterior ? grupo : null,
          grupo.length > 1 ? (i + 1) + ' de ' + grupo.length + ' · ' : '', !!ctx.anterior);
        if (!r) return { porRow: {}, manteve: false, cancelado: true };
        if (r.tudo) {
          var chaveGrupo = String(Number(item.row)) + ':' + String(ctx.tsDevice || '');
          var rowsGrupo = grupo.map(function (x) { return Number(x.row); });
          grupo.forEach(function (x) {
            out.porRow[Number(x.row)] = { forma: x.pgFormaChave, operadora: x.pgOperadora || null,
              valor: grupo.soma, digitado: false, grupo: chaveGrupo, grupoRows: rowsGrupo, cartaoAgrupado: cartao(x.pgFormaChave) };
          });
          return out;
        }
        out.porRow[Number(grupo[i].row)] = r;
      }
      return out;
    } catch (e) {
      try { console.error('[pagamento-porta]', e); await ui.alerta('Não foi possível concluir o pagamento. Confira novamente antes de salvar.', { tom: 'warn' }); } catch (_) {}
      return { porRow: {}, manteve: false, cancelado: true };
    }
  }

  async function perguntarUm(item, ui, formas, grupo, pos, direto) {
    for (var volta = 0; volta < MAX_VOLTAS; volta++) {
      if (!direto && formaResolvida(item, formas)) {
        var e = await ui.escolher(mensagemTela1(item, formas), opcoesTela1(item, grupo, formas),
          { titulo: pos + 'Como o cliente pagou?', textoCancelar: 'Cancelar' });
        if (cancelou(e)) return null;
        if (e === 'tudo' && opcoesTela1(item, grupo, formas).some(function (o) { return o.valor === 'tudo'; })) return { tudo: true };
        if (e === 'igual' && valorConfirmado(item)) return { forma: item.pgFormaChave, operadora: item.pgOperadora || null,
          valor: Number(item.valor), digitado: false, cartaoAgrupado: cartao(item.pgFormaChave) };
      }
      direto = false;
      var ops = opcoesTela2(item, formas);
      if (!ops.length) { await ui.alerta('As formas de pagamento não estão disponíveis. Atualize o app para continuar.', { tom: 'warn' }); return null; }
      var f = await ui.escolher('Qual foi a forma de pagamento?', ops,
        { titulo: pos + 'Forma de pagamento', textoCancelar: 'Cancelar' });
      if (cancelou(f)) return null;
      if (f.grupo === 'cartao') {
        if (cartao(item.pgFormaChave) && formaResolvida(item, formas)) {
          f = { forma: item.pgFormaChave, operadora: null, cartaoAgrupado: true };
        } else {
          f = await ui.escolher('Qual tipo aparece no comprovante?', formas.filter(function (x) { return cartao(x.chave); }).map(function (x) {
            return { valor: { forma: x.chave, operadora: null }, rotulo: x.chave === 'credito-entrega' ? 'Crédito' : 'Débito' };
          }), { titulo: 'Cartão na entrega', textoCancelar: 'Voltar' });
          if (cancelou(f)) continue;
        }
      } else if (f.grupo === 'vale') {
        f = await ui.escolher('Qual foi o vale usado?', formas.filter(ehVale).map(function (x) {
          return { valor: { forma: x.chave, operadora: x.operadora || null }, rotulo: x.rotulo || x.chave };
        }), { titulo: 'Operadora do vale', textoCancelar: 'Voltar' });
        if (cancelou(f)) continue;
        if (f.operadora === 'outra') {
          var nome = await ui.perguntar('Nome do vale usado:', { titulo: 'Outro vale', textoOk: 'Continuar', textoCancelar: 'Voltar', placeholder: 'Nome da operadora' });
          if (cancelou(nome)) continue;
          if (String(nome).trim().length < 2) { await ui.alerta('Informe o nome do vale.', { tom: 'warn' }); continue; }
          f.valeNome = String(nome).trim().slice(0,80);
        }
      }
      if (!f.forma || !formas.some(function (x) { return x.chave === f.forma && (!x.operadora || x.operadora === f.operadora); })) continue;
      if (f.forma === 'nao-pagou') {
        var n = await ui.escolher('Confirma que entregou o pedido e o cliente NÃO PAGOU?',
          [{ valor: 'sim', rotulo: 'Confirmar NÃO PAGOU', tom: 'danger' }], { titulo: 'NÃO PAGOU', textoCancelar: 'Voltar' });
        if (n !== 'sim') continue;
        return { forma: 'nao-pagou', operadora: null, valor: null, digitado: false,
          obs: 'O entregador declarou no aplicativo: NÃO PAGOU. Pedido entregue sem receber.' };
      }
      // MODAL GRANDE DA FORMA: mudou a conta em relacao ao pedido. Credito e debito NAO contam
      // como mudanca (equivalentes) - e a mesma maquininha, e alardear isso seria ruido diario.
      // Sem forma declarada no pedido nao ha divergencia: nao havia o que contrariar.
      if (item.pgFormaChave && !equivalentes(f.forma, item.pgFormaChave)) {
        var rotPedido = cartao(item.pgFormaChave) ? 'Crédito/Débito' : rotuloForma(item.pgFormaChave, item.pgOperadora || null, formas, item.formaPagamento);
        var rotNovo = cartao(f.forma) ? 'Crédito/Débito' : (f.valeNome || rotuloForma(f.forma, f.operadora || null, formas, f.forma));
        var okForma = await ui.escolher(
          'A forma de pagamento é DIFERENTE da que está no pedido.' + '\n\n' +
          'No pedido: ' + String(rotPedido).toUpperCase() + '\n' +
          'Você marcou: ' + String(rotNovo).toUpperCase() + '\n\n' +
          'Confirma que o cliente pagou nessa conta?',
          [{ valor: 'sim', rotulo: '✓ Sim, foi ' + String(rotNovo).toUpperCase(), tom: 'danger' },
           { valor: 'nao', rotulo: '✏️ Não, escolher de novo' }],
          { titulo: 'Confere a conta', textoCancelar: 'Cancelar' }
        );
        if (cancelou(okForma)) return null;
        if (okForma !== 'sim') continue;
      }
      var v = await telaValor(item, ui, f.forma);
      if (!v) return null;
      return { forma: f.forma, operadora: f.operadora || null, valor: v.valor, digitado: v.digitado,
        ...(f.valeNome ? { valeNome: f.valeNome } : {}), ...(f.cartaoAgrupado ? { cartaoAgrupado: true } : {}) };
    }
    return null;
  }

  async function telaValor(item, ui, forma) {
    var msg = ehDinheiro(forma) ? 'Informe o total recebido em dinheiro, antes de devolver o troco. A diferença por troco não altera o valor do pedido.' : 'Informe o valor cobrado, igual no comprovante.';
    if (valorConfirmado(item)) msg += '\nValor do pedido: ' + fmtBRL(item.valor);
    var atual = '';
    for (var i = 0; i < MAX_VOLTAS; i++) {
      var raw = await ui.perguntar(msg, { titulo: 'Valor recebido — obrigatório', valor: atual, placeholder: 'Ex.: 189,50',
        inputmode: 'decimal', textoOk: 'Salvar pagamento', textoCancelar: 'Cancelar' });
      if (cancelou(raw)) return null;
      var n = parseValor(raw);
      if (n == null || n >= 10000000000) { atual = String(raw); await ui.alerta('Informe um valor válido para salvar, igual no comprovante.', { tom: 'warn' }); continue; }

      // TRAVA: 10x pra mais ou pra menos nao e diferenca, e virgula errada. Nao da pra confirmar.
      var refTrava = valorReferencia(item);
      if (refTrava != null && discrepante(n, refTrava, forma)) {
        atual = String(raw);
        await ui.alerta(
          'Esse valor está MUITO longe do pedido e não pode ser salvo.' + '\n\n' +
          'Você digitou: ' + fmtBRL(n) + '\n' +
          'Pedido: ' + fmtBRL(refTrava) + '\n\n' +
          'Confira a vírgula e digite de novo, igual no comprovante.',
          { titulo: 'Valor não confere', tom: 'danger' }
        );
        continue;
      }

      // MODAL GRANDE: diferente do pedido, mas possivel. Confirma valor E conta antes de salvar.
      if (valorConfirmado(item) && valorDivergente(n, item.valor, forma)) {
        var difere = n - Number(item.valor);
        var conf = await ui.escolher(
          'O valor que você digitou é DIFERENTE do pedido.' + '\n\n' +
          'Você digitou: ' + fmtBRL(n) + '\n' +
          'Pedido: ' + fmtBRL(item.valor) + '\n' +
          (difere > 0 ? 'A MAIS: ' + fmtBRL(difere) : 'A MENOS: ' + fmtBRL(-difere)) + '\n\n' +
          'Confirma que foi esse o valor cobrado, igual no comprovante?',
          [{ valor: 'sim', rotulo: '✓ Sim, foi ' + fmtBRL(n), tom: 'danger' },
           { valor: 'nao', rotulo: '✏️ Não, corrigir o valor' }],
          { titulo: 'Confere o valor', textoCancelar: 'Cancelar' }
        );
        if (cancelou(conf)) return null;
        if (conf !== 'sim') { atual = String(raw); continue; }
      }

      return { valor: n, digitado: true };
    }
    // Esgotou as tentativas. Sair calado aqui derrubava a entrega INTEIRA sem uma palavra (a
    // revisao mediu: 6 travas seguidas e `page-entregas` so dava return). Avisa antes de desistir.
    try {
      await ui.alerta('Não deu pra confirmar o valor do pagamento.' + '\n\n' +
        'A entrega NÃO foi salva. Abra o pedido de novo e informe o pagamento com calma.',
        { titulo: 'Pagamento não salvo', tom: 'warn' });
    } catch (e) {}
    return null;
  }

  return {
    fmtBRL: fmtBRL,
    parseValor: parseValor,
    valorParaServidor: valorParaServidor,
    rotuloForma: rotuloForma,
    devePerguntar: devePerguntar,
    irmasNaPorta: irmasNaPorta,
    opcoesTela1: opcoesTela1,
    mensagemTela1: mensagemTela1,
    opcoesTela2: opcoesTela2,
    montarParams: montarParams,
    fraseResposta: fraseResposta,
    perguntar: perguntar,
    MAX_VOLTAS: MAX_VOLTAS,
    respostaCompleta: respostaCompleta, formasPermitidas: formasPermitidas,
    // Regras puras da conferencia de valor - expostas para a regua testar sem simular tela.
    discrepante: discrepante, valorDivergente: valorDivergente, FATOR_TRAVA: FATOR_TRAVA,
    TROCO_MAX_CENTAVOS: TROCO_MAX_CENTAVOS,
  };
});
