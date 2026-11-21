const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fonte = () => fs.readFileSync(require('node:path').join(__dirname, '../web/encontros.js'), 'utf8');
function ambiente(gestao = true, responder = () => []) {
  class No {
    constructor(tag, props = {}, filhos = []) { this.tag = tag; this.props = props; this.children = filhos.flat().filter(v => v != null); this.value = props.value || ''; this.checked = false; this.events = {}; }
    append(...filhos) { this.children.push(...filhos.flat()); }
    replaceChildren(...filhos) { this.children = filhos.flat(); }
    addEventListener(nome, fn) { this.events[nome] = fn; }
    showModal() { this.aberto = true; }
    close() { this.aberto = false; }
    remove() {}
    reportValidity() { return true; }
    setAttribute(k, v) { this.props[k] = v; }
  }
  const raiz = new No('div'), body = new No('body'), chamadas = [], copiados = [];
  const contexto = vm.createContext({ Date, console, location: { origin: 'https://igreja.test' },
    navigator: { clipboard: { writeText: async texto => copiados.push(texto) } },
    $: () => raiz, el: (tag, props = {}, ...filhos) => new No(tag, props, filhos),
    botao: (texto, fn) => new No('button', { onclick: fn }, [texto]),
    mensagem: (no, texto) => { no.textContent = texto; },
    document: { body },
    api: async (metodo, url, corpo) => { chamadas.push({ metodo, url, corpo }); return responder(metodo, url, corpo); },
  });
  vm.runInContext(fonte(), contexto); // pode/eu inexistentes na carga
  contexto.pode = () => gestao;
  return { raiz, body, chamadas, copiados, run: codigo => vm.runInContext(codigo, contexto) };
}
test('carga do script é inerte e abertura usa apenas API restrita', async () => {
  const a = ambiente(false); assert.equal(a.chamadas.length, 0);
  await a.run('carregarEncontros()');
  assert.deepEqual(a.chamadas.map(c => c.url), ['/api/ministerios', '/api/encontros']);
  assert.ok(a.raiz.children.length);
});
test('formulário acessível usa dialog sem HTML inseguro nem dados privados', () => {
  const a = ambiente(); a.run('formularioEncontro()');
  assert.equal(a.body.children[0].tag, 'dialog');
  assert.equal(a.body.children[0].aberto, true);
  assert.doesNotMatch(fonte(), /innerHTML|prompt\(|\/api\/membros|\/api\/usuarios/);
  assert.match(fonte(), /\/api\/encontros\/pessoas\?busca=/);
  assert.match(fonte(), /\/api\/encontros\/responsaveis/);
});
test('busca exige mínimo de dois caracteres e seleciona sem inscrição automática', async () => {
  const a = ambiente(); await a.run('formularioInscricao({id:"e"})');
  const dialogo = a.body.children[0];
  const todos = no => [no, ...(no.children || []).filter(v => typeof v === 'object').flatMap(todos)];
  const busca = todos(dialogo).find(n => n.props?.['aria-label'] === 'Buscar pessoas');
  const pesquisar = todos(dialogo).find(n => n.tag === 'button' && n.children.includes('Buscar'));
  busca.value = 'A'; await pesquisar.props.onclick(); assert.equal(a.chamadas.length, 0);
  busca.value = 'Ana'; await pesquisar.props.onclick();
  assert.equal(a.chamadas[0].url, '/api/encontros/pessoas?busca=Ana');
});

const todos = no => [no, ...(no.children || []).filter(v => v && typeof v === 'object').flatMap(todos)];
// Abre o detalhe de todas as inscrições da aba Inscritos (cada clique redesenha a lista).
function abrirDetalhes(a) {
  for (let b; (b = todos(a.raiz).find(n => n.tag === 'button' && n.children.includes('Detalhes')));) b.props.onclick();
}
test('consulta, resumo e busca nunca passam null a replaceChildren', async () => {
  const consulta = ambiente(false);
  await consulta.run('carregarEncontros()');
  assert.ok(todos(consulta.raiz).every(n => !n.children.includes(null)), 'consulta não pode escrever null');
  const busca = ambiente(true, () => [{ id: 'a', nome: 'Ana' }]);
  await busca.run('formularioInscricao({id:"e"})');
  const dlg = busca.body.children[0];
  todos(dlg).find(n => n.props?.['aria-label'] === 'Buscar pessoas').value = 'Ana';
  await todos(dlg).find(n => n.tag === 'button' && n.children.includes('Buscar')).props.onclick();
  assert.ok(todos(dlg).every(n => !n.children.includes(null)), 'resultado da busca não pode escrever null');
  const detalhes = ambiente(true, (_, url) => url.endsWith('/inscricoes')
    ? [{ id: 'i', estado: 'confirmada', participantes: [{ id: 'p', nome: 'Ana', confirmado: false }] }]
    : url.endsWith('/tarefas') ? [] : { id: 'e', estado: 'aberto', titulo: 'Jantar' });
  await detalhes.run('detalheEncontro("e")');
  todos(detalhes.raiz).find(n => n.tag === 'button' && n.children.includes('Detalhes')).props.onclick();
  for (const aba of ['inscritos', 'checkin', 'divulgar', 'tarefas', 'roteiro']) {
    await detalhes.run(`detalheEncontro("e", "${aba}")`);
    assert.ok(todos(detalhes.raiz).every(n => !n.children.includes(null)), `aba ${aba} não pode escrever null`);
  }
});
test('inscrição envia confirmação individual explícita e responsável selecionado', async () => {
  const a = ambiente(true, (metodo, url) => url.includes('pessoas?') ? [{id: 'a', nome: '<Ana>'}] : []);
  await a.run('formularioInscricao({id:"e"})');
  const dlg = a.body.children[0];
  const buscarBotao = texto => todos(dlg).find(n => n.tag === 'button' && n.children.includes(texto));
  todos(dlg).find(n => n.props?.['aria-label'] === 'Buscar pessoas').value = 'Ana';
  await buscarBotao('Buscar').props.onclick();
  buscarBotao('Selecionar pessoa').props.onclick();
  assert.equal(a.chamadas.length, 1);
  assert.equal(buscarBotao('Definir responsável'), undefined, 'quem já é responsável não mostra o botão');
  const checks = todos(dlg).filter(n => n.props?.type === 'checkbox');
  checks[0].checked = true;
  await todos(dlg).find(n => n.tag === 'form').events.submit({preventDefault() {}});
  const envio = a.chamadas.find(c => c.metodo === 'POST');
  assert.equal(envio.url, '/api/encontros/e/inscricoes');
  assert.equal(envio.corpo.responsavelMembroId, 'a');
  assert.equal(envio.corpo.participantes[0].confirmado, true);
  assert.equal(envio.corpo.participantes[0].crianca, false);
});
test('encontro abre como página no lugar da lista e "Encontros" volta para a lista', async () => {
  const a = ambiente(true, (_, url) => {
    if (url.endsWith('/inscricoes') || url.endsWith('/tarefas')) return [];
    if (url === '/api/encontros/e') return { id: 'e', titulo: 'Jantar', estado: 'aberto', vagasOcupadas: 3, emEspera: 2, capacidade: 10, vagasDisponiveis: 7 };
    return [];
  });
  await a.run('detalheEncontro("e")');
  assert.equal(a.body.children.length, 0, 'não abre janela');
  const textos = todos(a.raiz).flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.match(textos, /3 de 10/);
  assert.match(textos, /7 vagas disponíveis/);
  assert.match(textos, /2 na espera/);
  for (const aba of ['Inscritos', 'Check-in', 'Divulgar', 'Tarefas', 'Roteiro'])
    assert.ok(todos(a.raiz).some(n => n.props?.role === 'tab' && n.children.includes(aba)), aba);
  await todos(a.raiz).find(n => n.tag === 'button' && n.children.includes('‹ Encontros')).props.onclick();
  assert.ok(a.chamadas.some(c => c.url === '/api/encontros'), 'recarrega a lista');
  assert.equal(a.run('encontroAberto'), null);
});
test('check-in marca chegada direto (confirmando quem faltava) e desfaz', async () => {
  const a = ambiente(true, (_, url) => {
    if (url.endsWith('/inscricoes')) return [
      { id: 'i', estado: 'confirmada', responsavelMembroId: 'a', participantes: [{ id: 'p', membroId: 'a', nome: 'Ana', confirmado: true }, { id: 'q', nomeAcompanhante: 'Bruno', confirmado: false }] },
      { id: 'w', estado: 'espera', participantes: [{ id: 'r', nomeAcompanhante: 'Esperando', confirmado: true }] },
    ];
    if (url.endsWith('/tarefas')) return [];
    return { id: 'e', titulo: 'Jantar', estado: 'aberto' };
  });
  await a.run('detalheEncontro("e", "checkin")');
  const pessoa = nome => todos(a.raiz).find(n => n.tag === 'button' && n.props?.['aria-pressed'] != null && todos(n).some(f => f.children.includes(nome)));
  assert.equal(pessoa('Esperando'), undefined, 'lista de espera não aparece no check-in');
  await pessoa('Ana').props.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(a.chamadas.at(-1))), { metodo: 'PUT', url: '/api/inscricoes/i/participantes/p/presenca', corpo: { presente: true } });
  assert.equal(a.body.children.length, 0, 'sem janela de confirmação');
  await pessoa('Bruno').props.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(a.chamadas.at(-1).corpo)), { confirmado: true, presente: true });
  assert.equal(pessoa('Ana').props['aria-pressed'], 'true');
  const textos = todos(a.raiz).flatMap(n => [n.textContent || '', ...n.children.filter(f => typeof f === 'string')]).join(' ');
  assert.match(textos, /2 de 2 chegaram/);
  await pessoa('Ana').props.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(a.chamadas.at(-1).corpo)), { presente: false });
});
test('aba Inscritos busca sem acento e filtra pela lista de espera', async () => {
  const a = ambiente(true, (_, url) => {
    if (url.endsWith('/inscricoes')) return [
      { id: 'c', estado: 'confirmada', responsavelNome: 'João', criadoEm: '1', participantes: [{ id: 'p', nomeAcompanhante: 'João', titular: true }] },
      { id: 'w', estado: 'espera', origem: 'link', responsavelNome: 'Paula', whatsapp: '5511988887777', criadoEm: '2', participantes: [{ id: 'q', nomeAcompanhante: 'Paula', titular: true }] },
    ];
    if (url.endsWith('/tarefas')) return [];
    return { id: 'e', titulo: 'Retiro', estado: 'aberto' };
  });
  await a.run('detalheEncontro("e")');
  const titulos = () => todos(a.raiz).flatMap(n => n.children.filter(f => typeof f === 'string' && f.startsWith('Inscrição de ')));
  const busca = todos(a.raiz).find(n => n.props?.['aria-label'] === 'Buscar inscrição');
  busca.value = 'joao'; busca.events.input();
  assert.deepEqual(titulos(), ['Inscrição de João']);
  busca.value = '98888'; busca.events.input();
  assert.deepEqual(titulos(), ['Inscrição de Paula'], 'acha pelo WhatsApp');
  busca.value = ''; busca.events.input();
  todos(a.raiz).find(n => n.tag === 'button' && n.children.includes('Lista de espera')).props.onclick();
  assert.deepEqual(titulos(), ['Inscrição de Paula']);
  await a.run('detalheEncontro("e")');
  assert.deepEqual(titulos(), ['Inscrição de Paula'], 'filtro continua depois de recarregar');
});
test('tarefa pendente conclui com um clique', async () => {
  const a = ambiente(true, (_, url) => url.endsWith('/tarefas') ? [{ id: 't', descricao: 'Comprar pão', estado: 'pendente' }]
    : url.endsWith('/inscricoes') ? [] : { id: 'e', titulo: 'Jantar', estado: 'aberto' });
  await a.run('detalheEncontro("e", "tarefas")');
  await todos(a.raiz).find(n => n.tag === 'button' && n.children.includes('Concluir')).props.onclick();
  assert.ok(a.chamadas.some(c => c.metodo === 'PUT' && c.url === '/api/encontros/tarefas/t' && c.corpo.estado === 'concluida'));
});
test('tarefa busca somente responsáveis limitados e envia campos operacionais', async () => {
  const a = ambiente(true, (_, url) => url.endsWith('/responsaveis') ? [{id:'l', nome:'Líder'}] : []);
  await a.run('formularioTarefaEncontro({id:"e"}, null)');
  const dlg = a.body.children[0];
  const campos = todos(dlg).filter(n => ['input','select','textarea'].includes(n.tag));
  campos[0].value = 'Preparar salão'; campos[1].value = '2026-12-01'; campos[2].value = 'pendente'; campos[3].value = 'l';
  await todos(dlg).find(n => n.tag === 'form').events.submit({preventDefault() {}});
  assert.equal(a.chamadas[0].url, '/api/encontros/responsaveis');
  const envio = a.chamadas.find(c => c.metodo === 'POST');
  assert.equal(envio.url, '/api/encontros/e/tarefas');
  assert.equal(envio.corpo.responsavelUsuarioId, 'l');
  assert.deepEqual(Object.keys(envio.corpo).sort(), ['descricao', 'estado', 'prazo', 'responsavelUsuarioId']);
});
test('salvar encontro impede clique duplo enquanto requisição aguarda', async () => {
  let liberar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const a = ambiente(true, metodo => metodo === 'POST' ? espera : []);
  a.run('formularioEncontro()');
  const form = todos(a.body.children[0]).find(n => n.tag === 'form');
  const primeira = form.events.submit({preventDefault() {}});
  await form.events.submit({preventDefault() {}});
  assert.equal(a.chamadas.filter(c => c.metodo === 'POST').length, 1);
  liberar({id:'e'}); await primeira;
});
test('resumo mostra próximos encontros e tarefas vencidas de encontros antigos sem filtro mensal', async () => {
  const a = ambiente(false, (_, url) => {
    if (url === '/api/encontros') return [
      {id:'antigo', titulo:'Encontro antigo', estado:'encerrado', inicio:'2000-01-01T18:00'},
      {id:'futuro', titulo:'Próximo jantar', estado:'aberto', inicio:'2099-01-01T18:00'},
    ];
    if (url === '/api/encontros/tarefas') return [
      {id:'t', encontroId:'antigo', descricao:'Pendência antiga', estado:'pendente', prazo:'2000-01-01'},
      {id:'c', encontroId:'antigo', descricao:'Não exibir concluída', estado:'concluida', prazo:'2000-01-01'},
    ];
    return [];
  });
  await a.run('carregarEncontros()');
  const textos = todos(a.raiz).flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.match(textos, /Próximos encontros/);
  assert.match(textos, /Pendência antiga/);
  assert.match(textos, /Vencida/);
  assert.doesNotMatch(textos, /Não exibir concluída/);
  assert.match(textos, /Encontro antigo/);
  // Uma só consulta de tarefas, não uma por encontro.
  assert.equal(a.chamadas.filter(c => c.url.endsWith('/tarefas')).length, 1);
});
test('primeiro membro incluído já vira o responsável da inscrição', async () => {
  const a = ambiente(true, (metodo, url) => url.includes('pessoas?') ? [{id: 'a', nome: 'Ana'}] : []);
  await a.run('formularioInscricao({id:"e"})');
  const dlg = a.body.children[0];
  const buscarBotao = texto => todos(dlg).find(n => n.tag === 'button' && n.children.includes(texto));
  todos(dlg).find(n => n.props?.['aria-label'] === 'Buscar pessoas').value = 'Ana';
  await buscarBotao('Buscar').props.onclick();
  buscarBotao('Selecionar pessoa').props.onclick();
  await todos(dlg).find(n => n.tag === 'form').events.submit({preventDefault() {}});
  const envio = a.chamadas.find(c => c.metodo === 'POST');
  assert.ok(envio, 'deve enviar sem exigir "Definir responsável"');
  assert.equal(envio.corpo.responsavelMembroId, 'a');
});
test('roteiro exibe e copia snapshots em ordem sem expor inscritos', async () => {
  const a = ambiente(false, (_, url) => {
    if (url.endsWith('/inscricoes')) return [{id:'i', estado:'confirmada', participantes:[{id:'p', nome:'Nome privado'}]}];
    if (url.endsWith('/tarefas')) return [];
    return {id:'e', titulo:'Jantar', estado:'aberto', roteiro:[
      {materialId:'m2', versao:2, conteudoSnapshot:{titulo:'Primeiro snapshot', objetivo:'Objetivo um'}},
      {materialId:'m1', versao:1, conteudoSnapshot:{titulo:'Segundo snapshot', objetivo:'Objetivo dois'}},
    ]};
  });
  // Helper aparece depois do script de encontros, como no painel real.
  a.run('function textoMaterial(m) { return m.titulo + "\\n" + m.objetivo; }');
  await a.run('detalheEncontro("e", "roteiro")');
  const dlg = a.raiz;
  const copiar = todos(dlg).find(n => n.tag === 'button' && n.children.includes('Copiar roteiro utilizado'));
  assert.ok(copiar);
  await copiar.props.onclick();
  assert.equal(a.copiados[0], 'Primeiro snapshot\nObjetivo um\n\nSegundo snapshot\nObjetivo dois');
  assert.doesNotMatch(a.copiados[0], /Nome privado/);
  const textos = todos(dlg).flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.match(textos, /Primeiro snapshot/);
});

test('convite contém somente informações do encontro e não expõe participantes', () => {
  const a = ambiente();
  const texto = a.run('textoConviteEncontro({titulo:"Jantar",inicio:"2026-11-20T19:00",local:"Salão",descricao:"Venham celebrar",participantes:[{nome:"Privado"}],usuarioId:"segredo"})');
  assert.match(texto, /Jantar/);
  assert.match(texto, /Salão/);
  assert.match(texto, /Venham celebrar/);
  assert.doesNotMatch(texto, /Privado|segredo|usuarioId/);
});

test('tarefa exibe o nome autorizado do responsável em vez de seu ID', async () => {
  const a = ambiente(false, (_, url) => url.endsWith('/tarefas')
    ? [{id:'t', descricao:'Recepção', estado:'pendente', responsavelUsuarioId:'id-interno', responsavelNome:'Liderança Teste'}]
    : url.endsWith('/inscricoes') ? [] : {id:'e', titulo:'Encontro', estado:'aberto'});
  await a.run('detalheEncontro("e", "tarefas")');
  const texto = todos(a.raiz).flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.match(texto, /Liderança Teste/);
  assert.doesNotMatch(texto, /id-interno/);
});

test('lista mostra o ministério de cada encontro, filtra por ministério e não oferece Conselho', async () => {
  const a = ambiente(true, (_, url) => {
    if (url === '/api/ministerios') return { ministerios: [{ id: 'jov', nome: 'Jovens' }, { id: 'conselho', nome: 'Conselho', fixo: true }] };
    if (url === '/api/encontros') return [
      { id: 'a', titulo: 'Acampamento', estado: 'aberto', inicio: '2099-01-01T08:00', ministerioId: 'jov' },
      { id: 'b', titulo: 'Culto de missões', estado: 'aberto', inicio: '2099-02-01T19:00' },
    ];
    return [];
  });
  await a.run('carregarEncontros()');
  const textos = () => todos(a.raiz).flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.match(textos(), /Jovens ·/);
  assert.match(textos(), /Igreja toda ·/);
  const filtro = todos(a.raiz).find(n => n.props?.['aria-label'] === 'Filtrar por ministério');
  assert.ok(filtro);
  assert.doesNotMatch(todos(filtro).flatMap(n => n.children.filter(f => typeof f === 'string')).join(' '), /Conselho/);
  filtro.value = 'jov';
  await filtro.events.change();
  assert.match(textos(), /Acampamento/);
  assert.doesNotMatch(textos(), /Culto de missões/);
  filtro.value = 'igreja';
  await filtro.events.change();
  assert.match(textos(), /Culto de missões/);
  assert.doesNotMatch(textos(), /Acampamento/);
  await a.run('filtroMinisterioEncontros = ""');
});

test('excluir encontro só aparece com Administração e chama DELETE após confirmar', async () => {
  const responder = (_, url) => url.endsWith('/inscricoes') ? [{ id: 'i', estado: 'confirmada', participantes: [] }]
    : url.endsWith('/tarefas') ? [] : { id: 'e', titulo: 'Jantar', estado: 'cancelado' };
  const semAdmin = ambiente(true, responder);
  semAdmin.run("pode = p => p === 'encontros'");
  await semAdmin.run('detalheEncontro("e")');
  assert.ok(!todos(semAdmin.raiz).some(n => n.tag === 'button' && n.children.includes('Excluir encontro')));
  const comAdmin = ambiente(true, responder);
  await comAdmin.run('detalheEncontro("e")');
  const excluir = todos(comAdmin.raiz).find(n => n.tag === 'button' && n.children.includes('Excluir encontro'));
  assert.ok(excluir, 'aparece mesmo em encontro cancelado');
  excluir.props.onclick();
  const confirmacao = comAdmin.body.children.at(-1);
  const texto = todos(confirmacao).flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.match(texto, /1 inscrição e 0 tarefas/);
  assert.match(texto, /Não dá para desfazer/);
  await todos(confirmacao).find(n => n.tag === 'form').events.submit({ preventDefault() {} });
  assert.ok(comAdmin.chamadas.some(c => c.metodo === 'DELETE' && c.url === '/api/encontros/e'));
});

test('link público: desligado oferece ativar; ligado mostra endereço, QR e ações', async () => {
  const desligado = ambiente(true, (_, url) => url.endsWith('/inscricoes') || url.endsWith('/tarefas') ? [] : { id: 'e', titulo: 'Retiro', estado: 'aberto' });
  await desligado.run('detalheEncontro("e", "divulgar")');
  assert.ok(todos(desligado.raiz).some(n => n.tag === 'button' && n.children.includes('Ativar inscrições pelo link')));
  const ligado = ambiente(true, (metodo, url) => url.endsWith('/inscricoes') || url.endsWith('/tarefas') ? []
    : { id: 'e', titulo: 'Retiro', estado: 'aberto', inicio: '2026-12-10T08:00', linkInscricao: { ativo: true, codigo: 'abcdefghijkl', ate: '2026-12-01', pergunta: 'Vai de carona?' } });
  await ligado.run('detalheEncontro("e", "divulgar")');
  const nos = todos(ligado.raiz);
  assert.equal(nos.find(n => n.props?.['aria-label'] === 'Endereço de inscrição').value, 'https://igreja.test/inscricao/abcdefghijkl');
  assert.ok(nos.some(n => n.tag === 'img' && n.props.src === '/inscricao/abcdefghijkl/qr.png'));
  const textos = nos.flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.match(textos, /01\/12\/2026/);
  assert.match(textos, /Vai de carona\?/);
  for (const b of ['Copiar link', 'Configurar link', 'Gerar novo link', 'Desativar link']) {
    assert.ok(nos.some(n => n.tag === 'button' && n.children.includes(b)), b);
  }
  nos.find(n => n.tag === 'button' && n.children.includes('Desativar link')).props.onclick();
  const confirmacao = ligado.body.children.at(-1);
  await todos(confirmacao).find(n => n.tag === 'form').events.submit({ preventDefault() {} });
  assert.ok(ligado.chamadas.some(c => c.metodo === 'PUT' && c.url === '/api/encontros/e/link' && c.corpo.ativo === false));
});

test('inscrição pelo link mostra contato e resposta; lista de espera tem "Confirmar vaga"', async () => {
  const a = ambiente(true, (_, url) => {
    if (url.endsWith('/inscricoes')) return [
      { id: 'w', estado: 'espera', origem: 'link', responsavelNome: 'Pedro', whatsapp: '5511922222222', criadoEm: '2', participantes: [{ id: 'p', nomeAcompanhante: 'Pedro', titular: true, confirmado: true }] },
      { id: 'c', estado: 'confirmada', origem: 'link', responsavelNome: 'Maria', whatsapp: '5511911111111', email: 'maria@exemplo.test', resposta: 'Sim', criadoEm: '1',
        participantes: [{ id: 'm', nomeAcompanhante: 'Maria', titular: true, confirmado: true }] },
    ];
    if (url.endsWith('/tarefas')) return [];
    return { id: 'e', titulo: 'Retiro', estado: 'aberto', linkInscricao: { ativo: false, pergunta: 'Vai de carona?' } };
  });
  await a.run('detalheEncontro("e")');
  abrirDetalhes(a);
  const nos = todos(a.raiz);
  const textos = nos.flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.ok(textos.indexOf('Inscrição de Maria') < textos.indexOf('Inscrição de Pedro'), 'confirmadas antes da espera');
  assert.match(textos, /WhatsApp \(11\) 91111-1111/);
  assert.match(textos, /Vai de carona\?: Sim/);
  assert.match(textos, /Lista de espera · 1 pessoa/);
  assert.equal(nos.filter(n => n.tag === 'button' && n.children.includes('Vincular ao cadastro')).length, 2);
  nos.find(n => n.tag === 'button' && n.children.includes('Confirmar vaga')).props.onclick();
  await todos(a.body.children.at(-1)).find(n => n.tag === 'form').events.submit({ preventDefault() {} });
  assert.ok(a.chamadas.some(c => c.metodo === 'POST' && c.url === '/api/inscricoes/w/promover'));
});

test('página pública de inscrição: sem indexação, campo invisível, aceite e sem dados de inscritos', () => {
  const html = fs.readFileSync(require('node:path').join(__dirname, '../web/inscricao.html'), 'utf8');
  const js = fs.readFileSync(require('node:path').join(__dirname, '../web/inscricao.js'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /id="website"/);
  assert.match(html, /id="consentimento"[^>]*required/);
  assert.match(js, /history\.replaceState\(null, '', '\/inscricao\/cancelar'\)/, 'tira o token da barra de endereço');
  assert.doesNotMatch(js, /innerHTML|\/api\/encontros|\/api\/membros/);
});

test('quem se inscreveu pelo link não aparece como acompanhante; vaga no singular', async () => {
  const a = ambiente(true, (_, url) => url.endsWith('/inscricoes') ? [{ id: 'c', estado: 'confirmada', origem: 'link', responsavelNome: 'Maria',
    participantes: [{ id: 't', nomeAcompanhante: 'Maria', titular: true, confirmado: true }, { id: 'f', nomeAcompanhante: 'João', crianca: true, confirmado: true }] }]
    : url.endsWith('/tarefas') ? [] : { id: 'e', titulo: 'Retiro', estado: 'aberto', vagasOcupadas: 2, vagasDisponiveis: 1 });
  await a.run('detalheEncontro("e")');
  abrirDetalhes(a);
  const textos = todos(a.raiz).flatMap(n => n.children.filter(f => typeof f === 'string')).join(' ');
  assert.equal((textos.match(/Acompanhante/g) || []).length, 1, 'só o João é acompanhante');
  assert.match(textos, /1 vaga disponível/);
});
