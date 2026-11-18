'use strict';

// Inerte na carga: identidade/permissões só existem após o painel autenticar.
const tiposEncontroCasais = { jantar: 'Jantar', retiro: 'Retiro', palestra: 'Palestra', encontro_familias: 'Encontro de famílias', outro: 'Outro' };
const estadosEncontroCasais = { rascunho: 'Rascunho', aberto: 'Aberto', encerrado: 'Encerrado', cancelado: 'Cancelado' };
const caminhoEncontroCasais = id => '/api/casais/encontros/' + encodeURIComponent(id);
const listaEncontroCasais = (resposta, chave) => Array.isArray(resposta) ? resposta : resposta[chave] || [];

function janelaEncontroCasais(titulo, salvar) {
  const erro = el('p', { role: 'alert' });
  const conteudo = el('div', { class: 'dialogo-coluna' });
  const form = el('form', {}, el('h2', {}, titulo), conteudo);
  const dlg = el('dialog', { class: 'dialogo-largo', 'aria-label': titulo }, form);
  const fechar = botao('Fechar', () => dlg.close());
  const enviar = el('button', { type: 'submit', class: 'botao' }, 'Salvar');
  const rodape = el('div', { class: 'acoes' }, fechar, salvar ? enviar : null);
  form.append(erro, rodape);
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

function campoEncontroCasais(alvo, rotulo, valor = '', { tipo = 'text', opcoes, obrigatorio = false, limite = 300 } = {}) {
  const input = el(opcoes ? 'select' : tipo === 'textarea' ? 'textarea' : 'input', {
    type: opcoes || tipo === 'textarea' ? null : tipo,
    required: obrigatorio, maxlength: limite,
  });
  if (opcoes) for (const [id, nome] of Object.entries(opcoes)) input.append(el('option', { value: id }, nome));
  input.value = valor ?? '';
  alvo.append(el('label', {}, rotulo, input));
  return input;
}

async function carregarCasaisEncontros() {
  const alvo = $('casais-encontros-conteudo');
  if (!alvo) return;
  try {
    const encontros = listaEncontroCasais(await api('GET', '/api/casais/encontros'), 'encontros');
    const resumo = el('section', { 'aria-label': 'Resumo de encontros e tarefas' });
    alvo.replaceChildren(...[el('h3', {}, 'Encontros e famílias'),
      el('p', { class: 'dica' }, 'Inscrições internas. Cada pessoa é confirmada individualmente. Não registre saúde, documentos ou informações íntimas.'),
      resumo,
      pode('casaisGerenciar') ? botao('Criar encontro', () => formularioEncontroCasais()) : null,
      ...encontros.map(e => el('article', { class: 'item' }, el('div', {}, el('h4', {}, e.titulo),
        el('p', {}, `${estadosEncontroCasais[e.estado] || e.estado} · ${new Date(e.inicio).toLocaleString('pt-BR')} · ${e.local || 'Local a definir'}`),
        el('p', {}, `${e.vagasOcupadas || 0} participantes · ${e.vagasDisponiveis == null ? 'Sem limite de vagas' : e.vagasDisponiveis + ' vagas disponíveis'}`)),
      botao('Ver encontro', () => detalheEncontroCasais(e.id)))),
      encontros.length ? null : el('p', {}, 'Nenhum encontro cadastrado.')].filter(Boolean));
    await resumoEncontrosCasais(resumo, encontros);
  } catch (e) { mensagem(alvo, e.message, false); }
}

async function resumoEncontrosCasais(alvo, encontros) {
  // Não depende dos filtros de aniversário: pendências antigas continuam visíveis.
  const agora = new Date();
  const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  const proximos = encontros.filter(e => ['rascunho', 'aberto'].includes(e.estado) && new Date(e.inicio) >= agora)
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  alvo.replaceChildren(...[el('h4', {}, 'Próximos encontros'),
    ...proximos.map(e => el('div', { class: 'item' }, `${e.titulo} · ${new Date(e.inicio).toLocaleString('pt-BR')}`, botao('Abrir encontro', () => detalheEncontroCasais(e.id)))),
    proximos.length ? null : el('p', {}, 'Nenhum próximo encontro.'),
    el('h4', {}, 'Tarefas abertas e vencidas')].filter(Boolean));
  const tarefas = [];
  const falhas = [];
  // Limita requisições simultâneas e inclui encontros antigos/cancelados: não esconder pendências.
  for (let inicio = 0; inicio < encontros.length; inicio += 5) {
    await Promise.all(encontros.slice(inicio, inicio + 5).map(async encontro => {
      try {
        const lista = listaEncontroCasais(await api('GET', caminhoEncontroCasais(encontro.id) + '/tarefas'), 'tarefas');
        tarefas.push(...lista.filter(t => t.estado === 'pendente').map(t => ({ ...t, encontro })));
      } catch (_) { falhas.push(encontro.titulo); }
    }));
  }
  tarefas.sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999'));
  alvo.append(...[...tarefas.map(t => el('div', { class: 'item' },
    el('p', {}, `${t.prazo && t.prazo < hoje ? 'Vencida · ' : ''}${t.descricao} · ${t.prazo || 'Sem prazo'} · ${t.encontro.titulo}`),
    botao('Ver tarefa no encontro', () => detalheEncontroCasais(t.encontro.id)))),
    tarefas.length ? null : el('p', {}, falhas.length ? 'Não foi possível consultar todas as tarefas.' : 'Nenhuma tarefa aberta.'),
    falhas.length ? el('p', { role: 'alert' }, 'Falha ao carregar tarefas de: ' + falhas.join(', ') + '. Reabra a área para tentar novamente.') : null].filter(Boolean));
}

function roteiroUtilizadoEncontroCasais(alvo, encontro) {
  const roteiro = Array.isArray(encontro.roteiro) ? encontro.roteiro : [];
  alvo.append(el('h3', {}, 'Roteiro utilizado'));
  if (!roteiro.length) { alvo.append(el('p', {}, 'Nenhum material associado.')); return; }
  const textos = roteiro.map(item => {
    const snapshot = item.conteudoSnapshot || {};
    if (typeof textoMaterialCasais === 'function') return textoMaterialCasais(snapshot);
    // Fallback de leitura quando a biblioteca ainda não está carregada.
    return [snapshot.titulo, snapshot.objetivo, snapshot.duracaoMinutos ? `Duração: ${snapshot.duracaoMinutos} minutos` : '',
      snapshot.referenciasBiblicas, snapshot.preparacao, snapshot.passos, snapshot.perguntas].filter(Boolean).join('\n\n');
  });
  roteiro.forEach((item, indice) => alvo.append(el('article', { class: 'item' },
    el('h4', {}, `${indice + 1}. ${item.conteudoSnapshot?.titulo || 'Material'} · versão ${item.versao}`),
    el('pre', { style: 'white-space:pre-wrap;overflow-wrap:anywhere;font:inherit' }, textos[indice]))));
  const status = el('p', { role: 'status' });
  alvo.append(botao('Copiar roteiro utilizado', async () => {
    try { await navigator.clipboard.writeText(textos.join('\n\n')); mensagem(status, 'Roteiro copiado. Nenhum dado de participantes foi incluído.'); }
    catch (_) { mensagem(status, 'Não foi possível copiar. Selecione o texto do roteiro e copie manualmente.', false); }
  }), status);
}

function formularioEncontroCasais(atual, atualizar = carregarCasaisEncontros) {
  const campos = {};
  const { conteudo } = janelaEncontroCasais(atual ? 'Editar encontro' : 'Criar encontro', async () => {
    const corpo = Object.fromEntries(Object.entries(campos).map(([chave, input]) => [chave, input.value]));
    corpo.capacidade = corpo.capacidade === '' ? null : Number(corpo.capacidade);
    await api(atual ? 'PUT' : 'POST', atual ? caminhoEncontroCasais(atual.id) : '/api/casais/encontros', corpo);
    await atualizar();
  });
  const adicionar = (chave, rotulo, opcoes = {}) => { campos[chave] = campoEncontroCasais(conteudo, rotulo, atual?.[chave] ?? '', opcoes); };
  adicionar('titulo', 'Título', { obrigatorio: true, limite: 160 });
  adicionar('tipo', 'Tipo', { opcoes: tiposEncontroCasais }); if (!atual) campos.tipo.value = 'jantar';
  adicionar('inicio', 'Início', { tipo: 'datetime-local', obrigatorio: true });
  adicionar('fim', 'Fim', { tipo: 'datetime-local', obrigatorio: true });
  adicionar('local', 'Local'); adicionar('descricao', 'Descrição', { tipo: 'textarea', limite: 3000 });
  adicionar('capacidade', 'Capacidade (todas as pessoas, inclusive crianças)', { tipo: 'number' }); campos.capacidade.min = '1'; campos.capacidade.max = '100000';
  adicionar('estado', 'Estado', { opcoes: estadosEncontroCasais }); if (!atual) campos.estado.value = 'rascunho';
}

function confirmarEncontroCasais(titulo, texto, executar) {
  const { conteudo } = janelaEncontroCasais(titulo, executar);
  conteudo.append(el('p', {}, texto));
}

function textoConviteEncontroCasais(encontro) {
  return [`Convite: ${encontro.titulo || 'Encontro de Casais e Família'}`,
    new Date(encontro.inicio).toLocaleString('pt-BR'), encontro.local || 'Local a confirmar',
    encontro.descricao || '', 'Confirme sua participação com a liderança do ministério.'].filter(Boolean).join('\n\n');
}

function prepararConviteEncontroCasais(encontro) {
  const janela = janelaEncontroCasais('Prévia do convite');
  const texto = el('textarea', { rows: 9, maxlength: 10000, 'aria-label': 'Texto do convite', style: 'width:100%;box-sizing:border-box' });
  texto.value = textoConviteEncontroCasais(encontro);
  const compartilhar = el('a', { class: 'botao secundario', target: '_blank', rel: 'noopener noreferrer' }, 'Abrir no WhatsApp');
  const atualizar = () => { compartilhar.href = 'https://wa.me/?text=' + encodeURIComponent(texto.value); };
  texto.addEventListener('input', atualizar); atualizar();
  janela.conteudo.append(el('p', {}, 'Confira o convite. Copiar ou abrir WhatsApp não envia, não confirma presença e não registra contato.'),
    texto, botao('Copiar convite', async () => {
      try { await navigator.clipboard.writeText(texto.value); mensagem(janela.erro, 'Convite copiado. Envio depende de ação humana.'); }
      catch (_) { mensagem(janela.erro, 'Não foi possível copiar. Selecione o texto para copiar.', false); }
    }), compartilhar);
}

async function detalheEncontroCasais(id) {
  const janela = janelaEncontroCasais('Detalhes do encontro');
  try {
    const [e, respostaI, respostaT] = await Promise.all([
      api('GET', caminhoEncontroCasais(id)), api('GET', caminhoEncontroCasais(id) + '/inscricoes'), api('GET', caminhoEncontroCasais(id) + '/tarefas'),
    ]);
    const gestao = pode('casaisGerenciar'), ativo = e.estado !== 'cancelado';
    const atualizar = async () => { janela.dlg.close(); await carregarCasaisEncontros(); await detalheEncontroCasais(id); };
    janela.conteudo.append(el('h3', {}, e.titulo), el('p', {}, e.descricao || ''), el('p', {}, `${e.local || 'Local a definir'} · ${estadosEncontroCasais[e.estado]}`),
      el('p', {}, `${e.vagasOcupadas || 0} participantes · ${e.vagasDisponiveis == null ? 'Sem limite' : e.vagasDisponiveis + ' vagas disponíveis'}`));
    roteiroUtilizadoEncontroCasais(janela.conteudo, e);
    if (gestao && ativo) janela.conteudo.append(botao('Preparar convite', () => prepararConviteEncontroCasais(e)));
    if (gestao && ativo) janela.conteudo.append(botao('Editar encontro', () => formularioEncontroCasais(e, atualizar)),
      botao('Cancelar encontro', () => confirmarEncontroCasais('Cancelar encontro', 'Novas inscrições e presenças serão bloqueadas. O histórico será preservado.', async () => {
        await api('POST', caminhoEncontroCasais(id) + '/cancelar', {}); await atualizar();
      })));
    if (gestao && e.estado === 'aberto') janela.conteudo.append(botao('Inscrever pessoas', () => formularioInscricaoCasais(e, atualizar)));
    janela.conteudo.append(el('h3', {}, 'Inscrições e presença'));
    const inscricoes = listaEncontroCasais(respostaI, 'inscricoes');
    if (!inscricoes.length) janela.conteudo.append(el('p', {}, 'Nenhuma inscrição.'));
    for (const i of inscricoes) {
      const bloco = el('section', { class: 'item' }, el('h4', {}, i.estado === 'cancelada' ? 'Inscrição cancelada' : 'Inscrição familiar / individual'));
      for (const p of i.participantes || []) {
        const nome = p.nome || p.nomeAcompanhante || 'Membro removido';
        const linha = el('div', {}, el('strong', {}, nome), p.crianca ? ' · Criança' : '',
          el('p', {}, `${p.confirmado ? 'Confirmado' : 'Aguardando confirmação'} · ${p.presenteEm ? 'Presente' : 'Sem presença'}`),
          p.presenteEm ? el('small', {}, `Registrado em ${new Date(p.presenteEm).toLocaleString('pt-BR')} por ${p.presencaPorNome || p.presencaPor || 'responsável'}`) : null);
        if (gestao && ativo && i.estado === 'confirmada') {
          const alterar = corpo => confirmarEncontroCasais('Atualizar participante', `Confirmar alteração para ${nome}?`, async () => {
            await api('PUT', '/api/casais/inscricoes/' + encodeURIComponent(i.id) + '/participantes/' + encodeURIComponent(p.id) + '/presenca', corpo); await atualizar();
          });
          linha.append(...[botao(p.confirmado ? 'Desfazer confirmação' : 'Confirmar pessoa', () => alterar({ confirmado: !p.confirmado })),
            p.confirmado ? botao(p.presenteEm ? 'Desfazer check-in' : 'Registrar presença', () => alterar({ presente: !p.presenteEm })) : null].filter(Boolean));
        }
        bloco.append(linha);
      }
      if (gestao && i.estado === 'confirmada') bloco.append(botao('Cancelar inscrição', () => confirmarEncontroCasais('Cancelar inscrição', 'As vagas desta inscrição serão liberadas. O histórico será preservado.', async () => {
        await api('POST', '/api/casais/inscricoes/' + encodeURIComponent(i.id) + '/cancelar', {}); await atualizar();
      })));
      janela.conteudo.append(bloco);
    }
    janela.conteudo.append(el('h3', {}, 'Tarefas da equipe'));
    if (gestao && ativo) janela.conteudo.append(botao('Criar tarefa', () => formularioTarefaEncontroCasais(e, null, atualizar)));
    const tarefas = listaEncontroCasais(respostaT, 'tarefas');
    if (!tarefas.length) janela.conteudo.append(el('p', {}, 'Nenhuma tarefa.'));
    for (const t of tarefas) janela.conteudo.append(el('article', { class: 'item' }, el('p', {}, t.descricao),
      el('p', {}, `${t.estado} · ${t.prazo || 'Sem prazo'} · ${t.responsavelNome || (t.responsavelUsuarioId ? 'Responsável indisponível' : 'Sem responsável')}`),
      gestao ? botao('Editar tarefa', () => formularioTarefaEncontroCasais(e, t, atualizar)) : null));
  } catch (e) { mensagem(janela.erro, e.message, false); }
}

async function formularioInscricaoCasais(encontro, atualizar = carregarCasaisEncontros) {
  const selecionados = [];
  let responsavel = '';
  const { conteudo, erro } = janelaEncontroCasais('Inscrever pessoas', async () => {
    if (!responsavel) throw new Error('Selecione um membro responsável pela inscrição.');
    if (!selecionados.length) throw new Error('Inclua ao menos uma pessoa.');
    await api('POST', caminhoEncontroCasais(encontro.id) + '/inscricoes', {
      responsavelMembroId: responsavel,
      participantes: selecionados.map(p => ({ ...(p.membroId ? { membroId: p.membroId } : { nomeAcompanhante: p.nomeAcompanhante }), crianca: p.crianca.checked, confirmado: p.confirmado.checked })),
    }); await atualizar();
  });
  conteudo.append(el('p', { class: 'dica' }, 'Selecione cada pessoa e confirme individualmente. Todos ocupam vaga, inclusive crianças. Convidados são nomes apenas desta inscrição; não informe saúde, documentos ou data de nascimento.'));
  const busca = el('input', { type: 'search', 'aria-label': 'Buscar pessoas', minlength: 2, maxlength: 100 });
  const resultados = el('div', { 'aria-live': 'polite' });
  const pessoas = el('div');
  const responsavelTexto = el('p', {}, 'Nenhum membro responsável selecionado.');
  function render() {
    pessoas.replaceChildren(...selecionados.map(p => el('div', { class: 'item' }, el('strong', {}, p.nome || p.nomeAcompanhante),
      el('label', {}, p.confirmado, ' Participação confirmada'), el('label', {}, p.crianca, ' Criança'),
      p.membroId ? botao('Definir responsável', () => { responsavel = p.membroId; responsavelTexto.textContent = 'Responsável: ' + p.nome; }) : null,
      botao('Remover', () => { selecionados.splice(selecionados.indexOf(p), 1); if (responsavel === p.membroId) { responsavel = ''; responsavelTexto.textContent = 'Selecione outro responsável.'; } render(); }))));
  }
  function incluir(p) {
    if (p.membroId && selecionados.some(atual => atual.membroId === p.membroId)) return;
    selecionados.push({ ...p, confirmado: el('input', { type: 'checkbox' }), crianca: el('input', { type: 'checkbox' }) }); render();
  }
  conteudo.append(el('label', {}, 'Buscar membro (mínimo 2 letras)', busca), botao('Buscar', async () => {
    const termo = busca.value.trim();
    if (termo.length < 2) { mensagem(erro, 'Digite ao menos duas letras.', false); return; }
    try {
      const lista = listaEncontroCasais(await api('GET', '/api/casais/pessoas?busca=' + encodeURIComponent(termo)), 'pessoas').slice(0, 30);
      resultados.replaceChildren(...lista.map(p => el('div', {}, p.nome, botao('Selecionar pessoa', () => incluir({ membroId: p.id, nome: p.nome })))), ...(!lista.length ? [el('p', {}, 'Nenhuma pessoa encontrada.')] : []));
    } catch (e) { mensagem(erro, e.message, false); }
  }), resultados, responsavelTexto, pessoas);
  const convidado = campoEncontroCasais(conteudo, 'Nome de acompanhante sem ficha', '', { limite: 160 });
  conteudo.append(botao('Incluir acompanhante', () => {
    if (!convidado.value.trim()) { mensagem(erro, 'Informe o nome do acompanhante.', false); return; }
    incluir({ nomeAcompanhante: convidado.value.trim() }); convidado.value = '';
  }));
}

async function formularioTarefaEncontroCasais(encontro, atual, atualizar = carregarCasaisEncontros) {
  const campos = {};
  const { conteudo, erro } = janelaEncontroCasais(atual ? 'Editar tarefa' : 'Criar tarefa', async () => {
    await api(atual ? 'PUT' : 'POST', atual ? '/api/casais/tarefas/' + encodeURIComponent(atual.id) : caminhoEncontroCasais(encontro.id) + '/tarefas', {
      descricao: campos.descricao.value, responsavelUsuarioId: campos.responsavel.value || null,
      prazo: campos.prazo.value || null, estado: campos.estado.value,
    }); await atualizar();
  });
  campos.descricao = campoEncontroCasais(conteudo, 'Descrição operacional', atual?.descricao, { tipo: 'textarea', limite: 1000, obrigatorio: true });
  campos.prazo = campoEncontroCasais(conteudo, 'Prazo', atual?.prazo, { tipo: 'date' });
  campos.estado = campoEncontroCasais(conteudo, 'Estado', atual?.estado || 'pendente', { opcoes: { pendente: 'Pendente', concluida: 'Concluída', cancelada: 'Cancelada' } });
  campos.responsavel = campoEncontroCasais(conteudo, 'Responsável autorizado', '', { opcoes: { '': 'Sem responsável' } });
  campos.responsavel.disabled = true;
  try {
    const usuarios = listaEncontroCasais(await api('GET', '/api/casais/responsaveis'), 'responsaveis');
    for (const u of usuarios) campos.responsavel.append(el('option', { value: u.id }, u.nome));
    campos.responsavel.value = atual?.responsavelUsuarioId || '';
    campos.responsavel.disabled = false;
  } catch (e) { mensagem(erro, e.message, false); }
}
