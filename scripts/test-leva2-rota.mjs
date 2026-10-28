// RÉGUA DA LEVA 2 (28/10/2026) — Iniciar/Finalizar a rota (KM/foto) e o GPS. Código REAL (core.js, fila-duravel.js, rastreio.js)
// numa VM; transporte, IndexedDB e o plugin nativo do GPS fictícios. Roda: node scripts/test-leva2-rota.mjs
//
// O QUE ELA PROVA:
//   K1 a foto do KM inicial pendente só sai do aparelho quando o servidor CONFIRMA a foto (`rotaInfo.fotoInicio`) — antes, o replay
//      do iniciarRota (que não grava foto) respondia ok e o app APAGAVA a foto; com o servidor gravando, ela sai;
//   K2 o mesmo no "✏️ Trocar a foto" (o Iniciar/Finalizar devolve `semFoto` e a tela diz "guardada");
//   K3 o Iniciar faz UMA chamada (o próprio iniciarRota): saiu a 2ª conferência da montagem que o core repetia (até 15 s sem sinal);
//   K4 servidor sem `rotaInfo` (versão antiga): vale a regra de antes (ok com foto = gravou);
//   G1 GPS: o lote vai com o TURNO e o dia certos (antes `window.getTurno`, que não existe: pontos sem turno, fora do mapa) e com o
//      token do entregador;
//   G2 GPS: o rastreio nativo que ficou de uma abertura anterior é desligado ao ligar de novo, e o Finalizar desliga o órfão.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { app, reguas, ler, PREFIXO } from './_harness-leva2.mjs';

const { teste, rodar } = reguas('cenários do KM/foto e do GPS (leva 2)');
const pend = (h, fase) => JSON.parse(h.local.getItem(PREFIXO + 'rota_pend_' + fase + '|Fictício') || 'null');
const cabecalho = foto => ({ ok: true, rotaIniciada: true, rotaInfo: { kmInicial: 123, kmFinal: '', inicio: '2026-10-28T10:00:00Z', fim: null, fotoInicio: foto ? 'ok' : null, fotoFim: null } });

teste('K1 a foto pendente só sai quando o servidor confirma a foto', async () => {
  let servidorGravaFoto = false, fotoNoServidor = false;
  const h = await app({ responder: async (p, n, reg) => {
    if (p.action !== 'iniciarRota') return { ok: true };
    if (reg.metodo === 'POST') { // com foto
      if (!h.ctx.sinalBomParaFoto) throw Error('timeout fictício da foto');
      if (servidorGravaFoto && !fotoNoServidor) fotoNoServidor = true; // leva 3: grava se estiver vazia
      return cabecalho(fotoNoServidor);
    }
    return cabecalho(fotoNoServidor); // GET sem foto: grava o início, sem foto
  } });
  // 1) sinal fraco: as duas tentativas COM foto estouram; o GET sem foto grava o início
  const r = await h.api.apiIniciarRota('Fictício', '123', 'FOTO_BASE64', 'image/jpeg');
  assert.equal(r.ok, true); assert.equal(r.semFoto, true);
  assert.equal(pend(h, 'inicio').fotoBase64, 'FOTO_BASE64', 'a foto ficou guardada');
  // 2) o sinal melhora; o reenvio COM foto recebe ok de um replay que NÃO grava foto (servidor atual)
  h.ctx.sinalBomParaFoto = true;
  await h.api.reenviarRotaPendente();
  assert.ok(pend(h, 'inicio'), 'ok sem `fotoInicio` NÃO apaga a foto (antes: apagava e ela se perdia)');
  assert.equal(pend(h, 'inicio').tentativas, 1, 'conta a tentativa (depois de 20, pede ação de gente)');
  // 3) servidor da leva 3: grava a foto se estiver vazia → confirma → aí sim sai do aparelho
  servidorGravaFoto = true;
  await h.api.reenviarRotaPendente();
  assert.equal(pend(h, 'inicio'), null, 'confirmada no servidor: sai do aparelho');
});

teste('K2 "Trocar a foto": sem a confirmação da foto, o fim volta como semFoto e fica guardado', async () => {
  const h = await app({ responder: async p => p.action === 'finalizarRota'
    ? { ok: true, rotaFinalizada: true, rotaInfo: { kmFinal: 200, fotoFim: null } } : { ok: true } });
  const r = await h.api.apiFinalizarRota('Fictício', '200', 'FOTO_FIM', 'image/jpeg');
  assert.equal(r.ok, true);
  assert.equal(r.semFoto, true, 'a tela diz "a foto ficou guardada" em vez de "Foto enviada ✅"');
  assert.equal(pend(h, 'fim').fotoBase64, 'FOTO_FIM');
  const h2 = await app({ responder: async p => p.action === 'finalizarRota'
    ? { ok: true, rotaFinalizada: true, rotaInfo: { kmFinal: 200, fotoFim: 'ok' } } : { ok: true } });
  const r2 = await h2.api.apiFinalizarRota('Fictício', '200', 'FOTO_FIM', 'image/jpeg');
  assert.ok(!r2.semFoto); assert.equal(pend(h2, 'fim'), null);
});

teste('K3 o Iniciar faz UMA chamada: sem a 2ª conferência da montagem', async () => {
  const h = await app({ responder: async p => p.action === 'iniciarRota' ? cabecalho(false) : { ok: true, montagemVerificada: true } });
  const r = await h.api.apiIniciarRota('Fictício', '123', '', 'image/jpeg');
  assert.equal(r.ok, true);
  assert.deepEqual(h.calls.map(c => c.params.action), ['iniciarRota'], 'antes: verificarMontagem + iniciarRota');
  assert.equal(h.api.inicioConfirmado('Fictício'), true);
  // montagem que voltou a ficar pendente nesse meio-tempo: o próprio iniciarRota trava (e não reenvia sozinho)
  const h2 = await app({ responder: async () => ({ ok: false, montagemBloqueada: true, error: 'FINALIZE OS PEDIDOS' }) });
  await assert.rejects(() => h2.api.apiIniciarRota('Fictício', '123', 'FOTO', 'image/jpeg'), /FINALIZE/);
  assert.equal(h2.calls.length, 1);
  assert.equal(h2.api.temRotaPendenteFase('inicio'), false, 'bloqueio de verdade: não fica reenviando');
});

teste('K4 servidor sem rotaInfo (versão antiga): ok com foto = gravou, como antes', async () => {
  const h = await app({ responder: async () => ({ ok: true }) });
  const r = await h.api.apiIniciarRota('Fictício', '123', 'FOTO', 'image/jpeg');
  assert.ok(!r.semFoto);
  assert.equal(pend(h, 'inicio'), null);
});

async function comRastreio(h, { guardado } = {}) {
  const removidos = [], lotes = [];
  let cb = null;
  h.window.Capacitor = { Plugins: { BackgroundGeolocation: {
    addWatcher: (opts, f) => { cb = f; return Promise.resolve('w-novo'); },
    removeWatcher: ({ id }) => { removidos.push(id); return Promise.resolve(); }
  } } };
  if (guardado) h.local.setItem('rastreio_watcher_nativo_v1', guardado);
  h.ctx.setInterval = () => 1; h.ctx.clearInterval = () => {};
  h.transporte(async (p, n, reg) => { if (reg.caminho === '/api/ping') lotes.push(p); return { ok: true }; });
  vm.runInContext(ler('rastreio.js'), h.ctx, { filename: 'rastreio.js' });
  return { R: h.window.Rastreio, removidos, lotes, ponto: (lat, lng) => cb && cb({ latitude: lat, longitude: lng, accuracy: 5, speed: 1, bearing: 0 }) };
}

teste('G1 o lote do GPS vai com o turno, o dia e o token do entregador', async () => {
  const h = await app({ inicio: '2026-10-28T13:00:00.000Z' });
  h.api.setTurno('MANHÃ');
  const g = await comRastreio(h);
  g.R.iniciar('Fictício'); // como a tela antiga chamava: sem dia/turno → o rastreio pega do app (antes: turno '')
  await h.assentar();
  g.ponto(-19.9, -43.9);
  g.R.parar(); await h.assentar();
  assert.ok(g.lotes.length >= 1, 'o lote saiu');
  assert.equal(g.lotes[0].turno, 'MANHÃ', 'com turno (antes ia vazio e o ponto sumia do mapa)');
  assert.equal(g.lotes[0].data, h.api.diaSP());
  assert.equal(g.lotes[0].token, 'tok-ficticio', 'o token do entregador vai no lote (o servidor da leva 3 exige)');
});

teste('G2 o rastreio órfão de uma abertura anterior é desligado (ao ligar e no Finalizar)', async () => {
  const h = await app();
  const g = await comRastreio(h, { guardado: 'w-velho' });
  g.R.iniciar('Fictício', '2026-10-28', 'TARDE');
  await h.assentar();
  assert.ok(g.removidos.includes('w-velho'), 'o de antes sai antes de ligar outro (antes: dois rastreios e a notificação presa)');
  assert.equal(h.local.getItem('rastreio_watcher_nativo_v1'), 'w-novo', 'o id novo fica guardado');
  // o Android matou a tela: uma tela nova, que nunca ligou o rastreio, finaliza a rota
  const h2 = await app({ store: h.store });
  const g2 = await comRastreio(h2);
  g2.R.parar();
  assert.ok(g2.removidos.includes('w-novo'), 'o Finalizar desliga o rastreio órfão');
  assert.equal(h2.local.getItem('rastreio_watcher_nativo_v1'), null);
});

await rodar();
