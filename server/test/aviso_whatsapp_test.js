const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { textoAvisoCulto, textoAvisoMes, nomeCurtoAviso, linkWhatsappTexto } = require('../web/aviso-whatsapp.js');

const LINK = 'https://igreja.exemplo/minha-escala';

test('aviso de um culto do louvor traz equipe, músicas com tom e 1ª nota e o link da Minha Escala', () => {
  const texto = textoAvisoCulto({
    culto: { titulo: 'Dom 06/12 · 9h', nome: 'Culto', ceia: true },
    escala: 'Escala do louvor',
    equipe: [['Ministro', ['Ana Souza']], ['Vocal', ['Bruno Lima', 'Carla Dias']], ['Bateria', []]],
    musicas: [{ titulo: 'Grande é o Senhor', tom: 'A', primeiraNota: 'E' }, { titulo: 'Lugar Secreto' }],
    link: LINK,
  });
  assert.equal(texto, [
    '*Escala do louvor · Dom 06/12 · 9h* (Santa Ceia)',
    '',
    'Ministro: Ana Souza',
    'Vocal: Bruno Lima, Carla Dias',
    '',
    '*Músicas*',
    '1. Grande é o Senhor — tom A · 1ª nota E',
    '2. Lugar Secreto',
    '',
    `Ouça e ensaie as músicas na Minha Escala: ${LINK}`,
  ].join('\n'));
});

test('o aviso nunca leva link do YouTube', () => {
  const texto = textoAvisoCulto({
    culto: { titulo: 'Dom 06/12 · 9h' }, escala: 'Louvor',
    musicas: [{ titulo: 'Ousado Amor', tom: 'C', youtube: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }], link: LINK,
  });
  assert.doesNotMatch(texto, /youtu/);
});

test('culto sem músicas avisa que o ministro vai escolher; escala sem músicas não fala delas', () => {
  const louvor = textoAvisoCulto({ culto: { titulo: 'Qui 31/12 · 19h', nome: 'Culto da Virada' }, escala: 'Escala do louvor', musicas: [], link: LINK });
  assert.match(louvor, /^\*Escala do louvor · Qui 31\/12 · 19h\* \(Culto da Virada\)/);
  assert.match(louvor, /Músicas: o ministro ainda vai escolher\./);
  assert.match(louvor, /Veja sua escala na Minha Escala: /);
  const pastoral = textoAvisoCulto({ culto: { titulo: 'Dom 06/12 · 9h', tema: 'Gratidão' }, escala: 'Escala pastoral', equipe: [['Pregação', ['Pr. João']]] });
  assert.equal(pastoral, '*Escala pastoral · Dom 06/12 · 9h*\nTema: Gratidão\n\nPregação: Pr. João');
});

test('texto do mês ganha o link, nomes ficam curtos e o link do WhatsApp leva o texto codificado', () => {
  assert.equal(textoAvisoMes('*Louvor — Dezembro*', LINK, true), `*Louvor — Dezembro*\n\nVeja sua escala e ouça as músicas na Minha Escala: ${LINK}`);
  assert.equal(textoAvisoMes('*Pastoral — Dezembro*', LINK), `*Pastoral — Dezembro*\n\nVeja sua escala na Minha Escala: ${LINK}`);
  assert.equal(nomeCurtoAviso('Ana Maria de Souza'), 'Ana Souza');
  assert.equal(nomeCurtoAviso('Bruno Lima'), 'Bruno Lima');
  assert.equal(linkWhatsappTexto('*Oi* & tchau'), 'https://wa.me/?text=*Oi*%20%26%20tchau');
});

test('painel e Minha Escala carregam o aviso e o painel não tem mais o cartão antigo', () => {
  const painel = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  assert.match(painel, /<script src="\/aviso-whatsapp\.js\?v=2"><\/script>\r?\n<script src="\/escalas\.js/);
  assert.match(painel, /id="escala-avisar"/);
  assert.doesNotMatch(painel, /id="escala-whatsapp"/);
  const minha = fs.readFileSync(path.join(__dirname, '../web/minha-escala.html'), 'utf8');
  assert.match(minha, /<script src="\/aviso-whatsapp\.js\?v=2"><\/script>/);
  assert.match(minha, /Avisar o grupo do louvor/);
});
