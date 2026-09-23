// Prova a régua _t-toque-instantaneo.mjs por REINTRODUÇÃO: planta, numa CÓPIA dos assets, cada
// defeito que o conserto de 23/09/2026 tirou, e exige que a régua fique VERMELHA. Se algum defeito
// passar VERDE, a régua mente — e é isso que este script pega. O original nunca é tocado (conferido
// byte a byte no fim).
//
//   node scripts/_t-toque-instantaneo-reintroducao.mjs
//
// Mesma anatomia da régua do pagamento na porta (_t-pagamento-porta-reintroducao.mjs), inclusive a
// AUTO-PROVA: antes de dar qualquer placar, planta um defeito de CONTROLE e confere que a régua
// (a) ecoou "alvo=<cópia>" — ou seja, leu mesmo o mutante — e (b) reprovou. Sem isso, um placar
// cheio de ✅ não significaria nada, que foi exatamente o que aconteceu em 09/09 e 10/09.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const assets = path.join(raiz, 'public', 'assets');
const regua = path.join(aqui, '_t-toque-instantaneo.mjs');
const ARQUIVOS = ['core.js', 'page-entregas.js'];
const antes = Object.fromEntries(ARQUIVOS.map(f => [f, readFileSync(path.join(assets, f))]));
// Os assets estão em CRLF. Os trechos abaixo são escritos com \n — sem normalizar, TODO defeito de
// mais de uma linha sairia como "trecho não existe mais" e a régua daria um placar de mentira
// (foi o primeiro resultado desta própria régua, em 23/09). A cópia mutada pode ficar em \n: o
// JavaScript não se importa, e o original não é tocado.
const texto = f => antes[f].toString('utf8').replace(/\r\n/g, '\n');

const defeitos = [
  {
    nome: 'naoEncontrado volta a ser DESCARTE SILENCIOSO (tela fica verde no que o servidor recusou)',
    arquivo: 'core.js',
    de: `        await bancoFila.recusar(item.id, (res.error && String(res.error)) ||
          'Esta parada não está mais na sua rota. Se você entregou, avise o escritório.');`,
    para: '        await bancoFila.ack(item.id);'
  },
  {
    nome: 'um item envenenado volta a CONGELAR a fila inteira atrás dele',
    arquivo: 'core.js',
    de: `        const n = (_ambiguas.get(item.id) || 0) + 1;`,
    para: `        break; const n = (_ambiguas.get(item.id) || 0) + 1;`
  },
  {
    nome: 'erro ambíguo reenvia para SEMPRE, sem nunca avisar o entregador',
    arquivo: 'core.js',
    de: 'const MAX_AMBIGUAS_STATUS = 12;',
    para: 'const MAX_AMBIGUAS_STATUS = Infinity;'
  },
  {
    nome: 'porteiro fechado (login/montagem) tratado como recusa do ato',
    arquivo: 'core.js',
    de: `      } else if (res && (res.precisaLogin || res.montagemBloqueada || res.montagemIndisponivel)) {`,
    para: `      } else if (res && false) {`
  },
  {
    nome: 'keepalive dispara também em row com DUAS declarações (ordem não garantida)',
    arquivo: 'core.js',
    de: 'if (itens.length !== 1) continue; // ambíguo na ordem → deixa para o consumidor serial',
    para: 'if (itens.length < 1) continue; // ambíguo na ordem → deixa para o consumidor serial'
  },
  {
    nome: 'a tela volta a ser pintada só pelo servidor (a fila não projeta nada)',
    arquivo: 'page-entregas.js',
    de: `    const mapa = api.filaStatusPendentes && api.filaStatusPendentes();
    if (!mapa || !mapa.size) return state.items;`,
    para: `    const mapa = api.filaStatusPendentes && api.filaStatusPendentes();
    return state.items;`
  },
  {
    nome: 'o toque não congela mais o estado ANTERIOR: a recusa não tem como desfazer',
    arquivo: 'page-entregas.js',
    de: `    const atual = state.items.find(function (x) { return Number(x.row) === Number(row); });
    if (!atual) return { row: Number(row) };
    return { row: Number(row), statusAnterior: atual.status || '', obsAnterior: atual.observacaoPedido || '' };`,
    para: '    return { row: Number(row) };'
  },
  {
    nome: 'falha de armazenamento é engolida e a tela FINGE que marcou',
    arquivo: 'page-entregas.js',
    de: `        console.error('[fila]', error);
        await avisarArmazenamento();
        return;`,
    para: `        console.error('[fila]', error);`
  },
  {
    nome: 'a REDE volta para o caminho do dedo (o botão espera o envio de novo)',
    arquivo: 'page-entregas.js',
    de: '      if (idsRecebimento) acompanharEnvio(idsRecebimento);\n      else agendarEnvio();',
    para: '      if (idsRecebimento) await enviarRecebimentoGuardado(idsRecebimento);\n      else await api.processarFila();'
  },
  {
    nome: 'o toque volta a mandar recarregar a lista por cima do que está na fila',
    arquivo: 'page-entregas.js',
    de: '      if (idsRecebimento) acompanharEnvio(idsRecebimento);',
    para: '      carregarTudo(false);\n      if (idsRecebimento) acompanharEnvio(idsRecebimento);'
  },
  {
    nome: 'recusa de PAGAMENTO deixa de avisar para conferir (afrouxa a regra de dinheiro)',
    arquivo: 'page-entregas.js',
    de: `    if (recusados.length) {
      await AppUI.alerta('Pagamento precisa de conferência: '`,
    para: `    if (false) {
      await AppUI.alerta('Pagamento precisa de conferência: '`
  },
];

const tmp = mkdtempSync(path.join(os.tmpdir(), 'toque-'));
const copia = path.join(tmp, 'assets');
let mentiu = 0, velhos = 0, harnessQuebrado = null;

function montar(arquivo, conteudo) {
  rmSync(copia, { recursive: true, force: true });
  cpSync(assets, copia, { recursive: true });
  if (arquivo) writeFileSync(path.join(copia, arquivo), conteudo);
  return copia;
}
const rodar = () => spawnSync(process.execPath, [regua], {
  env: { ...process.env, APP_ASSETS_DIR: copia }, encoding: 'utf8', timeout: 180000
});

try {
  {
    // CONTROLE: `marcarEntregue` passa a projetar o status errado. A régua inteira gira em torno de
    // "ficou verde na hora", então isto TEM de reprovar.
    montar('core.js', texto('core.js')
      .replace("marcarEntregue: 'Entregue',", "marcarEntregue: 'Nada',"));
    const r = rodar();
    const ecoou = (r.stdout || '').split(/\r?\n/).includes('alvo=' + copia);
    if (!ecoou) harnessQuebrado = 'a régua NÃO ecoou "alvo=<cópia>" — ela ignora APP_ASSETS_DIR e está medindo o ORIGINAL';
    else if (r.status === 0) harnessQuebrado = 'o defeito de CONTROLE (marcarEntregue projeta status errado) passou verde';
  }
  if (harnessQuebrado) {
    console.log('⛔ HARNESS QUEBRADO — ' + harnessQuebrado);
    console.log('   Nenhum placar valeria nada, então nem rodo os defeitos. Conserte a régua primeiro.');
  } else {
    console.log('✅ auto-prova: a régua lê o mutante e reprova o defeito de controle');
    for (const d of defeitos) {
      const src = texto(d.arquivo);
      // "trecho não existe mais" = lista VELHA. É falha, mas pede refazer o trecho — não é a mesma
      // coisa que a régua mentir. Somar as duas esconderia qual das duas aconteceu.
      if (!src.includes(d.de)) { console.log('🟡 RÉGUA VELHA (refazer o trecho) — ' + d.nome); velhos++; continue; }
      montar(d.arquivo, src.replace(d.de, d.para));
      const r = rodar();
      const saida = (r.stdout || '') + (r.stderr || '');
      // Vermelho SÓ por reprovação de cenário. Crash ou timeout não contam: um erro de sintaxe
      // plantado por engano leria como "pegou o defeito" e inflaria o placar.
      const reprovou = /AssertionError|ERR_ASSERTION|^FAIL /m.test(saida);
      if (r.signal || (r.status !== 0 && !reprovou)) { console.log('⛔ a régua QUEBROU (não foi cenário) — ' + d.nome); mentiu++; continue; }
      const vermelho = r.status !== 0 && reprovou;
      console.log((vermelho ? '✅ VERMELHO como devia — ' : '❌ FICOU VERDE (a régua mente) — ') + d.nome);
      if (!vermelho) mentiu++;
    }
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

const intactos = ARQUIVOS.every(f => Buffer.compare(antes[f], readFileSync(path.join(assets, f))) === 0);
console.log(intactos ? '✅ originais intactos (byte a byte)' : '❌ ALGUM ORIGINAL MUDOU');
if (harnessQuebrado) console.log('🔴 reintrodução: NÃO MEDIDA — harness quebrado');
else if (mentiu || velhos || !intactos) console.log('🔴 reintrodução: ' + mentiu + ' ponto(s) cego(s) + ' + velhos + ' trecho(s) velho(s)');
else console.log('🟢 reintrodução: todos os ' + defeitos.length + ' defeitos ficaram vermelhos');
process.exitCode = (harnessQuebrado || mentiu || velhos || !intactos) ? 1 : 0;
