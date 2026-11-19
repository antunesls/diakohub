import 'dart:io';

import 'package:diako_server/auth.dart';
import 'package:diako_server/encontros.dart';
import 'package:diako_server/inscricao_link.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:test/test.dart';

void main() {
  late Directory pasta;
  late Store store;
  late Encontros encontros;
  late InscricoesPeloLink link;
  var agora = DateTime(2026, 11, 20, 10);
  final lider = Conta(id: 'l', nome: 'Líder', login: 'lider', perfil: Perfil.liderCasais);
  final midia = Conta(id: 'm', nome: 'Mídia', login: 'midia', perfil: Perfil.midia);

  Future<String> novoEncontro({int? capacidade = 3, String estado = 'aberto'}) async {
    final e = await encontros.criarEncontro({
      'titulo': 'Retiro', 'tipo': 'retiro', 'inicio': '2026-12-10T08:00', 'fim': '2026-12-12T17:00',
      'estado': estado, 'capacidade': capacidade,
    }, conta: lider);
    return e['id'] as String;
  }

  Map<String, dynamic> pessoa(String zap, {List<Map<String, dynamic>> acompanhantes = const []}) => {
        'nome': 'Pessoa $zap', 'whatsapp': '(11) 9${zap.padLeft(4, '0')}-0000', 'email': 'p$zap@exemplo.test',
        'acompanhantes': acompanhantes, 'consentimento': true,
      };

  setUp(() async {
    agora = DateTime(2026, 11, 20, 10);
    pasta = await Directory.systemTemp.createTemp('diako_inscricao_link_');
    store = Store(pasta.path);
    await store.carregar();
    await store.salvar('membros', {'id': 'ana', 'nome': 'Ana'});
    encontros = Encontros(store, agora: () => agora);
    link = InscricoesPeloLink(store, agora: () => agora);
  });
  tearDown(() async {
    await store.fechar();
    await pasta.delete(recursive: true);
  });

  test('configurar exige permissão, gera código longo e novo código invalida o antigo', () async {
    final id = await novoEncontro();
    await expectLater(link.configurar(id, {'ativo': true}, conta: midia), throwsStateError);
    final c = await link.configurar(id, {'ativo': true, 'pergunta': 'Vai de carona?'}, conta: lider);
    expect((c['codigo'] as String).length, greaterThanOrEqualTo(12));
    expect(link.info(c['codigo'])['aberto'], isTrue);
    expect(link.info(c['codigo'])['pergunta'], 'Vai de carona?');
    final novo = await link.configurar(id, {'novoCodigo': true}, conta: lider);
    expect(novo['codigo'], isNot(c['codigo']));
    expect(() => link.info(c['codigo']), throwsA(isA<NaoEncontrado>()));
    expect(novo['pergunta'], 'Vai de carona?', reason: 'mantém o resto da configuração');
    await expectLater(link.configurar(id, {'ativo': 'sim'}, conta: lider), throwsFormatException);
    await expectLater(link.configurar(id, {'ate': '31/12'}, conta: lider), throwsFormatException);
    await expectLater(link.configurar(id, {'extra': 1}, conta: lider), throwsFormatException);
  });

  test('info pública não expõe inscritos nem ids e explica quando está fechado', () async {
    final id = await novoEncontro();
    final c = await link.configurar(id, {'ativo': true}, conta: lider);
    await link.inscrever(c['codigo'], pessoa('1'));
    final info = link.info(c['codigo']);
    expect(info['vagasRestantes'], 2);
    expect(info.toString(), isNot(contains('Pessoa 1')));
    expect(info.keys, isNot(contains('id')));
    await link.configurar(id, {'ativo': false}, conta: lider);
    expect(link.info(c['codigo'])['aberto'], isFalse);
    await link.configurar(id, {'ativo': true, 'ate': '2026-11-19'}, conta: lider);
    expect(link.info(c['codigo'])['motivo'], contains('prazo'));
    await link.configurar(id, {'ate': null}, conta: lider);
    agora = DateTime(2026, 12, 10, 9);
    expect(link.info(c['codigo'])['motivo'], contains('começou'));
  });

  test('vale na hora até lotar; grupo que não cabe vai para a espera, que não ocupa vaga', () async {
    final id = await novoEncontro(capacidade: 3);
    final codigo = (await link.configurar(id, {'ativo': true}, conta: lider))['codigo'] as String;
    final a = await link.inscrever(codigo, pessoa('1', acompanhantes: [{'nome': 'Filho', 'crianca': true}]));
    expect(a.inscricao['estado'], 'confirmada');
    expect(a.inscricao['participantes'], hasLength(2));
    expect((a.inscricao['participantes'] as List).first['titular'], isTrue);
    final b = await link.inscrever(codigo, pessoa('2', acompanhantes: [{'nome': 'Amigo'}]));
    expect(b.inscricao['estado'], 'espera', reason: '2 + 2 > 3');
    expect(encontros.encontro(id)['vagasOcupadas'], 2);
    expect(encontros.encontro(id)['emEspera'], 2);
    final c = await link.inscrever(codigo, pessoa('3'));
    expect(c.inscricao['estado'], 'confirmada', reason: 'ainda cabe 1');
    await expectLater(link.promover(b.inscricao['id'], conta: lider), throwsFormatException, reason: 'sem vaga');
    await encontros.cancelarInscricao(a.inscricao['id'], conta: lider);
    await expectLater(link.promover(b.inscricao['id'], conta: midia), throwsStateError);
    final promovida = await link.promover(b.inscricao['id'], conta: lider);
    expect(promovida['estado'], 'confirmada');
    expect(encontros.encontro(id)['vagasOcupadas'], 3);
    await expectLater(link.promover(b.inscricao['id'], conta: lider), throwsFormatException);
  });

  test('valida dados, consentimento, WhatsApp duplicado e campos extras', () async {
    final id = await novoEncontro(capacidade: null);
    final codigo = (await link.configurar(id, {'ativo': true}, conta: lider))['codigo'] as String;
    for (final patch in <Map<String, dynamic>>[
      {'consentimento': false},
      {'nome': '  '},
      {'whatsapp': '1234'},
      {'email': 'sem-arroba'},
      {'acompanhantes': [{'nome': ''}]},
      {'acompanhantes': [{'nome': 'X', 'cpf': '1'}]},
      {'acompanhantes': List.filled(21, {'nome': 'X'})},
      {'saude': 'alergia'},
    ]) {
      await expectLater(link.inscrever(codigo, {...pessoa('1'), ...patch}), throwsFormatException, reason: '$patch');
    }
    final ok = await link.inscrever(codigo, {...pessoa('1'), 'email': null, 'whatsapp': '+55 11 91234-5678'});
    expect(ok.inscricao['whatsapp'], '5511912345678');
    expect(ok.inscricao.containsKey('email'), isFalse);
    await expectLater(link.inscrever(codigo, {...pessoa('9'), 'whatsapp': '11912345678'}), throwsFormatException,
        reason: 'mesmo WhatsApp no mesmo encontro');
    await expectLater(link.inscrever('codigo-inexistente', pessoa('2')), throwsA(isA<NaoEncontrado>()));
    expect(store.listar('membros'), hasLength(1), reason: 'inscrição pelo link não cria membro');
  });

  test('resposta só é guardada quando o encontro tem pergunta', () async {
    final id = await novoEncontro();
    final codigo = (await link.configurar(id, {'ativo': true}, conta: lider))['codigo'] as String;
    final sem = await link.inscrever(codigo, {...pessoa('1'), 'resposta': 'ignorada'});
    expect(sem.inscricao.containsKey('resposta'), isFalse);
    await link.configurar(id, {'pergunta': 'Vai de carona?'}, conta: lider);
    final com = await link.inscrever(codigo, {...pessoa('2'), 'resposta': 'Sim'});
    expect(com.inscricao['resposta'], 'Sim');
  });

  test('token de cancelamento: só o hash fica salvo, consulta e cancela uma vez', () async {
    final id = await novoEncontro();
    final codigo = (await link.configurar(id, {'ativo': true}, conta: lider))['codigo'] as String;
    final r = await link.inscrever(codigo, pessoa('1'));
    expect(store.listar('inscricoes').toString(), isNot(contains(r.token)));
    expect(r.inscricao['cancelamentoHash'], InscricoesPeloLink.hash(r.token));
    expect(link.consultar(r.token)['estado'], 'confirmada');
    expect(() => link.consultar('x' * 30), throwsA(isA<NaoEncontrado>()));
    expect(() => link.consultar(null), throwsA(isA<NaoEncontrado>()));
    expect((await link.cancelar(r.token))['estado'], 'cancelada');
    expect((await link.cancelar(r.token))['estado'], 'cancelada');
    expect(encontros.encontro(id)['vagasOcupadas'], 0);
    final de2 = await link.inscrever(codigo, pessoa('1'));
    expect(de2.inscricao['estado'], 'confirmada', reason: 'depois de cancelar pode se inscrever de novo');
  });

  test('vincular ao cadastro troca o titular pelo membro e impede duplicidade', () async {
    final id = await novoEncontro(capacidade: null);
    final codigo = (await link.configurar(id, {'ativo': true}, conta: lider))['codigo'] as String;
    final r = await link.inscrever(codigo, pessoa('1', acompanhantes: [{'nome': 'Filho'}]));
    final v = await link.vincular(r.inscricao['id'], {'membroId': 'ana'}, conta: lider);
    expect(v['responsavelMembroId'], 'ana');
    final titular = (v['participantes'] as List).first as Map;
    expect(titular['membroId'], 'ana');
    expect(titular.containsKey('nomeAcompanhante'), isFalse);
    expect((v['participantes'] as List)[1]['nomeAcompanhante'], 'Filho');
    expect(encontros.listarInscricoes(id).single['participantes'][0]['nome'], 'Ana');
    final outra = await link.inscrever(codigo, pessoa('2'));
    await expectLater(link.vincular(outra.inscricao['id'], {'membroId': 'ana'}, conta: lider), throwsFormatException);
    await expectLater(link.vincular(outra.inscricao['id'], {'membroId': 'fantasma'}, conta: lider), throwsFormatException);
    await expectLater(encontros.inscrever(id, {'responsavelMembroId': 'ana', 'participantes': [{'membroId': 'ana'}]}, conta: lider),
        throwsFormatException, reason: 'inscrição interna vê o membro vinculado');
  });

  test('encontro cancelado ou em rascunho não aceita pelo link', () async {
    final id = await novoEncontro(estado: 'rascunho');
    final codigo = (await link.configurar(id, {'ativo': true}, conta: lider))['codigo'] as String;
    await expectLater(link.inscrever(codigo, pessoa('1')), throwsFormatException);
    await encontros.cancelarEncontro(id, conta: lider);
    expect(link.info(codigo)['motivo'], contains('cancelado'));
    await expectLater(link.configurar(id, {'ativo': true}, conta: lider), throwsFormatException);
  });
}
