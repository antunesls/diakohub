/// Data para mostrar ao usuário: "05/11/2026".
String dataCurta(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

/// Data no formato do servidor ("2026-11-05") para mostrar: "05/11/2026". Sem data válida, vazio.
String dataBr(String iso) {
  final d = DateTime.tryParse(iso);
  return d == null ? '' : dataCurta(d);
}
