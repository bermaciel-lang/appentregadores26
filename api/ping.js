// Proxy Vercel -> painel /api/entregador-app/ping (rastreamento GPS). Recebe o LOTE de pontos do
// app e repassa pro painel, INJETANDO o segredo (x-app-secret) do env — server-side, fora do cliente.
// Mesmo motivo do api/painel.js: o app é HTTPS e o painel é HTTP por IP (mixed content), então o
// navegador fala HTTPS com este proxy e o Vercel repassa server-to-server.
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const PAINEL = process.env.PAINEL_URL || 'http://76.13.166.58:8080';
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
