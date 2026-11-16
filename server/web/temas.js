'use strict';

/** Catálogo e composição das coleções. O logo original é aplicado separado dos fundos. */
const DiakoTemas = (() => {
  const COLECOES = Object.freeze([
    { id: 'luz-e-presenca', nome: 'Luz e presença', cor: '#091a32', destaque: '#e9bf74', descricao: 'Azul profundo e arcos de luz dourada.' },
    { id: 'aguas-tranquilas', nome: 'Águas tranquilas', cor: '#062c32', destaque: '#86d7c7', descricao: 'Verde-petróleo, água e movimentos suaves.' },
    { id: 'alianca', nome: 'Aliança', cor: '#321222', destaque: '#edb08d', descricao: 'Vinho profundo e círculos em cobre.' },
  ]);
  const FORMATOS = Object.freeze({
    tv: { largura: 1920, altura: 1080, nome: 'TV · 16:9' },
    projetor: { largura: 1440, altura: 1080, nome: 'Projetor · 4:3' },
  });
  const APLICACOES = Object.freeze([
    { id: 'boas-vindas', nome: 'Boas-vindas', titulo: 'Há um lugar para você.', chamada: 'Seja bem-vindo à nossa igreja.' },
    { id: 'aviso', nome: 'Aviso', titulo: 'Fique por dentro', chamada: 'Escreva aqui o aviso para a comunidade.' },
    { id: 'agenda', nome: 'Agenda', titulo: 'Nossa agenda', chamada: 'Preencha os encontros, dias e horários.' },
    { id: 'oracao', nome: 'Momento de oração', titulo: 'Vamos orar juntos', chamada: 'Uma comunidade que cuida e intercede.' },
    { id: 'visitantes', nome: 'Visitantes', titulo: 'Que bom ter você aqui!', chamada: 'Você é bem-vindo à nossa família.' },
    { id: 'ofertas', nome: 'Dízimos e ofertas', titulo: 'Generosidade que transforma', chamada: 'Um momento de gratidão e contribuição.' },
    { id: 'versiculo', nome: 'Versículo / Palavra', titulo: 'Tua palavra ilumina o caminho.', chamada: 'Substitua pelo texto e pela referência da passagem.' },
    { id: 'louvor', nome: 'Fundo de louvor / Holyrics', titulo: '', chamada: '' },
    { id: 'qr-oracao', nome: 'QR · Pedidos de oração', titulo: 'Podemos orar por você?', chamada: 'Aponte a câmera do celular e envie seu pedido.', qr: 'oracao' },
    { id: 'qr-mensagens', nome: 'QR · Caixa de mensagens', titulo: 'Quer falar com a gente?', chamada: 'Envie suas dúvidas, sugestões e mensagens.', qr: 'mensagens' },
    { id: 'qr-pix', nome: 'QR · PIX das ofertas', titulo: 'Dízimos e ofertas', chamada: 'Aponte a câmera do celular para contribuir.', qr: 'pix' },
  ]);

  function planoArte(opcoes) {
    const colecao = COLECOES.find(c => c.id === opcoes.colecao);
    const formato = FORMATOS[opcoes.formato];
    const aplicacao = APLICACOES.find(a => a.id === opcoes.aplicacao);
    if (!colecao) throw new Error('Coleção desconhecida.');
    if (!Object.hasOwn(FORMATOS, opcoes.formato)) throw new Error('Formato desconhecido.');
    if (!aplicacao) throw new Error('Aplicação desconhecida.');
    const { largura, altura } = formato;
    let texto = { x: 160, y: 360, largura: largura - 320, altura: 540, alinhar: 'center' };
    let logo = { x: (largura - 500) / 2, y: 128, largura: 500 };
    let qr = null;
    if (aplicacao.qr) {
      if (opcoes.formato === 'projetor') {
        qr = { id: aplicacao.qr, posicao: 'centro-baixo', tamanho: 'P', area: { x: 480, y: 509, largura: 480, altura: 475 } };
        texto = { x: 140, y: 225, largura: 1160, altura: 235, alinhar: 'center' };
        logo = { x: 510, y: 88, largura: 420 };
      } else {
        qr = { id: aplicacao.qr, posicao: 'direita-meio', tamanho: 'M', area: { x: 1200, y: 236, largura: 624, altura: 608 } };
        texto = { x: 128, y: 355, largura: 940, altura: 510, alinhar: 'left' };
        logo = { x: 128, y: 128, largura: 500 };
      }
    }
    if (aplicacao.id === 'louvor') logo = { x: (largura - 340) / 2, y: 900, largura: 340 };
    return { largura, altura, colecao, aplicacao, texto, logo, qr };
  }

  function nomeArquivo(opcoes) {
    planoArte(opcoes); // não aceitar nomes ou formatos fora do catálogo
    return `diakonia-${opcoes.colecao}-${opcoes.aplicacao}-${opcoes.formato === 'projetor' ? '4x3' : '16x9'}.png`;
  }

  function parametrosQr(opcoes) {
    const p = planoArte(opcoes);
    if (!p.qr) throw new Error('Escolha uma aplicação de QR code.');
    return new URLSearchParams({
      qr: p.qr.id, modo: 'arte', posicao: p.qr.posicao, tamanho: p.qr.tamanho,
      layout: JSON.stringify({
        titulo: opcoes.titulo ?? p.aplicacao.titulo, chamada: opcoes.chamada ?? p.aplicacao.chamada,
        logo: opcoes.logo !== false, formato: opcoes.formato, colecao: opcoes.colecao,
      }),
    }).toString();
  }

  function linhasDe(texto, largura, medir) {
    const linhas = [];
    for (const paragrafo of String(texto).split('\n')) {
      let linha = '';
      for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
        const tentativa = linha ? `${linha} ${palavra}` : palavra;
        if (linha && medir(tentativa) > largura) { linhas.push(linha); linha = palavra; }
        else linha = tentativa;
      }
      if (linha) linhas.push(linha);
    }
    return linhas;
  }

  function ajustarBloco(texto, area, tamanho, medir) {
    for (let px = tamanho; px >= 30; px -= 2) {
      const linhas = linhasDe(texto, area.largura, s => medir(s, px));
      if (linhas.every(l => medir(l, px) <= area.largura) && linhas.length * px * 1.16 <= area.altura) return { px, linhas };
    }
    return null;
  }

  /** Recorta somente a decoração do fundo; logo e textos são compostos nas coordenadas do formato. */
  function desenharFundo(ctx, imagem, largura, altura) {
    const escala = Math.max(largura / imagem.width, altura / imagem.height);
    const w = imagem.width * escala, h = imagem.height * escala;
    ctx.drawImage(imagem, (largura - w) / 2, (altura - h) / 2, w, h);
  }

  function desenhar(ctx, opcoes, imagens, { previa = false, semTexto = false } = {}) {
    const p = planoArte(opcoes);
    ctx.canvas.width = p.largura;
    ctx.canvas.height = p.altura;
    if (!imagens.fundo || (opcoes.logo !== false && !imagens.logo)) throw new Error('Fundo ou logo indisponível. Recarregue a página.');
    desenharFundo(ctx, imagens.fundo, p.largura, p.altura);
    // Véu mais forte no louvor, sem letras fixas: o Holyrics continua responsável pelas letras.
    ctx.fillStyle = p.aplicacao.id === 'louvor' ? 'rgba(0,0,0,.30)' : 'rgba(0,0,0,.14)';
    ctx.fillRect(0, 0, p.largura, p.altura);
    if (opcoes.logo !== false) {
      const l = p.logo;
      ctx.drawImage(imagens.logo, l.x, l.y, l.largura, l.largura * imagens.logo.height / imagens.logo.width);
    }
    if (!semTexto && p.aplicacao.id !== 'louvor') {
      const a = p.texto;
      const titulo = opcoes.titulo ?? p.aplicacao.titulo;
      const chamada = opcoes.chamada ?? p.aplicacao.chamada;
      const tituloAltura = a.altura * (chamada ? 0.64 : 1);
      const fonte = p.colecao.id === 'alianca' ? 'Georgia, serif' : 'Montserrat, Arial, sans-serif';
      const medir = (s, px) => { ctx.font = `700 ${px}px ${fonte}`; return ctx.measureText(s).width; };
      const ajuste = ajustarBloco(titulo, { largura: a.largura, altura: tituloAltura }, p.qr && opcoes.formato === 'projetor' ? 68 : 112, medir);
      const secundario = ajustarBloco(chamada, { largura: a.largura, altura: a.altura * 0.28 }, 44, (s, px) => {
        ctx.font = `500 ${px}px Montserrat, Arial, sans-serif`;
        return ctx.measureText(s).width;
      });
      if (!ajuste || !secundario) throw new Error('O texto não cabe. Encurte o título ou a chamada.');
      ctx.textAlign = a.alinhar;
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      const x = a.alinhar === 'center' ? a.x + a.largura / 2 : a.x;
      let y = a.y;
      ctx.font = `700 ${ajuste.px}px ${fonte}`;
      for (const linha of ajuste.linhas) { ctx.fillText(linha, x, y); y += ajuste.px * 1.16; }
      if (chamada) {
        y = Math.max(y + 24, a.y + tituloAltura + 12);
        ctx.fillStyle = p.colecao.destaque;
        ctx.font = `500 ${secundario.px}px Montserrat, Arial, sans-serif`;
        for (const linha of secundario.linhas) { ctx.fillText(linha, x, y); y += secundario.px * 1.16; }
      }
    }
    if (previa && p.qr) {
      const r = p.qr.area, lado = Math.min(r.largura, r.altura);
      ctx.fillStyle = '#fff';
      ctx.fillRect(r.x, r.y, lado, lado);
      ctx.fillStyle = '#172b40';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 38px Arial, sans-serif';
      ctx.fillText('QR real do servidor', r.x + lado / 2, r.y + lado / 2 - 20);
      ctx.font = '28px Arial, sans-serif';
      ctx.fillText('Área reservada', r.x + lado / 2, r.y + lado / 2 + 32);
    }
    return p;
  }

  return { COLECOES, FORMATOS, APLICACOES, planoArte, nomeArquivo, parametrosQr, ajustarBloco, desenharFundo, desenhar };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DiakoTemas;
