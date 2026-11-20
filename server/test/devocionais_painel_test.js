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

// Botão principal do painel "Publicação" (o texto muda conforme a escolha).
function principalDevocional(editor) { return todos(editor).find((n) => n.tag === 'button' && /^(Publicar|Agendar|Enviar aos|Salvar alterações)/.test(n.children[0] || '')); }
function campoDevocional(editor, id) { return todos(editor).find((n) => n.props.id === id); }
function marcarAgendar(a, editor) {
  campoDevocional(editor, 'devocional-quando-agendar').checked = true;
  campoDevocional(editor, 'devocional-quando-agora').checked = false;
  campoDevocional(editor, 'devocional-quando-agendar').events.change({ target: {} });
  return a.nos.get('devocional-editor');
}
const textosDe = (no) => todos(no).flatMap((n) => (n.children || []).filter((c) => typeof c === 'string'));

test('editor: trilhas ativas (e a desativada que o devocional já tinha), série e agendamento', () => {
  const a = devocionais();
  a.run("abrirEditorDevocional({id:'d',titulo:'T',trilhas:['antiga'],serie:'Frutos',serieParte:2,status:'rascunho'}, true)");
  const editor = a.nos.get('devocional-editor');
  assert.deepEqual(caixas(editor).map((c) => [c.props.value, c.checked]), [['casais', false], ['jovens', false], ['antiga', true]]);
  a.run("abrirEditorDevocional({}, true)");
  // Novo: só as ativas, já com a primeira marcada.
  assert.deepEqual(caixas(a.nos.get('devocional-editor')).map((c) => [c.props.value, c.checked]), [['casais', true], ['jovens', false]]);
  // Publicar agora com envio aos assinantes é o padrão; agendar troca o botão principal.
  assert.match(principalDevocional(a.nos.get('devocional-editor')).children[0], /^Publicar e enviar/);
  marcarAgendar(a, a.nos.get('devocional-editor'));
  assert.match(principalDevocional(a.nos.get('devocional-editor')).children[0], /^Agendar e enviar/);
});

test('agendar exige horário e manda trilhas, série e envio automático', async () => {
  const a = devocionais();
  const requests = [];
  a.contexto.api = async (metodo, url, corpo) => { requests.push({ metodo, url, corpo }); return metodo === 'POST' ? { id: 'novo', ...corpo } : []; };
  a.run("abrirEditorDevocional({titulo:'Amor',texto:'Refletir',aplicacao:'Praticar',oracao:'Orar'})");
  const editor = marcarAgendar(a, a.nos.get('devocional-editor'));
  await principalDevocional(editor).props.onclick();
  assert.ok(!requests.some((r) => r.metodo === 'POST'), 'sem horário não agenda');
  campoDevocional(editor, 'devocional-publicarEm').value = '2026-11-20T07:00';
  campoDevocional(editor, 'devocional-serie').value = 'Frutos do Espírito';
  campoDevocional(editor, 'devocional-serieParte').value = '3';
  campoDevocional(editor, 'devocional-enviarAoPublicar').checked = true;
  caixas(editor).find((c) => c.props.value === 'jovens').checked = true;
  await principalDevocional(a.nos.get('devocional-editor')).props.onclick();
  const corpo = requests.find((r) => r.metodo === 'POST' && r.url === '/api/devocionais').corpo;
  assert.equal(corpo.status, 'agendado');
  assert.equal(corpo.publicarEm, '2026-11-20T07:00');
  assert.equal(corpo.enviarAoPublicar, true);
  assert.equal(JSON.stringify(corpo.trilhas), JSON.stringify(['casais', 'jovens']));
  assert.equal(corpo.serie, 'Frutos do Espírito');
  assert.equal(corpo.serieParte, 3);
  assert.ok(!requests.some((r) => r.url.endsWith('/email')), 'agendar não envia na hora');
});

test('publicar e enviar pede confirmação na tela, grava, envia aos assinantes e mostra o recibo', async () => {
  const a = devocionais();
  const requests = [];
  a.contexto.api = async (metodo, url, corpo) => {
    requests.push({ metodo, url, corpo });
    if (url.startsWith('/api/devocionais/assinantes/contagem')) return { total: 37, porTrilha: { casais: 37 } };
    if (metodo === 'POST' && url === '/api/devocionais') return { id: 'novo', ...corpo };
    if (url.endsWith('/email')) return { enviados: 36, falhas: 1, incertos: 0, ignorados: 0 };
    if (url === '/api/devocionais/novo') return { id: 'novo', status: 'publicado', envio: { enviados: 36, falhas: 1, incertos: 0 },
      historicoEnvios: [{ tipo: 'manual', em: '2026-11-20T09:51:00', por: 'Líder', enviados: 36, falhas: 1, assinantes: true }] };
    if (url.endsWith('/previa-email')) return { aEnviar: 1, total: 37 };
    return [];
  };
  a.run("abrirEditorDevocional({titulo:'Amor',texto:'Refletir',aplicacao:'Praticar',oracao:'Orar'})");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(principalDevocional(a.nos.get('devocional-editor')).children[0], 'Publicar e enviar a 37 assinantes');
  await principalDevocional(a.nos.get('devocional-editor')).props.onclick();
  assert.equal(requests.filter((r) => r.metodo !== 'GET').length, 0, 'primeiro a pergunta na tela, sem gravar nada');
  await botaoTexto(a.nos.get('devocional-editor'), 'Sim, publicar e enviar').props.onclick();
  await new Promise((r) => setTimeout(r, 0));
  const gravacao = requests.find((r) => r.metodo === 'POST' && r.url === '/api/devocionais');
  assert.equal(gravacao.corpo.status, 'publicado');
  assert.equal(gravacao.corpo.texto, 'Refletir');
  assert.equal(gravacao.corpo.enviarAoPublicar, false, 'o envio é feito agora, não pelo agendador');
  const envio = requests.find((r) => r.url === '/api/devocionais/novo/email');
  assert.deepEqual(JSON.parse(JSON.stringify(envio.corpo)), { membrosIds: [], incluirAssinantes: true, confirmar: true });
  const editor = a.nos.get('devocional-editor');
  assert.ok(textosDe(editor).includes('✓ Enviado a 36 pessoas'), 'recibo do envio');
  assert.ok(textosDe(editor).some((t) => t.startsWith('Enviado a 36 assinantes · 1 falha')), 'histórico');
  assert.equal(principalDevocional(editor).children[0], 'Enviar aos 1 que faltam', 'a falha pode ser reenviada');
});

test('publicar sem enviar não chama o envio de e-mail', async () => {
  const a = devocionais();
  const requests = [];
  a.contexto.api = async (metodo, url, corpo) => { requests.push({ metodo, url, corpo }); return metodo === 'POST' && url === '/api/devocionais' ? { id: 'novo', ...corpo } : []; };
  a.run("abrirEditorDevocional({titulo:'Amor',texto:'Refletir',aplicacao:'Praticar',oracao:'Orar'})");
  const interruptor = campoDevocional(a.nos.get('devocional-editor'), 'devocional-enviarAoPublicar');
  interruptor.checked = false;
  interruptor.events.change({ target: {} });
  assert.equal(principalDevocional(a.nos.get('devocional-editor')).children[0], 'Publicar agora');
  await principalDevocional(a.nos.get('devocional-editor')).props.onclick();
  await botaoTexto(a.nos.get('devocional-editor'), 'Sim, publicar').props.onclick();
  assert.equal(requests.find((r) => r.metodo === 'POST' && r.url === '/api/devocionais').corpo.status, 'publicado');
  assert.ok(!requests.some((r) => r.url.endsWith('/email')));
});

test('teste para mim grava o rascunho antes e chama o endpoint de teste', async () => {
  const a = devocionais();
  const requests = [];
  a.contexto.api = async (metodo, url, corpo) => { requests.push({ metodo, url, corpo }); return metodo === 'GET' ? [] : url === '/api/devocionais' ? { id: 'novo', ...corpo } : { ok: true }; };
  a.run("abrirEditorDevocional({titulo:'Amor',texto:'Refletir',aplicacao:'Praticar',oracao:'Orar'})");
  await botaoTexto(a.nos.get('devocional-editor'), 'Enviar um teste para mim').props.onclick();
  const editor = a.nos.get('devocional-editor');
  campoDevocional(editor, 'devocional-email-teste').value = 'eu@igreja.test';
  await botaoTexto(editor, 'Enviar teste').props.onclick();
  assert.equal(requests.find((r) => r.url === '/api/devocionais').corpo.status, 'rascunho');
  assert.deepEqual(JSON.parse(JSON.stringify(requests.find((r) => r.url.endsWith('/teste')).corpo)), { email: 'eu@igreja.test' });
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
  assert.match(web('painel.js'), /\$\('sair'\)\.addEventListener\('click', \(\) => \{\s*if \(confirmarSaidaDevocional\(\) && confirmarSaidaCasais\(\)\) sair\(\);/);
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
