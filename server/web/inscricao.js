'use strict';

// Página pública de inscrição em encontro (/inscricao/<código>) e de cancelamento pelo link do
// e-mail (/inscricao/cancelar?token=…). Não mostra quem já se inscreveu.
(function () {
  const $ = (id) => document.getElementById(id);
  const mostrar = (id) => { $('carregando').hidden = true; $(id).hidden = false; };

  /** "2026-12-12T19:30" → "12/12/2026 às 19:30" (lê o texto, sem fuso). */
  function quando(iso) {
    if (!iso) return '';
    const [dia, hora] = String(iso).split('T');
    const data = dia.split('-').reverse().join('/');
    return hora ? `${data} às ${hora.slice(0, 5)}` : data;
  }
  function periodo(e) {
    if (!e.fim) return quando(e.inicio);
    const [d1] = String(e.inicio).split('T'); const [d2, h2] = String(e.fim).split('T');
    return d1 === d2 && h2 ? `${quando(e.inicio)}–${h2.slice(0, 5)}` : `${quando(e.inicio)} até ${quando(e.fim)}`;
  }

  async function chamar(metodo, url, corpo) {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const erro = new Error(j.erro || 'Não foi possível concluir. Tente novamente.'); erro.status = r.status; throw erro; }
    return j;
  }

  fetch('/api/public/site').then(r => r.ok ? r.json() : null).then(s => {
    if (s?.nomeIgreja) document.title = document.title.replace('DiakoHub', s.nomeIgreja);
  }).catch(() => {});

  // ---------- Cancelamento ----------
  if (location.pathname.replace(/\/$/, '') === '/inscricao/cancelar') {
    const token = new URLSearchParams(location.search).get('token') || '';
    // Tira o token da barra de endereço (e do histórico) depois de lido.
    history.replaceState(null, '', '/inscricao/cancelar');
    const desenhar = (i) => {
      $('cancelamento-dados').textContent = `${i.nome || ''} · ${i.titulo} · ${quando(i.inicio)}${i.local ? ' · ' + i.local : ''} · ${i.pessoas} ${i.pessoas === 1 ? 'pessoa' : 'pessoas'}`;
      $('cancelamento-estado').textContent = { confirmada: 'Inscrição confirmada.', espera: 'Na lista de espera.', cancelada: 'Inscrição cancelada. A vaga foi liberada.' }[i.estado] || '';
      $('cancelar').hidden = i.estado === 'cancelada';
    };
    chamar('POST', '/api/public/inscricoes/consultar', { token }).then((i) => { desenhar(i); mostrar('cancelamento'); })
      .catch((e) => { $('cancelamento-erro').textContent = e.message; $('cancelamento-erro').hidden = false; mostrar('cancelamento'); });
    $('cancelar').addEventListener('click', async () => {
      if (!confirm('Cancelar a sua inscrição? A vaga será liberada.')) return;
      $('cancelar').disabled = true;
      try { desenhar(await chamar('POST', '/api/public/inscricoes/cancelar', { token })); }
      catch (e) { $('cancelamento-erro').textContent = e.message; $('cancelamento-erro').hidden = false; }
      finally { $('cancelar').disabled = false; }
    });
    return;
  }

  // ---------- Inscrição ----------
  const codigo = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');

  function novoAcompanhante() {
    const linha = document.createElement('div');
    linha.className = 'acompanhante';
    const nome = document.createElement('input');
    nome.type = 'text'; nome.maxLength = 120; nome.placeholder = 'Nome do acompanhante'; nome.setAttribute('aria-label', 'Nome do acompanhante');
    const marcar = document.createElement('label'); marcar.className = 'marcar';
    const crianca = document.createElement('input'); crianca.type = 'checkbox';
    marcar.append(crianca, ' Criança');
    const remover = document.createElement('button');
    remover.type = 'button'; remover.className = 'botao secundario pequeno'; remover.textContent = 'Remover';
    remover.addEventListener('click', () => linha.remove());
    linha.append(nome, marcar, remover);
    $('acompanhantes').append(linha);
    nome.focus();
  }
  $('mais-acompanhante').addEventListener('click', novoAcompanhante);

  chamar('GET', '/api/public/inscricao/' + encodeURIComponent(codigo)).then((e) => {
    document.title = `Inscrição: ${e.titulo} — DiakoHub`;
    $('titulo').textContent = e.titulo;
    $('quando').textContent = periodo(e);
    $('local').textContent = e.local || '';
    $('descricao').textContent = e.descricao || '';
    $('vagas').textContent = e.vagasRestantes == null ? ''
      : e.vagasRestantes > 0 ? `${e.vagasRestantes} ${e.vagasRestantes === 1 ? 'vaga disponível' : 'vagas disponíveis'}`
        : 'Vagas preenchidas: novas inscrições entram na lista de espera.';
    if (e.ate) $('vagas').textContent += `${$('vagas').textContent ? ' · ' : ''}Inscrições até ${quando(e.ate)}`;
    $('texto-consentimento').textContent = e.consentimento;
    if (e.pergunta) { $('pergunta').textContent = e.pergunta; $('campo-pergunta').hidden = false; }
    if (e.aberto) $('form').hidden = false;
    else { $('fechado').textContent = e.motivo || 'As inscrições não estão abertas.'; $('fechado').hidden = false; }
    mostrar('encontro');
  }).catch(() => mostrar('nao-encontrado'));

  $('form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    $('erro').hidden = true;
    $('enviar').disabled = true;
    try {
      const acompanhantes = [...$('acompanhantes').querySelectorAll('.acompanhante')]
        .map((l) => ({ nome: l.querySelector('input[type=text]').value.trim(), crianca: l.querySelector('input[type=checkbox]').checked }))
        .filter((a) => a.nome);
      const r = await chamar('POST', '/api/public/inscricao/' + encodeURIComponent(codigo), {
        nome: $('nome').value, whatsapp: $('whatsapp').value, email: $('email').value || null,
        acompanhantes, resposta: $('campo-pergunta').hidden ? undefined : $('resposta').value,
        consentimento: $('consentimento').checked, website: $('website').value,
      });
      $('encontro').hidden = true;
      const pessoas = r.pessoas ? `${r.pessoas} ${r.pessoas === 1 ? 'pessoa' : 'pessoas'}` : '';
      if (r.estado === 'espera') {
        $('obrigado-titulo').textContent = 'Você está na lista de espera';
        $('obrigado-texto').textContent = `As vagas estão preenchidas. Se abrir vaga, a equipe confirma a sua inscrição (${pessoas}).` +
          (r.emailEnviado ? ' Enviamos os detalhes para o seu e-mail.' : '');
      } else {
        $('obrigado-titulo').textContent = 'Inscrição confirmada!';
        $('obrigado-texto').textContent = `Esperamos você (${pessoas}).` +
          (r.emailEnviado ? ' Enviamos a confirmação para o seu e-mail, com um link para cancelar se precisar.' : ' Se não puder ir, avise a equipe.');
      }
      $('obrigado').hidden = false;
      window.scrollTo(0, 0);
    } catch (e) {
      $('erro').textContent = e.message || 'Sem conexão. Tente novamente.';
      $('erro').hidden = false;
    } finally { $('enviar').disabled = false; }
  });
})();
