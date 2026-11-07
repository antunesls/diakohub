import 'store.dart';

/// Pendências, compras e preventivas compartilham uma fila e um histórico. Modelos
/// de recorrência moram na mesma coleção para criar a primeira tarefa atomicamente.
class GestaoCasa {
  GestaoCasa(this.store, {DateTime Function()? agora}) : _agora = agora ?? DateTime.now;

  final Store store;
  final DateTime Function() _agora;
  final Set<String> _concluindo = {};

  Map<String, dynamic> listar() {
    final docs = store.listar('gestaoCasa');
    return {
      'tarefas': [for (final d in docs) if (d['registro'] == 'tarefa') d],
      'rotinas': [for (final d in docs) if (d['registro'] == 'rotina') d],
    };
  }

  Map<String, dynamic>? tarefa(String id) {
    final d = store.buscar('gestaoCasa', id);
    return d?['registro'] == 'tarefa' ? d : null;
  }

  static String _texto(Object? v, String campo, {int maximo = 160, bool obrigatorio = false}) {
    if (v != null && v is! String) throw FormatException('$campo inválido.');
    final s = (v as String? ?? '').trim();
    if (s.length > maximo || (obrigatorio && s.isEmpty)) throw FormatException('$campo inválido.');
    return s;
  }

  static DateTime _data(Object? v) {
    final s = _texto(v, 'Data', maximo: 10, obrigatorio: true);
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) throw const FormatException('Data inválida.');
    final d = DateTime.tryParse(s);
    if (d == null || d.year < 1900 || _iso(d) != s) throw const FormatException('Data inválida.');
    return d;
  }

  static String _iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  static Map<String, dynamic> _campos(Map<String, dynamic> corpo, {String? tipoExistente}) {
    final tipo = corpo['tipo'] ?? tipoExistente;
    if (!{'pendencia', 'compra', 'preventiva'}.contains(tipo)) throw const FormatException('Tipo inválido.');
    final prioridade = corpo['prioridade'] ?? 'normal';
    if (!{'baixa', 'normal', 'alta'}.contains(prioridade)) throw const FormatException('Prioridade inválida.');
    final prazo = _data(corpo['prazo']);
    final valor = corpo['valorEstimado'];
    if (valor != null && (valor is! num || valor < 0 || valor > 100000000)) {
      throw const FormatException('Valor estimado inválido.');
    }
    return {
      'tipo': tipo, 'titulo': _texto(corpo['titulo'], 'Descrição', obrigatorio: true),
      'local': _texto(corpo['local'], 'Local', maximo: 100), 'prazo': _iso(prazo),
      'prioridade': prioridade, 'responsavel': _texto(corpo['responsavel'], 'Responsável', maximo: 100),
      'detalhes': _texto(corpo['detalhes'], 'Detalhes', maximo: 2000),
      'quantidade': tipo == 'compra' ? _texto(corpo['quantidade'], 'Quantidade', maximo: 100) : '',
      if (valor != null) 'valorEstimado': valor,
    };
  }

  Future<Map<String, dynamic>> criarTarefa(Map<String, dynamic> corpo, {required String por}) async {
    final campos = _campos(corpo);
    final doc = {'registro': 'tarefa', 'id': novoId(), ...campos, 'estado': 'aberta',
      'criadoEm': _agora().toIso8601String(), 'historico': [{'acao': 'criada', 'em': _agora().toIso8601String(), 'por': por}]};
    await store.salvar('gestaoCasa', doc);
    return doc;
  }

  static Map<String, dynamic> _periodicidade(Map<String, dynamic> corpo) {
    final intervalo = corpo['intervalo'];
    final unidade = corpo['unidade'];
    final regra = corpo['regraData'];
    if (intervalo is! int || intervalo < 1 || intervalo > 120 ||
        !{'dia', 'semana', 'mes', 'ano'}.contains(unidade) ||
        !{'calendario', 'execucao'}.contains(regra)) throw const FormatException('Periodicidade inválida.');
    return {'intervalo': intervalo, 'unidade': unidade, 'regraData': regra};
  }

  Future<Map<String, dynamic>> criarRotina(Map<String, dynamic> corpo, {required String por}) async {
    final campos = _campos(corpo);
    if (campos['tipo'] == 'pendencia') throw const FormatException('Pendência avulsa não é rotina.');
    final periodicidade = _periodicidade(corpo);
    final id = novoId();
    final rotina = {'registro': 'rotina', 'id': id, ...campos, ...periodicidade, 'ativa': true,
      'criadoEm': _agora().toIso8601String(), 'criadaPor': por};
    final primeira = {'registro': 'tarefa', 'id': novoId(), ...campos, 'rotinaId': id, 'periodo': 0,
      'estado': 'aberta', 'criadoEm': _agora().toIso8601String(),
      'historico': [{'acao': 'criada', 'em': _agora().toIso8601String(), 'por': por}]};
    await store.salvarVarios('gestaoCasa', [rotina, primeira]);
    return rotina;
  }

  Future<Map<String, dynamic>> editarRotina(String id, Map<String, dynamic> corpo, {required String por}) async {
    final anterior = store.buscar('gestaoCasa', id);
    if (anterior == null || anterior['registro'] != 'rotina') throw StateError('Rotina não encontrada.');
    final mesclado = {...anterior, ...corpo, 'tipo': anterior['tipo']};
    final campos = _campos(mesclado);
    final periodicidade = _periodicidade(mesclado);
    if (corpo.containsKey('ativa') && corpo['ativa'] is! bool) throw const FormatException('Estado da rotina inválido.');
    final novo = {...anterior, ...campos, ...periodicidade,
      if (corpo.containsKey('ativa')) 'ativa': corpo['ativa'],
      'atualizadoEm': _agora().toIso8601String(), 'atualizadaPor': por};
    final docs = <Map<String, dynamic>>[novo];
    if (anterior['ativa'] == false && novo['ativa'] == true) {
      final tarefas = (listar()['tarefas'] as List).cast<Map<String, dynamic>>()
          .where((t) => t['rotinaId'] == id).toList();
      if (!tarefas.any((t) => t['estado'] == 'aberta' || t['estado'] == 'emAndamento')) {
        tarefas.sort((a, b) => (a['periodo'] as int).compareTo(b['periodo'] as int));
        final ultima = tarefas.last;
        final inicio = _data(novo['prazo']);
        final dataExecucao = _data(ultima['concluidaEm'] ?? _iso(_agora()));
        var periodo = (ultima['periodo'] as int) + 1;
        final calendario = novo['regraData'] == 'calendario';
        DateTime calcular() => calendario
            ? _somar(inicio, periodo * (novo['intervalo'] as int), novo['unidade'] as String, inicio.day)
            : _somar(dataExecucao, novo['intervalo'] as int, novo['unidade'] as String, dataExecucao.day);
        var prazo = calcular();
        if (calendario) {
          while (!prazo.isAfter(dataExecucao)) { periodo++; prazo = calcular(); }
        }
        docs.add({'registro': 'tarefa', 'id': novoId(), ..._campos({...novo, 'prazo': _iso(prazo)}),
          'rotinaId': id, 'periodo': periodo, 'estado': 'aberta', 'criadoEm': _agora().toIso8601String(),
          'historico': [{'acao': 'criada', 'em': _agora().toIso8601String(), 'por': por}]});
      }
    }
    await store.salvarVarios('gestaoCasa', docs);
    return novo;
  }

  Future<Map<String, dynamic>> editarTarefa(String id, Map<String, dynamic> corpo, {required String por}) async {
    final anterior = tarefa(id);
    if (anterior == null) throw StateError('Tarefa não encontrada.');
    if (anterior['estado'] == 'concluida') throw StateError('Tarefa concluída não pode ser editada.');
    final mesclado = {...anterior, ...corpo, 'tipo': anterior['tipo']};
    final campos = _campos(mesclado);
    final estado = corpo['estado'] ?? anterior['estado'];
    if (!{'aberta', 'emAndamento', 'cancelada'}.contains(estado)) throw const FormatException('Estado inválido.');
    final novo = {...anterior, ...campos, 'estado': estado, 'atualizadoEm': _agora().toIso8601String(),
      'historico': [...(anterior['historico'] as List), {'acao': 'editada', 'em': _agora().toIso8601String(), 'por': por}]};
    await store.salvar('gestaoCasa', novo);
    return novo;
  }

  static DateTime _somar(DateTime base, int quantidade, String unidade, int diaOriginal) {
    if (unidade == 'dia') return base.add(Duration(days: quantidade));
    if (unidade == 'semana') return base.add(Duration(days: quantidade * 7));
    final meses = base.year * 12 + base.month - 1 + quantidade * (unidade == 'ano' ? 12 : 1);
    final ano = meses ~/ 12;
    final mes = meses % 12 + 1;
    final ultimoDia = DateTime(ano, mes + 1, 0).day;
    return DateTime(ano, mes, diaOriginal.clamp(1, ultimoDia));
  }

  Future<Map<String, dynamic>> concluir(String id, Map<String, dynamic> corpo, {required String por}) async {
    if (!_concluindo.add(id)) throw StateError('Conclusão em andamento.');
    try {
      final anterior = tarefa(id);
      if (anterior == null || anterior['estado'] == 'concluida' || anterior['estado'] == 'cancelada') {
        throw StateError('Tarefa indisponível para conclusão.');
      }
      final data = _data(corpo['data']);
      final executor = _texto(corpo['executor'], 'Executor', maximo: 100, obrigatorio: true);
      final valor = corpo['valor'];
      if (valor != null && (valor is! num || valor < 0 || valor > 100000000)) throw const FormatException('Valor inválido.');
      final observacao = _texto(corpo['observacao'], 'Observação', maximo: 2000);
      final atualizado = {...anterior, 'estado': 'concluida', 'concluidaEm': _iso(data), 'executor': executor,
        'observacao': observacao, if (valor != null) 'valor': valor,
        'historico': [...(anterior['historico'] as List), {'acao': 'concluida', 'em': _agora().toIso8601String(),
          'data': _iso(data), 'por': por, 'executor': executor}]};
      final docs = <Map<String, dynamic>>[atualizado];
      final rotinaId = anterior['rotinaId'] as String?;
      final rotina = rotinaId == null ? null : store.buscar('gestaoCasa', rotinaId);
      if (rotina != null && rotina['ativa'] == true) {
        final intervalo = rotina['intervalo'] as int;
        final unidade = rotina['unidade'] as String;
        final original = _data(rotina['prazo']);
        final calendario = rotina['regraData'] == 'calendario';
        var periodo = (anterior['periodo'] as int? ?? 0) + 1;
        DateTime proxima() => calendario
            ? _somar(original, periodo * intervalo, unidade, original.day)
            : _somar(data, intervalo, unidade, data.day);
        var vencimento = proxima();
        if (calendario) {
          while (!vencimento.isAfter(data)) { periodo++; vencimento = proxima(); }
        }
        final campos = _campos({...rotina, 'prazo': _iso(vencimento)});
        docs.add({'registro': 'tarefa', 'id': novoId(), ...campos, 'rotinaId': rotinaId,
          'periodo': periodo, 'estado': 'aberta', 'criadoEm': _agora().toIso8601String(),
          'historico': [{'acao': 'criada', 'em': _agora().toIso8601String(), 'por': por}]});
      }
      await store.salvarVarios('gestaoCasa', docs);
      return atualizado;
    } finally {
      _concluindo.remove(id);
    }
  }
}
