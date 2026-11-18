import 'dart:convert';
import 'dart:io';

import 'package:diako_server/app.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/backup.dart';
import 'package:diako_server/cartazes.dart';
import 'package:diako_server/config.dart';
import 'package:diako_server/configuracoes.dart';
import 'package:diako_server/email_casais.dart';
import 'package:diako_server/historico.dart';
import 'package:diako_server/holyrics.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:diako_server/usuarios.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

void main() {
  test('Store registra todas as coleções do ministério sem duplicar pessoas', () {
    expect(Store.colecoes, containsAll(['casaisContatos', 'casaisEnvios', 'casaisEncontros',
      'casaisInscricoes', 'casaisTarefas', 'casaisMateriais']));
    expect(Store.colecoes, isNot(contains('casaisPessoas')));
  });

  late Directory pasta;
  late Store store;
  late Handler handler;
  late String lider, consulta, admin;
  late List<EmailCasais> enviados;
  Future<(int, dynamic)> chamar(String metodo, String rota, {String? token, Object? corpo}) async {
    final r = await handler(Request(metodo, Uri.parse('http://teste$rota'), headers: {
      if (token != null) 'authorization': 'Bearer $token', 'content-type': 'application/json',
    }, body: corpo == null ? null : jsonEncode(corpo)));
    final texto = await r.readAsString();
    return (r.statusCode, texto.startsWith('{') || texto.startsWith('[') ? jsonDecode(texto) : texto);
  }
  setUp(() async {
    enviados = [];
    pasta = await Directory.systemTemp.createTemp('diako_casais_integracao_');
    final cfgInicial = Config.lerJson('{"senhaAdmin":"admin-teste-123"}', pastaBase: pasta.path);
    final cfg = await Configuracoes.carregar(cfgInicial, urlDetectada: 'http://teste');
    store = Store(cfgInicial.pastaDados);
    await store.carregar();
    final usuarios = Usuarios(store.pasta);
    await usuarios.criar(nome: 'Líder', login: 'lider', perfil: Perfil.liderCasais, senha: 'lider-teste-123');
    await usuarios.criar(nome: 'Consulta', login: 'consulta', perfil: Perfil.secretaria, senha: 'consulta-teste-123');
    final auth = Auth(conferirSenha: cfg.conferirSenha, pastaDados: store.pasta, usuarios: usuarios);
    handler = Servidor(store: store, auth: auth,
      holyrics: HolyricsDireto(host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{}', 200))),
      cartazes: Cartazes(cfgInicial.pastaCartazes), backup: Backup(pastaDados: store.pasta),
      pastaWeb: 'web', urlOracao: cfg.urlOracao, cartazesNoHolyrics: false,
      historico: Historico(store.pasta), cfg: cfg, relogio: () => DateTime(2026, 11, 18, 12),
      enviarEmailCasal: (email) async => enviados.add(email)).handler;
    admin = (await chamar('POST', '/api/login', corpo: {'senha': 'admin-teste-123'})).$2['token'] as String;
    lider = (await chamar('POST', '/api/login', corpo: {'usuario': 'lider', 'senha': 'lider-teste-123'})).$2['token'] as String;
    consulta = (await chamar('POST', '/api/login', corpo: {'usuario': 'consulta', 'senha': 'consulta-teste-123'})).$2['token'] as String;
    await store.salvarVarios('membros', [
      {'id': 'a', 'nome': 'Ana', 'status': 'membro', 'conjugeId': 'b', 'dataCasamento': '2016-11-18',
        'cpf': 'segredo', 'rua': 'restrita', 'email': 'ana@example.test', 'consentimentoEm': '2026-01-01'},
      {'id': 'b', 'nome': 'Bruno', 'status': 'membro', 'conjugeId': 'a', 'dataCasamento': '2016-11-18'},
    ]);
  });
  tearDown(() async { await store.fechar(); await pasta.delete(recursive: true); });

  test('contatos integrados exigem gestão, sem endpoints públicos', () async {
    final corpo = {'membrosIds': ['a', 'b'], 'dataCasamento': '2016-11-18', 'tipo': 'parabenizado',
      'ocorrencia': '2026-11-18', 'realizadoEm': '2026-11-18'};
    expect((await chamar('POST', '/api/casais/contatos', token: consulta, corpo: corpo)).$1, 403);
    final criado = await chamar('POST', '/api/casais/contatos', token: lider, corpo: corpo);
    expect(criado.$1, 201, reason: '${criado.$2}');
    final lista = await chamar('GET', '/api/casais/contatos?mes=11&ano=2026', token: consulta);
    expect(lista.$1, 200);
    expect(lista.$2, hasLength(1));
    expect((await chamar('GET', '/api/casais/contatos')).$1, 401);
    expect((await chamar('GET', '/api/public/casais/contatos')).$1, 404);
    expect((await chamar('POST', '/api/casais/contatos/${criado.$2['id']}/anular', token: lider)).$1, 200);
    expect((await chamar('POST', '/api/casais/parabens/previa', token: consulta, corpo: {})).$1, 403);
  });

  test('seletores limitados não vazam ficha nem login', () async {
    final lista = await chamar('GET', '/api/casais/pessoas?busca=ana', token: lider);
    expect(lista.$1, 200);
    expect((lista.$2 as List).single['nome'], 'Ana');
    for (final campo in ['cpf', 'rua', 'email', 'consentimentoEm', 'segredo']) {
      expect(jsonEncode(lista.$2), isNot(contains(campo)));
    }
    expect((await chamar('GET', '/api/casais/pessoas?busca=a', token: lider)).$1, 400);
    expect((await chamar('GET', '/api/membros', token: lider)).$1, 403);
    final responsaveis = await chamar('GET', '/api/casais/responsaveis', token: lider);
    expect(responsaveis.$1, 200);
    expect(jsonEncode(responsaveis.$2), isNot(contains('login')));
    expect(jsonEncode(responsaveis.$2), isNot(contains('senha')));
    expect((await chamar('GET', '/api/casais/responsaveis', token: consulta)).$1, 403);
  });

  test('excluir membro remove histórico identificável de contatos', () async {
    await store.salvar('casaisContatos', {'id': 'c', 'membrosIds': ['a', 'b'], 'casalChave': 'historica',
      'tipo': 'parabenizado', 'ocorrencia': '2026-11-18', 'realizadoEm': '2026-11-18',
      'registradoEm': '2026-11-18T12:00:00', 'usuarioId': 'l', 'usuarioNome': 'Líder'});
    expect((await chamar('DELETE', '/api/membros/a', token: admin)).$1, 200);
    expect(store.listar('casaisContatos'), isEmpty);
  });

  test('rotas de encontros e materiais preservam consulta e negam escrita à secretaria', () async {
    for (final recurso in ['encontros', 'materiais']) {
      final leitura = await chamar('GET', '/api/casais/$recurso', token: consulta);
      expect(leitura.$1, 200, reason: recurso);
      expect(leitura.$2, isList);
      expect((await chamar('POST', '/api/casais/$recurso', token: consulta, corpo: {})).$1, 403);
      expect((await chamar('GET', '/api/public/casais/$recurso')).$1, 404);
    }
  });

  test('prévia e SMTP falso não marcam contato, revalidam e não duplicam entrega', () async {
    final corpo = {'membrosIds': ['a', 'b'], 'dataCasamento': '2016-11-18',
      'ocorrencia': '2026-11-18', 'destinatarioMembroId': 'a', 'texto': 'Parabéns pela união!'};
    final previa = await chamar('POST', '/api/casais/parabens/previa', token: lider, corpo: corpo);
    expect(previa.$1, 200, reason: '${previa.$2}');
    expect(enviados, isEmpty);
    expect(store.listar('casaisContatos'), isEmpty);
    final pedido = {...corpo, 'previaId': previa.$2['previaId'], 'confirmar': true};
    final resposta = await chamar('POST', '/api/casais/parabens/email', token: lider, corpo: pedido);
    expect(resposta.$1, 200, reason: '${resposta.$2}');
    expect(resposta.$2['estado'], 'aceito_smtp');
    expect(enviados, hasLength(1));
    expect(store.listar('casaisContatos'), isEmpty);
    expect((await chamar('POST', '/api/casais/parabens/email', token: lider, corpo: pedido)).$1, isNot(200));
    expect(enviados, hasLength(1));
    final outra = await chamar('POST', '/api/casais/parabens/previa', token: lider, corpo: corpo);
    final membro = {...store.buscar('membros', 'a')!}..remove('consentimentoEm');
    await store.salvar('membros', membro);
    final revogado = await chamar('POST', '/api/casais/parabens/email', token: lider,
      corpo: {...corpo, 'previaId': outra.$2['previaId'], 'confirmar': true});
    expect(revogado.$1, 400);
    expect(enviados, hasLength(1));
  });

  test('fluxo integrado encontro, inscrição, presença, tarefa e roteiro versionado', () async {
    final e = await chamar('POST', '/api/casais/encontros', token: lider, corpo: {
      'titulo': 'Encontro de teste', 'tipo': 'jantar', 'inicio': '2026-11-20T19:00',
      'fim': '2026-11-20T21:00', 'estado': 'aberto', 'capacidade': 2,
    });
    expect(e.$1, 201, reason: '${e.$2}');
    final id = e.$2['id'];
    final i = await chamar('POST', '/api/casais/encontros/$id/inscricoes', token: lider, corpo: {
      'responsavelMembroId': 'a', 'participantes': [
        {'membroId': 'a', 'confirmado': true}, {'membroId': 'b', 'confirmado': false},
      ],
    });
    expect(i.$1, 201, reason: '${i.$2}');
    expect((await chamar('GET', '/api/casais/encontros/$id', token: consulta)).$2['vagasDisponiveis'], 0);
    final caminho = '/api/casais/inscricoes/${i.$2['id']}/participantes/${i.$2['participantes'][0]['id']}/presenca';
    expect((await chamar('PUT', caminho, token: lider, corpo: {'presente': true})).$1, 200);
    final lista = await chamar('GET', '/api/casais/encontros/$id/inscricoes', token: consulta);
    expect(lista.$2.first['participantes'][0]['presencaPorNome'], 'Líder');
    expect(lista.$2.first['participantes'][1]['presenteEm'], isNull);
    final tarefa = await chamar('POST', '/api/casais/encontros/$id/tarefas', token: lider,
      corpo: {'descricao': 'Recepção', 'responsavelUsuarioId': 'admin', 'prazo': '2026-11-17'});
    expect(tarefa.$1, 201, reason: '${tarefa.$2}');
    expect((await chamar('GET', '/api/casais/encontros/$id/tarefas', token: consulta)).$2.single['responsavelNome'], 'Administrador');
    final material = await chamar('POST', '/api/casais/materiais', token: lider, corpo: {
      'titulo': 'Escuta', 'publico': 'ambos', 'duracaoMinutos': 20, 'passos': 'Conversar com gratidão.',
    });
    expect(material.$1, 201, reason: '${material.$2}');
    expect((await chamar('PUT', '/api/casais/encontros/$id/roteiro', token: lider,
      corpo: {'materiaisIds': [material.$2['id']]})).$1, 200);
    expect((await chamar('PUT', '/api/casais/materiais/${material.$2['id']}', token: lider,
      corpo: {'titulo': 'Escuta revisada'})).$1, 200);
    final detalhe = await chamar('GET', '/api/casais/encontros/$id', token: consulta);
    expect(detalhe.$2['roteiro'].single['conteudoSnapshot']['titulo'], 'Escuta');
    expect((await chamar('POST', '/api/casais/encontros/$id/cancelar', token: lider)).$1, 200);
    expect((await chamar('PUT', caminho, token: lider, corpo: {'presente': false})).$1, 400);
  });

  test('exclusão mantém outros membros inscritos e remove acompanhantes do responsável excluído', () async {
    await store.salvarVarios('casaisInscricoes', [
      {'id': 'i', 'encontroId': 'e', 'responsavelMembroId': 'a', 'estado': 'confirmada', 'participantes': [
        {'id': 'pa', 'membroId': 'a'}, {'id': 'pb', 'membroId': 'b'},
        {'id': 'pc', 'nomeAcompanhante': 'Convidado contextual'},
      ]},
      {'id': 'j', 'encontroId': 'f', 'responsavelMembroId': 'b', 'estado': 'confirmada', 'participantes': [
        {'id': 'pd', 'membroId': 'a'}, {'id': 'pe', 'membroId': 'b'},
        {'id': 'pf', 'nomeAcompanhante': 'Convidado de Bruno'},
      ]},
    ]);
    await store.salvar('casaisEnvios', {'id': 'envio', 'membrosIds': ['a', 'b'], 'destinatarioMembroId': 'a'});
    expect((await chamar('DELETE', '/api/membros/a', token: admin)).$1, 200);
    expect(store.listar('casaisEnvios'), isEmpty);
    final i = store.buscar('casaisInscricoes', 'i')!;
    expect(i['responsavelMembroId'], 'b');
    expect((i['participantes'] as List).single['membroId'], 'b');
    final j = store.buscar('casaisInscricoes', 'j')!;
    expect(j['participantes'], hasLength(2));
    expect(jsonEncode(j), contains('Convidado de Bruno'));
  });

  test('excluir último participante remove inscrição vazia cujo responsável não participava', () async {
    await store.salvar('casaisInscricoes', {'id': 'i', 'encontroId': 'e',
      'responsavelMembroId': 'b', 'estado': 'confirmada',
      'participantes': [{'id': 'p', 'membroId': 'a', 'crianca': false, 'confirmado': true}]});
    expect((await chamar('DELETE', '/api/membros/a', token: admin)).$1, 200);
    expect(store.listar('casaisInscricoes'), isEmpty);
  });
}
