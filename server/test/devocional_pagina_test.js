const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const web = (nome) => fs.readFileSync(require('node:path').join(__dirname, '../web', nome), 'utf8');

test('página pública tem identidade do site e consentimento específico para as trilhas escolhidas', () => {
  const html = web('devocional.html');
  assert.match(html, /estilo\.css/);
  for (const id of ['devocional-conteudo', 'assinatura', 'email', 'assinatura-trilhas', 'autorizo', 'website', 'token-acao']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /das trilhas selecionadas/);
  assert.doesNotMatch(html, /tema-casais|tema-familia/, 'as trilhas vêm da administração, não ficam fixas na página');
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
  assert.equal(chamadas.length, 0, 'com token no endereço, nada é buscado antes do clique');
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

function pagina({ hash = '', search = '', responder = () => ({}) } = {}) {
  const nos = new Map(), chamadas = [];
  function novo() { return { children: [], value: '', checked: false, addEventListener(n, f) { this[n] = f; }, replaceChildren(...filhos) { this.children = filhos; }, append(...filhos) { this.children.push(...filhos); } }; }
  const no = (id) => { if (!nos.has(id)) nos.set(id, novo()); return nos.get(id); };
  const contexto = vm.createContext({ URLSearchParams, console,
    location: { hash, search, pathname: '/devocional', origin: 'https://igreja.test' }, history: { replaceState() {} },
    document: { getElementById: no, createElement: novo },
    fetch: async (url, opcoes) => { chamadas.push({ url, opcoes }); return { ok: true, json: async () => responder(url) }; },
  });
  vm.runInContext(web('devocional.js'), contexto);
  return { no, chamadas };
}
// Aguarda as continuações do fetch e json, sem temporizadores nem rede real.
const espera = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const TRILHAS = [{ id: 'casais', nome: 'Casais' }, { id: 'jovens', nome: 'Jovens', descricao: 'Juventude' }];
const responder = (url) => url === '/api/public/devocionais/trilhas' ? TRILHAS
  : url === '/api/public/devocionais' || url.startsWith('/api/public/devocionais?') ? { destaque: null, devocionais: [] } : { ok: true };

test('assinatura usa as trilhas da administração, exige escolha e consentimento, honeypot sem sessão', async () => {
  const a = pagina({ responder });
  await espera();
  assert.ok(a.chamadas.some((c) => c.url === '/api/public/devocionais/trilhas'));
  assert.equal(a.no('assinatura-trilhas').children.length, 2);
  const antes = a.chamadas.length;
  const evento = { preventDefault() {} };
  await a.no('assinatura-form').submit(evento);
  assert.equal(a.chamadas.length, antes, 'sem trilha nem autorização, não envia');
  a.no('trilha-casais').checked = true;
  a.no('trilha-jovens').checked = true;
  a.no('autorizo').checked = true;
  a.no('email').value = ' familia@example.com ';
  await a.no('assinatura-form').submit(evento);
  const envio = a.chamadas.find((c) => c.url === '/api/public/devocionais/assinar');
  assert.deepEqual(JSON.parse(envio.opcoes.body), { email: 'familia@example.com', temas: ['casais', 'jovens'], autorizo: true, website: '' });
  assert.equal(envio.opcoes.credentials, 'omit');
});

test('sem ?id carrega a lista uma vez, depois das trilhas; ?trilha= já filtra', async () => {
  const a = pagina({ search: '?trilha=jovens', responder });
  await espera();
  const lista = a.chamadas.filter((c) => c.url.startsWith('/api/public/devocionais?') || c.url === '/api/public/devocionais');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].url, '/api/public/devocionais?trilha=jovens');
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

test('leitura trata marcação hostil como texto, só busca endpoint público e não carrega a lista', async () => {
  const a = pagina({ search: '?id=publico', responder: (url) => url === '/api/public/devocionais/trilhas' ? TRILHAS
    : { id: 'publico', titulo: '<img src=x onerror=x>', autorNome: 'Autor', texto: '# Título\n\n<script>ruim()</script>', aplicacao: 'Aplicar', oracao: 'Orar',
      serie: 'Frutos', serieParte: 2, serieItens: [{ id: 'um', titulo: 'Dia 1' }, { id: 'publico', titulo: 'Dia 2' }] } });
  await espera();
  assert.equal(a.chamadas[0].url, '/api/public/devocionais/publico');
  assert.ok(!a.chamadas.some((c) => c.url.startsWith('/api/public/devocionais?')), 'com ?id não carrega a lista');
  const artigo = a.no('devocional-conteudo').children.find((n) => n.className === 'devocional-leitura');
  assert.equal(artigo.children[0].textContent, '<img src=x onerror=x>');
  assert.ok(artigo.children.some((n) => n.textContent === '<script>ruim()</script>'));
  assert.ok(artigo.children.some((n) => n.className === 'dev-serie'), 'mostra as outras partes da série');
});
