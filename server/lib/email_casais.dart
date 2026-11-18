import 'dart:convert';

import 'configuracoes.dart';
import 'email_devocionais.dart';

class EmailCasais {
  const EmailCasais(
      {required this.destinatario,
      required this.assunto,
      required this.texto,
      required this.html});
  final String destinatario, assunto, texto, html;
}

EmailCasais montarEmailCasais(Map<String, dynamic> casal,
    {required String destinatario, required String igreja, String? texto}) {
  final anos = casal['anos'];
  final mensagem = texto ??
      '${casal['nome']} e ${casal['conjugeNome']}, parabéns pelos '
          '$anos ${anos == 1 ? 'ano' : 'anos'} de casamento em '
          '${(casal['dataAniversario'] as String).split('-').reversed.join('/')}!\n\n'
          'Que Deus abençoe a união e a família de vocês.\n\n$igreja · Casais e Família';
  const escapar = HtmlEscape();
  return EmailCasais(
      destinatario: destinatario,
      assunto: 'Feliz aniversário de casamento!',
      texto: mensagem,
      html: '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body>'
          '<h1>Feliz aniversário de casamento!</h1><p>${escapar.convert(mensagem).replaceAll('\n', '<br>')}</p>'
          '<footer>${escapar.convert(igreja)} · Mensagem direta de Casais e Família</footer></body></html>');
}

/// Reutiliza apenas o transporte e a configuração SMTP, nunca assinaturas ou conteúdo devocional.
Future<void> enviarEmailCasais(Configuracoes cfg, EmailCasais email) =>
    enviarEmailDevocional(
        cfg,
        EmailDevocional(
            destinatario: email.destinatario,
            assunto: email.assunto,
            texto: email.texto,
            html: email.html));
