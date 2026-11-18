import 'package:diako_server/email_casais.dart';
import 'package:test/test.dart';

void main() {
  test('mensagem individual contém nomes, data, singular e HTML escapado', () {
    final email = montarEmailCasais({
      'nome': '<Ana>',
      'conjugeNome': 'Bruno',
      'anos': 1,
      'dataAniversario': '2026-11-18'
    }, destinatario: 'ana@example.test', igreja: 'Igreja & Família');
    expect(email.texto, contains('<Ana> e Bruno'));
    expect(email.texto, contains('1 ano de casamento'));
    expect(email.texto, contains('18/11/2026'));
    expect(email.html, contains('&lt;Ana&gt;'));
    expect(email.html, isNot(contains('<Ana>')));
    expect(email.texto, isNot(contains('assinatura')));
  });
  test('texto editado substitui mensagem padrão sem virar HTML', () {
    final email = montarEmailCasais({},
        destinatario: 'a@example.test',
        igreja: 'Igreja',
        texto: '<script>Oi</script>');
    expect(email.texto, '<script>Oi</script>');
    expect(email.html, contains('&lt;script&gt;'));
  });
}
