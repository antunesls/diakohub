import 'package:diako_core/diako_core.dart';
import 'package:flutter/material.dart';

import '../app_scope.dart';
import '../sync/server_api.dart';
import 'dia_formato.dart';

/// Seção "Palavra": consulta a Palavra pronta de qualquer dia (hoje por padrão), fora do Modo Culto.
/// Só leitura: não mexe na Palavra que o tablet está usando no culto.
class PalavraDiaPanel extends StatefulWidget {
  const PalavraDiaPanel({super.key});

  @override
  State<PalavraDiaPanel> createState() => _PalavraDiaPanelState();
}

class _PalavraDiaPanelState extends State<PalavraDiaPanel> {
  late ServerApi _api;
  bool _iniciado = false;

  DateTime _dia = DateTime.now();
  List<({String id, String titulo})> _opcoes = const [];
  PalavraDoCulto? _palavra;
  bool _carregando = true;
  String? _erro;
  int _pedido = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_iniciado) {
      _iniciado = true;
      _api = AppScope.of(context).api;
      _carregar();
    }
  }

  /// Carrega as Palavras prontas do dia e a escolhida ([id]; sem [id], a que o servidor indica).
  Future<void> _carregar({String id = ''}) async {
    final pedido = ++_pedido;
    setState(() {
      _carregando = true;
      _erro = null;
    });
    try {
      final dia = diaIso(_dia);
      final lista = await _api.palavraDeHoje(data: dia, listar: true);
      final opcoes = [
        for (final p in lista['palavras'] as List? ?? const [])
          (id: (p as Map)['id'] as String, titulo: p['titulo'] as String),
      ];
      final j = await _api.palavraDeHoje(data: dia, id: id);
      final p = j['palavra'];
      if (!mounted || pedido != _pedido) return;
      setState(() {
        _opcoes = opcoes;
        _palavra = p is Map
            ? PalavraDoCulto.fromJson(Map<String, dynamic>.from(p))
            : null;
        _carregando = false;
      });
    } on ErroAmigavel catch (e) {
      if (!mounted || pedido != _pedido) return;
      setState(() {
        _erro = e.message;
        _carregando = false;
      });
    }
  }

  Future<void> _escolherDia() async {
    final agora = DateTime.now();
    final escolhido = await showDatePicker(
      context: context,
      initialDate: _dia,
      firstDate: DateTime(agora.year - 3),
      lastDate: DateTime(agora.year + 2),
      helpText: 'Palavra de qual dia?',
      confirmText: 'Ver',
      cancelText: 'Cancelar',
    );
    if (escolhido == null || !mounted) return;
    _dia = escolhido;
    await _carregar();
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final hoje = diaIso(DateTime.now()) == diaIso(_dia);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Palavra · ${hoje ? 'hoje, ' : ''}${dataCurta(_dia)}',
                  style: tema.textTheme.titleLarge,
                ),
              ),
              if (!hoje)
                TextButton(
                  onPressed: () {
                    _dia = DateTime.now();
                    _carregar();
                  },
                  child: const Text('Voltar para hoje'),
                ),
              const SizedBox(width: 8),
              FilledButton.tonalIcon(
                onPressed: _escolherDia,
                icon: const Icon(Icons.calendar_month),
                label: const Text('Escolher dia'),
              ),
            ],
          ),
        ),
        if (_opcoes.length > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
            child: Wrap(
              spacing: 8,
              children: [
                for (final o in _opcoes)
                  ChoiceChip(
                    label: Text(o.titulo),
                    selected: _palavra?.id == o.id,
                    onSelected: (_) => _carregar(id: o.id),
                  ),
              ],
            ),
          ),
        Expanded(child: _corpo(context)),
      ],
    );
  }

  Widget _corpo(BuildContext context) {
    if (_carregando) return const Center(child: CircularProgressIndicator());
    if (_erro != null) return _mensagem(context, _erro!);
    final p = _palavra;
    if (p == null) {
      return _mensagem(context, 'Nenhuma Palavra pronta em ${dataCurta(_dia)}.');
    }
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(p.titulo, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(
          [if (p.autorNome.isNotEmpty) p.autorNome, '${p.minutos} min']
              .join(' · '),
          style:
              TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 20),
        for (final (i, t) in p.trechos.indexed) ...[
          if (t.topico.isNotEmpty &&
              (i == 0 || p.trechos[i - 1].topico != t.topico))
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Text(t.topico.toUpperCase(),
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      letterSpacing: .8,
                      color: Theme.of(context).colorScheme.primary)),
            ),
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Text(t.texto,
                style: const TextStyle(fontSize: 18, height: 1.45)),
          ),
          if (t.referencias.any((r) => r.ref != null))
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Text(
                t.referencias
                    .where((r) => r.ref != null)
                    .map((r) => r.ref!.abreviada)
                    .join(', '),
                style: TextStyle(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
        ],
      ],
    );
  }

  Widget _mensagem(BuildContext context, String texto) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(texto,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium),
        ),
      );
}
