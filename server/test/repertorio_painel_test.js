const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = (nome) => fs.readFileSync(path.join(__dirname, '../web', nome), 'utf8');

/** DOM mínimo: o bastante para montar a tela e clicar, sem navegador. */
function ambiente({ gestao = true, musicas = [], uso = {}, responder } = {}) {
  class No {
    constructor(tag, props = {}, filhos = []) {
      this.tag = tag; this.props = { ...props }; this.children = []; this.events = {}; this.value = ''; this.checked = false;
      this.className = props.class || ''; this.dataset = {}; this.style = {};
      for (const [k, v] of Object.entries(props)) if (k.startsWith('data-')) this.dataset[k.slice(5)] = v;
      this.classList = { add: (c) => { this.className = (this.className + ' ' + c).trim(); }, remove: (c) => { this.className = this.className.split(' ').filter((x) => x !== c).join(' '); } };
      this.append(...filhos);
    }
    append(...filhos) { for (const f of filhos.flat()) if (f != null && f !== false) this.children.push(typeof f === 'object' ? f : String(f)); }
    replaceChildren(...filhos) { this.children = []; this.append(...filhos); }
    addEventListener(nome, fn) { this.events[nome] = fn; }
    setAttribute(k, v) { this.props[k] = v; }
    contains(n) { return todos(this).includes(n); }
    focus() { contexto.document.activeElement = this; }
    closest() { return null; }
    querySelector() { return formImportar; }
    showModal() {}
    close() {}
    get textContent() { return todos(this).flatMap((n) => n._texto != null ? [n._texto] : n.children.filter((c) => typeof c === 'string')).join(''); }
    set textContent(t) { this._texto = t; this.children = []; }
  }
  const nos = {}, chamadas = [];
  const banco = new Map(musicas.map((m) => [m.id, JSON.parse(JSON.stringify(m))])); // o que o servidor guardou
  const formImportar = new No('form');
  const $ = (id) => nos[id] || (nos[id] = new No('div', { id }));
  const el = (tag, props = {}, ...filhos) => {
    const n = new No(tag, props, filhos);
    if (props.id) nos[props.id] = n;
    for (const [k, v] of Object.entries(props)) if (k.startsWith('on') && typeof v === 'function') n.events[k.slice(2)] = v;
    if ('value' in props) n.value = props.value;
    return n;
  };
  class Option extends No { constructor(texto, valor) { super('option', { value: valor }, [texto]); this.value = valor; } }
  const contexto = vm.createContext({
    console, URL, setTimeout: () => 0, CSS: { escape: (s) => s }, Option,
    document: { activeElement: null, querySelectorAll: () => [] },
    $, el, botao: (texto, fn, classe) => el('button', { class: 'botao ' + (classe || 'secundario pequeno'), onclick: fn }, texto),
    mensagem: (alvo, texto, ok = true) => { alvo.textContent = texto; alvo.ok = ok; },
    pode: (p) => gestao && p === 'escalaLouvor', carregar: {}, lerArquivoCsv: async () => '',
    api: async (metodo, url, corpo) => {
      chamadas.push({ metodo, url, corpo: corpo && JSON.parse(JSON.stringify(corpo)) });
      if (responder) { const r = await responder(metodo, url, corpo); if (r !== undefined) return r; }
      if (url === '/api/repertorio') return metodo === 'GET' ? JSON.parse(JSON.stringify(musicas)) : { id: 'nova', ...corpo };
      if (url === '/api/repertorio/uso') return uso;
      if (metodo === 'PUT') { const id = url.split('/').pop(); banco.set(id, { ...banco.get(id), ...corpo }); return JSON.parse(JSON.stringify(banco.get(id))); }
      return {};
    },
  });
  contexto.globalThis = contexto;
  vm.runInContext(web('repertorio-busca.js'), contexto);
  vm.runInContext(web('musica-youtube.js'), contexto);
  vm.runInContext(web('repertorio.js'), contexto);
  vm.runInContext('let usoRepertorio = {};', contexto); // vem de escalas.js no painel
  const tela = () => nos['repertorio-tela'];
  const achar = (pred) => todos(tela()).find(pred);
  const botaoCom = (texto) => achar((n) => n.tag === 'button' && n.textContent.trim().startsWith(texto));
  return { contexto, chamadas, tela, achar, botaoCom, run: (c) => vm.runInContext(c, contexto) };
}
const todos = (no) => [no, ...(no.children || []).filter((c) => typeof c === 'object').flatMap(todos)];

const MUSICAS = [
  { id: 'a', titulo: 'Bondade de Deus', cantor: 'Isaias Saad', status: 'OK', ativo: true, tomSelecionado: 'G', primeiraNota: 'D', bpm: '68', referencia: 'https://www.youtube.com/watch?v=AbCdEfGhIjK' },
  { id: 'b', titulo: 'Lugar Secreto', cantor: 'Gabriela Rocha', status: 'OK', ativo: true, tomSelecionado: '', bpm: '', referencia: 'https://open.spotify.com/track/x' },
  { id: 'c', titulo: 'Me Atraiu', cantor: 'Gabriela Rocha', status: 'Em análise', ativo: false },
];

test('lista mostra contagens das músicas OK, vídeo em destaque e uso na escala', async () => {
  const a = ambiente({ musicas: MUSICAS, uso: { a: { ultima: '2026-11-09', vezes: 6 } } });
  await a.run('carregarRepertorio()');
  const texto = a.tela().textContent;
  assert.match(texto, /2músicas OK na escala/);
  assert.match(texto, /1sem vídeo/);
  assert.match(texto, /1sem tom/);
  assert.match(texto, /09\/11\/26/);
  assert.ok(a.botaoCom('Ouvir'), 'botão vermelho para quem tem YouTube');
  assert.ok(a.achar((n) => n.tag === 'a' && n.textContent === 'outro link'), 'link do Spotify não se passa por vídeo');
  assert.doesNotMatch(texto, /Me Atraiu/, 'abre filtrando as OK');
  a.botaoCom('Todas').props.onclick();
  assert.match(a.tela().textContent, /Me Atraiu/);
});

test('tom, 1ª nota e BPM gravam na linha só com o campo mudado', async () => {
  const a = ambiente({ musicas: MUSICAS });
  await a.run('carregarRepertorio()');
  const tom = a.achar((n) => n.props['aria-label'] === 'Tom Diakonia de Lugar Secreto');
  tom.value = 'A';
  await tom.events.change();
  assert.deepEqual(a.chamadas.at(-1), { metodo: 'PUT', url: '/api/repertorio/b', corpo: { tomSelecionado: 'A' } });
  const bpm = a.achar((n) => n.props['aria-label'] === 'BPM de Lugar Secreto');
  bpm.value = ' 72 ';
  await bpm.events.change();
  assert.deepEqual(a.chamadas.at(-1).corpo, { bpm: '72' });
  assert.match(a.tela().textContent, /0sem tom/, 'contagem atualiza na hora');
});

test('"+ YouTube" grava quando reconhece o vídeo, inclusive sem https', async () => {
  const a = ambiente({ musicas: MUSICAS });
  await a.run('carregarRepertorio()');
  a.botaoCom('+ YouTube').props.onclick();
  const campo = a.achar((n) => n.props['aria-label'] === 'Link do YouTube de Lugar Secreto');
  campo.value = 'youtube.com/watch?v=';
  await campo.events.input();
  assert.equal(a.chamadas.filter((c) => c.metodo === 'PUT').length, 0, 'link incompleto não grava');
  campo.value = 'youtu.be/ZzYyXxWwVvU';
  await campo.events.input();
  assert.deepEqual(a.chamadas.at(-1), { metodo: 'PUT', url: '/api/repertorio/b', corpo: { referencia: 'https://youtu.be/ZzYyXxWwVvU' } });
});

test('Ouvir abre o player em modo de privacidade só depois do clique', async () => {
  const a = ambiente({ musicas: MUSICAS });
  await a.run('carregarRepertorio()');
  assert.equal(a.achar((n) => n.tag === 'iframe'), undefined, 'nada do YouTube carrega antes do clique');
  a.botaoCom('Ouvir').props.onclick();
  const iframe = a.achar((n) => n.tag === 'iframe');
  assert.match(iframe.props.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/AbCdEfGhIjK\?/);
  assert.equal(iframe.props.referrerpolicy, 'strict-origin-when-cross-origin');
});

test('Editar abre a ficha em página e salva tudo com PUT; título e cantor são obrigatórios', async () => {
  const a = ambiente({ musicas: MUSICAS });
  await a.run('carregarRepertorio()');
  a.botaoCom('Editar').props.onclick();
  assert.match(a.tela().textContent, /Versão de referência/);
  assert.match(a.tela().textContent, /Como a Diakonia toca/);
  assert.equal(a.achar((n) => n.tag === 'iframe'), undefined, 'capa neutra: sem imagem do YouTube');
  a.achar((n) => n.tag === 'button' && n.textContent === 'E').props.onclick();
  await a.botaoCom('Salvar').events.click();
  const put = a.chamadas.find((c) => c.metodo === 'PUT');
  assert.equal(put.url, '/api/repertorio/a');
  assert.equal(put.corpo.primeiraNota, 'E');
  assert.equal(put.corpo.titulo, 'Bondade de Deus');
  assert.equal(put.corpo.status, 'OK');

  const b = ambiente({ musicas: MUSICAS });
  await b.run('carregarRepertorio()');
  b.botaoCom('+ Música').props.onclick();
  await b.botaoCom('Salvar').events.click();
  assert.equal(b.chamadas.filter((c) => c.metodo === 'POST').length, 0);
  assert.match(b.tela().textContent, /Informe o título e o cantor/);
});

test('ficha avisa música repetida enquanto digita o título', async () => {
  const a = ambiente({ musicas: MUSICAS });
  await a.run('carregarRepertorio()');
  a.botaoCom('+ Música').props.onclick();
  const titulo = a.achar((n) => n.props.id === 'rep-titulo');
  titulo.value = 'bondade';
  titulo.events.input();
  assert.match(a.tela().textContent, /Já existe: Bondade de Deus · Isaias Saad/);
});

test('link do YouTube na música nova preenche título e cantor vazios, sem apagar o que já foi digitado', async () => {
  const a = ambiente({
    musicas: MUSICAS,
    responder: (metodo, url) => url.startsWith('/api/repertorio/youtube?')
      ? { titulo: 'Ressuscita-me', cantor: 'Aline Barros', tituloVideo: 'Aline Barros - Ressuscita-me (Ao Vivo)', canal: 'Aline Barros' } : undefined,
  });
  await a.run('carregarRepertorio()');
  a.botaoCom('+ Música').props.onclick();
  const cantor = a.achar((n) => n.props.id === 'rep-cantor');
  cantor.value = 'Aline Barros e Banda';
  cantor.events.input();
  const link = a.achar((n) => n.props['aria-label'] === 'Link do YouTube da versão de referência');
  link.value = 'youtu.be/ZzYyXxWwVvU';
  link.events.input();
  await new Promise((r) => setImmediate(r));
  assert.equal(a.chamadas.at(-1).url, '/api/repertorio/youtube?link=' + encodeURIComponent('https://youtu.be/ZzYyXxWwVvU'));
  assert.equal(a.achar((n) => n.props.id === 'rep-titulo').value, 'Ressuscita-me');
  assert.equal(a.achar((n) => n.props.id === 'rep-cantor').value, 'Aline Barros e Banda', 'o que a pessoa digitou fica');
  assert.match(a.tela().textContent, /Preenchido pelo vídeo "Aline Barros - Ressuscita-me \(Ao Vivo\)"/);
  await a.botaoCom('Salvar').events.click();
  const post = a.chamadas.find((c) => c.metodo === 'POST');
  assert.equal(post.corpo.titulo, 'Ressuscita-me');
  assert.equal(post.corpo.referencia, 'https://youtu.be/ZzYyXxWwVvU');

  const b = ambiente({ musicas: MUSICAS, responder: (m, url) => { if (url.startsWith('/api/repertorio/youtube')) throw new Error('fora do ar'); } });
  await b.run('carregarRepertorio()');
  b.botaoCom('Editar').props.onclick();
  assert.equal(b.chamadas.filter((c) => c.url.startsWith('/api/repertorio/youtube')).length, 0, 'música que já tem vídeo não consulta o YouTube');
});

test('Completar cadastro percorre as OK com falta e grava só o que mudou', async () => {
  const a = ambiente({ musicas: MUSICAS });
  await a.run('carregarRepertorio()');
  a.botaoCom('Completar cadastro (1)').props.onclick();
  assert.match(a.tela().textContent, /Lugar Secreto/);
  const tons = a.achar((n) => n.props['aria-label'] === 'Tom Diakonia');
  todos(tons).find((n) => n.tag === 'button' && n.textContent === 'A').props.onclick();
  await a.botaoCom('Salvar e terminar').events.click();
  assert.deepEqual(a.chamadas.at(-1), { metodo: 'PUT', url: '/api/repertorio/b', corpo: { tomSelecionado: 'A' } });
  assert.match(a.tela().textContent, /Pronto: todas as músicas da fila foram revisadas/);
});

test('sem permissão de louvor a planilha é só leitura', async () => {
  const a = ambiente({ gestao: false, musicas: MUSICAS });
  await a.run('carregarRepertorio()');
  assert.equal(a.achar((n) => n.tag === 'select'), undefined);
  assert.equal(a.botaoCom('Editar'), undefined);
  assert.equal(a.botaoCom('+ YouTube'), undefined);
  assert.ok(a.botaoCom('Ouvir'), 'ouvir continua liberado');
});

test('script não usa innerHTML e não carrega miniatura do YouTube', () => {
  const js = web('repertorio.js');
  assert.doesNotMatch(js, /innerHTML/);
  assert.doesNotMatch(js, /i\.ytimg\.com|miniaturaYoutube/);
  const html = web('painel.html');
  assert.ok(html.indexOf('/musica-youtube.js') < html.indexOf('/repertorio.js'), 'ajudante do YouTube antes do repertório');
});
