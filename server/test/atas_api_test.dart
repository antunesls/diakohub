import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:diako_server/app.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/backup.dart';
import 'package:diako_server/cartazes.dart';
import 'package:diako_server/config.dart';
import 'package:diako_server/configuracoes.dart';
import 'package:diako_server/email_mensagens.dart';
import 'package:diako_server/historico.dart';
import 'package:diako_server/holyrics.dart';
import 'package:diako_server/ministerios.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:diako_server/usuarios.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart' as img;
import 'package:path/path.dart' as p;
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

void main() {
  late Directory tmp;
  late Store store;
  late Handler handler;
  late String admin;
  late String secretaria;
  late String midia;
  late String bruno;
  late String pastor;
  late List<EmailAta> enviados;

  Future<(int, dynamic)> chamar(String metodo, String caminho, {String? token, Object? json, List<int>? bytes}) async {
    final r = await handler(Request(metodo, Uri.parse('http://x$caminho'),
      headers: {if (token != null) 'authorization': 'Bearer $token', if (json != null) 'content-type': 'application/json'},
      body: bytes ?? (json == null ? null : jsonEncode(json))));
    final dados = await r.read().expand((b) => b).toList();
    final texto = utf8.decode(dados, allowMalformed: true);
    return (r.statusCode, texto.startsWith('{') || texto.startsWith('[') ? jsonDecode(texto) : dados);
  }

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('diako_atas_api');
    final config = Config.lerJson('{"senhaAdmin":"senha-teste"}', pastaBase: tmp.path);
    store = Store(config.pastaDados);
    await store.carregar();
    await store.salvarVarios('membros', [
      {'id': 'm1', 'nome': 'Ana Souza', 'status': 'membro', 'email': 'ana@exemplo.org', 'ministerios': ['Conselho', 'louvor']},
      {'id': 'm2', 'nome': 'Bruno Lima', 'status': 'membro', 'ministerios': ['Infantil']},
      {'id': 'm3', 'nome': 'Carla Visitante', 'status': 'visitante', 'email': 'carla@exemplo.org'},
    ]);
    final cfg = await Configuracoes.carregar(config, urlDetectada: 'http://192.168.0.10:8080');
    final usuarios = Usuarios(config.pastaDados);
    final auth = Auth(conferirSenha: cfg.conferirSenha, pastaDados: config.pastaDados, usuarios: usuarios);
    // A secretária é a Ana (Conselho e Louvor); o pastor vê todos os ministérios sem participar.
    await Ministerios(store).garantirPadroes();
    await Ministerios(store).criar({'nome': 'Louvor'});
    await Ministerios(store).criar({'nome': 'Infantil'});
    await usuarios.criar(nome: 'Secretária', login: 'secretaria', perfil: Perfil.secretaria, senha: 'senha-forte-123', membroId: 'm1');
    await usuarios.criar(nome: 'Bruno', login: 'bruno', perfil: Perfil.secretaria, senha: 'senha-forte-123', membroId: 'm2');
    await usuarios.criar(nome: 'Pastor', login: 'pastor', perfil: Perfil.pastor, senha: 'senha-forte-123');
    await usuarios.criar(nome: 'Mídia', login: 'midia', perfil: Perfil.midia, senha: 'senha-forte-123');
    final web = Directory(p.join(tmp.path, 'web'))..createSync();
    File(p.join(web.path, 'ajuda-atas.html')).writeAsStringSync('<h1>Atas</h1>');
    enviados = [];
    handler = Servidor(store: store, auth: auth,
      holyrics: HolyricsDireto(host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{}', 200))),
      cartazes: Cartazes(config.pastaCartazes), backup: Backup(pastaDados: config.pastaDados),
      pastaWeb: web.path, urlOracao: cfg.urlOracao, cartazesNoHolyrics: false,
      historico: Historico(config.pastaDados), cfg: cfg,
      enviarAta: (e) async => enviados.add(e),
      restauracao: Restauracao(store: store, backup: Backup(pastaDados: config.pastaDados),
        pastaDados: config.pastaDados, pastaCartazes: config.pastaCartazes)).handler;
    admin = (await chamar('POST', '/api/login', json: {'senha': 'senha-teste'})).$2['token'] as String;
    secretaria = (await chamar('POST', '/api/login', json: {'usuario': 'secretaria', 'senha': 'senha-forte-123'})).$2['token'] as String;
    midia = (await chamar('POST', '/api/login', json: {'usuario': 'midia', 'senha': 'senha-forte-123'})).$2['token'] as String;
    bruno = (await chamar('POST', '/api/login', json: {'usuario': 'bruno', 'senha': 'senha-forte-123'})).$2['token'] as String;
    pastor = (await chamar('POST', '/api/login', json: {'usuario': 'pastor', 'senha': 'senha-forte-123'})).$2['token'] as String;
  });
  tearDown(() async { await store.fechar(); await tmp.delete(recursive: true); });

  Map<String, dynamic> conselho({bool sigilosa = false}) => {
        'tipo': 'conselho', 'data': '2026-11-10', 'presidente': 'Pr. Paulo', 'secretario': 'Ana Souza',
        'presentes': [{'membroId': 'm1', 'nome': 'Ana Souza'}, {'membroId': 'm2', 'nome': 'Bruno Lima'}],
        'pauta': [{'titulo': 'Orçamento 2027', 'deliberacao': 'Aprovado.'}],
        'encaminhamentos': [{'descricao': 'Publicar orçamento', 'responsavel': 'Ana Souza', 'prazo': '2026-11-30'}],
        'sigilosa': sigilosa,
      };

  test('permissões: mídia não acessa; secretaria não vê sigilosas', () async {
    expect(permissaoDaRota('GET', 'api/atas'), Permissao.atas);
    expect((await chamar('GET', '/api/atas')).$1, 401);
    expect((await chamar('GET', '/api/atas', token: midia)).$1, 403);
    final (st, sigilosa) = await chamar('POST', '/api/atas', token: admin, json: conselho(sigilosa: true));
    expect(st, 201, reason: '$sigilosa');
    expect((await chamar('POST', '/api/atas', token: secretaria, json: conselho(sigilosa: true))).$1, 400);
    expect((await chamar('POST', '/api/atas', token: secretaria, json: conselho())).$1, 201);
    expect((await chamar('GET', '/api/atas', token: secretaria)).$2, hasLength(1));
    expect((await chamar('GET', '/api/atas', token: admin)).$2, hasLength(2));
    final id = sigilosa['id'];
    expect((await chamar('GET', '/api/atas/$id', token: secretaria)).$1, 404);
    expect((await chamar('GET', '/api/atas/$id/pdf', token: secretaria)).$1, 404);
    expect((await chamar('PUT', '/api/atas/$id', token: secretaria, json: {'local': 'x'})).$1, 404);
    // Lista de pessoas: só ativos, sem o endereço de e-mail.
    final pessoas = (await chamar('GET', '/api/atas/pessoas', token: secretaria)).$2 as List;
    expect(pessoas.map((e) => e['nome']), ['Ana Souza', 'Bruno Lima']);
    expect(pessoas.first.containsKey('email'), isFalse);
    expect(pessoas.first['temEmail'], isTrue);
    expect((await chamar('GET', '/ajuda/atas')).$1, 200);
  });

  test('cada ministério só vê as próprias atas; o pastor vê todas; Conselho também é ministério', () async {
    final (_, lista) = await chamar('GET', '/api/ministerios', token: secretaria);
    final ids = {for (final m in lista['ministerios'] as List) m['nome']: m['id']};
    expect(ids.keys, containsAll(['Conselho', 'Diretoria', 'Assembleia', 'Louvor', 'Infantil']));
    expect((lista['ministerios'] as List).firstWhere((m) => m['nome'] == 'Louvor')['meu'], isTrue,
        reason: 'o nome no cadastro do membro vale sem acento nem caixa');

    Map<String, dynamic> reuniao(String ministerio) =>
        {'tipo': 'ministerio', 'ministerioId': ids[ministerio], 'titulo': 'Planejamento $ministerio', 'data': '2026-11-10'};
    final (stL, louvor) = await chamar('POST', '/api/atas', token: secretaria, json: reuniao('Louvor'));
    expect(stL, 201, reason: '$louvor');
    expect(louvor['ministerio'], 'Louvor');
    final (stI, infantil) = await chamar('POST', '/api/atas', token: bruno, json: reuniao('Infantil'));
    expect(stI, 201, reason: '$infantil');
    // Ninguém registra ata de ministério de que não participa.
    expect((await chamar('POST', '/api/atas', token: bruno, json: reuniao('Louvor'))).$1, 400);
    expect((await chamar('POST', '/api/atas', token: bruno, json: conselho())).$1, 400);
    final (_, doConselho) = await chamar('POST', '/api/atas', token: secretaria, json: conselho());

    List<String> titulos(dynamic l) => [for (final a in l as List) '${a['ministerio']}'];
    expect(titulos((await chamar('GET', '/api/atas', token: secretaria)).$2), unorderedEquals(['Louvor', 'Conselho']));
    expect(titulos((await chamar('GET', '/api/atas', token: bruno)).$2), ['Infantil']);
    expect(titulos((await chamar('GET', '/api/atas', token: pastor)).$2), unorderedEquals(['Louvor', 'Infantil', 'Conselho']));
    // Quem é do Louvor não abre, não edita, não baixa nem finaliza a ata do Infantil.
    for (final (metodo, caminho) in [('GET', ''), ('GET', '/pdf'), ('PUT', ''), ('POST', '/finalizar')]) {
      final corpo = metodo == 'GET' ? null : {'local': 'x'};
      expect((await chamar(metodo, '/api/atas/${infantil['id']}$caminho', token: secretaria, json: corpo)).$1, 404,
          reason: '$metodo $caminho');
    }
    expect((await chamar('GET', '/api/atas/${doConselho['id']}', token: bruno)).$1, 404);

    // Tirar a pessoa do ministério tira o acesso na hora; renomear leva o nome para as atas e as pessoas.
    final louvorId = ids['Louvor'];
    expect((await chamar('POST', '/api/ministerios/$louvorId/pessoas/remover', token: secretaria, json: {'membros': ['m1']})).$1, 200);
    expect(titulos((await chamar('GET', '/api/atas', token: secretaria)).$2), ['Conselho']);
    final (_, pessoas) = await chamar('POST', '/api/ministerios/$louvorId/pessoas', token: secretaria, json: {'membros': ['m1', 'm2']});
    expect([for (final p in pessoas as List) p['nome']], ['Ana Souza', 'Bruno Lima']);
    await chamar('PUT', '/api/ministerios/$louvorId', token: secretaria, json: {'nome': 'Louvor e Adoração'});
    expect(titulos((await chamar('GET', '/api/atas', token: bruno)).$2), unorderedEquals(['Infantil', 'Louvor e Adoração']));
    expect(store.buscar('membros', 'm2')!['ministerios'] as List, contains('Louvor e Adoração'));

    // Exclusão: fixos e ministérios com ata ficam; o cadastro é só de quem tem a permissão.
    expect((await chamar('DELETE', '/api/ministerios/conselho', token: secretaria)).$1, 400);
    expect((await chamar('DELETE', '/api/ministerios/${ids['Infantil']}', token: secretaria)).$1, 400);
    expect((await chamar('GET', '/api/ministerios', token: midia)).$1, 200, reason: 'a lista de nomes é para todos');
    expect((await chamar('POST', '/api/ministerios', token: midia, json: {'nome': 'Jovens'})).$1, 403);
    expect((await chamar('POST', '/api/ministerios', token: secretaria, json: {'nome': 'Jovens'})).$1, 201);
    expect((await chamar('POST', '/api/ministerios', token: secretaria, json: {'nome': 'jovens'})).$1, 400, reason: 'nome repetido');
  });

  test('fluxo completo: finaliza, gera PDF, envia, aprova e trava', () async {
    final ata = (await chamar('POST', '/api/atas', token: secretaria, json: conselho())).$2;
    final id = ata['id'];
    expect((await chamar('POST', '/api/atas/$id/email', token: secretaria, json: {'incluirPresentes': true})).$1, 409);
    final finalizada = (await chamar('POST', '/api/atas/$id/finalizar', token: secretaria)).$2;
    expect(finalizada['numero'], 1);
    final (stPdf, pdf) = await chamar('GET', '/api/atas/$id/pdf', token: secretaria);
    expect(stPdf, 200);
    expect(String.fromCharCodes((pdf as List<int>).take(5)), '%PDF-');
    expect((await chamar('POST', '/api/atas/$id/email', token: secretaria,
      json: {'outros': ['nao-e-email']})).$1, 400);
    final (stMail, envio) = await chamar('POST', '/api/atas/$id/email', token: secretaria,
      json: {'incluirPresentes': true, 'outros': ['Pastor@Exemplo.org'], 'mensagem': 'Para conferência.'});
    expect(stMail, 200, reason: '$envio');
    expect(enviados.single.destinatarios, unorderedEquals(['ana@exemplo.org', 'pastor@exemplo.org']));
    expect(enviados.single.titulo, 'Ata nº 1/2026 — Conselho');
    expect(enviados.single.pdf.take(4), '%PDF'.codeUnits);
    final pendentes = (await chamar('GET', '/api/atas/encaminhamentos', token: secretaria)).$2 as List;
    expect(pendentes.single['ataId'], id);
    expect((await chamar('POST', '/api/atas/$id/aprovar', token: secretaria, json: {'data': '2026-11-17'})).$1, 200);
    expect((await chamar('PUT', '/api/atas/$id', token: secretaria, json: {'local': 'x'})).$1, 409);
    expect((await chamar('DELETE', '/api/atas/$id', token: secretaria)).$1, 409);
    expect((await chamar('POST', '/api/atas/$id/retificar', token: secretaria, json: {'texto': 'Correção.'})).$1, 200);
    final eid = pendentes.single['id'];
    expect((await chamar('PUT', '/api/atas/$id/encaminhamentos/$eid', token: secretaria, json: {'concluido': true})).$1, 200);
    expect((await chamar('GET', '/api/atas/encaminhamentos', token: secretaria)).$2, isEmpty);
  });

  test('sigilosa só é enviada com confirmação', () async {
    final id = (await chamar('POST', '/api/atas', token: admin, json: conselho(sigilosa: true))).$2['id'];
    await chamar('POST', '/api/atas/$id/finalizar', token: admin);
    expect((await chamar('POST', '/api/atas/$id/email', token: admin, json: {'incluirPresentes': true})).$1, 409);
    expect((await chamar('POST', '/api/atas/$id/email', token: admin,
      json: {'incluirPresentes': true, 'confirmarSigilo': true})).$1, 200);
  });

  test('anexo privado, protegido pelo sigilo e incluído no backup', () async {
    final id = (await chamar('POST', '/api/atas', token: admin, json: conselho(sigilosa: true))).$2['id'];
    final foto = img.encodeJpg(img.Image(width: 40, height: 40));
    final (st, salvo) = await chamar('POST', '/api/atas/$id/anexos', token: admin, bytes: foto);
    expect(st, 201, reason: '$salvo');
    final nome = salvo['nome'];
    expect((await chamar('GET', '/api/atas/anexos/$nome')).$1, 401);
    expect((await chamar('GET', '/api/atas/anexos/$nome', token: secretaria)).$1, 404);
    expect((await chamar('GET', '/api/atas/anexos/$nome', token: admin)).$1, 200);
    final zipBytes = (await chamar('GET', '/api/backups/agora/download', token: admin)).$2 as List<int>;
    final zip = ZipDecoder().decodeBytes(zipBytes);
    expect(zip.findFile('anexos-atas/$nome'), isNotNull);
    expect(zip.findFile('data/atas.json'), isNotNull);
    expect((await chamar('DELETE', '/api/atas/$id/anexos/$nome', token: admin)).$1, 200);
    expect((await chamar('GET', '/api/atas/anexos/$nome', token: admin)).$1, 404);
    expect((await chamar('POST', '/api/backups/restaurar', token: admin, bytes: zipBytes)).$1, 200);
    expect((await chamar('GET', '/api/atas/anexos/$nome', token: admin)).$1, 200);
    // Rascunho excluído leva os anexos junto.
    expect((await chamar('DELETE', '/api/atas/$id', token: admin)).$1, 200);
    expect(File(p.join(tmp.path, 'data', 'anexos-atas', nome)).existsSync(), isFalse);
  });
}
