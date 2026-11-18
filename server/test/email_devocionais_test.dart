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
  test('segue a identidade dos e-mails do DiakoHub: logo inline, tema, data por extenso, botão e rodapé', () {
    final e = montarEmailDevocional(
      {'titulo': 'Dois são melhores', 'autorNome': 'Pr. Paulo', 'data': '2026-11-18', 'tema': 'casais',
       'referencia': 'Eclesiastes 4:9', 'texto': 'Primeiro parágrafo.\nCom quebra.\n\nSegundo parágrafo.',
       'aplicacao': 'Conversem hoje.', 'oracao': 'Senhor, une nossa casa.'},
      destinatario: 'ana@exemplo.test', igreja: 'Igreja Diakonia',
      urlPublica: 'https://igreja.test/devocional?id=1', urlCancelar: 'https://igreja.test/devocional#cancelar=x');
    // Mesmas cores, fontes e moldura do aviso de cadastro e do envio de ata.
    for (final marca in ['#f7f5f0', '#1f5f5b', '#dceae7', 'Fraunces', 'Inter', 'border-radius:20px', 'border-radius:27px',
        'Enviado pelo DiakoHub · Igreja Diakonia']) {
      expect(e.html, contains(marca));
    }
    expect(e.html, contains('src="cid:logo@diakohub"'));
    expect(e.htmlSemLogo, isNot(contains('cid:')));
    expect(e.htmlSemLogo, contains('Igreja Diakonia'));
    expect(e.html, contains('Devocional · Casais'));
    expect(e.html, contains('Por Pr. Paulo · 18 de novembro de 2026'));
    expect(e.html, contains('Primeiro parágrafo.<br>Com quebra.</p>'));
    expect(e.html, contains('>Ler e compartilhar</a>'));
    expect(e.html, contains('>Cancelar assinatura</a>'));
    expect(e.html, contains('display:none')); // prévia na caixa de entrada
    expect(e.texto, contains('18 de novembro de 2026'));

    final avulso = montarEmailDevocional({'titulo': 'T', 'data': '2026-11-18', 'texto': 'x'},
        destinatario: 'a@exemplo.test', igreja: 'Igreja', urlPublica: 'https://igreja.test/d');
    expect(avulso.html, contains('não cria uma assinatura'));
    expect(avulso.html, isNot(contains('Cancelar assinatura')));
    expect(avulso.html, isNot(contains('Aplicação')));
  });

  test('confirmação explicita prazo e não inclui outros destinatários', () {
    final e = montarEmailConfirmacao(destinatario: 'a@exemplo.test', igreja: 'Igreja',
        urlConfirmar: 'https://igreja.test/devocional#confirmar=TOKEN');
    expect(e.texto, contains('24 horas'));
    expect(e.texto, contains('#confirmar=TOKEN'));
    expect(e.html, contains('#confirmar=TOKEN'));
  });
  test('SMTP ausente produz falha clara sem abrir conexão', () async {
    final tmp = await Directory.systemTemp.createTemp('email_devocionais_');
    try {
      final config = Config.lerJson('{"senhaAdmin":"senha-teste"}', pastaBase: tmp.path);
      final cfg = await Configuracoes.carregar(config, urlDetectada: 'https://igreja.test');
      await expectLater(enviarEmailDevocional(cfg,
          const EmailDevocional(destinatario: 'a@exemplo.test', assunto: 'Teste', texto: 'Teste', html: '<p>Teste</p>')),
          throwsA(isA<FalhaEmailDevocional>()));
    } finally { await tmp.delete(recursive: true); }
  });
}
