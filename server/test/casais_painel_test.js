const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const web = (nome) => fs.readFileSync(require('node:path').join(__dirname, '../web', nome), 'utf8');

function ambiente(permissoes = ['casais', 'devocionais']) {
  class No {
    constructor(tag, props = {}, filhos = []) { this.tag = tag; this.props = props; this.children = filhos.flat().filter(Boolean); this.value = props.value || ''; this.checked = false; this.disabled = false; this.hidden = false; this.events = {}; }
    append(...filhos) { this.children.push(...filhos.flat()); }
    replaceChildren(...filhos) { this.children = filhos.flat(); }
    addEventListener(nome, fn) { this.events[nome] = fn; }
    setAttribute(nome, valor) { this.props[nome] = valor; }
    focus() {}
    reportValidity() { return true; }
  }
  const nos = new Map();
  const chamadas = [];
  const contexto = vm.createContext({ console, URL, URLSearchParams, Date, setTimeout,
    el: (tag, props = {}, ...filhos) => new No(tag, props, filhos),
    botao: (texto, fn) => new No('button', { onclick: fn }, [texto]),
    $: (id) => { if (!nos.has(id)) nos.set(id, new No('div')); return nos.get(id); },
    mensagem: (no, texto) => { no.textContent = texto; },
    pode: (p) => permissoes.includes(p), eu: { nome: 'Líder' },
    window: { addEventListener() {} }, location: { origin: 'https://igreja.test' },
    confirm: () => true, alert() {}, navigator: { clipboard: { writeText: async () => {} } },
    api: async (metodo, url, corpo) => { chamadas.push({ metodo, url, corpo }); if (url.startsWith('/api/casais')) return { casais: [{ id: 'c', nome: '<img>', conjugeNome: 'Ana', dataAniversario: '2026-11-20', anos: 5, contatos: [] }] }; return []; },
  });
  vm.runInContext(web('casais.js'), contexto);
  return { contexto, nos, chamadas, run: (codigo) => vm.runInContext(codigo, contexto) };
}

test('menu, painel e hook integram Casais antes de painel.js sem mudar sua versão', () => {
  const menu = require('../web/menu-lateral.js');
  assert.ok(menu.gruposPermitidos(['casais']).find((g) => g.nome === 'Acompanhamento').itens.some((i) => i.id === 'casais'));
  const html = web('painel.html');
  assert.match(html, /data-painel="casais"/);
  assert.ok(html.indexOf('/casais.js?') < html.indexOf('/painel.js?'));
  assert.match(html, /data-permissao="devocionais"/);
  assert.match(web('painel.js'), /casais: carregarCasais/);
});

test('consulta mensal restrita não busca membros nem devocionais e usa DOM seguro', async () => {
  const a = ambiente(['casais']);
  await a.run('carregarCasais()');
  assert.equal(a.chamadas.length, 1);
  assert.match(a.chamadas[0].url, /^\/api\/casais\?mes=\d+&ano=\d+/);
  assert.ok(a.nos.get('casais-lista').children.length);
  assert.doesNotMatch(web('casais.js'), /innerHTML|\/api\/membros/);
});

test('texto integral inclui todas seções; rascunho não tem link', () => {
  const a = ambiente();
  const texto = a.run("textoDevocional({titulo:'Amor',referencia:'João 3',texto:'Reflexão',aplicacao:'Praticar',oracao:'Orar'})");
  for (const parte of ['João 3', 'Reflexão', 'Praticar', 'Orar']) assert.ok(texto.includes(parte));
  assert.equal(a.run("linkDevocional({id:'x',status:'rascunho'})"), '');
  assert.equal(a.run("linkDevocional({id:'x',status:'publicado'})"), 'https://igreja.test/devocional?id=x');
});

test('editor preserva conteúdo na publicação e controla prévia e confirmação de envio', () => {
  const js = web('casais.js');
  assert.match(js, /beforeunload/);
  assert.match(js, /\/api\/devocionais\/destinatarios/);
  assert.match(js, /previa-email/);
  assert.match(js, /confirmar: true/);
  assert.match(js, /incluirAssinantes/);
  assert.match(js, /bruto: true/);
  assert.doesNotMatch(js, /innerHTML/);
});

function todos(no) { return [no, ...(no.children || []).filter((f) => typeof f === 'object').flatMap(todos)]; }
function botaoTexto(no, texto) { return todos(no).find((n) => n.tag === 'button' && (n.textContent ? n.textContent === texto : n.children.includes(texto))); }

test('publicação primeiro apresenta prévia, depois salva todos os campos sem enviar email', async () => {
  const a = ambiente();
  const requests = [];
  a.contexto.api = async (metodo, url, corpo) => { requests.push({ metodo, url, corpo }); return metodo === 'POST' ? { id: 'novo' } : []; };
  a.run("abrirEditorDevocional({titulo:'Amor',texto:'Refletir',aplicacao:'Praticar',oracao:'Orar'})");
  const editor = a.nos.get('devocional-editor');
  await botaoTexto(editor, 'Publicar').props.onclick();
  assert.equal(requests.length, 0, 'prévia deve ser visível antes da decisão de publicar');
  await botaoTexto(editor, 'Confirmar publicação').props.onclick();
  const gravacao = requests.find((r) => r.metodo === 'POST');
  assert.equal(gravacao.corpo.texto, 'Refletir');
  assert.equal(gravacao.corpo.aplicacao, 'Praticar');
  assert.equal(gravacao.corpo.oracao, 'Orar');
  assert.equal(gravacao.corpo.status, 'publicado');
  assert.ok(!requests.some((r) => r.url.includes('email')));
});

test('edição não salva pede confirmação antes de fechar e rascunho não compartilha link', () => {
  const a = ambiente();
  a.contexto.confirm = () => false;
  a.run("abrirEditorDevocional({titulo:'Rascunho',status:'rascunho',id:'r'})");
  const editor = a.nos.get('devocional-editor');
  const form = todos(editor).find((n) => n.tag === 'form');
  form.events.input();
  assert.equal(a.run('confirmarSaidaDevocional()'), false);
  botaoTexto(editor, 'Fechar edição').props.onclick();
  assert.equal(editor.hidden, false);
  assert.ok(!todos(editor).some((n) => n.tag === 'a'));
});

test('sair da sessão por gesto humano pede confirmação da edição pendente', () => {
  assert.match(web('painel.js'), /\$\('sair'\)\.addEventListener\('click', \(\) => \{\s*if \(confirmarSaidaDevocional\(\)\) sair\(\);/);
});

test('prévia email usa somente endpoint limitado, invalida seleção e bloqueia envio duplicado', async () => {
  const a = ambiente();
  const requests = [];
  let concluir;
  a.contexto.api = async (metodo, url, corpo) => {
    requests.push({ metodo, url, corpo });
    if (url.endsWith('destinatarios')) return [{ id: 'm1', nome: 'Ana', email: 'ana@test' }];
    if (url.endsWith('previa-email')) return { assunto: 'Amor', texto: '<img onerror=x>', total: 1, jaEnviados: [] };
    return new Promise((resolve) => { concluir = resolve; });
  };
  a.run("globalThis.caixaEmail = el('section')");
  await a.run("prepararEmailDevocional({id:'d',status:'publicado'}, caixaEmail, () => false)");
  const caixa = a.contexto.caixaEmail;
  const checkbox = todos(caixa).find((n) => n.tag === 'input'); checkbox.checked = true;
  await botaoTexto(caixa, 'Gerar prévia de e-mail').props.onclick();
  const enviar = botaoTexto(caixa, 'Confirmar e enviar e-mail');
  assert.ok(enviar);
  const envio = enviar.props.onclick();
  await enviar.props.onclick();
  assert.equal(requests.filter((r) => r.url.endsWith('/email')).length, 1);
  assert.equal(a.run('confirmarSaidaDevocional()'), false, 'envio em andamento deve impedir troca de edição');
  concluir({ enviados: 0, ignorados: 0, falhas: 1, incertos: 0,
    aviso: 'Nenhuma mensagem foi enviada. Confira o servidor SMTP em Administração e tente de novo.' });
  await envio;
  assert.ok(todos(caixa).some((n) => n.textContent && n.textContent.includes('SMTP')),
    'a orientação do servidor precisa aparecer para o líder, não só a contagem de falhas');
  assert.ok(!requests.some((r) => r.url === '/api/membros'));
  await botaoTexto(caixa, 'Gerar prévia de e-mail').props.onclick();
  todos(caixa).find((n) => n.tag === 'fieldset').events.change();
  assert.equal(botaoTexto(caixa, 'Confirmar e enviar e-mail'), undefined);
});

module.exports = { ambiente, web };
