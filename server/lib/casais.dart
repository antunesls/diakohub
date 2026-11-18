import 'package:diako_core/diako_core.dart';

/// Visão interna do cadastro existente, sem criar pessoas ou expor fichas completas.
Map<String, dynamic> consultarCasais(List<Membro> membros, {required int mes, required int ano}) {
  if (mes < 1 || mes > 12 || ano < 1900 || ano > 2200) {
    throw const FormatException('Informe mês de 1 a 12 e ano de 1900 a 2200.');
  }
  final porId = {for (final m in membros) m.id: m};
  final vistos = <String>{};
  final casais = <Map<String, dynamic>>[];
  bool elegivel(Membro m) {
    final civil = semAcento(m.estadoCivil?.trim().toLowerCase()) ?? '';
    return m.ativo && (civil.isEmpty || civil.startsWith('casad') || civil == 'uniao estavel');
  }
  Map<String, dynamic> contato(Membro m) => {
    'membroId': m.id, 'nome': m.nome,
    if (Membro.dataDe(m.consentimentoEm) != null) ...{
      if (m.telefone != null) 'telefone': m.telefone,
      if (m.whatsapp != null) 'whatsapp': m.whatsapp,
      if (m.email != null) 'email': m.email,
    },
  };
  for (final m in membros) {
    if (!elegivel(m)) continue;
    final iso = Membro.dataDe(m.dataCasamento);
    if (iso == null) continue;
    final casamento = DateTime.parse(iso);
    if (casamento.month != mes || ano - casamento.year < 1) continue;
    final outro = m.conjugeId == null ? null : porId[m.conjugeId];
    if (m.conjugeId != null && (outro == null || !elegivel(outro) || outro.conjugeId != m.id || outro.dataCasamento != iso)) continue;
    final nomeExterno = m.conjugeNome?.trim() ?? '';
    if (outro == null && nomeExterno.isEmpty) continue;
    final ids = [m.id, if (outro != null) outro.id]..sort();
    final chave = ids.join('|');
    if (!vistos.add(chave)) continue;
    final ultimoDia = DateTime(ano, mes + 1, 0).day;
    final dia = casamento.day > ultimoDia ? ultimoDia : casamento.day;
    final aniversario = DateTime(ano, mes, dia);
    casais.add({
      'id': chave, 'membroId': m.id, if (outro != null) 'conjugeId': outro.id,
      'nome': m.nome, 'conjugeNome': outro?.nome ?? nomeExterno,
      'dataCasamento': iso, 'dataAniversario': diaIso(aniversario), 'anos': ano - casamento.year,
      'divulgacaoAutorizada': recadoCasamentos([m, if (outro != null) outro], aniversario) != null,
      'contatos': [contato(m), if (outro != null) contato(outro)],
    });
  }
  casais.sort((a, b) {
    final data = (a['dataAniversario'] as String).compareTo(b['dataAniversario'] as String);
    return data != 0 ? data : (a['nome'] as String).compareTo(b['nome'] as String);
  });
  return {'mes': mes, 'ano': ano, 'casais': casais};
}
