// Aba Escalas do painel: cultos do mês com as escalas que a conta pode ver (pastoral, louvor,
// infantil, recepção). O servidor só manda as escalas visíveis; as abas seguem d.escalas.
// Carregado depois do painel.js (usa api, el, botao, mensagem, abrirDialogo, pode e o mapa carregar).

const escala = {
  mes: null, // 'aaaa-mm'
  tipo: null, // id de TIPOS_ESCALA (horarios-escalas.js)
  dados: null, // resposta de GET /api/escalas
};

const NOMES_ESCALA = Object.fromEntries(TIPOS_ESCALA.map((t) => [t.id, t.nome]));

/** Quem aparece na lista para escalar em cada escala (mesma regra de podeServir, no diako_core). */
const DICA_ESCALAR = {
  pastoral: 'A lista mostra quem tem o ministério Pastoral ou Liderança, ou a função de pastor, presbítero, diácono ou evangelista na ficha.',
  louvor: 'A lista mostra quem tem o ministério Louvor (ou Música) na ficha. Pode marcar mais de uma pessoa.',
  infantil: 'A lista mostra quem tem o ministério Infantil (ou Kids, Crianças) na ficha. Pode marcar mais de uma pessoa.',
  recepcao: 'A lista mostra quem tem o ministério Recepção (ou Acolhimento) na ficha. Pode marcar mais de uma pessoa.',
};

/** Escala que abre: a atual, se ainda visível; senão a primeira que a conta monta; senão a primeira que vê. */
function escolherTipo(d) {
  const ids = d.escalas.map((t) => t.id);
  if (ids.includes(escala.tipo)) return escala.tipo;
  return ids.find((id) => d.pode[id]) || ids[0] || null;
}

const mesIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const comMaiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nomeMes = (mes) => new Date(mes + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long' });

function mudarMes(delta) {
  const [a, m] = escala.mes.split('-').map(Number);
  escala.mes = mesIso(new Date(a, m - 1 + delta, 1));
  carregarEscalas();
}

$('escala-anterior').addEventListener('click', () => mudarMes(-1));
$('escala-proximo').addEventListener('click', () => mudarMes(1));
$('escala-abas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-escala]');
  if (!b) return;
  escala.tipo = b.dataset.escala;
  desenharEscala();
});

async function carregarEscalas() {
  if (!escala.mes) escala.mes = mesIso(new Date());
  try {
    escala.dados = await api('GET', '/api/escalas?mes=' + escala.mes);
    desenharEscala();
  } catch (err) {
    console.error('Falha ao carregar ou desenhar a escala:', err);
    mensagem($('resultado-escala'), err.message, false);
  }
}
carregar.escalas = carregarEscalas;

/** Funções que viram colunas no mês: a Santa Ceia só se algum culto for de ceia. */
function colunasDoMes(d, tipo) {
  const todas = new Set(d.cultos.flatMap((c) => c.funcoes[tipo]));
  return tipoEscala(tipo).funcoes.filter((f) => todas.has(f));
}

function desenharEscala() {
  if (!escala.dados) return;
  const tipo = escala.tipo = escolherTipo(escala.dados);
  $('escala-abas').replaceChildren(...escala.dados.escalas.map((t) => el('button', {
    type: 'button', role: 'tab', 'data-escala': t.id, 'aria-selected': String(t.id === tipo),
  }, t.nome)));
  $('escala-titulo').textContent = comMaiuscula(escala.dados.titulo);
  $('resultado-escala').textContent = '';
  // Sem nenhuma escala liberada: só o aviso (as permissões de ver ficam em Usuários e acessos › Perfis).
  $('escala-sem-acesso').hidden = !!tipo;
  if (!tipo) {
    for (const id of ['escala-vazia', 'escala-conteudo', 'escala-repetir', 'escala-extra', 'escala-indisponivel',
      'escala-ver-indisponibilidades', 'escala-imprimir']) $(id).hidden = true;
    return;
  }
  const d = { ...escala.dados, cultos: cultosDaEscala(escala.dados.cultos, tipo) };
  const podeTipo = d.pode[tipo];
  const algum = TIPOS_ESCALA.some((t) => d.pode[t.id]);

  const [a, m] = escala.mes.split('-').map(Number);
  const anterior = mesIso(new Date(a, m - 2, 1));
  $('escala-repetir').textContent = 'Repetir ' + nomeMes(anterior);
  $('escala-repetir').hidden = !podeTipo || d.cultos.length === 0;
  $('escala-extra').hidden = !d.pode.cultos;
  $('escala-indisponivel').hidden = !algum;
  $('escala-ver-indisponibilidades').hidden = !algum;
  $('escala-imprimir').hidden = d.cultos.length === 0;

  const vazio = d.cultos.length === 0;
  $('escala-vazia').hidden = !vazio;
  $('escala-conteudo').hidden = vazio;
  $('escala-vazia-mes').textContent = d.titulo;
  $('escala-gerar').hidden = !d.pode.cultos || !d.horariosConfigurados;
  $('escala-sem-horarios').hidden = d.horariosConfigurados;
  if (vazio) return;

  const colunas = colunasDoMes(d, tipo);
  let preenchidas = 0, total = 0;
  for (const c of d.cultos) {
    for (const f of c.funcoes[tipo]) {
      total++;
      if ((c[tipo][f] || []).length) preenchidas++;
    }
  }
  const avisos = d.avisos[tipo];
  $('escala-resumo').replaceChildren(
    el('span', {}, el('strong', {}, String(d.cultos.length)), d.cultos.length === 1 ? ' culto no mês' : ' cultos no mês'),
    el('span', {}, el('strong', {}, String(preenchidas)), ` de ${total} funções preenchidas`),
    avisos.length ? el('button', {
      type: 'button', class: 'alerta', 'aria-haspopup': 'dialog',
      'aria-controls': 'dlg-avisos-escala', onclick: abrirAvisosEscala,
    }, `${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'}`) : null);

  const cabecalho = el('tr', {}, el('th', { scope: 'col' }, 'Culto'),
    ...colunas.map((f) => el('th', { scope: 'col' }, f)),
    tipo === 'louvor' ? el('th', { scope: 'col' }, 'Músicas') : null);
  const linhas = d.cultos.map((c) => el('tr', {},
    el('td', { class: 'culto' },
      el('div', { style: 'font-weight:600' }, `${c.rotulo} · ${c.horaTexto}`),
      el('div', { class: 'sub' }, c.nome + (c.tema && tipo === 'pastoral' ? ' · ' + c.tema : '')),
      c.ceia ? el('span', { class: 'ceia' }, 'Santa Ceia') : null,
      d.pode.cultos ? el('div', {}, el('button', { type: 'button', class: 'link', style: 'font-size:13px', onclick: () => abrirCulto(c) }, 'Editar culto')) : null,
      el('div', {}, el('button', { type: 'button', class: 'link', style: 'font-size:13px', onclick: () => abrirAvisarGrupo(c.id) }, 'Avisar o grupo'))),
    ...colunas.map((f) => el('td', {}, celulaEscala(c, tipo, f, podeTipo))),
    tipo === 'louvor' ? el('td', {}, celulaMusicas(c, d.pode.louvor)) : null));
  $('escala-grade').replaceChildren(el('thead', {}, cabecalho), el('tbody', {}, ...linhas));

  $('escala-avisos').replaceChildren(...elementosAvisosEscala(avisos));

  $('escala-indisponiveis').replaceChildren(...(d.indisponibilidades.length ? [
    el('h3', { style: 'font-size:15px;margin:18px 0 8px' }, 'Indisponíveis no mês'),
    ...d.indisponibilidades.map((i) => el('div', { class: 'par', style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' },
      el('span', { style: 'flex:1' }, `${i.nome}: ${periodo(i.de, i.ate)}${i.motivo ? ' · ' + i.motivo : ''}`),
      algum ? botao('Remover', async () => {
        if (!confirm(`Remover a indisponibilidade de ${i.nome}?`)) return;
        await api('DELETE', '/api/escalas/indisponibilidades/' + i.id).catch((err) => mensagem($('resultado-escala'), err.message, false));
        carregarEscalas();
      }) : null)),
  ] : []));
}

function elementosAvisosEscala(avisos) {
  return avisos.length
    ? avisos.map((av) => el('div', { class: 'escala-aviso ' + av.tipo },
      el('span', { class: 'marca', 'aria-hidden': 'true' }, '!'),
      el('div', {}, el('div', { style: 'font-weight:600' }, av.titulo), el('div', { class: 'texto' }, av.texto))))
    : [el('p', { class: 'dica', style: 'margin:0' }, 'Nenhum aviso: escala completa e sem conflitos.')];
}

function abrirAvisosEscala() {
  const d = escala.dados;
  if (!d) return;
  $('avisos-escala-titulo').textContent = `Avisos da escala · ${NOMES_ESCALA[escala.tipo]}`;
  $('avisos-escala-mes').textContent = comMaiuscula(d.titulo);
  $('avisos-escala-lista').replaceChildren(...elementosAvisosEscala(d.avisos[escala.tipo]));
  $('dlg-avisos-escala').showModal();
}
$('avisos-escala-fechar').addEventListener('click', () => $('dlg-avisos-escala').close());

function periodo(de, ate) {
  const f = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  return de === ate ? f(de) : `${f(de)} a ${f(ate)}`;
}

function celulaEscala(c, tipo, funcao, podeEditar) {
  if (!c.funcoes[tipo].includes(funcao)) return null; // Santa Ceia fora do culto de ceia
  const pessoas = c[tipo][funcao] || [];
  const filhos = pessoas.map((p) => el('span', { class: 'pessoa' + (p.aviso ? (p.aviso === 'Indisponível' ? ' indisponivel' : ' conflito') : '') },
    p.nome, p.aviso ? el('small', {}, p.aviso) : null));
  if (!podeEditar) return el('div', { class: 'escala-celula' }, ...(filhos.length ? filhos : [el('span', { class: 'dica' }, '—')]));
  if (!filhos.length) filhos.push(el('span', { class: 'vaga' }, '+ Escalar'));
  return el('button', {
    type: 'button',
    class: 'escala-celula',
    'aria-label': `${funcao} em ${c.rotulo}: ${pessoas.map((p) => p.nome).join(', ') || 'vaga'}. Alterar`,
    onclick: () => abrirEscalar(c, tipo, funcao),
  }, ...filhos);
}

function celulaMusicas(c, podeEditar) {
  const n = (c.musicas || []).length;
  const texto = n ? `${n} ${n === 1 ? 'música' : 'músicas'}` : null;
  if (!podeEditar) return texto ? el('button', { type: 'button', class: 'escala-celula', onclick: () => abrirMusicas(c, false) }, el('span', { class: 'musicas' }, texto)) : el('span', { class: 'dica' }, '—');
  return el('button', { type: 'button', class: 'escala-celula', onclick: () => abrirMusicas(c, true) },
    texto ? el('span', { class: 'musicas' }, texto) : el('span', { class: 'vaga' }, '+ Músicas'));
}

// ---------- Escolher quem serve ----------

let escalarAtual = null;

/** Situação da pessoa para este culto: indisponível, já em outra função ou quantas vezes serve no mês. */
function situacaoPessoa(p, c, tipo, funcao) {
  const ind = escala.dados.indisponibilidades.find((i) => i.membroId === p.id && i.de <= c.data && i.ate >= c.data);
  if (ind) return { classe: 'indisponivel', texto: `Indisponível ${periodo(ind.de, ind.ate)}${ind.motivo ? ' · ' + ind.motivo : ''}` };
  for (const t of Object.keys(c.funcoes)) {
    for (const f of c.funcoes[t]) {
      if ((t !== tipo || f !== funcao) && (c[t][f] || []).some((x) => x.id === p.id)) {
        return { classe: 'conflito', texto: `Já está em ${f.toLowerCase()} neste culto` };
      }
    }
  }
  const vezes = escala.dados.cultos.filter((x) => x.funcoes[tipo].some((f) => (x[tipo][f] || []).some((y) => y.id === p.id))).length;
  return { classe: '', texto: `Disponível · ${vezes === 0 ? 'nenhum culto' : vezes === 1 ? '1 culto' : vezes + ' cultos'} no mês` };
}

const iniciais = (nome) => nome.split(/\s+/).filter((x) => !/^(pr|pra|pb|dc|ev|miss)\.?$/i.test(x)).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

function desenharEscalar() {
  const { c, tipo, funcao, marcados } = escalarAtual;
  const busca = $('escalar-busca').value.trim().toLowerCase();
  const todos = $('escalar-todos').checked;
  const lista = escala.dados.pessoas.filter((p) => (todos || p[tipo] || marcados.has(p.id)) && (!busca || p.nome.toLowerCase().includes(busca)));
  $('escalar-lista').replaceChildren(...(lista.length ? lista.map((p) => {
    const s = situacaoPessoa(p, c, tipo, funcao);
    const caixa = el('input', { type: 'checkbox', value: p.id });
    caixa.checked = marcados.has(p.id);
    caixa.addEventListener('change', () => (caixa.checked ? marcados.add(p.id) : marcados.delete(p.id)));
    return el('label', { class: s.classe === 'indisponivel' ? 'indisponivel' : '' },
      caixa,
      el('span', { class: 'iniciais', 'aria-hidden': 'true' }, iniciais(p.nome)),
      el('span', { style: 'flex:1' }, el('span', { class: 'nome' }, p.nome), el('span', { class: 'situacao ' + s.classe }, s.texto)));
  }) : [el('p', { class: 'dica', style: 'margin:0' }, todos ? 'Ninguém encontrado.' : `Ninguém com o ministério ${NOMES_ESCALA[tipo]} na ficha. Marque "Mostrar todos" ou ajuste as fichas em Membros.`)]));
}

function abrirEscalar(c, tipo, funcao) {
  escalarAtual = { c, tipo, funcao, marcados: new Set((c[tipo][funcao] || []).map((p) => p.id)) };
  $('escalar-funcao').textContent = `${NOMES_ESCALA[tipo]} · ${funcao}`;
  $('escalar-culto').textContent = `${c.rotulo} · ${c.horaTexto}`;
  $('escalar-nome-culto').textContent = c.nome + (c.ceia ? ' · Santa Ceia' : '');
  $('escalar-pergunta').textContent = `Quem fica com ${funcao.toLowerCase()} neste culto?`;
  $('escalar-busca').value = '';
  $('escalar-todos').checked = false;
  $('escalar-dica').textContent = DICA_ESCALAR[tipo];
  desenharEscalar();
  abrirDialogo($('dlg-escalar'), $('erro-escalar'), async () => {
    await api('PUT', '/api/escalas/' + c.id, { tipo, funcao, membros: [...escalarAtual.marcados] });
    await carregarEscalas();
  });
}
$('escalar-busca').addEventListener('input', () => escalarAtual && desenharEscalar());
$('escalar-todos').addEventListener('change', () => escalarAtual && desenharEscalar());

// ---------- Músicas ----------

// Seletor: tabela ordenável (com filtros de tom e andamento) e, ao lado, a prévia da música em foco.
let aoSelecionarMusica = null;
let usoRepertorio = {}; // GET /api/repertorio/uso → {id: {ultima, vezes}}
const seletor = { foco: null, chave: null, crescente: true, tom: '', andamento: '' };

const COLUNAS_SELETOR = [
  ['titulo', 'Música'], ['tom', 'Tom'], ['bpm', 'BPM', 'num'], ['ultima', 'Última vez'], ['vezes', '12 meses', 'num'],
];
const valorSeletor = {
  titulo: (r) => r.titulo,
  tom: (r) => tomDaMusica(r),
  bpm: (r) => numeroBpm(r.bpm) ?? -1,
  ultima: (r) => usoRepertorio[r.id]?.ultima || '',
  vezes: (r) => usoRepertorio[r.id]?.vezes || 0,
};
const ddmmaa = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

function musicasDoSeletor() {
  const musicas = buscarRepertorio(repertorioMusicas.filter((r) => r.ativo), {
    busca: $('seletor-musica-busca').value, tom: seletor.tom,
  }).filter((r) => !seletor.andamento || andamentoBpm(r.bpm) === seletor.andamento);
  // Sem coluna escolhida vale a ordem da busca (mais parecida primeiro, depois título).
  if (!seletor.chave) return musicas;
  const valor = valorSeletor[seletor.chave];
  return musicas.sort((a, b) => {
    const x = valor(a), y = valor(b);
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
    return (seletor.crescente ? c : -c) || a.titulo.localeCompare(b.titulo, 'pt-BR');
  });
}

function filtroChips(caixa, nome, opcoes, atual, mudar) {
  caixa.replaceChildren(...opcoes.map(([valor, texto]) => {
    const radio = el('input', { type: 'radio', name: nome, value: valor });
    radio.checked = valor === atual;
    radio.addEventListener('change', () => mudar(valor));
    return el('label', {}, radio, texto);
  }));
}

function escolherDoSeletor(r) {
  aoSelecionarMusica?.(r);
  $('dlg-selecionar-musica').close();
}

function desenharSeletorMusica() {
  const ativas = repertorioMusicas.filter((r) => r.ativo);
  const tons = [...new Set(ativas.map(tomDaMusica).filter(Boolean))]
    .sort((a, b) => (semitomDaNota(a) - semitomDaNota(b)) || a.localeCompare(b));
  filtroChips($('seletor-musica-tons'), 'seletor-tom', [['', 'Todos'], ...tons.map((t) => [t, t])], seletor.tom,
    (v) => { seletor.tom = v; desenharSeletorMusica(); });
  filtroChips($('seletor-musica-andamento'), 'seletor-andamento',
    [['', 'Todos'], ['Lenta', 'Lenta'], ['Média', 'Média'], ['Rápida', 'Rápida']], seletor.andamento,
    (v) => { seletor.andamento = v; desenharSeletorMusica(); });

  $('seletor-musica-cabecalho').replaceChildren(el('tr', {}, ...COLUNAS_SELETOR.map(([chave, nome, classe]) => {
    const ativa = seletor.chave === chave;
    return el('th', { class: classe || null, 'aria-sort': ativa ? (seletor.crescente ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', onclick: () => {
        // Última vez e 12 meses abrem do maior para o menor; as outras em ordem alfabética.
        seletor.crescente = ativa ? !seletor.crescente : !['ultima', 'vezes'].includes(chave);
        seletor.chave = chave;
        desenharSeletorMusica();
      } }, nome + (ativa ? (seletor.crescente ? ' ↑' : ' ↓') : '')));
  })));

  const musicas = musicasDoSeletor();
  if (!musicas.some((r) => r.id === seletor.foco)) seletor.foco = musicas[0]?.id ?? null;
  $('seletor-musica-contagem').textContent = `${musicas.length} de ${ativas.length} ${ativas.length === 1 ? 'música disponível' : 'músicas disponíveis'}.`;
  $('seletor-musica-lista').replaceChildren(...(musicas.length ? musicas.map((r) => {
    const uso = usoRepertorio[r.id];
    const linha = el('tr', { 'aria-selected': String(r.id === seletor.foco), 'data-id': r.id },
      el('td', {}, el('strong', {}, r.titulo), el('small', {}, r.cantor)),
      el('td', {}, tomDaMusica(r) ? el('span', { class: 'tom-musica' }, tomDaMusica(r)) : '—'),
      el('td', { class: 'num' }, numeroBpm(r.bpm) ?? '—'),
      el('td', {}, uso ? ddmmaa(uso.ultima) : 'Nunca'),
      el('td', { class: 'num' }, uso?.vezes || 0));
    linha.addEventListener('click', () => { seletor.foco = r.id; desenharSeletorMusica(); });
    linha.addEventListener('dblclick', () => escolherDoSeletor(r));
    return linha;
  }) : [el('tr', {}, el('td', { colspan: '5', class: 'dica' }, 'Nenhuma música disponível com essa busca ou filtro. Confira o status no Repertório.'))]));
  $('seletor-musica-lista').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  desenharPreviaMusica(musicas.find((r) => r.id === seletor.foco));
}

function desenharPreviaMusica(r) {
  if (!r) {
    $('seletor-musica-previa').replaceChildren(el('p', { class: 'dica' }, 'Escolha uma música na lista para ver os detalhes.'));
    return;
  }
  const thumb = miniaturaYoutube(r.referencia);
  const link = linkYoutube(r.referencia);
  const uso = usoRepertorio[r.id];
  const tom = tomDaMusica(r);
  const dados = [
    ['Tom Diakonia', tom || 'Não definido'],
    ['1ª nota', r.primeiraNota || 'Não cadastrada'],
    ['Andamento', numeroBpm(r.bpm) ? `${numeroBpm(r.bpm)} BPM · ${andamentoBpm(r.bpm)}` : 'Sem BPM'],
    ['Última vez', uso ? ddmmaa(uso.ultima) : 'Nunca tocada'],
    ['12 meses', `${uso?.vezes || 0} ${uso?.vezes === 1 ? 'culto' : 'cultos'}`],
  ];
  $('seletor-musica-previa').replaceChildren(...[
    thumb ? el('img', { src: thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    el('strong', { class: 'titulo' }, r.titulo),
    el('span', { class: 'dica' }, [r.cantor, r.compositor].filter(Boolean).join(' · ')),
    el('dl', {}, ...dados.flatMap(([rotulo, valor]) => [el('dt', {}, rotulo), el('dd', {}, valor)])),
    link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvir no YouTube ↗') : null,
    botao(tom ? `Usar no culto · tom ${tom}` : 'Usar no culto', () => escolherDoSeletor(r)),
  ].filter(Boolean));
}

function abrirSeletorMusica(selecionar, atualId = '') {
  aoSelecionarMusica = selecionar;
  $('seletor-musica-busca').value = '';
  Object.assign(seletor, { foco: atualId || null, tom: '', andamento: '' });
  desenharSeletorMusica();
  $('dlg-selecionar-musica').showModal();
  // Só dá para rolar até a música atual com o diálogo já aberto.
  $('seletor-musica-lista').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  $('seletor-musica-busca').focus();
}
$('seletor-musica-busca').addEventListener('input', desenharSeletorMusica);
// Setas andam pela lista mesmo com o foco na busca; Enter escolhe a música em foco.
function teclasSeletor(e) {
  const musicas = musicasDoSeletor();
  const i = musicas.findIndex((r) => r.id === seletor.foco);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const proxima = musicas[Math.min(musicas.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (proxima) { seletor.foco = proxima.id; desenharSeletorMusica(); }
  } else if (e.key === 'Enter' && musicas[i]) {
    e.preventDefault();
    escolherDoSeletor(musicas[i]);
  }
}
$('seletor-musica-busca').addEventListener('keydown', teclasSeletor);
$('seletor-musica-tabela').addEventListener('keydown', teclasSeletor);
$('seletor-musica-fechar').addEventListener('click', () => $('dlg-selecionar-musica').close());
$('dlg-selecionar-musica').addEventListener('close', () => { aoSelecionarMusica = null; });

/** "1ª nota D" da música [r] cantada no [tom] (vazio se ninguém cadastrou a nota). */
function textoPrimeiraNota(r, tom) {
  const nota = r?.primeiraNota ? primeiraNotaNoTom(r.primeiraNota, tomDaMusica(r), tom) : '';
  return nota ? `1ª nota ${nota}` : '';
}

function linhaMusica(m = { titulo: '', tom: '' }, editavel = true) {
  const escolha = el('select', { 'aria-label': 'Música do repertório' });
  const musicaAtual = repertorioMusicas.find((r) => r.id === m.repertorioId);
  escolha.append(el('option', { value: '' }, m.titulo && !m.repertorioId ? `Histórica: ${m.titulo} (vincule ao repertório)` : 'Escolha do repertório…'));
  for (const r of repertorioMusicas) {
    if (!r.ativo && r.id !== m.repertorioId) continue;
    escolha.append(el('option', { value: r.id }, `${r.titulo} — ${r.cantor}${r.ativo ? '' : ' (inativa)'}`));
  }
  if (m.repertorioId && !musicaAtual) escolha.append(el('option', { value: m.repertorioId }, `${m.titulo} (fora do repertório)`));
  escolha.value = m.repertorioId || '';
  escolha.dataset.tituloAntigo = m.repertorioId ? '' : m.titulo || '';
  escolha.dataset.tomAntigo = m.repertorioId ? '' : m.tom || '';
  const tom = el('input', { type: 'text', maxlength: '12', placeholder: 'Tom', 'aria-label': 'Tom' });
  tom.value = m.tom || '';
  escolha.disabled = tom.disabled = !editavel;
  let primeiroVinculo = !!escolha.dataset.tituloAntigo;
  const resumo = el('div', { class: 'musica-resumo' });
  const nota = el('span', { class: 'primeira-nota' });
  const atualizarNota = () => {
    nota.textContent = textoPrimeiraNota(repertorioMusicas.find((x) => x.id === escolha.value), tom.value.trim());
  };
  tom.addEventListener('input', atualizarNota);
  function atualizarResumo() {
    const r = repertorioMusicas.find((x) => x.id === escolha.value);
    const link = linkYoutube(r?.referencia);
    atualizarNota();
    resumo.replaceChildren(...[el('strong', {}, r?.titulo || m.titulo || 'Nenhuma música selecionada'),
      r ? el('span', { class: 'dica' }, `${r.cantor}${r.compositor ? ' · ' + r.compositor : ''}`) : null,
      nota,
      link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', style: 'display:block' }, 'Ver no YouTube ↗') : null,
      editavel ? botao(r ? 'Trocar música' : 'Escolher música', () => abrirSeletorMusica((selecionada) => {
        if (escolha.value === selecionada.id) return;
        escolha.value = selecionada.id;
        escolha.dispatchEvent(new Event('change'));
      }, escolha.value)) : null].filter(Boolean));
  }
  escolha.addEventListener('change', () => {
    const r = repertorioMusicas.find((x) => x.id === escolha.value);
    tom.value = r ? (primeiroVinculo ? escolha.dataset.tomAntigo : tomDaMusica(r)) : escolha.dataset.tomAntigo;
    if (r) primeiroVinculo = false;
    tom.readOnly = !r;
    atualizarResumo();
  });
  tom.readOnly = !m.repertorioId;
  escolha.hidden = true;
  atualizarResumo();
  const linha = el('div', { class: 'musica' }, el('span', { class: 'ordem' }), resumo, escolha, tom,
    editavel ? el('button', { type: 'button', class: 'botao secundario pequeno', 'aria-label': 'Remover música', style: 'padding:0', onclick: () => { linha.remove(); numerarMusicas(); } }, '×') : el('span'));
  return linha;
}

function numerarMusicas() {
  $('musicas-lista').querySelectorAll('.ordem').forEach((o, i) => (o.textContent = String(i + 1)));
}

async function abrirMusicas(c, editavel) {
  try {
    [repertorioMusicas, usoRepertorio] = await Promise.all([api('GET', '/api/repertorio'), api('GET', '/api/repertorio/uso')]);
  } catch (err) {
    mensagem($('resultado-escala'), err.message, false);
    return;
  }
  $('musicas-culto').textContent = `${c.rotulo} · ${c.horaTexto} · ${c.nome}. Na ordem do ministro.`;
  const musicas = c.musicas || [];
  $('musicas-lista').replaceChildren(...(musicas.length || !editavel ? musicas : [{}]).map((m) => linhaMusica(m, editavel)));
  numerarMusicas();
  $('musicas-adicionar').hidden = !editavel;
  $('musicas-salvar').hidden = !editavel;
  // Abre o controle do DiakoPlayer já na aba Culto deste culto (lá alguém carrega a fila e dá o play).
  const player = escala.dados?.diakoPlayerUrl;
  $('musicas-player').hidden = !player || !musicas.length;
  if (player) $('musicas-player').href = `${player}/#culto=${encodeURIComponent(c.id)}`;
  abrirDialogo($('dlg-musicas'), $('erro-musicas'), async () => {
    const lista = [...$('musicas-lista').querySelectorAll('.musica')]
      .map((l) => {
        const escolha = l.querySelector('select');
        const tom = l.querySelector('input').value.trim();
        return escolha.value ? { repertorioId: escolha.value, tom } :
          escolha.dataset.tituloAntigo ? { titulo: escolha.dataset.tituloAntigo, tom: escolha.dataset.tomAntigo } : null;
      }).filter(Boolean);
    if ([...$('musicas-lista').querySelectorAll('select')].some((s) => !s.value && !s.dataset.tituloAntigo)) {
      throw new Error('Escolha uma música do repertório para cada linha, ou remova a linha vazia.');
    }
    await api('PUT', '/api/escalas/' + c.id, { musicas: lista });
    await carregarEscalas();
  });
}
$('musicas-adicionar').addEventListener('click', () => {
  const linha = linhaMusica();
  $('musicas-lista').append(linha);
  numerarMusicas();
  linha.querySelector('.musica-resumo button').click();
});

// ---------- Cultos: gerar, repetir, extra, editar ----------

$('escala-gerar').addEventListener('click', async () => {
  try {
    const r = await api('POST', '/api/escalas/gerar', { mes: escala.mes });
    await carregarEscalas();
    mensagem($('resultado-escala'), r.criados ? `${r.criados} cultos criados.` : 'Os cultos do mês já existiam.');
  } catch (err) {
    mensagem($('resultado-escala'), err.message, false);
  }
});

$('escala-repetir').addEventListener('click', async () => {
  try {
    const r = await api('POST', '/api/escalas/repetir', { mes: escala.mes, tipo: escala.tipo });
    await carregarEscalas();
    mensagem($('resultado-escala'), r.preenchidas
      ? `${r.preenchidas} ${r.preenchidas === 1 ? 'função preenchida' : 'funções preenchidas'} com a escala do mês anterior. As que já tinham alguém não mudaram.`
      : 'Nada para repetir: o mês anterior não tem escala nessas funções vazias.');
  } catch (err) {
    mensagem($('resultado-escala'), err.message, false);
  }
});

function abrirCulto(c) {
  const novo = !c;
  $('culto-titulo').textContent = novo ? 'Culto extra' : `${c.rotulo} · ${c.horaTexto}`;
  $('culto-data').value = novo ? escala.mes + '-01' : c.data;
  $('culto-data').disabled = !novo;
  $('culto-hora').value = novo ? '19:00' : c.hora;
  $('culto-nome').value = novo ? '' : c.nome;
  $('culto-tema').value = novo ? '' : c.tema || '';
  $('culto-ceia').checked = !novo && !!c.ceia;
  $('culto-excluir').hidden = novo || !escala.dados.pode.pastoral;
  $('culto-excluir').onclick = async () => {
    if (!confirm(`Excluir o culto de ${c.rotulo} e a escala dele?`)) return;
    try {
      await api('DELETE', '/api/escalas/' + c.id);
      $('dlg-culto').close();
      await carregarEscalas();
    } catch (err) {
      mensagem($('erro-culto'), err.message, false);
      $('erro-culto').hidden = false;
    }
  };
  abrirDialogo($('dlg-culto'), $('erro-culto'), async () => {
    const dados = { hora: $('culto-hora').value, nome: $('culto-nome').value.trim(), ceia: $('culto-ceia').checked, tema: $('culto-tema').value.trim() };
    if (novo) await api('POST', '/api/escalas', { ...dados, data: $('culto-data').value });
    else await api('PUT', '/api/escalas/' + c.id, dados);
    await carregarEscalas();
  });
}
$('escala-extra').addEventListener('click', () => abrirCulto(null));

// ---------- Indisponibilidade ----------

function opcoesPessoas(select) {
  const pessoas = escala.dados.pessoas;
  // Quem tem o ministério desta escala primeiro.
  const daEscala = pessoas.filter((p) => p[escala.tipo]);
  const outros = pessoas.filter((p) => !p[escala.tipo]);
  // replaceChildren não ignora null (vira o texto "null"): filtrar os grupos vazios.
  select.replaceChildren(...[
    el('option', { value: '' }, 'Escolha…'),
    daEscala.length ? el('optgroup', { label: NOMES_ESCALA[escala.tipo] }, ...daEscala.map((p) => el('option', { value: p.id }, p.nome))) : null,
    outros.length ? el('optgroup', { label: 'Outros membros' }, ...outros.map((p) => el('option', { value: p.id }, p.nome))) : null,
  ].filter(Boolean));
}

$('escala-indisponivel').addEventListener('click', () => {
  opcoesPessoas($('ind-pessoa'));
  $('ind-de').value = '';
  $('ind-ate').value = '';
  $('ind-motivo').value = '';
  abrirDialogo($('dlg-indisponivel'), $('erro-indisponivel'), async () => {
    if (!$('ind-pessoa').value || !$('ind-de').value) throw new Error('Escolha a pessoa e a data.');
    await api('POST', '/api/escalas/indisponibilidades', {
      membroId: $('ind-pessoa').value, de: $('ind-de').value, ate: $('ind-ate').value || $('ind-de').value, motivo: $('ind-motivo').value.trim(),
    });
    await carregarEscalas();
  });
});

function periodoCompleto(de, ate) {
  const br = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return de === ate ? br(de) : `${br(de)} a ${br(ate)}`;
}

async function carregarTodasIndisponibilidades() {
  const resultado = $('resultado-lista-indisponibilidades');
  resultado.textContent = 'Carregando avisos…';
  try {
    const avisos = await api('GET', '/api/escalas/indisponibilidades');
    resultado.textContent = `${avisos.length} ${avisos.length === 1 ? 'aviso ativo' : 'avisos ativos'}.`;
    $('lista-indisponibilidades').replaceChildren(...(avisos.length ? avisos.map((i) => {
      const cancelar = botao('Cancelar aviso', async () => {
        if (!confirm(`Cancelar a indisponibilidade de ${i.nome} (${periodoCompleto(i.de, i.ate)})?`)) return;
        cancelar.disabled = true;
        try {
          await api('DELETE', '/api/escalas/indisponibilidades/' + encodeURIComponent(i.id));
          await carregarTodasIndisponibilidades();
          await carregarEscalas();
        } catch (err) {
          mensagem(resultado, err.message, false);
          cancelar.disabled = false;
        }
      });
      return el('div', { class: 'aviso-indisponibilidade' },
        el('div', { class: 'detalhes' },
          el('strong', {}, i.nome),
          el('div', {}, `Indisponível: ${periodoCompleto(i.de, i.ate)}${i.motivo ? ' · ' + i.motivo : ''}`),
          el('div', { class: 'dica' }, `Enviado por: ${i.enviadoPor || 'não registrado'} · Em: ${i.enviadoEm ? new Date(i.enviadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'não registrado'}`)),
        cancelar);
    }) : [el('p', { class: 'dica' }, 'Nenhuma indisponibilidade ativa cadastrada.') ]));
  } catch (err) {
    mensagem(resultado, err.message, false);
  }
}
$('escala-ver-indisponibilidades').addEventListener('click', () => {
  $('dlg-lista-indisponibilidades').showModal();
  carregarTodasIndisponibilidades();
});
$('fechar-lista-indisponibilidades').addEventListener('click', () => $('dlg-lista-indisponibilidades').close());

// ---------- WhatsApp e impressão ----------

// "Avisar o grupo": o mês inteiro (texto do servidor) ou um culto da aba aberta. Sem links do
// YouTube: a mensagem leva só o link da Minha Escala, onde cada um ouve as músicas.
const linkMinhaEscala = () => location.origin + '/minha-escala';

/** Texto de um culto da aba aberta: equipe com nomes curtos e, no louvor, as músicas. */
function textoAvisarCulto(c, tipo) {
  const t = TIPOS_ESCALA.find((x) => x.id === tipo);
  return textoAvisoCulto({
    culto: { titulo: `${c.rotulo} · ${c.horaTexto}`, nome: c.nome, ceia: c.ceia, tema: tipo === 'pastoral' ? c.tema : '' },
    escala: t ? t.titulo : '',
    equipe: c.funcoes[tipo].map((f) => [f, (c[tipo][f] || []).map((p) => nomeCurtoAviso(p.nome))]),
    musicas: tipo === 'louvor' ? (c.musicas || []).map((m) => ({ titulo: m.titulo, tom: m.tom, primeiraNota: m.primeiraNota })) : null,
    link: linkMinhaEscala(),
  });
}

function atualizarAvisarGrupo() {
  const d = escala.dados;
  const qual = $('avisar-qual').value;
  const c = d.cultos.find((x) => x.id === qual);
  $('avisar-texto').value = c ? textoAvisarCulto(c, escala.tipo) : textoAvisoMes(d.whatsapp[escala.tipo] || '', linkMinhaEscala(), escala.tipo === 'louvor');
  $('avisar-abrir').href = linkWhatsappTexto($('avisar-texto').value);
  $('avisar-resultado').textContent = '';
}

/** Abre a janela com o mês inteiro ou já no culto [cultoId]. */
function abrirAvisarGrupo(cultoId = '') {
  const d = escala.dados;
  if (!d) return;
  const nome = NOMES_ESCALA[escala.tipo] || '';
  $('titulo-avisar-grupo').textContent = `Avisar o grupo · ${nome}`;
  $('avisar-qual').replaceChildren(
    el('option', { value: '' }, `Escala do mês inteiro (${d.titulo})`),
    ...d.cultos.map((c) => el('option', { value: c.id }, `Só o culto de ${c.rotulo} · ${c.horaTexto}${c.nome && c.nome !== 'Culto' ? ' · ' + c.nome : ''}`)));
  $('avisar-qual').value = cultoId;
  atualizarAvisarGrupo();
  $('dlg-avisar-grupo').showModal();
}

$('escala-avisar').addEventListener('click', () => abrirAvisarGrupo());
$('avisar-qual').addEventListener('change', atualizarAvisarGrupo);
$('avisar-texto').addEventListener('input', () => { $('avisar-abrir').href = linkWhatsappTexto($('avisar-texto').value); });
$('avisar-fechar').addEventListener('click', () => $('dlg-avisar-grupo').close());
$('avisar-copiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('avisar-texto').value);
    mensagem($('avisar-resultado'), 'Texto copiado.');
  } catch {
    $('avisar-texto').select();
    mensagem($('avisar-resultado'), 'Texto selecionado: use Ctrl+C para copiar.');
  }
});

$('escala-imprimir').addEventListener('click', () => {
  const d = escala.dados;
  if (!d) return;
  if (!cultosParaImpressao(d.cultos, escala.tipo).length) {
    mensagem($('resultado-escala'), 'Nenhuma pessoa escalada nesta aba para gerar o PDF.', false);
    return;
  }
  $('dlg-formato-escala').showModal();
});

// O PDF é montado no servidor (mesmo visual dos dois formatos) e baixado com o login da sessão.
function baixarEscalaPdf(formato) {
  $('dlg-formato-escala').close();
  mensagem($('resultado-escala'), 'Gerando o PDF…');
  baixarArquivo(
    `/api/escalas/pdf?mes=${escala.mes}&tipo=${escala.tipo}&formato=${formato}`,
    `escala-${escala.tipo}-${escala.mes}-${formato}.pdf`,
  )
    .then(() => mensagem($('resultado-escala'), 'PDF gerado. Confira os downloads do navegador.'))
    .catch((err) => mensagem($('resultado-escala'), err.message, false));
}
$('escala-formato-paisagem').addEventListener('click', () => baixarEscalaPdf('paisagem'));
$('escala-formato-retrato').addEventListener('click', () => baixarEscalaPdf('retrato'));
$('escala-formato-fechar').addEventListener('click', () => $('dlg-formato-escala').close());
