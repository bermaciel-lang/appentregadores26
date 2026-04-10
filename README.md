# App de Entregas - pronto para GitHub e Vercel

Este projeto foi montado para ficar o mais simples possível de publicar e manter.

## O que já está pronto

- tela inicial para escolher o entregador
- tela do entregador
- painel admin
- cache local para abrir mais rápido e não ficar em branco quando a API falhar
- tentativas automáticas de repetir requisição
- suporte a API em `jsonp` ou `json`
- layout leve em HTML, CSS e JavaScript puro

## Estrutura

- `public/index.html` -> seleção do entregador
- `public/entregas/index.html` -> tela do entregador
- `public/admin/index.html` -> painel admin
- `public/assets/config.js` -> configurações que você vai trocar
- `public/assets/core.js` -> API, cache, storage e funções centrais
- `public/assets/page-home.js` -> lógica da tela inicial
- `public/assets/page-entregas.js` -> lógica da tela do entregador
- `public/assets/page-admin.js` -> lógica do admin
- `public/assets/styles.css` -> visual do app
- `vercel.json` -> configuração da Vercel

## O que você precisa editar antes de subir

Abra o arquivo `public/assets/config.js` e altere:

### 1) URL da API

Troque:

```js
API_URL: 'COLE_AQUI_SUA_URL_DO_GOOGLE_APPS_SCRIPT'
```

pela sua URL real do Apps Script.

### 2) Modo da API

Se seu Apps Script ainda usa callback JSONP, deixe assim:

```js
API_MODE: 'jsonp'
```

Se depois você ajustar seu backend para responder JSON com CORS liberado, troque para:

```js
API_MODE: 'json'
```

### 3) Senha simples do admin

Troque:

```js
ADMIN_PASSWORD: '1234'
```

pela senha que você quiser.

## Como subir no GitHub

### Opção simples

1. Crie um repositório novo no GitHub.
2. Envie todos os arquivos desta pasta para esse repositório.

### Opção terminal

Dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "primeira versao"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

## Como publicar na Vercel

1. Entre na Vercel.
2. Clique em `Add New Project`.
3. Importe o repositório do GitHub.
4. Clique em `Deploy`.

A Vercel vai publicar como site estático.

## Como abrir localmente no computador

```bash
npm install
npm run dev
```

Depois abra:

```text
http://localhost:3000
```

## Por que esta versão é mais estável

1. O app tenta repetir chamadas da API automaticamente.
2. O app guarda o último resultado localmente no aparelho.
3. Se a API falhar, ele tenta mostrar o último cache em vez de deixar a tela vazia.
4. O refresh automático só roda quando a tela está visível.
5. O GPS é pausado quando a aba fica em segundo plano.

## Próximo passo ideal

Quando esta versão estiver funcionando redonda, o melhor upgrade é trocar o Google Apps Script por um backend mais sólido.
