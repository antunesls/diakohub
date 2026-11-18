import 'package:diako_core/diako_core.dart';
import 'package:test/test.dart';

void main() {
  Membro casal(String id, String nome, String data, {String externo = 'Parceiro', String? conjugeId}) => Membro.fromJson({
    'id': id, 'nome': nome, 'status': 'membro', 'consentimentoEm': '2020-01-01', 'dataCasamento': data,
    if (conjugeId != null) 'conjugeId': conjugeId,
    if (conjugeId == null) 'conjugeNome': externo,
    'casamentoAutorizado': true, 'casamentoConsentimento': {'em': '2026-01-01', 'por': 'Secretaria'},
  });

  test('modelo preserva casamento e mantém cadastros antigos sem autorização', () {
    final m = casal('a', 'Ana', '2016-11-18');
    final copia = Membro.fromJson(m.toJson());
    expect(copia.dataCasamento, '2016-11-18');
    expect(copia.conjugeNome, 'Parceiro');
    expect(copia.casamentoConsentimento, m.casamentoConsentimento);
    final antigo = Membro.fromJson({'id': 'x', 'nome': 'Antigo'});
    expect(antigo.casamentoAutorizado, isFalse);
    expect(antigo.toJson().containsKey('dataCasamento'), isFalse);
  });

  test('casal vinculado aparece uma vez, em ordem de data e sem modificar membros', () {
    final a = casal('a', 'Ana', '2016-11-18', conjugeId: 'b');
    final b = casal('b', 'Bruno', '2016-11-18', conjugeId: 'a');
    final c = casal('c', 'Carla', '2025-11-15');
    final r = recadoCasamentos([a, b, c], DateTime(2026, 11, 18))!;
    expect(r.texto.split('\n'), ['Carla e Parceiro (15/11) · 1 ano', 'Ana e Bruno (18/11) · 10 anos']);
    expect(r.categoria, Categoria.aniversario);
    expect(r.auto, isTrue);
    expect(a.conjugeId, 'b');
  });

  test('semana que cruza o ano calcula a idade na data da comemoração', () {
    final r = recadoCasamentos([casal('a', 'Ana', '2010-12-31'), casal('b', 'Bruna', '2020-01-01')], DateTime(2026, 12, 31))!;
    expect(r.texto, contains('(31/12) · 16 anos'));
    expect(r.texto, contains('(01/01) · 7 anos'));
  });

  test('29 de fevereiro segue aniversário de nascimento nos anos não bissextos', () {
    expect(recadoCasamentos([casal('a', 'Ana', '2020-02-29')], DateTime(2025, 2, 28))!.texto, contains('(28/02) · 5 anos'));
    expect(recadoCasamentos([casal('a', 'Ana', '2020-02-29')], DateTime(2024, 2, 29))!.texto, contains('(29/02) · 4 anos'));
  });

  test('vínculos inconsistentes, autorização sem prova e união encerrada não são divulgados', () {
    final a = casal('a', 'Ana', '2016-11-18', conjugeId: 'b');
    final b = casal('b', 'Bruno', '2017-11-18', conjugeId: 'a');
    final c = casal('c', 'Carla', '2010-11-18')..casamentoConsentimento = null;
    final d = casal('d', 'Dora', '2010-11-18')..estadoCivil = 'Viúvo(a)';
    final e = casal('e', 'Elisa', '2010-11-18')..estadoCivil = 'Separado(a)';
    expect(recadoCasamentos([a, b, c, d, e], DateTime(2026, 11, 18)), isNull);
  });

  test('não cria recado vazio nem comemora zero anos', () {
    expect(recadoCasamentos([], DateTime(2026, 11, 18)), isNull);
    expect(recadoCasamentos([casal('a', 'Ana', '2026-11-18')], DateTime(2026, 11, 18)), isNull);
  });
}
