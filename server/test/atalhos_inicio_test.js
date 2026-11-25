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
