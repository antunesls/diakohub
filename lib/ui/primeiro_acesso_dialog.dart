import 'package:flutter/material.dart';

import '../app_scope.dart';
import '../sync/server_api.dart';

/// Primeiro acesso: a conta entrou com a senha temporária e precisa criar a própria antes de
/// usar o app (o servidor recusa o resto até a troca). Devolve true quando a senha foi criada.
Future<bool> criarSenhaPrimeiroAcesso(BuildContext context, String base, String sessao, String temporaria) async {
  final api = AppScope.of(context).api;
  final ok = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _PrimeiroAcessoDialog(
      criar: (nova) => api.criarMinhaSenha(base, sessao, atual: temporaria, nova: nova),
      temporaria: temporaria,
    ),
  );
  return ok ?? false;
}

class _PrimeiroAcessoDialog extends StatefulWidget {
  const _PrimeiroAcessoDialog({required this.criar, required this.temporaria});

  final Future<void> Function(String nova) criar;
  final String temporaria;

  @override
  State<_PrimeiroAcessoDialog> createState() => _PrimeiroAcessoDialogState();
}

class _PrimeiroAcessoDialogState extends State<_PrimeiroAcessoDialog> {
  final _nova = TextEditingController();
  final _confirma = TextEditingController();
  bool _mostrar = false;
  bool _salvando = false;
  String? _erro;

  @override
  void dispose() {
    _nova.dispose();
    _confirma.dispose();
    super.dispose();
  }

  Future<void> _salvar() async {
    final nova = _nova.text.trim();
    String? erro;
    if (nova.isEmpty) {
      erro = 'Digite a nova senha.';
    } else if (nova != _confirma.text.trim()) {
      erro = 'As duas senhas não são iguais.';
    } else if (nova == widget.temporaria) {
      erro = 'Escolha uma senha diferente da temporária.';
    }
    if (erro != null) {
      setState(() => _erro = erro);
      return;
    }
    setState(() {
      _salvando = true;
      _erro = null;
    });
    try {
      await widget.criar(nova);
      if (mounted) Navigator.of(context).pop(true);
    } on ErroAmigavel catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } finally {
      if (mounted) setState(() => _salvando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Crie a sua senha'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Este é o seu primeiro acesso. A senha que você recebeu é temporária: '
                  'escolha uma só sua para continuar.'),
              const SizedBox(height: 16),
              TextField(
                controller: _nova,
                obscureText: !_mostrar,
                autofocus: true,
                enabled: !_salvando,
                decoration: const InputDecoration(labelText: 'Nova senha', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _confirma,
                obscureText: !_mostrar,
                enabled: !_salvando,
                onSubmitted: (_) => _salvar(),
                decoration: const InputDecoration(labelText: 'Repita a nova senha', border: OutlineInputBorder()),
              ),
              CheckboxListTile(
                value: _mostrar,
                onChanged: (v) => setState(() => _mostrar = v ?? false),
                title: const Text('Mostrar as senhas'),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
              ),
              if (_erro != null)
                Text(_erro!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _salvando ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _salvando ? null : _salvar,
          child: Text(_salvando ? 'Salvando…' : 'Criar senha e entrar'),
        ),
      ],
    );
  }
}
