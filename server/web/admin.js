'use strict';
// Página de administração. Utilitários (api, el, $, mensagem...) em comum.js.

let cfg = {};
let chaveAgenteVisivel = false;

// ---------- Login ----------

function sair() {
  if (token) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
  token = null;
  localStorage.removeItem('diako_token');
  $('app').hidden = true;
  $('login').hidden = false;
  $('senha-login').focus();
}

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erro = $('erro-login');
  erro.hidden = true;
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: $('usuario-login').value.trim(), senha: $('senha-login').value }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    erro.textContent = j.erro || 'Não foi possível entrar.';
    erro.hidden = false;
    return;
  }
  token = j.token;
  localStorage.setItem('diako_token', token);
  if (j.trocarSenha) PrimeiroAcesso.lembrar($('senha-login').value);
  $('senha-login').value = '';
  iniciar();
});

$('sair').addEventListener('click', sair);

/** Pergunta antes de ações que não têm volta. */
function confirmar(titulo, texto, rotulo = 'Confirmar') {
  $('titulo-confirmar').textContent = titulo;
  $('texto-confirmar').textContent = texto;
  $('botao-confirmar').textContent = rotulo;
  const dlg = $('dlg-confirmar');
  return new Promise((ok) => {
    dlg.onclose = () => ok(dlg.returnValue === 'ok');
    dlg.showModal();
  });
}

/** Envia um formulário de configurações e mostra o resultado em [saida]. */
async function salvar(campos, saida) {
  try {
    cfg = await api('PUT', '/api/admin/configuracoes', campos);
    preencher();
    mensagem(saida, 'Salvo.');
  } catch (err) {
    mensagem(saida, err.message, false);
  }
}

const valor = (id) => $(id).value.trim();
const numero = (id) => Number($(id).value);

let participacaoCultos = {};

function preencherParticipacaoCultos() {
  const lista = $('cultos-escalas');
  lista.replaceChildren();
  const horarios = horariosParaEscalas($('siteCultos').value);
  if (!horarios.length) {
    const dica = document.createElement('p');
    dica.className = 'dica';
    dica.textContent = 'Informe acima o dia e o horário de cada culto para definir suas escalas.';
    lista.append(dica);
  }
  for (const { chave, rotulo } of horarios) {
    const linha = document.createElement('div');
    linha.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:12px 0';
    const nome = document.createElement('strong');
    nome.textContent = rotulo;
    linha.append(nome);
    for (const [tipo, titulo] of [['pastoral', 'Escala pastoral'], ['louvor', 'Escala de louvor']]) {
      const label = document.createElement('label');
      label.className = 'marcar';
      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.checked = participacaoCultos[chave]?.[tipo] !== false;
      caixa.setAttribute('aria-label', `${titulo}: ${rotulo}`);
      caixa.addEventListener('change', () => {
        participacaoCultos[chave] = { ...participacaoCultos[chave], [tipo]: caixa.checked };
      });
      label.append(caixa, document.createTextNode(titulo));
      linha.append(label);
    }
    lista.append(linha);
  }
}
$('siteCultos').addEventListener('input', preencherParticipacaoCultos);

// ---------- Carregar ----------

async function carregar() {
  cfg = await api('GET', '/api/admin/configuracoes');
  preencher();
  await carregarBackups();
}

function preencher() {
  for (const id of ['nomeIgreja', 'urlPublica', 'pedidoTitulo', 'pedidoIntro', 'pedidoObrigado', 'holyricsHost',
    'holyricsPorta', 'motivosPorSlide', 'segundosPorSlide', 'diasRespondidas', 'temaPadrao', 'horaBackup', 'backupsManter',
    'siteCultos', 'siteEndereco', 'sitePixChave', 'sitePixNome', 'sitePixCidade', 'siteInstagram', 'siteYoutube', 'siteWhatsapp', 'diakoPlayerUrl']) {
    if ($(id) && document.activeElement !== $(id)) $(id).value = cfg[id] ?? '';
  }
  $('siteAtivo').checked = cfg.siteAtivo !== false;
  participacaoCultos = structuredClone(cfg.cultosEscalas || {});
  preencherParticipacaoCultos();
  $('siteAgenda').checked = cfg.siteAgenda === true;
  $('sitePix').checked = cfg.sitePix !== false;
  $('siteGaleria').checked = cfg.siteGaleria !== false;
  $('endereco-inicio').textContent = (cfg.urlPublica || cfg.urlDetectada || '') + '/';
  $('urlPublica').placeholder = cfg.urlDetectada || '';
  $('dica-url').textContent = cfg.urlPublica
    ? 'O QR code aponta para ' + cfg.urlPublica + '/oracao'
    : 'Vazio: usa o endereço da rede local (' + cfg.urlDetectada + '). Preencha se o site está na internet.';

  // Mural
  const base = cfg.urlPublica || cfg.urlDetectada;
  const link = base + '/mural' + (cfg.chaveMural ? '?chave=' + encodeURIComponent(cfg.chaveMural) : '');
  $('link-mural').textContent = link;
  $('estado-mural').textContent = cfg.chaveMural ? 'Protegido com chave.' : 'Aberto: qualquer pessoa com o endereço vê o mural.';
  $('desativar-chave-mural').disabled = !cfg.chaveMural;

  // LGPD
  if (document.activeElement !== $('termoLgpdTexto')) $('termoLgpdTexto').value = cfg.termoLgpdEmVigor || '';
  $('versao-termo').textContent = '(versão ' + (cfg.termoLgpdVersao || 1) + (cfg.termoLgpdTexto ? '' : ', texto modelo') + ')';
  $('visitanteQrAtivo').checked = cfg.visitanteQrAtivo !== false;
  $('muralBoasVindas').checked = cfg.muralBoasVindas === true;
  $('textoMotivos').checked = cfg.textoMotivos !== false;
  preencherFundos();
  preencherArtesQr();
  $('link-visitante-admin').textContent = base + '/visitante';

  // Holyrics
  const agente = cfg.modo === 'agente';
  $('holyrics-local').hidden = agente;
  $('holyrics-agente').hidden = !agente;
  $('holyricsToken').value = '';
  $('holyricsToken').placeholder = cfg.holyricsTokenDefinido ? '•••••••• (deixe em branco para manter)' : 'Cole o token do Holyrics';
  $('dica-token').textContent = cfg.holyricsTokenDefinido ? 'Token definido.' : 'Token ainda não definido: os comandos de projeção não vão funcionar.';
  $('chave-agente').textContent = chaveAgenteVisivel ? (cfg.chaveAgente || '') : '••••••••••••';
  $('mostrar-chave-agente').textContent = chaveAgenteVisivel ? 'Ocultar' : 'Mostrar';

  // Agenda
  const ag = cfg.agenda || {};
  $('agendaUrl').value = '';
  $('agendaUrl').placeholder = cfg.agendaConfigurada
    ? '•••••••• (definido — cole um novo endereço para trocar)'
    : 'https://calendar.google.com/calendar/ical/…/basic.ics';
  if (document.activeElement !== $('agendaDiasMural')) $('agendaDiasMural').value = cfg.agendaDiasMural ?? 7;
  $('agendaMostrarDescricao').checked = cfg.agendaMostrarDescricao !== false;
  for (const id of ['smtpHost', 'smtpPorta', 'smtpUsuario', 'smtpRemetente', 'smtpDestinatario', 'emailCadastros']) {
    if (document.activeElement !== $(id)) $(id).value = cfg[id] ?? '';
  }
  $('smtpSsl').checked = cfg.smtpSsl === true;
  $('smtpSenha').value = '';
  $('smtpSenha').placeholder = cfg.smtpSenhaDefinida ? '•••••••• (deixe vazio para manter)' : 'Senha de aplicativo (se exigida)';
  $('atualizar-agenda').disabled = !ag.configurada;
  $('remover-agenda').disabled = !cfg.agendaConfigurada;
  preencherGoogle(cfg, ag);
  const estado = $('estado-agenda');
  if (!ag.configurada) {
    estado.textContent = 'Agenda desligada.';
    estado.className = 'dica';
  } else if (ag.erro) {
    mensagem(estado, 'Problema na última atualização: ' + ag.erro +
      (ag.atualizado ? ' (mostrando a cópia de ' + dataCurta(ag.atualizado) + ')' : ''), false);
  } else {
    mensagem(estado, 'Conectada. ' + (ag.proximos30dias ?? 0) + ' evento(s) nos próximos 30 dias' +
      (ag.atualizado ? ' · atualizada ' + dataCurta(ag.atualizado) : '') + '.');
  }

  // Backup e sessões
  $('pasta-backup').textContent = 'Pasta dos backups no servidor: ' + cfg.pastaBackup;
  $('qtd-sessoes').textContent = cfg.sessoes === 1 ? '1 aparelho conectado (este).' : cfg.sessoes + ' aparelhos conectados (incluindo este).';
  $('senhaNova').minLength = cfg.senhaMinima || 6;
  $('senhaNova').placeholder = 'Mínimo de ' + (cfg.senhaMinima || 6) + ' caracteres';
}

// ---------- Igreja, projeção, Holyrics ----------

$('form-inicio').addEventListener('submit', (e) => {
  e.preventDefault();
  const campos = { siteAtivo: $('siteAtivo').checked, siteAgenda: $('siteAgenda').checked, sitePix: $('sitePix').checked, siteGaleria: $('siteGaleria').checked };
  for (const id of ['siteCultos', 'siteEndereco', 'sitePixChave', 'sitePixNome', 'sitePixCidade', 'siteInstagram', 'siteYoutube', 'siteWhatsapp']) {
    campos[id] = $(id).value.trim();
  }
  campos.cultosEscalas = Object.fromEntries(horariosParaEscalas(campos.siteCultos).map(({ chave }) => [chave, {
    pastoral: participacaoCultos[chave]?.pastoral !== false,
    louvor: participacaoCultos[chave]?.louvor !== false,
  }]));
  salvar(campos, $('res-inicio'));
});

$('muralBoasVindas').addEventListener('change', () => salvar({ muralBoasVindas: $('muralBoasVindas').checked }, $('res-mural')));

// ---------- Fundo das TVs ----------

// Nome da TV na URL (?tela=) → prefixo das chaves nas configurações.
const TELAS_FUNDO = { 'mural': 'mural', 'boas-vindas': 'boasVindas' };

function preencherFundos() {
  for (const [tela, prefixo] of Object.entries(TELAS_FUNDO)) {
    if (document.activeElement !== $('fundo-cor-' + tela)) $('fundo-cor-' + tela).value = cfg[prefixo + 'FundoCor'] || '#0b1026';
    $('fundo-escurecer-' + tela).value = cfg[prefixo + 'FundoEscurecer'] ?? 55;
    $('fundo-remover-' + tela).disabled = !cfg[prefixo + 'FundoImagem'];
    previaFundo(tela);
  }
}

/** Mesma conta do mural.html: véu sobre a imagem; sem imagem, cor clara pede texto escuro. */
function previaFundo(tela) {
  const prefixo = TELAS_FUNDO[tela];
  const cor = $('fundo-cor-' + tela).value;
  const veu = Number($('fundo-escurecer-' + tela).value) / 100;
  const imagem = cfg[prefixo + 'FundoImagem'];
  $('fundo-escurecer-valor-' + tela).textContent = Math.round(veu * 100) + '%';
  const previa = $('previa-' + tela);
  previa.style.backgroundColor = cor;
  previa.style.backgroundImage = imagem
    ? `linear-gradient(rgba(0,0,0,${veu}), rgba(0,0,0,${veu})), url("/fundo-tv/${imagem}")` : '';
  const claro = !imagem && luminanciaCor(cor) > 0.3;
  previa.classList.toggle('claro', claro);
  previa.querySelector('img').src = claro ? '/logo.png' : '/logo-claro.png';
  $('fundo-escurecer-' + tela).disabled = !imagem;
}

function luminanciaCor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

for (const [tela, prefixo] of Object.entries(TELAS_FUNDO)) {
  const saida = $('res-fundo-' + tela);
  $('fundo-cor-' + tela).addEventListener('input', () => previaFundo(tela));
  $('fundo-escurecer-' + tela).addEventListener('input', () => previaFundo(tela));
  $('fundo-salvar-' + tela).addEventListener('click', () => salvar({
    [prefixo + 'FundoCor']: $('fundo-cor-' + tela).value,
    [prefixo + 'FundoEscurecer']: Number($('fundo-escurecer-' + tela).value),
  }, saida));
  $('fundo-arquivo-' + tela).addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    mensagem(saida, 'Enviando…');
    try {
      await api('POST', '/api/admin/fundo-tv?tela=' + tela, arquivo, { bruto: true, tipo: arquivo.type });
      cfg = await api('GET', '/api/admin/configuracoes');
      preencher();
      mensagem(saida, 'Imagem enviada.');
    } catch (err) {
      mensagem(saida, err.message, false);
    }
  });
  $('fundo-remover-' + tela).addEventListener('click', async () => {
    try {
      await api('DELETE', '/api/admin/fundo-tv?tela=' + tela);
      cfg = await api('GET', '/api/admin/configuracoes');
      preencher();
      mensagem(saida, 'Imagem removida: a TV usa só a cor.');
    } catch (err) {
      mensagem(saida, err.message, false);
    }
  });
}

$('form-lgpd').addEventListener('submit', (e) => {
  e.preventDefault();
  salvar({ termoLgpdTexto: $('termoLgpdTexto').value.trim(), visitanteQrAtivo: $('visitanteQrAtivo').checked }, $('res-lgpd'));
});
$('termo-padrao').addEventListener('click', () => {
  if (!confirm('Trocar o texto atual pelo modelo? Isso cria uma versão nova do termo.')) return;
  salvar({ termoLgpdTexto: '' }, $('res-lgpd'));
});

$('form-igreja').addEventListener('submit', (e) => {
  e.preventDefault();
  salvar({
    nomeIgreja: valor('nomeIgreja'),
    urlPublica: valor('urlPublica'),
    pedidoTitulo: valor('pedidoTitulo'),
    pedidoIntro: valor('pedidoIntro'),
    pedidoObrigado: valor('pedidoObrigado'),
  }, $('res-igreja'));
});

$('form-email').addEventListener('submit', (e) => {
  e.preventDefault();
  salvar({ smtpHost: valor('smtpHost'), smtpPorta: numero('smtpPorta'), smtpUsuario: valor('smtpUsuario'),
    smtpSenha: $('smtpSenha').value, smtpRemetente: valor('smtpRemetente'),
    smtpDestinatario: valor('smtpDestinatario'), emailCadastros: valor('emailCadastros'),
    smtpSsl: $('smtpSsl').checked }, $('res-email'));
});
$('testar-email-cadastro').addEventListener('click', async () => {
  try {
    const r = await api('POST', '/api/admin/testar-email-cadastro');
    mensagem($('res-email'), `Aviso de exemplo enviado para ${r.para}.`);
  } catch (e) { mensagem($('res-email'), e.message, false); }
});
$('testar-email').addEventListener('click', async () => {
  try { await api('POST', '/api/admin/testar-email'); mensagem($('res-email'), 'E-mail de teste enviado.'); }
  catch (e) { mensagem($('res-email'), e.message, false); }
});

$('form-projecao').addEventListener('submit', (e) => {
  e.preventDefault();
  salvar({
    motivosPorSlide: numero('motivosPorSlide'),
    segundosPorSlide: numero('segundosPorSlide'),
    diasRespondidas: numero('diasRespondidas'),
    temaPadrao: valor('temaPadrao'),
    textoMotivos: $('textoMotivos').checked,
  }, $('res-projecao'));
});

$('buscar-temas-holyrics').addEventListener('click', async () => {
  const lista = $('lista-temas-holyrics');
  const estado = $('estado-temas');
  estado.textContent = 'Consultando Holyrics…';
  try {
    const dados = await api('GET', '/api/admin/temas?atualizar=1');
    lista.replaceChildren();
    for (const tema of dados.temas) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'botao secundario';
      botao.style.cssText = 'display:grid;gap:6px;margin:6px;min-width:160px;max-width:200px;';
      if (tema.thumbnail) {
        const img = document.createElement('img');
        img.alt = 'Prévia do tema ' + tema.name;
        img.width = 160;
        const mime = tema.thumbnail.startsWith('/9j/') ? 'image/jpeg'
          : tema.thumbnail.startsWith('UklGR') ? 'image/webp' : 'image/png';
        img.src = 'data:' + mime + ';base64,' + tema.thumbnail;
        botao.append(img);
      }
      const nome = document.createElement('span');
      nome.textContent = tema.name;
      botao.append(nome);
      botao.addEventListener('click', () => {
        $('temaPadrao').value = tema.name;
        estado.textContent = 'Selecionado: ' + tema.name + '. Clique em Salvar para aplicar.';
      });
      lista.append(botao);
    }
    estado.textContent = dados.desatualizado ? 'Lista salva (Holyrics indisponível): confirme antes de projetar.'
      : !dados.miniaturasDisponiveis && dados.temas.length ? 'Temas carregados sem miniaturas: libere GetThumbnail no token do Holyrics.'
        : 'Atualizado em ' + dados.atualizadoEm + '. A miniatura é ilustrativa.';
  } catch (err) {
    estado.textContent = err.message + ' O tema digitado foi preservado.';
  }
});

$('form-diakoplayer').addEventListener('submit', (e) => {
  e.preventDefault();
  salvar({ diakoPlayerUrl: valor('diakoPlayerUrl') }, $('res-diakoplayer'));
});

$('form-holyrics').addEventListener('submit', (e) => {
  e.preventDefault();
  salvar({ holyricsHost: valor('holyricsHost'), holyricsPorta: numero('holyricsPorta'), holyricsToken: valor('holyricsToken') }, $('res-holyrics'));
});

async function testarHolyrics(saida) {
  mensagem(saida, 'Testando…');
  try {
    const r = await api('POST', '/api/admin/testar-holyrics');
    mensagem(saida, r.status === 'ok' ? 'Holyrics respondeu: conectado.' : (r.error || 'Sem resposta do Holyrics.'), r.status === 'ok');
  } catch (err) {
    mensagem(saida, err.message, false);
  }
}
$('testar-holyrics').addEventListener('click', () => testarHolyrics($('res-holyrics')));
$('testar-holyrics-agente').addEventListener('click', () => testarHolyrics($('res-agente')));

// ---------- Agenda ----------

$('form-agenda').addEventListener('submit', (e) => {
  e.preventDefault();
  const campos = { agendaDiasMural: numero('agendaDiasMural'), agendaMostrarDescricao: $('agendaMostrarDescricao').checked };
  if (valor('agendaUrl')) campos.agendaUrl = valor('agendaUrl');
  $('teste-agenda').replaceChildren();
  salvar(campos, $('res-agenda'));
});

$('testar-agenda').addEventListener('click', async () => {
  const saida = $('res-agenda');
  const url = valor('agendaUrl');
  if (!url) {
    mensagem(saida, 'Cole o endereço para testar.', false);
    return;
  }
  mensagem(saida, 'Testando…');
  try {
    const r = await api('POST', '/api/admin/agenda/testar', { url });
    mensagem(saida, `Funcionou: ${r.eventos} evento(s) nos próximos 60 dias. Clique em Salvar para usar.`);
    $('teste-agenda').replaceChildren(...r.proximos.map((t) => el('li', {}, t)));
  } catch (err) {
    mensagem(saida, err.message, false);
    $('teste-agenda').replaceChildren();
  }
});

$('atualizar-agenda').addEventListener('click', async () => {
  try {
    mensagem($('res-agenda'), 'Atualizando…');
    const r = await api('POST', '/api/admin/agenda/atualizar');
    await carregar();
    mensagem($('res-agenda'), r.erro ? r.erro : `Atualizada: ${r.eventos.length} evento(s) nos próximos 30 dias.`, !r.erro);
  } catch (err) {
    mensagem($('res-agenda'), err.message, false);
  }
});

// Conta de serviço: criar e editar eventos pelo painel e pelo tablet.
let trocandoChave = false;

function preencherGoogle(cfg, ag) {
  const ligada = ag.modo === 'google';
  $('google-ligada').hidden = !ligada;
  $('form-google').hidden = ligada && !trocandoChave;
  $('cancelar-troca').hidden = !(ligada && trocandoChave);
  $('email-conta').textContent = ag.contaServico || '';
  if (document.activeElement !== $('agendaCalendarioId')) $('agendaCalendarioId').value = cfg.agendaCalendarioId || ag.calendarioId || '';
  const estado = $('estado-google');
  if (!ligada) {
    estado.textContent = 'Desligada: a agenda é só para leitura.';
    estado.className = 'dica';
  } else if (ag.erro) {
    mensagem(estado, 'Ligada, mas a última atualização falhou: ' + ag.erro, false);
    estado.append(' ', el('a', { href: '/ajuda/agenda-google#problemas', target: '_blank', rel: 'noopener' }, 'Como resolver'));
  } else {
    mensagem(estado, 'Ligada: o painel e o tablet criam, editam e excluem eventos.');
  }
}

function erroComAjuda(saida, err) {
  saida.className = 'erro';
  saida.replaceChildren(...textoDoErro(err).flat().filter(Boolean));
}

$('form-google').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saida = $('res-form-google');
  const arquivo = $('arquivo-chave').files[0];
  if (!arquivo) {
    mensagem(saida, 'Escolha o arquivo .json da chave.', false);
    return;
  }
  if (arquivo.size > 20000) {
    mensagem(saida, 'Esse arquivo é grande demais para ser a chave da conta de serviço.', false);
    return;
  }
  mensagem(saida, 'Testando com o Google…');
  try {
    const r = await api('POST', '/api/admin/agenda/conta-servico', { chave: await arquivo.text(), calendarioId: valor('agendaCalendarioId') });
    $('arquivo-chave').value = '';
    trocandoChave = false;
    saida.textContent = '';
    await carregar();
    mensagem($('res-google'), `Tudo certo: ligada à agenda "${r.agenda}".`);
  } catch (err) {
    erroComAjuda(saida, err);
  }
});

$('copiar-email-conta').addEventListener('click', () => copiar($('email-conta').textContent, $('res-google')));

$('testar-google').addEventListener('click', async () => {
  const saida = $('res-google');
  mensagem(saida, 'Testando…');
  try {
    const r = await api('POST', '/api/admin/agenda/conta-servico/testar');
    await carregar();
    mensagem(saida, `Funcionando: a conta pode alterar a agenda "${r.agenda}".`);
  } catch (err) {
    erroComAjuda(saida, err);
  }
});

$('trocar-google').addEventListener('click', () => {
  trocandoChave = true;
  carregar();
});
$('cancelar-troca').addEventListener('click', () => {
  trocandoChave = false;
  carregar();
});

$('desligar-google').addEventListener('click', async () => {
  if (!await confirmar('Desligar a edição da agenda?',
    'A chave é apagada do servidor e a agenda volta a ser só para leitura (pelo endereço iCal, se houver). Os eventos no Google não são alterados. Para cortar o acesso de vez, remova também o compartilhamento da agenda com a conta de serviço.',
    'Desligar')) return;
  try {
    await api('DELETE', '/api/admin/agenda/conta-servico');
    await carregar();
    mensagem($('estado-google'), 'Edição desligada.');
  } catch (err) {
    erroComAjuda($('res-google'), err);
  }
});

$('remover-agenda').addEventListener('click', async () => {
  if (!await confirmar('Desligar a agenda?', 'Os eventos deixam de aparecer na TV, no tablet e no resumo. A agenda no Google não é alterada.', 'Desligar')) return;
  await salvar({ agendaUrl: '' }, $('res-agenda'));
});

// ---------- Chaves ----------

async function copiar(texto, saida) {
  try {
    await navigator.clipboard.writeText(texto);
    mensagem(saida, 'Copiado.');
  } catch {
    mensagem(saida, 'Não foi possível copiar: selecione e copie manualmente.', false);
  }
}

$('copiar-mural').addEventListener('click', () => copiar($('link-mural').textContent, $('res-mural')));
$('nova-chave-mural').addEventListener('click', async () => {
  if (!await confirmar('Gerar nova chave do mural?', 'O link atual da TV deixa de funcionar. Depois, abra o novo link na TV.', 'Gerar nova')) return;
  await api('POST', '/api/admin/chave', { tipo: 'mural' });
  await carregar();
  mensagem($('res-mural'), 'Nova chave gerada. Atualize o link na TV.');
});
$('desativar-chave-mural').addEventListener('click', async () => {
  if (!await confirmar('Deixar o mural aberto?', 'Qualquer pessoa com o endereço verá os recados e os motivos de oração públicos.', 'Deixar aberto')) return;
  await api('POST', '/api/admin/chave', { tipo: 'mural-desativar' });
  await carregar();
  mensagem($('res-mural'), 'Mural aberto, sem chave.');
});

$('mostrar-chave-agente').addEventListener('click', () => {
  chaveAgenteVisivel = !chaveAgenteVisivel;
  preencher();
});
$('copiar-chave-agente').addEventListener('click', () => copiar(cfg.chaveAgente || '', $('res-agente')));
$('nova-chave-agente').addEventListener('click', async () => {
  if (!await confirmar('Gerar nova chave do agente?', 'O agente do PC da igreja é desconectado agora e só volta depois que a chave nova for colocada no agente.json.', 'Gerar nova')) return;
  await api('POST', '/api/admin/chave', { tipo: 'agente' });
  chaveAgenteVisivel = true;
  await carregar();
  mensagem($('res-agente'), 'Nova chave gerada. Copie e atualize o agente.json no PC da igreja.');
});

// ---------- Backup ----------

$('form-backup').addEventListener('submit', (e) => {
  e.preventDefault();
  salvar({ horaBackup: valor('horaBackup'), backupsManter: numero('backupsManter') }, $('res-backup'));
});

$('baixar-agora').addEventListener('click', async () => {
  try {
    mensagem($('res-backup'), 'Gerando…');
    await baixarArquivo('/api/backups/agora/download', 'diako-backup.zip');
    mensagem($('res-backup'), 'Backup baixado.');
  } catch (err) {
    mensagem($('res-backup'), err.message, false);
  }
});

$('gravar-agora').addEventListener('click', async () => {
  try {
    const r = await api('POST', '/api/backup');
    mensagem($('res-backup'), 'Gravado: ' + r.nome);
    await carregarBackups();
  } catch (err) {
    mensagem($('res-backup'), err.message, false);
  }
});

async function carregarBackups() {
  const r = await api('GET', '/api/backups');
  const linhas = r.backups.map((b) => el('tr', {},
    el('td', {}, el('div', { style: 'font-weight:500' }, b.nome), el('div', { class: 'dica' }, dataCurta(b.criado))),
    el('td', {}, tamanhoLegivel(b.tamanho)),
    el('td', { class: 'acoes-tabela' },
      botao('Baixar', () => baixarArquivo('/api/backups/' + encodeURIComponent(b.nome) + '/download', b.nome)
        .catch((err) => mensagem($('res-backup'), err.message, false))),
      botao('Restaurar', () => restaurarDaLista(b.nome)),
      botao('Excluir', async () => {
        if (!await confirmar('Excluir backup?', b.nome, 'Excluir')) return;
        await api('DELETE', '/api/backups/' + encodeURIComponent(b.nome));
        await carregarBackups();
      }, 'perigo pequeno'))));
  $('lista-backups').replaceChildren(...(linhas.length ? linhas : [el('tr', {}, el('td', { colspan: '3', class: 'dica' }, 'Nenhum backup ainda.'))]));
  $('copia-pc-backup').hidden = !r.modoAgente;
  $('copia-pc-backup').textContent = 'Cópia no PC da igreja (feita pelo agente): ' +
    (r.copiaPc ? 'última em ' + dataCurta(r.copiaPc) : 'ainda não feita') + '.';
  $('alertas-backup').replaceChildren(...(r.alertas || []).map((a) => el('p', { class: 'erro', role: 'alert' }, a)));
  const definida = r.senhaDefinidaEm !== null && r.senhaDefinidaEm !== undefined;
  $('estado-senha-backup').textContent = definida
    ? 'Senha definida' + (r.senhaDefinidaEm ? ' em ' + dataCurta(r.senhaDefinidaEm) : '') + '. Trocar a senha vale para as próximas cópias; as que já estão no PC continuam com a senha anterior.'
    : 'Nenhuma senha definida: a cópia no PC da igreja está desligada.';
  $('remover-senha-backup').hidden = !definida;
}

$('form-senha-backup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saida = $('res-senha-backup');
  if ($('senha-backup').value !== $('senha-backup2').value) {
    mensagem(saida, 'As duas senhas não conferem.', false);
    return;
  }
  // Proteger a senha leva alguns segundos: um clique só.
  const botaoDefinir = e.submitter || $('form-senha-backup').querySelector('button:not([type])');
  botaoDefinir.disabled = true;
  mensagem(saida, 'Definindo… (leva alguns segundos)');
  try {
    await api('PUT', '/api/backup/senha', { senha: $('senha-backup').value });
    $('form-senha-backup').reset();
    mensagem(saida, 'Senha definida. Anote em lugar seguro. O agente começa a copiar em instantes.');
    await carregarBackups();
  } catch (err) {
    mensagem(saida, err.message, false);
  } finally {
    botaoDefinir.disabled = false;
  }
});

$('remover-senha-backup').addEventListener('click', async () => {
  if (!await confirmar('Remover a senha do backup?', 'A cópia no PC da igreja será desligada. As cópias que já estão lá continuam cifradas com a senha atual.', 'Remover')) return;
  try {
    await api('DELETE', '/api/backup/senha');
    mensagem($('res-senha-backup'), 'Senha removida. A cópia no PC está desligada.');
    await carregarBackups();
  } catch (err) {
    mensagem($('res-senha-backup'), err.message, false);
  }
});

$('arquivo-restaurar').addEventListener('change', () => {
  const arquivo = $('arquivo-restaurar').files[0];
  $('campo-senha-restaurar').hidden = !(arquivo && arquivo.name.endsWith('.cifrado'));
});

function descreverRestauracao(r) {
  const c = r.colecoes || {};
  return `Restaurado: ${c.recados ?? 0} recado(s), ${c.motivos ?? 0} motivo(s), ${c.membros ?? 0} membro(s), ` +
    `${r.cartazes} cartaz(es)${r.configuracoes ? ' e configurações' : ''}. Backup de segurança: ${r.backupSeguranca}.`;
}

const avisoRestaurar = 'Os recados, motivos de oração, aniversariantes, histórico e cartazes atuais serão substituídos pelos do backup. ' +
  'Antes, um backup de segurança do estado atual é gravado no servidor.';

async function restaurarDaLista(nome) {
  if (!await confirmar('Restaurar ' + nome + '?', avisoRestaurar, 'Restaurar')) return;
  const saida = $('res-restaurar');
  try {
    mensagem(saida, 'Restaurando…');
    const r = await api('POST', '/api/backups/' + encodeURIComponent(nome) + '/restaurar', { configuracoes: $('restaurar-config').checked });
    mensagem(saida, descreverRestauracao(r));
    await carregar();
  } catch (err) {
    mensagem(saida, err.message, false);
  }
  saida.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('restaurar-arquivo').addEventListener('click', async () => {
  const saida = $('res-restaurar');
  const arquivo = $('arquivo-restaurar').files[0];
  if (!arquivo) {
    mensagem(saida, 'Escolha o arquivo .zip do backup.', false);
    return;
  }
  const cifrado = arquivo.name.endsWith('.cifrado');
  if (cifrado && !$('senha-restaurar').value) {
    mensagem(saida, 'Digite a senha do backup para abrir a cópia cifrada.', false);
    return;
  }
  if (!await confirmar('Restaurar ' + arquivo.name + '?', avisoRestaurar, 'Restaurar')) return;
  try {
    mensagem(saida, 'Enviando e restaurando…');
    const q = $('restaurar-config').checked ? '?configuracoes=1' : '';
    // A senha vai no cabeçalho, nunca na URL.
    const cabecalhos = cifrado ? { 'X-Senha-Backup': $('senha-restaurar').value } : {};
    const r = await api('POST', '/api/backups/restaurar' + q, arquivo, { bruto: true, tipo: 'application/zip', cabecalhos });
    mensagem(saida, descreverRestauracao(r));
    $('arquivo-restaurar').value = '';
    $('senha-restaurar').value = '';
    $('campo-senha-restaurar').hidden = true;
    await carregar();
  } catch (err) {
    mensagem(saida, err.message, false);
  }
});

// ---------- Senha e sessões ----------

$('form-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saida = $('res-senha');
  if ($('senhaNova').value !== $('senhaConfirma').value) {
    mensagem(saida, 'A nova senha e a confirmação não são iguais.', false);
    return;
  }
  try {
    const r = await api('POST', '/api/admin/senha', {
      atual: $('senhaAtual').value,
      nova: $('senhaNova').value,
      encerrarSessoes: $('encerrarSessoes').checked,
    });
    e.target.reset();
    mensagem(saida, 'Senha trocada.' + (r.sessoesEncerradas ? ` ${r.sessoesEncerradas} aparelho(s) desconectado(s).` : ''));
    await carregar();
  } catch (err) {
    mensagem(saida, err.message, false);
  }
});

$('encerrar-sessoes').addEventListener('click', async () => {
  if (!await confirmar('Desconectar os outros aparelhos?', 'O tablet e outros navegadores precisarão entrar de novo com a senha.', 'Desconectar')) return;
  const r = await api('POST', '/api/admin/sessoes/encerrar');
  mensagem($('res-sessoes'), r.sessoesEncerradas + ' aparelho(s) desconectado(s).');
  await carregar();
});

// ---------- Início ----------

async function iniciar() {
  let eu;
  try {
    // Senha temporária: a pessoa cria a própria antes de continuar.
    eu = await PrimeiroAcesso.garantir({ token, buscarEu: () => api('GET', '/api/eu'), aoSair: sair });
  } catch {
    return; // sessão expirada: api() já voltou para o login
  }
  $('login').hidden = true;
  $('app').hidden = false;
  const admin = eu.permissoes.includes('admin');
  $('layout-admin').hidden = !admin;
  $('sem-acesso').hidden = admin;
  if (!admin) {
    $('texto-sem-acesso').textContent = `Você entrou como ${eu.nome} (${eu.perfilNome}). Só o perfil Administrador mexe nas configurações.`;
    return;
  }
  try {
    await carregar();
    await carregarUsuarios();
  } catch (err) {
    if (token) mensagem($('res-igreja'), 'Não foi possível carregar as configurações: ' + err.message, false);
  }
}

// ---------- Usuários ----------

let perfis = [];
let catalogo = [];

async function carregarUsuarios() {
  const r = await api('GET', '/api/admin/usuarios');
  perfis = r.perfis;
  catalogo = r.permissoes;
  const escolhido = $('u-perfil').value || 'secretaria';
  $('u-perfil').replaceChildren(...perfis.map((p) => el('option', { value: p.id }, p.nome)));
  $('u-perfil').value = perfis.some((p) => p.id === escolhido) ? escolhido : perfis[0]?.id || '';
  mostrarDicaPerfil();
  $('tabela-usuarios').tBodies[0].replaceChildren(...(r.usuarios.length
    ? r.usuarios.map(linhaUsuario)
    : [el('tr', {}, el('td', { colspan: 5, class: 'dica' }, 'Ninguém cadastrado ainda. Hoje só a conta principal entra.'))]));
  await carregarPerfis();
  await carregarTablets();
}

async function carregarTablets() {
  const r = await api('GET', '/api/admin/tablets-locais');
  $('bloco-tablets').hidden = !r.modoAgente;
  $('tabela-tablets').tBodies[0].replaceChildren(...(r.tablets.length
    ? r.tablets.map((t) => el('tr', { style: t.ativo ? '' : 'opacity:.55' },
      el('td', {}, t.aparelho),
      el('td', {}, t.conta, t.ativo ? null : el('span', { class: 'dica' }, ' (sem acesso: conta desativada ou sem "Projetar")')),
      el('td', { class: 'dica' }, dataCurta(t.criadoEm)),
      el('td', { class: 'acoes-tabela' }, botao('Remover', async () => {
        if (!await confirmar('Remover tablet?', `${t.aparelho} deixa de falar direto com o PC da igreja e passa a usar só a internet.`, 'Remover')) return;
        await api('DELETE', '/api/admin/tablets-locais/' + t.id);
        mensagem($('res-tablets'), 'Tablet removido.');
        await carregarTablets();
      }, 'perigo pequeno'))))
    : [el('tr', {}, el('td', { colspan: 4, class: 'dica' }, 'Nenhum tablet pareado.'))]));
}

function mostrarDicaPerfil() {
  const p = perfis.find((x) => x.id === $('u-perfil').value);
  $('u-perfil-dica').textContent = p ? p.descricao : '';
}
$('u-perfil').addEventListener('change', mostrarDicaPerfil);

/** "aguardando primeiro acesso" ou "senha temporária vencida" (quem ainda não criou a própria senha). */
function estadoSenha(u) {
  if (!u.trocarSenha) return null;
  return el('span', { class: 'estado-senha' },
    u.senhaTemporariaVencida ? 'Senha temporária vencida: gere uma nova' : 'Aguardando primeiro acesso');
}

function linhaUsuario(u) {
  const saida = $('res-usuario');
  const seletor = el('select', { 'aria-label': 'Perfil de ' + u.nome },
    perfis.map((p) => el('option', { value: p.id, selected: p.id === u.perfil }, p.nome)),
    perfis.some((p) => p.id === u.perfil) ? null : el('option', { value: u.perfil, selected: true, disabled: true }, 'Sem perfil (excluído)'));
  seletor.addEventListener('change', async () => {
    try {
      await api('PUT', '/api/admin/usuarios/' + u.id, { perfil: seletor.value });
      mensagem(saida, `${u.nome} agora tem o perfil ${seletor.selectedOptions[0].textContent} e precisa entrar de novo.`);
      await carregarUsuarios();
    } catch (err) {
      mensagem(saida, err.message, false);
    }
  });
  const acoes = el('td', { class: 'acoes-tabela' },
    botao('Nova senha e enviar', async () => {
      if (!await confirmar('Gerar nova senha?', `${u.nome} sai de todos os aparelhos, entra com a senha temporária e cria uma nova no primeiro acesso.`, 'Gerar')) return;
      const r = await api('POST', `/api/admin/usuarios/${u.id}/senha`);
      mostrarSenhaGerada(u.nome, u.login, r);
      await carregarUsuarios();
    }),
    botao(u.ativo ? 'Desativar' : 'Reativar', async () => {
      await api('PUT', '/api/admin/usuarios/' + u.id, { ativo: !u.ativo });
      await carregarUsuarios();
    }),
    botao('Excluir', async () => {
      const escala = u.membroId ? ' Como a conta está ligada a um membro, a pessoa também sai de todas as escalas (inclusive cultos passados) e as indisponibilidades dela são apagadas; o cadastro de membro continua.' : '';
      if (!await confirmar('Excluir usuário?', `${u.nome} perde o acesso. O histórico do que foi feito com esse usuário continua registrado.${escala}`, 'Excluir')) return;
      await api('DELETE', '/api/admin/usuarios/' + u.id);
      await carregarUsuarios();
    }, 'perigo pequeno'));
  return el('tr', { style: u.ativo ? '' : 'opacity:.55' },
    el('td', {}, u.nome, u.ativo ? null : el('span', { class: 'dica' }, ' (desativado)'), estadoSenha(u)),
    el('td', {}, el('code', {}, u.login)),
    el('td', {}, seletor),
    el('td', { class: 'dica' }, u.ultimoAcesso ? dataCurta(u.ultimoAcesso) : 'nunca'),
    acoes);
}

/** Senha temporária com a prévia do texto para o WhatsApp (cartaoEntregaAcesso, em comum.js). */
function mostrarSenhaGerada(nome, login, r) {
  const caixa = $('senha-gerada');
  caixa.replaceChildren(cartaoEntregaAcesso(nome, login, r));
  caixa.hidden = false;
  caixa.scrollIntoView({ block: 'nearest' });
}

$('form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saida = $('res-usuario');
  try {
    const r = await api('POST', '/api/admin/usuarios', { nome: valor('u-nome'), login: valor('u-login'), perfil: $('u-perfil').value });
    $('u-nome').value = '';
    $('u-login').value = '';
    mensagem(saida, 'Pessoa adicionada.');
    mostrarSenhaGerada(r.usuario.nome, r.usuario.login, r);
    await carregarUsuarios();
  } catch (err) {
    mensagem(saida, err.message, false);
  }
});

// ---------- Perfis ----------

/** Permissões que [id] traz junto (catálogo do servidor: "implica"). */
function implicadas(id) {
  const vistas = new Set();
  const fila = [...(catalogo.find((c) => c.id === id)?.implica || [])];
  while (fila.length) {
    const p = fila.pop();
    if (vistas.has(p)) continue;
    vistas.add(p);
    fila.push(...(catalogo.find((c) => c.id === p)?.implica || []));
  }
  return vistas;
}

/** O conjunto marcado mais o que ele implica. */
function completar(marcadas) {
  const r = new Set(marcadas);
  for (const p of marcadas) for (const q of implicadas(p)) r.add(q);
  return r;
}

/** Só as escolhas de fato (tira as que já vêm incluídas por outra marcada). */
function explicitas(permissoes) {
  const conjunto = new Set(permissoes.filter((p) => p !== 'sessao'));
  return new Set([...conjunto].filter((p) => ![...conjunto].some((q) => q !== p && implicadas(q).has(p))));
}

async function carregarPerfis() {
  const r = await api('GET', '/api/admin/perfis');
  perfis = r.perfis;
  catalogo = r.permissoes;
  $('lista-perfis').replaceChildren(...perfis.map(cartaoPerfil));
  const excluidos = r.padroesExcluidos || [];
  $('padroes-excluidos').hidden = !excluidos.length;
  $('padroes-excluidos').replaceChildren(
    el('span', { class: 'dica' }, 'Perfis padrão excluídos:'),
    ...excluidos.map((d) => botao('Trazer de volta: ' + d.nome, async () => {
      await api('POST', `/api/admin/perfis/${encodeURIComponent(d.id)}/restaurar`);
      mensagem($('res-perfis'), `Perfil ${d.nome} de volta.`);
      await carregarUsuarios();
    })));
  montarMatriz();
}

function cartaoPerfil(p) {
  const qtd = p.usuarios || 0;
  const n = p.permissoes.filter((x) => x !== 'sessao').length;
  const excluir = botao('Excluir', async () => {
    if (!await confirmar('Excluir perfil?', `O perfil ${p.nome} deixa de existir.${p.padrao ? ' Por ser um perfil padrão, dá para trazer de volta depois.' : ''}`, 'Excluir')) return;
    try {
      await api('DELETE', '/api/admin/perfis/' + encodeURIComponent(p.id));
      mensagem($('res-perfis'), `Perfil ${p.nome} excluído.`);
      await carregarUsuarios();
    } catch (err) {
      mensagem($('res-perfis'), err.message, false);
    }
  }, 'perigo pequeno');
  if (qtd > 0) {
    excluir.disabled = true;
    excluir.title = 'Troque o perfil de quem usa antes de excluir.';
  }
  return el('article', { class: 'perfil' },
    el('div', { class: 'perfil-topo' }, el('strong', {}, p.nome),
      p.travado ? el('span', { class: 'selo', title: 'Não pode ser alterado nem excluído' }, '🔒 Travado') : null),
    el('div', { class: 'selos' },
      p.padrao ? el('span', { class: 'selo' }, 'Padrão') : el('span', { class: 'selo proprio' }, 'Criado pela igreja'),
      p.alterado ? el('span', { class: 'selo alterado' }, 'Alterado') : null),
    p.descricao ? el('p', {}, p.descricao) : null,
    el('p', { class: 'perfil-usuarios' },
      `${qtd === 0 ? 'Ninguém usa' : qtd === 1 ? '1 pessoa usa' : qtd + ' pessoas usam'} · ${n} ${n === 1 ? 'permissão' : 'permissões'}`,
      p.entrada && p.entrada !== '/painel' ? ` · entra em ${p.entrada}` : ''),
    el('div', { class: 'acoes' },
      botao(p.travado ? 'Ver' : 'Editar', () => editarPerfil(p)),
      botao('Duplicar', () => editarPerfil(null, p)),
      p.alterado ? botao('Restaurar padrão', async () => {
        if (!await confirmar('Restaurar padrão?', `O perfil ${p.nome} volta ao nome e às permissões de fábrica. Vale na hora para ${qtd === 1 ? 'a pessoa que usa' : 'quem usa'}.`, 'Restaurar')) return;
        await api('POST', `/api/admin/perfis/${encodeURIComponent(p.id)}/restaurar`);
        mensagem($('res-perfis'), `Perfil ${p.nome} restaurado.`);
        await carregarUsuarios();
      }) : null,
      p.travado ? null : excluir));
}

/** Editor: [perfil] para editar, ou null para criar (a partir de [base], se houver). */
let marcadas = new Set();
let perfilEditado = null;
let somenteLeitura = false;

function editarPerfil(perfil, base = null) {
  perfilEditado = perfil;
  somenteLeitura = !!perfil?.travado;
  $('titulo-perfil').textContent = perfil ? (somenteLeitura ? perfil.nome : 'Editar perfil') : 'Novo perfil';
  $('p-nome').value = perfil ? perfil.nome : base ? base.nome + ' (cópia)' : '';
  $('p-descricao').value = perfil ? perfil.descricao : base ? base.descricao : '';
  $('campo-base').hidden = !!perfil;
  $('p-base').replaceChildren(el('option', { value: '' }, 'Nenhum (começar do zero)'),
    ...perfis.map((x) => el('option', { value: x.id, selected: base?.id === x.id }, x.nome)));
  for (const id of ['p-nome', 'p-descricao']) $(id).disabled = somenteLeitura;
  $('salvar-perfil').hidden = somenteLeitura;
  $('cancelar-perfil').textContent = somenteLeitura ? 'Fechar' : 'Cancelar';
  marcadas = explicitas((perfil || base)?.permissoes || []);
  const qtd = perfil?.usuarios || 0;
  $('p-uso').textContent = somenteLeitura
    ? 'O Administrador tem tudo e não pode ser alterado.'
    : qtd ? `${qtd === 1 ? '1 pessoa usa' : qtd + ' pessoas usam'} este perfil: a mudança vale na hora.` : '';
  $('erro-perfil').hidden = true;
  desenharPermissoes();
  $('dlg-perfil').showModal();
  if (!somenteLeitura) $('p-nome').focus();
}

$('p-base').addEventListener('change', () => {
  const base = perfis.find((x) => x.id === $('p-base').value);
  marcadas = explicitas(base?.permissoes || []);
  if (base && !$('p-descricao').value) $('p-descricao').value = base.descricao;
  desenharPermissoes();
});

function desenharPermissoes() {
  const efetivas = completar(marcadas);
  const areas = [];
  for (const c of catalogo) if (!areas.some((a) => a.id === c.area)) areas.push({ id: c.area, nome: c.areaNome });
  $('p-permissoes').replaceChildren(...areas.map((a) => el('fieldset', {},
    el('legend', {}, a.nome),
    ...catalogo.filter((c) => c.area === a.id).map((c) => {
      const explicita = marcadas.has(c.id);
      const incluida = !explicita && efetivas.has(c.id);
      const por = incluida ? [...marcadas].filter((m) => implicadas(m).has(c.id))
        .map((m) => catalogo.find((x) => x.id === m)?.descricao).filter(Boolean) : [];
      const caixa = el('input', { type: 'checkbox', checked: explicita || incluida, disabled: somenteLeitura || incluida });
      caixa.addEventListener('change', () => {
        if (caixa.checked) marcadas.add(c.id);
        else {
          // Desmarcar não leva junto o que ela incluía: essas continuam marcadas (desmarque à parte).
          marcadas.delete(c.id);
          for (const p of implicadas(c.id)) marcadas.add(p);
        }
        desenharPermissoes();
      });
      return el('label', { class: 'marcar' }, caixa,
        el('span', {}, c.descricao,
          c.dica ? el('small', {}, c.dica) : null,
          incluida ? el('small', { class: 'incluida' }, 'Incluída por: ' + por.join('; ')) : null));
    }))));
}

$('cancelar-perfil').addEventListener('click', () => $('dlg-perfil').close());

$('form-perfil').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (somenteLeitura) return $('dlg-perfil').close();
  const erro = $('erro-perfil');
  erro.hidden = true;
  const corpo = { nome: valor('p-nome'), descricao: $('p-descricao').value.trim(), permissoes: [...completar(marcadas)] };
  $('salvar-perfil').disabled = true;
  try {
    if (perfilEditado) await api('PUT', '/api/admin/perfis/' + encodeURIComponent(perfilEditado.id), corpo);
    else await api('POST', '/api/admin/perfis', corpo);
    $('dlg-perfil').close();
    mensagem($('res-perfis'), perfilEditado ? `Perfil ${corpo.nome} salvo.` : `Perfil ${corpo.nome} criado. Escolha-o ao adicionar uma pessoa.`);
    await carregarUsuarios();
  } catch (err) {
    erro.textContent = err.message;
    erro.hidden = false;
  } finally {
    $('salvar-perfil').disabled = false;
  }
});

$('novo-perfil').addEventListener('click', () => editarPerfil(null));

function montarMatriz() {
  $('matriz-perfis').replaceChildren(
    el('thead', {}, el('tr', {}, el('th', {}, 'Pode'), perfis.map((p) => el('th', { style: 'text-align:center' }, p.nome)))),
    el('tbody', {}, catalogo.map((perm) => el('tr', {},
      el('td', {}, perm.descricao),
      perfis.map((p) => el('td', { style: 'text-align:center' }, p.permissoes.includes(perm.id)
        ? el('span', { 'aria-label': 'sim' }, '✓') : el('span', { 'aria-label': 'não', class: 'dica' }, '—')))))));
}

if (token) iniciar();
else sair();
