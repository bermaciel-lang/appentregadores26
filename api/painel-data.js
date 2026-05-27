// api/painel-data.js
// Proxy para buscar dados do Apps Script para o painel

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
};

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbytI4amCTInP7RB0nJb0PIOHt85YK3_L_7ZTJsv4IpnCZKNvbRYAVFzd2HXGevki5ls/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const url = `${SCRIPT_URL}?action=dashboardGeral`;
    const response = await fetch(url, { redirect: 'follow' });
    const text = await response.text();
    const clean = text.replace(/^[a-zA-Z0-9_]+\(/, '').replace(/\)$/, '').trim();
    res.json(JSON.parse(clean));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
