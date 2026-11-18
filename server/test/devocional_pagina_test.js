const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const web = (nome) => fs.readFileSync(require('node:path').join(__dirname, '../web', nome), 'utf8');

test('página pública tem identidade do site e consentimento específico para ambos os temas', () => {
  const html = web('devocional.html');
  assert.match(html, /estilo\.css/);
  for (const id of ['devocional-conteudo', 'assinatura', 'email', 'tema-casais', 'tema-familia', 'autorizo', 'website', 'token-acao']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /devocional\.js/);
});

test('token sai do endereço sem POST automático; confirmação exige gesto humano', async () => {
  const nos = new Map();
  const no = (id) => { if (!nos.has(id)) nos.set(id, { hidden: false, value: '', checked: false, addEventListener(n, f) { this[n] = f; }, replaceChildren() {}, append() {} }); return nos.get(id); };
  const chamadas = [];
  const trocas = [];
  const contexto = vm.createContext({ URLSearchParams, console,
    location: { hash: '#confirmar=SEGREDO', search: '', pathname: '/devocional' },
    history: { replaceState: (...args) => trocas.push(args) },
    document: { getElementById: no, createElement: () => ({ append() {} }) },
    fetch: async (...args) => { chamadas.push(args); return { ok: true, json: async () => ({ ok: true }) }; },
  });
  vm.runInContext(web('devocional.js'), contexto);
  assert.equal(chamadas.length, 0);
  assert.equal(trocas[0][2], '/devocional');
  await no('token-acao').click();
  assert.equal(chamadas[0][0], '/api/public/devocionais/confirmar');
  assert.deepEqual(JSON.parse(chamadas[0][1].body), { token: 'SEGREDO' });
});

test('conteúdo público não injeta HTML e não usa sessão nem listas privadas', () => {
  const js = web('devocional.js');
  assert.doesNotMatch(js, /innerHTML|localStorage|\/api\/membros|destinatarios/);
  assert.match(js, /textContent/);
  assert.match(js, /\/api\/public\/devocionais\/assinar/);
});

function pagina({ hash = '', search = '', resposta = {} } = {}) {
  const nos = new Map(), chamadas = [];
  function novo() { return { children: [], value: '', checked: false, addEventListener(n, f) { this[n] = f; }, replaceChildren(...filhos) { this.children = filhos; }, append(...filhos) { this.children.push(...filhos); } }; }
  const no = (id) => { if (!nos.has(id)) nos.set(id, novo()); return nos.get(id); };
  const contexto = vm.createContext({ URLSearchParams, console,
    location: { hash, search, pathname: '/devocional' }, history: { replaceState() {} },
    document: { getElementById: no, createElement: novo },
    fetch: async (url, opcoes) => { chamadas.push({ url, opcoes }); return { ok: true, json: async () => resposta }; },
  });
  vm.runInContext(web('devocional.js'), contexto);
  return { no, chamadas };
}

test('assinatura valida tema e consentimento, envia ambos os temas e honeypot sem sessão', async () => {
  const a = pagina();
  const evento = { preventDefault() {} };
  await a.no('assinatura-form').submit(evento);
  assert.equal(a.chamadas.length, 0);
  a.no('tema-casais').checked = true;
  a.no('tema-familia').checked = true;
  a.no('autorizo').checked = true;
  a.no('email').value = ' familia@example.com ';
  await a.no('assinatura-form').submit(evento);
  assert.equal(a.chamadas[0].url, '/api/public/devocionais/assinar');
  assert.deepEqual(JSON.parse(a.chamadas[0].opcoes.body), { email: 'familia@example.com', temas: ['casais', 'familia'], autorizo: true, website: '' });
  assert.equal(a.chamadas[0].opcoes.credentials, 'omit');
});

test('cancelamento também depende de clique e nunca aciona GET com segredo', async () => {
  const a = pagina({ hash: '#cancelar=TOKEN-CANCELAR' });
  assert.equal(a.chamadas.length, 0);
  await a.no('token-acao').click();
  assert.equal(a.chamadas[0].url, '/api/public/devocionais/cancelar');
  assert.equal(a.chamadas[0].opcoes.method, 'POST');
  assert.equal(a.no('token-acao').hidden, true);
  await a.no('token-acao').click();
  assert.equal(a.chamadas.length, 1);
});

test('leitura trata marcação hostil como texto e só busca endpoint público', async () => {
  const a = pagina({ search: '?id=publico', resposta: { titulo: '<img src=x onerror=x>', autorNome: 'Autor', texto: '# Título\n\n<script>ruim()</script>', aplicacao: 'Aplicar', oracao: 'Orar' } });
  // Aguarda as continuações do fetch e json, sem temporizadores nem rede real.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(a.chamadas[0].url, '/api/public/devocionais/publico');
  const artigo = a.no('devocional-conteudo').children[0];
  assert.equal(artigo.children[0].textContent, '<img src=x onerror=x>');
  assert.ok(artigo.children.some((n) => n.textContent === '<script>ruim()</script>'));
});
