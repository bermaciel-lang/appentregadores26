export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbytI4amCTInP7RB0nJb0PIOHt85YK3_L_7ZTJsv4IpnCZKNvbRYAVFzd2HXGevki5ls/exec';

  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(String(req.body || '{}'));
    const bodyStr = JSON.stringify(body);

    // Passo 1: POST para o Apps Script — ele processa e redireciona
    const probe = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: bodyStr,
      redirect: 'manual'
    });

    const location = probe.headers.get('location');

    if (!location) {
      const text = await probe.text();
      res.json(JSON.parse(text));
      return;
    }

    // Passo 2: GET na URL do redirect — aqui está a resposta processada
    const final = await fetch(location, { method: 'GET' });
    const text = await final.text();
    console.log('Resposta:', text.substring(0, 200));

    const clean = text.replace(/^[a-zA-Z0-9_]+\(/, '').replace(/\)$/, '').trim();
    res.json(JSON.parse(clean));

  } catch (err) {
    console.error('Erro:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}