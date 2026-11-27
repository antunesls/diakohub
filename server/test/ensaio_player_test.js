const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { idVideo, proximaComVideo, quantasComVideo } = require('../web/ensaio-player.js');

const musicas = [
  { titulo: 'Bondade de Deus', youtube: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
  { titulo: 'Lugar Secreto' },
  { titulo: 'Ousado Amor', youtube: 'https://youtu.be/bbbbbbbbbbb' },
  { titulo: 'Link quebrado', youtube: 'https://exemplo.com/watch?v=ccccccccccc' },
  { titulo: 'Santo Espírito', youtube: 'https://www.youtube.com/shorts/ddddddddddd' },
];

test('id do vídeo vem dos formatos de link do YouTube e recusa o resto', () => {
  assert.equal(idVideo('https://www.youtube.com/watch?v=aaaaaaaaaaa&t=30'), 'aaaaaaaaaaa');
  assert.equal(idVideo('https://youtu.be/bbbbbbbbbbb'), 'bbbbbbbbbbb');
  assert.equal(idVideo('https://www.youtube-nocookie.com/embed/eeeeeeeeeee'), 'eeeeeeeeeee');
  assert.equal(idVideo('https://exemplo.com/watch?v=ccccccccccc'), null);
  assert.equal(idVideo('https://www.youtube.com/watch?v=curto'), null);
  assert.equal(idVideo(undefined), null);
});

test('a sequência pula as músicas sem vídeo nos dois sentidos', () => {
  assert.equal(proximaComVideo(musicas, -1, 1), 0);
  assert.equal(proximaComVideo(musicas, 0, 1), 2);
  assert.equal(proximaComVideo(musicas, 2, 1), 4);
  assert.equal(proximaComVideo(musicas, 4, 1), -1);
  assert.equal(proximaComVideo(musicas, 4, -1), 2);
  assert.equal(proximaComVideo(musicas, 0, -1), -1);
  assert.equal(quantasComVideo(musicas), 3);
  assert.equal(quantasComVideo([]), 0);
});

test('Minha Escala carrega o modo ensaio e mostra o botão no próximo culto e no culto aberto', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/minha-escala.html'), 'utf8');
  assert.match(html, /<script src="\/ensaio-player\.js\?v=1"><\/script>/);
  assert.equal((html.match(/EnsaioPlayer\.botaoEnsaio\(/g) || []).length, 2);
});
