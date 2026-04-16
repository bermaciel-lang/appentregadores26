export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbytI4amCTInP7RB0nJb0PIOHt85YK3_L_7ZTJsv4IpnCZKNvbRYAVFzd2HXGevki5ls/exec';

  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(String(req.body || '{}'));

    const params = new URLSearchParams();
    params.set('action', body.action || '');
    params.set('entregador', body.entregador || '');
    if (body.kmInicial) params.set('kmInicial', body.kmInicial);
    if (body.kmFinal) params.set('kmFinal', body.kmFinal);
    if (body.fotoBase64) params.set('fotoBase64', body.fotoBase64);
    if (body.fotoMimeType) params.set('fotoMimeType', body.fotoMimeType);

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