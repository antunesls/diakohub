import 'dart:async';

import 'package:flutter/material.dart';

import '../../app_scope.dart';
import 'atas_tab.dart';
import 'casa_tab.dart';
import 'membros_tab.dart';

/// Área pastoral, separada do operacional do culto: membros, Gestão da Casa e atas.
/// Nada daqui fica salvo no tablet (os dados vêm do servidor a cada abertura) e a tela
/// fecha sozinha depois de [inatividade] parada ou quando o app vai para o fundo.
class GestaoPage extends StatefulWidget {
  const GestaoPage({super.key, this.inatividade = const Duration(minutes: 5)});

  final Duration inatividade;

  /// Perfis que veem o botão "Gestão" no trilho.
  static bool disponivel(AppScope scope) =>
      scope.conta.pode('membros') || scope.conta.pode('gestaoCasa') || scope.conta.pode('atas');

  @override
  State<GestaoPage> createState() => _GestaoPageState();
}

class _GestaoPageState extends State<GestaoPage> with WidgetsBindingObserver {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _reiniciarTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) _fechar();
  }

  void _reiniciarTimer() {
    _timer?.cancel();
    _timer = Timer(widget.inatividade, _fechar);
  }

  /// Fecha esta área e o que estiver aberto por cima (ficha, diálogo), voltando à tela do culto.
  void _fechar() {
    if (!mounted) return;
    final propria = ModalRoute.of(context);
    Navigator.of(context).popUntil((r) => r.isFirst || r == propria);
    if (propria != null && !propria.isFirst && propria.isCurrent) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final conta = AppScope.of(context).conta;
    final abas = <(Tab, Widget)>[
      if (conta.pode('membros')) (const Tab(icon: Icon(Icons.people_outline), text: 'Membros'), const MembrosTab()),
      if (conta.pode('gestaoCasa')) (const Tab(icon: Icon(Icons.home_repair_service_outlined), text: 'Gestão da Casa'), const CasaTab()),
      if (conta.pode('atas')) (const Tab(icon: Icon(Icons.description_outlined), text: 'Atas'), const AtasTab()),
    ];
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _reiniciarTimer(),
      child: DefaultTabController(
        length: abas.length,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Gestão pastoral'),
            leading: IconButton(
              tooltip: 'Voltar ao culto',
              icon: const Icon(Icons.arrow_back),
              onPressed: () => Navigator.of(context).pop(),
            ),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 16),
                child: Center(
                  child: Text('Fecha sozinha após ${widget.inatividade.inMinutes} min parada',
                      style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.outline)),
                ),
              ),
            ],
            bottom: abas.length > 1 ? TabBar(tabs: [for (final a in abas) a.$1]) : null,
          ),
          body: abas.isEmpty
              ? const Center(child: Text('Seu perfil não tem acesso a esta área.'))
              : abas.length == 1
                  ? abas.single.$2
                  : TabBarView(physics: const NeverScrollableScrollPhysics(), children: [for (final a in abas) a.$2]),
        ),
      ),
    );
  }
}

/// Carrega dados do servidor sem guardar cópia: mostra carregando, erro com "Tentar de novo" ou o conteúdo.
class CarregarDoServidor<T> extends StatefulWidget {
  const CarregarDoServidor({super.key, required this.carregar, required this.construir});

  final Future<T> Function() carregar;
  final Widget Function(BuildContext context, T dados, Future<void> Function() recarregar) construir;

  @override
  State<CarregarDoServidor<T>> createState() => _CarregarDoServidorState<T>();
}

class _CarregarDoServidorState<T> extends State<CarregarDoServidor<T>> {
  T? _dados;
  String? _erro;
  bool _carregando = true;

  @override
  void initState() {
    super.initState();
    _recarregar();
  }

  Future<void> _recarregar() async {
    setState(() {
      _carregando = _dados == null;
      _erro = null;
    });
    try {
      final d = await widget.carregar();
      if (mounted) setState(() => _dados = d);
    } catch (e) {
      if (mounted) setState(() => _erro = '$e');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dados = _dados;
    if (_carregando && dados == null) return const Center(child: CircularProgressIndicator());
    if (dados == null) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.cloud_off, size: 40),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Text(_erro ?? 'Não foi possível carregar.', textAlign: TextAlign.center),
          ),
          const SizedBox(height: 4),
          const Text('Esta área só funciona com internet: nada fica salvo no tablet.'),
          const SizedBox(height: 12),
          FilledButton(onPressed: _recarregar, child: const Text('Tentar de novo')),
        ]),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_erro != null)
          MaterialBanner(
            content: Text(_erro!),
            actions: [TextButton(onPressed: _recarregar, child: const Text('Tentar de novo'))],
          ),
        Expanded(child: widget.construir(context, dados, _recarregar)),
      ],
    );
  }
}

/// "10/11/2026" a partir de "2026-11-10" (vazio se não for data).
String dataBr(String? iso) =>
    iso == null || iso.length < 10 ? '' : '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}';

/// Dia local em aaaa-mm-dd.
String hojeIso([DateTime? d]) {
  final x = d ?? DateTime.now();
  return '${x.year.toString().padLeft(4, '0')}-${x.month.toString().padLeft(2, '0')}-${x.day.toString().padLeft(2, '0')}';
}
