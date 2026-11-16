const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const arquivo = path.join(__dirname, '../web/temas.js');
const temas = fs.existsSync(arquivo) ? require(arquivo) : {};

test('biblioteca oferece as três coleções aprovadas e os dois formatos reais', () => {
  assert.equal(temas.COLECOES?.length, 3);
  assert.deepEqual(temas.COLECOES.map(c => c.nome), ['Luz e presença', 'Águas tranquilas', 'Aliança']);
  assert.deepEqual(temas.FORMATOS.tv, { largura: 1920, altura: 1080, nome: 'TV · 16:9' });
  assert.deepEqual(temas.FORMATOS.projetor, { largura: 1440, altura: 1080, nome: 'Projetor · 4:3' });
});

test('catálogo inclui cartazes, fundo de louvor e QR para oração, mensagens e PIX', () => {
  assert.ok(temas.APLICACOES?.length >= 10);
  for (const id of ['boas-vindas', 'aviso', 'agenda', 'oracao', 'visitantes', 'ofertas', 'versiculo', 'louvor', 'qr-oracao', 'qr-mensagens', 'qr-pix']) {
    assert.ok(temas.APLICACOES.some(a => a.id === id), id);
  }
  assert.equal(temas.APLICACOES.find(a => a.id === 'louvor').titulo, '');
});

test('plano usa margens seguras e separa texto e QR em cada proporção', () => {
  assert.equal(typeof temas.planoArte, 'function');
  for (const formato of ['tv', 'projetor']) {
    for (const aplicacao of temas.APLICACOES) {
      const p = temas.planoArte({ colecao: 'alianca', formato, aplicacao: aplicacao.id });
      assert.equal(p.altura, 1080);
      assert.equal(p.largura, formato === 'tv' ? 1920 : 1440);
      assert.ok(p.texto.x >= 80);
      assert.ok(p.texto.x + p.texto.largura <= p.largura - 80);
      assert.ok(p.logo.x >= 80);
      assert.ok(p.logo.x + p.logo.largura <= p.largura - 80);
      if (p.qr) {
        assert.equal(p.qr.posicao, formato === 'tv' ? 'direita-meio' : 'centro-baixo');
        assert.equal(p.qr.tamanho, formato === 'tv' ? 'M' : 'P');
        const r = p.qr.area;
        const t = p.texto;
        assert.ok(t.x + t.largura <= r.x || t.y + t.altura <= r.y, aplicacao.id);
        assert.ok(r.x + r.largura <= p.largura - 80);
        assert.ok(r.y + r.altura <= p.altura - 80);
      }
    }
  }
});

test('nomes de exportação identificam coleção, aplicação e proporção', () => {
  assert.equal(typeof temas.nomeArquivo, 'function');
  assert.equal(temas.nomeArquivo({ colecao: 'aguas-tranquilas', formato: 'projetor', aplicacao: 'louvor' }), 'diakonia-aguas-tranquilas-louvor-4x3.png');
  assert.throws(() => temas.planoArte({ colecao: '../segredo', formato: 'tv', aplicacao: 'louvor' }), /Coleção/);
  assert.throws(() => temas.planoArte({ colecao: 'alianca', formato: 'vertical', aplicacao: 'louvor' }), /Formato/);
  assert.throws(() => temas.planoArte({ colecao: 'alianca', formato: 'tv', aplicacao: 'qualquer' }), /Aplicação/);
});

test('aplicação de QR envia fundo e geometria em uma única operação', () => {
  assert.equal(typeof temas.parametrosQr, 'function');
  const params = new URLSearchParams(temas.parametrosQr({ colecao: 'alianca', formato: 'projetor', aplicacao: 'qr-oracao', titulo: 'Oração com fé', chamada: 'Envie seu pedido', logo: true }));
  assert.equal(params.get('qr'), 'oracao');
  assert.equal(params.get('posicao'), 'centro-baixo');
  assert.equal(params.get('tamanho'), 'P');
  assert.equal(JSON.parse(params.get('layout')).titulo, 'Oração com fé');
  const pagina = fs.readFileSync(path.join(__dirname, '../web/temas-pagina.js'), 'utf8');
  assert.doesNotMatch(pagina, /api\('PUT', '\/api\/admin\/configuracoes'/, 'o navegador não muda a geometria em uma segunda operação nem executa rollback cego');
});

test('texto longo reduz para caber e sinaliza quando não cabe', () => {
  assert.equal(typeof temas.ajustarBloco, 'function');
  const medir = (s, px) => s.length * px * 0.55;
  const curto = temas.ajustarBloco('Bem-vindo', { largura: 1000, altura: 300 }, 100, medir);
  assert.equal(curto.px, 100);
  const longo = temas.ajustarBloco('Uma mensagem para toda a comunidade reunida aqui hoje', { largura: 600, altura: 180 }, 100, medir);
  assert.ok(longo.px < 100);
  assert.ok(longo.linhas.length * longo.px * 1.16 <= 180);
  assert.equal(temas.ajustarBloco('x'.repeat(1000), { largura: 100, altura: 80 }, 100, medir), null);
});

test('biblioteca está ligada a Cartazes e QR, sem publicar artes automaticamente', () => {
  const ler = nome => fs.readFileSync(path.join(__dirname, '../web', nome), 'utf8');
  assert.match(ler('painel.html'), /href="\/temas\.html"/);
  assert.match(ler('admin.html'), /href="\/temas\.html"/);
  const pagina = ler('temas.html');
  for (const script of ['comum.js', 'temas.js', 'temas-pagina.js']) assert.ok(pagina.includes('/' + script));
  assert.match(pagina, /não cria temas nativos automaticamente/);
  assert.match(pagina, /fundo sem código/);
  for (const c of temas.COLECOES) {
    const bytes = fs.readFileSync(path.join(__dirname, '../web/temas', c.id + '.png'));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});
