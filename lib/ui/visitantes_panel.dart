import 'package:diako_core/diako_core.dart';
import 'package:flutter/material.dart';

import '../app_scope.dart';
import 'dia_formato.dart';

/// Seção "Visitantes": quem chegou no dia e as pendências do pastor (quem pode ser
/// citado no culto). Projeta "Sejam bem-vindos!" no telão e dá baixa.
/// Com "Escolher dia", mostra os visitantes de outro dia dos últimos 30 (só leitura).
class VisitantesPanel extends StatefulWidget {
  const VisitantesPanel({super.key});

  @override
  State<VisitantesPanel> createState() => _VisitantesPanelState();
}

class _VisitantesPanelState extends State<VisitantesPanel> {
  /// Pendentes marcados para projetar só alguns (vazio: projeta todos os pendentes).
  final Set<String> _selecionados = {};
  bool _projetando = false;

  /// Dia escolhido; null = hoje (o dia de trabalho, com as ações de citar e projetar).
  DateTime? _dia;

  static const _interesses = {
    InteresseVisita.visitaPastoral: 'quer visita',
    InteresseVisita.oracao: 'quer oração',
    InteresseVisita.batismo: 'batismo',
    InteresseVisita.celula: 'grupo/célula',
  };
  static const _origens = {
    OrigemVisita.qr: 'pelo QR',
    OrigemVisita.recepcao: 'na recepção',
    OrigemVisita.painel: 'pela secretaria'
  };

  /// O servidor só manda a recepção ver os visitantes de hoje.
  static const _perfilSoHoje = 'Recepção';

  Future<void> _projetar() async {
    final scope = AppScope.of(context);
    final ids = _selecionados.isEmpty ? null : _selecionados.toList();
    setState(() => _projetando = true);
    final ok = await executar(
        context, () => scope.visitas.projetarBoasVindas(ids: ids),
        sucesso: 'Boas-vindas no telão');
    if (!mounted) return;
    setState(() {
      _projetando = false;
      if (ok) _selecionados.clear();
    });
  }

  Future<void> _escolherDia() async {
    final agora = DateTime.now();
    final escolhido = await showDatePicker(
      context: context,
      initialDate: _dia ?? agora,
      firstDate: DateTime(agora.year, agora.month, agora.day)
          .subtract(const Duration(days: 30)),
      lastDate: DateTime(agora.year, agora.month, agora.day),
      helpText: 'Visitantes de qual dia?',
      confirmText: 'Ver',
      cancelText: 'Cancelar',
    );
    if (escolhido == null || !mounted) return;
    setState(() => _dia = escolhido);
  }

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    final repo = scope.visitas;
    final podeProjetar = scope.conta.pode('projetar');
    final podeOutroDia = scope.conta.perfil != _perfilSoHoje;
    return ListenableBuilder(
      listenable: repo,
      builder: (context, _) {
        final dia = _dia;
        final hojeSelecionado = dia == null;
        final visitas = hojeSelecionado
            ? repo.hoje
            : (repo.todos.where((v) => v.data == diaIso(dia)).toList()
              ..sort((a, b) => a.criadoEm.compareTo(b.criadoEm)));
        final pendentes = repo.pendentes;
        _selecionados.removeWhere((id) => !pendentes.any((v) => v.id == id));
        final tema = Theme.of(context);
        final titulo = hojeSelecionado
            ? 'Visitantes de hoje'
            : 'Visitantes de ${dataCurta(dia)}';
        final contagem = visitas.isEmpty
            ? (hojeSelecionado
                ? 'Ninguém cadastrado ainda'
                : 'Ninguém cadastrado nesse dia')
            : '${visitas.length} ${visitas.length == 1 ? 'visitante' : 'visitantes'}'
                '${hojeSelecionado ? ' · ${pendentes.length} para citar' : ''}';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(titulo, style: tema.textTheme.titleLarge),
                        Text(
                          contagem,
                          style: tema.textTheme.bodyMedium?.copyWith(
                              color: tema.colorScheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                  if (!hojeSelecionado)
                    TextButton(
                      onPressed: () => setState(() => _dia = null),
                      child: const Text('Voltar para hoje'),
                    ),
                  if (podeOutroDia) ...[
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      onPressed: _escolherDia,
                      icon: const Icon(Icons.calendar_month),
                      label: const Text('Escolher dia'),
                    ),
                  ],
                  if (hojeSelecionado &&
                      podeProjetar &&
                      pendentes.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      onPressed: _projetando ? null : _projetar,
                      icon: const Icon(Icons.waving_hand_outlined),
                      label: Text(_selecionados.isEmpty
                          ? 'Projetar boas-vindas (${pendentes.length})'
                          : 'Projetar selecionados (${_selecionados.length})'),
                    ),
                  ],
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: visitas.isEmpty
                  ? Center(
                      child: Text(
                        hojeSelecionado
                            ? 'Quando a recepção cadastrar um visitante,\nele aparece aqui na hora.'
                            : 'Nenhum visitante cadastrado em ${dataCurta(dia)}.',
                        textAlign: TextAlign.center,
                        style: tema.textTheme.bodyLarge?.copyWith(
                            color: tema.colorScheme.onSurfaceVariant),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: visitas.length,
                      separatorBuilder: (_, __) =>
                          const Divider(height: 1, indent: 72),
                      itemBuilder: (context, i) => _item(context, visitas[i],
                          podeProjetar: podeProjetar && hojeSelecionado,
                          editavel: hojeSelecionado),
                    ),
            ),
          ],
        );
      },
    );
  }

  /// [editavel]: só as visitas de hoje podem ser citadas (e entram na projeção); as de outros dias são só leitura.
  Widget _item(BuildContext context, Visita v,
      {required bool podeProjetar, required bool editavel}) {
    final repo = AppScope.of(context).visitas;
    final tema = Theme.of(context);
    final detalhes = [
      v.primeiraVez ? '1ª visita' : 'voltou',
      _origens[v.origem] ?? '',
      for (final i in v.interesses) _interesses[i] ?? i.name,
    ].where((t) => t.isNotEmpty).join(' · ');
    final Widget? acao;
    if (!editavel) {
      acao = !v.mencionar
          ? const Chip(
              label: Text('Não citar'),
              avatar: Icon(Icons.do_not_disturb_on_outlined, size: 18))
          : v.mencionadaEm != null
              ? const Chip(
                  label: Text('Citado'),
                  avatar:
                      Icon(Icons.check_circle, size: 18, color: Colors.green))
              : null;
    } else if (!v.mencionar) {
      acao = const Chip(
          label: Text('Não citar'),
          avatar: Icon(Icons.do_not_disturb_on_outlined, size: 18));
    } else if (v.mencionadaEm != null) {
      acao = TextButton.icon(
        onPressed: () =>
            executar(context, () => repo.marcarMencionada(v, desfazer: true)),
        icon: const Icon(Icons.check_circle, color: Colors.green),
        label: const Text('Citado'),
      );
    } else {
      acao = OutlinedButton(
        onPressed: () => executar(context, () => repo.marcarMencionada(v),
            sucesso: '${v.nome} marcado como citado'),
        child: const Text('Já citei'),
      );
    }
    final pendente = v.pendente && podeProjetar;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
      leading: pendente
          ? Checkbox(
              value: _selecionados.contains(v.id),
              onChanged: (s) => setState(() => s == true
                  ? _selecionados.add(v.id)
                  : _selecionados.remove(v.id)),
            )
          : CircleAvatar(
              child: Text(v.nome.trim().isEmpty
                  ? '?'
                  : v.nome.trim()[0].toUpperCase())),
      title: Text(v.nome, style: tema.textTheme.titleMedium),
      subtitle: Text(detalhes),
      trailing: acao,
    );
  }
}
