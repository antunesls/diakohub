import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/devocionais.dart';
import 'package:diako_server/email_devocionais.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:diako_server/usuarios.dart';
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

void main() {
  late Directory tmp;
  late Store store;
  late Handler handler;
  late String sessao;
  late List<EmailDevocional> emails;
  late DateTime agora;
  late Future<void> Function(EmailDevocional) transporte;
  late Devocionais devocionais;

  Future<(int, dynamic)> chamar(String metodo, String rota,
      {Object? dados, bool publico = false}) async {
    final r = await handler(Request(metodo, Uri.parse('https://igreja.test$rota'),
        headers: {if (!publico) 'authorization': 'Bearer $sessao'},
        body: dados == null ? null : jsonEncode(dados)));
    final texto = await r.readAsString();
    return (r.statusCode, texto.isEmpty ? null : jsonDecode(texto));
  }

  Map<String, dynamic> dados([String status = 'rascunho']) => {
    'titulo': 'Caminhar juntos', 'autorNome': 'Ana', 'data': '2026-11-18',
    'tema': 'casais', 'referencia': 'Ec 4:9', 'texto': '<script>Reflexão</script>',
    'aplicacao': 'Conversar', 'oracao': 'Senhor, guia-nos.', 'status': status,
  };
  Future<String> criar([String status = 'publicado']) async {
    final r = await chamar('POST', '/api/devocionais', dados: dados(status));
    expect(r.$1, 201, reason: '${r.$2}');
    return r.$2['id'] as String;
  }
  Future<void> membro(String id, String email, {String status = 'membro', Object? consentimento = '2026-11-01'}) =>
      store.salvar('membros', {'id': id, 'nome': id, 'email': email, 'status': status,
        'consentimentoEm': consentimento, 'cpf': 'SEGREDO'});
  Future<String> assinar(String email, {List<String> temas = const ['casais']}) async {
    final r = await chamar('POST', '/api/public/devocionais/assinar', publico: true,
        dados: {'email': email, 'temas': temas, 'autorizo': true});
    expect(r.$1, 200);
    return RegExp(r'#confirmar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
  }
  Future<void> confirmar(String token) async {
    expect((await chamar('POST', '/api/public/devocionais/confirmar', publico: true,
        dados: {'token': token})).$1, 200);
  }
  Map<String, dynamic> selecao({List<String> ids = const [], bool assinantes = true, bool confirmar = true}) =>
      {'membrosIds': ids, 'incluirAssinantes': assinantes, 'confirmar': confirmar};

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('devocionais_');
    store = Store(tmp.path);
    await store.carregar();
    agora = DateTime.utc(2026, 11, 18, 12);
    emails = [];
    transporte = (e) async { emails.add(e); };
    final auth = Auth(senha: 'teste', pastaDados: tmp.path);
    sessao = (await auth.login('teste', 'fixture'))!;
    final modulo = devocionais = Devocionais(store, urlBase: () => 'https://igreja.test/', igreja: () => 'Igreja',
        agora: () => agora, ip: (_) => 'fixture', enviar: (e) => transporte(e));
    handler = auth.middleware((r) => r.url.path.startsWith('api/public/'))(modulo.router.call);
  });
  tearDown(() async { await store.fechar(); await tmp.delete(recursive: true); });

  test('exige conta mesmo sem middleware externo', () async {
    final modulo = Devocionais(store, urlBase: () => '', igreja: () => '', enviar: (e) async {});
    expect((await modulo.router.call(Request('GET', Uri.parse('http://x/api/devocionais')))).statusCode, 401);
  });
  test('rascunho privado, publicação sem disparo, retirada e exclusão', () async {
    final id = await criar('rascunho');
    expect((await chamar('GET', '/api/public/devocionais/$id', publico: true)).$1, 404);
    expect((await chamar('GET', '/api/devocionais')).$2, hasLength(1));
    final atualizado = await chamar('PUT', '/api/devocionais/$id', dados: {'status': 'publicado'});
    expect(atualizado.$1, 200);
    expect(atualizado.$2['urlPublica'], 'https://igreja.test/devocional?id=$id');
    final publico = await chamar('GET', '/api/public/devocionais/$id', publico: true);
    expect(publico.$1, 200);
    // Só conteúdo: sem situação, agendamento nem envios. O "tema" antigo virou a lista de trilhas.
    expect((publico.$2 as Map).keys, unorderedEquals([
      ...dados().keys.where((k) => k != 'status' && k != 'tema'), 'trilhas', 'trilhasNomes', 'id', 'urlPublica']));
    expect(publico.$2['trilhas'], ['casais']);
    expect(publico.$2['trilhasNomes'], ['Casais']);
    expect(emails, isEmpty);
    expect((await chamar('PUT', '/api/devocionais/$id', dados: {'status': 'rascunho'})).$1, 200);
    expect((await chamar('GET', '/api/public/devocionais/$id', publico: true)).$1, 404);
    expect((await chamar('DELETE', '/api/devocionais/$id')).$1, 200);
    expect((await chamar('GET', '/api/devocionais/$id')).$1, 404);
  });
  test('valida tipos, limites, datas reais e tema', () async {
    for (final extra in <Map<String, dynamic>>[
      {'data': '2026-02-30'}, {'data': '2025-02-29'}, {'titulo': 1},
      {'titulo': 'a' * 201}, {'texto': ''}, {'tema': 'outro'}, {'status': 'x'}, {'autorNome': []},
    ]) {
      expect((await chamar('POST', '/api/devocionais', dados: {...dados(), ...extra})).$1, 400);
    }
  });
  test('importa texto e rejeita formatos não aceitos', () async {
    final r = await handler(Request('POST', Uri.parse('http://x/api/devocionais/importar?nome=reflexao.txt'),
        headers: {'authorization': 'Bearer $sessao'}, body: utf8.encode('Reflexão\r\nTeste')));
    expect(r.statusCode, 200);
    expect(jsonDecode(await r.readAsString()), {'texto': 'Reflexão\nTeste'});
  });
  test('destinatários mínimos: ativos com autorização válida', () async {
    await membro('a', ' ANA@EXEMPLO.TEST ');
    await membro('b', 'b@exemplo.test', status: 'visitante');
    await membro('c', 'c@exemplo.test', consentimento: '2026-02-30');
    await membro('d', 'd@exemplo.test', consentimento: null);
    final r = await chamar('GET', '/api/devocionais/destinatarios');
    expect(r.$2, [{'id': 'a', 'nome': 'a', 'email': 'ana@exemplo.test'}]);
  });
  test('double opt-in: só hash, pendente separado, membro associado, GET não altera', () async {
    await membro('ana', 'ana@exemplo.test');
    final token = await assinar('ANA@exemplo.test');
    expect(token.length, 43);
    final disco = await File('${tmp.path}/assinaturasDevocionais.json').readAsString();
    expect(disco, isNot(contains(token)));
    expect(disco, contains(sha256.convert(utf8.encode(token)).toString()));
    expect(store.listar('assinaturasDevocionais').single['status'], isNot('ativo'));
    expect((await chamar('GET', '/api/public/devocionais/confirmar?token=$token', publico: true)).$1, isNot(200));
    await confirmar(token);
    final a = store.listar('assinaturasDevocionais').single;
    expect(a['status'], 'ativo');
    expect(a['membroId'], 'ana');
    expect(a['temas'], ['casais']);
    agora = agora.add(const Duration(hours: 2));
    final segundo = await assinar('ana@exemplo.test', temas: ['familia']);
    expect(store.listar('assinaturasDevocionais').single['temas'], ['casais']);
    await confirmar(segundo);
    expect(store.listar('assinaturasDevocionais').single['temas'], ['familia']);
    expect((await chamar('POST', '/api/public/devocionais/confirmar', publico: true, dados: {'token': token})).$1, 400);
  });
  test('confirmação expira em 24h e cancelamento invalida pendência', () async {
    final t = await assinar('a@exemplo.test');
    agora = agora.add(const Duration(hours: 24));
    expect((await chamar('POST', '/api/public/devocionais/confirmar', publico: true, dados: {'token': t})).$1, 400);
    agora = agora.add(const Duration(hours: 2));
    final novo = await assinar('a@exemplo.test');
    await confirmar(novo);
    final id = await criar();
    await chamar('POST', '/api/devocionais/$id/email', dados: selecao());
    final cancelar = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    agora = agora.add(const Duration(hours: 2));
    final pendente = await assinar('a@exemplo.test', temas: ['familia']);
    expect((await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': cancelar})).$1, 200);
    expect(store.listar('assinaturasDevocionais').single['status'], 'cancelado');
    expect((await chamar('POST', '/api/public/devocionais/confirmar', publico: true, dados: {'token': pendente})).$1, 400);
  });
  test('resposta genérica, honeypot, consentimento específico e limite de taxa', () async {
    final payload = {'email': 'a@exemplo.test', 'temas': ['casais'], 'autorizo': true};
    final r1 = await chamar('POST', '/api/public/devocionais/assinar', publico: true, dados: payload);
    final r2 = await chamar('POST', '/api/public/devocionais/assinar', publico: true, dados: payload);
    expect(r2.$1, r1.$1);
    expect(r2.$2, r1.$2);
    expect(emails, hasLength(1));
    expect((await chamar('POST', '/api/public/devocionais/assinar', publico: true,
        dados: {...payload, 'email': 'bot@exemplo.test', 'website': 'spam'})).$2, r1.$2);
    expect(emails, hasLength(1));
    expect((await chamar('POST', '/api/public/devocionais/assinar', publico: true,
        dados: {...payload, 'autorizo': false})).$1, 400);
  });
  test('painel de publicação: contagem por trilha, teste para mim, recibo e histórico', () async {
    await confirmar(await assinar('ana@exemplo.test'));
    await confirmar(await assinar('duas@exemplo.test', temas: ['casais', 'familia']));
    await confirmar(await assinar('familia@exemplo.test', temas: ['familia']));
    await assinar('pendente@exemplo.test'); // sem confirmar: não conta
    final contagem = (await chamar('GET', '/api/devocionais/assinantes/contagem?trilhas=casais,familia')).$2;
    expect(contagem['total'], 3, reason: 'quem assina as duas conta uma vez');
    expect(contagem['porTrilha'], {'casais': 2, 'familia': 2});
    expect((await chamar('GET', '/api/devocionais/assinantes/contagem?trilhas=')).$2['total'], 0);

    // Teste vale para rascunho, não deixa recibo e entra no histórico.
    final id = await criar('rascunho');
    emails.clear();
    expect((await chamar('POST', '/api/devocionais/$id/teste', dados: {'email': 'nao-e-email'})).$1, 400);
    expect((await chamar('POST', '/api/devocionais/$id/teste', dados: {'email': 'Eu@Igreja.test'})).$1, 200);
    expect(emails.single.destinatario, 'eu@igreja.test');
    expect(emails.single.assunto, startsWith('[Teste] '));
    expect(store.listar('enviosDevocionais'), isEmpty);
    var d = (await chamar('GET', '/api/devocionais/$id')).$2;
    expect(d['historicoEnvios'].single['tipo'], 'teste');
    expect(d['envio'], {'enviados': 0, 'falhas': 0, 'incertos': 0});

    // Envio aos assinantes: recibo nos números e uma linha no histórico (sem e-mails).
    expect((await chamar('PUT', '/api/devocionais/$id', dados: dados('publicado'))).$1, 200);
    emails.clear();
    final r = (await chamar('POST', '/api/devocionais/$id/email', dados: selecao())).$2;
    expect(r['enviados'], 2, reason: 'o devocional é da trilha casais');
    d = (await chamar('GET', '/api/devocionais/$id')).$2;
    expect(d['envio'], {'enviados': 2, 'falhas': 0, 'incertos': 0});
    final ultimo = d['historicoEnvios'].first as Map;
    expect(ultimo['tipo'], 'manual');
    expect(ultimo['enviados'], 2);
    expect(ultimo['assinantes'], true);
    expect(ultimo.toString(), isNot(contains('@')), reason: 'o histórico guarda só números');
    final lista = (await chamar('GET', '/api/devocionais')).$2 as List;
    expect(lista.firstWhere((x) => x['id'] == id)['envio']['enviados'], 2);
    // A página pública não mostra recibos nem histórico.
    final publico = (await chamar('GET', '/api/public/devocionais/$id', publico: true)).$2 as Map;
    expect(publico.containsKey('envio') || publico.containsKey('historicoEnvios'), isFalse);
    // Quem assinar depois é o que falta: um novo envio vai só para essa pessoa.
    await confirmar(await assinar('nova@exemplo.test'));
    expect((await chamar('POST', '/api/devocionais/$id/previa-email', dados: selecao())).$2['aEnviar'], 1);

    // SMTP não configurado: é falha certa (não "incerto"), e o próximo envio tenta de novo.
    transporte = (_) async => throw StateError('Configure o SMTP na administração antes de enviar devocionais.');
    final semSmtp = (await chamar('POST', '/api/devocionais/$id/email', dados: selecao())).$2;
    expect([semSmtp['enviados'], semSmtp['falhas'], semSmtp['incertos']], [0, 1, 0]);
    expect(semSmtp['aviso'], contains('SMTP'));
    transporte = (e) async { emails.add(e); };
    expect((await chamar('POST', '/api/devocionais/$id/email', dados: selecao())).$2['enviados'], 1);
  });

  test('prévia segura, deduplicação, tema, confirmação manual e recibos persistentes', () async {
    final t = await assinar('ana@exemplo.test'); await confirmar(t);
    final outro = await assinar('familia@exemplo.test', temas: ['familia']); await confirmar(outro);
    await membro('ana', 'ANA@exemplo.test');
    await membro('bia', 'bia@exemplo.test');
    final id = await criar();
    emails.clear();
    final previa = await chamar('POST', '/api/devocionais/$id/previa-email', dados: selecao(ids: ['ana', 'bia']));
    expect(previa.$1, 200);
    expect(previa.$2['total'], 2);
    expect(previa.$2['jaEnviados'], 0);
    expect(previa.$2.toString(), isNot(contains('#cancelar=')));
    expect(previa.$2['html'], isNot(contains('<script>')));
    expect((await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana'], confirmar: false))).$1, 400);
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana', 'bia']));
    expect(r.$2['enviados'], 2);
    expect(emails.map((e) => e.destinatario), unorderedEquals(['ana@exemplo.test', 'bia@exemplo.test']));
    expect(emails.firstWhere((e) => e.destinatario == 'ana@exemplo.test').texto, contains('#cancelar='));
    expect(store.listar('assinaturasDevocionais'), hasLength(2));
    expect((await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana', 'bia']))).$2['enviados'], 0);
    expect(store.listar('enviosDevocionais').every((e) => e['status'] == 'enviado'), true);
    expect((await chamar('POST', '/api/devocionais/$id/previa-email', dados: selecao(ids: ['ana', 'bia']))).$2['jaEnviados'], 2);
  });
  test('envios simultâneos reservam antes do SMTP e não repetem', () async {
    await membro('ana', 'ana@exemplo.test'); final id = await criar();
    final entrou = Completer<void>(), liberar = Completer<void>();
    transporte = (e) async {
      expect(store.listar('enviosDevocionais').single['status'], 'enviando');
      emails.add(e); entrou.complete(); await liberar.future;
    };
    final primeiro = chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']));
    await entrou.future;
    final segundo = chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']));
    liberar.complete();
    final resultados = await Future.wait([primeiro, segundo]);
    expect(resultados.map((r) => r.$2['enviados']).reduce((a, b) => a + b), 1);
    expect(emails, hasLength(1));
  });
  test('timeout e erros ambíguos ficam incertos, falha clara permite nova requisição', () async {
    await membro('ana', 'ana@exemplo.test'); final id = await criar();
    transporte = (_) async { throw TimeoutException('segredo SMTP'); };
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']));
    expect(r.$2['incertos'], 1);
    expect(r.$2.toString(), isNot(contains('segredo')));
    transporte = (e) async { emails.add(e); };
    expect((await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']))).$2['enviados'], 0);
    final outro = await criar();
    transporte = (_) async { throw const FalhaEmailDevocional('Configure o envio de e-mails (SMTP) em Administração.'); };
    final falhou = await chamar('POST', '/api/devocionais/$outro/email', dados: selecao(ids: ['ana']));
    expect(falhou.$2['falhas'], 1);
    expect(falhou.$2['aviso'], contains('SMTP'), reason: 'sem isso o líder só veria "Falhas: 1"');
    transporte = (e) async { emails.add(e); };
    expect((await chamar('POST', '/api/devocionais/$outro/email', dados: selecao(ids: ['ana']))).$2['enviados'], 1);
  });
  test('cancelamento e retirada durante lote impedem novos envios', () async {
    await membro('a', 'a@exemplo.test'); await membro('b', 'b@exemplo.test');
    final id = await criar();
    transporte = (e) async {
      emails.add(e);
      await chamar('PUT', '/api/devocionais/$id', dados: {'status': 'rascunho'});
    };
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['a', 'b']));
    expect(r.$2['enviados'], 1);
    expect(emails, hasLength(1));
  });
  test('alteração do conteúdo durante lote interrompe snapshot anterior', () async {
    await membro('a', 'a@exemplo.test'); await membro('b', 'b@exemplo.test');
    final id = await criar();
    transporte = (e) async {
      emails.add(e);
      await chamar('PUT', '/api/devocionais/$id', dados: {'tema': 'familia'});
    };
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['a', 'b']));
    expect(r.$2['enviados'], 1);
  });
  test('cancelamento de assinante após snapshot impede entrega restante', () async {
    final ta = await assinar('a@exemplo.test'); await confirmar(ta);
    final tb = await assinar('b@exemplo.test'); await confirmar(tb);
    final anterior = await criar();
    await chamar('POST', '/api/devocionais/$anterior/email', dados: selecao());
    final cancelar = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(
        emails.firstWhere((e) => e.destinatario == 'b@exemplo.test' && e.texto.contains('#cancelar=')).texto)!.group(1)!;
    emails.clear();
    final id = await criar();
    transporte = (e) async {
      emails.add(e);
      await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': cancelar});
    };
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao());
    expect(r.$2['enviados'], 1);
    expect(emails.single.destinatario, 'a@exemplo.test');
  });
  test('reservas sobrevivem reinício e nunca são retomadas automaticamente', () async {
    await membro('a', 'a@exemplo.test'); final id = await criar();
    final reciboId = sha256.convert(utf8.encode('$id\na@exemplo.test')).toString();
    await store.salvar('enviosDevocionais', {'id': reciboId, 'devocionalId': id, 'email': 'a@exemplo.test', 'status': 'enviando'});
    final reaberto = Store(tmp.path); await reaberto.carregar();
    final modulo = Devocionais(reaberto, urlBase: () => 'https://igreja.test', igreja: () => 'Igreja',
        enviar: (e) async { emails.add(e); });
    final auth = Auth(senha: 'teste', pastaDados: tmp.path);
    sessao = (await auth.login('teste', 'reinicio'))!;
    handler = auth.middleware((r) => r.url.path.startsWith('api/public/'))(modulo.router.call);
    try {
      final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['a']));
      expect(r.$2['enviados'], 0);
      expect(r.$2['ignorados'], 1);
      expect(emails, isEmpty);
    } finally { await reaberto.fechar(); }
  });
  test('limite por IP não depende do e-mail e respostas não enumeram', () async {
    for (var i = 0; i < 13; i++) {
      expect((await chamar('POST', '/api/public/devocionais/assinar', publico: true,
          dados: {'email': 'p$i@exemplo.test', 'temas': ['casais'], 'autorizo': true})).$1, 200);
    }
    expect(emails, hasLength(10));
  });
  test('liderança autorizada e secretaria negada pelo próprio módulo', () async {
    final hash = gerarHashSenha('senha-teste');
    await File('${tmp.path}/usuarios.json').writeAsString(jsonEncode([
      for (final perfil in [Perfil.liderCasais, Perfil.secretaria])
        {'id': perfil.id, 'nome': perfil.nome, 'login': perfil.id.toLowerCase(), 'perfil': perfil.id,
          'senhaHash': hash.hash, 'senhaSal': hash.sal, 'ativo': true, 'trocarSenha': false}
    ]));
    final usuarios = Usuarios(tmp.path); await usuarios.carregar();
    final auth = Auth(senha: 'teste', pastaDados: tmp.path, usuarios: usuarios);
    final modulo = Devocionais(store, urlBase: () => '', igreja: () => '', enviar: (e) async {});
    handler = auth.middleware((_) => false)(modulo.router.call);
    sessao = (await auth.login('senha-teste', 'lider', usuario: Perfil.liderCasais.id.toLowerCase()))!;
    expect((await chamar('GET', '/api/devocionais')).$1, 200);
    sessao = (await auth.login('senha-teste', 'secretaria', usuario: Perfil.secretaria.id.toLowerCase()))!;
    expect((await chamar('GET', '/api/devocionais')).$1, 403);
  });
  test('link de cancelamento da primeira mensagem segue válido após novo devocional', () async {
    await confirmar(await assinar('ana@exemplo.test'));
    final primeiro = await criar();
    await chamar('POST', '/api/devocionais/$primeiro/email', dados: selecao());
    final antigo = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    final segundo = await criar();
    await chamar('POST', '/api/devocionais/$segundo/email', dados: selecao());
    final recente = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    expect(recente, isNot(antigo));
    expect((await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': antigo})).$1, 200);
    expect(store.listar('assinaturasDevocionais').single['status'], 'cancelado');
    final terceiro = await criar();
    expect((await chamar('POST', '/api/devocionais/$terceiro/email', dados: selecao())).$2['enviados'], 0);
    final disco = await File('${tmp.path}/assinaturasDevocionais.json').readAsString();
    expect(disco, isNot(contains(antigo))); expect(disco, isNot(contains(recente)));
  });
  test('excluir o devocional apaga os recibos de envio daquele conteúdo', () async {
    await membro('ana', 'ana@exemplo.test');
    final id = await criar();
    await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']));
    expect(store.listar('enviosDevocionais'), hasLength(1));
    expect((await chamar('DELETE', '/api/devocionais/$id')).$1, 200);
    expect(store.listar('enviosDevocionais'), isEmpty, reason: 'não guardar e-mail de destinatário sem o conteúdo que o justificava');
  });
  test('links de cancelamento guardados ficam limitados sem perder o mais recente', () async {
    await confirmar(await assinar('ana@exemplo.test'));
    final a = store.listar('assinaturasDevocionais').single;
    await store.salvar('assinaturasDevocionais', {...a, 'cancelarHashes': [for (var i = 0; i < 40; i++) 'hash-antigo-$i']});
    final id = await criar();
    await chamar('POST', '/api/devocionais/$id/email', dados: selecao());
    final hashes = (store.listar('assinaturasDevocionais').single['cancelarHashes'] as List).cast<String>();
    expect(hashes.length, lessThanOrEqualTo(24), reason: 'o arquivo é regravado a cada envio; a lista não pode crescer para sempre');
    final novo = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    expect(hashes.last, sha256.convert(utf8.encode(novo)).toString());
    expect((await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': novo})).$1, 200);
  });
  test('cancelamento suprime avulso por membrosIds até nova confirmação', () async {
    await membro('ana', 'ana@exemplo.test');
    await confirmar(await assinar('ana@exemplo.test'));
    final primeiro = await criar();
    await chamar('POST', '/api/devocionais/$primeiro/email', dados: selecao());
    final cancelar = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': cancelar});
    final segundo = await criar();
    final previa = await chamar('POST', '/api/devocionais/$segundo/previa-email', dados: selecao(ids: ['ana']));
    expect(previa.$2['total'], 0);
    expect((await chamar('POST', '/api/devocionais/$segundo/email', dados: selecao(ids: ['ana']))).$2['enviados'], 0);
    agora = agora.add(const Duration(hours: 2));
    final pendente = await assinar('ana@exemplo.test');
    expect((await chamar('POST', '/api/devocionais/$segundo/email', dados: selecao(ids: ['ana']))).$2['enviados'], 0);
    await confirmar(pendente);
    expect((await chamar('POST', '/api/devocionais/$segundo/email', dados: selecao(ids: ['ana']))).$2['enviados'], 1);
  });

  group('trilhas', () {
    test('Casais e Família vêm prontas; a administração cria, renomeia, ordena e desativa', () async {
      final (_, publicas) = await chamar('GET', '/api/public/devocionais/trilhas', publico: true);
      expect([for (final t in publicas) t['id']], ['casais', 'familia']);
      final (st, jovens) = await chamar('POST', '/api/admin/devocionais/trilhas', dados: {'nome': 'Jovens', 'descricao': 'Para a juventude'});
      expect(st, 201, reason: '$jovens');
      expect(jovens['id'], 'jovens');
      expect((await chamar('POST', '/api/admin/devocionais/trilhas', dados: {'nome': ' JOVENS '})).$1, 400); // nome repetido
      expect((await chamar('POST', '/api/admin/devocionais/trilhas', dados: {'nome': ''})).$1, 400);
      final (_, mulheres) = await chamar('POST', '/api/admin/devocionais/trilhas', dados: {'nome': 'Mulheres'});
      expect((await chamar('PUT', '/api/admin/devocionais/trilhas/jovens', dados: {'nome': 'Juventude', 'ordem': -1})).$1, 200);
      var (_, lista) = await chamar('GET', '/api/public/devocionais/trilhas', publico: true);
      expect([for (final t in lista) t['nome']], ['Juventude', 'Casais', 'Família', 'Mulheres']);
      expect((await chamar('PUT', '/api/admin/devocionais/trilhas/${mulheres['id']}', dados: {'ativa': false})).$1, 200);
      (_, lista) = await chamar('GET', '/api/public/devocionais/trilhas', publico: true);
      expect([for (final t in lista) t['id']], isNot(contains('mulheres')));
      // Desativada: não entra em devocional novo nem em assinatura nova.
      expect((await chamar('POST', '/api/devocionais', dados: {...dados(), 'trilhas': ['mulheres']})).$1, 400);
      expect((await chamar('POST', '/api/public/devocionais/assinar', publico: true,
          dados: {'email': 'm@exemplo.test', 'temas': ['mulheres'], 'autorizo': true})).$1, 400);
      // A lista completa (com as desativadas) fica para o painel.
      final (_, painel) = await chamar('GET', '/api/devocionais/trilhas');
      expect(painel.firstWhere((t) => t['id'] == 'mulheres')['ativa'], false);
    });

    test('trilha em uso não é excluída (desative); sem uso, sai', () async {
      await criar();
      final (st, r) = await chamar('DELETE', '/api/admin/devocionais/trilhas/casais');
      expect(st, 400);
      expect(r['erro'], contains('Desative'));
      expect((await chamar('DELETE', '/api/admin/devocionais/trilhas/familia')).$1, 200);
      expect((await chamar('GET', '/api/public/devocionais/trilhas', publico: true)).$2, hasLength(1));
      // Depois de mexer, as padrão não voltam sozinhas.
      expect((await chamar('GET', '/api/public/devocionais/trilhas', publico: true)).$2, hasLength(1));
    });

    test('só a administração mexe nas trilhas', () async {
      final hash = gerarHashSenha('senha-teste');
      await File('${tmp.path}/usuarios.json').writeAsString(jsonEncode([
        {'id': 'l', 'nome': 'Líder', 'login': 'lider', 'perfil': Perfil.liderCasais.id,
          'senhaHash': hash.hash, 'senhaSal': hash.sal, 'ativo': true, 'trocarSenha': false}
      ]));
      final usuarios = Usuarios(tmp.path); await usuarios.carregar();
      final auth = Auth(senha: 'teste', pastaDados: tmp.path, usuarios: usuarios);
      handler = auth.middleware((r) => r.url.path.startsWith('api/public/'))(devocionais.router.call);
      sessao = (await auth.login('senha-teste', 'lider', usuario: 'lider'))!;
      expect((await chamar('GET', '/api/devocionais/trilhas')).$1, 200);
      expect((await chamar('POST', '/api/admin/devocionais/trilhas', dados: {'nome': 'Jovens'})).$1, 403);
    });

    test('devocional em várias trilhas chega uma vez a quem assina mais de uma; formato antigo continua', () async {
      await chamar('POST', '/api/admin/devocionais/trilhas', dados: {'nome': 'Jovens'});
      await confirmar(await assinar('ambos@exemplo.test', temas: ['casais', 'familia']));
      await confirmar(await assinar('jovem@exemplo.test', temas: ['jovens']));
      await confirmar(await assinar('outro@exemplo.test', temas: ['familia']));
      final (st, d) = await chamar('POST', '/api/devocionais',
          dados: {...dados('publicado')..remove('tema'), 'trilhas': ['casais', 'familia']});
      expect(st, 201, reason: '$d');
      emails.clear();
      final r = await chamar('POST', '/api/devocionais/${d['id']}/email', dados: selecao());
      expect(r.$2['enviados'], 2);
      expect(emails.map((e) => e.destinatario), unorderedEquals(['ambos@exemplo.test', 'outro@exemplo.test']));
      expect(emails.first.html, contains('Devocional · Casais e Família'));

      // Devocional gravado antes das trilhas ("tema": "familia") é lido e editado normalmente.
      await store.salvar('devocionais', {...dados('publicado'), 'id': 'antigo', 'tema': 'familia', 'criadoEm': '2026-11-01T10:00:00'});
      final (_, antigo) = await chamar('GET', '/api/devocionais/antigo');
      expect(antigo['trilhas'], ['familia']);
      expect((await chamar('PUT', '/api/devocionais/antigo', dados: {'titulo': 'Novo título'})).$1, 200);
      expect(store.buscar('devocionais', 'antigo')!['trilhas'], ['familia']);
      expect(store.buscar('devocionais', 'antigo')!.containsKey('tema'), isFalse);
    });

    test('resumo de assinantes só tem números, nunca e-mails', () async {
      await confirmar(await assinar('a@exemplo.test', temas: ['casais', 'familia']));
      await assinar('b@exemplo.test');
      final (_, r) = await chamar('GET', '/api/devocionais/assinantes');
      expect(r['ativos'], 1);
      expect(r['pendentes'], 1);
      expect(r['trilhas'].firstWhere((t) => t['id'] == 'familia')['ativos'], 1);
      expect(jsonEncode(r), isNot(contains('@')));
    });
  });

  group('agendamento', () {
    Map<String, dynamic> agendado(String quando, {bool enviar = true}) =>
        {...dados('agendado'), 'publicarEm': quando, 'enviarAoPublicar': enviar};

    test('agendado fica fora do ar até a hora; ao chegar, publica e envia aos assinantes', () async {
      await confirmar(await assinar('ana@exemplo.test'));
      // agora = 18/11/2026 12:00
      expect((await chamar('POST', '/api/devocionais', dados: agendado('2026-11-18T11:00'))).$1, 400, reason: 'passado');
      expect((await chamar('POST', '/api/devocionais', dados: {...dados('agendado')})).$1, 400, reason: 'sem horário');
      expect((await chamar('POST', '/api/devocionais', dados: agendado('2026-11-18T25:00'))).$1, 400);
      final (st, d) = await chamar('POST', '/api/devocionais', dados: agendado('2026-11-19T07:00'));
      expect(st, 201, reason: '$d');
      final id = d['id'] as String;
      expect(d['status'], 'agendado');
      expect((await chamar('GET', '/api/public/devocionais/$id', publico: true)).$1, 404);
      emails.clear();
      expect(await devocionais.processarAgendados(), 0);
      agora = DateTime.utc(2026, 11, 19, 7, 0);
      expect(await devocionais.processarAgendados(), 1);
      expect((await chamar('GET', '/api/public/devocionais/$id', publico: true)).$1, 200);
      expect(emails.single.destinatario, 'ana@exemplo.test');
      expect(emails.single.texto, contains('#cancelar='));
      final (_, painel) = await chamar('GET', '/api/devocionais/$id');
      expect(painel['status'], 'publicado');
      expect(painel['envioAutomatico']['enviados'], 1);
      expect(painel['historicoEnvios'].single, containsPair('tipo', 'automatico'));
      expect(painel['historicoEnvios'].single['enviados'], 1);
      expect((await chamar('GET', '/api/devocionais/$id/envios')).$2['enviados'], 1);
      // Rodar de novo não publica nem envia outra vez.
      expect(await devocionais.processarAgendados(), 0);
      expect(emails, hasLength(1));
    });

    test('agendado sem envio automático só publica; voltar a rascunho cancela o agendamento', () async {
      await confirmar(await assinar('ana@exemplo.test'));
      emails.clear();
      final (_, a) = await chamar('POST', '/api/devocionais', dados: agendado('2026-11-19T07:00', enviar: false));
      final (_, b) = await chamar('POST', '/api/devocionais', dados: agendado('2026-11-19T07:00'));
      await chamar('PUT', '/api/devocionais/${b['id']}', dados: {'status': 'rascunho'});
      expect(store.buscar('devocionais', b['id'] as String)!.containsKey('publicarEm'), isFalse);
      agora = DateTime.utc(2026, 11, 20);
      expect(await devocionais.processarAgendados(), 1);
      expect(store.buscar('devocionais', a['id'] as String)!['status'], 'publicado');
      expect(store.buscar('devocionais', b['id'] as String)!['status'], 'rascunho');
      expect(emails, isEmpty);
    });
  });

  group('página pública', () {
    test('lista os publicados até hoje, filtra por trilha e destaca o mais recente', () async {
      await chamar('POST', '/api/devocionais', dados: {...dados('publicado'), 'titulo': 'Velho', 'data': '2026-11-01'});
      await chamar('POST', '/api/devocionais', dados: {...dados('publicado'), 'titulo': 'Novo', 'data': '2026-11-17',
        'trilhas': ['familia']});
      await chamar('POST', '/api/devocionais', dados: {...dados('publicado'), 'titulo': 'Futuro', 'data': '2026-12-01'});
      await chamar('POST', '/api/devocionais', dados: {...dados('rascunho'), 'titulo': 'Rascunho', 'data': '2026-11-18'});
      final (_, r) = await chamar('GET', '/api/public/devocionais', publico: true);
      expect([for (final d in r['devocionais']) d['titulo']], ['Novo', 'Velho']);
      expect(r['destaque']['titulo'], 'Novo');
      expect(r['destaque']['resumo'], isNot(contains('<script>Reflexão</script>\n')));
      expect(devocionais.destaque()!['url'], startsWith('/devocional?id='));
      final (_, casais) = await chamar('GET', '/api/public/devocionais?trilha=casais', publico: true);
      expect([for (final d in casais['devocionais']) d['titulo']], ['Velho']);
      expect(jsonEncode(r), isNot(contains('status')));
    });

    test('série: a página do devocional lista as partes publicadas em ordem', () async {
      Future<String> parte(int n, {String status = 'publicado'}) async {
        final (_, d) = await chamar('POST', '/api/devocionais',
            dados: {...dados(status), 'titulo': 'Dia $n', 'serie': 'Frutos do Espírito', 'serieParte': n});
        return d['id'] as String;
      }
      final dois = await parte(2);
      await parte(1);
      await parte(3, status: 'rascunho');
      expect((await chamar('POST', '/api/devocionais', dados: {...dados(), 'serie': 'X', 'serieParte': 0})).$1, 400);
      final (_, d) = await chamar('GET', '/api/public/devocionais/$dois', publico: true);
      expect(d['serie'], 'Frutos do Espírito');
      expect([for (final p in d['serieItens']) p['titulo']], ['Dia 1', 'Dia 2']);
      final (_, filtro) = await chamar('GET', '/api/public/devocionais?serie=${Uri.encodeQueryComponent('Frutos do Espírito')}', publico: true);
      expect(filtro['devocionais'], hasLength(2));
    });
  });
}
