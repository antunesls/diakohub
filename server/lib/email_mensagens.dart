import 'dart:convert';
import 'dart:io';

import 'package:diako_core/diako_core.dart';
import 'package:mailer/mailer.dart';
import 'package:mailer/smtp_server.dart';

import 'configuracoes.dart';

SmtpServer _servidor(Configuracoes cfg) => SmtpServer(
      cfg.smtpHost,
      port: cfg.smtpPorta,
      username: cfg.smtpUsuario.isEmpty ? null : cfg.smtpUsuario,
      password: cfg.smtpUsuario.isEmpty ? null : cfg.smtpSenha,
      ssl: cfg.smtpSsl,
      allowInsecure: false,
    );

Future<void> enviarEmailMensagem(
    Configuracoes cfg, Mensagem mensagem, String urlPainel) async {
  final tipo = switch (mensagem.tipo) {
    'duvida' => 'dúvida',
    'sugestao' => 'sugestão',
    _ => 'crítica',
  };
  await send(
      Message()
        ..from = Address(cfg.smtpRemetente)
        ..recipients.add(cfg.smtpDestinatario)
        ..subject = 'DiakoHub: nova $tipo na caixa de mensagens'
        ..text =
            'Chegou uma nova $tipo. Abra o painel protegido para ler: $urlPainel',
      _servidor(cfg));
}

Future<void> enviarEmailTeste(Configuracoes cfg) async {
  await send(
      Message()
        ..from = Address(cfg.smtpRemetente)
        ..recipients.add(cfg.smtpDestinatario)
        ..subject = 'DiakoHub: teste de e-mail'
        ..text =
            'A configuração de avisos da caixa de mensagens está funcionando.',
      _servidor(cfg));
}

/// Aviso de que o backup automático falhou. Sem detalhes do erro nem caminhos: só o link do /admin.
Future<void> enviarEmailFalhaBackup(Configuracoes cfg, DateTime quando, String urlAdmin) async {
  String dois(int n) => n.toString().padLeft(2, '0');
  final data = '${dois(quando.day)}/${dois(quando.month)}/${quando.year} às ${dois(quando.hour)}:${dois(quando.minute)}';
  await send(
      Message()
        ..from = Address(cfg.smtpRemetente)
        ..recipients.add(cfg.smtpDestinatario)
        ..subject = 'DiakoHub: o backup automático falhou'
        ..text = 'O backup automático de $data não foi gravado. O servidor tenta de novo a cada hora.\n'
            'Abra a administração para gravar um backup e conferir: $urlAdmin',
      _servidor(cfg));
}

/// Resumo de uma ficha enviada pelo link público, para o aviso por e-mail.
/// Só o necessário para a equipe decidir abrir o painel: nada de CPF, RG ou endereço completo.
class ResumoCadastro {
  ResumoCadastro({
    required this.nome,
    required this.recebidoEm,
    this.whatsapp,
    this.telefone,
    this.email,
    this.cidade,
    this.familiares = 0,
    this.menor = false,
    this.exemplo = false,
  });

  final String nome;
  final DateTime recebidoEm;
  final String? whatsapp, telefone, email, cidade;
  final int familiares;
  final bool menor;

  /// E-mail de teste mandado pelo /admin: avisa no assunto e no corpo que é exemplo.
  final bool exemplo;

  factory ResumoCadastro.de(Map<String, dynamic> dados,
      {required DateTime recebidoEm, int familiares = 0, bool menor = false}) {
    final cidade = [dados['bairro'], dados['cidade'], dados['estado']]
        .whereType<String>()
        .where((s) => s.isNotEmpty)
        .join(', ');
    return ResumoCadastro(
      nome: dados['nome'] as String? ?? '',
      recebidoEm: recebidoEm,
      whatsapp: dados['whatsapp'] as String?,
      telefone: dados['telefone'] as String?,
      email: dados['email'] as String?,
      cidade: cidade.isEmpty ? null : cidade,
      familiares: familiares,
      menor: menor,
    );
  }
}

String _telefoneBr(String d) => d.length == 11
    ? '(${d.substring(0, 2)}) ${d.substring(2, 7)}-${d.substring(7)}'
    : d.length == 10
        ? '(${d.substring(0, 2)}) ${d.substring(2, 6)}-${d.substring(6)}'
        : d;

String _dataHoraBr(DateTime t) {
  String dois(int n) => n.toString().padLeft(2, '0');
  return '${dois(t.day)}/${dois(t.month)}/${t.year} às ${dois(t.hour)}:${dois(t.minute)}';
}

const _cidLogo = 'logo@diakohub';

/// Corpo HTML do aviso de cadastro, na identidade do DiakoHub (mesmas cores do site).
/// Tabelas e estilos inline porque Gmail e Outlook ignoram boa parte do CSS em <style>.
/// [comLogo] usa a imagem anexada inline (cid:), que aparece mesmo com imagens externas bloqueadas.
String htmlAvisoCadastro(ResumoCadastro r,
    {required String igreja, required String urlRevisar, bool comLogo = true}) {
  // Escapa < > & " ' (texto e atributos), mas mantém a barra de datas e links legível.
  const esc = HtmlEscape(HtmlEscapeMode(escapeLtGt: true, escapeQuot: true, escapeApos: true));
  String e(String s) => esc.convert(s);
  const fundo = '#f7f5f0', superficie = '#ffffff', texto = '#2e2d2a', suave = '#5f5c55';
  const linha = '#e4e0d6', primaria = '#1f5f5b', primariaSuave = '#dceae7';
  const fonte = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const titulo = "Fraunces,Georgia,'Times New Roman',serif";

  final linhas = <(String, String)>[
    if (r.whatsapp != null) ('WhatsApp', _telefoneBr(r.whatsapp!)),
    if (r.telefone != null) ('Telefone', _telefoneBr(r.telefone!)),
    if (r.email != null) ('E-mail', r.email!),
    if (r.cidade != null) ('Endereço', r.cidade!),
    ('Familiares informados', r.familiares == 0 ? 'Nenhum' : '${r.familiares}'),
    ('Recebido em', _dataHoraBr(r.recebidoEm)),
  ];
  final tabela = linhas
      .map((l) => '<tr>'
          '<td style="padding:10px 0;border-top:1px solid $linha;color:$suave;font-size:14px;width:44%;vertical-align:top">${e(l.$1)}</td>'
          '<td style="padding:10px 0;border-top:1px solid $linha;color:$texto;font-size:15px;font-weight:600;vertical-align:top">${e(l.$2)}</td>'
          '</tr>')
      .join();
  final avisoMenor = r.menor
      ? '<p style="margin:16px 0 0;padding:12px 14px;border-radius:12px;background:#fdf3e1;color:#7a4b00;font-size:14px">'
          'Menor de 18 anos: a ficha traz o nome do responsável legal. Confira antes de aprovar.</p>'
      : '';
  final faixaExemplo = r.exemplo
      ? '<tr><td style="padding:10px 24px;background:#fdf3e1;color:#7a4b00;font-size:13px;text-align:center;font-family:$fonte">'
          'Este é um e-mail de <strong>exemplo</strong>, enviado pela administração. Nenhuma ficha foi recebida.</td></tr>'
      : '';
  final logo = comLogo
      ? '<img src="cid:$_cidLogo" alt="${e(igreja)}" width="220" style="display:block;margin:0 auto;width:220px;max-width:70%;height:auto;border:0">'
      : '<div style="font-family:$titulo;font-size:22px;font-weight:600;color:$primaria;text-align:center">${e(igreja)}</div>';

  return '''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>Novo cadastro de membro</title></head>
<body style="margin:0;padding:0;background:$fundo;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(r.nome)} preencheu a ficha de cadastro. Revise e confirme no painel.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:$fundo">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:$superficie;border:1px solid $linha;border-radius:20px;overflow:hidden">
    $faixaExemplo
    <tr><td style="padding:28px 24px 20px;border-bottom:1px solid $linha">$logo</td></tr>
    <tr><td style="padding:28px 28px 8px;font-family:$fonte;color:$texto">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:$primaria">Novo cadastro de membro</p>
      <h1 style="margin:0 0 10px;font-family:$titulo;font-size:28px;line-height:1.2;font-weight:600;color:$texto">${e(r.nome)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:$suave">Esta pessoa preencheu a ficha pelo link de cadastro e autorizou o uso dos dados (LGPD). A ficha fica <strong style="color:$texto">pendente</strong> até alguém da equipe revisar e confirmar.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:$fonte">$tabela</table>
      $avisoMenor
    </td></tr>
    <tr><td align="center" style="padding:24px 28px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="$primaria" style="border-radius:27px">
        <a href="${e(urlRevisar)}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:$fonte;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:27px">Revisar e confirmar cadastro</a>
      </td></tr></table>
    </td></tr>
    <tr><td style="padding:8px 28px 28px;font-family:$fonte;font-size:13px;line-height:1.5;color:$suave;text-align:center">
      Confira a identidade antes de juntar com uma ficha que já existe.<br>CPF, RG e endereço completo ficam só no painel.
    </td></tr>
    <tr><td style="padding:16px 24px;background:$primariaSuave;font-family:$fonte;font-size:12px;color:$primaria;text-align:center">
      Aviso automático do DiakoHub · ${e(igreja)}
    </td></tr>
  </table>
</td></tr></table>
</body></html>''';
}

String textoAvisoCadastro(ResumoCadastro r, {required String igreja, required String urlRevisar}) {
  final contatos = [
    if (r.whatsapp != null) 'WhatsApp: ${_telefoneBr(r.whatsapp!)}',
    if (r.telefone != null) 'Telefone: ${_telefoneBr(r.telefone!)}',
    if (r.email != null) 'E-mail: ${r.email}',
  ].join('\n');
  return '${r.exemplo ? '[EXEMPLO - nenhuma ficha foi recebida]\n\n' : ''}'
      'Novo cadastro de membro - $igreja\n\n'
      '${r.nome} preencheu a ficha pelo link de cadastro.\n$contatos\n'
      '${r.cidade != null ? 'Endereço: ${r.cidade}\n' : ''}'
      'Familiares informados: ${r.familiares}\n'
      'Recebido em: ${_dataHoraBr(r.recebidoEm)}\n'
      '${r.menor ? 'Menor de 18 anos: confira o responsável legal.\n' : ''}\n'
      'Revise e confirme no painel: $urlRevisar\n';
}

/// Avisa a equipe de que chegou uma ficha pelo cadastro público.
/// Vai para [Configuracoes.destinatarioCadastros] (ou o destinatário geral dos avisos).
Future<void> enviarEmailCadastro(Configuracoes cfg, ResumoCadastro r,
    {required String urlRevisar, String? arquivoLogo}) async {
  final logo = arquivoLogo != null && File(arquivoLogo).existsSync() ? File(arquivoLogo) : null;
  final igreja = cfg.nomeIgreja;
  final mensagem = Message()
    ..from = Address(cfg.smtpRemetente, 'DiakoHub')
    ..subject = '${r.exemplo ? '[Exemplo] ' : ''}Novo cadastro: ${r.nome}'
    ..text = textoAvisoCadastro(r, igreja: igreja, urlRevisar: urlRevisar)
    ..html = htmlAvisoCadastro(r, igreja: igreja, urlRevisar: urlRevisar, comLogo: logo != null);
  for (final d in cfg.destinatarioCadastros.split(RegExp(r'[,;\s]+'))) {
    if (d.isNotEmpty) mensagem.recipients.add(d);
  }
  if (logo != null) {
    mensagem.attachments.add(FileAttachment(logo, contentType: 'image/png')
      ..location = Location.inline
      ..cid = '<$_cidLogo>');
  }
  await send(mensagem, _servidor(cfg));
}
