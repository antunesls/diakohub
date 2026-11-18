import 'dart:convert';

import 'package:mailer/mailer.dart';
import 'package:mailer/smtp_server.dart';

import 'configuracoes.dart';

class EmailDevocional {
  const EmailDevocional({required this.destinatario, required this.assunto, required this.texto, required this.html});
  final String destinatario, assunto, texto, html;
}

/// Só use quando há certeza de rejeição antes da aceitação pelo SMTP.
class FalhaEmailDevocional implements Exception {
  const FalhaEmailDevocional(this.mensagem);
  final String mensagem;
}

EmailDevocional montarEmailDevocional(Map<String, dynamic> devocional,
    {required String destinatario, required String igreja, required String urlPublica, String? urlCancelar}) {
  final partes = [
    '${devocional['titulo']}', igreja,
    '${devocional['autorNome']} · ${devocional['data']}',
    '${devocional['referencia']}', '${devocional['texto']}',
    'Aplicação\n${devocional['aplicacao']}', 'Oração\n${devocional['oracao']}',
    'Leia e compartilhe: $urlPublica',
    if (urlCancelar != null) 'Cancelar assinatura: $urlCancelar',
    if (urlCancelar == null) 'Envio avulso selecionado pela liderança. Isso não cria uma assinatura.',
  ];
  return EmailDevocional(destinatario: destinatario,
      assunto: 'Devocional: ${devocional['titulo']}'.replaceAll(RegExp(r'[\r\n]'), ' '),
      texto: partes.join('\n\n'), html: _html(partes, igreja: igreja,
          links: {'Ler devocional': urlPublica, if (urlCancelar != null) 'Cancelar assinatura': urlCancelar}));
}

EmailDevocional montarEmailConfirmacao({required String destinatario, required String igreja, required String urlConfirmar}) {
  final partes = [igreja, 'Confirme sua assinatura de devocionais',
    'Você solicitou receber devocionais por e-mail. Confirme explicitamente pelo link abaixo em até 24 horas.',
    urlConfirmar, 'Se não foi você, ignore esta mensagem. Nenhuma preferência será alterada sem confirmação.'];
  return EmailDevocional(destinatario: destinatario, assunto: 'Confirme sua assinatura de devocionais',
      texto: partes.join('\n\n'), html: _html(partes, igreja: igreja, links: {'Confirmar assinatura': urlConfirmar}));
}

String _html(List<String> partes, {required String igreja, required Map<String, String> links}) {
  const esc = HtmlEscape(HtmlEscapeMode(escapeLtGt: true, escapeQuot: true, escapeApos: true));
  String e(String s) => esc.convert(s);
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${e(igreja)}</title></head>'
      '<body style="background:#f7f5f0;color:#2e2d2a;font-family:Arial,sans-serif;padding:24px">'
      '<main style="max-width:600px;margin:auto;background:white;padding:24px;border-radius:16px">'
      '${partes.map((p) => '<p style="white-space:pre-wrap;line-height:1.6">${e(p)}</p>').join()}'
      '${links.entries.map((l) => '<p><a href="${e(l.value)}" style="color:#1f5f5b">${e(l.key)}</a></p>').join()}'
      '</main></body></html>';
}

Future<void> enviarEmailDevocional(Configuracoes cfg, EmailDevocional email) async {
  if (cfg.smtpHost.isEmpty || cfg.smtpRemetente.isEmpty ||
      (cfg.smtpUsuario.isNotEmpty && cfg.smtpSenha.isEmpty)) {
    throw const FalhaEmailDevocional('Configure o servidor SMTP antes do envio.');
  }
  if (!RegExp(r'^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$').hasMatch(email.destinatario)) {
    throw const FalhaEmailDevocional('Destinatário inválido.');
  }
  await send(Message()
    ..from = Address(cfg.smtpRemetente, cfg.nomeIgreja)
    ..recipients.add(email.destinatario)
    ..subject = email.assunto.replaceAll(RegExp(r'[\r\n]'), ' ')
    ..text = email.texto
    ..html = email.html,
    SmtpServer(cfg.smtpHost, port: cfg.smtpPorta,
      username: cfg.smtpUsuario.isEmpty ? null : cfg.smtpUsuario,
      password: cfg.smtpUsuario.isEmpty ? null : cfg.smtpSenha,
      ssl: cfg.smtpSsl, allowInsecure: false));
}
