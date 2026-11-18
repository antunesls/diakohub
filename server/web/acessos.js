'use strict';
// Página /acessos: pessoas (com vários perfis), perfis, comparação e registro.
// Utilitários (api, el, $, botao, mensagem, dataCurta, cartaoEntregaAcesso) em comum.js.

let eu = null;
let pessoas = [];
let perfis = [];
let catalogo = [];
let selecionada = null; // id da pessoa aberta na ficha
let rascunho = null; // perfis escolhidos na ficha e ainda não salvos (null = sem mudança)

const valor = (id) => $(id).value.trim();
const minhas = () => new Set(eu?.permissoes || []);
const souAdmin = () => minhas().has('admin');

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

// ---------- Seções (#pessoas, #perfis, #comparar, #registro) ----------

const SECOES = ['pessoas', 'perfis', 'comparar', 'registro'];

function mostrarSecao() {
  let atual = location.hash.slice(1);
  if (!SECOES.includes(atual) || (atual === 'registro' && !souAdmin())) atual = 'pessoas';
  document.querySelectorAll('main > section[data-secao]').forEach((s) => { s.hidden = s.dataset.secao !== atual; });
  document.querySelectorAll('nav.secoes a').forEach((a) => {
    if (a.dataset.secao === atual) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (atual === 'registro') carregarRegistro();
}
window.addEventListener('hashchange', mostrarSecao);

// ---------- Início ----------

async function iniciar() {
  try {
    eu = await PrimeiroAcesso.garantir({ token, buscarEu: () => api('GET', '/api/eu'), aoSair: sair });
  } catch {
    return; // sessão expirada: api() já voltou para o login
  }
  $('login').hidden = true;
  $('app').hidden = false;
  const pode = eu.permissoes.includes('usuarios');
  $('layout').hidden = !pode;
  $('sem-acesso').hidden = pode;
  $('link-admin').hidden = !souAdmin();
  $('nav-registro').hidden = !souAdmin();
  if (!pode) {
    $('texto-sem-acesso').textContent = `Você entrou como ${eu.nome} (${eu.perfilNome}). Esta página é de quem cuida dos usuários e perfis.`;
    return;
  }
  try {
    await carregarTudo();
  } catch (err) {
    mensagem($('res-pessoas'), 'Não foi possível carregar: ' + err.message, false);
  }
  mostrarSecao();
}

async function carregarTudo() {
  const [u, p] = await Promise.all([api('GET', '/api/admin/usuarios'), api('GET', '/api/admin/perfis')]);
  pessoas = u.usuarios;
  perfis = p.perfis;
  catalogo = p.permissoes;
  if (selecionada && !pessoas.some((x) => x.id === selecionada)) selecionada = null;
  if (!selecionada && pessoas.length) selecionada = pessoas[0].id;
  montarFiltroPerfil();
  desenharPessoas();
  desenharPerfis(p.padroesExcluidos || []);
  montarMatriz();
}

const perfilPorId = (id) => perfis.find((p) => p.id === id);
const nomePerfil = (id) => perfilPorId(id)?.nome || 'Sem perfil (excluído)';
const idsDe = (u) => u.perfis || (u.perfil ? [u.perfil] : []);

/** O perfil dá algo que quem está logado não tem? (o servidor recusa; aqui só avisamos antes) */
function foraDoAlcance(perfil) {
  if (souAdmin()) return false;
  const tenho = minhas();
  return perfil.permissoes.some((p) => !tenho.has(p));
}

// ---------- Pessoas ----------

function montarFiltroPerfil() {
  const atual = $('filtro-perfil').value;
  $('filtro-perfil').replaceChildren(el('option', { value: '' }, 'Qualquer perfil'),
    ...perfis.map((p) => el('option', { value: p.id }, p.nome)));
  $('filtro-perfil').value = perfis.some((p) => p.id === atual) ? atual : '';
}

function semTilde(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function filtradas() {
  const busca = semTilde(valor('busca'));
  const filtro = $('filtro').value;
  const perfil = $('filtro-perfil').value;
  const limite = Date.now() - 90 * 24 * 3600 * 1000;
  return pessoas.filter((u) => {
    if (busca && !semTilde(u.nome + ' ' + u.login).includes(busca)) return false;
    if (perfil && !idsDe(u).includes(perfil)) return false;
    if (filtro === 'ativos' && !u.ativo) return false;
    if (filtro === 'desativados' && u.ativo) return false;
    if (filtro === 'aguardando' && !u.trocarSenha) return false;
    if (filtro === 'parados' && (!u.ativo || (u.ultimoAcesso && new Date(u.ultimoAcesso).getTime() > limite))) return false;
    return true;
  });
}

for (const id of ['busca', 'filtro', 'filtro-perfil']) $(id).addEventListener('input', desenharLista);

function desenharPessoas() {
  desenharLista();
  desenharFicha();
}

function desenharLista() {
  const lista = filtradas();
  $('lista-pessoas').replaceChildren(...(lista.length ? lista.map((u) =>
    el('button', {
      type: 'button', class: 'item-pessoa' + (u.ativo ? '' : ' inativo'), 'aria-current': u.id === selecionada ? 'true' : 'false',
      onclick: async () => {
        if (rascunho && !await confirmar('Descartar mudanças?', 'Os perfis escolhidos na ficha ainda não foram salvos.', 'Descartar')) return;
        selecionada = u.id;
        rascunho = null;
        desenharPessoas();
      },
    },
    el('span', { class: 'nome' }, u.nome),
    el('span', { class: 'chips' }, idsDe(u).map((id) => el('span', { class: 'chip' }, nomePerfil(id))),
      u.ativo ? null : el('span', { class: 'chip suave' }, 'desativada'),
      u.trocarSenha ? el('span', { class: 'chip alerta' }, u.senhaTemporariaVencida ? 'senha vencida' : 'aguardando 1º acesso') : null)))
    : [el('p', { class: 'vazio' }, pessoas.length ? 'Ninguém com esse filtro.' : 'Ninguém cadastrado ainda. Hoje só a conta principal entra.')]));
}

/** Permissões somadas de [ids], com os perfis de onde cada uma veio. */
function somar(ids) {
  const origem = new Map();
  for (const id of ids) {
    const p = perfilPorId(id);
    if (!p) continue;
    for (const perm of p.permissoes) {
      if (perm === 'sessao') continue;
      if (!origem.has(perm)) origem.set(perm, []);
      origem.get(perm).push(p.nome);
    }
  }
  return origem;
}

function blocoPermissoes(ids) {
  const origem = somar(ids);
  const varios = ids.length > 1;
  const areas = [];
  for (const c of catalogo) if (!areas.some((a) => a.id === c.area)) areas.push({ id: c.area, nome: c.areaNome });
  const grupos = areas.map((a) => {
    const itens = catalogo.filter((c) => c.area === a.id && origem.has(c.id));
    if (!itens.length) return null;
    return el('div', { class: 'grupo' }, el('h4', {}, a.nome), itens.map((c) =>
      el('div', { class: 'perm' }, el('span', {}, c.descricao, varios ? el('small', {}, 'de ' + origem.get(c.id).join(', ')) : null))));
  }).filter(Boolean);
  return grupos.length ? el('div', { class: 'perms' }, grupos)
    : el('p', { class: 'vazio' }, 'Nenhuma permissão: a pessoa entra, mas não vê nada.');
}

function desenharFicha() {
  const u = pessoas.find((x) => x.id === selecionada);
  const ficha = $('ficha');
  if (!u) {
    ficha.replaceChildren(el('p', { class: 'vazio' }, 'Escolha uma pessoa na lista ou adicione alguém.'));
    return;
  }
  const ids = rascunho || idsDe(u);
  const saida = el('span', { role: 'status' });
  const acima = !souAdmin() && idsDe(u).some((id) => perfilPorId(id) && foraDoAlcance(perfilPorId(id)));

  const chips = ids.map((id) => el('span', { class: 'chip' }, nomePerfil(id),
    acima ? null : el('button', {
      type: 'button', 'aria-label': 'Tirar o perfil ' + nomePerfil(id),
      onclick: () => {
        if (ids.length === 1) return mensagem(saida, 'A pessoa precisa de pelo menos um perfil. Desative a conta se ela não deve entrar.', false);
        rascunho = ids.filter((x) => x !== id);
        desenharFicha();
      },
    }, '×')));
  const livres = perfis.filter((p) => !ids.includes(p.id));
  const adicionar = acima || !livres.length ? null : (() => {
    const s = el('select', { class: 'adicionar', 'aria-label': 'Adicionar perfil' }, el('option', { value: '' }, '+ adicionar perfil'),
      livres.map((p) => el('option', { value: p.id, disabled: foraDoAlcance(p) }, p.nome + (foraDoAlcance(p) ? ' (você não pode dar)' : ''))));
    s.addEventListener('change', () => {
      if (!s.value) return;
      rascunho = [...ids, s.value];
      desenharFicha();
    });
    return s;
  })();

  const pendente = rascunho ? el('div', { class: 'pendente' },
    el('span', {}, 'Mudança nos perfis ainda não salva. Ao salvar, ', el('strong', {}, u.nome), ' sai dos aparelhos e entra de novo.'),
    botao('Salvar perfis', async () => {
      try {
        await api('PUT', '/api/admin/usuarios/' + u.id, { perfis: rascunho });
        rascunho = null;
        await carregarTudo();
        mensagem($('res-pessoas'), `Perfis de ${u.nome} salvos. A pessoa precisa entrar de novo.`);
      } catch (err) { mensagem(saida, err.message, false); }
    }, 'pequeno'),
    botao('Desfazer', () => { rascunho = null; desenharFicha(); })) : null;

  const descricoes = ids.map((id) => perfilPorId(id)).filter((p) => p?.descricao)
    .map((p) => el('li', {}, el('strong', {}, p.nome + ': '), p.descricao));

  const acoes = acima ? [el('p', { class: 'dica' }, `${u.nome} tem permissões que você não tem: só a administração mexe nesta conta.`)] : [
    botao('Nova senha e enviar', async () => {
      if (!await confirmar('Gerar nova senha?', `${u.nome} sai de todos os aparelhos, entra com a senha temporária e cria uma nova no primeiro acesso.`, 'Gerar')) return;
      try {
        const r = await api('POST', `/api/admin/usuarios/${u.id}/senha`);
        mostrarSenhaGerada(u.nome, u.login, r);
        await carregarTudo();
      } catch (err) { mensagem(saida, err.message, false); }
    }),
    botao(u.ativo ? 'Desativar' : 'Reativar', async () => {
      if (u.ativo && !await confirmar('Desativar conta?', `${u.nome} sai de todos os aparelhos e não consegue mais entrar, até ser reativada.`, 'Desativar')) return;
      try {
        await api('PUT', '/api/admin/usuarios/' + u.id, { ativo: !u.ativo });
        await carregarTudo();
      } catch (err) { mensagem(saida, err.message, false); }
    }),
    botao('Excluir', async () => {
      const escala = u.membroId ? ' Como a conta está ligada a um membro, a pessoa também sai de todas as escalas (inclusive cultos passados) e as indisponibilidades dela são apagadas; o cadastro de membro continua.' : '';
      if (!await confirmar('Excluir usuário?', `${u.nome} perde o acesso. O histórico do que foi feito com esse usuário continua registrado.${escala}`, 'Excluir')) return;
      try {
        await api('DELETE', '/api/admin/usuarios/' + u.id);
        selecionada = null;
        await carregarTudo();
        mensagem($('res-pessoas'), `${u.nome} excluída.`);
      } catch (err) { mensagem(saida, err.message, false); }
    }, 'perigo pequeno'),
  ];

  ficha.replaceChildren(
    el('div', { class: 'ficha-topo' }, el('h3', {}, u.nome), el('code', {}, u.login),
      el('span', { class: 'dica' }, u.ativo ? 'ativa' : 'desativada', ' · último acesso: ', u.ultimoAcesso ? dataCurta(u.ultimoAcesso) : 'nunca',
        u.membroId ? ' · ligada ao cadastro de membro' : '')),
    u.trocarSenha ? el('span', { class: 'estado-senha' },
      u.senhaTemporariaVencida ? 'Senha temporária vencida: gere uma nova.' : 'Aguardando o primeiro acesso (a pessoa ainda não criou a própria senha).') : null,
    el('div', { class: 'bloco' }, el('span', { class: 'rotulo' }, 'Perfis'), el('div', { class: 'chips' }, chips, adicionar),
      descricoes.length ? el('ul', { class: 'dica', style: 'margin:4px 0 0;padding-left:18px' }, descricoes) : null),
    pendente,
    el('div', { class: 'bloco' }, el('span', { class: 'rotulo' }, rascunho ? 'O que vai poder fazer' : 'O que pode fazer'), blocoPermissoes(ids)),
    el('div', { class: 'acoes' }, acoes, saida));
}

/** Senha temporária com a prévia do texto para o WhatsApp (cartaoEntregaAcesso, em comum.js). */
function mostrarSenhaGerada(nome, login, r) {
  const caixa = $('senha-gerada');
  caixa.replaceChildren(cartaoEntregaAcesso(nome, login, r),
    el('div', { style: 'margin-top:8px' }, botao('Fechar', () => { caixa.hidden = true; })));
  caixa.hidden = false;
  caixa.scrollIntoView({ block: 'nearest' });
}

// ---------- Adicionar pessoa ----------

$('nova-pessoa').addEventListener('click', () => {
  $('n-nome').value = '';
  $('n-login').value = '';
  $('n-perfis').replaceChildren(...perfis.map((p) => {
    const proibido = foraDoAlcance(p);
    return el('label', { title: proibido ? 'Este perfil dá permissões que você não tem.' : null },
      el('input', { type: 'checkbox', value: p.id, disabled: proibido }),
      el('span', {}, p.nome, el('small', {}, proibido ? 'Você não pode dar este perfil.' : p.descricao)));
  }));
  abrirDialogo($('dlg-pessoa'), $('erro-pessoa'), async () => {
    const escolhidos = [...$('n-perfis').querySelectorAll('input:checked')].map((c) => c.value);
    if (!escolhidos.length) throw new Error('Marque pelo menos um perfil.');
    const r = await api('POST', '/api/admin/usuarios', { nome: valor('n-nome'), login: valor('n-login'), perfis: escolhidos });
    selecionada = r.usuario.id;
    rascunho = null;
    await carregarTudo();
    mensagem($('res-pessoas'), `${r.usuario.nome} adicionada.`);
    mostrarSenhaGerada(r.usuario.nome, r.usuario.login, r);
  });
  $('n-nome').focus();
});
$('cancelar-pessoa').addEventListener('click', () => $('dlg-pessoa').close());

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

function desenharPerfis(excluidos) {
  $('lista-perfis').replaceChildren(...perfis.map(cartaoPerfil));
  $('padroes-excluidos').hidden = !excluidos.length;
  $('padroes-excluidos').replaceChildren(
    el('span', { class: 'dica' }, 'Perfis padrão excluídos:'),
    ...excluidos.map((d) => botao('Trazer de volta: ' + d.nome, async () => {
      try {
        await api('POST', `/api/admin/perfis/${encodeURIComponent(d.id)}/restaurar`);
        mensagem($('res-perfis'), `Perfil ${d.nome} de volta.`);
        await carregarTudo();
      } catch (err) { mensagem($('res-perfis'), err.message, false); }
    })));
}

function cartaoPerfil(p) {
  const qtd = p.usuarios || 0;
  const n = p.permissoes.filter((x) => x !== 'sessao').length;
  const proibido = foraDoAlcance(p);
  const excluir = botao('Excluir', async () => {
    if (!await confirmar('Excluir perfil?', `O perfil ${p.nome} deixa de existir.${p.padrao ? ' Por ser um perfil padrão, dá para trazer de volta depois.' : ''}`, 'Excluir')) return;
    try {
      await api('DELETE', '/api/admin/perfis/' + encodeURIComponent(p.id));
      mensagem($('res-perfis'), `Perfil ${p.nome} excluído.`);
      await carregarTudo();
    } catch (err) { mensagem($('res-perfis'), err.message, false); }
  }, 'perigo pequeno');
  if (qtd > 0) {
    excluir.disabled = true;
    excluir.title = 'Tire este perfil de quem o tem antes de excluir.';
  }
  const verPessoas = qtd ? el('a', {
    href: '#pessoas',
    onclick: () => { $('filtro-perfil').value = p.id; $('busca').value = ''; $('filtro').value = ''; desenharLista(); },
  }, qtd === 1 ? '1 pessoa tem' : qtd + ' pessoas têm') : 'Ninguém tem';
  return el('article', { class: 'perfil' },
    el('div', { class: 'perfil-topo' }, el('strong', {}, p.nome),
      p.travado ? el('span', { class: 'selo', title: 'Não pode ser alterado nem excluído' }, 'Travado') : null),
    el('div', { class: 'selos' },
      p.padrao ? el('span', { class: 'selo' }, 'Padrão') : el('span', { class: 'selo proprio' }, 'Criado pela igreja'),
      p.alterado ? el('span', { class: 'selo alterado' }, 'Alterado') : null),
    p.descricao ? el('p', {}, p.descricao) : null,
    el('p', { class: 'perfil-usuarios' }, verPessoas, ` · ${n} ${n === 1 ? 'permissão' : 'permissões'}`,
      p.entrada && p.entrada !== '/painel' ? ` · entra em ${p.entrada}` : ''),
    el('div', { class: 'acoes' },
      botao(p.travado || proibido ? 'Ver' : 'Editar', () => editarPerfil(p, null, p.travado || proibido)),
      botao('Duplicar', () => editarPerfil(null, p)),
      p.alterado && !proibido ? botao('Restaurar padrão', async () => {
        if (!await confirmar('Restaurar padrão?', `O perfil ${p.nome} volta ao nome e às permissões de fábrica. Vale na hora para ${qtd === 1 ? 'a pessoa que o tem' : 'quem o tem'}.`, 'Restaurar')) return;
        try {
          await api('POST', `/api/admin/perfis/${encodeURIComponent(p.id)}/restaurar`);
          mensagem($('res-perfis'), `Perfil ${p.nome} restaurado.`);
          await carregarTudo();
        } catch (err) { mensagem($('res-perfis'), err.message, false); }
      }) : null,
      p.travado || proibido ? null : excluir));
}

let marcadas = new Set();
let perfilEditado = null;
let somenteLeitura = false;

/** Editor: [perfil] para editar, ou null para criar (a partir de [base], se houver). */
function editarPerfil(perfil, base = null, leitura = false) {
  perfilEditado = perfil;
  somenteLeitura = leitura;
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
  $('p-uso').textContent = perfil?.travado ? 'O Administrador tem tudo e não pode ser alterado.'
    : somenteLeitura ? 'Este perfil dá permissões que você não tem: só a administração o altera.'
      : qtd ? `${qtd === 1 ? '1 pessoa tem' : qtd + ' pessoas têm'} este perfil: a mudança vale na hora.` : '';
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
  const tenho = minhas();
  const areas = [];
  for (const c of catalogo) if (!areas.some((a) => a.id === c.area)) areas.push({ id: c.area, nome: c.areaNome });
  $('p-permissoes').replaceChildren(...areas.map((a) => el('fieldset', {},
    el('legend', {}, a.nome),
    ...catalogo.filter((c) => c.area === a.id).map((c) => {
      const explicita = marcadas.has(c.id);
      const incluida = !explicita && efetivas.has(c.id);
      const naoTenho = !souAdmin() && !tenho.has(c.id);
      const por = incluida ? [...marcadas].filter((m) => implicadas(m).has(c.id))
        .map((m) => catalogo.find((x) => x.id === m)?.descricao).filter(Boolean) : [];
      const caixa = el('input', { type: 'checkbox', checked: explicita || incluida, disabled: somenteLeitura || incluida || (naoTenho && !explicita) });
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
          naoTenho && !somenteLeitura ? el('small', {}, 'Você não tem esta permissão, então não pode dá-la.') : null,
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
    mensagem($('res-perfis'), perfilEditado ? `Perfil ${corpo.nome} salvo.` : `Perfil ${corpo.nome} criado. Dê a quem precisa em Pessoas.`);
    await carregarTudo();
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
    el('thead', {}, el('tr', {}, el('th', {}, 'Pode'), perfis.map((p) => el('th', {}, p.nome)))),
    el('tbody', {}, catalogo.map((perm) => el('tr', {},
      el('td', {}, perm.descricao),
      perfis.map((p) => el('td', {}, p.permissoes.includes(perm.id)
        ? el('span', { 'aria-label': 'sim' }, '✓') : el('span', { 'aria-label': 'não', class: 'dica' }, '—')))))));
}

// ---------- Registro (só a administração: a auditoria é dela) ----------

const ACOES = {
  'senha-temporaria': 'Senha temporária', 'perfis-alterados': 'Perfis da pessoa', 'perfil-criado': 'Perfil criado',
  'perfil-editado': 'Perfil editado', 'perfil-restaurado': 'Perfil restaurado', 'perfil-excluido': 'Perfil excluído',
};

async function carregarRegistro() {
  const t = $('tabela-registro');
  try {
    const eventos = await api('GET', '/api/auditoria?tipo=acesso&limite=200');
    t.replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'Quando'), el('th', {}, 'Quem fez'), el('th', {}, 'O quê'), el('th', {}, 'Com quem'), el('th', {}, 'Detalhe'))),
      el('tbody', {}, eventos.length ? eventos.map((e) => el('tr', {},
        el('td', {}, dataCurta(e.quando)), el('td', {}, e.usuario || '—'), el('td', {}, ACOES[e.acao] || e.acao),
        el('td', {}, e.alvo), el('td', { class: 'dica' }, e.detalhe || '')))
        : [el('tr', {}, el('td', { colspan: 5, class: 'dica' }, 'Nada registrado ainda.'))]));
  } catch (err) {
    t.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'erro' }, err.message))));
  }
}

if (token) iniciar();
else sair();
