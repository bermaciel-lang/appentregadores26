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
  { nome: 'fechar o modal ABORTA (devolve null em vez de naoSei)', de: 'if (cancelou(escolha)) return naoSei;', para: 'if (cancelou(escolha)) return null;' },
  { nome: 'pg_valor com VÍRGULA (o servidor faria Number() → NaN)', de: "return isFinite(n) ? n.toFixed(2) : '';", para: "return isFinite(n) ? n.toFixed(2).replace('.', ',') : '';" },
  { nome: 'cofre 0 ainda pergunta', de: 'return !!(cfg && cfg.perguntar === true && item && item.naEntrega);', para: 'return !!(item && item.naEntrega);' },
  { nome: 'exceção no modal VAZA (derruba o Entregue)', de: "try { console.error('[pagamento-porta]', e); } catch (e2) {}", para: 'throw e;' },
  { nome: '"digitou igual" conta como digitado (fonte falsa de valor)', de: 'return { valor: n, digitado: Math.abs(n - pre) > 0.004 };', para: 'return { valor: n, digitado: true };' },
  { nome: 'tudo junto grava o valor de CADA pedido, não a soma', de: 'valor: grupo.soma, digitado: false, grupo: chaveGrupo', para: 'valor: Number(y.valor) || 0, digitado: false, grupo: chaveGrupo' },
  { nome: 'cancelar=false (o ui.js real) vira "Foi diferente"', de: 'function cancelou(v) { return v === null || v === undefined || v === false; }', para: 'function cancelou(v) { return v === null || v === undefined; }' },
];

const tmp = mkdtempSync(path.join(os.tmpdir(), 'pgporta-'));
let mentiu = 0;
try {
  for (const d of defeitos) {
    const src = antes.toString('utf8');
    if (!src.includes(d.de)) { console.log('❌ o trecho a plantar não existe mais: ' + d.nome); mentiu++; continue; }
    const copia = path.join(tmp, 'pagamento-porta.js');
    writeFileSync(copia, src.replace(d.de, d.para));
    const r = spawnSync(process.execPath, [regua], { env: { ...process.env, PG_PORTA_PATH: copia }, encoding: 'utf8' });
    // Vermelho = saiu com erro (placar vermelho OU crash). Verde só com exit 0 e placar verde.
    const vermelho = r.status !== 0 && !/🟢 VERDE/.test(r.stdout);
    console.log((vermelho ? '✅ VERMELHO como devia — ' : '❌ FICOU VERDE (a régua mente) — ') + d.nome);
    if (!vermelho) mentiu++;
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

// O original não pode ter mudado (só a cópia foi tocada).
const cmp = spawnSync('cmp', ['-s', original, original]).status; // sanidade do cmp
const igual = Buffer.compare(antes, readFileSync(original)) === 0;
console.log(igual ? '✅ cmp: original intacto' : '❌ cmp: ORIGINAL MUDOU');
if (cmp !== 0) console.log('(cmp indisponível neste shell — usado Buffer.compare)');
console.log(mentiu || !igual ? '🔴 reintrodução: ' + mentiu + ' defeito(s) passaram' : '🟢 reintrodução: todos os ' + defeitos.length + ' defeitos ficaram vermelhos');
process.exitCode = mentiu || !igual ? 1 : 0;
