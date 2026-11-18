import 'dart:convert';
import 'dart:io';

import 'package:diako_server/auth.dart';
import 'package:diako_server/casais_materiais.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:test/test.dart';

void main() {
  late Directory pasta;
  late Store store;
  late CasaisMateriais dominio;
  final lider =
      Conta(id: 'l', nome: 'Líder', login: 'lider', perfil: Perfil.liderCasais);
  final consulta =
      Conta(id: 's', nome: 'Consulta', login: 's', perfil: Perfil.secretaria);
  Map<String, dynamic> corpo() => {
        'titulo': 'Conversa',
        'publico': 'ambos',
        'objetivo': 'Ouvir',
        'duracaoMinutos': 30,
        'referenciasBiblicas': 'Ef 4:32',
        'preparacao': '',
        'passos': 'Ouvir\r\nConversar',
        'perguntas': 'Como podemos ajudar?'
      };
  setUp(() async {
    pasta = await Directory.systemTemp.createTemp('diako_materiais_');
    store = Store(pasta.path);
    await store.carregar();
    dominio = CasaisMateriais(store, agora: () => DateTime(2026, 11, 18));
  });
  tearDown(() async {
    await store.fechar();
    await pasta.delete(recursive: true);
  });

  test('cria com autoria real, normaliza CRLF e retorna cópias isoladas',
      () async {
    final doc = await dominio.criarMaterial(corpo(), conta: lider);
    expect(doc['versao'], 1);
    expect(doc['usuarioId'], 'l');
    expect(doc['passos'], 'Ouvir\nConversar');
    doc['titulo'] = 'Mutado';
    expect(dominio.material(doc['id'])!['titulo'], 'Conversa');
    expect(dominio.listarMateriais(), hasLength(1));
  });
  test('valida duração, público, tipos, limites e campos forjados', () async {
    for (final patch in <Map<String, dynamic>>[
      {'titulo': null},
      {'titulo': ''},
      {'publico': 'outro'},
      {'duracaoMinutos': 0},
      {'duracaoMinutos': 481},
      {'duracaoMinutos': 1.5},
      {'passos': []},
      {'objetivo': 'a' * 20001},
      {'usuarioId': 'falso'},
      {'conteudoSnapshot': {}},
      {'versao': 7},
    ]) {
      await expectLater(
          dominio.criarMaterial({...corpo(), ...patch}, conta: lider),
          throwsFormatException);
    }
    for (final n in [1, 480]) {
      await dominio
          .criarMaterial({...corpo(), 'duracaoMinutos': n}, conta: lider);
    }
  });
  test('consulta não pode criar editar arquivar nem associar', () async {
    final doc = await dominio.criarMaterial(corpo(), conta: lider);
    await expectLater(
        dominio.criarMaterial(corpo(), conta: consulta), throwsStateError);
    await expectLater(
        dominio.editarMaterial(doc['id'], {'titulo': 'X'}, conta: consulta),
        throwsStateError);
    await expectLater(
        dominio.arquivarMaterial(doc['id'], conta: consulta), throwsStateError);
    await expectLater(
        dominio.associarAoEncontro('e', {'materiaisIds': []}, conta: consulta),
        throwsStateError);
  });
  test('versão e snapshot preservados após edição e arquivamento', () async {
    final doc = await dominio.criarMaterial(corpo(), conta: lider);
    final id = doc['id'] as String;
    await store.salvar('casaisEncontros', {
      'id': 'e',
      'titulo': 'Encontro',
      'tarefas': ['preservar']
    });
    await dominio.associarAoEncontro(
        'e',
        {
          'materiaisIds': [id]
        },
        conta: lider);
    final antes = jsonEncode(store.buscar('casaisEncontros', 'e')!['roteiro']);
    final editado =
        await dominio.editarMaterial(id, {'titulo': 'Revisado'}, conta: lider);
    expect(editado['versao'], 2);
    await dominio.arquivarMaterial(id, conta: lider);
    expect(dominio.listarMateriais(), isEmpty);
    expect(dominio.listarMateriais(arquivados: true), hasLength(1));
    expect(jsonEncode(store.buscar('casaisEncontros', 'e')!['roteiro']), antes);
    expect(store.buscar('casaisEncontros', 'e')!['tarefas'], ['preservar']);
    await expectLater(
        dominio.associarAoEncontro(
            'e',
            {
              'materiaisIds': [id]
            },
            conta: lider),
        throwsFormatException);
  });
  test('roteiro ordenado, limites, desconhecidos e snapshots forjados',
      () async {
    final a = await dominio.criarMaterial(corpo(), conta: lider);
    final b = await dominio
        .criarMaterial({...corpo(), 'titulo': 'Outro'}, conta: lider);
    await store.salvar('casaisEncontros', {'id': 'e'});
    final doc = await dominio.associarAoEncontro(
        'e',
        {
          'materiaisIds': [b['id'], a['id']]
        },
        conta: lider);
    expect((doc['roteiro'] as List).map((x) => x['materialId']),
        [b['id'], a['id']]);
    for (final patch in [
      {'materiaisIds': null},
      {
        'materiaisIds': ['inexistente']
      },
      {
        'materiaisIds': [a['id'], a['id']]
      },
      {'materiaisIds': List.filled(21, a['id'])},
      {'materiaisIds': [], 'roteiro': []},
    ]) {
      await expectLater(dominio.associarAoEncontro('e', patch, conta: lider),
          throwsFormatException);
    }
    await dominio.associarAoEncontro('e', {'materiaisIds': []}, conta: lider);
    expect(store.buscar('casaisEncontros', 'e')!['roteiro'], isEmpty);
  });
  test('edições de instâncias diferentes não perdem versão', () async {
    final doc = await dominio.criarMaterial(corpo(), conta: lider);
    final outro = CasaisMateriais(store);
    await Future.wait([
      dominio.editarMaterial(doc['id'], {'titulo': 'Novo'}, conta: lider),
      outro.editarMaterial(doc['id'], {'objetivo': 'Outro objetivo'},
          conta: lider),
    ]);
    expect(dominio.material(doc['id'])!['versao'], 3);
    expect(dominio.material(doc['id'])!['titulo'], 'Novo');
    expect(dominio.material(doc['id'])!['objetivo'], 'Outro objetivo');
  });
  test('fila compartilhada preserva campos de edição concorrente de encontro',
      () async {
    final doc = await dominio.criarMaterial(corpo(), conta: lider);
    await store.salvar('casaisEncontros', {'id': 'e', 'titulo': 'Antes'});
    await Future.wait([
      store.serializarCasais(() async {
        final anterior = store.buscar('casaisEncontros', 'e')!;
        await Future<void>.delayed(const Duration(milliseconds: 10));
        await store.salvar('casaisEncontros', {
          ...anterior,
          'titulo': 'Depois',
          'tarefas': ['nova']
        });
      }),
      dominio.associarAoEncontro(
          'e',
          {
            'materiaisIds': [doc['id']]
          },
          conta: lider),
    ]);
    final atual = store.buscar('casaisEncontros', 'e')!;
    expect(atual['titulo'], 'Depois');
    expect(atual['tarefas'], ['nova']);
    expect(atual['roteiro'], hasLength(1));
    final snapshot =
        (atual['roteiro'] as List).single['conteudoSnapshot'] as Map;
    expect(snapshot.keys, isNot(contains('usuarioId')));
    expect(snapshot.keys, isNot(contains('arquivado')));
  });
  test('falha de disco não publica mudança e não trava próxima mutação',
      () async {
    var falhar = false;
    final isolado =
        Store('${pasta.path}/falha', gravar: (caminho, conteudo) async {
      if (falhar) throw const FileSystemException('Falha simulada');
      await Store.gravarArquivo(caminho, conteudo);
    });
    await isolado.carregar();
    try {
      final servico = CasaisMateriais(isolado);
      final doc = await servico.criarMaterial(corpo(), conta: lider);
      falhar = true;
      await expectLater(
          servico.editarMaterial(doc['id'], {'titulo': 'Não salvo'},
              conta: lider),
          throwsA(isA<FileSystemException>()));
      expect(servico.material(doc['id'])!['titulo'], 'Conversa');
      expect(servico.material(doc['id'])!['versao'], 1);
      falhar = false;
      final editado = await servico
          .editarMaterial(doc['id'], {'titulo': 'Salvo'}, conta: lider);
      expect(editado['versao'], 2);
    } finally {
      await isolado.fechar();
    }
  });
  test('limite total exato, opcionais ausentes e leitura após reinício',
      () async {
    final doc = await dominio.criarMaterial(
        {'titulo': 'a' * 20000, 'publico': 'familia', 'duracaoMinutos': 1},
        conta: lider);
    expect(doc['objetivo'], '');
    await expectLater(
        dominio.editarMaterial(doc['id'], {'preparacao': 'a'}, conta: lider),
        throwsFormatException);
    await expectLater(
        dominio.editarMaterial(doc['id'], {'perguntas': null}, conta: lider),
        throwsFormatException);
    final recarregado = Store(pasta.path);
    await recarregado.carregar();
    try {
      expect(CasaisMateriais(recarregado).material(doc['id'])!['titulo'],
          doc['titulo']);
    } finally {
      await recarregado.fechar();
    }
  });
}
