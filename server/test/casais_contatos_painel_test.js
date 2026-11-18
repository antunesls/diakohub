const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const codigo = fs.readFileSync(require('node:path').join(__dirname, '../web/casais.js'), 'utf8');
function ambiente(gerenciar = true) {
  class No {
    constructor(tag, props = {}, filhos = []) { this.tag = tag; this.props = props; this.children = filhos.flat().filter(Boolean); this.value = props.value || ''; this.events = {}; }
    append(...n) { this.children.push(...n); }
    replaceChildren(...n) { this.children = n; }
    addEventListener(n, fn) { this.events[n] = fn; }
  }
  const nos = new Map(), chamadas = [], copias = [];
  const casal = { membroId: 'a', conjugeId: 'b', nome: '<Ana>', conjugeNome: 'Bruno', anos: 10,
    dataCasamento: '2016-11-18', dataAniversario: '2026-11-18', contatos: [{ membroId: 'a', nome: 'Ana', email: 'ana@example.test', whatsapp: '11999999999' }],
    contatosHistory: [{ id: 'h', tipo: 'parabenizado', realizadoEm: '2026-11-18', usuarioNome: 'Líder' }] };
  const lista = [casal];
  const contexto = vm.createContext({ Date, console, encodeURIComponent, pode: p => p === 'casais' || gerenciar,
    $: id => { if (!nos.has(id)) nos.set(id, new No('div')); return nos.get(id); },
    el: (t, p, ...f) => new No(t, p, f), botao: (t, fn) => new No('button', { onclick: fn }, [t]),
    mensagem: (n, t) => n.textContent = t, confirm: () => true,
    navigator: { clipboard: { writeText: async t => copias.push(t) } }, window: { addEventListener() {}, open() {} },
    api: async (m, u, b) => { chamadas.push({ m, u, b }); if (m === 'GET') return { casais: lista };
      if (u.endsWith('/previa')) return { previaId: 'p', texto: b.texto, assunto: 'Parabéns', destinatario: 'ana@example.test' };
      return { estado: 'aceito_smtp' }; } });
  vm.runInContext(codigo, contexto);
  const todos = n => [n, ...(n.children || []).flatMap(x => typeof x === 'object' ? todos(x) : [])];
  return { contexto, nos, chamadas, copias, todos, lista, run: c => vm.runInContext(c, contexto),
    botao: texto => todos(nos.get('casais-lista')).find(n => n.tag === 'button' && n.children.includes(texto)) };
}
test('gestão mostra editor e histórico, consulta não mostra ações', async () => {
  const a = ambiente(); await a.run('carregarCasais()');
  assert.ok(a.botao('Preparar mensagem'));
  assert.ok(a.botao('Anular registro'));
  const b = ambiente(false); await b.run('carregarCasais()'); assert.equal(b.botao('Preparar mensagem'), undefined);
  assert.doesNotMatch(codigo, /innerHTML|\/api\/membros/);
});
test('trocar casal descarta editor anterior somente após confirmação', async () => {
  const a = ambiente(); a.lista.push({ ...a.lista[0], membroId: 'c', nome: 'Carla' });
  await a.run('carregarCasais()');
  const botoes = a.todos(a.nos.get('casais-lista')).filter(n => n.tag === 'button' && n.children.includes('Preparar mensagem'));
  await botoes[0].props.onclick();
  await botoes[1].props.onclick();
  assert.equal(a.todos(a.nos.get('casais-lista')).filter(n => n.tag === 'textarea').length, 1);
});
test('clique duplo envia uma vez; edição invalida confirmação anterior', async () => {
  const a = ambiente(); await a.run('carregarCasais()'); await a.botao('Preparar mensagem').props.onclick();
  await a.botao('Prévia de e-mail').props.onclick();
  const confirmar = a.botao('Confirmar envio de e-mail');
  const texto = a.todos(a.nos.get('casais-lista')).find(n => n.tag === 'textarea');
  texto.value = 'Texto alterado'; texto.events.input();
  await confirmar.props.onclick();
  assert.equal(a.chamadas.filter(c => c.u.endsWith('/email')).length, 0);
  await a.botao('Prévia de e-mail').props.onclick();
  const enviar = a.botao('Confirmar envio de e-mail');
  await Promise.all([enviar.props.onclick(), enviar.props.onclick()]);
  assert.equal(a.chamadas.filter(c => c.u.endsWith('/email')).length, 1);
});
test('copiar não registra contato; envio exige prévia separada', async () => {
  const a = ambiente(); await a.run('carregarCasais()');
  await a.botao('Preparar mensagem').props.onclick();
  await a.botao('Copiar mensagem').props.onclick();
  assert.equal(a.copias.length, 1);
  assert.equal(a.chamadas.filter(c => c.m === 'POST').length, 0);
  await a.botao('Prévia de e-mail').props.onclick();
  assert.equal(a.chamadas.at(-1).u, '/api/casais/parabens/previa');
  await a.botao('Confirmar envio de e-mail').props.onclick();
  assert.equal(a.chamadas.at(-1).b.confirmar, true);
  assert.equal(a.chamadas.at(-1).b.previaId, 'p');
  assert.equal(a.chamadas.some(c => c.u === '/api/casais/contatos'), false);
});

test('navegação e saída podem recusar a perda da mensagem em edição', async () => {
  const a = ambiente(); await a.run('carregarCasais()'); await a.botao('Preparar mensagem').props.onclick();
  a.contexto.confirm = () => false;
  assert.equal(a.run('confirmarSaidaCasais()'), false);
  a.contexto.confirm = () => true;
  assert.equal(a.run('confirmarSaidaCasais()'), true);
  assert.equal(a.run('casaisEdicao'), false);
  const painel = fs.readFileSync(require('node:path').join(__dirname, '../web/painel.js'), 'utf8');
  assert.match(painel, /nome !== 'casais' && !confirmarSaidaCasais\(\)/);
  assert.match(painel, /confirmarSaidaDevocional\(\) && confirmarSaidaCasais\(\)/);
});
