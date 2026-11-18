import 'dart:convert';
import 'dart:io';

import 'package:mailer/mailer.dart';
import 'package:mailer/smtp_server.dart';

import 'configuracoes.dart';

class EmailDevocional {
  const EmailDevocional(
      {required this.destinatario, required this.assunto, required this.texto, required this.html, String? htmlSemLogo})
      : _htmlSemLogo = htmlSemLogo;
  final String destinatario, assunto, texto;

  /// Corpo com o logo anexado inline (cid:), como os outros e-mails do DiakoHub.
  final String html;
  final String? _htmlSemLogo;

  /// O mesmo corpo com o nome da igreja no lugar do logo (quando o arquivo do logo não existe).
  String get htmlSemLogo => _htmlSemLogo ?? html;
}

/// Só use quando há certeza de rejeição antes da aceitação pelo SMTP.
class FalhaEmailDevocional implements Exception {
  const FalhaEmailDevocional(this.mensagem);
  final String mensagem;
}

const _temas = {'casais': 'Casais', 'familia': 'Família'};
const _meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
  'novembro', 'dezembro'];

/// "2026-11-18" -> "18 de novembro de 2026" (o que não for data fica como veio).
String _dataExtenso(String iso) {
  final d = DateTime.tryParse(iso);
  return d == null ? iso : '${d.day} de ${_meses[d.month - 1]} de ${d.year}';
}

/// "Casais", "Casais e Família", "Casais, Família e Jovens".
String _juntar(List<String> nomes) => nomes.length <= 1
    ? nomes.join()
    : '${nomes.sublist(0, nomes.length - 1).join(', ')} e ${nomes.last}';

/// [trilhas]: nomes das trilhas do devocional (sem eles, o tema antigo, se houver).
EmailDevocional montarEmailDevocional(Map<String, dynamic> devocional,
    {required String destinatario, required String igreja, required String urlPublica, String? urlCancelar,
    List<String>? trilhas}) {
  String campo(String k) => '${devocional[k] ?? ''}'.trim();
  final titulo = campo('titulo'), autor = campo('autorNome'), referencia = campo('referencia');
  final nomes = trilhas ?? [if (_temas[campo('tema')] != null) _temas[campo('tema')]!];
  final tema = nomes.isEmpty ? null : _juntar(nomes);
  final data = _dataExtenso(campo('data'));
  final serie = campo('serie'), parte = devocional['serieParte'];
  final rotuloSerie = serie.isEmpty ? '' : 'Série $serie${parte is int ? ' · parte $parte' : ''}';
  final assinatura = [if (autor.isNotEmpty) 'Por $autor', if (data.isNotEmpty) data].join(' · ');
  final rodape = urlCancelar != null
      ? 'Você recebe este e-mail porque assinou os devocionais${tema == null ? '' : ' de $tema'}.'
      : 'Envio avulso feito pela liderança. Ele não cria uma assinatura.';

  final texto = [
    titulo, igreja,
    if (rotuloSerie.isNotEmpty) rotuloSerie,
    if (assinatura.isNotEmpty) assinatura,
    if (referencia.isNotEmpty) referencia,
    campo('texto'),
    if (campo('aplicacao').isNotEmpty) 'Aplicação\n${campo('aplicacao')}',
    if (campo('oracao').isNotEmpty) 'Oração\n${campo('oracao')}',
    'Leia e compartilhe: $urlPublica',
    rodape,
    if (urlCancelar != null) 'Cancelar assinatura: $urlCancelar',
  ].join('\n\n');

  String corpo(String Function(String) e) {
    final secoes = StringBuffer()
      ..write(referencia.isEmpty
          ? ''
          : '<p style="margin:0 0 22px;padding:14px 18px;border-radius:14px;background:$_primariaSuave;'
              'font-family:$_titulo;font-size:17px;line-height:1.45;font-style:italic;color:$_primariaEscura">${e(referencia)}</p>')
      ..write(_paragrafos(campo('texto'), e));
    if (campo('aplicacao').isNotEmpty) {
      secoes
        ..write(_rotulo('Aplicação', e, topo: 26))
        ..write(_paragrafos(campo('aplicacao'), e));
    }
    if (campo('oracao').isNotEmpty) {
      secoes
        ..write(_rotulo('Oração', e, topo: 26))
        ..write('<div style="padding:16px 18px 2px;border-radius:14px;background:$_fundo;border:1px solid $_linha">'
            '${_paragrafos(campo('oracao'), e, italico: true)}</div>');
    }
    return '''
    <tr><td style="padding:28px 28px 8px;font-family:$_fonte;color:$_texto">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:$_primaria">Devocional${tema == null ? '' : ' · ${e(tema)}'}</p>
      <h1 style="margin:0 0 8px;font-family:$_titulo;font-size:30px;line-height:1.2;font-weight:600;color:$_texto">${e(titulo)}</h1>
      ${rotuloSerie.isEmpty ? '' : '<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:$_primaria">${e(rotuloSerie)}</p>'}
      ${assinatura.isEmpty ? '' : '<p style="margin:0 0 22px;font-size:14px;color:$_suave">${e(assinatura)}</p>'}
      $secoes
    </td></tr>
    ${_botao('Ler e compartilhar', urlPublica, e)}
    <tr><td style="padding:8px 28px 28px;font-family:$_fonte;font-size:13px;line-height:1.5;color:$_suave;text-align:center">
      ${e(rodape)}${urlCancelar == null ? '' : '<br><a href="${e(urlCancelar)}" target="_blank" style="color:$_suave;text-decoration:underline">Cancelar assinatura</a>'}
    </td></tr>''';
  }

  final previa = _resumo(referencia.isNotEmpty ? '$referencia — ${campo('texto')}' : campo('texto'));
  return EmailDevocional(
      destinatario: destinatario,
      assunto: 'Devocional: $titulo'.replaceAll(RegExp(r'[\r\n]'), ' '),
      texto: texto,
      html: _moldura(igreja: igreja, titulo: titulo, previa: previa, comLogo: true, corpo: corpo),
      htmlSemLogo: _moldura(igreja: igreja, titulo: titulo, previa: previa, comLogo: false, corpo: corpo));
}

EmailDevocional montarEmailConfirmacao({required String destinatario, required String igreja, required String urlConfirmar}) {
  const titulo = 'Confirme sua assinatura';
  final texto = [
    igreja, 'Confirme sua assinatura de devocionais',
    'Você pediu para receber devocionais por e-mail. Confirme pelo link abaixo em até 24 horas.',
    urlConfirmar,
    'Se não foi você, ignore esta mensagem. Nada muda sem a sua confirmação.',
  ].join('\n\n');
  String corpo(String Function(String) e) => '''
    <tr><td style="padding:28px 28px 8px;font-family:$_fonte;color:$_texto">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:$_primaria">Devocionais por e-mail</p>
      <h1 style="margin:0 0 10px;font-family:$_titulo;font-size:28px;line-height:1.2;font-weight:600;color:$_texto">$titulo</h1>
      <p style="margin:0 0 8px;font-size:16px;line-height:1.6;color:$_texto">Você pediu para receber os devocionais de ${e(igreja)} por e-mail. Para começar, confirme a assinatura pelo botão abaixo.</p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:$_suave">O link vale por <strong style="color:$_texto">24 horas</strong>.</p>
    </td></tr>
    ${_botao('Confirmar assinatura', urlConfirmar, e)}
    <tr><td style="padding:8px 28px 28px;font-family:$_fonte;font-size:13px;line-height:1.5;color:$_suave;text-align:center">
      Se não foi você, ignore esta mensagem. Nada muda sem a sua confirmação.<br>
      Se o botão não funcionar, copie este endereço no navegador:<br>
      <a href="${e(urlConfirmar)}" target="_blank" style="color:$_primaria;word-break:break-all">${e(urlConfirmar)}</a>
    </td></tr>''';
  const previa = 'Confirme em até 24 horas para começar a receber os devocionais.';
  return EmailDevocional(
      destinatario: destinatario,
      assunto: 'Confirme sua assinatura de devocionais',
      texto: texto,
      html: _moldura(igreja: igreja, titulo: titulo, previa: previa, comLogo: true, corpo: corpo),
      htmlSemLogo: _moldura(igreja: igreja, titulo: titulo, previa: previa, comLogo: false, corpo: corpo));
}

// Identidade do DiakoHub (mesmas cores e fontes do site e dos outros e-mails, em email_mensagens.dart).
// Tabelas e estilos inline porque Gmail e Outlook ignoram boa parte do CSS em <style>.
const _fundo = '#f7f5f0', _superficie = '#ffffff', _texto = '#2e2d2a', _suave = '#5f5c55';
const _linha = '#e4e0d6', _primaria = '#1f5f5b', _primariaEscura = '#16443f', _primariaSuave = '#dceae7';
const _fonte = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const _titulo = "Fraunces,Georgia,'Times New Roman',serif";
const _cidLogo = 'logo@diakohub';

String _esc(String s) => const HtmlEscape(HtmlEscapeMode(escapeLtGt: true, escapeQuot: true, escapeApos: true)).convert(s);

String _resumo(String s) {
  final t = s.replaceAll(RegExp(r'\s+'), ' ').trim();
  return t.length <= 140 ? t : '${t.substring(0, 137)}…';
}

/// Parágrafos separados por linha em branco; quebras simples viram <br>.
String _paragrafos(String texto, String Function(String) e, {bool italico = false}) => [
      for (final p in texto.split(RegExp(r'\n\s*\n')))
        if (p.trim().isNotEmpty)
          '<p style="margin:0 0 14px;font-family:$_fonte;font-size:16px;line-height:1.65;color:$_texto${italico ? ';font-style:italic' : ''}">'
              '${p.trim().split('\n').map(e).join('<br>')}</p>',
    ].join();

String _rotulo(String texto, String Function(String) e, {int topo = 0}) =>
    '<p style="margin:${topo}px 0 10px;font-family:$_fonte;font-size:12px;font-weight:600;letter-spacing:.12em;'
    'text-transform:uppercase;color:$_primaria">${e(texto)}</p>';

String _botao(String rotulo, String url, String Function(String) e) => '''
    <tr><td align="center" style="padding:20px 28px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="$_primaria" style="border-radius:27px">
        <a href="${e(url)}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:$_fonte;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:27px">${e(rotulo)}</a>
      </td></tr></table>
    </td></tr>''';

String _moldura(
    {required String igreja,
    required String titulo,
    required String previa,
    required bool comLogo,
    required String Function(String Function(String) e) corpo}) {
  const e = _esc;
  final logo = comLogo
      ? '<img src="cid:$_cidLogo" alt="${e(igreja)}" width="220" style="display:block;margin:0 auto;width:220px;max-width:70%;height:auto;border:0">'
      : '<div style="font-family:$_titulo;font-size:22px;font-weight:600;color:$_primaria;text-align:center">${e(igreja)}</div>';
  return '''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titulo)} · ${e(igreja)}</title>
</head>
<body style="margin:0;padding:0;background:$_fundo;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(previa)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:$_fundo">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:$_superficie;border:1px solid $_linha;border-radius:20px;overflow:hidden">
    <tr><td style="padding:28px 24px 20px;border-bottom:1px solid $_linha">$logo</td></tr>
${corpo(e)}
    <tr><td style="padding:16px 24px;background:$_primariaSuave;font-family:$_fonte;font-size:12px;color:$_primaria;text-align:center">
      Enviado pelo DiakoHub · ${e(igreja)}
    </td></tr>
  </table>
</td></tr></table>
</body></html>''';
}

/// Envia com o logo inline quando [arquivoLogo] existe; sem ele, o nome da igreja vai no lugar.
Future<void> enviarEmailDevocional(Configuracoes cfg, EmailDevocional email, {String? arquivoLogo}) async {
  if (cfg.smtpHost.isEmpty || cfg.smtpRemetente.isEmpty ||
      (cfg.smtpUsuario.isNotEmpty && cfg.smtpSenha.isEmpty)) {
    throw const FalhaEmailDevocional('Configure o servidor SMTP antes do envio.');
  }
  if (!RegExp(r'^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$').hasMatch(email.destinatario)) {
    throw const FalhaEmailDevocional('Destinatário inválido.');
  }
  final logo = arquivoLogo != null && File(arquivoLogo).existsSync() ? File(arquivoLogo) : null;
  final mensagem = Message()
    ..from = Address(cfg.smtpRemetente, cfg.nomeIgreja)
    ..recipients.add(email.destinatario)
    ..subject = email.assunto.replaceAll(RegExp(r'[\r\n]'), ' ')
    ..text = email.texto
    ..html = logo != null ? email.html : email.htmlSemLogo;
  if (logo != null && email.html.contains('cid:$_cidLogo')) {
    mensagem.attachments.add(FileAttachment(logo, contentType: 'image/png')
      ..location = Location.inline
      ..cid = '<$_cidLogo>');
  }
  await send(mensagem, SmtpServer(cfg.smtpHost, port: cfg.smtpPorta,
      username: cfg.smtpUsuario.isEmpty ? null : cfg.smtpUsuario,
      password: cfg.smtpUsuario.isEmpty ? null : cfg.smtpSenha,
      ssl: cfg.smtpSsl, allowInsecure: false));
}
