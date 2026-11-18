import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:diako_server/app.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/backup.dart';
import 'package:diako_server/cartazes.dart';
import 'package:diako_server/config.dart';
import 'package:diako_server/configuracoes.dart';
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
  test('perfil líder consulta casais e publica, sem acesso ao cadastro completo', () {
    final lider = Perfil.porNome('liderCasais');
    expect(lider, isNotNull);
    expect(lider!.permissoes.map((p) => p.name), containsAll(['casais', 'encontros', 'devocionais']));
    expect(lider.pode(Permissao.membros), isFalse);
    expect(lider.pode(Permissao.projetar), isFalse);
    expect(lider.pode(Permissao.admin), isFalse);
    expect(permissaoDaRota('GET', 'api/casais').name, 'casais');
    expect(permissaoDaRota('POST', 'api/devocionais').name, 'devocionais');
  });

  late Directory tmp;
  late Store store;
  late Handler handler;
  late String admin, lider;
  Future<(int, dynamic)> chamar(String metodo, String url, {String? token, Object? dados}) async {
    final r = await handler(Request(metodo, Uri.parse('http://x$url'), headers: {
      if (token != null) 'authorization': 'Bearer $token', 'content-type': 'application/json',
    }, body: dados == null ? null : jsonEncode(dados)));
    final texto = await r.readAsString();
    return (r.statusCode, texto.startsWith('{') || texto.startsWith('[') ? jsonDecode(texto) : texto);
  }
  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('diako_casais_area');
    final config = Config.lerJson('{"senhaAdmin":"senha-teste"}', pastaBase: tmp.path);
    store = Store(config.pastaDados);
    await store.carregar();
    final cfg = await Configuracoes.carregar(config, urlDetectada: 'http://igreja.test');
    final usuarios = Usuarios(config.pastaDados);
    final auth = Auth(conferirSenha: cfg.conferirSenha, pastaDados: config.pastaDados, usuarios: usuarios);
    await usuarios.criar(nome: 'Líder', login: 'lider', perfil: Perfil.porNome('liderCasais') ?? Perfil.semAcesso('liderCasais'), senha: 'senha-lider-123');
    handler = Servidor(store: store, auth: auth,
      holyrics: HolyricsDireto(host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{}', 200))),
      cartazes: Cartazes(config.pastaCartazes), backup: Backup(pastaDados: config.pastaDados),
      pastaWeb: '../server/web', urlOracao: cfg.urlOracao, cartazesNoHolyrics: false,
      historico: Historico(config.pastaDados), cfg: cfg, relogio: () => DateTime(2026, 11, 18),
    ).handler;
    admin = (await chamar('POST', '/api/login', dados: {'senha': 'senha-teste'})).$2['token'] as String;
    lider = (await chamar('POST', '/api/login', dados: {'usuario': 'lider', 'senha': 'senha-lider-123'})).$2['token'] as String;
    await store.salvarVarios('membros', [
      {'id': 'a', 'nome': 'Ana', 'status': 'membro', 'conjugeId': 'b', 'dataCasamento': '2016-11-18',
        'telefone': '11999990001', 'email': 'ana@teste.com', 'consentimentoEm': '2026-01-01',
        'cpf': 'privado', 'observacoes': 'segredo', 'rua': 'privada', 'consentimentoRegistro': {'segredo': true}},
      {'id': 'b', 'nome': 'Bruno', 'status': 'membro', 'conjugeId': 'a', 'dataCasamento': '2016-11-18'},
      {'id': 'c', 'nome': 'Carla', 'status': 'congregado', 'conjugeNome': 'Davi', 'dataCasamento': '2020-11-02'},
      {'id': 'd', 'nome': 'Dora', 'status': 'membro', 'conjugeNome': 'Eduardo', 'dataCasamento': '2020-02-29'},
      {'id': 'e', 'nome': 'Ex', 'status': 'membro', 'estadoCivil': 'Divorciado(a)', 'conjugeNome': 'Outro', 'dataCasamento': '2010-11-18'},
      {'id': 'f', 'nome': 'Visitante', 'status': 'visitante', 'conjugeNome': 'Outro', 'dataCasamento': '2010-11-18'},
    ]);
  });
  tearDown(() async { await store.fechar(); await tmp.delete(recursive: true); });

  test('consulta mês completo, ordenada e sem duplicar, inclusive sem autorização pública', () async {
    final (st, j) = await chamar('GET', '/api/casais?mes=11&ano=2026', token: lider);
    expect(st, 200, reason: '$j');
    final lista = j['casais'] as List;
    expect(lista.map((x) => x['nome']), ['Carla', 'Ana']);
    expect(lista.last['anos'], 10);
    expect(lista.last['divulgacaoAutorizada'], false);
    expect(lista.last['contatos'].first['email'], 'ana@teste.com');
    for (final proibido in ['cpf', 'observacoes', 'rua', 'consentimentoRegistro', 'segredo']) {
      expect(jsonEncode(j), isNot(contains(proibido)));
    }
    expect((await chamar('GET', '/api/membros', token: lider)).$1, 403);
    expect((await chamar('PUT', '/api/membros/a', token: lider, dados: {'nome': 'Alterado'})).$1, 403);
    expect((await chamar('GET', '/api/casais')).$1, 401);
    expect((await chamar('GET', '/api/public/casais')).$1, 404);
  });
  test('normaliza 29 de fevereiro e valida mês e ano estritamente', () async {
    final (_, j) = await chamar('GET', '/api/casais?mes=2&ano=2025', token: lider);
    expect(j['casais'].single['dataAniversario'], '2025-02-28');
    expect(j['casais'].single['anos'], 5);
    for (final query in ['mes=0', 'mes=13', 'mes=abc', 'ano=abc', 'ano=1899', 'ano=2201']) {
      expect((await chamar('GET', '/api/casais?$query', token: admin)).$1, 400);
    }
  });
  test('consulta padrão usa mês do relógio e não altera membros', () async {
    final antes = jsonEncode(store.listar('membros'));
    final (_, j) = await chamar('GET', '/api/casais', token: lider);
    expect(j['mes'], 11);
    expect(j['ano'], 2026);
    expect(jsonEncode(store.listar('membros')), antes);
  });
  test('líder publica conteúdo público sem aprovação, sem enviar e sem expor cadastro', () async {
    final (criou, doc) = await chamar('POST', '/api/devocionais', token: lider, dados: {
      'titulo': 'Caminhando juntos', 'tema': 'casais', 'data': '2026-11-18',
      'autorNome': 'Ministério de Casais', 'referencia': 'Eclesiastes 4:9',
      'texto': 'Melhor é serem dois do que um.', 'aplicacao': 'Conversem hoje.',
      'oracao': 'Senhor, guia nossa família.', 'status': 'rascunho',
    });
    expect(criou, 201, reason: '$doc');
    final id = doc['id'];
    expect((await chamar('GET', '/api/public/devocionais/$id')).$1, 404);
    expect((await chamar('GET', '/api/devocionais')).$1, 401);
    expect((await chamar('PUT', '/api/devocionais/$id', token: lider, dados: {'status': 'publicado'})).$1, 200);
    final (st, publico) = await chamar('GET', '/api/public/devocionais/$id');
    expect(st, 200);
    expect(publico['titulo'], 'Caminhando juntos');
    for (final proibido in ['autorId', 'criadoPor', 'consentimento', 'email', 'membrosIds']) {
      expect(jsonEncode(publico), isNot(contains(proibido)));
    }
    expect(store.listar('enviosDevocionais'), isEmpty, reason: 'Publicar não dispara e-mail.');
    final recarregado = Store(store.pasta);
    await recarregado.carregar();
    expect(recarregado.buscar('devocionais', id as String)?['titulo'], 'Caminhando juntos');
    await recarregado.fechar();
    final zip = ZipDecoder().decodeBytes(await Backup(pastaDados: store.pasta).gerarZip());
    expect(zip.findFile('data/devocionais.json'), isNotNull);
    expect((await chamar('PUT', '/api/devocionais/$id', token: lider, dados: {'status': 'rascunho'})).$1, 200);
    expect((await chamar('GET', '/api/public/devocionais/$id')).$1, 404);
  });
  test('destinatários do líder usam membros elegíveis com dados mínimos', () async {
    final (st, lista) = await chamar('GET', '/api/devocionais/destinatarios', token: lider);
    expect(st, 200);
    expect((lista as List).single, {'id': 'a', 'nome': 'Ana', 'email': 'ana@teste.com'});
    expect((await chamar('GET', '/api/public/devocionais/destinatarios')).$1, 404);
  });
}
