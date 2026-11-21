'use strict';

// Inerte na carga: identidade/permissões só existem após o painel autenticar.
const tiposEncontro = { culto: 'Culto', conferencia: 'Conferência', retiro: 'Retiro', acampamento: 'Acampamento', jantar: 'Jantar', palestra: 'Palestra', treinamento: 'Treinamento', encontro_familias: 'Encontro de famílias', outro: 'Outro' };
const estadosEncontro = { rascunho: 'Rascunho', aberto: 'Aberto', encerrado: 'Encerrado', cancelado: 'Cancelado' };
const estadosTarefaEncontro = { pendente: 'Pendente', concluida: 'Concluída', cancelada: 'Cancelada' };
const caminhoEncontro = id => '/api/encontros/' + encodeURIComponent(id);
const listaEncontros = (resposta, chave) => Array.isArray(resposta) ? resposta : resposta[chave] || [];

// Aba aberta dentro de Encontros ("encontros" ou "materiais") e ministérios do cadastro
// (sem Conselho, Diretoria e Assembleia, que são das atas).
let encontrosAba = 'encontros';
let encontrosIniciado = false;
let ministeriosEncontros = [];
let filtroMinisterioEncontros = '';

/** Chamado pelo painel antes de abrir a aba, por atalhos como "Materiais e roteiros ›". */
function definirSubAba(aba, sub) {
  if (aba === 'encontros' && ['encontros', 'materiais'].includes(sub)) encontrosAba = sub;
}

async function carregarMinisteriosEncontros() {
  try {
    const r = await api('GET', '/api/ministerios');
    ministeriosEncontros = listaEncontros(r, 'ministerios').filter(m => !m.fixo);
  } catch (_) { ministeriosEncontros = []; }
}

const nomeMinisterioEncontro = id => id ? (ministeriosEncontros.find(m => m.id === id)?.nome || 'Ministério removido') : 'Igreja toda';
const opcoesMinisterioEncontro = rotuloVazio => ({ '': rotuloVazio, ...Object.fromEntries(ministeriosEncontros.map(m => [m.id, m.nome])) });

function mostrarAbaEncontros(nome) {
  encontrosAba = nome;
  const abas = $('encontros-abas');
  for (const b of abas?.querySelectorAll?.('[data-encontros-aba]') || []) b.setAttribute('aria-selected', String(b.dataset.encontrosAba === nome));
  const lista = $('encontros-conteudo'), materiais = $('encontros-materiais');
  if (lista && materiais && lista !== materiais) { lista.hidden = nome !== 'encontros'; materiais.hidden = nome !== 'materiais'; }
}

/** "2026-12-05T19:30" → "05/12/2026 às 19:30"; "2026-12-05" → "05/12/2026". Lê o texto, sem fuso. */
function dataEncontro(iso) {
  if (!iso) return '';
  const [dia, hora] = String(iso).split('T');
  const data = dia.split('-').reverse().join('/');
  return hora ? `${data} às ${hora.slice(0, 5)}` : data;
}

/** Início e fim em uma linha: mesmo dia mostra só o horário final. */
function periodoEncontro(e) {
  if (!e.inicio) return 'Data a definir';
  if (!e.fim) return dataEncontro(e.inicio);
  const [diaInicio] = String(e.inicio).split('T');
  const [diaFim, horaFim] = String(e.fim).split('T');
  return diaInicio === diaFim && horaFim
    ? `${dataEncontro(e.inicio)}–${horaFim.slice(0, 5)}`
    : `${dataEncontro(e.inicio)} até ${dataEncontro(e.fim)}`;
}

function vagasEncontro(e) {
  const ocupadas = e.vagasOcupadas || 0;
  const pessoas = `${ocupadas} ${ocupadas === 1 ? 'participante' : 'participantes'}`;
  const base = e.vagasDisponiveis == null ? `${pessoas} · sem limite de vagas`
    : `${pessoas} · ${e.vagasDisponiveis} ${e.vagasDisponiveis === 1 ? 'vaga disponível' : 'vagas disponíveis'}`;
  return e.emEspera ? `${base} · ${e.emEspera} na lista de espera` : base;
}

const etiquetaEncontro = e => el('span', { class: `etiqueta ${e.estado === 'aberto' ? 'nova' : e.estado === 'cancelado' ? 'alerta' : ''}` },
  estadosEncontro[e.estado] || e.estado || '');

/** Diálogo do painel: título, área com rolagem, mensagem de erro e botões no rodapé. */
function janelaEncontro(titulo, salvar, { textoSalvar = 'Salvar', textoFechar } = {}) {
  const erro = el('p', { role: 'alert' });
  const conteudo = el('div', { class: 'dialogo-rolagem' });
  const fechar = botao(textoFechar || (salvar ? 'Cancelar' : 'Fechar'), () => dlg.close(), 'secundario');
  const enviar = el('button', { type: 'submit', class: 'botao' }, textoSalvar);
  const form = el('form', {}, el('h2', {}, titulo), conteudo, erro,
    el('div', { class: 'dialogo-acoes' }, fechar, salvar ? enviar : null));
  const dlg = el('dialog', { class: 'dialogo-largo', 'aria-label': titulo }, form);
  let ocupado = false;
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (!salvar || ocupado || !form.reportValidity()) return;
    ocupado = true; enviar.disabled = true; fechar.disabled = true;
    try { await salvar(); dlg.close(); }
    catch (e) { mensagem(erro, e.message, false); }
    finally { ocupado = false; enviar.disabled = false; fechar.disabled = false; }
  });
  dlg.addEventListener('cancel', evento => { if (ocupado) evento.preventDefault(); });
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  document.body.append(dlg); dlg.showModal();
  return { dlg, conteudo, erro };
}

function campoEncontro(alvo, rotulo, valor = '', { tipo = 'text', opcoes, obrigatorio = false, limite = 300, largo = false } = {}) {
  const input = el(opcoes ? 'select' : tipo === 'textarea' ? 'textarea' : 'input', {
    type: opcoes || tipo === 'textarea' ? null : tipo,
    required: obrigatorio, maxlength: limite, rows: tipo === 'textarea' ? 4 : null,
  });
  if (opcoes) for (const [id, nome] of Object.entries(opcoes)) input.append(el('option', { value: id }, nome));
  input.value = valor ?? '';
  alvo.append(el('label', { class: largo ? 'largo' : null }, rotulo, input));
  return input;
}

function cartaoEncontro(e) {
  return el('article', { class: 'item' },
    el('div', { class: 'conteudo' },
      el('div', { class: 'titulo' }, e.titulo || 'Encontro', ' ', etiquetaEncontro(e),
        ...(e.linkInscricao?.ativo && e.estado === 'aberto' ? [' ', el('span', { class: 'etiqueta' }, 'Inscrições pelo link')] : [])),
      el('p', { class: 'sub' }, `${nomeMinisterioEncontro(e.ministerioId)} · ${tiposEncontro[e.tipo] || 'Encontro'} · ${periodoEncontro(e)} · ${e.local || 'Local a definir'}`),
      el('p', { class: 'sub' }, vagasEncontro(e))),
    el('div', { class: 'acoes' }, botao('Ver encontro', () => detalheEncontro(e.id))));
}

async function carregarEncontros() {
  const alvo = $('encontros-conteudo');
  if (!alvo) return;
  const abas = $('encontros-abas');
  if (!encontrosIniciado && abas && abas !== alvo && abas.querySelectorAll) {
    encontrosIniciado = true;
    abas.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-encontros-aba]');
      if (b && b.dataset.encontrosAba !== encontrosAba) { mostrarAbaEncontros(b.dataset.encontrosAba); carregarEncontros(); }
    });
  }
  encontroAberto = null;
  mostrarAbaEncontros(encontrosAba);
  try {
    await carregarMinisteriosEncontros();
    if (encontrosAba === 'materiais') {
      if (typeof carregarMateriais === 'function') await carregarMateriais();
      return;
    }
    const todos = listaEncontros(await api('GET', '/api/encontros'), 'encontros');
    // Filtro por ministério: "" = todos, "igreja" = sem ministério, ou o id do ministério.
    const encontros = todos.filter(e => !filtroMinisterioEncontros ||
      (filtroMinisterioEncontros === 'igreja' ? !e.ministerioId : e.ministerioId === filtroMinisterioEncontros));
    const agora = new Date();
    const proximos = encontros.filter(e => ['rascunho', 'aberto'].includes(e.estado) && new Date(e.inicio) >= agora);
    const anteriores = encontros.filter(e => !proximos.includes(e)).reverse();
    const tarefas = el('div', { class: 'lista' });
    const filtro = el('select', { 'aria-label': 'Filtrar por ministério' },
      ...Object.entries({ '': 'Todos os ministérios', igreja: 'Igreja toda', ...Object.fromEntries(ministeriosEncontros.map(m => [m.id, m.nome])) })
        .map(([v, t]) => el('option', { value: v }, t)));
    filtro.value = filtroMinisterioEncontros;
    filtro.addEventListener('change', () => { filtroMinisterioEncontros = filtro.value; return carregarEncontros(); });
    alvo.replaceChildren(...[
      el('div', { class: 'barra' }, pode('encontros') ? botao('Criar encontro', () => formularioEncontro(), 'pequeno') : null,
        el('span', { class: 'espaco' }), ministeriosEncontros.length ? filtro : null),
      el('h2', {}, 'Próximos encontros'),
      el('div', { class: 'lista' }, ...(proximos.length ? proximos.map(cartaoEncontro)
        : [el('p', { class: 'vazio' }, encontros.length ? 'Nenhum encontro futuro em rascunho ou aberto.'
          : todos.length ? 'Nenhum encontro deste ministério.' : 'Nenhum encontro cadastrado.')])),
      el('h2', {}, 'Tarefas pendentes'),
      tarefas,
      anteriores.length ? el('h2', {}, 'Anteriores, encerrados e cancelados') : null,
      anteriores.length ? el('div', { class: 'lista' }, ...anteriores.map(cartaoEncontro)) : null,
    ].filter(Boolean));
    await tarefasPendentesEncontros(tarefas, encontros);
  } catch (e) { mensagem(encontrosAba === 'materiais' ? $('encontros-materiais') || alvo : alvo, e.message, false); }
}

async function tarefasPendentesEncontros(alvo, encontros) {
  // Uma única consulta com as pendentes de todos os encontros, inclusive antigos e
  // cancelados: não esconder pendências.
  const agora = new Date();
  const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  let tarefas = [];
  if (encontros.length) try {
    const porId = new Map(encontros.map(e => [e.id, e]));
    tarefas = listaEncontros(await api('GET', '/api/encontros/tarefas'), 'tarefas')
      .filter(t => t.estado === 'pendente' && porId.has(t.encontroId))
      .map(t => ({ ...t, encontro: porId.get(t.encontroId) }));
  } catch (_) {
    alvo.replaceChildren(el('p', { role: 'alert', class: 'erro' }, 'Não foi possível consultar as tarefas. Reabra a área para tentar novamente.'));
    return;
  }
  tarefas.sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999'));
  alvo.replaceChildren(...(tarefas.length ? tarefas.map(t => el('div', { class: 'item' },
    el('div', { class: 'conteudo' },
      el('div', { class: 'titulo' }, t.descricao, ...(t.prazo && t.prazo < hoje ? [' ', el('span', { class: 'etiqueta alerta' }, 'Vencida')] : [])),
      el('p', { class: 'sub' }, [t.prazo ? `Prazo ${dataEncontro(t.prazo)}` : 'Sem prazo', t.encontro.titulo, t.responsavelNome].filter(Boolean).join(' · '))),
    el('div', { class: 'acoes' }, botao('Ver tarefa no encontro', () => detalheEncontro(t.encontro.id, 'tarefas')))))
    : [el('p', { class: 'vazio' }, 'Nenhuma tarefa pendente.')]));
}

function roteiroUtilizadoEncontro(alvo, encontro) {
  const roteiro = Array.isArray(encontro.roteiro) ? encontro.roteiro : [];
  alvo.append(el('h3', {}, 'Roteiro utilizado'));
  if (!roteiro.length) { alvo.append(el('p', { class: 'dica' }, pode('encontros') && encontro.estado !== 'cancelado' ? 'Nenhum material no roteiro. Use "Montar roteiro" para escolher materiais da biblioteca.' : 'Nenhum material no roteiro.')); return; }
  const textos = roteiro.map(item => {
    const snapshot = item.conteudoSnapshot || {};
    if (typeof textoMaterial === 'function') return textoMaterial(snapshot);
    // Fallback de leitura quando a biblioteca ainda não está carregada.
    return [snapshot.titulo, snapshot.objetivo, snapshot.duracaoMinutos ? `Duração: ${snapshot.duracaoMinutos} minutos` : '',
      snapshot.referenciasBiblicas, snapshot.preparacao, snapshot.passos, snapshot.perguntas].filter(Boolean).join('\n\n');
  });
  const status = el('p', { role: 'status' });
  alvo.append(el('div', { class: 'barra' }, botao('Copiar roteiro utilizado', async () => {
    try { await navigator.clipboard.writeText(textos.join('\n\n')); mensagem(status, 'Roteiro copiado. Nenhum dado de participantes foi incluído.'); }
    catch (_) { mensagem(status, 'Não foi possível copiar. Selecione o texto do roteiro e copie manualmente.', false); }
  })), status);
  roteiro.forEach((item, indice) => alvo.append(el('article', { class: 'item encontro-bloco' },
    el('div', { class: 'titulo' }, `${indice + 1}. ${item.conteudoSnapshot?.titulo || 'Material'}`, ' ', el('span', { class: 'etiqueta' }, `versão ${item.versao}`)),
    el('pre', { class: 'encontro-texto' }, textos[indice]))));
}

function formularioEncontro(atual, atualizar = carregarEncontros) {
  const campos = {};
  const { conteudo } = janelaEncontro(atual ? 'Editar encontro' : 'Criar encontro', async () => {
    const corpo = Object.fromEntries(Object.entries(campos).map(([chave, input]) => [chave, input.value]));
    corpo.capacidade = corpo.capacidade === '' ? null : Number(corpo.capacidade);
    corpo.ministerioId = corpo.ministerioId || null;
    await api(atual ? 'PUT' : 'POST', atual ? caminhoEncontro(atual.id) : '/api/encontros', corpo);
    await atualizar();
  });
  const grade = el('div', { class: 'grade-form' });
  conteudo.append(grade);
  const adicionar = (chave, rotulo, opcoes = {}) => { campos[chave] = campoEncontro(grade, rotulo, atual?.[chave] ?? '', opcoes); };
  adicionar('titulo', 'Título', { obrigatorio: true, limite: 160, largo: true });
  adicionar('ministerioId', 'Ministério responsável', { opcoes: opcoesMinisterioEncontro('Igreja toda') });
  adicionar('tipo', 'Tipo', { opcoes: tiposEncontro }); if (!atual) campos.tipo.value = 'jantar';
  adicionar('estado', 'Situação', { opcoes: estadosEncontro }); if (!atual) campos.estado.value = 'rascunho';
  adicionar('inicio', 'Início', { tipo: 'datetime-local', obrigatorio: true });
  adicionar('fim', 'Fim', { tipo: 'datetime-local', obrigatorio: true });
  adicionar('local', 'Local');
  adicionar('capacidade', 'Vagas (todas as pessoas, inclusive crianças)', { tipo: 'number' }); campos.capacidade.min = '1'; campos.capacidade.max = '100000';
  adicionar('descricao', 'Descrição', { tipo: 'textarea', limite: 3000, largo: true });
  grade.append(el('p', { class: 'dica largo' }, 'Inscrições só são aceitas com a situação "Aberto". Deixe as vagas em branco para não limitar.'));
}

function confirmarEncontro(titulo, texto, executar) {
  const { conteudo } = janelaEncontro(titulo, executar, { textoSalvar: 'Confirmar', textoFechar: 'Voltar' });
  conteudo.append(el('p', {}, texto));
}

function textoConviteEncontro(encontro) {
  return [`Convite: ${encontro.titulo || 'Encontro'}`,
    periodoEncontro(encontro), encontro.local || 'Local a confirmar',
    encontro.descricao || '', 'Confirme sua participação com a liderança do ministério.'].filter(Boolean).join('\n\n');
}

function prepararConviteEncontro(encontro) {
  const janela = janelaEncontro('Prévia do convite');
  const texto = el('textarea', { rows: 9, maxlength: 10000, 'aria-label': 'Texto do convite', class: 'encontro-campo-largo' });
  texto.value = textoConviteEncontro(encontro);
  const compartilhar = el('a', { class: 'botao secundario pequeno', target: '_blank', rel: 'noopener noreferrer' }, 'Abrir no WhatsApp');
  const atualizar = () => { compartilhar.href = 'https://wa.me/?text=' + encodeURIComponent(texto.value); };
  texto.addEventListener('input', atualizar); atualizar();
  janela.conteudo.append(el('p', { class: 'dica' }, 'Confira o convite. Copiar ou abrir WhatsApp não envia, não confirma presença e não registra contato.'),
    texto, el('div', { class: 'barra' }, botao('Copiar convite', async () => {
      try { await navigator.clipboard.writeText(texto.value); mensagem(janela.erro, 'Convite copiado. Envio depende de ação humana.'); }
      catch (_) { mensagem(janela.erro, 'Não foi possível copiar. Selecione o texto para copiar.', false); }
    }), compartilhar));
}

// Encontro aberto em página própria, no lugar da lista: id, aba atual e filtros
// da aba Inscritos (mantidos ao salvar algo e recarregar o mesmo encontro).
let encontroAberto = null;

const abasEncontro = { inscritos: 'Inscritos', checkin: 'Check-in', divulgar: 'Divulgar', tarefas: 'Tarefas', roteiro: 'Roteiro' };
const filtrosInscricao = {
  todas: ['Todas', i => i.estado !== 'cancelada'],
  confirmada: ['Confirmadas', i => i.estado === 'confirmada'],
  espera: ['Lista de espera', i => i.estado === 'espera'],
  link: ['Pelo link', i => i.origem === 'link' && i.estado !== 'cancelada'],
  semcadastro: ['Sem cadastro', i => i.origem === 'link' && !i.responsavelMembroId && i.estado !== 'cancelada'],
  cancelada: ['Canceladas', i => i.estado === 'cancelada'],
};

const nomeParticipanteEncontro = p => p.nome || p.nomeAcompanhante || 'Membro removido';
function nomeInscricaoEncontro(i) {
  const responsavel = (i.participantes || []).find(p => p.membroId && p.membroId === i.responsavelMembroId);
  return responsavel?.nome || i.responsavelNome || 'pessoa removida';
}
/** Minúsculas sem acento, para a busca achar "joao" em "João". */
const normalizarEncontro = texto => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Abre o encontro como página, na aba pedida (ou na última aberta do mesmo encontro). */
async function detalheEncontro(id, aba) {
  const alvo = $('encontros-conteudo');
  if (!alvo) return;
  // Só volta ao topo ao abrir outro encontro ou trocar de aba, não ao recarregar o mesmo.
  const rolar = encontroAberto?.id !== id || !!aba;
  if (encontroAberto?.id !== id) encontroAberto = { id, aba: 'inscritos', filtro: 'todas', busca: '', buscaCheckin: '', abertas: new Set() };
  if (aba && abasEncontro[aba]) encontroAberto.aba = aba;
  mostrarAbaEncontros('encontros');
  const voltar = el('button', { type: 'button', class: 'encontro-voltar', onclick: () => { encontroAberto = null; return carregarEncontros(); } }, '‹ Encontros');
  try {
    const [e, respostaI, respostaT] = await Promise.all([
      api('GET', caminhoEncontro(id)), api('GET', caminhoEncontro(id) + '/inscricoes'), api('GET', caminhoEncontro(id) + '/tarefas'),
    ]);
    if (encontroAberto?.id !== id) return; // voltou para a lista enquanto carregava
    paginaEncontro(alvo, voltar, e, listaEncontros(respostaI, 'inscricoes'), listaEncontros(respostaT, 'tarefas'));
    if (rolar) globalThis.scrollTo?.(0, 0);
  } catch (erro) { alvo.replaceChildren(voltar, el('p', { role: 'alert', class: 'erro' }, erro.message)); }
}

/**
 * Tempo real: com um encontro aberto, recarrega a página dele (mesma aba, filtros e
 * foco da busca) em vez de voltar à lista. No dia, dois tablets fazem check-in juntos.
 */
async function atualizarEncontrosAoVivo() {
  if (!encontroAberto) return carregarEncontros();
  const ativo = globalThis.document?.activeElement;
  const rotulo = ativo?.closest?.('#encontros-conteudo') ? ativo.getAttribute('aria-label') : null;
  const posicao = ativo?.selectionStart;
  await detalheEncontro(encontroAberto.id);
  if (!rotulo) return;
  const campo = [...document.querySelectorAll('#encontros-conteudo [aria-label]')].find(n => n.getAttribute('aria-label') === rotulo);
  campo?.focus();
  if (posicao != null) campo?.setSelectionRange?.(posicao, posicao);
}

function paginaEncontro(alvo, voltar, e, inscricoes, tarefas) {
  const estado = encontroAberto;
  const gestao = pode('encontros'), ativo = e.estado !== 'cancelado';
  const atualizar = () => detalheEncontro(e.id);
  const ctx = { e, inscricoes, tarefas, gestao, ativo, atualizar };

  // Menu "Mais": ações raras ou destrutivas, fora da vista.
  const mais = [
    gestao && ativo ? botao('Editar encontro', () => formularioEncontro(e, atualizar)) : null,
    gestao && ativo ? botao('Cancelar encontro', () => confirmarEncontro('Cancelar encontro', 'Novas inscrições e presenças serão bloqueadas. O histórico será preservado.', async () => {
      await api('POST', caminhoEncontro(e.id) + '/cancelar', {}); await atualizar();
    }), 'perigo pequeno') : null,
    // Excluir de vez (só a Administração): para cadastros de teste ou feitos por engano.
    gestao && pode('admin') ? botao('Excluir encontro', () => confirmarEncontro('Excluir encontro',
      `Excluir "${e.titulo || 'Encontro'}" com ${plural(inscricoes.length, 'inscrição', 'inscrições')} e ${plural(tarefas.length, 'tarefa', 'tarefas')}? ` +
      'Não dá para desfazer (só restaurando um backup). Para encerrar um encontro real, prefira "Cancelar encontro", que preserva o histórico.',
      async () => { await api('DELETE', caminhoEncontro(e.id)); encontroAberto = null; await carregarEncontros(); }), 'perigo pequeno') : null,
  ].filter(Boolean);

  const ocupadas = e.vagasOcupadas || 0, espera = e.emEspera || 0;
  const pendentes = tarefas.filter(t => t.estado === 'pendente').length;
  const porLink = inscricoes.filter(i => i.origem === 'link' && i.estado !== 'cancelada').length;
  const capacidade = e.capacidade ?? (e.vagasDisponiveis != null ? ocupadas + e.vagasDisponiveis : null);
  const vagas = capacidade == null
    ? el('div', { class: 'encontro-kpi' }, el('span', {}, 'Vagas'), el('b', {}, String(ocupadas)), el('span', {}, `${ocupadas === 1 ? 'participante' : 'participantes'} · sem limite de vagas`))
    : el('div', { class: 'encontro-kpi largo' }, el('span', {}, 'Vagas'),
      el('div', {}, el('b', {}, `${ocupadas} de ${capacidade}`), ' ', el('span', {}, Math.max(0, capacidade - ocupadas) === 1 ? '1 vaga disponível' : `${Math.max(0, capacidade - ocupadas)} vagas disponíveis`)),
      el('div', { class: 'encontro-barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.min(100, Math.round(ocupadas / Math.max(1, capacidade) * 100))}%` })));

  const abas = el('div', { class: 'abas-devocionais encontro-abas', role: 'tablist', 'aria-label': 'Seções do encontro' });
  const conteudo = el('div', { class: 'encontro-aba', role: 'tabpanel' });
  function contagens() {
    const chegada = participantesCheckin(inscricoes);
    return { inscritos: inscricoes.filter(i => i.estado !== 'cancelada').length, checkin: `${chegada.filter(x => x.p.presenteEm).length}/${chegada.length}`,
      tarefas: pendentes || null, roteiro: (e.roteiro || []).length || null };
  }
  function desenharAbas() {
    const n = contagens();
    abas.replaceChildren(...Object.entries(abasEncontro).map(([v, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(estado.aba === v),
      onclick: () => { estado.aba = v; desenharAbas(); desenharConteudo(); } }, t,
      ...(n[v] != null ? [' ', el('span', { class: 'encontro-contagem' }, String(n[v]))] : []),
      ...(v === 'inscritos' && espera ? [' ', el('span', { class: 'encontro-contagem aviso' }, `${espera} na espera`)] : []))));
  }
  function desenharConteudo() {
    conteudo.replaceChildren();
    if (estado.aba === 'checkin') abaCheckinEncontro(conteudo, ctx, desenharAbas);
    else if (estado.aba === 'divulgar') abaDivulgarEncontro(conteudo, ctx);
    else if (estado.aba === 'tarefas') abaTarefasEncontro(conteudo, ctx);
    else if (estado.aba === 'roteiro') abaRoteiroEncontro(conteudo, ctx);
    else abaInscritosEncontro(conteudo, ctx);
  }

  alvo.replaceChildren(...[
    voltar,
    el('div', { class: 'encontro-cabecalho' },
      el('div', { class: 'conteudo' },
        el('div', { class: 'titulo encontro-titulo' }, e.titulo || 'Encontro', ' ', etiquetaEncontro(e),
          ...(e.linkInscricao?.ativo && e.estado === 'aberto' ? [' ', el('span', { class: 'etiqueta' }, 'Inscrições pelo link')] : [])),
        el('p', { class: 'sub' }, `${nomeMinisterioEncontro(e.ministerioId)} · ${tiposEncontro[e.tipo] || 'Encontro'} · ${periodoEncontro(e)} · ${e.local || 'Local a definir'}`)),
      el('div', { class: 'acoes' }, ...[
        gestao && e.estado === 'aberto' ? botao('+ Inscrever pessoas', () => formularioInscricao(e, atualizar), 'pequeno') : null,
        mais.length ? el('details', { class: 'encontro-mais' }, el('summary', { class: 'botao secundario pequeno' }, 'Mais'), el('div', { class: 'encontro-mais-menu' }, ...mais)) : null,
      ].filter(Boolean))),
    e.descricao ? el('p', { class: 'encontro-texto' }, e.descricao) : null,
    gestao && ativo && e.estado !== 'aberto' ? el('p', { class: 'dica' }, 'Para receber inscrições, use "Mais › Editar encontro" e mude a situação para "Aberto".') : null,
    el('div', { class: 'encontro-kpis' }, vagas,
      el('div', { class: 'encontro-kpi' }, el('span', {}, 'Lista de espera'), el('b', { class: espera ? 'aviso' : null }, String(espera)), el('span', {}, espera === 1 ? 'pessoa esperando' : 'pessoas esperando')),
      el('div', { class: 'encontro-kpi' }, el('span', {}, 'Pelo link'), el('b', {}, String(porLink)), el('span', {}, porLink === 1 ? 'inscrição' : 'inscrições')),
      el('div', { class: 'encontro-kpi' }, el('span', {}, 'Tarefas'), el('b', {}, String(pendentes)), el('span', {}, pendentes === 1 ? 'pendente' : 'pendentes'))),
    abas, conteudo,
  ].filter(Boolean));
  desenharAbas();
  desenharConteudo();
}

/** Aba Inscritos: busca, filtros e uma linha por inscrição; o detalhe abre na própria linha. */
function abaInscritosEncontro(alvo, { e, inscricoes, gestao, ativo, atualizar }) {
  const estado = encontroAberto;
  // Confirmadas primeiro, depois a lista de espera (por ordem de chegada) e as canceladas.
  const ordemEstado = { confirmada: 0, espera: 1, cancelada: 2 };
  const ordenadas = [...inscricoes].sort((a, b) => (ordemEstado[a.estado] ?? 3) - (ordemEstado[b.estado] ?? 3) || String(a.criadoEm).localeCompare(String(b.criadoEm)));
  if (!filtrosInscricao[estado.filtro]) estado.filtro = 'todas';
  const busca = el('input', { type: 'search', 'aria-label': 'Buscar inscrição', placeholder: 'Buscar por nome, WhatsApp ou e-mail', maxlength: 100 });
  busca.value = estado.busca;
  const chips = el('div', { class: 'encontro-filtros', role: 'group', 'aria-label': 'Filtrar inscrições' });
  const lista = el('div', { class: 'lista' });
  const textoBusca = i => [nomeInscricaoEncontro(i), ...(i.participantes || []).map(nomeParticipanteEncontro), i.whatsapp, whatsappEncontro(i.whatsapp), i.email].join(' ');
  function desenhar() {
    chips.replaceChildren(...Object.entries(filtrosInscricao).map(([v, [t, f]]) => {
      const n = inscricoes.filter(f).length;
      if (!n && v !== 'todas' && v !== estado.filtro) return null;
      return el('button', { type: 'button', 'aria-pressed': String(estado.filtro === v), onclick: () => { estado.filtro = v; desenhar(); } }, t, ' ', el('span', { class: 'encontro-contagem' }, String(n)));
    }).filter(Boolean));
    const termo = normalizarEncontro(estado.busca.trim());
    const visiveis = ordenadas.filter(filtrosInscricao[estado.filtro][1]).filter(i => !termo || normalizarEncontro(textoBusca(i)).includes(termo));
    lista.replaceChildren(...(visiveis.length ? visiveis.map(i => linhaInscricaoEncontro(i, { e, gestao, ativo, atualizar, redesenhar: desenhar }))
      : [el('p', { class: 'vazio' }, inscricoes.length ? 'Nenhuma inscrição com essa busca ou filtro.' : 'Nenhuma inscrição.')]));
  }
  busca.addEventListener('input', () => { estado.busca = busca.value; desenhar(); });
  alvo.append(el('div', { class: 'encontro-filtros-barra' }, busca, chips), lista);
  desenhar();
}

function linhaInscricaoEncontro(i, { e, gestao, ativo, atualizar, redesenhar }) {
  const abertas = encontroAberto.abertas;
  const participantes = i.participantes || [];
  const qtd = participantes.length;
  const aberta = abertas.has(i.id);
  const editavel = gestao && ativo && i.estado === 'confirmada';
  const nome = nomeInscricaoEncontro(i);
  const outros = participantes.filter(p => !(p.membroId && p.membroId === i.responsavelMembroId) && !p.titular).map(p => nomeParticipanteEncontro(p) + (p.crianca ? ' (criança)' : ''));
  const resumo = [plural(qtd, 'pessoa', 'pessoas'), outros.length ? 'com ' + outros.join(', ') : '', i.origem === 'link' ? 'pelo link' : 'pelo painel',
    i.criadoEm && /^\d{4}-\d{2}-\d{2}/.test(i.criadoEm) ? 'em ' + dataEncontro(i.criadoEm.slice(0, 10)).slice(0, 5) : ''].filter(Boolean).join(' · ');
  const linha = el('article', { class: 'item encontro-bloco' + (aberta ? ' aberta' : '') },
    el('div', { class: 'encontro-bloco-topo' },
      el('div', { class: 'conteudo' },
        el('div', { class: 'titulo' }, `Inscrição de ${nome}`,
          ...(i.origem === 'link' ? [' ', el('span', { class: 'etiqueta' }, 'Pelo link')] : []),
          ...(i.estado === 'espera' ? [' ', el('span', { class: 'etiqueta conflito' }, `Lista de espera · ${plural(qtd, 'pessoa', 'pessoas')}`)] : []),
          ...(i.estado === 'cancelada' ? [' ', el('span', { class: 'etiqueta alerta' }, 'Cancelada')] : []),
          ...(gestao && i.origem === 'link' && !i.responsavelMembroId && i.estado !== 'cancelada' ? [' ', el('span', { class: 'etiqueta' }, 'Sem cadastro')] : [])),
        el('p', { class: 'sub' }, resumo)),
      el('div', { class: 'acoes' }, ...[
        gestao && ativo && i.estado === 'espera' ? botao('Confirmar vaga', () => confirmarEncontro('Confirmar vaga',
          `Tirar ${nome} da lista de espera e ocupar ${plural(qtd, 'vaga', 'vagas')}?` +
          (i.email ? ' A pessoa recebe um e-mail avisando.' : ' Avise a pessoa pelo WhatsApp.'), async () => {
            await api('POST', '/api/inscricoes/' + encodeURIComponent(i.id) + '/promover', {}); await atualizar();
          }), 'pequeno') : null,
        el('button', { type: 'button', class: 'botao secundario pequeno', 'aria-expanded': String(aberta),
          onclick: () => { if (aberta) abertas.delete(i.id); else abertas.add(i.id); redesenhar(); } }, aberta ? 'Fechar' : 'Detalhes'),
      ].filter(Boolean))));
  if (!aberta) return linha;

  const contato = [
    i.whatsapp ? el('a', { href: 'https://wa.me/' + encodeURIComponent(i.whatsapp), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp ' + whatsappEncontro(i.whatsapp)) : null,
    i.email ? el('a', { href: 'mailto:' + i.email }, i.email) : null,
  ].filter(Boolean).flatMap((x, n) => n ? [' · ', x] : [x]);
  if (contato.length) linha.append(el('p', { class: 'sub' }, ...contato));
  if (i.resposta) linha.append(el('p', { class: 'sub' }, `${e.linkInscricao?.pergunta || 'Resposta'}: ${i.resposta}`));
  const status = el('p', { role: 'status' });
  for (const p of participantes) {
    const nomeP = nomeParticipanteEncontro(p);
    const situacao = [p.confirmado ? 'Participação confirmada' : 'Aguardando confirmação',
      p.presenteEm ? `Presente (registrado em ${new Date(p.presenteEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} por ${p.presencaPorNome || p.presencaPor || 'responsável'})` : ''].filter(Boolean);
    const acoes = el('div', { class: 'acoes' });
    // Confirmar a participação é reversível: vai direto, sem janela de confirmação.
    if (editavel) acoes.append(botao(p.confirmado ? 'Desfazer confirmação' : 'Confirmar participação', async () => {
      try { await api('PUT', '/api/inscricoes/' + encodeURIComponent(i.id) + '/participantes/' + encodeURIComponent(p.id) + '/presenca', { confirmado: !p.confirmado }); await atualizar(); }
      catch (erro) { mensagem(status, erro.message, false); }
    }));
    linha.append(el('div', { class: 'encontro-linha' },
      el('div', { class: 'conteudo' },
        el('strong', {}, nomeP), ...(p.crianca ? [' ', el('span', { class: 'etiqueta' }, 'Criança')] : []),
        ...(p.nomeAcompanhante && !p.titular ? [' ', el('span', { class: 'etiqueta' }, 'Acompanhante')] : []),
        el('p', { class: 'sub' }, situacao.join(' · '))),
      acoes));
  }
  const acoes = [
    gestao && i.origem === 'link' && !i.responsavelMembroId && i.estado !== 'cancelada' ? botao('Vincular ao cadastro', () => vincularInscricaoAoCadastro(i, atualizar)) : null,
    (editavel || (gestao && ativo && i.estado === 'espera')) ? botao('Cancelar inscrição', () => confirmarEncontro('Cancelar inscrição', 'As vagas desta inscrição serão liberadas. O histórico será preservado.', async () => {
      await api('POST', '/api/inscricoes/' + encodeURIComponent(i.id) + '/cancelar', {}); await atualizar();
    }), 'perigo pequeno') : null,
  ].filter(Boolean);
  if (acoes.length) linha.append(el('div', { class: 'barra' }, ...acoes));
  linha.append(status);
  return linha;
}

/** Pessoas das inscrições confirmadas, em ordem alfabética: é quem pode chegar. */
function participantesCheckin(inscricoes) {
  return inscricoes.filter(i => i.estado === 'confirmada')
    .flatMap(i => (i.participantes || []).map(p => ({ p, i })))
    .sort((a, b) => nomeParticipanteEncontro(a.p).localeCompare(nomeParticipanteEncontro(b.p), 'pt-BR'));
}

/** Aba Check-in: buscar o nome e tocar para marcar a chegada (e desfazer, se errou). */
function abaCheckinEncontro(alvo, { inscricoes, gestao, ativo }, aoMudar) {
  const estado = encontroAberto;
  const pessoas = participantesCheckin(inscricoes);
  const busca = el('input', { type: 'search', 'aria-label': 'Buscar quem chegou', placeholder: 'Buscar quem chegou', maxlength: 100 });
  busca.value = estado.buscaCheckin;
  const contador = el('strong', { 'aria-live': 'polite' });
  const lista = el('div', { class: 'encontro-checkin' });
  const status = el('p', { role: 'status' });
  const podeMarcar = gestao && ativo;
  const ocupados = new Set();
  function desenhar() {
    contador.textContent = `${pessoas.filter(x => x.p.presenteEm).length} de ${pessoas.length} chegaram`;
    const termo = normalizarEncontro(estado.buscaCheckin.trim());
    const visiveis = pessoas.filter(x => !termo || normalizarEncontro(nomeParticipanteEncontro(x.p) + ' ' + nomeInscricaoEncontro(x.i)).includes(termo));
    lista.replaceChildren(...(visiveis.length ? visiveis.map(({ p, i }) => {
      const nome = nomeParticipanteEncontro(p), titular = nome === nomeInscricaoEncontro(i);
      const detalhe = [titular ? (i.participantes.length > 1 ? `com mais ${i.participantes.length - 1}` : 'inscrição individual') : 'com ' + nomeInscricaoEncontro(i),
        p.crianca ? 'criança' : '', !p.confirmado && !p.presenteEm ? 'participação ainda não confirmada' : ''].filter(Boolean).join(' · ');
      return el('button', { type: 'button', 'aria-pressed': String(!!p.presenteEm), disabled: !podeMarcar,
        onclick: async () => {
          if (ocupados.has(p.id)) return;
          ocupados.add(p.id);
          // Marcar a chegada já confirma a participação (o servidor exige as duas).
          const corpo = p.presenteEm ? { presente: false } : p.confirmado ? { presente: true } : { confirmado: true, presente: true };
          try {
            await api('PUT', '/api/inscricoes/' + encodeURIComponent(i.id) + '/participantes/' + encodeURIComponent(p.id) + '/presenca', corpo);
            if (corpo.presente) { p.confirmado = true; p.presenteEm = new Date().toISOString(); mensagem(status, `${nome} chegou.`); }
            else { p.presenteEm = null; mensagem(status, `Chegada de ${nome} desfeita.`); }
            if (corpo.presente && estado.buscaCheckin) { estado.buscaCheckin = ''; busca.value = ''; }
            desenhar(); aoMudar();
            busca.focus?.();
          } catch (erro) { mensagem(status, erro.message, false); }
          finally { ocupados.delete(p.id); }
        } },
      el('span', { class: 'encontro-checkin-nome' }, nome, el('small', {}, detalhe)),
      el('span', { class: 'encontro-checkin-marca', 'aria-hidden': 'true' }, p.presenteEm ? '✓' : ''));
    }) : [el('p', { class: 'vazio' }, pessoas.length ? 'Ninguém com esse nome entre os confirmados.' : 'Nenhuma inscrição confirmada ainda.')]));
  }
  busca.addEventListener('input', () => { estado.buscaCheckin = busca.value; desenhar(); });
  const naEspera = inscricoes.filter(i => i.estado === 'espera').length;
  alvo.append(el('div', { class: 'encontro-filtros-barra' }, busca, contador), status, lista,
    ...[!podeMarcar ? el('p', { class: 'dica' }, ativo ? 'Só quem gerencia encontros marca a chegada.' : 'Encontro cancelado: presenças bloqueadas.') : null,
      naEspera ? el('p', { class: 'dica' }, `Quem está na lista de espera (${plural(naEspera, 'inscrição', 'inscrições')}) não aparece aqui até ter a vaga confirmada.`) : null].filter(Boolean));
  desenhar();
}

function abaDivulgarEncontro(alvo, { e, gestao, ativo, atualizar }) {
  if (!gestao) { alvo.append(el('p', { class: 'dica' }, 'O link de inscrição e o convite ficam com quem gerencia encontros.')); return; }
  linkInscricaoEncontro(alvo, e, atualizar);
  if (!ativo) return;
  alvo.append(el('h3', {}, 'Convite para o WhatsApp'),
    el('p', { class: 'dica' }, 'Texto com data, local e descrição, para colar no grupo. Não leva nenhum dado de inscritos.'),
    el('div', { class: 'barra' }, botao('Preparar convite', () => prepararConviteEncontro(e))));
}

function abaTarefasEncontro(alvo, { e, tarefas, gestao, ativo, atualizar }) {
  const status = el('p', { role: 'status' });
  if (gestao && ativo) alvo.append(el('div', { class: 'barra' }, botao('Criar tarefa', () => formularioTarefaEncontro(e, null, atualizar), 'pequeno')));
  const ordem = { pendente: 0, concluida: 1, cancelada: 2 };
  const lista = [...tarefas].sort((a, b) => (ordem[a.estado] ?? 3) - (ordem[b.estado] ?? 3) || (a.prazo || '9999').localeCompare(b.prazo || '9999'));
  if (!lista.length) alvo.append(el('p', { class: 'vazio' }, 'Nenhuma tarefa.'));
  for (const t of lista) alvo.append(el('article', { class: 'item' },
    el('div', { class: 'conteudo' }, el('div', { class: 'titulo' }, t.descricao, ...(t.estado !== 'pendente' ? [' ', el('span', { class: 'etiqueta' + (t.estado === 'concluida' ? ' nova' : '') }, estadosTarefaEncontro[t.estado] || t.estado)] : [])),
      el('p', { class: 'sub' }, [t.prazo ? `Prazo ${dataEncontro(t.prazo)}` : 'Sem prazo',
        t.responsavelNome || (t.responsavelUsuarioId ? 'Responsável indisponível' : 'Sem responsável')].join(' · '))),
    gestao ? el('div', { class: 'acoes' }, ...[
      ativo && t.estado !== 'cancelada' ? botao(t.estado === 'pendente' ? 'Concluir' : 'Reabrir', async () => {
        try { await api('PUT', '/api/encontros/tarefas/' + encodeURIComponent(t.id), { estado: t.estado === 'pendente' ? 'concluida' : 'pendente' }); await atualizar(); }
        catch (erro) { mensagem(status, erro.message, false); }
      }) : null,
      botao('Editar tarefa', () => formularioTarefaEncontro(e, t, atualizar)),
    ].filter(Boolean)) : null));
  alvo.append(status);
}

function abaRoteiroEncontro(alvo, { e, gestao, ativo, atualizar }) {
  if (gestao && ativo && typeof montarRoteiroEncontro === 'function') alvo.append(el('div', { class: 'barra' }, botao('Montar roteiro', () => montarRoteiroEncontro(e, atualizar), 'pequeno')));
  roteiroUtilizadoEncontro(alvo, e);
}

/** "5511912345678" → "(11) 91234-5678". */
function whatsappEncontro(numero) {
  const n = String(numero || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return numero || '';
}

/** Seção "Inscrições pelo link" do detalhe: endereço, QR, prazo, pergunta e ligar/desligar. */
function linkInscricaoEncontro(alvo, e, atualizar) {
  const link = e.linkInscricao || {};
  const endereco = link.codigo ? `${location.origin}/inscricao/${encodeURIComponent(link.codigo)}` : '';
  const status = el('p', { role: 'status' });
  alvo.append(el('h3', {}, 'Inscrições pelo link'));
  if (!link.ativo) {
    alvo.append(el('p', { class: 'dica' }, e.estado === 'cancelado' ? 'Encontro cancelado: o link está desligado.'
      : 'Gere um link público para as pessoas se inscreverem sozinhas, sem login. A inscrição vale na hora; quando as vagas acabam, entra na lista de espera.'),
    e.estado === 'cancelado' ? null : el('div', { class: 'barra' }, botao('Ativar inscrições pelo link', () => configurarLinkInscricao(e, atualizar, true), 'pequeno')));
    return;
  }
  const campo = el('input', { readonly: true, 'aria-label': 'Endereço de inscrição', class: 'encontro-campo-largo' });
  campo.value = endereco;
  const texto = `Inscrições abertas: ${e.titulo}\n${periodoEncontro(e)}${e.local ? '\n' + e.local : ''}\n\nInscreva-se: ${endereco}`;
  alvo.append(
    el('p', { class: 'dica' }, [
      e.estado === 'aberto' ? 'Link ativo.' : 'Link ativo, mas só aceita inscrições com o encontro "Aberto".',
      link.ate ? `Aceita inscrições até ${dataEncontro(link.ate)}.` : 'Aceita inscrições até o início do encontro.',
      link.pergunta ? `Pergunta: "${link.pergunta}".` : '',
    ].filter(Boolean).join(' ')),
    el('div', { class: 'encontro-link' },
      el('img', { src: `/inscricao/${encodeURIComponent(link.codigo)}/qr.png`, alt: 'QR code do link de inscrição', class: 'encontro-qr', width: 140, height: 140 }),
      el('div', { class: 'conteudo' }, campo,
        el('div', { class: 'barra' },
          botao('Copiar link', async () => {
            try { await navigator.clipboard.writeText(endereco); mensagem(status, 'Link copiado.'); }
            catch (_) { campo.select?.(); mensagem(status, 'Selecione o endereço e copie.', false); }
          }, 'pequeno'),
          el('a', { class: 'botao secundario pequeno', href: 'https://wa.me/?text=' + encodeURIComponent(texto), target: '_blank', rel: 'noopener noreferrer' }, 'Enviar no WhatsApp'),
          el('a', { class: 'botao secundario pequeno', href: endereco, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir página'),
          el('a', { class: 'botao secundario pequeno', href: `/inscricao/${encodeURIComponent(link.codigo)}/qr.png`, download: `inscricao-${(e.titulo || 'encontro').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png` }, 'Baixar QR'),
          el('a', { class: 'botao secundario pequeno', href: `/inscricao/${encodeURIComponent(link.codigo)}/qr.png?telao=1`, download: `inscricao-${(e.titulo || 'encontro').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-telao.png` }, 'QR para o telão')),
        status)),
    el('div', { class: 'barra' },
      botao('Configurar link', () => configurarLinkInscricao(e, atualizar, true)),
      botao('Gerar novo link', () => confirmarEncontro('Gerar novo link', 'O link e o QR atuais param de funcionar (útil se o link foi parar onde não devia). As inscrições feitas continuam valendo.', async () => {
        await api('PUT', caminhoEncontro(e.id) + '/link', { novoCodigo: true }); await atualizar();
      })),
      botao('Desativar link', () => confirmarEncontro('Desativar link', 'A página passa a mostrar que as inscrições não estão abertas. As inscrições feitas continuam valendo.', async () => {
        await api('PUT', caminhoEncontro(e.id) + '/link', { ativo: false }); await atualizar();
      }), 'perigo pequeno')));
}

function configurarLinkInscricao(e, atualizar, ativar) {
  const link = e.linkInscricao || {};
  const campos = {};
  const { conteudo } = janelaEncontro('Inscrições pelo link', async () => {
    await api('PUT', caminhoEncontro(e.id) + '/link', { ativo: ativar, ate: campos.ate.value || null, pergunta: campos.pergunta.value.trim() || null });
    await atualizar();
  }, { textoSalvar: link.ativo ? 'Salvar' : 'Ativar link' });
  const grade = el('div', { class: 'grade-form' });
  conteudo.append(el('p', { class: 'dica' }, 'Quem tiver o link se inscreve sem login, com nome, WhatsApp, e-mail opcional e acompanhantes. ' +
    'A inscrição vale na hora; sem vagas, entra na lista de espera e a equipe confirma por aqui. Quem informa e-mail recebe a confirmação com um link para cancelar.'), grade);
  campos.ate = campoEncontro(grade, 'Aceitar inscrições até (opcional)', link.ate || '', { tipo: 'date' });
  campos.pergunta = campoEncontro(grade, 'Pergunta para quem se inscreve (opcional)', link.pergunta || '', { limite: 200, largo: true });
  campos.pergunta.placeholder = 'Ex.: Vai de carona? Precisa de transporte?';
  grade.append(el('p', { class: 'dica largo' }, 'Não pergunte sobre saúde, documentos ou outros dados sensíveis.'));
  if (e.estado !== 'aberto') conteudo.append(el('p', { class: 'erro' }, 'Atenção: o encontro não está "Aberto". O link só aceita inscrições quando a situação for "Aberto".'));
}

/** Liga quem se inscreveu pelo link ao cadastro de membros (busca pelo nome). */
function vincularInscricaoAoCadastro(inscricao, atualizar) {
  const { conteudo, erro, dlg } = janelaEncontro('Vincular ao cadastro');
  const busca = el('input', { type: 'search', 'aria-label': 'Buscar membro para vincular', maxlength: 100 });
  busca.value = inscricao.responsavelNome || '';
  const resultados = el('div', { class: 'lista' });
  const pesquisar = botao('Buscar', async () => {
    const termo = busca.value.trim();
    if (termo.length < 2) { mensagem(erro, 'Digite ao menos duas letras.', false); return; }
    try {
      const lista = listaEncontros(await api('GET', '/api/encontros/pessoas?busca=' + encodeURIComponent(termo)), 'pessoas');
      resultados.replaceChildren(...(lista.length ? lista.map(p => el('div', { class: 'item encontro-linha' }, el('div', { class: 'conteudo' }, p.nome),
        el('div', { class: 'acoes' }, botao('Vincular', async () => {
          try {
            await api('PUT', '/api/inscricoes/' + encodeURIComponent(inscricao.id) + '/vincular', { membroId: p.id });
            dlg.close(); await atualizar();
          } catch (e) { mensagem(erro, e.message, false); }
        }, 'pequeno'))))
        : [el('p', { class: 'dica' }, 'Nenhum membro encontrado. Se a pessoa não é membro, a inscrição pode ficar como está.')]));
    } catch (e) { mensagem(erro, e.message, false); }
  });
  conteudo.append(el('p', { class: 'dica' }, `${inscricao.responsavelNome} se inscreveu pelo link. Se for alguém do cadastro, vincule para a inscrição aparecer com a ficha da pessoa. Os acompanhantes continuam como estão.`),
    el('div', { class: 'campo-com-botao' }, busca, pesquisar), resultados);
  if ((busca.value || '').trim().length >= 2) pesquisar.click?.();
}

async function formularioInscricao(encontro, atualizar = carregarEncontros) {
  const selecionados = [];
  let responsavel = '';
  const { conteudo, erro } = janelaEncontro('Inscrever pessoas', async () => {
    if (!responsavel) throw new Error('Selecione um membro responsável pela inscrição.');
    if (!selecionados.length) throw new Error('Inclua ao menos uma pessoa.');
    await api('POST', caminhoEncontro(encontro.id) + '/inscricoes', {
      responsavelMembroId: responsavel,
      participantes: selecionados.map(p => ({ ...(p.membroId ? { membroId: p.membroId } : { nomeAcompanhante: p.nomeAcompanhante }), crianca: p.crianca.checked, confirmado: p.confirmado.checked })),
    }); await atualizar();
  }, { textoSalvar: 'Inscrever' });
  conteudo.append(el('p', { class: 'dica' }, 'Busque cada pessoa e confirme individualmente. Todos ocupam vaga, inclusive crianças. Acompanhantes sem ficha existem só nesta inscrição; não informe saúde, documentos ou data de nascimento.'));
  const busca = el('input', { type: 'search', 'aria-label': 'Buscar pessoas', minlength: 2, maxlength: 100, placeholder: 'Nome do membro' });
  const resultados = el('div', { class: 'lista', 'aria-live': 'polite' });
  const pessoas = el('div', { class: 'lista' });
  const responsavelTexto = el('p', { class: 'dica' }, 'Nenhum membro responsável selecionado.');
  function render() {
    pessoas.replaceChildren(...(selecionados.length ? selecionados.map(p => el('div', { class: 'item encontro-linha' },
      el('div', { class: 'conteudo' }, el('strong', {}, p.nome || p.nomeAcompanhante),
        ...(responsavel && responsavel === p.membroId ? [' ', el('span', { class: 'etiqueta nova' }, 'Responsável')] : []),
        el('div', { class: 'encontro-marcas' },
          el('label', { class: 'marcar' }, p.confirmado, ' Participação confirmada'), el('label', { class: 'marcar' }, p.crianca, ' Criança'))),
      el('div', { class: 'acoes' },
        p.membroId && responsavel !== p.membroId ? botao('Definir responsável', () => { responsavel = p.membroId; responsavelTexto.textContent = 'Responsável: ' + p.nome; render(); }) : null,
        botao('Remover', () => { selecionados.splice(selecionados.indexOf(p), 1); if (responsavel === p.membroId) { responsavel = ''; responsavelTexto.textContent = 'Selecione outro responsável.'; } render(); }))))
      : [el('p', { class: 'dica' }, 'Ninguém incluído ainda.')]));
  }
  function incluir(p) {
    if (p.membroId && selecionados.some(atual => atual.membroId === p.membroId)) return;
    selecionados.push({ ...p, confirmado: el('input', { type: 'checkbox' }), crianca: el('input', { type: 'checkbox' }) });
    // O primeiro membro incluído vira o responsável; dá para trocar em "Definir responsável".
    if (p.membroId && !responsavel) { responsavel = p.membroId; responsavelTexto.textContent = 'Responsável: ' + p.nome; }
    render();
  }
  const pesquisar = botao('Buscar', async () => {
    const termo = busca.value.trim();
    if (termo.length < 2) { mensagem(erro, 'Digite ao menos duas letras.', false); return; }
    try {
      const lista = listaEncontros(await api('GET', '/api/encontros/pessoas?busca=' + encodeURIComponent(termo)), 'pessoas').slice(0, 30);
      resultados.replaceChildren(...lista.map(p => el('div', { class: 'item encontro-linha' }, el('div', { class: 'conteudo' }, p.nome),
        el('div', { class: 'acoes' }, botao('Selecionar pessoa', () => incluir({ membroId: p.id, nome: p.nome }))))),
        ...(!lista.length ? [el('p', { class: 'dica' }, 'Nenhuma pessoa encontrada.')] : []));
    } catch (e) { mensagem(erro, e.message, false); }
  });
  const convidado = el('input', { maxlength: 160, 'aria-label': 'Nome de acompanhante sem ficha', placeholder: 'Nome do acompanhante' });
  conteudo.append(el('h3', {}, 'Buscar membro'),
    el('div', { class: 'campo-com-botao' }, busca, pesquisar), resultados,
    el('h3', {}, 'Acompanhante sem ficha'),
    el('div', { class: 'campo-com-botao' }, convidado, botao('Incluir acompanhante', () => {
      if (!convidado.value.trim()) { mensagem(erro, 'Informe o nome do acompanhante.', false); return; }
      incluir({ nomeAcompanhante: convidado.value.trim() }); convidado.value = '';
    })),
    el('h3', {}, 'Pessoas desta inscrição'), responsavelTexto, pessoas);
  render();
}

async function formularioTarefaEncontro(encontro, atual, atualizar = carregarEncontros) {
  const campos = {};
  const { conteudo, erro } = janelaEncontro(atual ? 'Editar tarefa' : 'Criar tarefa', async () => {
    await api(atual ? 'PUT' : 'POST', atual ? '/api/encontros/tarefas/' + encodeURIComponent(atual.id) : caminhoEncontro(encontro.id) + '/tarefas', {
      descricao: campos.descricao.value, responsavelUsuarioId: campos.responsavel.value || null,
      prazo: campos.prazo.value || null, estado: campos.estado.value,
    }); await atualizar();
  });
  const grade = el('div', { class: 'grade-form' });
  conteudo.append(grade);
  campos.descricao = campoEncontro(grade, 'Descrição operacional', atual?.descricao, { tipo: 'textarea', limite: 1000, obrigatorio: true, largo: true });
  campos.prazo = campoEncontro(grade, 'Prazo', atual?.prazo, { tipo: 'date' });
  campos.estado = campoEncontro(grade, 'Situação', atual?.estado || 'pendente', { opcoes: estadosTarefaEncontro });
  campos.responsavel = campoEncontro(grade, 'Responsável autorizado', '', { opcoes: { '': 'Sem responsável' }, largo: true });
  campos.responsavel.disabled = true;
  try {
    const usuarios = listaEncontros(await api('GET', '/api/encontros/responsaveis'), 'responsaveis');
    for (const u of usuarios) campos.responsavel.append(el('option', { value: u.id }, u.nome));
    campos.responsavel.value = atual?.responsavelUsuarioId || '';
    campos.responsavel.disabled = false;
  } catch (e) { mensagem(erro, e.message, false); }
}
