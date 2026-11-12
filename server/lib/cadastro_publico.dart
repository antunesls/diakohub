import 'package:diako_core/diako_core.dart';

/// Limpeza e validação dos campos do cadastro público de membros.
///
/// O formulário é aberto a qualquer pessoa com o link, então cada campo é tratado
/// aqui como entrada não confiável: só valores de listas fechadas (sexo, estado
/// civil, UF), números com a quantidade certa de dígitos e textos livres sem
/// caracteres de controle, com tamanho limitado.

const estadosCivis = ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'];

const ufs = {
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', //
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
};

/// Resultado: os dados limpos (só campos preenchidos) ou a mensagem de erro.
typedef CadastroLimpo = ({Map<String, dynamic> dados, String? erro});

// Controle, marcas de direção (usadas para disfarçar texto) e espaços de largura zero.
final _invisiveis = RegExp('[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]');
final _espacos = RegExp(r'\s+');
final _nomeValido = RegExp(r"^[\p{L}\p{M}]+(?:[ '’.\-]+[\p{L}\p{M}]+)*\.?$", unicode: true);
final _numeroCasa = RegExp(r'^[0-9A-Za-z /\-]+$');
final _rgValido = RegExp(r'^[0-9A-Za-z.\-/ ]+$');

/// Tira caracteres invisíveis, `<` e `>`, junta espaços repetidos e apara.
String limparTexto(String s) =>
    s.replaceAll(_invisiveis, '').replaceAll(RegExp('[<>]'), '').replaceAll(_espacos, ' ').trim();

/// Aceita "casada", "Solteiro", "uniao estavel"... e devolve o valor da lista.
String? estadoCivilValido(String s) {
  final chave = semAcento(s.toLowerCase().replaceAll('(a)', '').trim()) ?? '';
  if (chave.isEmpty) return null;
  for (final valor in estadosCivis) {
    final base = semAcento(valor.toLowerCase().replaceAll('(a)', '')) ?? '';
    // "casado" e "casada" têm o mesmo radical; "uniao estavel" é comparado inteiro.
    final radical = base.endsWith('o') ? base.substring(0, base.length - 1) : base;
    if (chave == base || (radical != base && chave.length == base.length && chave.startsWith(radical))) {
      return valor;
    }
  }
  return null;
}

/// Telefone brasileiro só com dígitos (DDD + número); aceita "+55" na frente.
String? telefoneValido(String s) {
  var d = s.replaceAll(RegExp(r'\D'), '');
  if ((d.length == 12 || d.length == 13) && d.startsWith('55')) d = d.substring(2);
  if (d.length != 10 && d.length != 11) return null;
  if (d.startsWith('0') || d[1] == '0') return null; // DDD não começa nem termina em 0
  if (d.length == 11 && d[2] != '9') return null; // celular de 11 dígitos começa com 9
  return d;
}

bool nomeDePessoaValido(String s) => s.length >= 2 && s.length <= 100 && _nomeValido.hasMatch(s);

/// Valida e normaliza o corpo enviado pelo formulário público.
/// [hoje] limita as datas da vida na igreja (não podem estar no futuro).
CadastroLimpo limparCadastroPublico(Map<String, dynamic> corpo, DateTime hoje) {
  final dados = <String, dynamic>{};
  CadastroLimpo falha(String erro) => (dados: const {}, erro: erro);

  // Lê um campo de texto: ausente/vazio vira null; outro tipo é recusado.
  String? texto(String campo, int maximo) {
    final v = corpo[campo];
    if (v == null) return null;
    if (v is! String) throw _CampoInvalido(campo);
    final limpo = limparTexto(v);
    if (limpo.isEmpty) return null;
    if (limpo.length > maximo) throw _CampoInvalido(campo, 'muito longo (máximo $maximo caracteres)');
    return limpo;
  }

  try {
    final nome = texto('nome', 100);
    if (nome == null) return falha('Informe o nome.');
    if (!nomeDePessoaValido(nome)) return falha('Nome inválido: use só letras, espaços, hífen e apóstrofo.');
    dados['nome'] = nome;

    final sexo = texto('sexo', 1)?.toUpperCase();
    if (sexo != null) {
      if (sexo != 'M' && sexo != 'F') return falha('Sexo inválido.');
      dados['sexo'] = sexo;
    }

    final estadoCivil = texto('estadoCivil', 30);
    if (estadoCivil != null) {
      final valido = estadoCivilValido(estadoCivil);
      if (valido == null) return falha('Estado civil inválido: escolha uma das opções.');
      dados['estadoCivil'] = valido;
    }

    final cpf = texto('cpf', 14);
    if (cpf != null) {
      final d = cpf.replaceAll(RegExp(r'\D'), '');
      if (d.length != 11 || cpf.replaceAll(RegExp(r'[\d.\-\s]'), '').isNotEmpty || !Membro.cpfValido(d)) {
        return falha('CPF inválido: confira os números.');
      }
      dados['cpf'] = d;
    }

    final rg = texto('rg', 20);
    if (rg != null) {
      if (!_rgValido.hasMatch(rg) || !rg.contains(RegExp(r'\d'))) return falha('RG inválido.');
      dados['rg'] = rg.toUpperCase();
    }

    for (final campo in ['telefone', 'whatsapp', 'emergenciaTelefone']) {
      final valor = texto(campo, 20);
      if (valor == null) continue;
      final d = telefoneValido(valor);
      if (d == null) return falha('Informe um telefone com DDD válido.');
      dados[campo] = d;
    }

    final email = texto('email', 120)?.toLowerCase();
    if (email != null) {
      if (email.contains(' ') || !RegExp(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$').hasMatch(email)) {
        return falha('E-mail inválido.');
      }
      dados['email'] = email;
    }

    final cep = texto('cep', 10);
    if (cep != null) {
      final d = cep.replaceAll(RegExp(r'\D'), '');
      if (d.length != 8 || cep.replaceAll(RegExp(r'[\d.\-\s]'), '').isNotEmpty) return falha('CEP inválido: são 8 números.');
      dados['cep'] = d;
    }

    final uf = texto('estado', 2)?.toUpperCase();
    if (uf != null) {
      if (!ufs.contains(uf)) return falha('Estado (UF) inválido.');
      dados['estado'] = uf;
    }

    final numero = texto('numero', 10);
    if (numero != null) {
      if (!_numeroCasa.hasMatch(numero)) return falha('Número do endereço inválido.');
      dados['numero'] = numero.toUpperCase();
    }

    for (final (campo, maximo) in [
      ('rua', 120), ('complemento', 60), ('bairro', 80), ('cidade', 80), //
      ('funcao', 60), ('comoConheceu', 200), ('emergenciaVinculo', 40),
    ]) {
      final valor = texto(campo, maximo);
      if (valor != null) dados[campo] = valor;
    }

    final emergencia = texto('emergenciaNome', 100);
    if (emergencia != null) {
      if (!nomeDePessoaValido(emergencia)) return falha('Nome do contato de emergência inválido.');
      dados['emergenciaNome'] = emergencia;
    }

    final hojeIso = '${hoje.year}-${hoje.month.toString().padLeft(2, '0')}-${hoje.day.toString().padLeft(2, '0')}';
    for (final (campo, rotulo) in [('dataChegada', 'chegada'), ('dataBatismo', 'batismo'), ('dataMembresia', 'membresia')]) {
      final valor = texto(campo, 10);
      if (valor == null) continue;
      final iso = Membro.dataDe(valor);
      if (iso == null || iso.compareTo('1900-01-01') < 0) return falha('Data de $rotulo inválida.');
      if (iso.compareTo(hojeIso) > 0) return falha('A data de $rotulo não pode estar no futuro.');
      dados[campo] = iso;
    }

    final ministerios = corpo['ministerios'];
    final brutos = switch (ministerios) {
      null => const <Object?>[],
      final String s => s.split(','),
      final List l => l,
      _ => throw _CampoInvalido('ministerios'),
    };
    final lista = <String>[];
    for (final item in brutos) {
      if (item is! String) throw _CampoInvalido('ministerios');
      final m = limparTexto(item);
      if (m.isEmpty) continue;
      if (m.length > 60) return falha('Nome de ministério muito longo (máximo 60 caracteres).');
      if (!lista.any((x) => x.toLowerCase() == m.toLowerCase())) lista.add(m);
    }
    if (lista.length > 12) return falha('Muitos ministérios (máximo 12).');
    if (lista.isNotEmpty) dados['ministerios'] = lista;
  } on _CampoInvalido catch (e) {
    return falha(e.mensagem);
  }
  return (dados: dados, erro: null);
}

class _CampoInvalido implements Exception {
  _CampoInvalido(String campo, [String problema = 'inválido']) : mensagem = 'Campo ${_rotulos[campo] ?? campo} $problema.';
  final String mensagem;
}

const _rotulos = {
  'nome': 'nome', 'sexo': 'sexo', 'estadoCivil': 'estado civil', 'cpf': 'CPF', 'rg': 'RG',
  'telefone': 'telefone', 'whatsapp': 'WhatsApp', 'emergenciaTelefone': 'telefone de emergência',
  'email': 'e-mail', 'cep': 'CEP', 'estado': 'UF', 'numero': 'número', 'rua': 'rua',
  'complemento': 'complemento', 'bairro': 'bairro', 'cidade': 'cidade', 'funcao': 'função',
  'comoConheceu': 'como conheceu', 'emergenciaNome': 'nome do contato de emergência',
  'emergenciaVinculo': 'vínculo de emergência', 'dataChegada': 'data de chegada',
  'dataBatismo': 'data de batismo', 'dataMembresia': 'data de membresia', 'ministerios': 'ministérios',
};
