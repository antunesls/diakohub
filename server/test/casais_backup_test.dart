import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/backup.dart';
import 'package:diako_server/encontros.dart';
import 'package:diako_server/casais_materiais.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

const colecoesCasais = ['casaisContatos', 'casaisEnvios', 'encontros',
  'inscricoes', 'tarefasEncontros', 'casaisMateriais'];
const data = '2026-11-18T10:00:00.000';
final autoria = {'criadoEm': data, 'atualizadoEm': data, 'usuarioId': 'lider', 'usuarioNome': 'Líder'};
Map<String, dynamic> conteudo() => {'titulo': 'Atividade fictícia', 'publico': 'ambos',
  'objetivo': '', 'duracaoMinutos': 30, 'referenciasBiblicas': '', 'preparacao': '', 'passos': '', 'perguntas': ''};

Map<String, List<Map<String, dynamic>>> base() => {
  'membros': [{'id': 'm1', 'nome': 'Pessoa fictícia'}],
  'casaisContatos': [{
    'id': 'c1', 'membrosIds': ['m1'], 'casalChave': 'a' * 64,
    'tipo': 'parabenizado', 'ocorrencia': '2026-11-18', 'realizadoEm': '2026-11-18',
    'registradoEm': data, 'usuarioId': 'lider', 'usuarioNome': 'Líder',
  }],
  'casaisMateriais': [{'id': 'mat1', ...conteudo(), 'versao': 2, 'arquivado': true, ...autoria}],
  'encontros': [{'id': 'e1', 'titulo': 'Encontro fictício', 'tipo': 'jantar',
    'inicio': data, 'fim': '2026-11-18T12:00:00.000', 'local': '', 'descricao': '',
    'estado': 'aberto', 'capacidade': 10, ...autoria,
    'roteiro': [{'materialId': 'mat1', 'versao': 1, 'conteudoSnapshot': conteudo()}],
  }],
  'inscricoes': [{'id': 'i1', 'encontroId': 'e1', 'responsavelMembroId': 'm1',
    'participantes': [
      {'id': 'p1', 'membroId': 'm1', 'crianca': false, 'confirmado': true,
        'presenteEm': data, 'presencaPor': 'lider'},
      {'id': 'p2', 'nomeAcompanhante': 'Convidado fictício', 'crianca': true, 'confirmado': false},
    ], 'estado': 'confirmada', ...autoria,
  }],
  'tarefasEncontros': [{'id': 't1', 'encontroId': 'e1', 'descricao': 'Preparar sala',
    'responsavelUsuarioId': 'conta-fora-do-backup', 'prazo': '2026-11-18', 'estado': 'pendente', ...autoria}],
  'casaisEnvios': [{'id': 'env1', 'finalidade': 'parabens', 'membrosIds': ['m1'],
    'casalChave': 'a' * 64, 'ocorrencia': '2026-11-18', 'destinatarioHash': 'b' * 64,
    'destinatarioMembroId': 'm1', 'estado': 'incerto', 'registradoEm': data,
    'finalizadoEm': data, 'usuarioId': 'lider', 'usuarioNome': 'Líder'}],
};

List<int> zip(Map<String, List<Map<String, dynamic>>> dados) {
  final arquivo = Archive();
  for (final e in dados.entries) {
    arquivo.add(ArchiveFile.string('data/${e.key}.json', jsonEncode(e.value)));
  }
  return ZipEncoder().encodeBytes(arquivo);
}

void main() {
  late Directory tmp;
  late Store store;
  late Backup backup;
  late Restauracao restauracao;
  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('casais_backup_');
    store = Store(tmp.path);
    await store.carregar();
    backup = Backup(pastaDados: tmp.path);
    restauracao = Restauracao(store: store, backup: backup, pastaDados: tmp.path,
        pastaCartazes: p.join(tmp.path, 'cartazes'));
  });
  tearDown(() async {
    await store.fechar();
    await tmp.delete(recursive: true);
  });

  test('base antiga abre coleções vazias sem alterar membros', () async {
    final membro = jsonEncode(base()['membros']);
    await File(p.join(tmp.path, 'membros.json')).writeAsString(membro);
    await store.carregar();
    for (final nome in colecoesCasais) {
      expect(store.listar(nome), isEmpty, reason: nome);
    }
    expect(await File(p.join(tmp.path, 'membros.json')).readAsString(), membro);
  });

  test('ZIP inclui coleções e restaura sem perdas, inclusive snapshot antigo', () async {
    final dados = base();
    for (final e in dados.entries) {
      await store.substituir(e.key, e.value);
    }
    final bytes = await backup.gerarZip();
    final arquivo = ZipDecoder().decodeBytes(bytes);
    for (final nome in colecoesCasais) {
      expect(arquivo.findFile('data/$nome.json'), isNotNull, reason: nome);
      await store.substituir(nome, []);
    }
    await restauracao.restaurar(bytes);
    for (final e in dados.entries) {
      expect(store.listar(e.key), e.value, reason: e.key);
    }
  });

  test('recibo não enviado antes do SMTP pode ser restaurado', () async {
    final dados = base();
    dados['casaisEnvios']!.single['estado'] = 'nao_enviado';
    await restauracao.restaurar(zip(dados));
    expect(store.listar('casaisEnvios').single['estado'], 'nao_enviado');
  });

  test('restaurar snapshot antigo com membros não preserva vínculos novos órfãos', () async {
    for (final e in base().entries) {
      await store.substituir(e.key, e.value);
    }
    await restauracao.restaurar(zip({'membros': [{'id': 'outro', 'nome': 'Outra pessoa fictícia'}]}));
    for (final nome in colecoesCasais) {
      expect(store.listar(nome), isEmpty, reason: nome);
    }
    expect(store.listar('membros').single['id'], 'outro');
  });

  test('aceita contratos gerados pelos domínios, inclusive reversão de presença', () async {
    final lider = Conta(id: 'lider', nome: 'Líder', login: 'lider', perfil: Perfil.liderCasais);
    final encontros = Encontros(store, agora: () => DateTime.parse(data), responsavelValido: (_) => true);
    final materiais = CasaisMateriais(store, agora: () => DateTime.parse(data));
    await store.substituir('membros', base()['membros']!);
    final encontro = await encontros.criarEncontro({'titulo': 'Encontro', 'tipo': 'jantar',
      'inicio': data, 'fim': '2026-11-18T12:00:00.000', 'estado': 'aberto'}, conta: lider);
    final id = encontro['id'] as String;
    final material = await materiais.criarMaterial(conteudo(), conta: lider);
    await materiais.associarAoEncontro(id, {'materiaisIds': [material['id']]}, conta: lider);
    await materiais.editarMaterial(material['id'], {'titulo': 'Revisado'}, conta: lider);
    await materiais.arquivarMaterial(material['id'], conta: lider);
    final inscricao = await encontros.inscrever(id, {'responsavelMembroId': 'm1',
      'participantes': [{'membroId': 'm1', 'confirmado': true}]}, conta: lider);
    final participanteId = inscricao['participantes'][0]['id'] as String;
    await encontros.registrarPresenca(inscricao['id'], participanteId, {'presente': true}, conta: lider);
    await encontros.registrarPresenca(inscricao['id'], participanteId, {'presente': false}, conta: lider);
    await encontros.criarTarefa(id, {'descricao': 'Preparar'}, conta: lider);
    final antes = {for (final nome in colecoesCasais) nome: jsonEncode(store.listar(nome))};
    final bytes = await backup.gerarZip();
    for (final nome in colecoesCasais) {
      await store.substituir(nome, []);
    }
    await restauracao.restaurar(bytes);
    for (final e in antes.entries) {
      expect(jsonEncode(store.listar(e.key)), e.value, reason: e.key);
    }
  });

  for (final caso in <String, void Function(Map<String, List<Map<String, dynamic>>>)>{
    'lotação excedida no conjunto de inscrições': (b) => b['encontros']!.single['capacidade'] = 1,
    'membro repetido entre inscrições ativas': (b) => b['inscricoes']!.add({
      ...b['inscricoes']!.single, 'id': 'i2', 'participantes': [
        {'id': 'p3', 'membroId': 'm1', 'confirmado': true, 'crianca': false}]}),
    'encontro com estado inválido': (b) => b['encontros']!.single['estado'] = 'publicado',
    'encontro com intervalo invertido': (b) => b['encontros']!.single['fim'] = '2026-11-17T10:00:00',
    'capacidade não inteira': (b) => b['encontros']!.single['capacidade'] = '10',
    'inscrição órfã': (b) => b['inscricoes']!.single['encontroId'] = 'ausente',
    'responsável inexistente': (b) => b['inscricoes']!.single['responsavelMembroId'] = 'ausente',
    'participante inexistente': (b) => (b['inscricoes']!.single['participantes'] as List).first['membroId'] = 'ausente',
    'presença sem autoria': (b) => (b['inscricoes']!.single['participantes'] as List).first.remove('presencaPor'),
    'inscrição com estado inválido': (b) => b['inscricoes']!.single['estado'] = 'pendente',
    'participante com tipo inválido': (b) => (b['inscricoes']!.single['participantes'] as List).first['crianca'] = 'sim',
    'tarefa órfã': (b) => b['tarefasEncontros']!.single['encontroId'] = 'ausente',
    'tarefa com estado inválido': (b) => b['tarefasEncontros']!.single['estado'] = 'aberta',
    'material com duração inválida': (b) => b['casaisMateriais']!.single['duracaoMinutos'] = 481,
    'material com tipo inválido': (b) => b['casaisMateriais']!.single['arquivado'] = 'sim',
    'material com versão inválida': (b) => b['casaisMateriais']!.single['versao'] = 0,
    'snapshot inválido': (b) => b['encontros']!.single['roteiro'][0]['conteudoSnapshot']['publico'] = 'todos',
    'material do roteiro inexistente': (b) => b['encontros']!.single['roteiro'][0]['materialId'] = 'ausente',
    'snapshot com versão futura': (b) => b['encontros']!.single['roteiro'][0]['versao'] = 3,
    'IDs duplicados': (b) => b['casaisMateriais']!.add({...b['casaisMateriais']!.single}),
    'envio com estado inválido': (b) => b['casaisEnvios']!.single['estado'] = 'enviado',
    'envio com hash inválido': (b) => b['casaisEnvios']!.single['destinatarioHash'] = 'email@exemplo.com',
    'envio com destinatário inexistente': (b) => b['casaisEnvios']!.single['destinatarioMembroId'] = 'ausente',
    'envio com finalidade inválida': (b) => b['casaisEnvios']!.single['finalidade'] = 'newsletter',
    'envio com segredo SMTP': (b) => b['casaisEnvios']!.single['senha'] = 'segredo',
    'envio com data inválida': (b) => b['casaisEnvios']!.single['registradoEm'] = 'ontem',
    'envio sem autoria': (b) => b['casaisEnvios']!.single.remove('usuarioNome'),
    'envio com vínculo inválido': (b) => b['casaisEnvios']!.single['membrosIds'] = ['ausente'],
  }.entries) {
    test('rejeita ${caso.key} antes de gravar', () async {
      final dados = base();
      caso.value(dados);
      await expectLater(restauracao.restaurar(zip(dados)), throwsFormatException);
      expect(store.listar('membros'), isEmpty);
      expect(await backup.listar(), isEmpty);
    });
  }

  for (final caso in <String, void Function(Map<String, dynamic>)>{
    'tipo desconhecido': (d) => d['tipo'] = 'aconselhamento',
    'observações íntimas': (d) => d['observacao'] = 'não deve persistir',
    'membro inexistente': (d) => d['membrosIds'] = ['inexistente'],
    'data inválida': (d) => d['realizadoEm'] = '2026-02-30',
    'autoria inválida': (d) => d['usuarioId'] = 42,
    'anulação sem autor': (d) => d['anuladoEm'] = data,
  }.entries) {
    test('rejeita ${caso.key} antes de substituir qualquer arquivo', () async {
      await store.salvar('membros', {'id': 'preservado', 'nome': 'Original'});
      final antes = await File(p.join(tmp.path, 'membros.json')).readAsBytes();
      final dados = base();
      caso.value(dados['casaisContatos']!.single);
      await expectLater(restauracao.restaurar(zip(dados)), throwsFormatException);
      expect(await File(p.join(tmp.path, 'membros.json')).readAsBytes(), antes);
      expect(store.buscar('membros', 'preservado'), isNotNull);
      expect(await backup.listar(), isEmpty);
    });
  }
}
