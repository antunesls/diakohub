'use strict';
// Painel › Ministérios: cadastro de ministérios e de quem participa de cada um. Quem participa
// decide quem vê as atas do ministério (server/lib/ministerios.dart).

let ministeriosLista = [];
let ministerioAberto = null;
let ministeriosMembros = null;

async function carregarMinisterios() {
  try {
    const r = await api('GET', '/api/ministerios');
    ministeriosLista = r.ministerios;
    desenharListaMinisterios();
    desenharSemCadastro(r.semCadastro || []);
    if (ministerioAberto) {
      const ainda = ministeriosLista.find((m) => m.id === ministerioAberto);
      if (ainda) await abrirMinisterio(ainda.id);
      else limparDetalheMinisterio();
    }
  } catch (e) { mensagem($('ministerios-resultado'), e.message, false); }
}

function desenharListaMinisterios() {
  $('lista-ministerios').replaceChildren(...ministeriosLista.map((m) => el('button', {
    type: 'button',
    class: 'item-ministerio' + (m.id === ministerioAberto ? ' ativo' : ''),
    'aria-current': m.id === ministerioAberto ? 'true' : null,
    onclick: () => abrirMinisterio(m.id),
  },
  el('strong', {}, m.nome),
  el('small', {}, [
    m.pessoas === 1 ? '1 pessoa' : `${m.pessoas} pessoas`,
    m.atas ? (m.atas === 1 ? '1 ata' : `${m.atas} atas`) : null,
    m.fixo ? 'fixo' : null,
  ].filter(Boolean).join(' · ')))));
}

/** Nomes escritos nos cadastros de membros que ainda não são ministérios (importação, cadastro pelo link). */
function desenharSemCadastro(lista) {
  const caixa = $('ministerios-sem-cadastro');
  caixa.hidden = !lista.length;
  caixa.replaceChildren(
    el('h3', { style: 'font-size:15px;margin:18px 0 6px' }, 'Nos cadastros, mas sem ministério criado'),
    el('p', { class: 'dica', style: 'margin:0 0 8px' }, 'Essas pessoas não entram nas atas de nenhum ministério até o nome virar um ministério.'),
    ...lista.map((s) => el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' },
      el('span', { style: 'flex:1' }, `${s.nome} (${s.pessoas === 1 ? '1 pessoa' : s.pessoas + ' pessoas'})`),
      botao('Criar ministério', async () => {
        try {
          await api('POST', '/api/ministerios', { nome: s.nome });
          mensagem($('ministerios-resultado'), `Ministério ${s.nome} criado com as pessoas que já o tinham no cadastro.`);
          await carregarMinisterios();
        } catch (e) { mensagem($('ministerios-resultado'), e.message, false); }
      }))));
}

function limparDetalheMinisterio() {
  ministerioAberto = null;
  $('ministerio-detalhe').replaceChildren(el('p', { class: 'dica' }, 'Escolha um ministério para ver e mudar quem participa.'));
  desenharListaMinisterios();
}

async function abrirMinisterio(id) {
  const m = ministeriosLista.find((x) => x.id === id);
  if (!m) return;
  ministerioAberto = id;
  desenharListaMinisterios();
  const saida = el('p', { role: 'status' });
  let pessoas;
  try {
    [pessoas, ministeriosMembros] = await Promise.all([
      api('GET', `/api/ministerios/${encodeURIComponent(id)}/pessoas`),
      ministeriosMembros ? Promise.resolve(ministeriosMembros) : api('GET', '/api/ministerios/membros'),
    ]);
  } catch (e) { mensagem($('ministerios-resultado'), e.message, false); return; }

  const nome = el('input', { type: 'text', maxlength: '60', value: m.nome, 'aria-label': 'Nome do ministério', disabled: m.fixo });
  const descricao = el('input', { type: 'text', maxlength: '300', value: m.descricao || '', placeholder: 'Descrição (opcional)', 'aria-label': 'Descrição' });
  const salvar = botao('Salvar', async () => {
    try {
      await api('PUT', `/api/ministerios/${encodeURIComponent(id)}`, { nome: nome.value.trim(), descricao: descricao.value.trim() });
      mensagem(saida, m.nome !== nome.value.trim() ? 'Nome trocado nas pessoas e nas atas do ministério.' : 'Salvo.');
      await carregarMinisterios();
    } catch (e) { mensagem(saida, e.message, false); }
  }, 'pequeno');
  const excluir = m.fixo ? null : botao('Excluir ministério', async () => {
    if (!confirm(`Excluir o ministério ${m.nome}? As pessoas deixam de ter esse ministério no cadastro.`)) return;
    try {
      await api('DELETE', `/api/ministerios/${encodeURIComponent(id)}`);
      mensagem($('ministerios-resultado'), `Ministério ${m.nome} excluído.`);
      limparDetalheMinisterio();
      await carregarMinisterios();
    } catch (e) { mensagem(saida, e.message, false); }
  }, 'perigo pequeno');

  const dentro = new Set(pessoas.map((p) => p.id));
  const escolha = el('select', { 'aria-label': 'Pessoa para adicionar' },
    el('option', { value: '' }, 'Escolha uma pessoa…'),
    ...ministeriosMembros.filter((p) => !dentro.has(p.id)).map((p) => el('option', { value: p.id }, p.nome)));
  async function vincular(ids, entrar) {
    try {
      await api('POST', `/api/ministerios/${encodeURIComponent(id)}/pessoas${entrar ? '' : '/remover'}`, { membros: ids });
      await carregarMinisterios();
    } catch (e) { mensagem(saida, e.message, false); }
  }

  $('ministerio-detalhe').replaceChildren(...[
    el('h2', { style: 'font-size:18px' }, m.nome),
    m.fixo ? el('p', { class: 'dica' }, 'Ministério fixo: as atas formais deste tipo pertencem a ele. Não pode ser renomeado nem excluído.') : null,
    el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px' }, nome, descricao,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, salvar, excluir)),
    saida,
    el('h3', { style: 'font-size:16px;margin:14px 0 8px' }, pessoas.length === 1 ? '1 pessoa' : `${pessoas.length} pessoas`),
    el('div', { style: 'display:flex;gap:8px;margin-bottom:10px' }, escolha,
      botao('Adicionar', () => escolha.value && vincular([escolha.value], true), 'pequeno')),
    pessoas.length
      ? el('ul', { class: 'pessoas-ministerio' }, ...pessoas.map((p) => el('li', {},
        el('span', {}, p.nome),
        botao('Remover', () => vincular([p.id], false), 'secundario pequeno'))))
      : el('p', { class: 'dica' }, 'Ninguém ainda. Sem pessoas, só quem vê todos os ministérios vê as atas dele.'),
  ].filter(Boolean));
}

carregar.ministerios = carregarMinisterios;

$('form-ministerio').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const m = await api('POST', '/api/ministerios', { nome: $('novo-ministerio').value.trim() });
    $('novo-ministerio').value = '';
    ministerioAberto = m.id;
    await carregarMinisterios();
  } catch (err) { mensagem($('ministerios-resultado'), err.message, false); }
});
