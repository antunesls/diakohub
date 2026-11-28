const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { videoYoutube, miniaturaYoutube, linkYoutube } = require('../web/musica-youtube.js');
const { posicao, adicionar, mover } = require('../web/musicas-culto.js');

const ler = (arquivo) => fs.readFileSync(path.join(__dirname, '../web', arquivo), 'utf8');

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

test('ordem do culto: adicionar vai para o fim no tom padrão, sem repetir, e mover troca a posição', () => {
  const musicas = [{ titulo: 'Antiga', tom: 'D' }, { repertorioId: 'a', titulo: 'A', tom: 'G' }];
  assert.deepEqual(adicionar(musicas, { id: 'b', titulo: 'B', tom: 'A' }), { repertorioId: 'b', titulo: 'B', tom: 'A' });
  assert.equal(adicionar(musicas, { id: 'a', titulo: 'A', tom: 'C' }), null, 'a mesma música não entra duas vezes');
  assert.equal(posicao(musicas, 'b'), 3);
  assert.equal(posicao(musicas, 'x'), 0);
  assert.equal(mover(musicas, 2, 0).repertorioId, 'b');
  assert.equal(mover(musicas, 0, -1), null);
  assert.equal(mover(musicas, 1, 1), null);
  assert.deepEqual(musicas.map((m) => m.repertorioId || m.titulo), ['b', 'Antiga', 'a']);
});

test('a janela de músicas tem busca, filtros, tabela ordenável, prévia e a ordem com arrastar, subir e descer', () => {
  const js = ler('musicas-culto.js');
  for (const trecho of ['buscarRepertorio(', 'andamentoBpm(', 'primeiraNotaNoTom(', 'miniaturaYoutube', "'aria-sort'", 'dblclick',
    "class: 'alca'", '`Subir ${titulo}`', '`Descer ${titulo}`', '`Tirar ${titulo}`', 'pointerdown', 'Ordem do culto']) {
    assert.ok(js.includes(trecho), trecho);
  }
  // Enter na busca adiciona a música em foco e nunca envia (salva) a janela.
  assert.match(js, /e\.key === 'Enter'\) \{\r?\n\s+e\.preventDefault\(\);/);
});

test('painel e Minha Escala usam a mesma janela de músicas', () => {
  const painel = ler('painel.html');
  const escalas = ler('escalas.js');
  const minha = ler('minha-escala.html');
  for (const html of [painel, minha]) {
    assert.match(html, /<link rel="stylesheet" href="\/musicas-culto\.css\?v=1">/);
    assert.ok(html.indexOf('/repertorio-busca.js?v=2') < html.indexOf('/musicas-culto.js?v=1'), 'busca e transposição antes da janela');
    assert.ok(html.indexOf('/musica-youtube.js?v=1') < html.indexOf('/musicas-culto.js?v=1'), 'miniatura antes da janela');
    assert.doesNotMatch(html, /<dialog id="dlg-(musicas|selecionar-musica|adicionar)"/, 'a janela antiga saiu');
  }
  assert.ok(painel.indexOf('/musicas-culto.js?v=1') < painel.indexOf('/escalas.js?v=19'));
  assert.match(escalas, /MusicasCulto\.abrir\(/);
  assert.match(escalas, /\/api\/repertorio\/uso/);
  assert.match(escalas, /tom: tomDaMusica\(r\)/);
  assert.match(minha, /MusicasCulto\.abrir\(/);
  assert.match(minha, /\/api\/minha-escala\/cultos\/\$\{c\.id\}\/musicas/);
  assert.match(minha, /m\.youtube/);
  assert.match(minha, /m\.primeiraNota/);
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

test('tom padrão vem de uma função que ainda existe nos scripts', () => {
  const busca = ler('repertorio-busca.js');
  // tomPadraoRepertorio saiu do repertorio.js; uma chamada que sobrasse derrubava a escolha da música.
  assert.doesNotMatch(ler('escalas.js'), /tomPadraoRepertorio/);
  assert.doesNotMatch(ler('musicas-culto.js'), /tomPadraoRepertorio/);
  assert.match(busca, /function tomDaMusica\(/);
});
