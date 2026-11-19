import 'dart:convert';

import 'configuracoes.dart';
import 'email_devocionais.dart';

/// E-mail para quem se inscreveu pelo link público de um encontro.
class EmailInscricao {
  const EmailInscricao({required this.destinatario, required this.assunto, required this.texto, required this.html});
  final String destinatario, assunto, texto, html;
}

/// "2026-12-12T19:30" → "12/12/2026 às 19:30" (lê o texto, sem fuso).
String _quando(Object? iso) {
  if (iso is! String || iso.length < 10) return '';
  final data = iso.substring(0, 10).split('-').reversed.join('/');
  return iso.length >= 16 ? '$data às ${iso.substring(11, 16)}' : data;
}

/// [situacao]: "confirmada" (vaga garantida), "espera" (entrou na lista de espera) ou
/// "promovida" (saiu da espera). [linkCancelar] vai só quando houver token.
EmailInscricao montarEmailInscricao({
  required String destinatario,
  required String nome,
  required Map<String, dynamic> encontro,
  required int pessoas,
  required String situacao,
  required String igreja,
  String? linkCancelar,
}) {
  final titulo = encontro['titulo'] as String? ?? 'Encontro';
  final assunto = switch (situacao) {
    'espera' => 'Lista de espera: $titulo',
    'promovida' => 'Vaga confirmada: $titulo',
    _ => 'Inscrição confirmada: $titulo',
  };
  final abertura = switch (situacao) {
    'espera' => 'As vagas estão preenchidas, então sua inscrição entrou na lista de espera. '
        'Se abrir vaga, a equipe confirma e você recebe outro e-mail.',
    'promovida' => 'Abriu vaga e a sua inscrição saiu da lista de espera: está confirmada!',
    _ => 'Sua inscrição está confirmada.',
  };
  final local = (encontro['local'] as String? ?? '').trim();
  final linhas = [
    'Olá, $nome!',
    abertura,
    '$titulo\n${_quando(encontro['inicio'])}${local.isEmpty ? '' : '\n$local'}\n'
        '$pessoas ${pessoas == 1 ? 'pessoa' : 'pessoas'} nesta inscrição',
    if (linkCancelar != null) 'Se não puder ir, cancele por este link para liberar a vaga:\n$linkCancelar',
    if (linkCancelar == null && situacao == 'promovida')
      'Se não puder ir, use o link de cancelamento do e-mail da inscrição ou avise a equipe.',
    igreja,
  ];
  final texto = linhas.join('\n\n');
  const escapar = HtmlEscape();
  final html = StringBuffer('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body '
      'style="font-family:Arial,sans-serif;color:#1f2a2e;line-height:1.5;max-width:560px;margin:0 auto;padding:16px">');
  html.write('<h1 style="font-size:22px">${escapar.convert(assunto)}</h1>');
  html.write('<p>Olá, ${escapar.convert(nome)}!</p><p>${escapar.convert(abertura)}</p>');
  html.write('<p style="padding:12px 16px;border:1px solid #d9e2e0;border-radius:12px">'
      '<strong>${escapar.convert(titulo)}</strong><br>${escapar.convert(_quando(encontro['inicio']))}'
      '${local.isEmpty ? '' : '<br>${escapar.convert(local)}'}<br>'
      '$pessoas ${pessoas == 1 ? 'pessoa' : 'pessoas'} nesta inscrição</p>');
  if (linkCancelar != null) {
    html.write('<p>Se não puder ir, cancele para liberar a vaga: '
        '<a href="${escapar.convert(linkCancelar)}">cancelar minha inscrição</a>.</p>');
  } else if (situacao == 'promovida') {
    html.write('<p>Se não puder ir, use o link de cancelamento do e-mail da inscrição ou avise a equipe.</p>');
  }
  html.write('<p style="color:#5b6b70;font-size:13px">${escapar.convert(igreja)}</p></body></html>');
  return EmailInscricao(destinatario: destinatario, assunto: assunto, texto: texto, html: html.toString());
}

/// Usa só o transporte SMTP configurado na Administração.
Future<void> enviarEmailInscricao(Configuracoes cfg, EmailInscricao email) => enviarEmailDevocional(
    cfg, EmailDevocional(destinatario: email.destinatario, assunto: email.assunto, texto: email.texto, html: email.html));
