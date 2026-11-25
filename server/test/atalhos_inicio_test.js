const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('menu do site oferece acessos à Recepção e à Minha Escala, sem substituir as seções públicas', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/inicio.html'), 'utf8');
  assert.match(html, /\['recepcao', 'Recepção', '\/recepcao'\]/);
  assert.match(html, /\['minha-escala', 'Minha Escala', 'https:\/\/diakoniatulipas\.com\.br\/minha-escala', true\]/);
  assert.doesNotMatch(html, /'Louvor', 'https:/);
  assert.match(html, /menu\.map\(\(\[id, nome, destino, destaque\]\) => el\('a',/);
  assert.match(html, /class: destaque \? 'menu-escala' : null/);
  assert.match(html, /\.topo-site nav a\.menu-escala \{[^}]*background: var\(--ok\); color: #fff;/);
  assert.match(html, /\.topo-site nav \{ order: 3; width: 100%; justify-content: center; \}/);
  assert.match(html, /secao\('agenda', 'Próximos eventos'/);
  assert.match(html, /id: 'cultos'/);
  assert.doesNotMatch(html, /menu\.push\(\['agenda', 'Agenda'\]\)/);
  assert.doesNotMatch(html, /menu\.push\(\['cultos', 'Cultos'\]\)/);
});

test('rodapé da página inicial tem um link discreto para o cadastro de membros', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/inicio.html'), 'utf8');
  assert.match(html, /el\('a', \{ class: 'botao-membro', href: '\/cadastro' \}/);
  assert.match(html, /'Cadastro de membro'\)\];/);
});

test('"+ Agenda" abre o Google Agenda no Android e o convite .ics nos outros aparelhos', () => {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '../web/inicio.html'), 'utf8');
  const trecho = html.match(/  const ehAndroid = [^\n]+\n  const linkAgenda = [^\n]+\n/)[0];
  const evento = { ics: '/api/public/eventos/x.ics', google: 'https://calendar.google.com/calendar/render?action=TEMPLATE' };
  const link = (userAgent) => {
    const contexto = vm.createContext({ navigator: { userAgent }, evento });
    vm.runInContext(trecho + 'resultado = linkAgenda(evento);', contexto);
    return contexto.resultado;
  };
  assert.deepEqual({ ...link('Mozilla/5.0 (Linux; Android 14; SM-X210)') },
    { href: evento.google, target: '_blank', rel: 'noopener' });
  assert.deepEqual({ ...link('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') }, { href: evento.ics });
  assert.deepEqual({ ...link('Mozilla/5.0 (Windows NT 10.0; Win64; x64)') }, { href: evento.ics });
  assert.equal((html.match(/\.\.\.linkAgenda\(e\)/g) || []).length, 2, 'as duas listas de eventos usam o mesmo link');
});

test('card da agenda no celular: botão certo por aparelho, copiar endereço e passo a passo', () => {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '../web/inicio.html'), 'utf8').replace(/\r\n/g, '\n');
  const inicio = html.indexOf('  const aparelho = () => {');
  const trecho = html.slice(inicio, html.indexOf('  const dataCurta = (iso) =>', inicio));
  const el = (tag, props = {}, ...filhos) => ({ tag, ...props, filhos: filhos.flat().filter((f) => f != null) });
  const texto = (no) => typeof no === 'string' ? no : (no.filhos || []).map(texto).join('');
  const links = (no, acc = []) => { if (no && no.tag === 'a') acc.push(no); for (const f of (no && no.filhos) || []) if (typeof f === 'object') links(f, acc); return acc; };
  const a = { ics: 'https://igreja.org/agenda.ics', webcal: 'webcal://igreja.org/agenda.ics', google: 'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Figreja.org%2Fagenda.ics' };
  const card = (userAgent) => {
    const contexto = vm.createContext({ navigator: { userAgent }, el, svg: () => 'ícone', a });
    vm.runInContext(trecho + 'resultado = cardAgendaCelular(a);', contexto);
    return contexto.resultado;
  };
  const android = card('Mozilla/5.0 (Linux; Android 14)');
  const botaoAndroid = links(android).find((l) => l.class === 'botao');
  assert.equal(botaoAndroid.href, a.google);
  assert.equal(texto(botaoAndroid), 'Adicionar ao Google Agenda');
  assert.ok(!links(android).some((l) => texto(l) === 'Usa o Google Agenda?'), 'no Android o botão principal já é o Google');
  const iphone = card('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  const botaoIphone = links(iphone).find((l) => l.class === 'botao');
  assert.equal(botaoIphone.href, a.webcal);
  assert.equal(texto(botaoIphone), 'Assinar no Calendário');
  assert.equal(links(iphone).find((l) => texto(l) === 'Usa o Google Agenda?').href, a.google);
  assert.equal(links(iphone).find((l) => texto(l) === 'Passo a passo').href, '/ajuda/agenda-celular');
  assert.match(texto(iphone), /Agenda da igreja no seu celular/);
  assert.match(texto(iphone), /chegam sozinhos/);
  assert.match(html, /if \(s\.assinatura\) lateral\.push\(cardAgendaCelular\(s\.assinatura\)\);/);
});
