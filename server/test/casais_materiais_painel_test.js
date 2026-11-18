const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const fonte = () => fs.readFileSync(path.join(__dirname, '../web/casais-materiais.js'), 'utf8');

function ambiente({ gestao = true, devocionais = false, materiais = [], encontros = [] } = {}) {
  class No {
    constructor(tag, props = {}, children = []) { this.tag = tag; this.props = props; this.children = children.flat().filter(x => x != null); this.value = props.value ?? ''; this.disabled = false; }
    append(...x) { this.children.push(...x.flat()); }
    replaceChildren(...x) { this.children = x.flat(); }
    addEventListener(k, v) { this.props['on' + k] = v; }
    focus() {}
    reportValidity() { return true; }
  }
  const container = new No('div'); const chamadas = []; const copias = [];
  let pronto = false;
  const contexto = vm.createContext({
    console, el: (tag, props, ...children) => new No(tag, props, children),
    botao: (texto, onclick) => new No('button', { onclick, type: 'button' }, [texto]),
    $: id => id === 'casais-materiais-conteudo' ? container : null,
    pode: p => { assert.ok(pronto, 'não consultar permissões durante carga'); return p === 'casaisGerenciar' ? gestao : p === 'devocionais' && devocionais; },
    mensagem: (no, texto) => no.replaceChildren(texto), confirm: () => true,
    navigator: { clipboard: { writeText: async texto => copias.push(texto) } },
    api: async (metodo, url, corpo) => { chamadas.push({ metodo, url, corpo }); return metodo === 'GET' ? (url.includes('encontros') ? encontros : materiais) : {}; },
  });
  vm.runInContext(fonte(), contexto); pronto = true;
  function todos(no = container) { return [no, ...no.children.filter(x => x instanceof No).flatMap(todos)]; }
  const texto = (no = container) => no.children.map(x => x instanceof No ? texto(x) : String(x)).join(' ');
  const bot = nome => todos().find(n => n.tag === 'button' && texto(n) === nome);
  return { contexto, container, chamadas, copias, todos, texto, bot,
    carregar: () => vm.runInContext('carregarCasaisMateriais()', contexto) };
}
const material = { id: 'm', titulo: '<img onerror=alert(1)>', publico: 'casais', duracaoMinutos: 20,
  objetivo: null, preparacao: null, passos: 'Ouvir\r\nConversar', perguntas: undefined,
  usuarioNome: 'SEGREDO', participantes: ['PRIVADO'], versao: 1 };

test('carga adiada, biblioteca vazia, atalhos contextuais e consulta sem escrita', async () => {
  const a = ambiente({ gestao: false }); await a.carregar();
  assert.match(a.texto(), /Nenhum material/);
  assert.ok(!a.bot('Novo material')); assert.ok(!a.bot('Associar ao encontro'));
  assert.ok(a.todos().some(n => n.props.href === '/devocional?trilha=casais'));
  assert.ok(a.todos().some(n => n.props.href === '/devocional?trilha=familia'));
  const b = ambiente({ devocionais: true }); await b.carregar();
  assert.ok(b.todos().some(n => n.props.href === '/painel?aba=devocionais'));
});
test('DOM seguro, prévia e cópia só do material, sem null nem CRLF', async () => {
  const a = ambiente({ materiais: [material] }); await a.carregar();
  await a.bot('Prévia').props.onclick();
  await a.bot('Copiar material').props.onclick();
  assert.ok(a.copias[0].includes('<img onerror=alert(1)>'));
  assert.doesNotMatch(a.copias[0], /SEGREDO|PRIVADO|null|undefined|\r/);
  assert.doesNotMatch(fonte(), /innerHTML|\/api\/membros|\/api\/devocionais/);
});
test('busca e filtro por público não exibem materiais de outro público', async () => {
  const a = ambiente({ materiais: [material, { ...material, id: 'f', titulo: 'Família', publico: 'familia' }] });
  await a.carregar();
  const busca = a.todos().find(n => n.props['aria-label'] === 'Buscar materiais');
  busca.value = 'Família'; busca.props.oninput();
  assert.match(a.texto(), /Família/); assert.doesNotMatch(a.texto(), /<img/);
  busca.value = ''; busca.props.oninput();
  const publico = a.todos().find(n => n.props['aria-label'] === 'Filtrar público');
  publico.value = 'casais'; publico.props.onchange();
  assert.match(a.texto(), /<img/);
});
test('editor acessível cria e edita somente campos permitidos; arquivamento explícito', async () => {
  const a = ambiente({ materiais: [material] }); await a.carregar();
  a.bot('Novo material').props.onclick();
  const form = a.todos().find(n => n.tag === 'form');
  const titulo = a.todos().find(n => n.props.id === 'casais-material-titulo');
  titulo.value = 'Novo';
  assert.ok(a.todos().some(n => n.tag === 'label' && n.props.for === titulo.props.id));
  await form.props.onsubmit({ preventDefault() {} });
  const criar = a.chamadas.find(c => c.metodo === 'POST');
  assert.equal(criar.url, '/api/casais/materiais'); assert.equal(criar.corpo.titulo, 'Novo');
  a.bot('Editar').props.onclick();
  const editarForm = a.todos().find(n => n.tag === 'form');
  await editarForm.props.onsubmit({ preventDefault() {} });
  assert.ok(a.chamadas.some(c => c.metodo === 'PUT' && c.url === '/api/casais/materiais/m' && !('versao' in c.corpo)));
  await a.bot('Arquivar').props.onclick();
  assert.ok(a.chamadas.some(c => c.metodo === 'PUT' && c.corpo.arquivado === true));
});
test('associação guarda IDs em ordem explícita e nunca envia snapshot', async () => {
  const a = ambiente({ materiais: [material, { ...material, id: 'b', titulo: 'Segundo' }], encontros: [{ id: 'e', titulo: 'Encontro' }] });
  await a.carregar(); await a.bot('Associar ao encontro').props.onclick();
  const seletor = a.todos().find(n => n.props['aria-label'] === 'Material para adicionar');
  seletor.value = 'b'; a.bot('Adicionar material').props.onclick();
  seletor.value = 'm'; a.bot('Adicionar material').props.onclick();
  await a.bot('Salvar roteiro').props.onclick();
  const envio = a.chamadas.find(c => c.metodo === 'PUT');
  assert.equal(envio.url, '/api/casais/encontros/e/roteiro');
  assert.equal(JSON.stringify(envio.corpo), JSON.stringify({ materiaisIds: ['b', 'm'] }));
});
