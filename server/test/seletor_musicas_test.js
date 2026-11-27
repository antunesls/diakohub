const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { videoYoutube, miniaturaYoutube, linkYoutube } = require('../web/musica-youtube.js');

test('miniatura e link aceitam somente vídeos do YouTube', () => {
  assert.equal(videoYoutube('https://youtu.be/dQw4w9WgXcQ?t=20'), 'dQw4w9WgXcQ');
  assert.equal(videoYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(miniaturaYoutube('https://youtu.be/dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(linkYoutube('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/redirect?q=x']) {
    assert.equal(videoYoutube(url), null);
    assert.equal(linkYoutube(url), null);
  }
});

test('escala tem seletor independente com busca e Minha escala mostra link e tom', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../web/escalas.js'), 'utf8');
  const minha = fs.readFileSync(path.join(__dirname, '../web/minha-escala.html'), 'utf8');
  assert.ok(html.includes('<dialog id="dlg-selecionar-musica"'));
  assert.match(html, /id="seletor-musica-busca"/);
  assert.match(html, /id="seletor-musica-lista"/);
  assert.match(script, /buscarRepertorio\(/);
  assert.match(script, /miniaturaYoutube\(/);
  assert.match(script, /linkYoutube\(/);
  assert.match(minha, /m\.youtube/);
  assert.match(minha, /m\.tom/);
  assert.ok(html.indexOf('/musica-youtube.js?v=1') < html.indexOf('/escalas.js?v=18'));
});

test('linha vazia de música não mostra texto null no resumo', () => {
  const script = fs.readFileSync(path.join(__dirname, '../web/escalas.js'), 'utf8');
  const trecho = script.slice(script.indexOf('function linhaMusica('), script.indexOf('function numerarMusicas()'));
  const criados = [];
  const el = (tag, props = {}, ...filhos) => {
    const elemento = {
      tag, props, dataset: {}, children: filhos,
      append(...itens) { this.children.push(...itens); },
      replaceChildren(...itens) { this.children = itens.map((i) => i == null ? String(i) : i); },
      addEventListener() {},
    };
    criados.push(elemento);
    return elemento;
  };
  vm.runInNewContext(`${trecho}\nlinhaMusica(); linhaMusica({ titulo: 'Histórica', tom: 'G' }, false)`, {
    el, repertorioMusicas: [], linkYoutube: () => null, textoPrimeiraNota: () => '',
    botao: (texto) => el('button', {}, texto),
  });
  const resumos = criados.filter((e) => e.props.class === 'musica-resumo');
  assert.ok(resumos[0].children.some((e) => e.tag === 'strong' && e.children.includes('Nenhuma música selecionada')));
  for (const resumo of resumos) {
    assert.ok(!resumo.children.includes('null'), 'replaceChildren recebeu null e o transformou em texto');
  }
});

test('primeira nota acompanha o tom do culto e andamento sai do BPM', () => {
  const { primeiraNotaNoTom, numeroBpm, andamentoBpm, semitomDaNota } = require('../web/repertorio-busca.js');
  // Cadastrada em G com 1ª nota D: no culto em A sobe um tom; em Bb sai escrita com bemol.
  assert.equal(primeiraNotaNoTom('D', 'G', 'G'), 'D');
  assert.equal(primeiraNotaNoTom('D', 'G', 'A'), 'E');
  assert.equal(primeiraNotaNoTom('D', 'G', 'Bb'), 'F');
  assert.equal(primeiraNotaNoTom('G', 'C', 'Eb'), 'Bb');
  assert.equal(primeiraNotaNoTom('B', 'Em', 'F#m'), 'C#');
  // Sem um dos tons a nota fica como foi cadastrada; sem nota, nada.
  assert.equal(primeiraNotaNoTom('D', '', 'A'), 'D');
  assert.equal(primeiraNotaNoTom('D', 'G', ''), 'D');
  assert.equal(primeiraNotaNoTom('', 'G', 'A'), '');
  assert.equal(semitomDaNota('C'), 0);
  assert.equal(semitomDaNota('Cb'), 11);
  assert.equal(numeroBpm('72 bpm'), 72);
  assert.equal(numeroBpm(''), null);
  assert.deepEqual(['84', '85', '120', '121', 'x'].map(andamentoBpm), ['Lenta', 'Média', 'Média', 'Rápida', '']);
});

test('seletor do painel tem tabela ordenável com prévia e Minha escala tem a busca de músicas', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../web/escalas.js'), 'utf8');
  const minha = fs.readFileSync(path.join(__dirname, '../web/minha-escala.html'), 'utf8');
  for (const id of ['seletor-musica-tabela', 'seletor-musica-cabecalho', 'seletor-musica-previa', 'seletor-musica-tons', 'seletor-musica-andamento']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(script, /\/api\/repertorio\/uso/);
  assert.match(script, /dblclick/);
  assert.ok(minha.includes('<dialog id="dlg-adicionar"'));
  assert.ok(minha.indexOf('/repertorio-busca.js?v=2') < minha.indexOf('<script>'), 'busca e transposição antes do script da página');
  assert.match(minha, /Você tocou recentemente/);
  assert.match(minha, /m\.primeiraNota/);
});

test('escolher música na escala preenche o tom com uma função que ainda existe nos scripts do painel', () => {
  const script = fs.readFileSync(path.join(__dirname, '../web/escalas.js'), 'utf8');
  const busca = fs.readFileSync(path.join(__dirname, '../web/repertorio-busca.js'), 'utf8');
  // tomPadraoRepertorio saiu do repertorio.js; a chamada que sobrou derrubava o "change" e a música não entrava na lista.
  assert.doesNotMatch(script, /tomPadraoRepertorio/);
  assert.match(script, /primeiroVinculo \? escolha\.dataset\.tomAntigo : tomDaMusica\(r\)/);
  assert.match(busca, /function tomDaMusica\(/);
});
