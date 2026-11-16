import 'dart:convert';
import 'dart:io';

import 'package:diako_server/app.dart';
import 'package:diako_server/auditoria.dart';
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
import 'package:path/path.dart' as p;
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

/// A trilha de auditoria registra quem alterou escalas, repertório, músicas escolhidas,
/// roteiros e indisponibilidades — e a listagem é só da administração.
void main() {
  test('comparações que viram detalhes legíveis', () {
    expect(Auditoria.diffFuncao('Violão', [], ['Ana']), 'Violão: ninguém → Ana');
    expect(Auditoria.diffFuncao('Vocal', ['Ana'], ['Ana']), isNull);
    expect(Auditoria.diffFuncao('Vocal', ['Ana', 'Bia'], ['Bia']), 'Vocal: Ana, Bia → Bia');
    expect(Auditoria.diffFuncao('Teclado', ['Ana'], []), 'Teclado: Ana → ninguém');

    const graca = {'titulo': 'Graça', 'tom': 'G', 'repertorioId': 'r1'};
    const gracaEm = {'titulo': 'Graça', 'tom': 'D', 'repertorioId': 'r1'};
    const santo = {'titulo': 'Santo', 'tom': ''};
    expect(Auditoria.diffMusicas([graca], [gracaEm]), 'tom de Graça: G → D');
    expect(Auditoria.diffMusicas([graca], [graca]), isNull);
    expect(Auditoria.diffMusicas([graca, santo], [santo, graca]), 'ordem das músicas alterada');
    expect(Auditoria.diffMusicas([], [graca]), '+Graça');
    expect(Auditoria.diffMusicas([graca], []), '-Graça');
    expect(Auditoria.diffMusicas([santo], [graca]), '+Graça · -Santo');

    expect(Auditoria.diffRepertorio({'tomDiakonia': 'G'}, {'tomDiakonia': 'D'}), 'tom Diakonia: G → D');
    expect(Auditoria.diffRepertorio({'status': 'OK'}, {'status': 'OK'}), isNull);
    // "ativo" fica de fora: acompanha o status.
    expect(Auditoria.diffRepertorio({'ativo': true}, {'ativo': false}), isNull);
    // Campo longo é cortado para não virar um relatório dentro da trilha.
    final longo = Auditoria.diffRepertorio({'observacoes': 'x' * 100}, {'observacoes': 'y' * 100})!;
    expect(longo.contains('…'), isTrue);
    expect(longo.length, lessThan(200));
  });

  test('arquivo da trilha: só tipos conhecidos, mais recentes primeiro e filtro por tipo', () async {
    final tmp = await Directory.systemTemp.createTemp('diako_auditoria');
    addTearDown(() => tmp.delete(recursive: true));
    final a = Auditoria(tmp.path);
    expect(() => a.registrar(tipo: 'x', acao: 'a', alvo: 'b'), throwsArgumentError);
    await a.registrar(tipo: 'escala', acao: 'culto-criado', alvo: 'Culto A', detalhe: 'd', usuario: 'Ana', perfil: 'administrador');
    await a.registrar(tipo: 'repertorio', acao: 'musica-editada', alvo: 'Música B', usuario: 'Bo');
    final eventos = await a.listar();
    expect(eventos.length, 2);
    expect(eventos.first['alvo'], 'Música B'); // mais recente primeiro.
    expect(eventos.first.containsKey('detalhe'), isFalse);
    expect(eventos.first.containsKey('perfil'), isFalse);
    expect(eventos.last['perfil'], 'administrador');
    expect((await a.listar(tipo: 'escala')).single['alvo'], 'Culto A');
    expect((await a.listar(limite: 1)).single['alvo'], 'Música B');
    // Linha quebrada (queda de energia) não derruba a listagem.
    await File(p.join(tmp.path, 'auditoria.jsonl')).writeAsString('{"quando": "parci', mode: FileMode.append);
    expect((await a.listar()).length, 2);
  });

  group('servidor', () {
    late Directory tmp;
    late Store store;
    late Handler handler;
    late String admin;
    // Quarta-feira, 28/10/2026.
    final agora = DateTime(2026, 10, 28, 10);

    Future<(int, dynamic)> chamar(String metodo, String caminho, {String? token, Object? json}) async {
      final r = await handler(Request(metodo, Uri.parse('http://x$caminho'),
          headers: {if (token != null) 'authorization': 'Bearer $token', 'content-type': 'application/json'},
          body: json == null ? null : jsonEncode(json)));
      final texto = await r.readAsString();
      return (r.statusCode, texto.isEmpty || !texto.startsWith('{') && !texto.startsWith('[') ? texto : jsonDecode(texto));
    }

    Future<String> criarUsuario(String login, Perfil perfil) async {
      final (_, j) = await chamar('POST', '/api/admin/usuarios',
          token: admin, json: {'nome': 'Usuário $login', 'login': login, 'perfil': perfil.id});
      final (_, l) = await chamar('POST', '/api/login', json: {'usuario': login, 'senha': j['senhaTemporaria']});
      // Primeiro acesso: a senha temporária só serve para criar a própria.
      await chamar('POST', '/api/eu/senha', token: l['token'] as String, json: {'atual': j['senhaTemporaria'], 'nova': 'senha-propria-1'});
      return l['token'] as String;
    }

    Future<String> membro(String nome, {List<String> ministerios = const []}) async {
      final (st, m) = await chamar('POST', '/api/membros',
          token: admin, json: {'nome': nome, 'dia': 1, 'mes': 1, 'ministerios': ministerios});
      expect(st, 201, reason: '$m');
      return m['id'] as String;
    }

    Future<String> musica(String titulo, {String tom = ''}) async {
      final (st, m) = await chamar('POST', '/api/repertorio', token: admin,
          json: {'titulo': titulo, 'cantor': 'Cantor', 'tomDiakonia': tom});
      expect(st, 201);
      return m['id'] as String;
    }

    /// Eventos da trilha, do mais recente para o mais antigo (só a administração lê).
    Future<List<Map<String, dynamic>>> trilha({String tipo = ''}) async {
      final (st, j) = await chamar('GET', '/api/auditoria${tipo.isEmpty ? '' : '?tipo=$tipo'}', token: admin);
      expect(st, 200);
      return [for (final e in j as List) Map<String, dynamic>.from(e as Map)];
    }

    setUp(() async {
      tmp = await Directory.systemTemp.createTemp('diako_auditoria_srv');
      final config = Config.lerJson('{"senhaAdmin":"senha-principal"}', pastaBase: tmp.path);
      store = Store(config.pastaDados);
      await store.carregar();
      final cfg = await Configuracoes.carregar(config, urlDetectada: 'http://192.168.0.10:8080');
      final usuarios = Usuarios(config.pastaDados);
      final auth = Auth(conferirSenha: cfg.conferirSenha, pastaDados: config.pastaDados, usuarios: usuarios);
      handler = Servidor(
        store: store,
        auth: auth,
        holyrics: HolyricsDireto(host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{}', 200))),
        cartazes: Cartazes(config.pastaCartazes),
        backup: Backup(pastaDados: config.pastaDados, configuracoes: cfg.publicas),
        pastaWeb: (Directory(p.join(tmp.path, 'web'))..createSync()).path,
        urlOracao: cfg.urlOracao,
        cartazesNoHolyrics: false,
        historico: Historico(config.pastaDados),
        cfg: cfg,
        relogio: () => agora,
      ).handler;
      final (_, l) = await chamar('POST', '/api/login', json: {'senha': 'senha-principal'});
      admin = l['token'] as String;
    });
    tearDown(() async {
      await store.fechar();
      try {
        await tmp.delete(recursive: true);
      } on FileSystemException {
        // Windows às vezes ainda segura um arquivo; é pasta temporária.
      }
    });

    test('a trilha é só da administração; tipo inválido é recusado', () async {
      expect(permissaoDaRota('GET', 'api/auditoria'), Permissao.admin);
      expect(Perfil.administrador.pode(Permissao.admin), isTrue);
      for (final perfil in [Perfil.pastor, Perfil.secretaria, Perfil.comissaoLouvor, Perfil.midia]) {
        expect(perfil.pode(Permissao.admin), isFalse, reason: perfil.nome);
      }
      final comissao = await criarUsuario('comissao', Perfil.comissaoLouvor);
      expect((await chamar('GET', '/api/auditoria', token: comissao)).$1, 403);
      expect((await chamar('GET', '/api/auditoria?tipo=invalido', token: admin)).$1, 400);
      expect((await chamar('GET', '/api/auditoria', token: admin)).$1, 200);
    });

    test('escala: gerar, trocar função, mudar dados e excluir culto deixam trilha', () async {
      await chamar('PUT', '/api/admin/configuracoes', token: admin, json: {'siteCultos': 'Domingo — 19h'});
      final (_, g) = await chamar('POST', '/api/escalas/gerar', token: admin, json: {'mes': '2026-11'});
      expect(g['criados'], 5);
      var eventos = await trilha(tipo: 'escala');
      expect(eventos.single['acao'], 'cultos-gerados');
      expect(eventos.single['alvo'], 'novembro de 2026');
      expect(eventos.single['detalhe'], contains('5 culto(s)'));
      expect(eventos.single['usuario'], 'Administrador');

      final (_, cultos) = await chamar('GET', '/api/escalas?mes=2026-11', token: admin);
      final id = (cultos['cultos'] as List).first['id'] as String;
      final ana = await membro('Ana Souza', ministerios: ['Louvor']);

      // Trocar quem serve numa função registra os nomes, não os ids.
      await chamar('PUT', '/api/escalas/$id', token: admin,
          json: {'tipo': 'louvor', 'funcao': 'Violão', 'membros': [ana]});
      eventos = await trilha(tipo: 'escala');
      expect(eventos.first['acao'], 'funcao-alterada');
      expect(eventos.first['alvo'], 'Dom 01/11 · 19h');
      expect(eventos.first['detalhe'], 'Violão: ninguém → Ana Souza');

      // Salvar a mesma lista não gera evento: só mudança real entra na trilha.
      await chamar('PUT', '/api/escalas/$id', token: admin,
          json: {'tipo': 'louvor', 'funcao': 'Violão', 'membros': [ana]});
      eventos = await trilha(tipo: 'escala');
      expect(eventos.first['acao'], 'funcao-alterada');

      // Dados do culto (pastoral).
      await chamar('PUT', '/api/escalas/$id', token: admin, json: {'hora': '20:00', 'tema': 'A graça de Deus'});
      eventos = await trilha(tipo: 'escala');
      expect(eventos.first['acao'], 'culto-alterado');
      expect(eventos.first['detalhe'], contains('horário: 19:00 → 20:00'));
      expect(eventos.first['detalhe'], contains('tema: — → A graça de Deus'));

      expect((await chamar('DELETE', '/api/escalas/$id', token: admin)).$1, 200);
      eventos = await trilha(tipo: 'escala');
      expect(eventos.first['acao'], 'culto-excluido');
      expect(eventos.first['detalhe'], 'Culto excluído');
    });

    test('repertório: cadastro, edição e importação deixam trilha', () async {
      final id = await musica('Grandes Coisas', tom: 'G');
      var eventos = await trilha(tipo: 'repertorio');
      expect(eventos.single['acao'], 'musica-cadastrada');
      expect(eventos.single['alvo'], 'Grandes Coisas — Cantor');

      // Editar sem mudar nada não gera evento.
      await chamar('PUT', '/api/repertorio/$id', token: admin,
          json: {'titulo': 'Grandes Coisas', 'cantor': 'Cantor', 'tomDiakonia': 'G'});
      expect((await trilha(tipo: 'repertorio')).length, 1);

      await chamar('PUT', '/api/repertorio/$id', token: admin, json: {'tomDiakonia': 'D'});
      eventos = await trilha(tipo: 'repertorio');
      expect(eventos.first['acao'], 'musica-editada');
      expect(eventos.first['detalhe'], 'tom Diakonia: G → D');

      const csv = 'Louvor,Cantor\nOceanos,Hillsong\nGrandes Coisas,Cantor';
      final (_, i) = await chamar('POST', '/api/repertorio/importar', token: admin, json: {'csv': csv});
      expect(i['importadas'], 1);
      eventos = await trilha(tipo: 'repertorio');
      expect(eventos.first['acao'], 'repertorio-importado');
      expect(eventos.first['alvo'], 'Importação de planilha');
      expect(eventos.first['detalhe'], contains('1 música(s) nova(s)'));
      expect(eventos.first['detalhe'], contains('1 já no repertório'));
    });

    test('músicas escolhidas: a comissão e o ministro escalado deixam trilha', () async {
      await chamar('PUT', '/api/admin/configuracoes', token: admin, json: {'siteCultos': 'Domingo — 19h'});
      await chamar('POST', '/api/escalas/gerar', token: admin, json: {'mes': '2026-11'});
      final (_, cultos) = await chamar('GET', '/api/escalas?mes=2026-11', token: admin);
      final id = (cultos['cultos'] as List).first['id'] as String;
      final cancion = await musica('Canção', tom: 'G');
      final abertura = await musica('Abertura');

      await chamar('PUT', '/api/escalas/$id', token: admin, json: {
        'musicas': [{'repertorioId': cancion, 'tom': 'D'}, {'repertorioId': abertura}],
      });
      var eventos = await trilha(tipo: 'musicas');
      expect(eventos.single['acao'], 'musicas-alteradas');
      expect(eventos.single['detalhe'], contains('+Canção'));
      expect(eventos.single['detalhe'], contains('+Abertura'));

      // O ministro escalado escolhe as músicas do próprio culto pelo /minha-escala.
      final ana = await membro('Ana Ministra', ministerios: ['Louvor']);
      await chamar('PUT', '/api/escalas/$id', token: admin,
          json: {'tipo': 'louvor', 'funcao': 'Ministro', 'membros': [ana]});
      final ministro = await criarUsuario('ana.ministra', Perfil.ministro);
      final (_, acessos) = await chamar('GET', '/api/acessos-escala', token: admin);
      final usuarioId = (acessos['usuarios'] as List).firstWhere((u) => u['login'] == 'ana.ministra')['id'];
      await chamar('POST', '/api/acessos-escala/vincular', token: admin, json: {'usuarioId': usuarioId, 'membroId': ana});
      expect((await chamar('PUT', '/api/minha-escala/cultos/$id/musicas', token: ministro,
          json: {'musicas': [
            {'repertorioId': abertura},
            {'repertorioId': cancion, 'tom': 'D'},
          ]})).$1, 200);
      eventos = await trilha(tipo: 'musicas');
      expect(eventos.first['acao'], 'musicas-escolhidas');
      expect(eventos.first['usuario'], 'Usuário ana.ministra');
      expect(eventos.first['detalhe'], 'ordem das músicas alterada');
    });

    test('roteiros e indisponibilidades deixam trilha', () async {
      const itens = [
        {'chave': 'contagem', 'tipo': 'contagem'},
        {'chave': 'louvor', 'tipo': 'louvor', 'minutos': 25},
      ];
      final (st, modelo) = await chamar('POST', '/api/roteiros', token: admin, json: {'nome': 'Domingo', 'itens': itens});
      expect(st, 201);
      var eventos = await trilha(tipo: 'roteiro');
      expect(eventos.single['acao'], 'roteiro-criado');
      expect(eventos.single['alvo'], 'Domingo');
      expect(eventos.single['detalhe'], contains('2 item(ns)'));

      await chamar('PUT', '/api/roteiros/${modelo['id']}', token: admin, json: {'nome': 'Domingo completo', 'itens': itens});
      eventos = await trilha(tipo: 'roteiro');
      expect(eventos.first['acao'], 'roteiro-editado');
      expect(eventos.first['alvo'], 'Domingo completo');

      expect((await chamar('DELETE', '/api/roteiros/${modelo['id']}', token: admin)).$1, 200);
      eventos = await trilha(tipo: 'roteiro');
      expect(eventos.first['acao'], 'roteiro-excluido');

      final ana = await membro('Ana Souza');
      final (_, ind) = await chamar('POST', '/api/escalas/indisponibilidades', token: admin,
          json: {'membroId': ana, 'de': '2026-11-05', 'ate': '2026-11-08', 'motivo': 'Viagem'});
      eventos = await trilha(tipo: 'indisponibilidade');
      expect(eventos.single['acao'], 'indisponibilidade-criada');
      expect(eventos.single['alvo'], 'Ana Souza');
      expect(eventos.single['detalhe'], 'Indisponível de 2026-11-05 a 2026-11-08 — Viagem');

      expect((await chamar('DELETE', '/api/escalas/indisponibilidades/${ind['id']}', token: admin)).$1, 200);
      eventos = await trilha(tipo: 'indisponibilidade');
      expect(eventos.first['acao'], 'indisponibilidade-removida');
      expect(eventos.first['detalhe'], contains('removido'));
      expect(eventos.first['detalhe'], isNot(contains('própria pessoa')));

      // A própria pessoa avisa pelo /minha-escala e pode desfazer.
      final integrante = await criarUsuario('ana.integrante', Perfil.integrante);
      final (_, acessos) = await chamar('GET', '/api/acessos-escala', token: admin);
      final usuarioId = (acessos['usuarios'] as List).firstWhere((u) => u['login'] == 'ana.integrante')['id'];
      await chamar('POST', '/api/acessos-escala/vincular', token: admin, json: {'usuarioId': usuarioId, 'membroId': ana});
      final (_, minha) = await chamar('POST', '/api/minha-escala/indisponivel', token: integrante,
          json: {'de': '2026-12-05', 'ate': '2026-12-06'});
      eventos = await trilha(tipo: 'indisponibilidade');
      expect(eventos.first['acao'], 'indisponibilidade-criada');
      expect(eventos.first['usuario'], 'Usuário ana.integrante');
      expect((await chamar('POST', '/api/minha-escala/indisponivel/remover', token: integrante,
          json: {'id': minha['id']})).$1, 200);
      eventos = await trilha(tipo: 'indisponibilidade');
      expect(eventos.first['acao'], 'indisponibilidade-removida');
      expect(eventos.first['detalhe'], contains('pela própria pessoa'));
    });

    test('excluir membro escalado registra a limpeza das escalas', () async {
      final ana = await membro('Ana Souza', ministerios: ['Louvor']);
      await chamar('PUT', '/api/admin/configuracoes', token: admin, json: {'siteCultos': 'Domingo — 19h'});
      await chamar('POST', '/api/escalas/gerar', token: admin, json: {'mes': '2026-11'});
      final (_, cultos) = await chamar('GET', '/api/escalas?mes=2026-11', token: admin);
      final id = (cultos['cultos'] as List).first['id'] as String;
      await chamar('PUT', '/api/escalas/$id', token: admin,
          json: {'tipo': 'louvor', 'funcao': 'Vocal', 'membros': [ana]});
      expect((await chamar('DELETE', '/api/membros/$ana', token: admin)).$1, 200);
      final eventos = await trilha(tipo: 'escala');
      expect(eventos.first['acao'], 'escalas-limpas');
      expect(eventos.first['alvo'], 'Ana Souza');
      expect(eventos.first['detalhe'], contains('saiu de 1 culto(s)'));
    });
  });
}
