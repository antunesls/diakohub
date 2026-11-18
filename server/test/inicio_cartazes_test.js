const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../web/inicio.html'), 'utf8');

function tela() {
  const criar = (tag = 'div') => ({
    tag, filhos: [], eventos: {}, style: {}, hidden: false, open: false,
    clientWidth: 800, clientHeight: 600, naturalWidth: 1600, naturalHeight: 2400,
    setAttribute(k, v) { this[k] = v; },
    removeAttribute(k) { delete this[k]; },
    addEventListener(k, fn) { this.eventos[k] = fn; },
    append(...itens) { this.filhos.push(...itens); },
    replaceChildren(...itens) { this.filhos = itens; },
    remove() {},
    showModal() { this.open = true; },
    close() { this.open = false; this.eventos.close?.(); },
  });
  const elementos = new Map();
  const $ = (id) => {
    if (!elementos.has(id)) elementos.set(id, criar());
    return elementos.get(id);
  };
  const document = { getElementById: $, createElement: criar, createElementNS: (_, tag) => criar(tag), body: { style: {} } };
  const contexto = vm.createContext({ document, window: { addEventListener() {} }, URL });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.slice(0, script.indexOf("fetch('/api/public/inicio')")), contexto);
  return { $, document, executar: (codigo) => vm.runInContext(codigo, contexto) };
}

test('avisos ficam antes do destaque e dos atalhos, logo depois do carrossel', () => {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.ok(main.includes('id="avisos"'));
  assert.ok(main.indexOf('id="avisos"') < main.indexOf('id="hoje"'));
  assert.ok(main.indexOf('id="avisos"') < main.indexOf('id="atalhos"'));
  assert.match(main, /class="largura-toda" id="avisos"/);
});

test('cartaz abre inteiro, amplia até o limite e volta a caber na tela', () => {
  const { $, document, executar } = tela();
  executar("abrirCartaz('/cartazes/oracao.png', 'Culto de oração');");
  assert.equal($('visualizador-cartaz').open, true);
  assert.equal($('cartaz-completo').src, '/cartazes/oracao.png');
  assert.equal($('cartaz-completo').alt, 'Culto de oração');
  $('cartaz-completo').eventos.load();
  const inicial = parseFloat($('cartaz-completo').style.width);
  assert.ok(inicial <= 800 && inicial * 2400 / 1600 <= 600, 'imagem inteira cabe sem recorte');
  $('cartaz-ampliar').eventos.click();
  assert.ok(parseFloat($('cartaz-completo').style.width) > inicial);
  for (let i = 0; i < 30; i++) $('cartaz-ampliar').eventos.click();
  assert.equal($('cartaz-ampliar').disabled, true);
  $('cartaz-ajustar').eventos.click();
  assert.equal(parseFloat($('cartaz-completo').style.width), inicial);
  assert.equal($('cartaz-reduzir').disabled, true);
  $('cartaz-fechar').eventos.click();
  assert.equal($('visualizador-cartaz').open, false);
  assert.equal(document.body.style.overflow || '', '');
});

test('imagem indisponível informa o erro e permite fechar', () => {
  const { $, executar } = tela();
  executar("abrirCartaz('/cartazes/ausente.png', 'Aviso');");
  $('cartaz-completo').eventos.error();
  assert.match($('cartaz-estado').textContent, /Não foi possível carregar/);
  assert.equal($('cartaz-ampliar').disabled, true);
  $('cartaz-fechar').eventos.click();
  assert.equal($('visualizador-cartaz').open, false);
});

test('recado com imagem abre o visualizador; sem imagem continua só texto', () => {
  const { $, executar } = tela();
  executar(`montarCarrossel = () => {};
    montar({ igreja: 'Diakonia', urgentes: [], avisos: [
      { titulo: 'Oração', imagem: '/cartazes/oracao.png', texto: 'Quarta-feira' },
      { titulo: 'Aviso sem cartaz', texto: 'Texto do aviso' }
    ], agenda: false, eventos: [], cultos: [], endereco: '', redes: {} });`);
  assert.equal($('avisos').hidden, false);
  assert.equal($('principal').filhos.length, 0, 'avisos não ficam mais na coluna inferior');
  const artigos = $('avisos').filhos[1].filhos;
  const link = artigos[0].filhos[0];
  assert.equal(link.tag, 'a');
  assert.equal(link.href, '/cartazes/oracao.png');
  let impedido = false;
  link.eventos.click({ preventDefault() { impedido = true; } });
  assert.equal(impedido, true);
  assert.equal($('visualizador-cartaz').open, true);
  assert.equal(artigos[1].filhos.some((f) => f.tag === 'a'), false);
  executar(`montar({ igreja: 'Diakonia', urgentes: [], avisos: [], agenda: false,
    eventos: [], cultos: [], endereco: '', redes: {} });`);
  assert.equal($('avisos').hidden, true);
});
