'use strict';
// Texto de aviso para o grupo do WhatsApp (painel › Escalas e Minha Escala).
// O envio é sempre feito pela pessoa: o site só monta o texto, abre o WhatsApp ou copia.
// Nunca leva link do YouTube: o único link é o da Minha Escala, onde cada um ouve no modo ensaio.

/**
 * Aviso de UM culto.
 * [culto]: { titulo: 'Domingo, 29/11 · 9h', nome, ceia, tema }.
 * [escala]: título no cabeçalho ('Escala do louvor', 'Louvor').
 * [equipe]: [[função, [nomes]]] na ordem das funções; vazias ficam de fora.
 * [musicas]: [{ titulo, tom, primeiraNota }] ou null quando a escala não tem músicas.
 * [link]: endereço da Minha Escala ('' omite).
 */
function textoAvisoCulto({ culto, escala = '', equipe = [], musicas = null, link = '' }) {
  const linhas = [];
  const extras = [culto.ceia && 'Santa Ceia', culto.nome && culto.nome !== 'Culto' && culto.nome].filter(Boolean);
  linhas.push(`*${[escala, culto.titulo].filter(Boolean).join(' · ')}*${extras.length ? ` (${extras.join(' · ')})` : ''}`);
  if (culto.tema) linhas.push(`Tema: ${culto.tema}`);

  const pessoas = equipe.filter(([, nomes]) => nomes && nomes.length);
  if (pessoas.length) {
    linhas.push('');
    for (const [funcao, nomes] of pessoas) linhas.push(`${funcao}: ${nomes.join(', ')}`);
  }

  if (musicas && musicas.length) {
    linhas.push('', '*Músicas*');
    musicas.forEach((m, i) => {
      const detalhe = [m.tom && `tom ${m.tom}`, m.primeiraNota && `1ª nota ${m.primeiraNota}`].filter(Boolean).join(' · ');
      linhas.push(`${i + 1}. ${m.titulo}${detalhe ? ` — ${detalhe}` : ''}`);
    });
  } else if (musicas) {
    linhas.push('', 'Músicas: o ministro ainda vai escolher.');
  }

  if (link) {
    linhas.push('', musicas && musicas.length
      ? `Ouça e ensaie as músicas na Minha Escala: ${link}`
      : `Veja sua escala na Minha Escala: ${link}`);
  }
  return linhas.join('\n');
}

/** Texto do mês (montado pelo servidor) com o link da Minha Escala no fim; [comMusicas] só no louvor. */
function textoAvisoMes(texto, link, comMusicas = false) {
  if (!link) return texto;
  return `${texto}\n\n${comMusicas ? 'Veja sua escala e ouça as músicas' : 'Veja sua escala'} na Minha Escala: ${link}`;
}

/** Nome curto para o WhatsApp: primeiro e último nome ("Ana Maria Souza" → "Ana Souza"), como no texto do mês. */
function nomeCurtoAviso(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  return p.length <= 2 ? p.join(' ') : `${p[0]} ${p[p.length - 1]}`;
}

/** Link que abre o WhatsApp com o texto pronto (a pessoa escolhe o grupo). */
function linkWhatsappTexto(texto) {
  return 'https://wa.me/?text=' + encodeURIComponent(texto);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { textoAvisoCulto, textoAvisoMes, nomeCurtoAviso, linkWhatsappTexto };
