// ====================================================================
// pagamento-porta.js — o entregador CONFIRMA como o cliente pagou NA PORTA (05/09/2026).
//
// O dono (05/09): "quando o pagamento for NA ENTREGA [...] ao finalizar quero um modal
// perguntando para o ENTREGADOR confirmar o VALOR e a FORMA que o cliente pagou. Aí sabemos
// também o HORÁRIO aproximado [...] e dá pra pesquisar no extrato da Cielo."
//
// Por que existe como arquivo separado (e não dentro de page-entregas.js):
//   1. a LÓGICA PURA (o que o modal monta, o que vai no payload) fica provável em node, sem
//      navegador: scripts/_t-pagamento-porta.mjs carrega este arquivo com um AppUI de mentira;
//   2. o fluxo é chamado por DUAS portas (o botão Entregue e o menu de "entrega em andamento"),
//      e uma função só garante que as duas montam a MESMA coisa.
//
// ⭐ A ordem dos atos joga a favor: a entrega acontece ANTES de o dono finalizar o pedido, e a
//    NF-e só sai na finalização (manual). A resposta daqui chega ANTES DA NOTA — no servidor ela
//    vira a forma do pedido (erp_pedido_edicao / loja_pedidos) e faz a nota sair com o tPag certo.
//
// ⛔ REGRAS QUE ESTE ARQUIVO NÃO PODE QUEBRAR:
//   - NUNCA impede o "Entregue": qualquer saída do modal (inclusive fechar o overlay ou uma
//     exceção) vira uma resposta — no pior caso `naoSei` — e o fluxo segue.
//   - NUNCA depende de rede: só monta a resposta; quem envia é page-entregas.js pela fila que
//     já existe (core.js enfileirar/processarFila).
//   - O caso comum ("pagou como disse") custa 1 TOQUE. Medido 05/09: 32,6 modais/dia.
//
// Contrato com o servidor (docs/DESENHO-pagamento-na-entrega.md §B.2/§B.5, no painel):
//   entra pelo `entregas`: { perguntarPagamento: bool, formasNaPorta: [{chave, rotulo, operadora?, tom?}] }
//                          e por item: pgFormaChave (forma DECLARADA como chave) · pgConfirmado
//   sai como ação própria: { action:'confirmarPagamento', row, ts_device, pg_forma, pg_operadora?,
//                            pg_valor ("" = não sei), pg_digitado (0/1), pg_grupo?, pg_obs?, pg_fila (0/1),
//                            pg_naosei (1 só quando ele não soube dizer) }
// ====================================================================
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api; // node (réguas)
  root.PgPorta = api;                                                                  // navegador
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Quantas vezes o entregador pode "voltar" entre telas antes de o modal desistir sozinho e
  // devolver "não sei" — trava contra loop infinito com o cliente esperando na porta.
  var MAX_VOLTAS = 6;

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

  // ---- As telas (o que cada uma MONTA, sem tocar em DOM: são dados para AppUI.escolher) ----

  // Tela 1 — o caso comum. Cancelar (ou fechar o overlay) = "Não sei / não vi".
  function opcoesTela1(item, grupo, formas) {
    var forma = item.pgFormaChave || null;
    var rot = rotuloForma(forma, item.pgOperadora || null, formas, item.formaPagamento);
    var ops = [];
    if (grupo && grupo.length > 1 && forma) {
      ops.push({ valor: 'tudo', rotulo: '✓ Pagou tudo junto: ' + fmtBRL(grupo.soma) + ' no ' + rot.toUpperCase() + ' (' + grupo.length + ' pedidos)', tom: 'success' });
    }
    // O 1º botão é o caso comum e ganha o tom verde (e o foco automático do ui.js).
    if (forma) ops.push({ valor: 'igual', rotulo: '✓ Pagou ' + fmtBRL(item.valor) + ' no ' + rot.toUpperCase(), tom: ops.length ? undefined : 'success' });
    ops.push({ valor: 'diferente', rotulo: forma ? '✏️ Foi diferente (outra forma ou outro valor)' : '✏️ Informar como pagou' });
    return ops;
  }

  function mensagemTela1(item, formas) {
    var forma = item.pgFormaChave || null;
    var rot = rotuloForma(forma, item.pgOperadora || null, formas, item.formaPagamento);
    var troco = Number(item.troco) || 0;
    var linha = 'Pedido ' + fmtBRL(item.valor) + (forma ? ' · ' + rot.toUpperCase() : ' · forma não informada');
    if (troco > 0 && ehDinheiro(forma || item.formaPagamento)) linha += '\ntroco p/ ' + fmtBRL(troco);
    return linha;
  }

  // Tela 2 — a forma. A declarada vem PRIMEIRO, marcada "(como no pedido)".
  function opcoesTela2(item, formas) {
    var lista = (Array.isArray(formas) ? formas : []).filter(function (f) { return f && f.chave; });
    var decl = item.pgFormaChave || null, declOp = item.pgOperadora || null;
    var ops = lista.map(function (f) {
      var ehDecl = f.chave === decl && (declOp ? f.operadora === declOp : !f.operadora);
      return { valor: { forma: f.chave, operadora: f.operadora || null }, rotulo: String(f.rotulo || f.chave) + (ehDecl ? ' (como no pedido)' : ''), tom: ehDecl ? 'success' : (f.tom || undefined), _decl: ehDecl };
    });
    ops.sort(function (a, b) { return (b._decl ? 1 : 0) - (a._decl ? 1 : 0); });
    return ops.map(function (o) { return { valor: o.valor, rotulo: o.rotulo, tom: o.tom }; });
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
    if (r.naoSei) return '💳 Pagamento: não soube dizer';
    if (r.forma === 'nao-pagou') return '⚠️ NÃO PAGOU';
    var rot = rotuloForma(r.forma, r.operadora, formas, r.forma);
    var v = (r.valor === null || r.valor === undefined) ? 'valor não informado' : fmtBRL(r.valor);
    return '💳 ' + rot + ' · ' + v + (r.digitado ? ' (digitado)' : ' ✓');
  }

  // ---- O FLUXO (as 4 telas). NUNCA lança, NUNCA devolve "aborta". ----
  // ctx = { item, irmas, cfg, ui, anterior?, tsDevice, posicao? {n, de} }
  // Devolve { porRow: { [row]: resposta | null }, manteve: bool }
  //   resposta null = "manter" (já tinha respondido e não mudou) → não envia nada.
  async function perguntar(ctx) {
    var item = ctx.item, ui = ctx.ui, cfg = ctx.cfg || {}, formas = cfg.formas || [];
    var out = { porRow: {}, manteve: false };
    try {
      var grupo = irmasNaPorta(ctx.irmas && ctx.irmas.length ? ctx.irmas : [item]);
      if (!grupo.length) grupo = [item];
      grupo.soma = grupo.reduce(function (s, x) { return s + (Number(x.valor) || 0); }, 0);

      // Tela 4 — já respondeu antes (reaberto, ou está na fila): manter (1 toque) ou corrigir.
      if (ctx.anterior) {
        var esc4 = await ui.escolher('Você já respondeu: ' + fraseResposta(ctx.anterior, formas).replace(/^💳 /, '') + '\n\nQuer manter ou corrigir?', [
          { valor: 'manter', rotulo: '✓ Manter', tom: 'success' },
          { valor: 'corrigir', rotulo: '✏️ Corrigir' },
        ], { titulo: '💳 Pagamento na entrega', textoCancelar: 'Manter' });
        if (esc4 !== 'corrigir') { out.manteve = true; grupo.forEach(function (x) { out.porRow[Number(x.row)] = null; }); return out; }
        // corrigir → cai nas telas 2/3 do pedido tocado (o grupo, se houver, responde 1 a 1)
      }

      for (var gi = 0; gi < grupo.length; gi++) {
        var x = grupo[gi];
        var pos = grupo.length > 1 ? (gi + 1) + ' de ' + grupo.length + ' · ' : '';
        // Corrigindo uma resposta anterior: pula a tela 1 (ele já disse que foi diferente).
        var resp = await perguntarUm(x, ui, formas, gi === 0 && !ctx.anterior ? grupo : null, pos, !!ctx.anterior);
        if (resp && resp.tudo) {
          // "Pagou tudo junto": UMA resposta para TODAS as irmãs; o servidor compara soma × comprovante.
          var chaveGrupo = String(Number(item.row)) + ':' + String(ctx.tsDevice || '');
          var rowsGrupo = grupo.map(function (y) { return Number(y.row); });
          grupo.forEach(function (y) {
            out.porRow[Number(y.row)] = { forma: resp.forma, operadora: resp.operadora, valor: grupo.soma, digitado: false, grupo: chaveGrupo, grupoRows: rowsGrupo };
          });
          return out;
        }
        out.porRow[Number(x.row)] = resp;
      }
      return out;
    } catch (e) {
      // ⛔ O modal quebrou (AppUI ausente, exceção): a entrega NÃO pode parar. Registra "não sei"
      // com o motivo, e segue.
      try { console.error('[pagamento-porta]', e); } catch (e2) {}
      var g2 = irmasNaPorta(ctx.irmas && ctx.irmas.length ? ctx.irmas : [item]);
      if (!g2.length) g2 = [item];
      g2.forEach(function (y) { if (out.porRow[Number(y.row)] === undefined) out.porRow[Number(y.row)] = { forma: y.pgFormaChave || '', operadora: null, valor: null, digitado: false, naoSei: true, obs: 'erro-no-modal' }; });
      return out;
    }
  }

  // Um pedido: telas 1 → (2 → 3). Devolve resposta (nunca null).
  async function perguntarUm(item, ui, formas, grupoTela1, posicao, direto2) {
    var declarada = { forma: item.pgFormaChave || null, operadora: item.pgOperadora || null };
    var voltas = 0;
    var naoSei = { forma: declarada.forma || '', operadora: declarada.operadora, valor: null, digitado: false, naoSei: true };

    while (voltas++ < MAX_VOLTAS) {
      var escolha;
      if (declarada.forma && !(direto2 && voltas === 1)) {
        // Tela 1 — 1 toque no caso comum. Cancelar/fechar = não sei.
        escolha = await ui.escolher(mensagemTela1(item, formas), opcoesTela1(item, grupoTela1, formas), {
          titulo: '💳 ' + posicao + 'Como o cliente pagou?', textoCancelar: 'Não sei / não vi',
        });
        if (cancelou(escolha)) return naoSei;
        if (escolha === 'tudo') return { tudo: true, forma: declarada.forma, operadora: declarada.operadora };
        if (escolha === 'igual') return { forma: declarada.forma, operadora: declarada.operadora, valor: Number(item.valor) || 0, digitado: false };
      } else {
        escolha = 'diferente'; // sem forma declarada → direto na tela 2
      }

      // Tela 2 — a forma.
      var ops2 = opcoesTela2(item, formas);
      if (!ops2.length) {
        // O servidor não mandou a lista (ou ela está vazia): não dá para escolher forma; ainda
        // vale perguntar o VALOR, que é a segunda fonte que o dono pediu.
        var soValor = await telaValor(item, ui, declarada.forma, formas);
        if (soValor === 'voltar') { if (!declarada.forma) return naoSei; continue; }
        return { forma: declarada.forma || '', operadora: declarada.operadora, valor: soValor.valor, digitado: soValor.digitado };
      }
      var f2 = await ui.escolher('Qual foi a forma de pagamento?', ops2, { titulo: '💳 ' + posicao + 'Forma de pagamento', textoCancelar: declarada.forma ? 'Voltar' : 'Não sei / não vi' });
      if (cancelou(f2) || !f2.forma) { if (!declarada.forma) return naoSei; continue; } // volta à tela 1

      if (f2.forma === 'nao-pagou') {
        var confirmar = await ui.escolher('Confirma que entregou o pedido e o cliente NÃO PAGOU?', [
          { valor: 'sim', rotulo: 'Confirmar NÃO PAGOU', tom: 'danger' }
        ], { titulo: 'NÃO PAGOU', textoCancelar: 'Voltar' });
        if (confirmar !== 'sim') continue;
        return { forma: 'nao-pagou', operadora: null, valor: null, digitado: false,
          obs: 'O entregador declarou no aplicativo: NÃO PAGOU. Pedido entregue sem receber.' };
      }
      // Tela 3 — o valor EXATO do comprovante.
      var v3 = await telaValor(item, ui, f2.forma, formas);
      if (v3 === 'voltar') continue;
      return { forma: f2.forma, operadora: f2.operadora || null, valor: v3.valor, digitado: v3.digitado };
    }
    return naoSei;
  }

  // Tela 3. Devolve { valor: number|null, digitado: bool } ou 'voltar'.
  // "É esse mesmo" aceita o pré-preenchido (digitado=false → NÃO é fonte independente de valor).
  // OK com número = digitado=true. Vazio = valor null ("não sei o valor", a forma continua valendo).
  async function telaValor(item, ui, formaChave, formas) {
    var pre = Number(item.valor) || 0;
    var dinheiro = ehDinheiro(formaChave);
    var msg = dinheiro
      ? 'Quanto você RECEBEU em dinheiro? (o valor do pedido é ' + fmtBRL(pre) + ')'
      : 'Digite exatamente o valor que aparece no comprovante.\n(o valor do pedido é ' + fmtBRL(pre) + ')';
    var atual = pre.toFixed(2).replace('.', ',');
    for (var tent = 0; tent < 3; tent++) {
      var raw = await ui.perguntar(msg, {
        titulo: dinheiro ? '💵 Valor pago — quanto recebeu em dinheiro' : '🧾 Valor pago — igual no comprovante',
        valor: atual, placeholder: 'Ex.: 189,50', inputmode: 'decimal',
        textoOk: 'Confirmar', textoCancelar: 'É esse mesmo',
      });
      if (cancelou(raw)) return { valor: pre, digitado: false }; // "É esse mesmo" / fechou = aceita o pré-preenchido
      var s = String(raw).trim();
      if (!s) return { valor: null, digitado: false }; // apagou tudo = não sei o valor
      var n = parseValor(s);
      if (n === null) {
        atual = s;
        await ui.alerta('Valor inválido. Digite só números, com vírgula nos centavos (ex.: 189,50).', { titulo: 'Valor inválido', tom: 'warn' });
        continue;
      }
      // Igual ao pré-preenchido (ao centavo) = ele "aceitou", não "digitou": a coluna
      // valor_digitado é o que faz a fonte ser ou não independente (desenho §A.3).
      return { valor: n, digitado: Math.abs(n - pre) > 0.004 };
    }
    return { valor: null, digitado: false };
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
  };
});
