'use strict';

/*
 * Músicas do culto: uma janela só, usada no painel (escala do louvor) e na Minha Escala (ministro).
 * À esquerda o repertório (busca, filtros de tom e andamento, tabela ordenável e prévia da música em
 * foco); à direita a ordem do culto, onde se arrasta, sobe, desce, troca o tom e tira música.
 * "+", Enter ou duplo clique adicionam no fim sem fechar a janela. Um Salvar só.
 *
 * Depende de repertorio-busca.js (busca, tom, BPM, 1ª nota) e, se carregado, de musica-youtube.js (miniatura).
 *
 * MusicasCulto.abrir({
 *   titulo: 'Dom 29/11 · 19h · Culto',
 *   musicas: [{ repertorioId, titulo, tom }],       // antigas sem vínculo vêm sem repertorioId
 *   repertorio: [{ id, titulo, cantor, compositor, tom, primeiraNota, bpm, ativo, ultima, vezes, minhaUltima, youtube }],
 *   editavel: true,
 *   playerUrl: '',                                  // link "Abrir no DiakoPlayer" (opcional)
 *   salvar: async (musicas) => {},                  // [{ repertorioId, titulo, tom }]; erro lançado aparece na janela
 * })
 */
(function () {
  function h(tag, props = {}, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false && f !== '') e.append(f);
    return e;
  }

  const COLUNAS = [
    ['titulo', 'Música'], ['tom', 'Tom'], ['bpm', 'BPM', 'num'], ['ultima', 'Última vez', 'col-uso'], ['vezes', '12 meses', 'num col-uso'],
  ];
  const ddmmaa = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : 'Nunca');

  /** Posição (1, 2…) da música do repertório na ordem; 0 se não está. */
  function posicao(musicas, id) {
    return musicas.findIndex((m) => m.repertorioId === id) + 1;
  }
  /** Põe a música no fim, no tom padrão; devolve a nova entrada (null se já está). */
  function adicionar(musicas, r) {
    if (posicao(musicas, r.id)) return null;
    const m = { repertorioId: r.id, titulo: r.titulo, tom: r.tom || '' };
    musicas.push(m);
    return m;
  }
  /** Leva a música da posição [de] para [para] (índices); devolve a música movida (null se não mexeu). */
  function mover(musicas, de, para) {
    if (para < 0 || para >= musicas.length || de === para || de < 0 || de >= musicas.length) return null;
    const [m] = musicas.splice(de, 1);
    musicas.splice(para, 0, m);
    return m;
  }

  const est = { cfg: null, musicas: [], mudou: false, movida: null, foco: null, chave: null, crescente: true, tom: '', andamento: '', recolhida: false };
  let ui = null;

  function montar() {
    const dlg = h('dialog', { id: 'dlg-musicas', class: 'musicas-culto', 'aria-labelledby': 'musicas-titulo' });
    const form = h('form', { method: 'dialog' });
    ui = {
      dlg,
      sub: h('p', { class: 'dica musicas-sub' }),
      busca: h('input', { id: 'musicas-busca', type: 'search', autocomplete: 'off', placeholder: 'Ex.: santo, intérprete ou compositor' }),
      tons: h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Tom' }),
      andamento: h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Andamento' }),
      contagem: h('p', { class: 'dica', role: 'status' }),
      cabecalho: h('thead'),
      lista: h('tbody'),
      previa: h('div', { class: 'previa', 'aria-live': 'polite' }),
      quantas: h('span', {}, '0'),
      ordem: h('ol', { class: 'ordem-lista', id: 'musicas-lista' }),
      recolher: h('button', { type: 'button', class: 'recolher' }, 'Recolher ▴'),
      erro: h('p', { class: 'erro', hidden: true }),
      status: h('span', { class: 'status', hidden: true }, 'Alterações ainda não salvas'),
      player: h('a', { class: 'botao secundario', target: 'diakoplayer', rel: 'noopener', hidden: true }, 'Abrir no DiakoPlayer'),
      cancelar: h('button', { class: 'botao secundario', value: 'cancelar', formnovalidate: true }, 'Cancelar'),
      salvar: h('button', { class: 'botao', value: 'salvar' }, 'Salvar'),
    };
    ui.tabela = h('div', { class: 'tabela', tabindex: '0', 'aria-label': 'Músicas do repertório. Setas para navegar, Enter adiciona ao culto.' },
      h('table', {}, ui.cabecalho, ui.lista));
    ui.painelOrdem = h('section', { class: 'ordem', 'aria-labelledby': 'musicas-ordem-titulo' },
      h('div', { class: 'ordem-topo' }, h('h3', { id: 'musicas-ordem-titulo' }, 'Ordem do culto · ', ui.quantas), ui.recolher),
      ui.ordem,
      h('p', { class: 'dica ordem-dica' }, 'Arraste ⠿ ou use ↑ ↓ para mudar a posição. O tom muda a 1ª nota junto.'));
    form.append(
      h('div', { class: 'musicas-topo' },
        h('div', {}, h('h2', { id: 'musicas-titulo' }, 'Músicas do culto'), ui.sub),
        h('button', { type: 'button', class: 'fechar', 'aria-label': 'Fechar', onclick: () => { if (podeSair()) dlg.close(); } }, '×')),
      h('div', { class: 'corpo' },
        h('div', { class: 'repertorio' },
          h('div', { class: 'campo' }, h('label', { for: 'musicas-busca' }, 'Pesquisar no repertório por título, cantor ou compositor'), ui.busca),
          h('div', { class: 'filtros' },
            h('div', {}, h('span', { class: 'rotulo' }, 'Tom'), ui.tons),
            h('div', {}, h('span', { class: 'rotulo' }, 'Andamento'), ui.andamento)),
          ui.contagem, ui.tabela, ui.previa),
        ui.painelOrdem),
      ui.erro,
      h('div', { class: 'acoes' },
        h('span', { class: 'dica atalhos' }, h('kbd', {}, '↑'), ' ', h('kbd', {}, '↓'), ' navegar · ', h('kbd', {}, 'Enter'), ' ou duplo clique adiciona · ', h('kbd', {}, 'Esc'), ' fecha'),
        ui.status, ui.player, ui.cancelar, ui.salvar));
    dlg.append(form);
    document.body.append(dlg);

    ui.busca.addEventListener('input', desenharRepertorio);
    ui.busca.addEventListener('keydown', teclas);
    ui.tabela.addEventListener('keydown', teclas);
    ui.recolher.addEventListener('click', () => { est.recolhida = !est.recolhida; desenharOrdem(); });
    ui.ordem.addEventListener('pointerdown', arrastar);
    // Fechar com alterações pendentes pede confirmação (Esc, × e Cancelar).
    dlg.addEventListener('cancel', (e) => { if (!podeSair()) e.preventDefault(); });
    ui.cancelar.addEventListener('click', (e) => { if (!podeSair()) e.preventDefault(); });
    form.addEventListener('submit', async (e) => {
      if (e.submitter === ui.cancelar) return;
      e.preventDefault();
      if (ui.salvar.disabled) return;
      ui.salvar.disabled = true;
      ui.erro.hidden = true;
      try {
        await est.cfg.salvar(est.musicas.map((m) => ({ ...m, tom: String(m.tom || '').trim() })));
        est.mudou = false;
        dlg.close();
      } catch (err) {
        ui.erro.textContent = err.message || 'Não foi possível salvar. Tente de novo.';
        ui.erro.hidden = false;
      } finally {
        ui.salvar.disabled = false;
      }
    });
  }

  const podeSair = () => !est.mudou || confirm('Sair sem salvar as músicas?');
  const repertorio = () => est.cfg.repertorio;
  const ativas = () => repertorio().filter((r) => r.ativo !== false);
  const doRepertorio = (id) => repertorio().find((r) => r.id === id);
  const nota = (r, tom) => {
    const n = r?.primeiraNota ? primeiraNotaNoTom(r.primeiraNota, r.tom, tom) : '';
    return n ? `1ª nota ${n}` : '';
  };

  function mudou(movida = null) {
    est.mudou = true;
    est.movida = movida;
    desenharOrdem();
    desenharRepertorio();
  }
  function adicionarMusica(r) {
    if (!est.cfg.editavel) return;
    const m = adicionar(est.musicas, r);
    if (m) mudou(m);
  }
  function moverMusica(de, para) {
    const m = mover(est.musicas, de, para);
    if (m) mudou(m); else desenharOrdem();
  }

  function filtradas() {
    const valor = {
      titulo: (r) => r.titulo, tom: (r) => r.tom || '', bpm: (r) => numeroBpm(r.bpm) ?? -1,
      ultima: (r) => r.ultima || '', vezes: (r) => r.vezes || 0,
    };
    const lista = buscarRepertorio(ativas().map((r) => ({ compositor: '', ...r })), { busca: ui.busca.value })
      .filter((r) => (!est.tom || r.tom === est.tom) && (!est.andamento || andamentoBpm(r.bpm) === est.andamento));
    // Sem coluna escolhida vale a ordem da busca (mais parecida primeiro, depois título).
    if (!est.chave) return lista;
    const v = valor[est.chave];
    return lista.sort((a, b) => {
      const x = v(a), y = v(b);
      const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
      return (est.crescente ? c : -c) || a.titulo.localeCompare(b.titulo, 'pt-BR');
    });
  }

  function chips(caixa, nome, opcoes, atual, mudar) {
    caixa.replaceChildren(...opcoes.map(([valor, texto]) => {
      const radio = h('input', { type: 'radio', name: nome, value: valor });
      radio.checked = valor === atual;
      radio.addEventListener('change', () => mudar(valor));
      return h('label', {}, radio, texto);
    }));
  }

  function desenharRepertorio() {
    const todas = ativas();
    const tons = [...new Set(todas.map((r) => r.tom).filter(Boolean))].sort((a, b) => (semitomDaNota(a) - semitomDaNota(b)) || a.localeCompare(b));
    chips(ui.tons, 'musicas-tom', [['', 'Todos'], ...tons.map((t) => [t, t])], est.tom, (v) => { est.tom = v; desenharRepertorio(); });
    chips(ui.andamento, 'musicas-andamento', [['', 'Todos'], ['Lenta', 'Lenta'], ['Média', 'Média'], ['Rápida', 'Rápida']], est.andamento,
      (v) => { est.andamento = v; desenharRepertorio(); });
    ui.cabecalho.replaceChildren(h('tr', {}, ...COLUNAS.map(([chave, nome, classe]) => {
      const ativa = est.chave === chave;
      return h('th', { class: classe || null, 'aria-sort': ativa ? (est.crescente ? 'ascending' : 'descending') : 'none' },
        h('button', { type: 'button', onclick: () => {
          // Última vez e 12 meses abrem do maior para o menor; as outras em ordem alfabética.
          est.crescente = ativa ? !est.crescente : !['ultima', 'vezes'].includes(chave);
          est.chave = chave;
          desenharRepertorio();
        } }, nome + (ativa ? (est.crescente ? ' ↑' : ' ↓') : '')));
    }), h('th', { class: 'acao' }, h('span', { class: 'invisivel' }, 'Adicionar'))));

    const lista = filtradas();
    if (!lista.some((r) => r.id === est.foco)) est.foco = lista[0]?.id ?? null;
    ui.contagem.textContent = `${lista.length} de ${todas.length} ${todas.length === 1 ? 'música disponível' : 'músicas disponíveis'}.`;
    const rolagem = ui.tabela.scrollTop;
    ui.lista.replaceChildren(...(lista.length ? lista.map((r) => {
      const pos = posicao(est.musicas, r.id);
      const linha = h('tr', { 'aria-selected': String(r.id === est.foco), 'data-id': r.id },
        h('td', {}, h('strong', {}, r.titulo, pos ? h('span', { class: 'no-culto' }, `${pos}ª no culto`) : null), h('small', {}, r.cantor)),
        h('td', {}, r.tom ? h('span', { class: 'tom-musica' }, r.tom) : '—'),
        h('td', { class: 'num' }, numeroBpm(r.bpm) ?? '—'),
        h('td', { class: 'col-uso' }, ddmmaa(r.ultima)),
        h('td', { class: 'num col-uso' }, r.vezes || 0),
        h('td', { class: 'acao' }, !est.cfg.editavel ? null : pos ? h('span', { class: 'ja', title: 'Já está no culto' }, '✓')
          : h('button', { type: 'button', class: 'adicionar', 'aria-label': `Adicionar ${r.titulo} ao culto`,
            onclick: (e) => { e.stopPropagation(); est.foco = r.id; adicionarMusica(r); } }, '+')));
      linha.addEventListener('click', () => { est.foco = r.id; desenharRepertorio(); });
      linha.addEventListener('dblclick', () => adicionarMusica(r));
      return linha;
    }) : [h('tr', {}, h('td', { colspan: '6', class: 'dica' }, 'Nenhuma música com essa busca ou filtro. Se faltar alguma, peça para incluir no Repertório.'))]));
    // Mantém a rolagem e rola só a tabela até a música em foco (scrollIntoView rolaria a janela junto).
    ui.tabela.scrollTop = rolagem;
    const sel = ui.lista.querySelector('[aria-selected="true"]');
    if (sel) {
      const topo = ui.cabecalho.offsetHeight;
      if (sel.offsetTop - topo < ui.tabela.scrollTop) ui.tabela.scrollTop = sel.offsetTop - topo;
      else if (sel.offsetTop + sel.offsetHeight > ui.tabela.scrollTop + ui.tabela.clientHeight) ui.tabela.scrollTop = sel.offsetTop + sel.offsetHeight - ui.tabela.clientHeight;
    }
    desenharPrevia(lista.find((r) => r.id === est.foco));
  }

  function desenharPrevia(r) {
    if (!r) { ui.previa.replaceChildren(h('p', { class: 'dica' }, 'Escolha uma música na lista para ver os detalhes.')); return; }
    const thumb = r.youtube && typeof miniaturaYoutube === 'function' ? miniaturaYoutube(r.youtube) : null;
    const pos = posicao(est.musicas, r.id);
    const dados = [
      ['Tom', r.tom || 'Não definido'],
      ['1ª nota', r.primeiraNota || '—'],
      ['Andamento', numeroBpm(r.bpm) ? `${numeroBpm(r.bpm)} BPM · ${andamentoBpm(r.bpm)}` : 'Sem BPM'],
      ['Última vez', ddmmaa(r.ultima)],
      r.minhaUltima ? ['Você tocou', ddmmaa(r.minhaUltima)] : null,
    ].filter(Boolean);
    ui.previa.replaceChildren(...[
      thumb ? h('img', { src: thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      h('div', { class: 'previa-texto' },
        h('strong', { class: 'titulo' }, r.titulo),
        h('span', { class: 'dica' }, [r.cantor, r.compositor].filter(Boolean).join(' · ')),
        h('span', { class: 'previa-dados' }, ...dados.map(([rotulo, valor]) => h('span', {}, rotulo + ' ', h('b', {}, valor)))),
        r.youtube ? h('a', { href: r.youtube, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvir no YouTube ↗') : null),
      !est.cfg.editavel ? null
        : pos ? h('span', { class: 'ja' }, `✓ ${pos}ª no culto`)
          : h('button', { type: 'button', class: 'botao pequeno', onclick: () => adicionarMusica(r) }, r.tom ? `+ Adicionar · tom ${r.tom}` : '+ Adicionar ao culto'),
    ].filter(Boolean));
  }

  /** Seletor de tom da linha; um tom gravado fora da lista (ex.: "G/B") continua como opção. */
  function seletorTom(valor, rotulo, aoMudar) {
    const tons = TONS_REPERTORIO.map(([t]) => t).filter(Boolean);
    const opcoes = valor && !tons.includes(valor) ? [valor, ...tons] : tons;
    const s = h('select', { class: 'tom', 'aria-label': rotulo, onchange: () => aoMudar(s.value) },
      h('option', { value: '' }, 'Tom'), ...opcoes.map((t) => h('option', { value: t }, t)));
    s.value = valor || '';
    return s;
  }

  function desenharOrdem() {
    const { musicas } = est;
    const editavel = est.cfg.editavel;
    ui.quantas.textContent = String(musicas.length);
    ui.status.hidden = !est.mudou;
    ui.painelOrdem.dataset.recolhida = String(est.recolhida);
    ui.recolher.textContent = est.recolhida ? 'Mostrar ▾' : 'Recolher ▴';
    const linhas = musicas.map((m, i) => {
      const r = m.repertorioId ? doRepertorio(m.repertorioId) : null;
      const titulo = r?.titulo || m.titulo || 'Música';
      const situacao = !m.repertorioId ? 'antiga, sem vínculo com o repertório' : !r ? 'fora do repertório' : r.ativo === false ? 'inativa' : '';
      const n = nota(r, m.tom);
      // Música antiga (sem vínculo) mantém o tom gravado: o servidor só aceita ela como estava.
      const tom = editavel && m.repertorioId
        ? seletorTom(m.tom, `Tom de ${titulo}`, (v) => { m.tom = v; mudou(); })
        : h('span', { class: 'tom-musica' }, m.tom || '—');
      return h('li', { class: 'item' + (est.movida === m ? ' movida' : '') },
        editavel ? h('span', { class: 'alca', title: 'Arraste para mudar a posição', 'aria-hidden': 'true' }, '⠿') : null,
        h('span', { class: 'numero' }, String(i + 1)),
        h('div', { class: 'txt', onclick: r ? () => { est.foco = r.id; desenharRepertorio(); } : null },
          h('strong', {}, titulo),
          situacao ? h('small', {}, situacao) : r ? h('small', {}, r.cantor) : null,
          n ? h('small', { class: 'primeira-nota' }, n) : null),
        h('div', { class: 'controles' }, tom,
          editavel ? h('button', { type: 'button', class: 'icone', disabled: i === 0, 'aria-label': `Subir ${titulo}`, onclick: () => moverMusica(i, i - 1) }, '↑') : null,
          editavel ? h('button', { type: 'button', class: 'icone', disabled: i === musicas.length - 1, 'aria-label': `Descer ${titulo}`, onclick: () => moverMusica(i, i + 1) }, '↓') : null,
          editavel ? h('button', { type: 'button', class: 'icone tirar', 'aria-label': `Tirar ${titulo}`, onclick: () => { musicas.splice(i, 1); mudou(); } }, '×') : null));
    });
    ui.ordem.replaceChildren(...(linhas.length ? linhas : [h('li', { class: 'vazio' },
      editavel ? 'Nenhuma música ainda. Toque em + numa música do repertório.' : 'Nenhuma música escolhida.')]));
    est.movida = null;
  }

  // Arrastar pela alça ⠿, com mouse ou dedo: a linha segue o ponteiro e a ordem muda ao soltar.
  // Escuta no document: mover a linha no DOM solta o pointer capture da alça.
  function arrastar(e) {
    const alca = e.target.closest('.alca');
    if (!alca || !est.cfg.editavel) return;
    e.preventDefault();
    const item = alca.closest('li');
    const de = [...ui.ordem.children].indexOf(item);
    item.classList.add('arrastando');
    const seguir = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const outros = [...ui.ordem.children].filter((li) => li !== item);
      const depois = outros.find((li) => { const b = li.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }) || null;
      if (item.nextElementSibling !== depois) ui.ordem.insertBefore(item, depois);
    };
    const soltar = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      document.removeEventListener('pointermove', seguir);
      document.removeEventListener('pointerup', soltar);
      document.removeEventListener('pointercancel', soltar);
      item.classList.remove('arrastando');
      moverMusica(de, [...ui.ordem.children].indexOf(item));
    };
    document.addEventListener('pointermove', seguir);
    document.addEventListener('pointerup', soltar);
    document.addEventListener('pointercancel', soltar);
  }

  // Setas andam pela tabela mesmo com o foco na busca; Enter adiciona a música em foco (nunca salva a janela).
  function teclas(e) {
    const lista = filtradas();
    const i = lista.findIndex((r) => r.id === est.foco);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const proxima = lista[Math.min(lista.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (proxima) { est.foco = proxima.id; desenharRepertorio(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (lista[i]) adicionarMusica(lista[i]);
    }
  }

  function abrir(cfg) {
    if (!ui) montar();
    Object.assign(est, {
      cfg: { editavel: true, repertorio: [], ...cfg }, mudou: false, movida: null, foco: null, tom: '', andamento: '', recolhida: false,
      musicas: (cfg.musicas || []).map((m) => (m.repertorioId
        ? { repertorioId: m.repertorioId, titulo: m.titulo || '', tom: m.tom || '' }
        : { titulo: m.titulo, tom: m.tom || '' })),
    });
    ui.sub.textContent = cfg.titulo || '';
    ui.dlg.classList.toggle('so-leitura', !est.cfg.editavel);
    ui.salvar.hidden = !est.cfg.editavel;
    ui.cancelar.textContent = est.cfg.editavel ? 'Cancelar' : 'Fechar';
    ui.player.hidden = !cfg.playerUrl;
    if (cfg.playerUrl) ui.player.href = cfg.playerUrl;
    ui.erro.hidden = true;
    ui.busca.value = '';
    desenharOrdem();
    desenharRepertorio();
    ui.dlg.showModal();
    ui.tabela.scrollTop = 0;
    if (est.cfg.editavel && matchMedia('(min-width: 761px)').matches) ui.busca.focus();
  }

  const api = { abrir, posicao, adicionar, mover };
  if (typeof window !== 'undefined') window.MusicasCulto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
