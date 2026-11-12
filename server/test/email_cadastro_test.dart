import 'dart:io';

import 'package:diako_server/email_mensagens.dart';
import 'package:test/test.dart';

void main() {
  final resumo = ResumoCadastro.de({
    'nome': 'Ana "<script>" Souza',
    'whatsapp': '11988887777',
    'email': 'ana@teste.com',
    'cpf': '52998224725',
    'rua': 'Rua Secreta',
    'bairro': 'Centro',
    'cidade': 'Tupã',
    'estado': 'SP',
  }, recebidoEm: DateTime(2026, 11, 12, 9, 5), familiares: 2, menor: true);

  test('HTML do aviso escapa o que a pessoa digitou e não traz documentos', () {
    final html = htmlAvisoCadastro(resumo, igreja: 'Igreja & Cia', urlRevisar: 'https://x/painel?aba=membros');
    expect(html, isNot(contains('<script>')));
    expect(html, contains('&lt;script&gt;'));
    expect(html, contains('Igreja &amp; Cia'));
    expect(html, contains('(11) 98888-7777'));
    expect(html, contains('Centro, Tupã, SP'));
    expect(html, contains('12/11/2026 às 09:05'));
    expect(html, contains('Menor de 18 anos'));
    expect(html, contains('cid:logo@diakohub'));
    expect(html, contains('href="https://x/painel?aba=membros"'));
    expect(html, isNot(contains('52998224725')));
    expect(html, isNot(contains('Rua Secreta')));
  });

  test('sem logo cai para o nome da igreja; texto simples acompanha', () {
    final html = htmlAvisoCadastro(resumo, igreja: 'Igreja', urlRevisar: 'https://x', comLogo: false);
    expect(html, isNot(contains('cid:')));
    final texto = textoAvisoCadastro(resumo, igreja: 'Igreja', urlRevisar: 'https://x/painel');
    expect(texto, contains('WhatsApp: (11) 98888-7777'));
    expect(texto, contains('https://x/painel'));
    expect(texto, isNot(contains('52998224725')));
  });

  test('gera prévia para conferir o visual', () {
    final pasta = Platform.environment['PREVIA_EMAIL'];
    if (pasta == null) return;
    final html = htmlAvisoCadastro(resumo, igreja: 'Igreja Diakonia Tulipas', urlRevisar: 'https://x/painel?aba=membros')
        .replaceAll('cid:logo@diakohub', 'logo.png');
    File('$pasta/previa-email.html').writeAsStringSync(html);
  });
}
