const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ambiente, web } = require('./casais_painel_test.js');

const devocionais = (permissoes = ['devocionais']) => {
  const a = ambiente(permissoes, 'devocionais.js');
  a.run("trilhasDevocionais = [{id:'casais',nome:'Casais',ativa:true},{id:'jovens',nome:'Jovens',ativa:true},{id:'antiga',nome:'Antiga',ativa:false}]");
  return a;
};
function todos(no) { return [no, ...(no.children || []).filter((f) => typeof f === 'object').flatMap(todos)]; }
function botaoTexto(no, texto) { return todos(no).find((n) => n.tag === 'button' && (n.textContent ? n.textContent === texto : n.children.includes(texto))); }
function caixas(no) { return todos(no).filter((n) => n.tag === 'input' && n.props.type === 'checkbox' && n.props.value); }

test('página própria no menu de Comunicação, com abas e script antes do painel', () => {
  const menu = require('../web/menu-lateral.js');
  const comunicacao = menu.gruposPermitidos(['devocionais']).find((g) => g.nome === 'Comunicação');
  assert.ok(comunicacao.itens.some((i) => i.id === 'devocionais'));
  // Devocionais não dependem mais de Casais e Família.
  assert.ok(!menu.gruposPermitidos(['devocionais']).flatMap((g) => g.itens).some((i) => i.id === 'casais'));
  const html = web('painel.html');
  assert.match(html, /<section data-painel="devocionais" hidden>/);
  for (const id of ['dev-aba-lista', 'dev-aba-calendario', 'dev-aba-assinantes', 'devocional-editor', 'dev-filtro-trilha', 'dev-projetar-qr']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.indexOf('/devocionais.js?') < html.indexOf('/painel.js?'));
  assert.match(web('painel.js'), /devocionais: carregarDevocionais/);
  assert.match(web('painel.js'), /abaAtual === 'devocionais' && nome !== 'devocionais' && !confirmarSaidaDevocional\(\)/);
  assert.match(html, /id="projetar-qr-devocional"/);
});

test('editor: trilhas ativas (e a desativada que o devocional já tinha), série e agendamento', () => {
  const a = devocionais();
  a.run("abrirEditorDevocional({id:'d',titulo:'T',trilhas:['antiga'],serie:'Frutos',serieParte:2,status:'rascunho'}, true)");
  const editor = a.nos.get('devocional-editor');
  assert.deepEqual(caixas(editor).map((c) => [c.props.value, c.checked]), [['casais', false], ['jovens', false], ['antiga', true]]);
  a.run("abrirEditorDevocional({}, true)");
  // Novo: só as ativas, já com a primeira marcada.
  assert.deepEqual(caixas(a.nos.get('devocional-editor')).map((c) => [c.props.value, c.checked]), [['casais', true], ['jovens', false]]);
  assert.ok(botaoTexto(a.nos.get('devocional-editor'), 'Agendar'));
});

test('agendar exige horário e manda trilhas, série e envio automático', async () => {
  const a = devocionais();
  const requests = [];
  a.contexto.api = async (metodo, url, corpo) => { requests.push({ metodo, url, corpo }); return metodo === 'POST' ? { id: 'novo', ...corpo } : []; };
  a.run("abrirEditorDevocional({titulo:'Amor',texto:'Refletir',aplicacao:'Praticar',oracao:'Orar'})");
  const editor = a.nos.get('devocional-editor');
  await botaoTexto(editor, 'Agendar').props.onclick();
  assert.ok(!requests.some((r) => r.metodo === 'POST'), 'sem horário não agenda');
  const campo = (id) => todos(editor).find((n) => n.props.id === id);
  campo('devocional-publicarEm').value = '2026-11-20T07:00';
  campo('devocional-serie').value = 'Frutos do Espírito';
  campo('devocional-serieParte').value = '3';
  campo('devocional-enviarAoPublicar').checked = true;
  caixas(editor).find((c) => c.props.value === 'jovens').checked = true;
  await botaoTexto(editor, 'Agendar').props.onclick();
  const corpo = requests.find((r) => r.metodo === 'POST').corpo;
  assert.equal(corpo.status, 'agendado');
  assert.equal(corpo.publicarEm, '2026-11-20T07:00');
  assert.equal(corpo.enviarAoPublicar, true);
  assert.equal(JSON.stringify(corpo.trilhas), JSON.stringify(['casais', 'jovens']));
  assert.equal(corpo.serie, 'Frutos do Espírito');
  assert.equal(corpo.serieParte, 3);
});

test('publicação primeiro apresenta prévia, depois salva todos os campos sem enviar email', async () => {
  const a = devocionais();
  const requests = [];
  a.contexto.api = async (metodo, url, corpo) => { requests.push({ metodo, url, corpo }); return metodo === 'POST' ? { id: 'novo' } : []; };
  a.run("abrirEditorDevocional({titulo:'Amor',texto:'Refletir',aplicacao:'Praticar',oracao:'Orar'})");
  const editor = a.nos.get('devocional-editor');
  await botaoTexto(editor, 'Publicar agora').props.onclick();
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
  const a = devocionais();
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
  const a = devocionais();
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

test('calendário: agendado aparece no dia do agendamento, os outros na data; texto integral e link', () => {
  const { dataDevocional, diaNoCalendario } = require('../web/devocionais.js');
  assert.equal(diaNoCalendario({ status: 'agendado', publicarEm: '2026-11-20T07:00', data: '2026-11-22' }), '2026-11-20');
  assert.equal(diaNoCalendario({ status: 'publicado', data: '2026-11-22' }), '2026-11-22');
  assert.equal(dataDevocional('2026-11-20T07:00'), '20/11/2026 às 07:00');
  const a = devocionais();
  const texto = a.run("textoDevocional({titulo:'Amor',serie:'Frutos',serieParte:1,referencia:'João 3',texto:'Reflexão',aplicacao:'Praticar',oracao:'Orar'})");
  for (const parte of ['João 3', 'Reflexão', 'Praticar', 'Orar', 'Série Frutos · parte 1']) assert.ok(texto.includes(parte), parte);
  assert.equal(a.run("linkDevocional({id:'x',status:'rascunho'})"), '');
  assert.equal(a.run("linkDevocional({id:'x',status:'agendado'})"), '');
  assert.equal(a.run("linkDevocional({id:'x',status:'publicado'})"), 'https://igreja.test/devocional?id=x');
  assert.doesNotMatch(web('devocionais.js'), /innerHTML|\/api\/membros/);
});

test('administração: trilhas editáveis (criar, renomear, ordenar, desativar, excluir sem uso)', () => {
  const html = web('admin.html');
  assert.match(html, /<section class="cartao" id="trilhas-devocionais">/);
  assert.match(html, /<a href="#trilhas-devocionais">/);
  const js = web('admin.js');
  assert.match(js, /api\('GET', '\/api\/admin\/devocionais\/trilhas'\)/);
  assert.match(js, /api\('POST', '\/api\/admin\/devocionais\/trilhas'/);
  assert.match(js, /\{ ativa: !t\.ativa \}/);
  assert.match(js, /moverTrilha\(i, -1\)/);
  assert.match(js, /desative em vez de excluir/);
});

test('site: devocional da semana na página inicial, só quando o servidor manda', () => {
  const html = web('inicio.html');
  assert.match(html, /if \(s\.devocional\) \{/);
  assert.match(html, /'Devocional da semana'/);
  assert.match(html, /menu\.push\(\['devocional', 'Devocionais', '\/devocional'\]\)/);
});
