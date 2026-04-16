export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbytI4amCTInP7RB0nJb0PIOHt85YK3_L_7ZTJsv4IpnCZKNvbRYAVFzd2HXGevki5ls/exec';

  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // Passo 1: POST com redirect manual para capturar a URL real
    const probe = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'manual'
    });

    const redirectUrl = probe.headers.get('location');

    if (!redirectUrl) {
      // Não houve redirect, resposta direta
      const text = await probe.text();
      res.setHeader('Content-Type', 'application/json');
      res.send(text);
      return;
    }

    // Passo 2: POST direto na URL real (sem passar pelo redirect)
    const response = await fetch(redirectUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body
    });

    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.send(text);

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Erro no proxy' });
  }
}