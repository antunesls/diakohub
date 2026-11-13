import 'store.dart';

/// Tira das escalas (pastoral e louvor, todos os cultos, inclusive os passados) e das
/// indisponibilidades cada pessoa para a qual [sai] responde true. Os outros campos do culto
/// ficam intactos e função sem ninguém sai do mapa, como o CultoEscala.toJson grava.
/// Retorna quantos cultos mudaram.
Future<int> tirarDasEscalas(Store store, bool Function(String membroId) sai) async {
  final alterados = <Map<String, dynamic>>[];
  for (final culto in store.listar('escalas')) {
    var mudou = false;
    final novo = {...culto};
    for (final tipo in const ['pastoral', 'louvor']) {
      final funcoes = culto[tipo];
      if (funcoes is! Map) continue;
      final limpo = <String, dynamic>{};
      for (final e in funcoes.entries) {
        final ids = (e.value as List? ?? const []).map((x) => '$x').toList();
        final restantes = ids.where((x) => !sai(x)).toList();
        if (restantes.length != ids.length) mudou = true;
        if (restantes.isNotEmpty) limpo['${e.key}'] = restantes;
      }
      novo[tipo] = limpo;
    }
    if (mudou) alterados.add(novo);
  }
  if (alterados.isNotEmpty) await store.salvarVarios('escalas', alterados);
  for (final d in store.listar('indisponibilidades').where((d) => sai('${d['membroId']}')).toList()) {
    await store.excluir('indisponibilidades', d['id'] as String);
  }
  return alterados.length;
}

/// Limpeza ao iniciar: tira das escalas quem já foi excluído do cadastro antes de a exclusão
/// fazer isso sozinha (aparecia como "(pessoa removida)"). Sem nenhum membro cadastrado não
/// faz nada: um data/membros.json vazio ou faltando não pode esvaziar todas as escalas.
Future<int> limparEscalasOrfas(Store store) async {
  final membros = {for (final m in store.listar('membros')) '${m['id']}'};
  if (membros.isEmpty) return 0;
  return tirarDasEscalas(store, (id) => !membros.contains(id));
}
