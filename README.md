# App de Entregas (entregadores) — Orgânico do Chico

Site estático (HTML/JS puro em `public/`) publicado na Vercel; o APK Android (Capacitor) carrega o mesmo site.
O app fala com o painel pelo proxy same-origin `/api/painel/` (`api/painel.js`) e manda o GPS por `/api/ping` (`api/ping.js`).

## Estrutura

- `public/index.html` -> seleção do entregador (reabre direto na rota em andamento)
- `public/entregas/index.html` -> tela do entregador
- `public/assets/config.js` -> configurações (API = `/api/painel/`)
- `public/assets/fila-duravel.js` -> fila do aparelho (IndexedDB): o toque grava aqui antes de qualquer rede
- `public/assets/core.js` -> API, fila, cache, KM/foto da rota
- `public/assets/page-home.js` -> lógica da tela inicial
- `public/assets/page-entregas.js` -> lógica da tela do entregador
- `public/assets/styles.css` -> visual do app
- `vercel.json` -> configuração da Vercel (cache por revalidação, função em São Paulo)
- `docs/FILA-RECEBIMENTO-TRANSACIONAL.md` -> as garantias da fila (o que não pode quebrar)

28/10/2026: saíram o fluxo antigo da planilha (Apps Script, JSONP, `?planilha=1`), a página `/admin` (com a senha
local) e a página `/painel` — a administração de verdade é a do painel. O `.apk` de `public/download/` continua.

## Testes

```bash
npm test               # réguas com o código real numa VM (fila, toque, pagamento, leva 2)
npm run test:navegador # réguas de tela no Edge sem janela (Playwright), sem rede
npm run medir:lapides  # medidor do custo das lápides da fila (antes × depois da faxina)
```

As réguas de fila usam `fake-indexeddb` (ver `docs/FILA-RECEBIMENTO-TRANSACIONAL.md`, "Verificação local").

## Como abrir localmente no computador

```bash
npm install
npm run dev
```

Depois abra `http://localhost:3000` (sem o proxy da Vercel, a API não responde: a tela abre, as chamadas falham).
