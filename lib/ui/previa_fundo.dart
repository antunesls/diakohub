import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../app_scope.dart';
import '../data/blur_cartaz.dart';
import '../sync/server_api.dart';

/// Slide de um recado sobre o cartaz, na mesma aparência da projeção: o cartaz em tela cheia,
/// desfocado conforme [nivel] (medido em 1920 px, escalado para a caixa), escurecido, com o título
/// e o texto por cima.
class CartazComTexto extends StatelessWidget {
  const CartazComTexto({
    super.key,
    required this.url,
    required this.titulo,
    required this.texto,
    required this.nivel,
    required this.negrito,
  });

  final String url;
  final String titulo;
  final String texto;
  final NivelBlur nivel;
  final bool negrito;

  @override
  Widget build(BuildContext context) {
    const reserva = ColoredBox(color: Color(0xFF2B3A55));
    final corpo = texto.trim();
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: LayoutBuilder(builder: (context, caixa) {
        final e = caixa.maxWidth / 1920;
        return ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Stack(
            fit: StackFit.expand,
            children: [
              ImageFiltered(
                imageFilter: ui.ImageFilter.blur(sigmaX: nivel.sigma * e, sigmaY: nivel.sigma * e),
                child: Image.network(url, fit: BoxFit.cover, errorBuilder: (_, __, ___) => reserva),
              ),
              const ColoredBox(color: Color(0x80000000)),
              Center(
                child: Padding(
                  padding: EdgeInsets.all(24 * e + 8),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        titulo,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 96 * e,
                          fontWeight: negrito ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                      if (corpo.isNotEmpty) ...[
                        SizedBox(height: 48 * e),
                        Text(
                          corpo,
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white, fontSize: 56 * e),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      }),
    );
  }
}

/// Prévia do fundo nas configurações: usa o primeiro cartaz do servidor e um texto de exemplo.
class PreviaFundo extends StatefulWidget {
  const PreviaFundo({super.key, required this.nivel, required this.negrito});

  final NivelBlur nivel;
  final bool negrito;

  @override
  State<PreviaFundo> createState() => _PreviaFundoState();
}

class _PreviaFundoState extends State<PreviaFundo> {
  Future<List<Cartaz>>? _cartazes;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _cartazes ??= AppScope.of(context).api.cartazes().catchError((_) => <Cartaz>[]);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Cartaz>>(
      future: _cartazes,
      builder: (context, snap) {
        final cartaz = snap.data?.firstOrNull;
        if (cartaz == null) {
          return const AspectRatio(
            aspectRatio: 16 / 9,
            child: ColoredBox(
              color: Color(0xFF2B3A55),
              child: Center(
                child: Text('Sem cartaz para a prévia. Envie um cartaz para ver o efeito.',
                    textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
              ),
            ),
          );
        }
        return CartazComTexto(
          url: cartaz.url,
          titulo: 'Título do recado',
          texto: 'Texto de exemplo para conferir a leitura',
          nivel: widget.nivel,
          negrito: widget.negrito,
        );
      },
    );
  }
}
