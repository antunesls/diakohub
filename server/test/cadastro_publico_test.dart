import 'package:diako_server/cadastro_publico.dart';
import 'package:test/test.dart';

void main() {
  final hoje = DateTime(2026, 11, 12);
  CadastroLimpo limpar(Map<String, dynamic> extra) => limparCadastroPublico({'nome': 'Ana Souza', ...extra}, hoje);
  String? erro(Map<String, dynamic> extra) => limpar(extra).erro;

  test('estado civil só aceita a lista e normaliza variações', () {
    expect(limpar({'estadoCivil': 'Casado(a)'}).dados['estadoCivil'], 'Casado(a)');
    expect(limpar({'estadoCivil': 'casada'}).dados['estadoCivil'], 'Casado(a)');
    expect(limpar({'estadoCivil': 'VIUVA'}).dados['estadoCivil'], 'Viúvo(a)');
    expect(limpar({'estadoCivil': 'uniao estavel'}).dados['estadoCivil'], 'União estável');
    expect(erro({'estadoCivil': 'Enrolado'}), isNotNull);
    expect(erro({'estadoCivil': '<script>'}), isNotNull);
    expect(limpar({'estadoCivil': ''}).dados.containsKey('estadoCivil'), false);
  });

  test('sexo, UF, CEP, CPF e telefone aceitam só formatos válidos', () {
    expect(erro({'sexo': 'X'}), isNotNull);
    expect(limpar({'sexo': 'f'}).dados['sexo'], 'F');
    expect(limpar({'estado': 'sp'}).dados['estado'], 'SP');
    expect(erro({'estado': 'XX'}), isNotNull);
    expect(limpar({'cep': '01310-100'}).dados['cep'], '01310100');
    expect(erro({'cep': '0131'}), isNotNull);
    expect(erro({'cep': '01310abc100'}), isNotNull);
    expect(limpar({'cpf': '529.982.247-25'}).dados['cpf'], '52998224725');
    expect(erro({'cpf': '111.111.111-11'}), isNotNull);
    expect(limpar({'whatsapp': '+55 (11) 98888-7777'}).dados['whatsapp'], '11988887777');
    expect(limpar({'telefone': '(11) 3333-4444'}).dados['telefone'], '1133334444');
    expect(erro({'telefone': '11 8888-77777'}), isNotNull); // 11 dígitos sem o 9
    expect(erro({'emergenciaTelefone': '123'}), isNotNull);
    expect(erro({'email': 'ana@teste'}), isNotNull);
    expect(limpar({'email': ' Ana@Teste.com '}).dados['email'], 'ana@teste.com');
  });

  test('textos livres perdem caracteres invisíveis e de marcação', () {
    final r = limpar({'rua': '  Rua\u200B   das <b>Flores</b>\n', 'bairro': '\u202ECentro'});
    expect(r.dados['rua'], 'Rua das bFlores/b');
    expect(r.dados['bairro'], 'Centro');
    expect(erro({'rua': 'x' * 121}), contains('muito longo'));
    expect(erro({'rua': 123}), isNotNull);
    expect(erro({'rua': {'a': 1}}), isNotNull);
  });

  test('nomes de pessoa aceitam acentos, hífen e apóstrofo, mas não números ou símbolos', () {
    expect(erro({'nome': "Maria D'Ávila Souza-Lima"}), isNull);
    expect(erro({'nome': 'Ana123'}), isNotNull);
    expect(erro({'nome': 'Ana <img>'}), isNull); // < e > somem antes; "Ana img" é um nome
    expect(erro({'nome': '@@@'}), isNotNull);
    expect(erro({'emergenciaNome': 'Mãe 2'}), isNotNull);
  });

  test('datas da igreja não podem ser futuras e ministérios são limitados', () {
    expect(limpar({'dataBatismo': '10/05/2010'}).dados['dataBatismo'], '2010-05-10');
    expect(erro({'dataBatismo': '2027-01-01'}), contains('futuro'));
    expect(erro({'dataChegada': '31/02/2020'}), isNotNull);
    expect(limpar({'ministerios': ['Louvor', ' louvor ', 'Infantil']}).dados['ministerios'], ['Louvor', 'Infantil']);
    expect(limpar({'ministerios': 'Louvor, Mídia'}).dados['ministerios'], ['Louvor', 'Mídia']);
    expect(erro({'ministerios': [for (var i = 0; i < 13; i++) 'M$i']}), isNotNull);
    expect(erro({'ministerios': [1, 2]}), isNotNull);
  });

  test('campos desconhecidos são ignorados', () {
    final r = limpar({'status': 'membro', 'conjugeId': 'x', 'consentimentoEm': '2000-01-01'});
    expect(r.dados.keys, ['nome']);
  });
}
