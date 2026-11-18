import 'dart:io';

import 'package:diako_server/config.dart';
import 'package:diako_server/configuracoes.dart';
import 'package:diako_server/email_devocionais.dart';
import 'package:test/test.dart';

void main() {
  test('conteúdo individual escapa HTML e contém texto integral e cancelamento', () {
    final e = montarEmailDevocional(
      {'titulo': '<b>Título</b>', 'autorNome': 'Ana', 'data': '2026-11-18',
       'referencia': 'Ec 4:9', 'texto': '<script>x</script>', 'aplicacao': 'Ação', 'oracao': 'Amém'},
      destinatario: 'ana@exemplo.test', igreja: 'Igreja & família',
      urlPublica: 'https://igreja.test/devocional?id=1',
      urlCancelar: 'https://igreja.test/devocional#cancelar=segredo');
    expect(e.destinatario, 'ana@exemplo.test');
    expect(e.html, contains('&lt;script&gt;'));
    expect(e.html, isNot(contains('<script>')));
    expect(e.html, contains('Igreja &amp; família'));
    for (final texto in ['Ec 4:9', 'Ação', 'Amém', '#cancelar=segredo']) {
      expect(e.texto, contains(texto)); expect(e.html, contains(texto));
    }
    expect(e.assunto, isNot(contains('\n')));
  });
  test('confirmação explicita prazo e não inclui outros destinatários', () {
    final e = montarEmailConfirmacao(destinatario: 'a@exemplo.test', igreja: 'Igreja',
        urlConfirmar: 'https://igreja.test/devocional#confirmar=TOKEN');
    expect(e.texto, contains('24 horas'));
    expect(e.texto, contains('#confirmar=TOKEN'));
    expect(e.html, contains('#confirmar=TOKEN'));
  });
  test('SMTP ausente produz falha clara sem abrir conexão', () async {
    final tmp = await Directory(r'C:\Users\antunesls\AppData\Local\Temp\opencode').createTemp('email_devocionais_');
    try {
      final config = Config.lerJson('{"senhaAdmin":"senha-teste"}', pastaBase: tmp.path);
      final cfg = await Configuracoes.carregar(config, urlDetectada: 'https://igreja.test');
      await expectLater(enviarEmailDevocional(cfg,
          const EmailDevocional(destinatario: 'a@exemplo.test', assunto: 'Teste', texto: 'Teste', html: '<p>Teste</p>')),
          throwsA(isA<FalhaEmailDevocional>()));
    } finally { await tmp.delete(recursive: true); }
  });
}
