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
  /// Quantos links de cancelamento ficam guardados por assinatura. O arquivo é regravado a cada
  /// envio, então a lista não pode crescer para sempre; os links mais antigos que isso deixam
  /// de valer, e todo devocional novo traz um link atual.
  static const maximoCancelamentos = 24;
  static const _campos = {'titulo': 200, 'autorNome': 120, 'data': 10, 'tema': 10,
    'referencia': 300, 'texto': 50000, 'aplicacao': 10000, 'oracao': 10000, 'status': 10};
  static const _generico = {'ok': true,
    'mensagem': 'Se a solicitação puder ser atendida, você receberá um e-mail para confirmar.'};

  late final Router router = _rotas();
  Router _rotas() {
    final r = Router();
    void rota(String metodo, String caminho, FutureOr<Response> Function(Request) acao, {bool publica = false}) {
      r.add(metodo, caminho, (Request req) async {
        if (!publica) {
          final conta = Auth.contaDa(req);
          if (conta == null) return _erro(401, 'Faça login.');
          final permissao = Permissao.porNome('devocionais');
          if (conta.trocarSenha || (permissao != null ? !conta.pode(permissao) :
              !{'administrador', 'pastor'}.contains(conta.perfil.id))) {
            return _erro(403, 'Sem permissão para devocionais.');
          }
        }
        try {
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
    rota('GET', '/api/devocionais', (_) => _json([for (final d in store.listar('devocionais')) _exibir(d)]));
    rota('POST', '/api/devocionais', _criar);
    rota('GET', '/api/devocionais/destinatarios', (_) => _json(_membros()));
    rota('POST', '/api/devocionais/importar', _importar);
    rota('POST', '/api/devocionais/<id>/previa-email', _previa);
    rota('POST', '/api/devocionais/<id>/email', _disparar);
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
    rota('POST', '/api/public/devocionais/assinar', _assinar, publica: true);
    rota('POST', '/api/public/devocionais/confirmar', (req) => _token(req, cancelar: false), publica: true);
    rota('POST', '/api/public/devocionais/cancelar', (req) => _token(req, cancelar: true), publica: true);
    rota('GET', '/api/public/devocionais/<id>', (req) => _json(_exibir(_publicado(req.params['id']!), publico: true)), publica: true);
    return r;
  }

  String get _base => _urlBase().replaceFirst(RegExp(r'/+$'), '');
  String _url(String id) => '$_base/devocional?id=${Uri.encodeQueryComponent(id)}';
  Map<String, dynamic> _exibir(Map<String, dynamic> d, {bool publico = false}) => {
    'id': d['id'], for (final k in _campos.keys) if (!publico || k != 'status') k: d[k],
    'urlPublica': _url(d['id'] as String),
  };
  Map<String, dynamic> _buscar(String id) => store.buscar('devocionais', id) ??
      (throw const _HttpErro(404, 'Devocional não encontrado.'));
  Map<String, dynamic> _publicado(String id) {
    final d = _buscar(id);
    if (d['status'] != 'publicado') throw const _HttpErro(404, 'Devocional não encontrado.');
    return d;
  }
  Map<String, dynamic> _validar(Map<String, dynamic> j) {
    final d = <String, dynamic>{};
    for (final campo in _campos.entries) {
      final v = j[campo.key] ?? (campo.key == 'status' ? 'rascunho' : null);
      if (v is! String || v.trim().isEmpty || v.length > campo.value) {
        throw FormatException('Campo ${campo.key} inválido (máximo ${campo.value} caracteres).');
      }
      d[campo.key] = v.trim();
    }
    if (!_data(d['data']) || !{'casais', 'familia'}.contains(d['tema']) ||
        !{'rascunho', 'publicado'}.contains(d['status'])) throw const FormatException('Data, tema ou status inválido.');
    return d;
  }
  Future<Response> _criar(Request req) async {
    final d = {..._validar(await _corpo(req)), 'id': novoId(), 'criadoEm': _agora().toIso8601String()};
    return _estado.executar(() async { await store.salvar('devocionais', d); return _json(_exibir(d), 201); });
  }
  Future<Response> _editar(Request req) async {
    final j = await _corpo(req);
    return _estado.executar(() async {
      final anterior = _buscar(req.params['id']!);
      final d = {...anterior, ..._validar({...anterior, ...j}), 'atualizadoEm': _agora().toIso8601String()};
      await store.salvar('devocionais', d); return _json(_exibir(d));
    });
  }
  Future<Response> _importar(Request req) async => _json({'texto': textoDoArquivo(
      req.url.queryParameters['nome'] ?? '', await _bytes(req, tamanhoMaximoImportacao))});

  List<Map<String, dynamic>> _membros() => [for (final m in store.listar('membros'))
    if ((StatusMembro.porNome(m['status'] is String ? m['status'] as String : null) ??
        StatusMembro.legado(m['ativo'] != false)).ativo && _data(m['consentimentoEm']) &&
        !_agora().isBefore(DateTime.parse(m['consentimentoEm'] as String)) && _emailValido(m['email']))
      {'id': m['id'], 'nome': m['nome'], 'email': _email(m['email'] as String)}];

  Future<Response> _assinar(Request req) async {
    final j = await _corpo(req);
    if (!_ipInscricao.permitir(_ip(req))) return _json(_generico);
    if (j['website'] != null && j['website'] != '') return _json(_generico);
    final temas = j['temas'];
    if (!_emailValido(j['email']) || j['autorizo'] != true || temas is! List || temas.isEmpty ||
        temas.length > 2 || temas.any((t) => !{'casais', 'familia'}.contains(t))) {
      throw const FormatException('Informe e-mail, temas válidos e autorização específica.');
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
  bool _assinanteAtivo(Map<String, dynamic> a, Map<String, dynamic> d) =>
      a['status'] == 'ativo' && DateTime.tryParse('${a['consentimentoEm']}') != null &&
      (a['temas'] as List? ?? []).contains(d['tema']) && _emailValido(a['email']);

  String _reciboId(String id, String email) => _hash('$id\n$email');
  Future<Response> _previa(Request req) async {
    final j = await _corpo(req), d = _publicado(req.params['id']!);
    final destinos = _destinatarios(j, d);
    final e = montarEmailDevocional(d, destinatario: '', igreja: _igreja(), urlPublica: _url(d['id'] as String));
    var enviados = 0, incertos = 0;
    for (final dest in destinos) {
      final r = store.buscar('enviosDevocionais', _reciboId(d['id'] as String, dest['email'] as String));
      if (r?['status'] == 'enviado') enviados++;
      if ({'enviando', 'incerto'}.contains(r?['status'])) incertos++;
    }
    return _json({'assunto': e.assunto, 'texto': e.texto, 'html': e.html,
      'destinatarios': [for (final dest in destinos) {'nome': dest['nome'], 'email': dest['email']}],
      'total': destinos.length, 'jaEnviados': enviados, 'incertos': incertos,
      'suprimidos': _suprimidos(j), 'motivoSupressao': 'Cancelamento explícito de devocionais é respeitado também em envios avulsos.',
      'aEnviar': destinos.length - enviados - incertos});
  }

  Future<Response> _disparar(Request req) async {
    final j = await _corpo(req);
    if (j['confirmar'] != true) throw const FormatException('Confirme explicitamente o envio.');
    final id = req.params['id']!, d = Map<String, dynamic>.from(_publicado(req.params['id']!));
    final destinos = _destinatarios(j, d); // Snapshot: não adicionar inscritos no meio do lote.
    final suprimidos = _suprimidos(j);
    var enviados = 0, ignorados = suprimidos, falhas = 0, incertos = 0;
    for (final dest in destinos) {
      final email = dest['email'] as String, reciboId = _reciboId(id, dest['email'] as String);
      final reserva = await _estado.executar(() async {
        final atual = store.buscar('devocionais', id);
        if (atual == null || atual['status'] != 'publicado' ||
            _campos.keys.any((k) => atual[k] != d[k])) return null;
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
      if (atual?['status'] != 'publicado' || _campos.keys.any((k) => atual?[k] != d[k]) ||
          !vivos.any((s) => s['email'] == email)) {
        await _estado.executar(() => store.excluir('enviosDevocionais', reciboId));
        ignorados++; continue;
      }
      var status = 'incerto';
      try {
        await _enviar(montarEmailDevocional(d, destinatario: email, igreja: _igreja(),
            urlPublica: _url(id), urlCancelar: reserva.urlCancelar)).timeout(const Duration(seconds: 45));
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
    return _json({'enviados': enviados, 'ignorados': ignorados, 'falhas': falhas, 'incertos': incertos,
      'total': destinos.length + suprimidos, 'suprimidos': suprimidos, if (aviso != null) 'aviso': aviso});
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
