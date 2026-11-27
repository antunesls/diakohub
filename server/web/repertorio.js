// Repertório do louvor: planilha (vídeo, tom, 1ª nota e BPM editáveis na linha), ficha em
// página para cadastrar e editar o resto, e "Completar cadastro" (uma música por vez).
let repertorioMusicas = [];
const rep = { tela: 'lista', aberta: null, busca: '', status: 'OK', falta: '', ordem: null, fila: [], pos: 0, tocando: null };

// videoYoutube vem de musica-youtube.js (carregado antes no painel): id do vídeo ou null.
/** Link colado sem "https://" (youtube.com/watch?v=…) também vale. */
const comHttpsRep = (texto) => { const t = String(texto || '').trim(); return !t || /^[a-z]+:\/\//i.test(t) ? t : 'https://' + t; };
/** Player oficial em modo de privacidade: só carrega quando alguém clica para ouvir. */
const playerYoutube = (id, titulo) => el('iframe', {
  class: 'rep-yt-iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`, title: 'Vídeo: ' + titulo,
  allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
});
const enderecoVideoRep = (id) => 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
const nomeNotaRep = (n) => String(n || '').replace('#', '♯');
const nomeTomRep = (t) => t ? (TONS_REPERTORIO.find(([v]) => v === t)?.[1] || t) : 'Não definido';
const ehLink = (url) => /^https?:\/\//i.test(String(url || ''));
const usoRep = (m) => (typeof usoRepertorio === 'object' && usoRepertorio?.[m.id]) || null;
const dataUsoRep = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '';

// Lacunas que o cadastro mostra (contadas só entre as músicas OK, que vão para a escala).
const FALTAS_REP = {
  video: ['sem vídeo', (m) => !videoYoutube(m.referencia)],
  tom: ['sem tom', (m) => !tomDaMusica(m)],
  nota: ['sem 1ª nota', (m) => !m.primeiraNota],
  bpm: ['sem BPM', (m) => numeroBpm(m.bpm) == null],
};
const ORDENS_REP = {
  titulo: (m) => normalizarBusca(m.titulo), video: (m) => (videoYoutube(m.referencia) ? 0 : 1), tom: (m) => tomDaMusica(m) || '~',
  nota: (m) => m.primeiraNota || '~', bpm: (m) => numeroBpm(m.bpm) ?? 9999, ultima: (m) => usoRep(m)?.ultima || '', vezes: (m) => usoRep(m)?.vezes || 0,
};

async function carregarRepertorio() {
  try {
    const [musicas, uso] = await Promise.all([api('GET', '/api/repertorio'), api('GET', '/api/repertorio/uso').catch(() => ({}))]);
    repertorioMusicas = musicas;
    if (typeof usoRepertorio === 'object') usoRepertorio = uso;
    // Atualização vinda de fora não descarta uma ficha aberta nem um campo em edição na planilha.
    if (rep.tela !== 'lista' || document.activeElement?.closest?.('#repertorio-tabela')) return;
    desenharRepertorio();
  } catch (err) {
    mensagem($('repertorio-resultado') || $('repertorio-tela'), err.message, false);
  }
}
carregar.repertorio = carregarRepertorio;

function desenharRepertorio() {
  if (rep.tela === 'ficha') return fichaRepertorio();
  if (rep.tela === 'completar') return completarRepertorio();
  listaRepertorio();
}

/** Grava só os campos mudados e devolve a música como o servidor guardou. */
async function salvarCampoRepertorio(m, corpo) {
  const salva = await api('PUT', '/api/repertorio/' + encodeURIComponent(m.id), corpo);
  Object.assign(m, salva);
  return m;
}

// ---------- Lista (planilha) ----------

function listaRepertorio() {
  const editar = pode('escalaLouvor');
  const ok = repertorioMusicas.filter((m) => statusParaFiltro(m) === 'OK');
  const pendentes = () => ok.filter((m) => FALTAS_REP.video[1](m) || FALTAS_REP.tom[1](m) || FALTAS_REP.nota[1](m));
  const resumo = el('div', { class: 'rep-resumo' });
  const chips = el('div', { class: 'rep-chips', role: 'group', 'aria-label': 'Filtrar por situação' });
  const contagem = el('p', { id: 'repertorio-contagem', class: 'dica', role: 'status' });
  const cabeca = el('thead'), corpo = el('tbody');
  const status = el('p', { id: 'repertorio-resultado', role: 'status' });

  function desenharResumo() {
    resumo.replaceChildren(
      el('button', { type: 'button', 'aria-pressed': String(!rep.falta), onclick: () => { rep.falta = ''; desenharResumo(); desenharLinhas(); } },
        el('b', {}, String(ok.length)), el('span', {}, ok.length === 1 ? 'música OK na escala' : 'músicas OK na escala')),
      ...Object.entries(FALTAS_REP).map(([k, [texto, falta]]) => {
        const n = ok.filter(falta).length;
        return el('button', { type: 'button', class: k === 'video' ? 'rep-resumo-video' : null, 'aria-pressed': String(rep.falta === k),
          onclick: () => { rep.falta = rep.falta === k ? '' : k; if (rep.falta) rep.status = 'OK'; desenharResumo(); desenharChips(); desenharLinhas(); } },
        el('b', {}, k === 'video' ? el('span', { class: 'rep-yt-icone', 'aria-hidden': 'true' }) : null, String(n)), el('span', {}, texto),
        el('span', { class: 'rep-resumo-barra', 'aria-hidden': 'true' }, el('i', { style: `width:${ok.length ? Math.round((1 - n / ok.length) * 100) : 100}%` })));
      }));
  }
  function desenharChips() {
    chips.replaceChildren(...[['OK', 'OK'], ['Em análise', 'Em análise'], ['Inativo', 'Inativas'], ['', 'Todas']].map(([v, t]) =>
      el('button', { type: 'button', 'aria-pressed': String(rep.status === v), onclick: () => { rep.status = v; if (v !== 'OK') rep.falta = ''; desenharChips(); desenharResumo(); desenharLinhas(); } },
        t, ' ', el('span', { class: 'rep-n' }, String(repertorioMusicas.filter((m) => !v || statusParaFiltro(m) === v).length)))));
  }
  function visiveis() {
    let lista = buscarRepertorio(repertorioMusicas, { busca: rep.busca, status: rep.status });
    if (rep.falta) lista = lista.filter(FALTAS_REP[rep.falta][1]);
    if (rep.ordem) {
      const [chave, sentido] = rep.ordem, valor = ORDENS_REP[chave];
      lista = [...lista].sort((a, b) => {
        const x = valor(a), y = valor(b);
        const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
        return c * sentido || a.titulo.localeCompare(b.titulo, 'pt-BR');
      });
    }
    return lista;
  }
  function desenharLinhas() {
    const colunas = [['titulo', 'Música'], ['video', 'Versão'], ['tom', 'Tom Diakonia'], ['nota', '1ª nota'], ['bpm', 'BPM', 'num'], ['ultima', 'Última vez'], ['vezes', '12 meses', 'num'], [null, '']];
    cabeca.replaceChildren(el('tr', {}, ...colunas.map(([k, t, classe]) => el('th', { class: classe, scope: 'col', 'aria-sort': k && rep.ordem?.[0] === k ? (rep.ordem[1] > 0 ? 'ascending' : 'descending') : null },
      k ? el('button', { type: 'button', onclick: () => {
        rep.ordem = [k, rep.ordem?.[0] === k ? -rep.ordem[1] : (['ultima', 'vezes'].includes(k) ? -1 : 1)];
        desenharLinhas();
      } }, t, rep.ordem?.[0] === k ? (rep.ordem[1] > 0 ? ' ▲' : ' ▼') : '') : t))));
    const lista = visiveis();
    contagem.textContent = `${lista.length} ${lista.length === 1 ? 'música' : 'músicas'} de ${repertorioMusicas.length}.`;
    corpo.replaceChildren(...(lista.length ? lista.map((m) => linhaRepertorio(m, editar, { status, aoMudar: desenharResumo }))
      : [el('tr', {}, el('td', { colspan: 8, class: 'rep-vazio' }, rep.falta ? 'Tudo completo neste filtro.' : 'Nenhuma música encontrada.'))]));
  }

  const busca = el('input', { id: 'repertorio-busca', type: 'search', placeholder: 'Título, cantor ou compositor; aceita pequenos erros', autocomplete: 'off', 'aria-label': 'Buscar música' });
  busca.value = rep.busca;
  busca.addEventListener('input', () => { rep.busca = busca.value; desenharLinhas(); });
  const qtdPendentes = pendentes().length;
  $('repertorio-tela').replaceChildren(
    el('div', { class: 'barra' }, el('h1', {}, 'Repertório'), el('span', { class: 'espaco' }),
      ...(editar ? [
        botao('Importar CSV', abrirImportacaoRepertorio),
        botao(`Completar cadastro (${qtdPendentes})`, () => { rep.fila = pendentes(); rep.pos = 0; if (rep.fila.length) { rep.tela = 'completar'; desenharRepertorio(); } }),
        botao('+ Música', () => { rep.aberta = null; rep.tela = 'ficha'; desenharRepertorio(); }, 'pequeno'),
      ] : [])),
    el('p', { class: 'dica' }, editar ? 'Vídeo, tom, 1ª nota e BPM gravam na hora, na própria linha. O resto fica em Editar. Só músicas OK podem ser escolhidas na escala.'
      : 'Só músicas OK podem ser escolhidas na escala.'),
    resumo,
    el('div', { class: 'rep-filtros' }, busca, chips, contagem),
    status,
    el('div', { class: 'rep-tabela-rolagem' }, el('table', { id: 'repertorio-tabela', class: 'rep-tabela' }, cabeca, corpo)),
    el('div', { id: 'repertorio-player' }));
  desenharResumo(); desenharChips(); desenharLinhas(); desenharPlayerRepertorio();
}

function linhaRepertorio(m, editar, { status, aoMudar }) {
  const uso = usoRep(m);
  const situacao = statusParaFiltro(m);
  const piscar = (td) => { td.classList.add('rep-salvo'); setTimeout(() => td.classList.remove('rep-salvo'), 800); };
  /** Célula editável: grava ao mudar; se o servidor recusar, volta o valor e mostra o motivo. */
  function celula(cheia, controle) {
    const td = el('td', { class: cheia ? null : 'rep-faltando' }, controle);
    return td;
  }
  async function gravar(td, corpo, cheia) {
    try {
      await salvarCampoRepertorio(m, corpo);
      td.className = cheia() ? '' : 'rep-faltando';
      piscar(td); aoMudar();
    } catch (err) { mensagem(status, `${m.titulo}: ${err.message}`, false); }
  }
  let tdTom, tdNota, tdBpm;
  if (editar) {
    const tom = el('select', { 'aria-label': 'Tom Diakonia de ' + m.titulo }, ...TONS_REPERTORIO.map(([v, d]) => new Option(d, v)));
    tom.value = tomDaMusica(m);
    tom.addEventListener('change', () => gravar(tdTom, { tomSelecionado: tom.value }, () => tomDaMusica(m)));
    const nota = el('select', { 'aria-label': 'Primeira nota de ' + m.titulo }, new Option('—', ''), ...NOTAS_REPERTORIO.map(([v]) => new Option(nomeNotaRep(v), v)));
    nota.value = m.primeiraNota || '';
    nota.addEventListener('change', () => gravar(tdNota, { primeiraNota: nota.value }, () => m.primeiraNota));
    const bpm = el('input', { inputmode: 'numeric', maxlength: 40, 'aria-label': 'BPM de ' + m.titulo });
    bpm.value = m.bpm || '';
    bpm.addEventListener('change', () => gravar(tdBpm, { bpm: bpm.value.trim() }, () => numeroBpm(m.bpm) != null));
    tdTom = celula(tomDaMusica(m), tom); tdNota = celula(m.primeiraNota, nota); tdBpm = celula(numeroBpm(m.bpm) != null, bpm);
    tdBpm.classList.add('num');
  } else {
    tdTom = el('td', {}, tomDaMusica(m) ? el('span', { class: 'rep-tom' }, tomDaMusica(m)) : '—');
    tdNota = el('td', {}, m.primeiraNota ? nomeNotaRep(m.primeiraNota) : '—');
    tdBpm = el('td', { class: 'num' }, m.bpm || '—');
  }
  return el('tr', { class: rep.tocando === m.id ? 'rep-tocando' : null, 'data-rep': m.id },
    el('td', {}, el('strong', {}, m.titulo), ...(situacao !== 'OK' ? [' ', el('span', { class: 'etiqueta' + (situacao === 'Inativo' ? '' : ' conflito') }, situacao)] : []),
      el('small', {}, m.cantor)),
    celulaVideoRepertorio(m, editar, { status, aoMudar }),
    tdTom, tdNota, tdBpm,
    el('td', {}, uso?.ultima ? dataUsoRep(uso.ultima) : el('span', { class: 'rep-apagado' }, 'nunca')),
    el('td', { class: 'num' }, String(uso?.vezes || 0)),
    el('td', { class: 'rep-acoes' }, editar ? botao('Editar', () => { rep.aberta = m.id; rep.tela = 'ficha'; desenharRepertorio(); }) : null));
}

/** "▶ Ouvir" quando há YouTube; senão, colar o link ali mesmo (grava assim que reconhece o vídeo). */
function celulaVideoRepertorio(m, editar, { status, aoMudar }) {
  const td = el('td', { class: 'rep-video' });
  function desenhar(colando = false) {
    const id = videoYoutube(m.referencia);
    td.className = 'rep-video' + (id ? '' : ' rep-faltando');
    if (id) {
      td.replaceChildren(el('button', { type: 'button', class: 'rep-yt-play', 'aria-label': 'Ouvir ' + m.titulo, onclick: () => tocarRepertorio(m) },
        el('span', { class: 'rep-tri', 'aria-hidden': 'true' }), 'Ouvir'));
      return;
    }
    const outro = ehLink(m.referencia) ? [el('a', { class: 'rep-outro', href: m.referencia, target: '_blank', rel: 'noopener noreferrer', title: m.referencia }, 'outro link')] : [];
    if (!editar) { td.replaceChildren(...(outro.length ? outro : ['—'])); return; }
    if (!colando) {
      td.replaceChildren(...outro, el('button', { type: 'button', class: 'rep-yt-colar', onclick: () => desenhar(true) }, '+ YouTube'));
      return;
    }
    const campo = el('input', { class: 'rep-yt-campo', placeholder: 'Cole o link do YouTube', 'aria-label': 'Link do YouTube de ' + m.titulo });
    let gravando = false;
    campo.addEventListener('keydown', (e) => { if (e.key === 'Escape') desenhar(); });
    campo.addEventListener('blur', () => setTimeout(() => { if (!gravando && td.contains(campo)) desenhar(); }, 200));
    campo.addEventListener('input', async () => {
      if (gravando || !videoYoutube(comHttpsRep(campo.value))) return;
      gravando = true;
      try {
        await salvarCampoRepertorio(m, { referencia: comHttpsRep(campo.value) });
        desenhar(); td.classList.add('rep-salvo'); setTimeout(() => td.classList.remove('rep-salvo'), 800); aoMudar();
      } catch (err) { gravando = false; mensagem(status, `${m.titulo}: ${err.message}`, false); }
    });
    td.replaceChildren(campo);
    campo.focus();
  }
  desenhar();
  return td;
}

function tocarRepertorio(m) {
  rep.tocando = rep.tocando === m.id ? null : m.id;
  desenharPlayerRepertorio();
  for (const tr of document.querySelectorAll('#repertorio-tabela tr.rep-tocando')) tr.classList.remove('rep-tocando');
  if (rep.tocando) for (const tr of document.querySelectorAll('#repertorio-tabela tr[data-rep]')) if (tr.dataset.rep === m.id) tr.classList.add('rep-tocando');
}

/** Player fixo no rodapé da lista: ouvir e acertar tom e nota na mesma tela. */
function desenharPlayerRepertorio() {
  const alvo = $('repertorio-player');
  if (!alvo) return;
  const m = repertorioMusicas.find((x) => x.id === rep.tocando);
  const id = m && videoYoutube(m.referencia);
  if (!id) { rep.tocando = null; alvo.replaceChildren(); return; }
  alvo.replaceChildren(el('div', { class: 'rep-player', role: 'region', 'aria-label': 'Vídeo em reprodução' },
    playerYoutube(id, m.titulo),
    el('div', { class: 'rep-player-texto' }, el('strong', {}, m.titulo),
      el('span', {}, `${m.cantor} · versão de referência · tom Diakonia ${tomDaMusica(m) ? nomeTomRep(tomDaMusica(m)) : 'não definido'}`)),
    el('a', { class: 'botao secundario pequeno', href: enderecoVideoRep(id), target: '_blank', rel: 'noopener noreferrer' }, 'Abrir no YouTube'),
    el('button', { type: 'button', class: 'rep-player-fechar', 'aria-label': 'Fechar vídeo', onclick: () => tocarRepertorio(m) }, '×')));
}

// ---------- Vídeo na ficha e no Completar ----------

/** Capa neutra com play (o player só carrega no clique); sem link, espaço para colar. */
function cartaoVideoRepertorio(d, aoMudar, { compacto = false } = {}) {
  const caixa = el('div');
  function desenhar() {
    const id = videoYoutube(d.referencia);
    if (id) {
      const capa = el('button', { type: 'button', class: 'rep-yt-capa', 'aria-label': 'Tocar a versão de referência' },
        el('span', { class: 'rep-yt-capa-play', 'aria-hidden': 'true' }, el('span', { class: 'rep-tri' })),
        el('span', { class: 'rep-yt-capa-legenda' }, d.titulo ? `${d.titulo} · ${d.cantor || ''}` : 'Versão de referência'));
      const tela = el('div', { class: 'rep-yt-tela' }, capa);
      capa.addEventListener('click', () => tela.replaceChildren(playerYoutube(id, d.titulo || 'versão de referência')));
      caixa.replaceChildren(el('div', { class: 'rep-yt-card' + (compacto ? ' compacto' : '') }, tela,
        el('div', { class: 'rep-yt-acoes' }, el('span', { class: 'rep-yt-selo' }, el('span', { class: 'rep-tri', 'aria-hidden': 'true' }), 'YouTube'),
          compacto ? null : el('code', {}, 'youtu.be/' + id), el('span', { class: 'espaco' }),
          el('a', { class: 'botao secundario pequeno', href: enderecoVideoRep(id), target: '_blank', rel: 'noopener noreferrer' }, 'Abrir no YouTube'),
          aoMudar ? botao('Trocar', () => { d.referencia = ''; desenhar(); aoMudar(); }) : null)));
      return;
    }
    if (!aoMudar) { caixa.replaceChildren(el('p', { class: 'dica' }, 'Sem vídeo da versão.')); return; }
    const campo = el('input', { placeholder: 'Cole aqui o link do YouTube (youtube.com/watch… ou youtu.be/…)', maxlength: 500, 'aria-label': 'Link do YouTube da versão de referência' });
    campo.value = d.referencia || '';
    const aviso = el('span', { class: 'dica' });
    const avisar = () => { aviso.textContent = d.referencia && !videoYoutube(d.referencia) ? 'Esse link não é do YouTube; ele fica guardado como referência.' : ''; };
    campo.addEventListener('input', () => { const t = comHttpsRep(campo.value); d.referencia = videoYoutube(t) ? t : campo.value.trim(); avisar(); if (videoYoutube(d.referencia)) { desenhar(); aoMudar(); } });
    avisar();
    caixa.replaceChildren(el('div', { class: 'rep-yt-vazio' + (compacto ? ' compacto' : '') },
      el('span', { class: 'rep-yt-icone grande', 'aria-hidden': 'true' }), el('strong', {}, 'Sem vídeo da versão'),
      el('span', { class: 'dica' }, 'A banda ensaia pela versão de referência. Cole o link do YouTube:'), campo, aviso));
  }
  desenhar();
  return caixa;
}

// ---------- Ficha em página ----------

const camposRepertorio = ['titulo', 'cantor', 'compositor', 'ano', 'bpm', 'tomOriginal', 'tomDiakonia',
  'referencia', 'solicitadoPor', 'observacoes', 'biografiaCantor', 'biografiaCompositor'];

function fichaRepertorio() {
  const m = rep.aberta ? repertorioMusicas.find((x) => x.id === rep.aberta) : null;
  if (rep.aberta && !m) { rep.tela = 'lista'; return desenharRepertorio(); }
  const d = Object.fromEntries(camposRepertorio.map((c) => [c, m?.[c] || '']));
  d.tomSelecionado = m ? tomDaMusica(m) : '';
  d.primeiraNota = m?.primeiraNota || '';
  d.status = m ? statusParaFiltro(m) : 'OK';
  const erro = el('p', { class: 'erro', role: 'alert' });
  const previa = el('div'), aviso = el('div'), dicaYoutube = el('p', { class: 'dica rep-largo', role: 'status' });
  const controles = {};
  let videoLido = videoYoutube(d.referencia); // a música aberta já tem o vídeo: não sugere de novo

  function atualizarPrevia() {
    previa.replaceChildren(el('div', { class: 'rep-previa' }, el('div', { class: 'rep-previa-cab' }, 'Como aparece no seletor da escala'),
      d.status === 'OK'
        ? el('div', { class: 'rep-previa-linha' },
          el('strong', {}, d.titulo || 'Título', videoYoutube(d.referencia) ? el('span', { class: 'rep-yt-icone mini', title: 'Tem vídeo' }) : null),
          d.tomSelecionado ? el('span', { class: 'rep-tom' }, d.tomSelecionado) : el('span', { class: 'dica' }, 'sem tom'),
          el('small', {}, [d.cantor || 'Cantor', numeroBpm(d.bpm) ? numeroBpm(d.bpm) + ' BPM' : ''].filter(Boolean).join(' · ')),
          el('small', {}, d.primeiraNota ? '1ª nota ' + nomeNotaRep(d.primeiraNota) : 'sem 1ª nota'))
        : el('p', { class: 'dica', style: 'margin:0;padding:10px 12px' }, `Não aparece: está "${d.status}". Só músicas OK entram na escala.`)));
  }
  function verificarDuplicada() {
    const titulo = normalizarBusca(d.titulo).trim();
    const achou = titulo.length >= 4 && repertorioMusicas.find((x) => x !== m && normalizarBusca(x.titulo).includes(titulo));
    aviso.replaceChildren(...(achou ? [el('p', { class: 'rep-aviso' }, `Já existe: ${achou.titulo} · ${achou.cantor}. `,
      el('button', { type: 'button', class: 'rep-link', onclick: () => { rep.aberta = achou.id; desenharRepertorio(); } }, 'Abrir'))] : []));
  }
  function campo(chave, rotulo, { largo = false, area = 0, max = 120, dica = '', numerico = false } = {}) {
    const controle = el(area ? 'textarea' : 'input', { id: 'rep-' + chave, maxlength: max, rows: area || null, inputmode: numerico ? 'numeric' : null });
    controle.value = d[chave];
    controles[chave] = controle;
    controle.addEventListener('input', () => { d[chave] = controle.value; atualizarPrevia(); if (chave === 'titulo') verificarDuplicada(); });
    return el('div', { class: 'campo' + (largo ? ' rep-largo' : '') }, el('label', { for: 'rep-' + chave }, rotulo, dica ? el('span', { class: 'dica' }, ' ' + dica) : null), controle);
  }
  /** Link novo do YouTube: preenche título e cantor que estiverem vazios, como sugestão para conferir. */
  async function sugerirDoYoutube() {
    const id = videoYoutube(d.referencia);
    if (!id || id === videoLido) return;
    videoLido = id;
    if (String(d.titulo).trim() && String(d.cantor).trim()) return;
    let info;
    try { info = await api('GET', '/api/repertorio/youtube?link=' + encodeURIComponent(d.referencia)); } catch (_) { return; } // a pessoa preenche à mão
    if (videoYoutube(d.referencia) !== id) return; // trocou o link enquanto o YouTube respondia
    const preenchidos = ['titulo', 'cantor'].filter((c) => info?.[c] && !String(d[c]).trim());
    for (const c of preenchidos) { d[c] = info[c]; controles[c].value = info[c]; }
    if (!preenchidos.length) return;
    dicaYoutube.textContent = `Preenchido pelo vídeo "${info.tituloVideo}"${info.canal ? ` (canal ${info.canal})` : ''}. Confira antes de salvar.`;
    atualizarPrevia(); verificarDuplicada();
  }
  const tom = el('select', { id: 'rep-tomSelecionado' }, ...TONS_REPERTORIO.map(([v, t]) => new Option(t, v)));
  tom.value = d.tomSelecionado;
  tom.addEventListener('change', () => { d.tomSelecionado = tom.value; atualizarPrevia(); });
  const notas = el('div', { class: 'rep-notas', role: 'group', 'aria-label': 'Primeira nota' });
  const desenharNotas = () => notas.replaceChildren(...NOTAS_REPERTORIO.map(([v, t]) => el('button', { type: 'button', title: t, 'aria-pressed': String(d.primeiraNota === v),
    onclick: () => { d.primeiraNota = d.primeiraNota === v ? '' : v; desenharNotas(); atualizarPrevia(); } }, nomeNotaRep(v))));
  desenharNotas();
  const situacoes = [['OK', 'Pronta para a escala'], ['Em análise', 'Pedido em avaliação; não aparece na escala'], ['Inativo', 'Saiu do repertório; o histórico continua']];
  const voltar = () => { rep.tela = 'lista'; desenharRepertorio(); };
  const salvar = el('button', { type: 'button', class: 'botao pequeno' }, 'Salvar');
  salvar.addEventListener('click', async () => {
    const corpo = Object.fromEntries(camposRepertorio.map((c) => [c, String(d[c] || '').trim()]));
    corpo.tomSelecionado = d.tomSelecionado;
    corpo.primeiraNota = d.primeiraNota;
    corpo.status = d.status;
    if (!corpo.titulo || !corpo.cantor) { mensagem(erro, 'Informe o título e o cantor.', false); return; }
    salvar.disabled = true;
    try {
      await api(m ? 'PUT' : 'POST', m ? '/api/repertorio/' + encodeURIComponent(m.id) : '/api/repertorio', corpo);
      rep.tela = 'lista';
      await carregarRepertorio();
      mensagem($('repertorio-resultado'), `${corpo.titulo} salva.`);
    } catch (err) { mensagem(erro, err.message, false); salvar.disabled = false; }
  });
  const uso = m && usoRep(m);
  $('repertorio-tela').replaceChildren(
    el('div', { class: 'barra' }, el('button', { type: 'button', class: 'rep-voltar', onclick: voltar }, '‹ Repertório'),
      el('h1', {}, m ? m.titulo : 'Nova música'), el('span', { class: 'espaco' }), botao('Cancelar', voltar), salvar),
    erro,
    el('div', { class: 'rep-pagina' },
      el('div', { class: 'rep-form' },
        el('section', { class: 'rep-bloco' }, el('h2', {}, 'Versão de referência'), cartaoVideoRepertorio(d, () => { atualizarPrevia(); sugerirDoYoutube(); })),
        el('section', { class: 'rep-bloco' }, el('h2', {}, '1 · Qual música'),
          el('div', { class: 'rep-grade' }, campo('titulo', 'Título', { largo: true }), el('div', { class: 'rep-largo' }, aviso), dicaYoutube,
            campo('cantor', 'Cantor / intérprete'), campo('compositor', 'Compositor', { max: 400 }))),
        el('section', { class: 'rep-bloco' }, el('h2', {}, '2 · Como a Diakonia toca'),
          el('div', { class: 'rep-grade3' }, el('div', { class: 'campo' }, el('label', { for: 'rep-tomSelecionado' }, 'Tom Diakonia'), tom),
            campo('bpm', 'BPM', { max: 40, numerico: true }), campo('tomOriginal', 'Tom original', { dica: '(da gravação)' })),
          el('div', { class: 'campo' }, el('span', { class: 'rep-rotulo' }, 'Primeira nota ', el('span', { class: 'dica' }, '(em que a voz entra, no tom Diakonia; acompanha a transposição)')), notas),
          campo('observacoes', 'Observações para a banda', { area: 2, max: 4000, largo: true })),
        el('details', { class: 'rep-bloco' }, el('summary', {}, '3 · Sobre a música (opcional)'),
          el('div', { class: 'rep-grade' }, campo('ano', 'Ano', { max: 40 }), campo('solicitadoPor', 'Pedida por'),
            campo('tomDiakonia', 'Anotações antigas do tom', { area: 2, max: 500, largo: true, dica: '(preservadas; não mudam o tom)' }),
            campo('biografiaCantor', 'Biografia do cantor', { area: 3, max: 10000, largo: true }),
            campo('biografiaCompositor', 'Biografia do compositor', { area: 3, max: 10000, largo: true })))),
      el('aside', { class: 'rep-lado' },
        el('section', { class: 'rep-bloco' }, el('h2', {}, 'Situação'),
          el('div', { class: 'rep-situacoes', role: 'radiogroup', 'aria-label': 'Situação' }, ...situacoes.map(([v, t]) => {
            const radio = el('input', { type: 'radio', name: 'rep-status', value: v });
            radio.checked = d.status === v;
            radio.addEventListener('change', () => { d.status = v; atualizarPrevia(); });
            return el('label', {}, radio, el('span', {}, el('strong', {}, v), el('small', {}, t)));
          }))),
        previa,
        m ? el('section', { class: 'rep-bloco' }, el('h2', {}, 'Na escala'), el('div', { class: 'rep-uso' },
          el('div', {}, el('b', {}, uso?.ultima ? dataUsoRep(uso.ultima) : 'Nunca'), el('span', {}, 'última vez')),
          el('div', {}, el('b', {}, String(uso?.vezes || 0)), el('span', {}, 'vezes em 12 meses')))) : null)));
  atualizarPrevia(); verificarDuplicada();
  globalThis.scrollTo?.(0, 0);
}

// ---------- Completar cadastro ----------

function completarRepertorio() {
  const m = rep.fila[rep.pos];
  if (!m) {
    rep.tela = 'lista';
    desenharRepertorio();
    mensagem($('repertorio-resultado'), 'Pronto: todas as músicas da fila foram revisadas.');
    return;
  }
  const d = { tomSelecionado: tomDaMusica(m), primeiraNota: m.primeiraNota || '', referencia: m.referencia || '', titulo: m.titulo, cantor: m.cantor };
  let menor = d.tomSelecionado.endsWith('m');
  const erro = el('p', { class: 'erro', role: 'alert' });
  const tons = el('div', { class: 'rep-notas rep-tons', role: 'group', 'aria-label': 'Tom Diakonia' });
  const notas = el('div', { class: 'rep-notas', role: 'group', 'aria-label': 'Primeira nota' });
  const desenharTons = () => tons.replaceChildren(...NOTAS_REPERTORIO.map(([v]) => {
    const valor = v + (menor ? 'm' : '');
    return el('button', { type: 'button', 'aria-pressed': String(d.tomSelecionado === valor), onclick: () => { d.tomSelecionado = d.tomSelecionado === valor ? '' : valor; desenharTons(); } }, nomeNotaRep(valor));
  }));
  const desenharNotas = () => notas.replaceChildren(...NOTAS_REPERTORIO.map(([v]) => el('button', { type: 'button', 'aria-pressed': String(d.primeiraNota === v),
    onclick: () => { d.primeiraNota = d.primeiraNota === v ? '' : v; desenharNotas(); } }, nomeNotaRep(v))));
  desenharTons(); desenharNotas();
  const menorCaixa = el('input', { type: 'checkbox' });
  menorCaixa.checked = menor;
  menorCaixa.addEventListener('change', () => { menor = menorCaixa.checked; if (d.tomSelecionado) d.tomSelecionado = d.tomSelecionado.replace(/m$/, '') + (menor ? 'm' : ''); desenharTons(); });
  const avancar = () => { rep.pos++; desenharRepertorio(); };
  const salvar = el('button', { type: 'button', class: 'botao' }, rep.pos + 1 < rep.fila.length ? 'Salvar e próxima →' : 'Salvar e terminar');
  salvar.addEventListener('click', async () => {
    const corpo = {};
    if (d.tomSelecionado !== tomDaMusica(m)) corpo.tomSelecionado = d.tomSelecionado;
    if (d.primeiraNota !== (m.primeiraNota || '')) corpo.primeiraNota = d.primeiraNota;
    if (d.referencia !== (m.referencia || '')) corpo.referencia = d.referencia;
    salvar.disabled = true;
    try { if (Object.keys(corpo).length) await salvarCampoRepertorio(m, corpo); avancar(); }
    catch (err) { mensagem(erro, err.message, false); salvar.disabled = false; }
  });
  $('repertorio-tela').replaceChildren(
    el('div', { class: 'barra' }, el('button', { type: 'button', class: 'rep-voltar', onclick: () => { rep.tela = 'lista'; desenharRepertorio(); } }, '‹ Repertório'),
      el('h1', {}, 'Completar cadastro'), el('span', { class: 'dica' }, `${rep.pos + 1} de ${rep.fila.length}`), el('span', { class: 'espaco' }),
      botao('Abrir ficha completa', () => { rep.aberta = m.id; rep.tela = 'ficha'; desenharRepertorio(); })),
    el('div', { class: 'rep-progresso', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.round(rep.pos / rep.fila.length * 100)}%` })),
    el('div', { class: 'rep-completar' },
      el('div', { class: 'rep-completar-campos' },
        el('div', {}, el('div', { class: 'rep-completar-titulo' }, m.titulo), el('p', { class: 'dica' }, `${m.cantor} · tom original ${m.tomOriginal || '—'}`)),
        el('div', {}, el('div', { class: 'rep-rotulo' }, 'Tom Diakonia ', el('label', { class: 'rep-menor' }, menorCaixa, ' menor')), tons),
        el('div', {}, el('div', { class: 'rep-rotulo' }, 'Primeira nota da voz'), notas)),
      el('div', {}, el('div', { class: 'rep-rotulo' }, 'Ouça enquanto preenche'), cartaoVideoRepertorio(d, () => {}, { compacto: true }))),
    erro,
    el('div', { class: 'barra rep-completar-acoes' }, el('span', { class: 'espaco' }), botao('Pular', avancar), salvar));
  globalThis.scrollTo?.(0, 0);
}

// ---------- Importação de CSV ----------

let csvRepertorio = '';
function abrirImportacaoRepertorio() {
  csvRepertorio = '';
  $('repertorio-arquivo').value = '';
  $('repertorio-previa').textContent = 'Selecione um CSV exportado da planilha.';
  $('repertorio-preview-lista').replaceChildren();
  $('repertorio-confirmar').disabled = true;
  $('repertorio-erro').hidden = true;
  $('dlg-importar-repertorio').showModal();
}
$('repertorio-arquivo').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  csvRepertorio = '';
  $('repertorio-confirmar').disabled = true;
  if (!arquivo) return;
  try {
    if (arquivo.size > 2 * 1024 * 1024) throw new Error('CSV grande demais (limite de 2 MB).');
    csvRepertorio = await lerArquivoCsv(arquivo);
    const previa = await api('POST', '/api/repertorio/importar/previa', { csv: csvRepertorio });
    $('repertorio-previa').textContent = `${previa.novas} novas · ${previa.links} já cadastradas ganham o link do vídeo · ` +
      `${previa.repetidas} já cadastradas (não serão alteradas).`;
    $('repertorio-preview-lista').replaceChildren(...previa.musicas.map((m) =>
      el('p', {}, `${m.titulo} — ${m.cantor} · ${m.ativo ? 'Ativa' : 'Inativa'}`)));
    $('repertorio-confirmar').disabled = !previa.novas && !previa.links;
    $('repertorio-erro').hidden = true;
  } catch (err) {
    mensagem($('repertorio-erro'), err.message, false);
    $('repertorio-erro').hidden = false;
  }
});
$('dlg-importar-repertorio').querySelector('form').addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancelar') return;
  e.preventDefault();
  $('repertorio-confirmar').disabled = true;
  try {
    const r = await api('POST', '/api/repertorio/importar', { csv: csvRepertorio });
    $('dlg-importar-repertorio').close();
    rep.tela = 'lista';
    await carregarRepertorio();
    mensagem($('repertorio-resultado'), `${r.importadas} músicas importadas; ${r.links} links preenchidos; ${r.repetidas} já cadastradas.`);
  } catch (err) {
    mensagem($('repertorio-erro'), err.message, false);
    $('repertorio-erro').hidden = false;
    $('repertorio-confirmar').disabled = false;
  }
});
