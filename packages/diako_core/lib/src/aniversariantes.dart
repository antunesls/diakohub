import 'membro.dart';
import 'recado.dart';

const idRecadoAniversariantes = 'auto-aniversariantes';
const idRecadoCasamentos = 'auto-casamentos';

/// Domingo a sábado da semana de [hoje].
List<DateTime> diasDaSemana(DateTime hoje) {
  final base = DateTime(hoje.year, hoje.month, hoje.day);
  final domingo = base.subtract(Duration(days: base.weekday % 7));
  return [for (var i = 0; i < 7; i++) DateTime(domingo.year, domingo.month, domingo.day + i)];
}

bool _bissexto(int ano) => (ano % 4 == 0 && ano % 100 != 0) || ano % 400 == 0;

/// Pode ter o nome divulgado (telão, mural, resumo): membro ou congregado (não visitante) e com autorização da LGPD
/// vigente. A revogação apaga [Membro.consentimentoEm]; quem autoriza de novo volta.
bool podeDivulgarAniversario(Membro m) => m.ativo && Membro.dataDe(m.consentimentoEm) != null;

/// Pessoas que podem ser divulgadas ([podeDivulgarAniversario]) e fazem aniversário
/// na semana de [hoje], em ordem de data.
/// Quem nasceu em 29/02 comemora em 28/02 nos anos não bissextos.
List<({Membro membro, DateTime data})> aniversariantesDaSemana(List<Membro> membros, DateTime hoje) {
  final resultado = <({Membro membro, DateTime data})>[];
  for (final dia in diasDaSemana(hoje)) {
    for (final m in membros) {
      if (!podeDivulgarAniversario(m)) continue;
      // Visitante que não informou o aniversário fica fora (sem data para comemorar).
      if (m.dia == null || m.mes == null) continue;
      var (d, mes) = (m.dia!, m.mes!);
      if (d == 29 && mes == 2 && !_bissexto(dia.year)) d = 28;
      if (d == dia.day && mes == dia.month) resultado.add((membro: m, data: dia));
    }
  }
  return resultado;
}

/// Recado automático "Aniversariantes da semana", ou null se não houver ninguém.
Recado? recadoAniversariantes(List<Membro> membros, DateTime hoje) {
  final lista = aniversariantesDaSemana(membros, hoje);
  if (lista.isEmpty) return null;
  String dm(DateTime d) => '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  return Recado(
    id: idRecadoAniversariantes,
    titulo: 'Aniversariantes da semana',
    texto: lista.map((a) => '${a.membro.nome} (${dm(a.data)})').join('\n'),
    categoria: Categoria.aniversario,
    fixo: true,
    ordem: -1,
    auto: true,
  );
}

/// Segue a mesma semana e as regras de divulgação dos aniversariantes.
/// A autorização específica do casal é adicional à LGPD de cada cadastrado.
Recado? recadoCasamentos(List<Membro> membros, DateTime hoje) {
  final porId = {for (final m in membros) m.id: m};
  final vistos = <String>{};
  final linhas = <String>[];
  bool elegivel(Membro m) {
    final civil = semAcento((m.estadoCivil ?? '').toLowerCase()) ?? '';
    return podeDivulgarAniversario(m) && m.casamentoAutorizado && m.casamentoConsentimento != null &&
        (civil.isEmpty || civil.startsWith('casad') || civil == 'uniao estavel');
  }
  for (final dia in diasDaSemana(hoje)) {
    for (final m in membros) {
      if (!elegivel(m) || m.dataCasamento == null) continue;
      final casamento = DateTime.tryParse(m.dataCasamento!);
      if (casamento == null) continue;
      var d = casamento.day;
      if (d == 29 && casamento.month == 2 && !_bissexto(dia.year)) d = 28;
      final anos = dia.year - casamento.year;
      if (d != dia.day || casamento.month != dia.month || anos < 1) continue;
      String nome;
      String chave;
      if (m.conjugeId != null) {
        final outro = porId[m.conjugeId];
        if (outro == null || outro.conjugeId != m.id || !elegivel(outro) || outro.dataCasamento != m.dataCasamento) continue;
        final ids = [m.id, outro.id]..sort();
        chave = ids.join('|');
        nome = '${m.nome} e ${outro.nome}';
      } else {
        if ((m.conjugeNome ?? '').isEmpty) continue;
        chave = m.id;
        nome = '${m.nome} e ${m.conjugeNome}';
      }
      if (!vistos.add(chave)) continue;
      final data = '${dia.day.toString().padLeft(2, '0')}/${dia.month.toString().padLeft(2, '0')}';
      linhas.add('$nome ($data) · $anos ${anos == 1 ? 'ano' : 'anos'}');
    }
  }
  if (linhas.isEmpty) return null;
  return Recado(id: idRecadoCasamentos, titulo: 'Aniversários de casamento da semana',
      texto: linhas.join('\n'), categoria: Categoria.aniversario, fixo: true, ordem: 0, auto: true);
}
