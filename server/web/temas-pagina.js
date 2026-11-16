'use strict';

const estadoTema = { colecao: 'luz-e-presenca', formato: 'tv', aplicacao: 'boas-vindas', titulo: '', chamada: '', logo: true };
const fundosTema = new Map();
let logoOficialTema = null;
let permissoesTema = [];
let versaoPreviaTema = 0;
let prontoTema = false;
let ocupadoTema = false;

function sair() {
  token = null;
  localStorage.removeItem('diako_token');
  permissoesTema = [];
  $('sessao-temas').textContent = 'Sessão expirada. Entre no painel novamente.';
  $('entrar-temas').hidden = false;
  atualizarAcoesTema();
}

function imagemTema(src) {
  return new Promise((ok, falha) => {
    const imagem = new Image();
    imagem.onload = () => ok(imagem);
    imagem.onerror = () => falha(new Error('Não foi possível carregar o fundo ou o logo. Recarregue a página.'));
    imagem.src = src;
  });
}

async function imagensDoTema(opcoes) {
  if (!fundosTema.has(opcoes.colecao)) fundosTema.set(opcoes.colecao, imagemTema(`/temas/${opcoes.colecao}.png`));
  const [fundo, logo] = await Promise.all([fundosTema.get(opcoes.colecao), logoOficialTema]);
  return { fundo, logo };
}

function lerCamposTema() {
  Object.assign(estadoTema, {
    formato: $('formato-tema').value, aplicacao: $('aplicacao-tema').value,
    titulo: $('titulo-tema').value, chamada: $('chamada-tema').value, logo: $('logo-tema').checked,
  });
}

function atualizarAcoesTema() {
  const p = DiakoTemas.planoArte(estadoTema);
  $('enviar-cartaz').hidden = !!p.qr || !permissoesTema.includes('cartazes');
  $('aplicar-qr').hidden = !p.qr || !permissoesTema.includes('admin');
  for (const id of ['baixar-tema', 'baixar-fundo', 'enviar-cartaz', 'aplicar-qr']) $(id).disabled = !prontoTema || ocupadoTema;
  $('baixar-tema').textContent = p.qr ? 'Baixar fundo do QR (sem código)' : 'Baixar PNG';
  $('baixar-fundo').hidden = p.aplicacao.id === 'louvor' || !!p.qr;
  $('titulo-tema').disabled = $('chamada-tema').disabled = p.aplicacao.id === 'louvor';
  $('orientacao-tema').textContent = p.qr
    ? 'O servidor coloca o QR real na área branca. O PNG baixado não contém código.'
    : p.aplicacao.id === 'louvor' ? 'Sem letras fixas. Importe o PNG como fundo de tema no Holyrics.'
      : 'Revise os textos de exemplo antes de adicionar a Cartazes.';
}

async function atualizarPreviaTema() {
  lerCamposTema();
  const versao = ++versaoPreviaTema;
  const opcoes = { ...estadoTema };
  prontoTema = false;
  atualizarAcoesTema();
  try {
    const imagens = await imagensDoTema(opcoes);
    if (versao !== versaoPreviaTema) return;
    const p = DiakoTemas.desenhar($('previa-tema').getContext('2d'), opcoes, imagens, { previa: true });
    $('descricao-previa').textContent = `${p.colecao.nome} · ${DiakoTemas.FORMATOS[opcoes.formato].nome} · ${p.largura} × ${p.altura} px`;
    prontoTema = true;
    mensagem($('resultado-tema'), 'Prévia pronta. Nenhuma alteração foi enviada ao servidor.');
  } catch (err) {
    if (versao !== versaoPreviaTema) return;
    mensagem($('resultado-tema'), err.message, false);
  } finally {
    if (versao === versaoPreviaTema) atualizarAcoesTema();
  }
}

function escolherAplicacaoTema() {
  const a = DiakoTemas.APLICACOES.find(a => a.id === $('aplicacao-tema').value);
  $('titulo-tema').value = a.titulo;
  $('chamada-tema').value = a.chamada;
  atualizarPreviaTema();
}

async function pngDoTema(opcoes, semTexto = false) {
  const canvas = document.createElement('canvas');
  DiakoTemas.desenhar(canvas.getContext('2d'), opcoes, await imagensDoTema(opcoes), { semTexto });
  const png = await new Promise(ok => canvas.toBlob(ok, 'image/png'));
  if (!png) throw new Error('Não foi possível gerar o PNG. Tente outro navegador.');
  return png;
}

async function acaoTema(acao) {
  if (!prontoTema || ocupadoTema) return;
  ocupadoTema = true;
  atualizarAcoesTema();
  try { await acao({ ...estadoTema }); }
  catch (err) { mensagem($('resultado-tema'), err.message, false); }
  finally { ocupadoTema = false; atualizarAcoesTema(); }
}

async function baixarTema(opcoes, semTexto = false) {
  const png = await pngDoTema(opcoes, semTexto);
  const url = URL.createObjectURL(png);
  const nome = DiakoTemas.nomeArquivo(opcoes).replace('.png', semTexto ? '-sem-texto.png' : '.png');
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  mensagem($('resultado-tema'), 'PNG preparado. Confira os downloads do navegador.' + (DiakoTemas.planoArte(opcoes).qr ? ' Este fundo não contém QR code.' : ''));
}

async function enviarCartazTema(opcoes) {
  if (!window.confirm('Adicionar esta arte à lista de Cartazes? Ela ficará disponível no tablet e no Holyrics.')) return;
  const png = await pngDoTema(opcoes);
  const nome = DiakoTemas.nomeArquivo(opcoes);
  await api('POST', '/api/cartazes?nome=' + encodeURIComponent(nome), png, { bruto: true, tipo: 'image/png' });
  mensagem($('resultado-tema'), 'Arte adicionada a Cartazes. Disponível no tablet e para projeção.');
}

async function aplicarQrTema(opcoes) {
  const p = DiakoTemas.planoArte(opcoes);
  const q = p.qr;
  if (!window.confirm(`Substituir a arte atual do QR de ${q.id === 'pix' ? 'PIX' : q.id === 'oracao' ? 'oração' : 'mensagens'} por ${p.colecao.nome}, no formato ${DiakoTemas.FORMATOS[opcoes.formato].nome}?`)) return;
  const cfgAtual = await api('GET', '/api/admin/configuracoes');
  if (q.id === 'pix' && !(cfgAtual.sitePixChave && cfgAtual.sitePixNome && cfgAtual.sitePixCidade)) throw new Error('Configure a chave PIX, o nome e a cidade na Administração antes de aplicar esta arte.');
  const png = await pngDoTema(opcoes);
  try {
    await api('POST', '/api/admin/arte-qr?' + DiakoTemas.parametrosQr(opcoes), png, { bruto: true, tipo: 'image/png' });
  } catch (err) {
    // Uma resposta perdida não significa que o servidor deixou de aplicar. Nunca desfazer só a geometria.
    throw new Error(err.message + ' Não foi possível confirmar a aplicação. Confira a arte na Administração antes de tentar novamente.');
  }
  mensagem($('resultado-tema'), 'Arte aplicada. O QR real será usado na próxima projeção.');
}

async function iniciarTemas() {
  logoOficialTema = imagemTema('/logo-claro.png');
  logoOficialTema.catch(() => {});
  for (const c of DiakoTemas.COLECOES) {
    const b = el('button', { type: 'button', class: 'temas-colecao', 'aria-pressed': c.id === estadoTema.colecao ? 'true' : 'false' },
      el('strong', {}, c.nome), el('span', {}, c.descricao));
    b.style.backgroundImage = `linear-gradient(#0004,#0004),url('/temas/${c.id}.png')`;
    b.addEventListener('click', () => {
      estadoTema.colecao = c.id;
      document.querySelectorAll('.temas-colecao').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      atualizarPreviaTema();
    });
    $('colecoes').append(b);
  }
  for (const a of DiakoTemas.APLICACOES) $('aplicacao-tema').append(el('option', { value: a.id }, a.nome));
  for (const id of ['formato-tema', 'titulo-tema', 'chamada-tema', 'logo-tema']) $(id).addEventListener('input', atualizarPreviaTema);
  $('aplicacao-tema').addEventListener('change', escolherAplicacaoTema);
  $('baixar-tema').addEventListener('click', () => acaoTema(o => baixarTema(o)));
  $('baixar-fundo').addEventListener('click', () => acaoTema(o => baixarTema(o, true)));
  $('enviar-cartaz').addEventListener('click', () => acaoTema(enviarCartazTema));
  $('aplicar-qr').addEventListener('click', () => acaoTema(aplicarQrTema));
  await Promise.all([document.fonts.load('700 100px Montserrat'), document.fonts.load('500 44px Montserrat')]);
  escolherAplicacaoTema();
  if (!token) {
    $('sessao-temas').textContent = 'Prévia e download disponíveis sem login';
    $('entrar-temas').hidden = false;
    return;
  }
  try {
    const eu = await api('GET', '/api/eu');
    permissoesTema = eu.permissoes || [];
    $('sessao-temas').textContent = eu.nome;
    atualizarAcoesTema();
  } catch (err) {
    $('sessao-temas').textContent = err.message;
    $('entrar-temas').hidden = false;
  }
}

iniciarTemas().catch(err => mensagem($('resultado-tema'), err.message, false));
