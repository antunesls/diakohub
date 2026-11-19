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
  return e.vagasDisponiveis == null ? `${pessoas} · sem limite de vagas` : `${pessoas} · ${e.vagasDisponiveis} vagas disponíveis`;
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
      el('div', { class: 'titulo' }, e.titulo || 'Encontro', ' ', etiquetaEncontro(e)),
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
    el('div', { class: 'acoes' }, botao('Ver tarefa no encontro', () => detalheEncontro(t.encontro.id)))))
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

async function detalheEncontro(id) {
  const janela = janelaEncontro('Detalhes do encontro');
  try {
    const [e, respostaI, respostaT] = await Promise.all([
      api('GET', caminhoEncontro(id)), api('GET', caminhoEncontro(id) + '/inscricoes'), api('GET', caminhoEncontro(id) + '/tarefas'),
    ]);
    const gestao = pode('encontros'), ativo = e.estado !== 'cancelado';
    const atualizar = async () => { janela.dlg.close(); await carregarEncontros(); await detalheEncontro(id); };
    const c = janela.conteudo;
    c.append(el('div', { class: 'titulo encontro-titulo' }, e.titulo || 'Encontro', ' ', etiquetaEncontro(e)),
      el('p', { class: 'dica' }, `${nomeMinisterioEncontro(e.ministerioId)} · ${tiposEncontro[e.tipo] || 'Encontro'} · ${periodoEncontro(e)} · ${e.local || 'Local a definir'}`),
      e.descricao ? el('p', { class: 'encontro-texto' }, e.descricao) : el('p', { class: 'dica' }, 'Sem descrição.'),
      el('p', {}, vagasEncontro(e)));
    if (gestao && ativo) c.append(el('div', { class: 'barra' },
      e.estado === 'aberto' ? botao('Inscrever pessoas', () => formularioInscricao(e, atualizar), 'pequeno') : null,
      botao('Editar encontro', () => formularioEncontro(e, atualizar)),
      typeof montarRoteiroEncontro === 'function' ? botao('Montar roteiro', () => montarRoteiroEncontro(e, atualizar)) : null,
      botao('Preparar convite', () => prepararConviteEncontro(e)),
      botao('Cancelar encontro', () => confirmarEncontro('Cancelar encontro', 'Novas inscrições e presenças serão bloqueadas. O histórico será preservado.', async () => {
        await api('POST', caminhoEncontro(id) + '/cancelar', {}); await atualizar();
      }), 'perigo pequeno')));
    if (gestao && ativo && e.estado !== 'aberto') c.append(el('p', { class: 'dica' }, 'Para receber inscrições, edite o encontro e mude a situação para "Aberto".'));
    // Excluir de vez (só a Administração): para cadastros de teste ou feitos por engano.
    // No dia a dia, prefira cancelar, que preserva o histórico.
    if (gestao && pode('admin')) {
      const qtdInscricoes = listaEncontros(respostaI, 'inscricoes').length, qtdTarefas = listaEncontros(respostaT, 'tarefas').length;
      c.append(el('div', { class: 'barra' }, botao('Excluir encontro', () => confirmarEncontro('Excluir encontro',
        `Excluir "${e.titulo || 'Encontro'}" com ${qtdInscricoes} ${qtdInscricoes === 1 ? 'inscrição' : 'inscrições'} e ${qtdTarefas} ${qtdTarefas === 1 ? 'tarefa' : 'tarefas'}? ` +
        'Não dá para desfazer (só restaurando um backup). Para encerrar um encontro real, prefira "Cancelar encontro", que preserva o histórico.',
        async () => {
          await api('DELETE', caminhoEncontro(id));
          janela.dlg.close();
          await carregarEncontros();
        }), 'perigo pequeno')));
    }

    c.append(el('h3', {}, 'Inscrições e presença'));
    const inscricoes = listaEncontros(respostaI, 'inscricoes');
    if (!inscricoes.length) c.append(el('p', { class: 'dica' }, 'Nenhuma inscrição.'));
    for (const i of inscricoes) {
      const participantes = i.participantes || [];
      const responsavel = participantes.find(p => p.membroId && p.membroId === i.responsavelMembroId);
      const editavel = gestao && ativo && i.estado === 'confirmada';
      const bloco = el('section', { class: 'item encontro-bloco' },
        el('div', { class: 'encontro-bloco-topo' },
          el('div', { class: 'titulo' }, responsavel ? `Inscrição de ${responsavel.nome}` : 'Inscrição',
            ...(i.estado === 'cancelada' ? [' ', el('span', { class: 'etiqueta alerta' }, 'Cancelada')] : [])),
          editavel ? botao('Cancelar inscrição', () => confirmarEncontro('Cancelar inscrição', 'As vagas desta inscrição serão liberadas. O histórico será preservado.', async () => {
            await api('POST', '/api/inscricoes/' + encodeURIComponent(i.id) + '/cancelar', {}); await atualizar();
          }), 'perigo pequeno') : null));
      for (const p of participantes) {
        const nome = p.nome || p.nomeAcompanhante || 'Membro removido';
        const situacao = [p.confirmado ? 'Confirmado' : 'Aguardando confirmação',
          p.presenteEm ? `Presente (registrado em ${new Date(p.presenteEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} por ${p.presencaPorNome || p.presencaPor || 'responsável'})` : 'Sem presença'];
        const acoes = el('div', { class: 'acoes' });
        if (editavel) {
          const alterar = corpo => confirmarEncontro('Atualizar participante', `Confirmar alteração para ${nome}?`, async () => {
            await api('PUT', '/api/inscricoes/' + encodeURIComponent(i.id) + '/participantes/' + encodeURIComponent(p.id) + '/presenca', corpo); await atualizar();
          });
          acoes.append(...[botao(p.confirmado ? 'Desfazer confirmação' : 'Confirmar pessoa', () => alterar({ confirmado: !p.confirmado })),
            p.confirmado ? botao(p.presenteEm ? 'Desfazer check-in' : 'Registrar presença', () => alterar({ presente: !p.presenteEm }), p.presenteEm ? 'secundario pequeno' : 'pequeno') : null].filter(Boolean));
        }
        bloco.append(el('div', { class: 'encontro-linha' },
          el('div', { class: 'conteudo' },
            el('strong', {}, nome), ...(p.crianca ? [' ', el('span', { class: 'etiqueta' }, 'Criança')] : []),
            ...(p.nomeAcompanhante ? [' ', el('span', { class: 'etiqueta' }, 'Acompanhante')] : []),
            el('p', { class: 'sub' }, situacao.join(' · '))),
          acoes));
      }
      c.append(bloco);
    }

    c.append(el('h3', {}, 'Tarefas da equipe'));
    if (gestao && ativo) c.append(el('div', { class: 'barra' }, botao('Criar tarefa', () => formularioTarefaEncontro(e, null, atualizar))));
    const tarefas = listaEncontros(respostaT, 'tarefas');
    if (!tarefas.length) c.append(el('p', { class: 'dica' }, 'Nenhuma tarefa.'));
    for (const t of tarefas) c.append(el('article', { class: 'item' },
      el('div', { class: 'conteudo' }, el('div', { class: 'titulo' }, t.descricao),
        el('p', { class: 'sub' }, [estadosTarefaEncontro[t.estado] || t.estado, t.prazo ? `Prazo ${dataEncontro(t.prazo)}` : 'Sem prazo',
          t.responsavelNome || (t.responsavelUsuarioId ? 'Responsável indisponível' : 'Sem responsável')].join(' · '))),
      gestao ? el('div', { class: 'acoes' }, botao('Editar tarefa', () => formularioTarefaEncontro(e, t, atualizar))) : null));

    roteiroUtilizadoEncontro(c, e);
  } catch (e) { mensagem(janela.erro, e.message, false); }
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
