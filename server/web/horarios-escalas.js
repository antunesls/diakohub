// Mesmas regras de dia/hora de horariosDosCultos (diako_core).
function horariosParaEscalas(texto) {
  const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
  const horarios = new Map();
  for (const rotulo of texto.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const partes = rotulo.split(/\s*(?:—|–|\||\s-\s)\s*/);
    const dia = partes[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const semana = dias.findIndex((d) => dia.startsWith(d)) + 1;
    if (!semana) continue;
    for (const parte of partes.slice(1)) {
      const m = /^\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*(?:h|min)?\s*$/i.exec(parte);
      if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) continue;
      const chave = `${semana}@${m[1].padStart(2, '0')}:${(m[2] || '00').padStart(2, '0')}`;
      if (!horarios.has(chave)) horarios.set(chave, { chave, rotulo });
      break;
    }
  }
  return [...horarios.values()];
}

function cultosDaEscala(cultos, tipo) {
  return cultos.filter((c) => c[tipo === 'pastoral' ? 'escalaPastoral' : 'escalaLouvor'] !== false);
}

if (typeof module !== 'undefined') module.exports = { horariosParaEscalas, cultosDaEscala };
