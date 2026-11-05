/// Desfoque do cartaz de fundo no telão (o texto do recado fica por cima).
enum NivelBlur {
  desligado('Desligado', 0),
  leve('Leve', 8),
  medio('Médio', 18),
  forte('Forte', 32);

  const NivelBlur(this.rotulo, this.sigma);

  final String rotulo;

  /// Força do desfoque, medida na imagem de 1920 px de largura (a do telão).
  final double sigma;
}

NivelBlur nivelBlurDe(String? nome) =>
    NivelBlur.values.where((n) => n.name == nome).firstOrNull ?? NivelBlur.desligado;
