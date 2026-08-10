// Proxy do Vercel -> PAINEL (Etapa C). O app fala HTTPS com este proxy (mesma origem) e o
// Vercel repassa pro painel server-to-server. Encaminha GET e POST pra /api/entregador-app,
// repassando a query (action, entregador, row, ...) e o corpo JSON, e devolve o JSON de volta.
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// Base do painel: DOMÍNIO PÚBLICO HTTPS (Caddy/Let's Encrypt), nunca o IP:8080.
// A 8080 foi fechada pra internet em 08/08/2026 (passou a escutar só em 127.0.0.1) e derrubou
// este app por 2 dias — o proxy batia num IP que não responde mais. Pode sobrescrever por env.
const PAINEL = process.env.PAINEL_URL || 'https://srv1755272.hstgr.cloud';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const alvo = `${PAINEL}/api/entregador-app${qs}`;
    const init = { method: req.method, headers: { 'Accept': 'application/json' } };
    if (req.method === 'POST') {
      const body = typeof req.body === 'object' ? req.body : JSON.parse(String(req.body || '{}'));
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body || {});
    }
    const r = await fetch(alvo, init);
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(text);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'proxy painel: ' + err.message });
  }
}
