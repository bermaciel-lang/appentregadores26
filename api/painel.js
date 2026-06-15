// Proxy do Vercel -> PAINEL (Etapa C). O painel hoje roda em HTTP por IP; o app é HTTPS,
// e o navegador bloqueia HTTP a partir de HTTPS (mixed content). Então o navegador fala
// HTTPS com este proxy (mesma origem) e o Vercel repassa pro painel server-to-server (HTTP
// servidor->servidor é permitido). Encaminha GET e POST pra /api/entregador-app, repassando
// a query (action, entregador, row, ...) e o corpo JSON, e devolve o JSON de volta.
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// Base do painel. Fixo (IP de infra, não é segredo); pode sobrescrever por env na Vercel.
const PAINEL = process.env.PAINEL_URL || 'http://76.13.166.58:8080';

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
