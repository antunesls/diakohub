import 'store.dart';

/// Atas de reunião. As formais (conselho, diretoria, assembleia) recebem número por tipo e ano
/// ao serem finalizadas e, depois de aprovadas, só aceitam retificações (o texto original fica).
class Atas {
  Atas(this.store, {DateTime Function()? agora}) : _agora = agora ?? DateTime.now;

  final Store store;
  final DateTime Function() _agora;

  static const colecao = 'atas';
  static const tipos = {
    'conselho': 'Conselho',
    'diretoria': 'Diretoria',
    'assembleia': 'Assembleia',
    'ministerio': 'Ministério / equipe',
    'outra': 'Outra reunião',
  };
  static const formais = {'conselho', 'diretoria', 'assembleia'};
  static const maximoAnexos = 10;

  static bool formal(Map<String, dynamic> ata) => formais.contains(ata['tipo']);

  /// Atas que a conta pode ver (as sigilosas só com [podeSigilosas]), mais recentes primeiro.
  List<Map<String, dynamic>> listar({required bool podeSigilosas}) {
    final lista = [
      for (final a in store.listar(colecao))
        if (podeSigilosas || a['sigilosa'] != true) a,
    ];
    lista.sort((a, b) {
      final d = (b['data'] as String).compareTo(a['data'] as String);
      return d != 0 ? d : (b['criadoEm'] as String? ?? '').compareTo(a['criadoEm'] as String? ?? '');
    });
    return lista;
  }

  Map<String, dynamic>? ata(String id, {required bool podeSigilosas}) {
    final a = store.buscar(colecao, id);
    if (a == null || (a['sigilosa'] == true && !podeSigilosas)) return null;
    return a;
  }

  /// Encaminhamentos ainda abertos de todas as atas visíveis, com o prazo mais próximo primeiro.
  List<Map<String, dynamic>> pendentes({required bool podeSigilosas}) {
    final lista = <Map<String, dynamic>>[
      for (final a in listar(podeSigilosas: podeSigilosas))
        if (a['status'] != 'rascunho')
          for (final e in (a['encaminhamentos'] as List? ?? const []).cast<Map>())
            if (e['concluido'] != true)
              {...Map<String, dynamic>.from(e), 'ataId': a['id'], 'ataTitulo': titulo(a), 'ataData': a['data']},
    ];
    lista.sort((a, b) {
      final pa = a['prazo'] as String? ?? '';
      final pb = b['prazo'] as String? ?? '';
      if (pa.isEmpty != pb.isEmpty) return pa.isEmpty ? 1 : -1;
      return pa.compareTo(pb);
    });
    return lista;
  }

  /// "Ata nº 3/2026 — Conselho" para as formais; o título informado para as demais.
  static String titulo(Map<String, dynamic> a) {
    final nome = (a['titulo'] as String? ?? '').trim();
    final tipo = tipos[a['tipo']] ?? 'Reunião';
    if (a['numero'] is int) {
      return 'Ata nº ${a['numero']}/${a['ano']} — $tipo${nome.isEmpty ? '' : ': $nome'}';
    }
    return nome.isEmpty ? 'Reunião — $tipo' : nome;
  }

  // ---------- Validação ----------

  static String _texto(Object? v, String campo, {int maximo = 160, bool obrigatorio = false}) {
    if (v != null && v is! String) throw FormatException('$campo inválido.');
    final s = (v as String? ?? '').trim();
    if (obrigatorio && s.isEmpty) throw FormatException('Preencha: $campo.');
    if (s.length > maximo) throw FormatException('$campo passa de $maximo caracteres.');
    return s;
  }

  static String _data(Object? v, String campo, {bool obrigatorio = true}) {
    final s = _texto(v, campo, maximo: 10, obrigatorio: obrigatorio);
    if (s.isEmpty) return s;
    final d = RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s) ? DateTime.tryParse(s) : null;
    if (d == null || d.year < 1900 || _iso(d) != s) throw FormatException('$campo inválida.');
    return s;
  }

  static String _hora(Object? v, String campo) {
    final s = _texto(v, campo, maximo: 5);
    if (s.isNotEmpty && !RegExp(r'^([01]\d|2[0-3]):[0-5]\d$').hasMatch(s)) throw FormatException('$campo inválida.');
    return s;
  }

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  static List<Map> _lista(Object? v, String campo, int maximo) {
    if (v == null) return const [];
    if (v is! List || v.length > maximo || v.any((e) => e is! Map)) throw FormatException('$campo inválido.');
    return v.cast<Map>();
  }

  static List<Map<String, dynamic>> _pessoas(Object? v, String campo) => [
        for (final p in _lista(v, campo, 300))
          {
            if (_texto(p['membroId'], campo, maximo: 40).isNotEmpty) 'membroId': _texto(p['membroId'], campo, maximo: 40),
            'nome': _texto(p['nome'], 'Nome em $campo', maximo: 120, obrigatorio: true),
            if (_texto(p['justificativa'], 'Justificativa', maximo: 300).isNotEmpty)
              'justificativa': _texto(p['justificativa'], 'Justificativa', maximo: 300),
          },
      ];

  Map<String, dynamic> _campos(Map<String, dynamic> corpo, {Map<String, dynamic>? anterior}) {
    final tipo = corpo['tipo'];
    if (!tipos.containsKey(tipo)) throw const FormatException('Tipo de reunião inválido.');
    if (anterior != null && anterior['numero'] != null && tipo != anterior['tipo']) {
      throw const FormatException('Ata já numerada: o tipo não pode mudar.');
    }
    final sigilosa = corpo['sigilosa'] ?? false;
    if (sigilosa is! bool) throw const FormatException('Sigilo inválido.');
    final anteriores = {
      for (final e in (anterior?['encaminhamentos'] as List? ?? const []).cast<Map>()) e['id']: e,
    };
    return {
      'tipo': tipo,
      'ministerio': tipo == 'ministerio' ? _texto(corpo['ministerio'], 'Ministério', maximo: 100) : '',
      'titulo': _texto(corpo['titulo'], 'Título', maximo: 160, obrigatorio: !formais.contains(tipo)),
      'data': _data(corpo['data'], 'Data da reunião'),
      'horaInicio': _hora(corpo['horaInicio'], 'Hora de início'),
      'horaFim': _hora(corpo['horaFim'], 'Hora de término'),
      'local': _texto(corpo['local'], 'Local', maximo: 120),
      'presidente': _texto(corpo['presidente'], 'Quem presidiu', maximo: 120),
      'secretario': _texto(corpo['secretario'], 'Secretário(a)', maximo: 120),
      'presentes': _pessoas(corpo['presentes'], 'Presentes'),
      'ausentes': _pessoas(corpo['ausentes'], 'Ausentes'),
      'pauta': [
        for (final item in _lista(corpo['pauta'], 'Pauta', 60))
          {
            'titulo': _texto(item['titulo'], 'Assunto da pauta', maximo: 200, obrigatorio: true),
            'discussao': _texto(item['discussao'], 'Discussão', maximo: 20000),
            'deliberacao': _texto(item['deliberacao'], 'Deliberação', maximo: 4000),
          },
      ],
      'encaminhamentos': [
        for (final e in _lista(corpo['encaminhamentos'], 'Encaminhamentos', 100))
          () {
            final id = e['id'] is String && anteriores.containsKey(e['id']) ? e['id'] as String : novoId();
            final antes = anteriores[id];
            final concluido = e['concluido'] ?? antes?['concluido'] ?? false;
            if (concluido is! bool) throw const FormatException('Encaminhamento inválido.');
            return {
              'id': id,
              'descricao': _texto(e['descricao'], 'Encaminhamento', maximo: 500, obrigatorio: true),
              'responsavel': _texto(e['responsavel'], 'Responsável', maximo: 120),
              'prazo': _data(e['prazo'], 'Prazo do encaminhamento', obrigatorio: false),
              'concluido': concluido,
              if (concluido) 'concluidoEm': antes?['concluidoEm'] ?? _iso(_agora()),
            };
          }(),
      ],
      'observacoes': _texto(corpo['observacoes'], 'Observações', maximo: 10000),
      'sigilosa': sigilosa,
    };
  }

  Map<String, dynamic> _evento(String acao, String por, [Map<String, dynamic> extra = const {}]) =>
      {'acao': acao, 'em': _agora().toIso8601String(), 'por': por, ...extra};

  Map<String, dynamic> _existente(String id, bool podeSigilosas) {
    final a = ata(id, podeSigilosas: podeSigilosas);
    if (a == null) throw ArgumentError('Ata não encontrada.');
    return a;
  }

  // ---------- Operações ----------

  Future<Map<String, dynamic>> criar(Map<String, dynamic> corpo,
      {required String por, required bool podeSigilosas}) async {
    final campos = _campos(corpo);
    if (campos['sigilosa'] == true && !podeSigilosas) {
      throw const FormatException('Seu perfil não pode criar atas sigilosas.');
    }
    final agora = _agora().toIso8601String();
    final doc = {
      'id': novoId(), ...campos, 'status': 'rascunho', 'anexos': <String>[], 'retificacoes': [],
      'criadoPor': por, 'criadoEm': agora, 'atualizadoEm': agora, 'historico': [_evento('criada', por)],
    };
    await store.salvar(colecao, doc);
    return doc;
  }

  Future<Map<String, dynamic>> editar(String id, Map<String, dynamic> corpo,
      {required String por, required bool podeSigilosas}) async {
    final anterior = _existente(id, podeSigilosas);
    if (anterior['status'] == 'aprovada') {
      throw StateError('Ata aprovada não pode ser editada. Registre uma retificação.');
    }
    final campos = _campos({...anterior, ...corpo}, anterior: anterior);
    if (campos['sigilosa'] == true && !podeSigilosas) {
      throw const FormatException('Seu perfil não pode marcar atas como sigilosas.');
    }
    final novo = {...anterior, ...campos, 'atualizadoEm': _agora().toIso8601String(),
      'historico': [...anterior['historico'] as List, _evento('editada', por)]};
    await store.salvar(colecao, novo);
    return novo;
  }

  /// Fecha o texto. As formais ganham o próximo número do tipo no ano da reunião.
  Future<Map<String, dynamic>> finalizar(String id, {required String por, required bool podeSigilosas}) async {
    final anterior = _existente(id, podeSigilosas);
    if (anterior['status'] != 'rascunho') throw StateError('A ata já foi finalizada.');
    _campos(anterior, anterior: anterior); // confere de novo o que foi salvo
    final novo = {...anterior, 'status': 'finalizada', 'finalizadaEm': _agora().toIso8601String(),
      'atualizadoEm': _agora().toIso8601String()};
    if (formal(anterior) && anterior['numero'] == null) {
      final ano = int.parse((anterior['data'] as String).substring(0, 4));
      final usados = [
        for (final a in store.listar(colecao))
          if (a['tipo'] == anterior['tipo'] && a['ano'] == ano && a['numero'] is int) a['numero'] as int,
      ];
      novo['numero'] = usados.isEmpty ? 1 : usados.reduce((x, y) => x > y ? x : y) + 1;
      novo['ano'] = ano;
    }
    novo['historico'] = [...anterior['historico'] as List,
      _evento('finalizada', por, {if (novo['numero'] != null) 'numero': '${novo['numero']}/${novo['ano']}'})];
    await store.salvar(colecao, novo);
    return novo;
  }

  /// Volta uma ata finalizada (ainda não aprovada) para rascunho. O número é mantido.
  Future<Map<String, dynamic>> reabrir(String id, {required String por, required bool podeSigilosas}) async {
    final anterior = _existente(id, podeSigilosas);
    if (anterior['status'] != 'finalizada') throw StateError('Só uma ata finalizada e não aprovada pode ser reaberta.');
    final novo = {...anterior, 'status': 'rascunho', 'atualizadoEm': _agora().toIso8601String(),
      'historico': [...anterior['historico'] as List, _evento('reaberta', por)]};
    await store.salvar(colecao, novo);
    return novo;
  }

  /// Registra a aprovação (em geral na reunião seguinte). Depois disso o texto fica travado.
  Future<Map<String, dynamic>> aprovar(String id, Map<String, dynamic> corpo,
      {required String por, required bool podeSigilosas}) async {
    final anterior = _existente(id, podeSigilosas);
    if (!formal(anterior)) throw StateError('Só atas de conselho, diretoria e assembleia passam por aprovação.');
    if (anterior['status'] != 'finalizada') throw StateError('Finalize a ata antes de aprovar.');
    final data = _data(corpo['data'], 'Data da aprovação');
    if (data.compareTo(anterior['data'] as String) < 0) {
      throw const FormatException('A aprovação não pode ser anterior à reunião.');
    }
    final naAta = _texto(corpo['naAtaId'], 'Ata da aprovação', maximo: 40);
    if (naAta.isNotEmpty && (naAta == id || store.buscar(colecao, naAta) == null)) {
      throw const FormatException('Ata da aprovação inválida.');
    }
    final novo = {...anterior, 'status': 'aprovada', 'aprovadaEm': data, if (naAta.isNotEmpty) 'aprovadaNaAtaId': naAta,
      'atualizadoEm': _agora().toIso8601String(),
      'historico': [...anterior['historico'] as List, _evento('aprovada', por, {'data': data})]};
    await store.salvar(colecao, novo);
    return novo;
  }

  /// Correção de uma ata aprovada: entra como adendo, sem mexer no texto original.
  Future<Map<String, dynamic>> retificar(String id, Map<String, dynamic> corpo,
      {required String por, required bool podeSigilosas}) async {
    final anterior = _existente(id, podeSigilosas);
    if (anterior['status'] != 'aprovada') throw StateError('Só atas aprovadas recebem retificação; edite a ata.');
    final texto = _texto(corpo['texto'], 'Retificação', maximo: 4000, obrigatorio: true);
    final em = _agora().toIso8601String();
    final novo = {...anterior, 'atualizadoEm': em,
      'retificacoes': [...anterior['retificacoes'] as List? ?? const [], {'texto': texto, 'em': em, 'por': por}],
      'historico': [...anterior['historico'] as List, _evento('retificada', por)]};
    await store.salvar(colecao, novo);
    return novo;
  }

  /// Marca ou desmarca um encaminhamento (vale também em atas aprovadas: é acompanhamento, não texto).
  Future<Map<String, dynamic>> marcarEncaminhamento(String id, String encaminhamentoId, Map<String, dynamic> corpo,
      {required String por, required bool podeSigilosas}) async {
    final anterior = _existente(id, podeSigilosas);
    final concluido = corpo['concluido'];
    if (concluido is! bool) throw const FormatException('Informe se o encaminhamento foi concluído.');
    final lista = [for (final e in (anterior['encaminhamentos'] as List).cast<Map>()) Map<String, dynamic>.from(e)];
    final i = lista.indexWhere((e) => e['id'] == encaminhamentoId);
    if (i < 0) throw ArgumentError('Encaminhamento não encontrado.');
    lista[i] = {...lista[i], 'concluido': concluido}..remove('concluidoEm');
    if (concluido) lista[i]['concluidoEm'] = _iso(_agora());
    final novo = {...anterior, 'encaminhamentos': lista, 'atualizadoEm': _agora().toIso8601String(),
      'historico': [...anterior['historico'] as List,
        _evento(concluido ? 'encaminhamento concluído' : 'encaminhamento reaberto', por)]};
    await store.salvar(colecao, novo);
    return novo;
  }

  /// Só rascunhos podem ser apagados: o que foi finalizado faz parte do livro de atas.
  /// Devolve os anexos para o chamador apagar do disco.
  Future<List<String>> excluir(String id, {required bool podeSigilosas}) async {
    final anterior = _existente(id, podeSigilosas);
    if (anterior['status'] != 'rascunho' || anterior['numero'] != null) {
      throw StateError('Só rascunhos que nunca foram finalizados podem ser excluídos.');
    }
    await store.excluir(colecao, id);
    return (anterior['anexos'] as List? ?? const []).cast<String>();
  }

  Future<void> anotarEnvio(String id, int destinatarios, String por) async {
    final atual = store.buscar(colecao, id);
    if (atual == null) return;
    await store.salvar(colecao, {...atual,
      'historico': [...atual['historico'] as List, _evento('enviada por e-mail', por, {'destinatarios': destinatarios})]});
  }
}
