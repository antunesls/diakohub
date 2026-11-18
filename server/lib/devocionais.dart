import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:diako_core/diako_core.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';
import 'auth.dart';
import 'email_devocionais.dart';
import 'palavras.dart';
import 'permissoes.dart';
import 'store.dart';

/// Devocionais: trilhas (públicos: Casais, Família, Jovens…, editáveis na administração), séries,
/// agendamento com envio automático aos assinantes e o devocional em destaque do site.
///
/// Rotas completas; montar diretamente no Router principal, sem remover prefixos.
/// Uma Store pertence a um único processo (mesma restrição do armazenamento JSON).
class Devocionais {
  Devocionais(this.store, {required String Function() urlBase, required String Function() igreja,
    required Future<void> Function(EmailDevocional email) enviar, DateTime Function()? agora, String Function(Request)? ip})
      : _urlBase = urlBase, _igreja = igreja, _enviar = enviar,
        _agora = agora ?? DateTime.now, _ip = ip ?? ipDe {
    _estado = _estados[store] ??= _Estado();
    _ipInscricao = LimiteTaxa(maximo: 10, janela: const Duration(minutes: 15), relogio: _agora);
    _emailInscricao = LimiteTaxa(maximo: 1, janela: const Duration(hours: 1), relogio: _agora);
    _tokens = LimiteTaxa(maximo: 30, janela: const Duration(minutes: 1), relogio: _agora);
  }

  final Store store;
  final String Function() _urlBase, _igreja;
  final DateTime Function() _agora;
  final String Function(Request) _ip;
  final Future<void> Function(EmailDevocional) _enviar;
  late final _Estado _estado;
  late final LimiteTaxa _ipInscricao, _emailInscricao, _tokens;
  static final _estados = Expando<_Estado>();
  Timer? _agendador;

  /// Quantos links de cancelamento ficam guardados por assinatura. O arquivo é regravado a cada
  /// envio, então a lista não pode crescer para sempre; os links mais antigos que isso deixam
  /// de valer, e todo devocional novo traz um link atual.
  static const maximoCancelamentos = 24;
  static const maximoTrilhas = 30;
  static const maximoTrilhasPorDevocional = 5;

  /// Campos de texto obrigatórios (com o limite de cada um).
  static const _textos = {'titulo': 200, 'autorNome': 120, 'data': 10,
    'referencia': 300, 'texto': 50000, 'aplicacao': 10000, 'oracao': 10000};

  /// O que, se mudar no meio de um envio, interrompe o lote (o e-mail não pode sair diferente da prévia).
  static const _conteudo = [..._chavesTexto, 'trilhas', 'serie', 'serieParte'];
  static const _chavesTexto = ['titulo', 'autorNome', 'data', 'referencia', 'texto', 'aplicacao', 'oracao'];
  static const _situacoes = {'rascunho', 'agendado', 'publicado'};

  static const colecaoTrilhas = 'trilhasDevocionais';
  static const _padroes = [
    {'id': 'casais', 'nome': 'Casais', 'descricao': 'Para a vida a dois.'},
    {'id': 'familia', 'nome': 'Família', 'descricao': 'Para ler e orar em família.'},
  ];
  static const _generico = {'ok': true,
    'mensagem': 'Se a solicitação puder ser atendida, você receberá um e-mail para confirmar.'};

  late final Router router = _rotas();
  Router _rotas() {
    final r = Router();
    void rota(String metodo, String caminho, FutureOr<Response> Function(Request) acao,
        {bool publica = false, Permissao permissao = Permissao.devocionais}) {
      r.add(metodo, caminho, (Request req) async {
        if (!publica) {
          final conta = Auth.contaDa(req);
          if (conta == null) return _erro(401, 'Faça login.');
          if (conta.trocarSenha || !conta.pode(permissao)) {
            return _erro(403, permissao == Permissao.admin ? 'Só a administração mexe nas trilhas.' : 'Sem permissão para devocionais.');
          }
        }
        try {
          await garantirTrilhas();
          return await acao(req);
        } on FormatException catch (e) {
          return _erro(400, e.message);
        } on _HttpErro catch (e) {
          return _erro(e.status, e.mensagem);
        } catch (_) {
          // Não expor dados de SMTP, tokens ou caminhos do armazenamento.
          return _erro(500, 'Não foi possível concluir a operação.');
        }
      });
    }
    // Rotas fixas antes das com <id>: o Router atende a primeira que casar.
    rota('GET', '/api/devocionais', (_) => _json([for (final d in _ordenados(store.listar('devocionais'))) _exibir(d)]));
    rota('POST', '/api/devocionais', _criar);
    rota('GET', '/api/devocionais/trilhas', (_) => _json(_trilhasComUso()));
    rota('GET', '/api/devocionais/assinantes', (_) => _json(_resumoAssinantes()));
    rota('GET', '/api/devocionais/destinatarios', (_) => _json(_membros()));
    rota('POST', '/api/devocionais/importar', _importar);
    rota('POST', '/api/devocionais/<id>/previa-email', _previa);
    rota('POST', '/api/devocionais/<id>/email', _disparar);
    rota('GET', '/api/devocionais/<id>/envios', (req) => _json(_envios(req.params['id']!)));
    rota('GET', '/api/devocionais/<id>', (req) => _json(_exibir(_buscar(req.params['id']!))));
    rota('PUT', '/api/devocionais/<id>', _editar);
    rota('DELETE', '/api/devocionais/<id>', (req) => _estado.executar(() async {
      final id = req.params['id']!; _buscar(id);
      await store.excluir('devocionais', id);
      // Sem o conteúdo, os recibos só guardariam e-mails de destinatários sem finalidade.
      for (final recibo in store.listar('enviosDevocionais').where((r) => r['devocionalId'] == id).toList()) {
        await store.excluir('enviosDevocionais', recibo['id'] as String);
      }
      return _json({'ok': true});
    }));
    // Trilhas: lista editável na administração.
    rota('GET', '/api/admin/devocionais/trilhas', (_) => _json(_trilhasComUso()), permissao: Permissao.admin);
    rota('POST', '/api/admin/devocionais/trilhas', _criarTrilha, permissao: Permissao.admin);
    rota('PUT', '/api/admin/devocionais/trilhas/<id>', _editarTrilha, permissao: Permissao.admin);
    rota('DELETE', '/api/admin/devocionais/trilhas/<id>', _excluirTrilha, permissao: Permissao.admin);
    // Públicas.
    rota('POST', '/api/public/devocionais/assinar', _assinar, publica: true);
    rota('POST', '/api/public/devocionais/confirmar', (req) => _token(req, cancelar: false), publica: true);
    rota('POST', '/api/public/devocionais/cancelar', (req) => _token(req, cancelar: true), publica: true);
    rota('GET', '/api/public/devocionais/trilhas', (_) => _json([for (final t in _trilhas(ativas: true)) _trilhaPublica(t)]),
        publica: true);
    rota('GET', '/api/public/devocionais', _listarPublicos, publica: true);
    rota('GET', '/api/public/devocionais/<id>', (req) => _json(_exibirPublico(_publicado(req.params['id']!))), publica: true);
    return r;
  }

  // ---------- Trilhas ----------

  /// Na primeira vez, Casais e Família viram as duas primeiras trilhas (mesmos ids dos temas antigos:
  /// devocionais e assinaturas existentes continuam valendo). Depois, só a administração mexe.
  Future<void> garantirTrilhas() async {
    if (store.buscar('configDevocionais', 'trilhas') != null) return;
    await _estado.executar(() async {
      if (store.buscar('configDevocionais', 'trilhas') != null) return;
      if (store.listar(colecaoTrilhas).isEmpty) {
        var ordem = 0;
        for (final t in _padroes) {
          await store.salvar(colecaoTrilhas, {...t, 'ativa': true, 'ordem': ordem++, 'criadaEm': _agora().toIso8601String()});
        }
      }
      await store.salvar('configDevocionais', {'id': 'trilhas', 'iniciadasEm': _agora().toIso8601String()});
    });
  }

  List<Map<String, dynamic>> _trilhas({bool ativas = false}) => [
        for (final t in store.listar(colecaoTrilhas)) if (!ativas || t['ativa'] != false) t,
      ]..sort((a, b) {
          final o = ((a['ordem'] as num?) ?? 0).compareTo((b['ordem'] as num?) ?? 0);
          return o != 0 ? o : '${a['nome']}'.compareTo('${b['nome']}');
        });

  Map<String, dynamic> _trilhaPublica(Map<String, dynamic> t) =>
      {'id': t['id'], 'nome': t['nome'], 'descricao': t['descricao'] ?? ''};

  String _nomeTrilha(String id) => '${store.buscar(colecaoTrilhas, id)?['nome'] ?? id}';

  List<Map<String, dynamic>> _trilhasComUso() {
    final devs = store.listar('devocionais');
    final assinaturas = store.listar('assinaturasDevocionais');
    return [
      for (final t in _trilhas())
        {
          ..._trilhaPublica(t),
          'ativa': t['ativa'] != false,
          'ordem': t['ordem'] ?? 0,
          'devocionais': devs.where((d) => _trilhasDe(d).contains(t['id'])).length,
          'assinantes': assinaturas.where((a) => a['status'] == 'ativo' && (a['temas'] as List? ?? []).contains(t['id'])).length,
        },
    ];
  }

  Map<String, dynamic> _validarTrilha(Map<String, dynamic> j, {String? ignorar}) {
    final nome = '${j['nome'] ?? ''}'.trim().replaceAll(RegExp(r'\s+'), ' ');
    final descricao = '${j['descricao'] ?? ''}'.trim();
    if (nome.isEmpty || nome.length > 40) throw const FormatException('Dê um nome à trilha (até 40 letras).');
    if (descricao.length > 200) throw const FormatException('Descrição muito longa (até 200 letras).');
    if (j.containsKey('ativa') && j['ativa'] is! bool) throw const FormatException('"ativa" deve ser verdadeiro ou falso.');
    if (j.containsKey('ordem') && j['ordem'] is! int) throw const FormatException('"ordem" deve ser um número.');
    if (_trilhas().any((t) => t['id'] != ignorar && _chave('${t['nome']}') == _chave(nome))) {
      throw const FormatException('Já existe uma trilha com esse nome.');
    }
    return {'nome': nome, 'descricao': descricao, if (j.containsKey('ativa')) 'ativa': j['ativa'], if (j.containsKey('ordem')) 'ordem': j['ordem']};
  }

  Future<Response> _criarTrilha(Request req) async {
    final j = await _corpo(req);
    return _estado.executar(() async {
      if (_trilhas().length >= maximoTrilhas) throw const FormatException('Limite de $maximoTrilhas trilhas atingido.');
      final v = _validarTrilha(j);
      var id = _chave(v['nome'] as String).replaceAll(RegExp(r'[^a-z0-9]+'), '-').replaceAll(RegExp(r'^-+|-+$'), '');
      if (id.isEmpty) id = 'trilha';
      final raiz = id;
      for (var i = 2; store.buscar(colecaoTrilhas, id) != null; i++) {
        id = '$raiz-$i';
      }
      final maior = _trilhas().fold<int>(-1, (m, t) => ((t['ordem'] as num?)?.toInt() ?? 0) > m ? (t['ordem'] as num).toInt() : m);
      final t = {'id': id, 'ativa': true, 'ordem': maior + 1, ...v, 'criadaEm': _agora().toIso8601String()};
      await store.salvar(colecaoTrilhas, t);
      return _json(t, 201);
    });
  }

  Future<Response> _editarTrilha(Request req) async {
    final j = await _corpo(req);
    return _estado.executar(() async {
      final atual = store.buscar(colecaoTrilhas, req.params['id']!) ?? (throw const _HttpErro(404, 'Trilha não encontrada.'));
      final v = _validarTrilha({...atual, ...j}, ignorar: atual['id'] as String);
      final t = {...atual, ...v, 'atualizadaEm': _agora().toIso8601String()};
      await store.salvar(colecaoTrilhas, t);
      return _json(t);
    });
  }

  /// Só exclui trilha sem devocionais nem assinantes; com uso, desative (some da assinatura e do editor).
  Future<Response> _excluirTrilha(Request req) => _estado.executar(() async {
        final id = req.params['id']!;
        if (store.buscar(colecaoTrilhas, id) == null) throw const _HttpErro(404, 'Trilha não encontrada.');
        final uso = _trilhasComUso().firstWhere((t) => t['id'] == id);
        final pendentes = store.listar('assinaturasDevocionais')
            .where((a) => ((a['pendente'] as Map?)?['temas'] as List? ?? []).contains(id)).length;
        if ((uso['devocionais'] as int) > 0 || (uso['assinantes'] as int) > 0 || pendentes > 0) {
          throw const FormatException('Esta trilha tem devocionais ou assinantes. Desative em vez de excluir: ela some da '
              'página pública e do editor, e o histórico continua.');
        }
        await store.excluir(colecaoTrilhas, id);
        return _json({'ok': true});
      });

  /// Trilhas do devocional ("tema", do formato antigo, vira uma trilha só).
  static List<String> _trilhasDe(Map<String, dynamic> d) {
    final t = d['trilhas'];
    if (t is List) return [for (final x in t) if (x is String) x];
    final tema = d['tema'];
    return tema is String && tema.isNotEmpty ? [tema] : const [];
  }

  // ---------- Devocionais ----------

  String get _base => _urlBase().replaceFirst(RegExp(r'/+$'), '');
  String _url(String id) => '$_base/devocional?id=${Uri.encodeQueryComponent(id)}';

  /// Hora de parede de agora ("2026-11-18T07:30"), no fuso do servidor (o da igreja).
  String get _agoraLocal {
    final a = _agora();
    String d(int n) => n.toString().padLeft(2, '0');
    return '${a.year}-${d(a.month)}-${d(a.day)}T${d(a.hour)}:${d(a.minute)}';
  }

  String get _hoje => _agoraLocal.substring(0, 10);

  Map<String, dynamic> _exibir(Map<String, dynamic> d) {
    final trilhas = _trilhasDe(d);
    return {
      'id': d['id'],
      for (final k in _chavesTexto) k: d[k],
      'trilhas': trilhas,
      'trilhasNomes': [for (final t in trilhas) _nomeTrilha(t)],
      'status': d['status'],
      if (d['serie'] != null) 'serie': d['serie'],
      if (d['serieParte'] != null) 'serieParte': d['serieParte'],
      if (d['publicarEm'] != null) 'publicarEm': d['publicarEm'],
      'enviarAoPublicar': d['enviarAoPublicar'] == true,
      if (d['publicadoEm'] != null) 'publicadoEm': d['publicadoEm'],
      if (d['envioAutomatico'] != null) 'envioAutomatico': d['envioAutomatico'],
      'urlPublica': _url(d['id'] as String),
    };
  }

  /// O que a página pública mostra: o conteúdo, sem situação, agendamento nem envios.
  Map<String, dynamic> _exibirPublico(Map<String, dynamic> d) {
    final e = _exibir(d);
    for (final k in ['status', 'publicarEm', 'enviarAoPublicar', 'publicadoEm', 'envioAutomatico']) {
      e.remove(k);
    }
    final serie = d['serie'];
    if (serie is String) {
      e['serieItens'] = [
        for (final o in _ordenados(_publicadosVisiveis().where((o) => o['serie'] == serie).toList(), crescente: true))
          {'id': o['id'], 'titulo': o['titulo'], 'serieParte': o['serieParte'], 'data': o['data']},
      ];
    }
    return e;
  }

  /// Ordem do mais novo para o mais antigo (data e, empatando, quando foi publicado ou criado);
  /// [crescente] para séries: pela parte, depois pela data.
  List<Map<String, dynamic>> _ordenados(List<Map<String, dynamic>> lista, {bool crescente = false}) {
    String chave(Map<String, dynamic> d) => '${d['data']}|${d['publicadoEm'] ?? d['criadoEm'] ?? ''}';
    final r = [...lista];
    if (crescente) {
      r.sort((a, b) {
        final pa = (a['serieParte'] as int?) ?? 9999, pb = (b['serieParte'] as int?) ?? 9999;
        return pa != pb ? pa.compareTo(pb) : chave(a).compareTo(chave(b));
      });
    } else {
      r.sort((a, b) => chave(b).compareTo(chave(a)));
    }
    return r;
  }

  /// Publicados com data até hoje (um publicado com data futura espera o dia para aparecer na lista).
  List<Map<String, dynamic>> _publicadosVisiveis() =>
      [for (final d in store.listar('devocionais')) if (d['status'] == 'publicado' && '${d['data']}'.compareTo(_hoje) <= 0) d];

  /// O mais recente publicado: o "Devocional da semana" do site e do QR do telão.
  Map<String, dynamic>? destaque() {
    final lista = _ordenados(_publicadosVisiveis());
    if (lista.isEmpty) return null;
    final d = lista.first;
    return {
      'id': d['id'], 'titulo': d['titulo'], 'data': d['data'], 'referencia': d['referencia'],
      'trilhasNomes': [for (final t in _trilhasDe(d)) _nomeTrilha(t)],
      if (d['serie'] != null) 'serie': d['serie'],
      if (d['serieParte'] != null) 'serieParte': d['serieParte'],
      'resumo': _resumo('${d['texto']}'),
      'url': '/devocional?id=${Uri.encodeQueryComponent(d['id'] as String)}',
    };
  }

  static String _resumo(String texto) {
    final t = texto.replaceAll(RegExp(r'^#{1,3}\s+.*$', multiLine: true), '').replaceAll(RegExp(r'\s+'), ' ').trim();
    return t.length <= 220 ? t : '${t.substring(0, 217).trimRight()}…';
  }

  /// GET /api/public/devocionais?trilha=<id>&serie=<nome>&limite=<n> — resumo dos publicados.
  Response _listarPublicos(Request req) {
    final q = req.url.queryParameters;
    final trilha = q['trilha'] ?? '', serie = q['serie'] ?? '';
    final limite = (int.tryParse(q['limite'] ?? '') ?? 30).clamp(1, 100);
    final lista = _ordenados(_publicadosVisiveis().where((d) =>
        (trilha.isEmpty || _trilhasDe(d).contains(trilha)) && (serie.isEmpty || d['serie'] == serie)).toList());
    return _json({
      'destaque': destaque(),
      'devocionais': [
        for (final d in lista.take(limite))
          {
            'id': d['id'], 'titulo': d['titulo'], 'data': d['data'], 'referencia': d['referencia'],
            'trilhas': _trilhasDe(d), 'trilhasNomes': [for (final t in _trilhasDe(d)) _nomeTrilha(t)],
            if (d['serie'] != null) 'serie': d['serie'],
            if (d['serieParte'] != null) 'serieParte': d['serieParte'],
            'resumo': _resumo('${d['texto']}'),
          },
      ],
    });
  }

  Map<String, dynamic> _buscar(String id) => store.buscar('devocionais', id) ??
      (throw const _HttpErro(404, 'Devocional não encontrado.'));
  Map<String, dynamic> _publicado(String id) {
    final d = _buscar(id);
    if (d['status'] != 'publicado') throw const _HttpErro(404, 'Devocional não encontrado.');
    return d;
  }

  /// [anterior]: trilhas que o devocional já tinha podem continuar mesmo se foram desativadas.
  Map<String, dynamic> _validar(Map<String, dynamic> j, {Map<String, dynamic>? anterior}) {
    final d = <String, dynamic>{};
    for (final campo in _textos.entries) {
      final v = j[campo.key];
      if (v is! String || v.trim().isEmpty || v.length > campo.value) {
        throw FormatException('Campo ${campo.key} inválido (máximo ${campo.value} caracteres).');
      }
      d[campo.key] = v.trim();
    }
    if (!_data(d['data'])) throw const FormatException('Data inválida.');

    final status = j['status'] ?? 'rascunho';
    if (status is! String || !_situacoes.contains(status)) throw const FormatException('Situação inválida.');
    d['status'] = status;

    final trilhas = j['trilhas'];
    if (trilhas is! List || trilhas.isEmpty || trilhas.length > maximoTrilhasPorDevocional || trilhas.any((t) => t is! String)) {
      throw const FormatException('Escolha de 1 a $maximoTrilhasPorDevocional trilhas.');
    }
    final ja = anterior == null ? const <String>[] : _trilhasDe(anterior);
    final ativas = {for (final t in _trilhas(ativas: true)) t['id']};
    for (final t in trilhas) {
      if (!ativas.contains(t) && !(ja.contains(t) && store.buscar(colecaoTrilhas, t as String) != null)) {
        throw FormatException('Trilha inválida ou desativada: $t');
      }
    }
    d['trilhas'] = [...{...trilhas.cast<String>()}];

    final serie = j['serie'];
    if (serie != null && (serie is! String || serie.trim().length > 120)) throw const FormatException('Série inválida (até 120 letras).');
    final nomeSerie = serie is String && serie.trim().isNotEmpty ? serie.trim().replaceAll(RegExp(r'\s+'), ' ') : null;
    final parte = j['serieParte'];
    if (parte != null && (parte is! int || parte < 1 || parte > 365)) throw const FormatException('Parte da série inválida (1 a 365).');
    d['serie'] = nomeSerie;
    d['serieParte'] = nomeSerie == null ? null : parte;

    final publicarEm = j['publicarEm'];
    if (publicarEm != null && (publicarEm is! String || !_dataHora(publicarEm))) {
      throw const FormatException('Data e hora de publicação inválidas.');
    }
    if (status == 'agendado') {
      if (publicarEm == null) throw const FormatException('Informe quando publicar.');
      if ((publicarEm as String).compareTo(_agoraLocal) <= 0) {
        throw const FormatException('Escolha um horário de publicação no futuro (ou publique agora).');
      }
    }
    d['publicarEm'] = status == 'agendado' ? publicarEm : null;
    final enviar = j['enviarAoPublicar'] ?? false;
    if (enviar is! bool) throw const FormatException('"enviarAoPublicar" deve ser verdadeiro ou falso.');
    d['enviarAoPublicar'] = enviar;
    return d;
  }

  /// Corpo no formato antigo ({"tema": "casais"}) vira {"trilhas": ["casais"]}.
  static Map<String, dynamic> _normalizar(Map<String, dynamic> j) {
    if (!j.containsKey('trilhas') && j['tema'] is String) return {...j, 'trilhas': [j['tema']]}..remove('tema');
    return {...j}..remove('tema');
  }

  Future<Response> _criar(Request req) async {
    final j = _normalizar(await _corpo(req));
    return _estado.executar(() async {
      final d = {..._validar(j), 'id': novoId(), 'criadoEm': _agora().toIso8601String()};
      if (d['status'] == 'publicado') d['publicadoEm'] = _agora().toIso8601String();
      d.removeWhere((_, v) => v == null);
      await store.salvar('devocionais', d);
      return _json(_exibir(d), 201);
    });
  }

  Future<Response> _editar(Request req) async {
    final j = _normalizar(await _corpo(req));
    return _estado.executar(() async {
      final anterior = _buscar(req.params['id']!);
      final base = {...anterior, 'trilhas': _trilhasDe(anterior)}..remove('tema');
      final novo = _validar({...base, ...j}, anterior: anterior);
      final d = {...base, ...novo, 'atualizadoEm': _agora().toIso8601String()};
      if (novo['status'] == 'publicado' && anterior['status'] != 'publicado') d['publicadoEm'] = _agora().toIso8601String();
      d.removeWhere((_, v) => v == null);
      await store.salvar('devocionais', d);
      return _json(_exibir(d));
    });
  }

  Future<Response> _importar(Request req) async => _json({'texto': textoDoArquivo(
      req.url.queryParameters['nome'] ?? '', await _bytes(req, tamanhoMaximoImportacao))});

  // ---------- Agendamento ----------

  /// Confere os agendados a cada minuto (o servidor real chama; os testes chamam [processarAgendados]).
  /// Roda uma vez já na subida: um devocional marcado para enquanto o servidor estava parado
  /// entra no ar logo que ele volta, sem esperar o primeiro minuto.
  void iniciarAgendador() {
    _agendador?.cancel();
    unawaited(processarAgendados().catchError((_) => 0));
    _agendador = Timer.periodic(const Duration(minutes: 1), (_) => unawaited(processarAgendados().catchError((_) => 0)));
  }

  void pararAgendador() => _agendador?.cancel();

  /// Publica os agendados cujo horário chegou e, se pedido, envia aos assinantes das trilhas.
  /// Retorna quantos foram publicados.
  Future<int> processarAgendados() async {
    final vencidos = await _estado.executar(() async {
      final agora = _agoraLocal, ids = <String>[];
      for (final d in store.listar('devocionais')) {
        if (d['status'] != 'agendado' || '${d['publicarEm']}'.compareTo(agora) > 0) continue;
        await store.salvar('devocionais', {...d, 'status': 'publicado', 'publicadoEm': _agora().toIso8601String()});
        ids.add(d['id'] as String);
      }
      return ids;
    });
    for (final id in vencidos) {
      final d = store.buscar('devocionais', id);
      if (d == null || d['enviarAoPublicar'] != true) continue;
      final r = await _lote(id, {'membrosIds': <String>[], 'incluirAssinantes': true});
      await _estado.executar(() async {
        final atual = store.buscar('devocionais', id);
        if (atual != null) {
          await store.salvar('devocionais', {...atual, 'envioAutomatico': {...r, 'em': _agora().toIso8601String()}});
        }
      });
    }
    return vencidos.length;
  }

  // ---------- Assinaturas ----------

  List<Map<String, dynamic>> _membros() => [for (final m in store.listar('membros'))
    if ((StatusMembro.porNome(m['status'] is String ? m['status'] as String : null) ??
        StatusMembro.legado(m['ativo'] != false)).ativo && _data(m['consentimentoEm']) &&
        !_agora().isBefore(DateTime.parse(m['consentimentoEm'] as String)) && _emailValido(m['email']))
      {'id': m['id'], 'nome': m['nome'], 'email': _email(m['email'] as String)}];

  /// Números por trilha (sem e-mails: a lista de assinantes não sai do servidor).
  Map<String, dynamic> _resumoAssinantes() {
    final assinaturas = store.listar('assinaturasDevocionais');
    final agora = _agora();
    bool pendenteValida(Map<String, dynamic> a) {
      final expira = DateTime.tryParse('${(a['pendente'] as Map?)?['expiraEm']}');
      return expira != null && expira.isAfter(agora);
    }
    return {
      'ativos': assinaturas.where((a) => a['status'] == 'ativo').length,
      'pendentes': assinaturas.where((a) => a['status'] != 'ativo' && a['status'] != 'cancelado' && pendenteValida(a)).length,
      'cancelados': assinaturas.where((a) => a['status'] == 'cancelado').length,
      'trilhas': [
        for (final t in _trilhas())
          {
            'id': t['id'], 'nome': t['nome'], 'ativa': t['ativa'] != false,
            'ativos': assinaturas.where((a) => a['status'] == 'ativo' && (a['temas'] as List? ?? []).contains(t['id'])).length,
          },
      ],
    };
  }

  Future<Response> _assinar(Request req) async {
    final j = await _corpo(req);
    if (!_ipInscricao.permitir(_ip(req))) return _json(_generico);
    if (j['website'] != null && j['website'] != '') return _json(_generico);
    final temas = j['temas'] ?? j['trilhas'];
    final ativas = {for (final t in _trilhas(ativas: true)) t['id']};
    if (!_emailValido(j['email']) || j['autorizo'] != true || temas is! List || temas.isEmpty ||
        temas.length > maximoTrilhas || temas.any((t) => !ativas.contains(t))) {
      throw const FormatException('Informe e-mail, trilhas válidas e autorização específica.');
    }
    final email = _email(j['email'] as String);
    if (!_emailInscricao.permitir(email)) return _json(_generico);
    // Segredo só existe nesta pilha e na mensagem individual, nunca na Store/resposta.
    final token = gerarSegredo(32);
    await _estado.executar(() async {
      final anterior = store.listar('assinaturasDevocionais').where((a) => a['email'] == email).firstOrNull;
      await store.salvar('assinaturasDevocionais', {
        ...?anterior, 'id': anterior?['id'] ?? novoId(), 'email': email,
        'status': anterior?['status'] ?? 'pendente',
        'pendente': {'hash': _hash(token), 'expiraEm': _agora().add(const Duration(hours: 24)).toIso8601String(),
          'solicitadoEm': _agora().toIso8601String(), 'temas': temas.toSet().toList(), 'autorizo': true},
      });
    });
    try {
      await _enviar(montarEmailConfirmacao(destinatario: email, igreja: _igreja(),
          urlConfirmar: '$_base/devocional#confirmar=$token')).timeout(const Duration(seconds: 45));
    } catch (_) {
      // Resposta idêntica: falhas de SMTP não revelam a existência de assinaturas.
    }
    return _json(_generico);
  }

  Future<Response> _token(Request req, {required bool cancelar}) async {
    if (!_tokens.permitir(_ip(req))) throw const _HttpErro(429, 'Aguarde antes de tentar novamente.');
    final j = await _corpo(req), token = j['token'];
    if (token is! String || !RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(token)) throw const FormatException('Link inválido ou vencido.');
    final hash = _hash(token);
    return _estado.executar(() async {
      Map<String, dynamic>? encontrado;
      for (final a in store.listar('assinaturasDevocionais')) {
        if (cancelar ? (a['cancelarHashes'] as List? ?? []).contains(hash) : (a['pendente'] as Map?)?['hash'] == hash) {
          encontrado = a; break;
        }
      }
      if (encontrado == null) throw const FormatException('Link inválido ou vencido.');
      final a = {...encontrado};
      if (cancelar) {
        a['status'] = 'cancelado'; a['canceladoEm'] = _agora().toIso8601String();
        a.remove('pendente');
      } else {
        final pendente = a['pendente'] as Map;
        final expira = DateTime.tryParse('${pendente['expiraEm']}');
        if (expira == null || !expira.isAfter(_agora())) throw const FormatException('Link inválido ou vencido.');
        a['status'] = 'ativo'; a['temas'] = pendente['temas'];
        a['consentimentoEm'] = _agora().toIso8601String();
        a['consentimentoVersao'] = 1;
        a['consentimentoVia'] = 'double-opt-in';
        final membro = store.listar('membros').where((m) => m['email'] is String && _email(m['email'] as String) == a['email']).firstOrNull;
        if (membro != null) a['membroId'] = membro['id'];
        a.remove('pendente');
      }
      await store.salvar('assinaturasDevocionais', a); return _json({'ok': true});
    });
  }

  // ---------- Envio ----------

  List<Map<String, dynamic>> _destinatarios(Map<String, dynamic> j, Map<String, dynamic> d) {
    final ids = j['membrosIds'] ?? [], assinantes = j['incluirAssinantes'] ?? false;
    if (ids is! List || ids.length > 1000 || ids.any((id) => id is! String) || assinantes is! bool) {
      throw const FormatException('Selecione membrosIds e incluirAssinantes válidos.');
    }
    final unicos = <String, Map<String, dynamic>>{};
    for (final m in _membros()) {
      if (ids.contains(m['id'])) unicos[m['email'] as String] = {'nome': m['nome'], 'email': m['email'], 'membroId': m['id']};
    }
    if (assinantes) {
      for (final a in store.listar('assinaturasDevocionais')) {
        if (_assinanteAtivo(a, d)) {
          final email = a['email'] as String;
          unicos[email] = {...?unicos[email], 'nome': unicos[email]?['nome'] ?? '', 'email': email, 'assinaturaId': a['id']};
        }
      }
    }
    for (final email in _cancelados) { unicos.remove(email); }
    return unicos.values.toList();
  }
  Set<String> get _cancelados => {for (final a in store.listar('assinaturasDevocionais'))
    if (a['status'] == 'cancelado' && a['email'] is String) _email(a['email'] as String)};
  int _suprimidos(Map<String, dynamic> j) {
    final ids = j['membrosIds'] as List? ?? [];
    final cancelados = _cancelados;
    return {for (final m in _membros()) if (ids.contains(m['id']) && cancelados.contains(m['email'])) m['email']}.length;
  }

  /// Assinante ativo de alguma das trilhas do devocional (quem assina duas recebe um e-mail só).
  bool _assinanteAtivo(Map<String, dynamic> a, Map<String, dynamic> d) {
    final temas = a['temas'] as List? ?? [];
    return a['status'] == 'ativo' && DateTime.tryParse('${a['consentimentoEm']}') != null &&
        _trilhasDe(d).any(temas.contains) && _emailValido(a['email']);
  }

  bool _mesmoConteudo(Map<String, dynamic>? a, Map<String, dynamic> b) {
    if (a == null) return false;
    String v(Map<String, dynamic> m, String k) => jsonEncode(k == 'trilhas' ? _trilhasDe(m) : m[k]);
    return _conteudo.every((k) => v(a, k) == v(b, k));
  }

  EmailDevocional _montar(Map<String, dynamic> d, {required String destinatario, String? urlCancelar}) {
    final nomes = [for (final t in _trilhasDe(d)) _nomeTrilha(t)];
    return montarEmailDevocional(d, destinatario: destinatario, igreja: _igreja(), urlPublica: _url(d['id'] as String),
        urlCancelar: urlCancelar, trilhas: nomes);
  }

  String _reciboId(String id, String email) => _hash('$id\n$email');
  Future<Response> _previa(Request req) async {
    final j = await _corpo(req), d = _publicado(req.params['id']!);
    final destinos = _destinatarios(j, d);
    final e = _montar(d, destinatario: '');
    var enviados = 0, incertos = 0;
    for (final dest in destinos) {
      final r = store.buscar('enviosDevocionais', _reciboId(d['id'] as String, dest['email'] as String));
      if (r?['status'] == 'enviado') enviados++;
      if ({'enviando', 'incerto'}.contains(r?['status'])) incertos++;
    }
    return _json({'assunto': e.assunto, 'texto': e.texto, 'html': e.htmlSemLogo,
      'destinatarios': [for (final dest in destinos) {'nome': dest['nome'], 'email': dest['email']}],
      'total': destinos.length, 'jaEnviados': enviados, 'incertos': incertos,
      'suprimidos': _suprimidos(j), 'motivoSupressao': 'Cancelamento explícito de devocionais é respeitado também em envios avulsos.',
      'aEnviar': destinos.length - enviados - incertos});
  }

  /// Situação dos envios de um devocional (números; sem a lista de e-mails).
  Map<String, dynamic> _envios(String id) {
    final d = _buscar(id);
    final recibos = store.listar('enviosDevocionais').where((r) => r['devocionalId'] == id).toList();
    int conta(String s) => recibos.where((r) => r['status'] == s).length;
    return {
      'enviados': conta('enviado'), 'falhas': conta('falhou'), 'incertos': conta('incerto') + conta('enviando'),
      if (d['envioAutomatico'] != null) 'envioAutomatico': d['envioAutomatico'],
    };
  }

  Future<Response> _disparar(Request req) async {
    final j = await _corpo(req);
    if (j['confirmar'] != true) throw const FormatException('Confirme explicitamente o envio.');
    _publicado(req.params['id']!);
    return _json(await _lote(req.params['id']!, j));
  }

  /// Envia o devocional publicado [id] aos destinatários de [j]; cada um no máximo uma vez.
  Future<Map<String, dynamic>> _lote(String id, Map<String, dynamic> j) async {
    final d = Map<String, dynamic>.from(_publicado(id));
    final destinos = _destinatarios(j, d); // Snapshot: não adicionar inscritos no meio do lote.
    final suprimidos = _suprimidos(j);
    var enviados = 0, ignorados = suprimidos, falhas = 0, incertos = 0;
    for (final dest in destinos) {
      final email = dest['email'] as String, reciboId = _reciboId(id, dest['email'] as String);
      final reserva = await _estado.executar(() async {
        final atual = store.buscar('devocionais', id);
        if (atual == null || atual['status'] != 'publicado' || !_mesmoConteudo(atual, d)) return null;
        final recibo = store.buscar('enviosDevocionais', reciboId);
        if (recibo != null && recibo['status'] != 'falhou') return null;
        // Revalida cada destinatário contra cancelamentos e revogações após a prévia.
        final selecionados = _destinatarios(j, atual);
        final vivo = selecionados.where((s) => s['email'] == email).firstOrNull;
        if (vivo == null) return null;
        String? cancelar;
        if (vivo['assinaturaId'] != null) {
          final a = store.buscar('assinaturasDevocionais', vivo['assinaturaId'] as String)!;
          final token = gerarSegredo(32);
          final hashes = [...(a['cancelarHashes'] as List? ?? []), _hash(token)];
          await store.salvar('assinaturasDevocionais', {...a,
            'cancelarHashes': hashes.length > maximoCancelamentos
                ? hashes.sublist(hashes.length - maximoCancelamentos)
                : hashes});
          cancelar = '$_base/devocional#cancelar=$token';
        }
        final reserva = {'id': reciboId, 'devocionalId': id, 'email': email, 'status': 'enviando',
          'reservadoEm': _agora().toIso8601String(), 'tentativas': (recibo?['tentativas'] as int? ?? 0) + 1};
        await store.salvar('enviosDevocionais', reserva);
        return (recibo: reserva, destinatario: vivo, urlCancelar: cancelar);
      });
      if (reserva == null) { ignorados++; continue; }
      // Sem await entre a última inspeção e iniciar SMTP; cancelamento nunca aguarda a rede.
      final atual = store.buscar('devocionais', id);
      final vivos = atual == null ? <Map<String, dynamic>>[] : _destinatarios(j, atual);
      if (atual?['status'] != 'publicado' || !_mesmoConteudo(atual, d) || !vivos.any((s) => s['email'] == email)) {
        await _estado.executar(() => store.excluir('enviosDevocionais', reciboId));
        ignorados++; continue;
      }
      var status = 'incerto';
      try {
        await _enviar(_montar(d, destinatario: email, urlCancelar: reserva.urlCancelar)).timeout(const Duration(seconds: 45));
        status = 'enviado';
      } on FalhaEmailDevocional {
        status = 'falhou';
      } catch (_) {
        status = 'incerto';
      }
      try {
        await _estado.executar(() => store.salvar('enviosDevocionais', {...reserva.recibo,
          'status': status, 'finalizadoEm': _agora().toIso8601String()}));
      } catch (_) {
        // SMTP pode ter aceitado, mas o disco não confirmou: manter reserva impede duplicação.
        status = 'incerto';
      }
      switch (status) { case 'enviado': enviados++; case 'falhou': falhas++; default: incertos++; }
    }
    // Uma falha clara (SMTP não configurado, destinatário recusado) precisa chegar ao líder
    // como orientação: só os números não dizem o que corrigir.
    final aviso = falhas > 0 && enviados == 0
        ? 'Nenhuma mensagem foi enviada. Confira o servidor SMTP em Administração e tente de novo.'
        : null;
    return {'enviados': enviados, 'ignorados': ignorados, 'falhas': falhas, 'incertos': incertos,
      'total': destinos.length + suprimidos, 'suprimidos': suprimidos, if (aviso != null) 'aviso': aviso};
  }
}

class _Estado {
  Future<void> _fila = Future.value();
  Future<T> executar<T>(Future<T> Function() acao) {
    final f = _fila.then((_) => acao());
    _fila = f.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return f;
  }
}

class _HttpErro implements Exception {
  const _HttpErro(this.status, this.mensagem);
  final int status;
  final String mensagem;
}
String _email(String s) => s.trim().toLowerCase();
bool _emailValido(Object? s) => s is String && s.length <= 254 &&
    RegExp(r'^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$').hasMatch(_email(s));
bool _data(Object? s) {
  if (s is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) return false;
  final d = DateTime.tryParse(s);
  return d != null && d.year > 0 && d.toIso8601String().substring(0, 10) == s;
}
/// "2026-11-20T07:00" (hora de parede, sem fuso: a do servidor, que é a da igreja).
bool _dataHora(String s) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$').hasMatch(s) || !_data(s.substring(0, 10))) return false;
  final h = int.parse(s.substring(11, 13)), m = int.parse(s.substring(14, 16));
  return h < 24 && m < 60;
}
/// "Família " -> "familia": compara nomes sem acento, caixa ou espaços extras.
String _chave(String s) {
  const de = 'áàâãäéèêëíìîïóòôõöúùûüçñ', para = 'aaaaaeeeeiiiiooooouuuucn';
  return s.trim().toLowerCase().split('').map((c) => de.contains(c) ? para[de.indexOf(c)] : c).join();
}
String _hash(String s) => sha256.convert(utf8.encode(s)).toString();
Response _json(Object? dados, [int status = 200]) => Response(status, body: jsonEncode(dados), headers: jsonHeaders);
Response _erro(int status, String mensagem) => _json({'erro': mensagem}, status);
Future<List<int>> _bytes(Request req, int limite) async {
  final bytes = <int>[];
  await for (final bloco in req.read()) {
    if (bytes.length + bloco.length > limite) throw const _HttpErro(413, 'Conteúdo muito grande.');
    bytes.addAll(bloco);
  }
  return bytes;
}
Future<Map<String, dynamic>> _corpo(Request req) async {
  final j = jsonDecode(utf8.decode(await _bytes(req, 256 * 1024)));
  if (j is! Map<String, dynamic>) throw const FormatException('Envie um objeto JSON.');
  return j;
}
