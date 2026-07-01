// Adiciona as permissões de LOCALIZAÇÃO + serviço em 1º plano no AndroidManifest gerado pelo
// `cap add android` (necessárias pro rastreamento em segundo plano). Idempotente.
import fs from 'node:fs';
const P = 'android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(P, 'utf8');
const PERMS = [
  'ACCESS_COARSE_LOCATION',
  'ACCESS_FINE_LOCATION',
  'ACCESS_BACKGROUND_LOCATION',
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_LOCATION',
  'WAKE_LOCK',
];
const faltando = PERMS.filter((p) => !m.includes(`android.permission.${p}`));
if (!faltando.length) { console.log('Permissões já presentes.'); process.exit(0); }
const linhas = faltando.map((p) => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
m = m.replace('</manifest>', `${linhas}\n</manifest>`);
fs.writeFileSync(P, m, 'utf8');
console.log('Permissões adicionadas:', faltando.join(', '));
