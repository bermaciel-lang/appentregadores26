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
    const bodyStr = JSON.stringify(body);

    // Passo 1: POST para o Apps Script — ele processa e redireciona
    const probe = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: bodyStr,
      redirect: 'manual'
    });

    const redirectUrl = probe.headers.get('location');

    if (!redirectUrl) {
      // Sem redirect — resposta direta
      const text = await probe.text();
      res.setHeader('Content-Type', 'application/json');
      res.send(text);
      return;
    }

    // Passo 2: GET na URL do redirect — aqui está a resposta processada
    const response = await fetch(redirectUrl, { method: 'GET' });
    const text = await response.text();

    res.setHeader('Content-Type', 'application/json');
    try {
      res.json(JSON.parse(text));
    } catch (e) {
      res.json({ ok: false, error: 'Resposta inválida', raw: text.substring(0, 300) });
    }

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Erro no proxy' });
  }
}