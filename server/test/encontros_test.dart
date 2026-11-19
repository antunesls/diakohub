import 'dart:io';
import 'package:diako_server/auth.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:diako_server/encontros.dart';
import 'package:test/test.dart';

void main() {
  late Store store;
  late Directory pasta;
  late Encontros dominio;
  final lider =
      Conta(id: 'l', nome: 'Líder', login: 'lider', perfil: Perfil.liderCasais);
  final semEncontros =
      Conta(id: 's', nome: 'Sem encontros', login: 's', perfil: Perfil.midia);
  Map<String, dynamic> dados() => {
        'titulo': 'Jantar',
        'tipo': 'jantar',
        'inicio': '2026-12-01T19:00',
        'fim': '2026-12-01T21:00',
        'local': 'Salão',
        'descricao': '',
        'estado': 'aberto',
        'capacidade': 2
      };
  Map<String, dynamic> inscricao(String id) => {
        'responsavelMembroId': id,
        'participantes': [
          {'membroId': id, 'confirmado': true, 'crianca': false}
        ]
      };
  setUp(() async {
    pasta = await Directory.systemTemp.createTemp('diako_encontros_');
    store = Store(pasta.path);
    await store.carregar();
    await store.salvarVarios('membros', [
      {'id': 'a', 'nome': 'Ana'},
      {'id': 'b', 'nome': 'Bia'},
      {'id': 'c', 'nome': 'Caio'}
    ]);
    dominio = Encontros(store,
        agora: () => DateTime(2026, 11, 18),
        responsavelValido: (id) => id == 'l');
  });
  tearDown(() async {
    await store.fechar();
    await pasta.delete(recursive: true);
  });
  test('valida gestão, intervalo, estados e campos estritos', () async {
    await expectLater(
        dominio.criarEncontro(dados(), conta: semEncontros), throwsStateError);
    for (final alteracao in [
      {'fim': '2026-11-01T10:00'},
      {'estado': 'inventado'},
      {'capacidade': 0},
      {'inicio': '2026-02-30T19:00'},
      {'cpf': '123'}
    ]) {
      await expectLater(
          dominio.criarEncontro({...dados(), ...alteracao}, conta: lider),
          throwsFormatException);
    }
    final equipe = Conta(id: 'e', nome: 'Equipe de eventos', login: 'equipe',
        perfil: Perfil(id: 'equipe-eventos', nome: 'Equipe de eventos', permissoes: {Permissao.encontros}));
    final e = await dominio.criarEncontro(dados(), conta: equipe);
    expect(e['usuarioId'], 'e');
    expect(dominio.listarEncontros(), hasLength(1));
    e['titulo'] = 'não persistir';
    expect(dominio.encontro(e['id'])['titulo'], 'Jantar');
  });
  test('família confirma pessoa a pessoa, criança contextual e IDs estáveis',
      () async {
    final e = await dominio
        .criarEncontro({...dados(), 'capacidade': 4}, conta: lider);
    final i = await dominio.inscrever(
        e['id'],
        {
          'responsavelMembroId': 'a',
          'participantes': [
            {'membroId': 'a', 'confirmado': true},
            {'membroId': 'b', 'confirmado': false},
            {
              'nomeAcompanhante': 'Criança convidada',
              'crianca': true,
              'confirmado': true
            }
          ]
        },
        conta: lider);
    expect(i['participantes'], hasLength(3));
    expect(
        (i['participantes'] as List).map((p) => p['id']).toSet(), hasLength(3));
    expect(dominio.encontro(e['id'])['vagasOcupadas'], 3);
    expect(store.listar('membros'), hasLength(3));
    final p = i['participantes'][0];
    final marcado = await dominio
        .registrarPresenca(i['id'], p['id'], {'presente': true}, conta: lider);
    expect(marcado['participantes'][0]['presencaPor'], 'l');
    final desfeito = await dominio
        .registrarPresenca(i['id'], p['id'], {'presente': false}, conta: lider);
    expect(desfeito['participantes'][0]['presenteEm'], isNull);
    expect(desfeito['participantes'][0]['presencaAlteradaPor'], 'l');
    expect(desfeito['participantes'][0]['id'], p['id']);
    await expectLater(
        dominio.registrarPresenca(
            i['id'], i['participantes'][1]['id'], {'presente': true},
            conta: lider),
        throwsFormatException);
  });
  test('homônimos externos de famílias diferentes têm identidade contextual', () async {
    final e = await dominio.criarEncontro({...dados(), 'capacidade': 10}, conta: lider);
    for (final responsavel in ['a', 'b']) {
      await dominio.inscrever(e['id'], {'responsavelMembroId': responsavel,
        'participantes': [{'membroId': responsavel}, {'nomeAcompanhante': 'João'}]}, conta: lider);
    }
    expect(dominio.encontro(e['id'])['vagasOcupadas'], 4);
  });
  test('recusa referências, dados privados e duplicação de membros/convidados',
      () async {
    final e = await dominio
        .criarEncontro({...dados(), 'capacidade': 10}, conta: lider);
    for (final corpo in [
      inscricao('inexistente'),
      {
        'responsavelMembroId': 'a',
        'participantes': [
          {'nomeAcompanhante': 'Filho', 'saude': 'não guardar'}
        ]
      },
      {
        'responsavelMembroId': 'a',
        'participantes': [
          {'membroId': 'a'},
          {'membroId': 'a'}
        ]
      },
      {
        'responsavelMembroId': 'a',
        'participantes': [
          {'nomeAcompanhante': ' João '},
          {'nomeAcompanhante': 'joão'}
        ]
      }
    ]) {
      await expectLater(dominio.inscrever(e['id'], corpo, conta: lider),
          throwsFormatException);
    }
    final i = await dominio.inscrever(e['id'], inscricao('a'), conta: lider);
    await expectLater(dominio.inscrever(e['id'], inscricao('a'), conta: lider),
        throwsFormatException);
    await dominio.cancelarInscricao(i['id'], conta: lider);
    await dominio.inscrever(e['id'], inscricao('a'), conta: lider);
  });
  test(
      'serializa última vaga inclusive entre instâncias e libera após cancelamento',
      () async {
    final e = await dominio
        .criarEncontro({...dados(), 'capacidade': 1}, conta: lider);
    final outro = Encontros(store);
    final resultados = await Future.wait([
      dominio
          .inscrever(e['id'], inscricao('a'), conta: lider)
          .then<Object>((v) => v, onError: (Object e) => e),
      outro
          .inscrever(e['id'], inscricao('b'), conta: lider)
          .then<Object>((v) => v, onError: (Object e) => e)
    ]);
    expect(resultados.whereType<Map>(), hasLength(1));
    expect(resultados.whereType<FormatException>(), hasLength(1));
    await dominio.cancelarInscricao((resultados.whereType<Map>().single)['id'],
        conta: lider);
    expect(dominio.encontro(e['id'])['vagasDisponiveis'], 1);
  });
  test(
      'não reduz capacidade ocupada e cancelamento preserva histórico e bloqueia ações',
      () async {
    final e = await dominio.criarEncontro(dados(), conta: lider);
    final i = await dominio.inscrever(e['id'], inscricao('a'), conta: lider);
    await dominio.inscrever(e['id'], inscricao('b'), conta: lider);
    await expectLater(
        dominio.editarEncontro(e['id'], {'capacidade': 1}, conta: lider),
        throwsFormatException);
    await dominio.cancelarEncontro(e['id'], conta: lider);
    await expectLater(dominio.inscrever(e['id'], inscricao('c'), conta: lider),
        throwsFormatException);
    await expectLater(
        dominio.registrarPresenca(
            i['id'], i['participantes'][0]['id'], {'presente': true},
            conta: lider),
        throwsFormatException);
    await expectLater(
        dominio.editarEncontro(e['id'], {'estado': 'aberto'}, conta: lider),
        throwsFormatException);
    expect(dominio.listarInscricoes(e['id']), hasLength(2));
  });
  test('tarefas validam responsáveis no servidor e preservam autoria',
      () async {
    final e = await dominio.criarEncontro(dados(), conta: lider);
    await expectLater(
        dominio.criarTarefa(e['id'],
            {'descricao': 'Organizar', 'responsavelUsuarioId': 'intruso'},
            conta: lider),
        throwsFormatException);
    final t = await dominio.criarTarefa(
        e['id'],
        {
          'descricao': 'Organizar',
          'responsavelUsuarioId': 'l',
          'prazo': '2026-11-19'
        },
        conta: lider);
    expect(t['estado'], 'pendente');
    final atualizado = await dominio
        .editarTarefa(t['id'], {'estado': 'concluida'}, conta: lider);
    expect(atualizado['usuarioId'], 'l');
    expect(atualizado['estado'], 'concluida');
    expect(dominio.listarTarefas(e['id']), hasLength(1));
    await expectLater(
        dominio.editarTarefa(t['id'], {'estado': 'x'}, conta: lider),
        throwsFormatException);
  });
  test('confirmação individual posterior não muda IDs nem participantes',
      () async {
    final e = await dominio.criarEncontro(dados(), conta: lider);
    final i = await dominio.inscrever(
        e['id'],
        {
          'responsavelMembroId': 'a',
          'participantes': [
            {'membroId': 'a', 'confirmado': false}
          ]
        },
        conta: lider);
    final id = i['participantes'][0]['id'];
    final atualizado = await dominio.registrarPresenca(
        i['id'], id, {'confirmado': true, 'presente': true},
        conta: lider);
    expect(atualizado['participantes'][0]['presenteEm'], isNotNull);
    final desfeito = await dominio
        .registrarPresenca(i['id'], id, {'confirmado': false}, conta: lider);
    expect(desfeito['participantes'][0]['presenteEm'], isNull);
    expect(desfeito['participantes'][0]['id'], id);
  });
  test('responsável revogado não recebe atualização e pode ser removido',
      () async {
    final e = await dominio.criarEncontro(dados(), conta: lider);
    final t = await dominio.criarTarefa(
        e['id'], {'descricao': 'Preparar', 'responsavelUsuarioId': 'l'},
        conta: lider);
    final revogado = Encontros(store, responsavelValido: (_) => false);
    await expectLater(
        revogado.editarTarefa(t['id'], {'estado': 'concluida'}, conta: lider),
        throwsFormatException);
    final corrigido = await revogado.editarTarefa(
        t['id'], {'responsavelUsuarioId': null, 'estado': 'concluida'},
        conta: lider);
    expect(corrigido['responsavelUsuarioId'], isNull);
  });
  test('falha de disco não reserva vaga e não trava fila', () async {
    var falhar = false;
    final isolado =
        Store('${pasta.path}/falha', gravar: (caminho, conteudo) async {
      if (falhar) throw const FileSystemException('Falha simulada');
      await Store.gravarArquivo(caminho, conteudo);
    });
    await isolado.carregar();
    try {
      await isolado.salvar('membros', {'id': 'a', 'nome': 'Ana'});
      final d = Encontros(isolado);
      final e =
          await d.criarEncontro({...dados(), 'capacidade': 1}, conta: lider);
      falhar = true;
      await expectLater(d.inscrever(e['id'], inscricao('a'), conta: lider),
          throwsA(isA<FileSystemException>()));
      expect(d.encontro(e['id'])['vagasOcupadas'], 0);
      falhar = false;
      await d.inscrever(e['id'], inscricao('a'), conta: lider);
      expect(d.encontro(e['id'])['vagasOcupadas'], 1);
    } finally {
      await isolado.fechar();
    }
  });
  test(
      'edição compartilha fila com roteiro e não perde snapshot de outro serviço',
      () async {
    final e = await dominio.criarEncontro(dados(), conta: lider);
    final roteiro = store.serializarCasais(() async {
      final atual = {...store.buscar('encontros', e['id'])!};
      await Future<void>.delayed(const Duration(milliseconds: 5));
      atual['roteiro'] = [
        {
          'materialId': 'm',
          'versao': 1,
          'conteudoSnapshot': {'titulo': 'Atividade'}
        }
      ];
      await store.salvar('encontros', atual);
    });
    final edicao = dominio.editarEncontro(e['id'], {'titulo': 'Novo título'},
        conta: lider);
    await roteiro;
    expect((await edicao)['roteiro'], hasLength(1));
    expect(dominio.encontro(e['id'])['titulo'], 'Novo título');
  });

  test('exclusão de encontro: só a Administração, leva inscrições e tarefas e não mexe nos outros', () async {
    final admin = Conta(id: 'adm', nome: 'Administrador', login: 'admin', perfil: Perfil.administrador);
    final apagar = await dominio.criarEncontro(dados(), conta: lider);
    final manter = await dominio.criarEncontro({...dados(), 'titulo': 'Outro'}, conta: lider);
    await dominio.inscrever(apagar['id'], inscricao('a'), conta: lider);
    await dominio.inscrever(manter['id'], inscricao('a'), conta: lider);
    await dominio.criarTarefa(apagar['id'], {'descricao': 'Comprar'}, conta: lider);
    await dominio.criarTarefa(manter['id'], {'descricao': 'Limpar'}, conta: lider);
    await expectLater(dominio.excluirEncontro(apagar['id'], conta: lider), throwsStateError,
        reason: 'quem gerencia encontros sem Administração não exclui');
    await expectLater(dominio.excluirEncontro(apagar['id'], conta: semEncontros), throwsStateError);
    expect(await dominio.excluirEncontro(apagar['id'], conta: admin), {'inscricoes': 1, 'tarefas': 1});
    expect(store.buscar('encontros', apagar['id']), isNull);
    expect(store.listar('inscricoes').map((i) => i['encontroId']), [manter['id']]);
    expect(store.listar('tarefasEncontros').map((t) => t['encontroId']), [manter['id']]);
    await expectLater(dominio.excluirEncontro(apagar['id'], conta: admin), throwsA(isA<NaoEncontrado>()));
  });
}
