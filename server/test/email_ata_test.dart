import 'package:diako_server/email_mensagens.dart';
import 'package:test/test.dart';

void main() {
  EmailAta ata({String mensagem = ''}) => EmailAta(
        destinatarios: ['a@x.org'],
        titulo: 'Ata nº 3/2026 — Conselho',
        dataReuniao: '10/11/2026',
        situacao: 'aguardando aprovação',
        pdf: const [],
        nomePdf: 'ata.pdf',
        mensagem: mensagem,
        remetente: 'Ana <secretaria>',
      );

  test('segue o padrão do aviso de cadastro: logo inline, prévia, modo claro e dados em tabela', () {
    final html = htmlEmailAta(ata(mensagem: 'Para conferência.\nAbraço'), igreja: 'Igreja & Cia');
    expect(html, contains('src="cid:logo@diakohub"'));
    expect(html, contains('name="color-scheme" content="light"'));
    expect(html, contains('display:none;max-height:0'));
    expect(html, contains('Data da reunião'));
    expect(html, contains('10/11/2026'));
    expect(html, contains('Para conferência.'));
    expect(html, contains('Igreja &amp; Cia'));
    expect(html, contains('Ana &lt;secretaria&gt;'));
    expect(html, isNot(contains('<secretaria>')));
  });

  test('sem logo usa o nome da igreja; sem recado não mostra a caixa', () {
    final html = htmlEmailAta(ata(), igreja: 'Igreja', comLogo: false);
    expect(html, isNot(contains('cid:')));
    expect(html, isNot(contains('white-space:pre-line')));
    final texto = textoEmailAta(ata(), igreja: 'Igreja');
    expect(texto, contains('PDF anexo'));
  });
}
