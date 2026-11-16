import 'dart:io';

import 'package:diako_server/ata_pdf.dart';
import 'package:diako_server/atas.dart';
import 'package:diako_server/store.dart';
import 'package:test/test.dart';

void main() {
  late Directory tmp;
  late Store store;
  late Atas atas;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('diako_atas');
    store = Store(tmp.path);
    await store.carregar();
    atas = Atas(store, agora: () => DateTime(2026, 11, 20, 10));
    await atas.ministerios.garantirPadroes();
    await atas.ministerios.criar({'nome': 'Louvor'});
  });
  tearDown(() async { await store.fechar(); await tmp.delete(recursive: true); });

  Map<String, dynamic> conselho({String data = '2026-11-10', bool sigilosa = false}) => {
        'tipo': 'conselho', 'data': data, 'horaInicio': '19:30', 'local': 'Sala do conselho',
        'presidente': 'Pr. Paulo', 'secretario': 'Ana',
        'presentes': [{'membroId': 'm1', 'nome': 'Pr. Paulo'}, {'nome': 'Ana'}],
        'ausentes': [{'nome': 'João', 'justificativa': 'Viagem'}],
        'pauta': [{'titulo': 'Reforma do telhado', 'discussao': 'Três orçamentos.\nO mais barato não inclui calhas.',
          'deliberacao': 'Aprovado o orçamento B.'}],
        'encaminhamentos': [{'descricao': 'Contratar a empresa B', 'responsavel': 'Ana', 'prazo': '2026-11-30'}],
        'sigilosa': sigilosa,
      };

  test('valida campos obrigatórios e formatos', () async {
    expect(() => atas.criar({'tipo': 'x', 'data': '2026-11-10'}, por: 'Ana', acesso: AcessoAtas.total), throwsFormatException);
    expect(() => atas.criar({'tipo': 'conselho', 'data': '10/11/2026'}, por: 'Ana', acesso: AcessoAtas.total), throwsFormatException);
    expect(() => atas.criar({'tipo': 'conselho', 'data': '2026-11-10', 'horaInicio': '25:00'}, por: 'Ana', acesso: AcessoAtas.total),
        throwsFormatException);
    // Reunião operacional precisa de título; formal não (o número identifica).
    expect(() => atas.criar({'tipo': 'ministerio', 'data': '2026-11-10'}, por: 'Ana', acesso: AcessoAtas.total), throwsFormatException);
    expect(() => atas.criar({...conselho(), 'pauta': [{'titulo': ''}]}, por: 'Ana', acesso: AcessoAtas.total), throwsFormatException);
    final ata = await atas.criar(conselho(), por: 'Ana', acesso: AcessoAtas.total);
    expect(ata['status'], 'rascunho');
    expect(ata['numero'], isNull);
    expect((ata['encaminhamentos'] as List).single['id'], isNotEmpty);
  });

  test('numeração por tipo e ano, atribuída ao finalizar', () async {
    final a = await atas.criar(conselho(), por: 'Ana', acesso: AcessoAtas.total);
    final b = await atas.criar(conselho(data: '2026-11-17'), por: 'Ana', acesso: AcessoAtas.total);
    final c = await atas.criar({...conselho(data: '2027-01-12')}, por: 'Ana', acesso: AcessoAtas.total);
    final d = await atas.criar({...conselho(), 'tipo': 'diretoria'}, por: 'Ana', acesso: AcessoAtas.total);
    final op = await atas.criar({'tipo': 'ministerio', 'ministerio': 'Louvor', 'titulo': 'Planejamento', 'data': '2026-11-10'},
        por: 'Ana', acesso: AcessoAtas.total);
    // Finaliza fora de ordem: a numeração segue a ordem de finalização.
    expect((await atas.finalizar(b['id'] as String, por: 'Ana', acesso: AcessoAtas.total))['numero'], 1);
    expect((await atas.finalizar(a['id'] as String, por: 'Ana', acesso: AcessoAtas.total))['numero'], 2);
    final c2 = await atas.finalizar(c['id'] as String, por: 'Ana', acesso: AcessoAtas.total);
    expect((c2['numero'], c2['ano']), (1, 2027));
    expect((await atas.finalizar(d['id'] as String, por: 'Ana', acesso: AcessoAtas.total))['numero'], 1);
    expect((await atas.finalizar(op['id'] as String, por: 'Ana', acesso: AcessoAtas.total))['numero'], isNull);
    expect(Atas.titulo(c2), 'Ata nº 1/2027 — Conselho');
    expect(() => atas.finalizar(a['id'] as String, por: 'Ana', acesso: AcessoAtas.total), throwsStateError);
    // Numerada não muda de tipo nem pode ser excluída, mesmo reaberta.
    await atas.reabrir(a['id'] as String, por: 'Ana', acesso: AcessoAtas.total);
    expect(() => atas.editar(a['id'] as String, {'tipo': 'diretoria'}, por: 'Ana', acesso: AcessoAtas.total), throwsFormatException);
    expect(() => atas.excluir(a['id'] as String, acesso: AcessoAtas.total), throwsStateError);
    final refinalizada = await atas.finalizar(a['id'] as String, por: 'Ana', acesso: AcessoAtas.total);
    expect(refinalizada['numero'], 2);
  });

  test('aprovada fica travada; correção entra como retificação', () async {
    final a = await atas.criar(conselho(), por: 'Ana', acesso: AcessoAtas.total);
    final id = a['id'] as String;
    expect(() => atas.aprovar(id, {'data': '2026-11-17'}, por: 'Ana', acesso: AcessoAtas.total), throwsStateError);
    await atas.finalizar(id, por: 'Ana', acesso: AcessoAtas.total);
    expect(() => atas.aprovar(id, {'data': '2026-11-01'}, por: 'Ana', acesso: AcessoAtas.total), throwsFormatException);
    final aprovada = await atas.aprovar(id, {'data': '2026-11-17'}, por: 'Pr. Paulo', acesso: AcessoAtas.total);
    expect(aprovada['status'], 'aprovada');
    expect(() => atas.editar(id, {'local': 'Outro'}, por: 'Ana', acesso: AcessoAtas.total), throwsStateError);
    expect(() => atas.reabrir(id, por: 'Ana', acesso: AcessoAtas.total), throwsStateError);
    final retificada = await atas.retificar(id, {'texto': 'Onde se lê "orçamento B", leia-se "orçamento C".'},
        por: 'Ana', acesso: AcessoAtas.total);
    expect(retificada['retificacoes'], hasLength(1));
    expect((retificada['pauta'] as List).single['deliberacao'], 'Aprovado o orçamento B.');
    // Encaminhamento continua sendo acompanhado depois da aprovação.
    final eid = (retificada['encaminhamentos'] as List).single['id'] as String;
    final feito = await atas.marcarEncaminhamento(id, eid, {'concluido': true}, por: 'Ana', acesso: AcessoAtas.total);
    expect((feito['encaminhamentos'] as List).single['concluidoEm'], '2026-11-20');
    expect(atas.pendentes(acesso: AcessoAtas.total), isEmpty);
  });

  test('operacional não passa por aprovação; rascunho pode ser excluído', () async {
    final op = await atas.criar({'tipo': 'outra', 'titulo': 'Mutirão', 'data': '2026-11-10'}, por: 'Ana', acesso: AcessoAtas.total);
    await atas.finalizar(op['id'] as String, por: 'Ana', acesso: AcessoAtas.total);
    expect(() => atas.aprovar(op['id'] as String, {'data': '2026-11-20'}, por: 'Ana', acesso: AcessoAtas.total), throwsStateError);
    final rascunho = await atas.criar({'tipo': 'outra', 'titulo': 'Teste', 'data': '2026-11-10'}, por: 'Ana', acesso: AcessoAtas.total);
    await atas.excluir(rascunho['id'] as String, acesso: AcessoAtas.total);
    expect(store.buscar('atas', rascunho['id'] as String), isNull);
  });

  test('sigilosa some para quem não tem a permissão', () async {
    expect(() => atas.criar(conselho(sigilosa: true), por: 'Ana', acesso: const AcessoAtas(todos: true)), throwsFormatException);
    final s = await atas.criar(conselho(sigilosa: true), por: 'Pr. Paulo', acesso: AcessoAtas.total);
    await atas.finalizar(s['id'] as String, por: 'Pr. Paulo', acesso: AcessoAtas.total);
    await atas.criar(conselho(), por: 'Ana', acesso: const AcessoAtas(todos: true));
    expect(atas.listar(acesso: const AcessoAtas(todos: true)), hasLength(1));
    expect(atas.listar(acesso: AcessoAtas.total), hasLength(2));
    expect(atas.ata(s['id'] as String, acesso: const AcessoAtas(todos: true)), isNull);
    expect(atas.pendentes(acesso: const AcessoAtas(todos: true)), isEmpty);
    expect(atas.pendentes(acesso: AcessoAtas.total), hasLength(1));
    expect(() => atas.editar(s['id'] as String, {'local': 'x'}, por: 'Ana', acesso: const AcessoAtas(todos: true)), throwsArgumentError);
  });

  test('PDF da ata é gerado com acentos e texto longo', () async {
    final a = await atas.criar({...conselho(), 'pauta': [
      {'titulo': 'Relatório “anual” — tesouraria', 'discussao': List.filled(500, 'Linha de discussão com acentuação.').join('\n')},
    ]}, por: 'Ana', acesso: AcessoAtas.total);
    final pdf = await gerarAtaPdf(a, igreja: 'Igreja Teste');
    expect(String.fromCharCodes(pdf.take(5)), '%PDF-');
  });
}
