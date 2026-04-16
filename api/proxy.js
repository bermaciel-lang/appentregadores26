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

    // Passo 1: capturar o redirect do Apps Script
    const probe = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: bodyStr,
      redirect: 'manual'
    });

    const redirectUrl = probe.headers.get('location');
    const status1 = probe.status;

    let text = '';

    if (redirectUrl) {
      // Passo 2: POST direto na URL real
      const response = await fetch(redirectUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: bodyStr
      });
      text = await response.text();
    } else {
      text = await probe.text();
    }

    // Log de diagnóstico — retorna junto com a resposta para você ver
    const debug = {
      bodyKeys: Object.keys(body),
      bodyLength: bodyStr.length,
      fotoBase64Length: body.fotoBase64 ? body.fotoBase64.length : 0,
      probeStatus: status1,
      redirectUrl: redirectUrl || 'nenhum',
      appScriptResponse: text.substring(0, 200)
    };

    console.log('DEBUG PROXY:', JSON.stringify(debug));

    res.setHeader('Content-Type', 'application/json');
    try {
      const parsed = JSON.parse(text);
      res.json({ ...parsed, _debug: debug });
    } catch(e) {
      res.json({ ok: false, error: 'Resposta inválida do servidor', _debug: debug });
    }

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Erro no proxy' });
  }
}