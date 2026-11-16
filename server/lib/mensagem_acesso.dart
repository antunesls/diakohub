/// Texto para entregar o acesso pelo WhatsApp (revisado e enviado por quem administra: o
/// sistema não manda mensagens sozinho). A senha é temporária e precisa ser trocada no
/// primeiro acesso.
String mensagemAcesso({
  required String nome,
  required String igreja,
  required String endereco,
  required String login,
  required String senha,
  DateTime? valeAte,
}) {
  final primeiro = nome.trim().split(RegExp(r'\s+')).first;
  String data(DateTime d) => '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  return [
    'Olá, $primeiro! Este é o seu acesso ao DiakoHub da $igreja.',
    '',
    'Entre em: $endereco',
    'Usuário: $login',
    'Senha temporária: $senha',
    '',
    'No primeiro acesso você vai criar a sua própria senha.'
        '${valeAte == null ? '' : ' Esta senha temporária vale até ${data(valeAte)}.'}',
  ].join('\n');
}

/// Dígitos do WhatsApp (ou, sem ele, do telefone) de um membro, com DDI 55; null se não houver
/// um número brasileiro com DDD.
String? whatsappDoMembro(Map<String, dynamic>? membro) {
  if (membro == null) return null;
  for (final campo in ['whatsapp', 'telefone']) {
    final d = '${membro[campo] ?? ''}'.replaceAll(RegExp(r'\D'), '');
    if (d.length == 10 || d.length == 11) return '55$d';
    if ((d.length == 12 || d.length == 13) && d.startsWith('55')) return d;
  }
  return null;
}
