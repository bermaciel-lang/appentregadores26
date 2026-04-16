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

    // Monta URL com todos os parâmetros (o servidor não tem limite de URL como o browser)
    const params = new URLSearchParams();
    Object.entries(body).forEach(([k, v]) => params.set(k, String(v)));
    const url = SCRIPT_URL + '?' + params.toString();

    const response = await fetch(url, { redirect: 'follow' });
    const text = await response.text();

    res.setHeader('Content-Type', 'application/json');

    // Remove callback JSONP se vier
    const clean = text.replace(/^[a-zA-Z0-9_]+\(/, '').replace(/\)$/, '').trim();

    try {
      res.json(JSON.parse(clean));
    } catch (e) {
      res.json({ ok: false, error: 'Resposta inválida do servidor', raw: text.substring(0, 200) });
    }

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Erro no proxy' });
  }
}