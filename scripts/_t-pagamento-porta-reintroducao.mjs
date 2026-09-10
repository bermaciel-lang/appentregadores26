// Prova a régua _t-pagamento-porta.mjs por REINTRODUÇÃO: planta defeitos numa CÓPIA do
// pagamento-porta.js, exige que a régua fique VERMELHA, e confere com cmp (byte a byte) que o
// original não mudou. Se algum defeito passar VERDE, a régua mente — e é isto que este script pega.
//   node scripts/_t-pagamento-porta-reintroducao.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(here, '..');
const original = path.join(raiz, 'public', 'assets', 'pagamento-porta.js');
const regua = path.join(here, '_t-pagamento-porta.mjs');
const antes = readFileSync(original);

const defeitos = [
  // ⚠️ Lista revista em 10/09/2026 contra o código do dia. Três trechos tinham sumido e a régua de
  // mutação vinha imprimindo "não existe mais" desde 09/09 sem que ninguém refizesse.
  { nome: 'cancelar o MANTER/CORRIGIR aborta em silêncio (perde o `cancelado`)', de: 'if (cancelou(esc)) return { porRow: {}, manteve: false, cancelado: true };', para: 'if (cancelou(esc)) return { porRow: {}, manteve: false };' },
  { nome: 'pg_valor com VÍRGULA (o servidor faria Number() → NaN)', de: "return isFinite(n) ? n.toFixed(2) : '';", para: "return isFinite(n) ? n.toFixed(2).replace('.', ',') : '';" },
  { nome: 'cofre 0 ainda pergunta', de: 'return !!(cfg && cfg.perguntar === true && item && item.naEntrega);', para: 'return !!(item && item.naEntrega);' },
  { nome: 'exceção no modal VAZA (derruba o Entregue)', de: "try { console.error('[pagamento-porta]', e); await ui.alerta('Não foi possível concluir o pagamento. Confira novamente antes de salvar.', { tom: 'warn' }); } catch (_) {}", para: 'throw e;' },
  { nome: 'valor digitado volta como NAO digitado (fonte falsa de valor)', de: 'return { valor: n, digitado: true };', para: 'return { valor: n, digitado: false };' },
  { nome: 'tudo junto grava o valor de CADA pedido, não a soma', de: 'valor: grupo.soma, digitado: false, grupo: chaveGrupo', para: 'valor: Number(x.valor) || 0, digitado: false, grupo: chaveGrupo' },
  { nome: 'cancelar=false (o ui.js real) vira "Foi diferente"', de: 'function cancelou(v) { return v === null || v === undefined || v === false; }', para: 'function cancelou(v) { return v === null || v === undefined; }' },
];

const tmp = mkdtempSync(path.join(os.tmpdir(), 'pgporta-'));
let mentiu = 0, velhos = 0, harnessQuebrado = null;
const rodarRegua = (copia) => spawnSync(process.execPath, [regua], { env: { ...process.env, PG_PORTA_PATH: copia }, encoding: 'utf8' });

// ⭐ AUTO-PROVA (10/09/2026). Esta régua já esteve MORTA duas vezes pelo mesmo motivo: a régua
// principal carregava o arquivo por caminho FIXO, ignorava PG_PORTA_PATH, e a cópia mutada nunca
// era lida — então TODO defeito plantado "ficava verde". Contar defeitos sem antes provar que o
// mutante é lido é pior que não ter régua: entrega um placar com cara de medição. Agora, quando o
// harness não se prova, ela se declara quebrada em vez de dar nota.
try {
  {
    const copia = path.join(tmp, 'pagamento-porta.js');
    // Defeito de CONTROLE: desliga a trava de 10x, que é o que a régua mais obviamente testa.
    writeFileSync(copia, antes.toString('utf8').replace('var FATOR_TRAVA = 10;', 'var FATOR_TRAVA = 1e9;'));
    const r = rodarRegua(copia);
    const ecoou = (r.stdout || '').split(/\r?\n/).includes('alvo=' + copia);
    if (!ecoou) harnessQuebrado = 'a régua NÃO ecoou "alvo=<cópia>" — ela ignora PG_PORTA_PATH e está testando o ORIGINAL';
    else if (r.status === 0) harnessQuebrado = 'o defeito de CONTROLE (FATOR_TRAVA=1e9) passou verde — a régua não prova nem a trava de 10x';
  }
  if (harnessQuebrado) {
    console.log('⛔ HARNESS QUEBRADO — ' + harnessQuebrado);
    console.log('   Nenhum placar valeria nada, então nem rodo os defeitos. Conserte a régua primeiro.');
  } else {
    console.log('✅ auto-prova: a régua lê o mutante e reprova o defeito de controle');
    for (const d of defeitos) {
      const src = antes.toString('utf8');
      // "trecho não existe mais" = lista VELHA. É falha, mas de natureza diferente de "a régua
      // mente": uma pede refazer a lista, a outra pede cobertura nova. Somar as duas escondia isso.
      if (!src.includes(d.de)) { console.log('🟡 RÉGUA VELHA (refazer o trecho) — ' + d.nome); velhos++; continue; }
      const copia = path.join(tmp, 'pagamento-porta.js');
      writeFileSync(copia, src.replace(d.de, d.para));
      const r = rodarRegua(copia);
      // Vermelho SÓ por reprovação de asserção. Crash não conta: rodar de `scripts/` fazia a régua
      // crashar por caminho relativo, e a mutação lia o crash como "VERMELHO como devia".
      const saida = (r.stdout || '') + (r.stderr || '');
      const reprovou = /AssertionError|ERR_ASSERTION/.test(saida);
      if (r.status !== 0 && !reprovou) { console.log('⛔ a régua QUEBROU (não foi asserção) — ' + d.nome); mentiu++; continue; }
      const vermelho = r.status !== 0 && reprovou;
      console.log((vermelho ? '✅ VERMELHO como devia — ' : '❌ FICOU VERDE (a régua mente) — ') + d.nome);
      if (!vermelho) mentiu++;
    }
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

// O original não pode ter mudado (só a cópia foi tocada).
const cmp = spawnSync('cmp', ['-s', original, original]).status; // sanidade do cmp
const igual = Buffer.compare(antes, readFileSync(original)) === 0;
console.log(igual ? '✅ cmp: original intacto' : '❌ cmp: ORIGINAL MUDOU');
if (cmp !== 0) console.log('(cmp indisponível neste shell — usado Buffer.compare)');
if (harnessQuebrado) console.log('🔴 reintrodução: NÃO MEDIDA — harness quebrado');
else if (mentiu || velhos || !igual) console.log('🔴 reintrodução: ' + mentiu + ' ponto(s) cego(s) + ' + velhos + ' trecho(s) velho(s)');
else console.log('🟢 reintrodução: todos os ' + defeitos.length + ' defeitos ficaram vermelhos');
process.exitCode = (harnessQuebrado || mentiu || velhos || !igual) ? 1 : 0;
