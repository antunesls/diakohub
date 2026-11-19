const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const fonte = (nome) => fs.readFileSync(path.join(__dirname, '../web', nome), 'utf8');

const tipos = [{ id: 'din', nome: 'Dinâmica', materiais: 1 }, { id: 'est', nome: 'Estudo bíblico', materiais: 0 }];
const ministerios = [{ id: 'jov', nome: 'Jovens' }, { id: 'lou', nome: 'Louvor' }, { id: 'conselho', nome: 'Conselho', fixo: true }];

function ambiente({ gestao = true, materiais = [], responder } = {}) {
  class No {
    constructor(tag, props = {}, children = []) { this.tag = tag; this.props = props || {}; this.children = children.flat().filter(x => x != null); this.value = this.props.value ?? ''; this.disabled = false; this.checked = false; this.events = {}; }
    append(...x) { this.children.push(...x.flat()); }
    replaceChildren(...x) { this.children = x.flat(); }
    addEventListener(k, v) { this.events[k] = v; this.props['on' + k] = v; }
    setAttribute(k, v) { this.props[k] = v; }
    focus() {} showModal() { this.aberto = true; } close() { this.aberto = false; this.events.close?.(); } remove() {}
    reportValidity() { return true; }
  }
  const container = new No('div'); const body = new No('body'); const chamadas = []; const copias = [];
  let pronto = false;
  const padrao = (metodo, url) => {
    if (url === '/api/materiais/tipos' && metodo === 'GET') return tipos;
    if (url.startsWith('/api/materiais') && metodo === 'GET') return materiais;
    if (url === '/api/ministerios') return { ministerios };
    return {};
  };
  const contexto = vm.createContext({
    console, Date,
    el: (tag, props, ...children) => new No(tag, props, children),
    botao: (texto, onclick, classe) => new No('button', { onclick, type: 'button', class: classe }, [texto]),
    $: id => id === 'encontros-materiais' ? container : null,
    pode: p => { assert.ok(pronto, 'não consultar permissões durante a carga'); return p === 'encontros' ? gestao : false; },
    mensagem: (no, texto) => no.replaceChildren(texto), confirm: () => true,
    document: { body },
    navigator: { clipboard: { writeText: async texto => copias.push(texto) } },
    api: async (metodo, url, corpo) => { chamadas.push({ metodo, url, corpo }); return (responder || padrao)(metodo, url, corpo); },
  });
  vm.runInContext(fonte('encontros.js'), contexto);
  vm.runInContext(fonte('materiais.js'), contexto);
  assert.equal(chamadas.length, 0, 'carga inerte');
  pronto = true;
  const todos = (no = container) => [no, ...no.children.filter(x => x instanceof No).flatMap(todos)];
  const texto = (no = container) => no.children.map(x => x instanceof No ? texto(x) : String(x)).join(' ');
  const bot = (nome, raiz = container) => todos(raiz).find(n => n.tag === 'button' && texto(n) === nome);
  const run = codigo => vm.runInContext(codigo, contexto);
  return { container, body, chamadas, copias, todos, texto, bot, run,
    carregar: async () => { await run('carregarMinisteriosEncontros()'); await run('carregarMateriais()'); } };
}
const base = { publico: 'jovens', duracaoMinutos: 20, versao: 1, objetivo: 'Integrar', passos: 'Ouvir\r\nConversar' };
const materiais = [
  { ...base, id: 'g', titulo: 'Geral para todos', publico: 'todos', ministerioId: null, tipoId: 'din', tipoNome: 'Dinâmica' },
  { ...base, id: 'j', titulo: 'Fogueira dos jovens', ministerioId: 'jov', tipoId: 'est', tipoNome: 'Estudo bíblico' },
  { ...base, id: 'l', titulo: 'Ensaio do louvor', publico: 'adultos', ministerioId: 'lou', usuarioNome: 'SEGREDO' },
];

test('biblioteca vazia, sem botões de escrita para quem não gerencia, sem Conselho nos ministérios', async () => {
  const a = ambiente({ gestao: false }); await a.carregar();
  assert.match(a.texto(), /Nenhum material cadastrado/);
  assert.ok(!a.bot('Novo material')); assert.ok(!a.bot('Tipos de material'));
  const filtro = a.todos().find(n => n.props['aria-label'] === 'Filtrar ministério');
  assert.doesNotMatch(a.texto(filtro), /Conselho/);
  assert.doesNotMatch(fonte('materiais.js'), /innerHTML|\/api\/membros|\/api\/casais/);
});

test('cartão mostra ministério, tipo e público; prévia copia só o conteúdo', async () => {
  const a = ambiente({ materiais }); await a.carregar();
  assert.match(a.texto(), /Fogueira dos jovens/); assert.match(a.texto(), /Jovens/); assert.match(a.texto(), /Estudo bíblico/);
  assert.match(a.texto(), /Geral/);
  const cartao = a.todos().find(n => n.tag === 'article' && /Ensaio do louvor/.test(a.texto(n)));
  await a.bot('Prévia', cartao).props.onclick();
  await a.bot('Copiar material').props.onclick();
  assert.match(a.copias[0], /Ensaio do louvor/);
  assert.doesNotMatch(a.copias[0], /SEGREDO|null|undefined|\r/);
});

test('filtros por ministério, tipo e público (material para todos aparece em qualquer público)', async () => {
  const a = ambiente({ materiais }); await a.carregar();
  const filtro = rotulo => a.todos().find(n => n.props['aria-label'] === rotulo);
  filtro('Filtrar ministério').value = 'jov'; filtro('Filtrar ministério').props.onchange();
  assert.match(a.texto(), /Fogueira/); assert.doesNotMatch(a.texto(), /Ensaio|Geral para todos/);
  filtro('Filtrar ministério').value = 'geral'; filtro('Filtrar ministério').props.onchange();
  assert.match(a.texto(), /Geral para todos/); assert.doesNotMatch(a.texto(), /Fogueira/);
  filtro('Filtrar ministério').value = ''; filtro('Filtrar ministério').props.onchange();
  filtro('Filtrar tipo').value = 'din'; filtro('Filtrar tipo').props.onchange();
  assert.match(a.texto(), /Geral para todos/); assert.doesNotMatch(a.texto(), /Fogueira/);
  filtro('Filtrar tipo').value = ''; filtro('Filtrar tipo').props.onchange();
  filtro('Filtrar público').value = 'adultos'; filtro('Filtrar público').props.onchange();
  assert.match(a.texto(), /Ensaio/); assert.match(a.texto(), /Geral para todos/); assert.doesNotMatch(a.texto(), /Fogueira/);
});

test('editor envia ministério e tipo (vazio vira nulo) e edita pela rota nova', async () => {
  const a = ambiente({ materiais }); await a.carregar();
  a.bot('Novo material').props.onclick();
  const campo = id => a.todos().find(n => n.props.id === 'material-' + id);
  campo('titulo').value = 'Novo';
  assert.ok(a.todos().some(n => n.tag === 'label' && n.props.for === 'material-titulo'));
  await a.todos().find(n => n.tag === 'form').props.onsubmit({ preventDefault() {} });
  const criar = a.chamadas.find(c => c.metodo === 'POST');
  assert.equal(criar.url, '/api/materiais');
  assert.equal(criar.corpo.ministerioId, null); assert.equal(criar.corpo.tipoId, null); assert.equal(criar.corpo.publico, 'todos');
  const cartao = a.todos().find(n => n.tag === 'article' && /Fogueira/.test(a.texto(n)));
  a.bot('Editar', cartao).props.onclick();
  assert.equal(campo('ministerioId').value, 'jov'); assert.equal(campo('tipoId').value, 'est');
  await a.todos().find(n => n.tag === 'form').props.onsubmit({ preventDefault() {} });
  assert.ok(a.chamadas.some(c => c.metodo === 'PUT' && c.url === '/api/materiais/j' && !('versao' in c.corpo)));
});

test('tipos: cria, renomeia e só oferece excluir para tipo sem materiais', async () => {
  const a = ambiente({ materiais }); await a.carregar();
  await a.run('gerenciarTiposMaterial()');
  const dlg = a.body.children.at(-1);
  assert.equal(dlg.tag, 'dialog');
  const linhaDe = nome => a.todos(dlg).find(n => n.tag === 'div' && n.props.class === 'item encontro-linha' && a.todos(n).some(x => x.value === nome));
  assert.ok(!a.bot('Excluir', linhaDe('Dinâmica')), 'tipo em uso não mostra Excluir');
  assert.ok(a.bot('Excluir', linhaDe('Estudo bíblico')));
  a.todos(dlg).find(n => n.props['aria-label'] === 'Nome do novo tipo').value = 'Gincana';
  await a.bot('Adicionar tipo', dlg).props.onclick();
  assert.ok(a.chamadas.some(c => c.metodo === 'POST' && c.url === '/api/materiais/tipos' && c.corpo.nome === 'Gincana'));
  const linha = linhaDe('Dinâmica');
  a.todos(linha).find(n => n.tag === 'input').value = 'Dinâmica de grupo';
  await a.bot('Renomear', linha).props.onclick();
  assert.ok(a.chamadas.some(c => c.metodo === 'PUT' && c.url === '/api/materiais/tipos/din' && c.corpo.nome === 'Dinâmica de grupo'));
});

test('montar roteiro parte do atual, mostra gerais e do ministério do encontro, e salva na ordem', async () => {
  const a = ambiente({ materiais }); await a.carregar();
  await a.run(`montarRoteiroEncontro({ id: 'e', titulo: 'Acampamento', ministerioId: 'jov', roteiro: [{ materialId: 'j', versao: 1 }] }, async () => {})`);
  const dlg = a.body.children.at(-1);
  const disponiveis = () => a.texto(a.todos(dlg).filter(n => n.props.class === 'lista').at(-1));
  assert.match(disponiveis(), /Geral para todos/);
  assert.doesNotMatch(disponiveis(), /Ensaio do louvor/, 'outro ministério fica oculto por padrão');
  assert.doesNotMatch(disponiveis(), /Fogueira/, 'já está no roteiro');
  const outros = a.todos(dlg).find(n => n.props.id === 'roteiro-outros-ministerios');
  outros.checked = true; outros.props.onchange();
  assert.match(disponiveis(), /Ensaio do louvor/);
  const linhaGeral = a.todos(dlg).find(n => n.props.class === 'item encontro-linha' && /Geral para todos/.test(a.texto(n)));
  a.bot('Adicionar', linhaGeral).props.onclick();
  // Roteiro: [Fogueira, Geral]; sobe o Geral para o primeiro lugar.
  const ol = a.todos(dlg).find(n => n.tag === 'ol');
  a.bot('Subir', ol.children[1]).props.onclick();
  await a.todos(dlg).find(n => n.tag === 'form').events.submit({ preventDefault() {} });
  const envio = a.chamadas.find(c => c.metodo === 'PUT');
  assert.equal(envio.url, '/api/encontros/e/roteiro');
  assert.deepEqual(JSON.parse(JSON.stringify(envio.corpo)), { materiaisIds: ['g', 'j'] });
});
