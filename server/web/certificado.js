// Certificado de batismo no painel: o mesmo PDF que o tablet gera (o servidor monta),
// com a assinatura e o carimbo salvos no servidor e quem assina. O PDF abre numa aba
// nova para imprimir, ou é baixado.
const Certificado = (() => {
  let membro = null;
  let config = { pastor: '', cargo: 'Pastor', assinatura: false, carimbo: false };
  const usar = { assinatura: false, carimbo: false };
  let urlPdf = null;
  let versao = 0; // muda a URL das prévias quando a imagem é trocada

  const IMAGENS = {
    assinatura: {
      titulo: 'Assinatura salva',
      dica: 'Envie a foto ou o scan de uma assinatura (ou desenhe no tablet). Ela fica salva para os próximos certificados.',
    },
    carimbo: {
      titulo: 'Carimbo da igreja',
      dica: 'De preferência PNG com fundo transparente. Também fica salvo.',
    },
  };

  const resultado = (texto, ok = true) => mensagem($('cert-resultado'), texto, ok);

  /** Esconde o "Baixar PDF" de um PDF que não vale mais. A URL só é liberada depois de
   *  um tempo: a aba aberta para imprimir ainda pode estar lendo o arquivo. */
  function limparPdf() {
    if (urlPdf) {
      const antiga = urlPdf;
      setTimeout(() => URL.revokeObjectURL(antiga), 120000);
    }
    urlPdf = null;
    $('cert-baixar').hidden = true;
  }

  function blocoImagem(tipo) {
    const info = IMAGENS[tipo];
    const existe = config[tipo];
    const marcar = el('input', { type: 'checkbox', disabled: !existe });
    marcar.checked = existe && usar[tipo];
    marcar.addEventListener('change', () => { usar[tipo] = marcar.checked; limparPdf(); });

    const arquivo = el('input', { type: 'file', accept: 'image/jpeg,image/png', class: 'escondido' });
    arquivo.addEventListener('change', () => {
      const f = arquivo.files[0];
      arquivo.value = '';
      if (f) enviar(tipo, f);
    });

    const previa = existe ? el('img', { alt: info.titulo, style: 'height:64px;max-width:180px;object-fit:contain;background:#fff;border:1px solid #ccc;border-radius:8px;padding:4px' }) : null;
    if (previa) {
      urlAutenticada(`/api/certificado/${tipo}?v=${versao}`).then((u) => { if (u) previa.src = u; }).catch(() => {});
    }

    return el('div', { style: 'border:1px solid var(--linha, #ccc);border-radius:8px;padding:10px 12px;margin-bottom:12px' },
      el('label', { class: 'marcar', style: 'margin:0' }, marcar,
        el('span', {}, el('strong', {}, info.titulo), ' — ', existe ? 'usar a imagem salva no certificado' : 'nenhuma imagem salva ainda')),
      el('p', { class: 'dica', style: 'margin:4px 0 8px' }, info.dica),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
        previa,
        el('label', { class: 'botao secundario pequeno', style: 'margin:0' }, existe ? 'Trocar imagem' : 'Enviar imagem', arquivo),
        existe ? el('button', { class: 'link', type: 'button', onclick: () => remover(tipo) }, 'Remover') : null));
  }

  function desenharImagens() {
    $('cert-imagens').replaceChildren(blocoImagem('assinatura'), blocoImagem('carimbo'));
  }

  async function enviar(tipo, arquivo) {
    if (arquivo.size > 10 * 1024 * 1024) return resultado('Imagem maior que 10 MB.', false);
    resultado('Enviando imagem…');
    try {
      await api('POST', `/api/certificado/${tipo}`, arquivo, { bruto: true, tipo: arquivo.type || 'application/octet-stream' });
      config[tipo] = true;
      usar[tipo] = true;
      versao++;
      limparPdf();
      desenharImagens();
      resultado('Imagem salva no servidor.');
    } catch (e) {
      resultado(e.message, false);
    }
  }

  async function remover(tipo) {
    if (!confirm(`Remover ${IMAGENS[tipo].titulo.toLowerCase()} do servidor? Ela deixa de valer também no tablet.`)) return;
    try {
      await api('DELETE', `/api/certificado/${tipo}`);
      config[tipo] = false;
      usar[tipo] = false;
      versao++;
      limparPdf();
      desenharImagens();
      resultado('Imagem removida.');
    } catch (e) {
      resultado(e.message, false);
    }
  }

  async function gerar() {
    const pastor = $('cert-pastor').value.trim();
    const cargo = $('cert-cargo').value.trim();
    const botao = $('cert-gerar');
    botao.disabled = true;
    limparPdf();
    resultado('Gerando o PDF…');
    // A aba é aberta já no clique: depois de esperar o servidor, o navegador bloquearia.
    const aba = window.open('', '_blank');
    if (aba) aba.document.title = 'Gerando o certificado…';
    try {
      // Deixa quem assina salvo para os próximos (falha aqui não impede o PDF).
      await api('PUT', '/api/certificado/config', { pastor, cargo: cargo || 'Pastor' }).catch(() => {});
      const q = new URLSearchParams();
      if (usar.assinatura) q.set('assinatura', '1');
      if (usar.carimbo) q.set('carimbo', '1');
      if (pastor) q.set('pastor', pastor);
      if (cargo) q.set('cargo', cargo);
      const r = await fetch(`/api/membros/${encodeURIComponent(membro.id)}/certificado-batismo?${q}`,
        { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 401) { sair(); throw new Error('Sessão expirada. Entre novamente.'); }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.erro || 'Erro ' + r.status + ' ao gerar o PDF.');
      }
      urlPdf = URL.createObjectURL(await r.blob());
      const nome = 'certificado-batismo-' + (membro.nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'membro') + '.pdf';
      const baixar = $('cert-baixar');
      baixar.href = urlPdf;
      baixar.download = nome;
      baixar.hidden = false;
      // Mostra na aba para imprimir; se o navegador bloqueou a aba, fica o "Baixar PDF".
      if (aba && !aba.closed) aba.location.href = urlPdf;
      resultado(aba ? 'PDF aberto numa aba nova: imprima por lá (Ctrl+P).'
        : 'PDF pronto. O navegador bloqueou a aba nova: use "Baixar PDF".');
    } catch (e) {
      if (aba && !aba.closed) aba.close();
      resultado(e.message, false);
    } finally {
      botao.disabled = false;
    }
  }

  async function abrir(m) {
    membro = m;
    limparPdf();
    $('cert-resumo').textContent = `${m.nome} · batismo em ${dataBr(m.dataBatismo)}`;
    $('cert-imagens').replaceChildren(el('p', { class: 'dica' }, 'Carregando…'));
    resultado('');
    $('cert-resultado').className = '';
    $('dlg-certificado').showModal();
    try {
      config = await api('GET', '/api/certificado/config');
      usar.assinatura = !!config.assinatura;
      usar.carimbo = !!config.carimbo;
      $('cert-pastor').value = config.pastor || '';
      $('cert-cargo').value = config.cargo || 'Pastor';
      desenharImagens();
    } catch (e) {
      $('cert-imagens').replaceChildren();
      resultado(e.message, false);
    }
  }

  $('cert-gerar').addEventListener('click', gerar);
  $('fechar-certificado').addEventListener('click', () => $('dlg-certificado').close());
  $('dlg-certificado').addEventListener('close', limparPdf);
  ['cert-pastor', 'cert-cargo'].forEach((id) => $(id).addEventListener('input', limparPdf));

  return { abrir };
})();
