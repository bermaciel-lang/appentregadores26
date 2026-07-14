// Injeta a ASSINATURA DE RELEASE + versão no `android/app/build.gradle` gerado pelo `cap add android`
// (o Android é gerado na hora no CI, não fica no repo — por isso a gente "remenda" o gradle aqui, igual
// ao android-manifest-patch.mjs). A senha/keystore vêm de variáveis de ambiente (secrets do GitHub),
// então nada sensível fica no código. Idempotente.
//
// Env esperadas (setadas pelo workflow build-aab.yml):
//   ODC_KEYSTORE_FILE      caminho do .keystore relativo a android/app (ex.: release.keystore)
//   ODC_KEYSTORE_PASSWORD  senha do keystore
//   ODC_KEY_ALIAS          alias da chave (padrão: upload)
//   ODC_KEY_PASSWORD       senha da chave
//   VERSION_CODE           número inteiro que sobe a cada envio (ex.: nº da execução do CI)
//   VERSION_NAME           versão visível (ex.: 1.0.5)
import fs from 'node:fs';

const P = 'android/app/build.gradle';
let g = fs.readFileSync(P, 'utf8');

const versionCode = process.env.VERSION_CODE || '1';
const versionName = process.env.VERSION_NAME || '1.0.0';
const alias = process.env.ODC_KEY_ALIAS || 'upload';

// 1) Bloco de assinatura de release (lê tudo do ambiente na hora do build).
if (!g.includes('signingConfigs')) {
  const bloco = `
    signingConfigs {
        release {
            storeFile file(System.getenv("ODC_KEYSTORE_FILE") ?: "release.keystore")
            storePassword System.getenv("ODC_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ODC_KEY_ALIAS") ?: "${alias}"
            keyPassword System.getenv("ODC_KEY_PASSWORD")
        }
    }
    // Não deixar a verificação de qualidade (lint) derrubar o build do .aab.
    lint {
        checkReleaseBuilds false
        abortOnError false
    }
`;
  // Insere logo depois do primeiro "android {".
  g = g.replace(/android\s*\{/, (m) => m + bloco);
  console.log('signingConfigs.release adicionado.');
} else {
  console.log('signingConfigs já presente — pulando.');
}

// 2) Liga a assinatura no buildType release (o release é o que tem minifyEnabled).
if (!g.includes('signingConfig signingConfigs.release')) {
  g = g.replace(/(release\s*\{\s*\n)(\s*)(minifyEnabled)/, `$1$2signingConfig signingConfigs.release\n$2$3`);
  console.log('signingConfig ligado no release.');
}

// 3) versionCode / versionName (Play exige versionCode inteiro e crescente a cada envio).
g = g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
g = g.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
console.log(`versão: code=${versionCode} name=${versionName}`);

fs.writeFileSync(P, g, 'utf8');
console.log('build.gradle assinado/versão OK.');
