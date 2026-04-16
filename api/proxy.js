import { Readable } from 'node:stream';
import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  
  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/drive.file']
  );
  return google.drive({ version: 'v3', auth });
}

async function uploadToDrive(base64, mimeType, fileName) {
  const buffer = Buffer.from(base64, 'base64');
  const drive = getDriveClient();

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: ['1MXtWemkBf_g03nx8HeZHt1FamRfq9Xda'],
    },
    media: {
      mimeType: mimeType || 'image/jpeg',
      body: Readable.from(buffer),
    },
    fields: 'id,webViewLink',
  });

  // Torna o arquivo público para poder salvar o link na planilha
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return res.data.webViewLink;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbytI4amCTInP7RB0nJb0PIOHt85YK3_L_7ZTJsv4IpnCZKNvbRYAVFzd2HXGevki5ls/exec';

  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(String(req.body || '{}'));

    // Faz o upload da foto direto no Drive (se tiver foto)
    let fotoUrl = '';
    if (body.fotoBase64) {
      const agora = new Date().toISOString().replace(/[:.]/g, '-');
      const nome = agora + '_' + (body.entregador || 'entregador').replace(/\s+/g, '_') + '_' + (body.action || 'foto') + '.jpg';
      fotoUrl = await uploadToDrive(body.fotoBase64, body.fotoMimeType || 'image/jpeg', nome);
    }

    // Manda para o Apps Script sem a foto (já foi salva), só com a URL
    const params = new URLSearchParams();
    params.set('action', body.action || '');
    params.set('entregador', body.entregador || '');
    if (body.kmInicial) params.set('kmInicial', body.kmInicial);
    if (body.kmFinal) params.set('kmFinal', body.kmFinal);
    if (fotoUrl) params.set('fotoUrl', fotoUrl);

    const url = SCRIPT_URL + '?' + params.toString();
    const response = await fetch(url, { redirect: 'follow' });
    const text = await response.text();

    const clean = text.replace(/^[a-zA-Z0-9_]+\(/, '').replace(/\)$/, '').trim();
    res.json(JSON.parse(clean));

  } catch (err) {
    console.error('Erro:', err.message);
    res.status(500).json({ ok: false, error: err.message || 'Erro no proxy' });
  }
}