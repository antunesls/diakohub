// As escalas do culto (mesma ordem e nomes de TipoEscala, no diako_core). `campo` é o que o culto
// grava quando não participa da escala ("escalaPastoral": false).
const TIPOS_ESCALA = [
  { id: 'pastoral', nome: 'Pastoral', titulo: 'Escala pastoral', campo: 'escalaPastoral',
    funcoes: ['Direção', 'Pregação', 'Oração e ofertas', 'Santa Ceia'] },
  { id: 'louvor', nome: 'Louvor', titulo: 'Escala do louvor', campo: 'escalaLouvor',
    funcoes: ['Ministro', 'Vocal', 'Teclado', 'Violão', 'Guitarra', 'Baixo', 'Bateria', 'Técnico de som', 'Projeção'] },
  { id: 'infantil', nome: 'Infantil', titulo: 'Escala do infantil', campo: 'escalaInfantil',
    funcoes: ['Professor(a)', 'Auxiliar', 'Berçário'] },
  { id: 'recepcao', nome: 'Recepção', titulo: 'Escala da recepção', campo: 'escalaRecepcao',
    funcoes: ['Porta', 'Boas-vindas', 'Estacionamento', 'Café'] },
];

const tipoEscala = (id) => TIPOS_ESCALA.find((t) => t.id === id);

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
  const campo = tipoEscala(tipo)?.campo;
  return cultos.filter((c) => !campo || c[campo] !== false);
}

if (typeof module !== 'undefined') module.exports = { TIPOS_ESCALA, tipoEscala, horariosParaEscalas, cultosDaEscala };
