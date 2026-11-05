import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../app_scope.dart';
import '../data/blur_cartaz.dart';
import '../sync/server_api.dart';

/// Prévia do fundo do recado no telão, com o nível escolhido. A força do desfoque é a mesma da
/// projeção (medida em 1920 px), escalada para o tamanho da prévia.
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
    const reserva = ColoredBox(color: Color(0xFF2B3A55));
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: FutureBuilder<List<Cartaz>>(
        future: _cartazes,
        builder: (context, snap) {
          final cartaz = snap.data?.firstOrNull;
          return LayoutBuilder(builder: (context, caixa) {
            final e = caixa.maxWidth / 1920;
            final fundo = cartaz == null
                ? reserva
                : Image.network(cartaz.url,
                    fit: BoxFit.cover, errorBuilder: (_, __, ___) => reserva);
            return ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ImageFiltered(
                    imageFilter: ui.ImageFilter.blur(sigmaX: widget.nivel.sigma * e, sigmaY: widget.nivel.sigma * e),
                    child: fundo,
                  ),
                  const ColoredBox(color: Color(0x80000000)),
                  Center(
                    child: Padding(
                      padding: EdgeInsets.all(24 * e + 8),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Título do recado',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 96 * e,
                              fontWeight: widget.negrito ? FontWeight.bold : FontWeight.normal,
                            ),
                          ),
                          SizedBox(height: 48 * e),
                          Text(
                            'Texto de exemplo para conferir a leitura',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.white, fontSize: 56 * e),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            );
          });
        },
      ),
    );
  }
}
