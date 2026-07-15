// Adiciona as permissões de LOCALIZAÇÃO + serviço em 1º plano no AndroidManifest gerado pelo
// `cap add android` (necessárias pro rastreamento em segundo plano). Idempotente.
import fs from 'node:fs';

// ---- FCM / Firebase (push com o app fechado): copia o google-services.json e liga o plugin do
// Google no Gradle. Roda ANTES do resto (não depende do manifesto). Sem o arquivo, apenas pula. ----
try {
  if (fs.existsSync('google-services.json')) {
    fs.copyFileSync('google-services.json', 'android/app/google-services.json');
    let pg = fs.readFileSync('android/build.gradle', 'utf8');
    if (!pg.includes('com.google.gms:google-services')) {
      pg = pg.replace(/(classpath ['"]com\.android\.tools\.build:gradle[^\n]*\n)/, `$1        classpath 'com.google.gms:google-services:4.4.2'\n`);
      fs.writeFileSync('android/build.gradle', pg, 'utf8');
    }
    let ag = fs.readFileSync('android/app/build.gradle', 'utf8');
    if (!ag.includes('com.google.gms.google-services')) {
      ag += `\napply plugin: 'com.google.gms.google-services'\n`;
      fs.writeFileSync('android/app/build.gradle', ag, 'utf8');
    }
    console.log('FCM/Firebase ligado (google-services.json + gradle).');
  } else {
    console.log('google-services.json ausente — FCM não configurado.');
  }
} catch (e) { console.log('FCM patch falhou:', e.message); }

const P = 'android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(P, 'utf8');
const PERMS = [
  'ACCESS_COARSE_LOCATION',
  'ACCESS_FINE_LOCATION',
  'ACCESS_BACKGROUND_LOCATION',
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_LOCATION',
  'WAKE_LOCK',
  'POST_NOTIFICATIONS', // notificações no Android 13+ (chat/avisos no app)
  'RECORD_AUDIO',       // gravar áudio no chat (segurar o 🎤 pra mandar recado de voz)
  'MODIFY_AUDIO_SETTINGS', // acompanha o RECORD_AUDIO (ajuste de captura)
];
const faltando = PERMS.filter((p) => !m.includes(`android.permission.${p}`));
if (!faltando.length) { console.log('Permissões já presentes.'); process.exit(0); }
const linhas = faltando.map((p) => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
m = m.replace('</manifest>', `${linhas}\n</manifest>`);
fs.writeFileSync(P, m, 'utf8');
console.log('Permissões adicionadas:', faltando.join(', '));
