// Proxy Vercel -> painel /api/entregador-app/ping (rastreamento GPS). Recebe o LOTE de pontos do
// app e repassa pro painel, INJETANDO o segredo (x-app-secret) do env — server-side, fora do cliente.
// Mesmo motivo do api/painel.js: o navegador fala HTTPS com este proxy e o Vercel repassa
// server-to-server, injetando o segredo fora do alcance do cliente.
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

// Domínio público HTTPS, nunca o IP:8080 (fechado pra internet em 08/08/2026). Ver api/painel.js.
const PAINEL = process.env.PAINEL_URL || 'https://srv1755272.hstgr.cloud';
const SECRET = process.env.RASTREIO_PING_SECRET || '';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'use POST' }); return; }
  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(String(req.body || '{}'));
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (SECRET) headers['x-app-secret'] = SECRET; // sem env setado = manda sem segredo (painel decide)
    const r = await fetch(`${PAINEL}/api/entregador-app/ping`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(text);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'proxy ping: ' + err.message });
  }
}
