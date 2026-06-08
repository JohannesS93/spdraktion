import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../profile/me_store.dart';

class AttendanceStatsPage extends StatefulWidget {
  const AttendanceStatsPage({super.key, required this.meStore});

  final MeStore meStore;

  @override
  State<AttendanceStatsPage> createState() => _AttendanceStatsPageState();
}

class _AttendanceStatsPageState extends State<AttendanceStatsPage> {
  final api = ApiClient(AppConfig.apiBaseUrl);
  late Future<List<Map<String, dynamic>>> future;

  late DateTime fromDate;
  late DateTime toDate;

  String searchText = '';
  String statusFilter = 'alle';

  @override
  void initState() {
    super.initState();
    fromDate = DateTime(2026, 1, 1);
    toDate = DateTime(2026, 12, 31);
    future = load();
  }

  Future<List<Map<String, dynamic>>> load() async {
    final res = await api.getJson(
      '/attendance/stats',
      query: {
        'from_date': _apiDate(fromDate),
        'to_date': _apiDate(toDate),
      },
    ) as List<dynamic>;

    return res.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<void> refresh() async {
    setState(() {
      future = load();
    });
    await future;
  }

  Future<void> pickFromDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: fromDate,
      firstDate: DateTime(2020, 1, 1),
      lastDate: DateTime(2035, 12, 31),
    );

    if (picked != null) {
      setState(() {
        fromDate = picked;
        if (fromDate.isAfter(toDate)) {
          toDate = fromDate;
        }
        future = load();
      });
    }
  }

  Future<void> pickToDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: toDate,
      firstDate: DateTime(2020, 1, 1),
      lastDate: DateTime(2035, 12, 31),
    );

    if (picked != null) {
      setState(() {
        toDate = picked;
        if (toDate.isBefore(fromDate)) {
          fromDate = toDate;
        }
        future = load();
      });
    }
  }

  List<Map<String, dynamic>> _applyFilters(List<Map<String, dynamic>> stats) {
    return stats.where((s) {
      final name = '${s['first_name']} ${s['last_name']}'.toLowerCase();
      final rate = ((s['completion_rate'] ?? 0) as num).toDouble();

      final matchesSearch =
          searchText.isEmpty || name.contains(searchText.toLowerCase());

      final matchesStatus = _matchesStatusFilter(rate);

      return matchesSearch && matchesStatus;
    }).toList();
  }

  bool _matchesStatusFilter(double rate) {
    switch (statusFilter) {
      case 'niedrig':
        return rate < 50;
      case 'mittel':
        return rate >= 50 && rate < 80;
      case 'gut':
        return rate >= 80;
      case 'alle':
      default:
        return true;
    }
  }

  Future<void> _exportPdf(List<Map<String, dynamic>> stats) async {
    final filtered = _applyFilters(stats);

    final regularFont = pw.Font.ttf(
      await rootBundle.load('assets/fonts/NotoSans-Regular.ttf'),
    );
    final boldFont = pw.Font.ttf(
      await rootBundle.load('assets/fonts/NotoSans-Bold.ttf'),
    );

    final pdf = pw.Document();

    final headers = ['#', 'Name', 'Erledigt', 'Geplant', '%', 'Status'];

    final data = <List<String>>[];
    for (var i = 0; i < filtered.length; i++) {
      final s = filtered[i];
      final name = '${s['first_name']} ${s['last_name']}';
      final planned = (s['planned_count'] ?? 0) as int;
      final done = (s['done_count'] ?? 0) as int;
      final rate = ((s['completion_rate'] ?? 0) as num).toDouble();

      data.add([
        '${i + 1}',
        name,
        '$done',
        '$planned',
        '${rate.toStringAsFixed(1)}%',
        _rateLabel(rate),
      ]);
    }

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(28),
        theme: pw.ThemeData.withFont(
          base: regularFont,
          bold: boldFont,
        ),
        build: (context) => [
          pw.Text(
            'Sitzungsdienst-Auswertung',
            style: pw.TextStyle(
              fontSize: 20,
              fontWeight: pw.FontWeight.bold,
            ),
          ),
          pw.SizedBox(height: 6),
          pw.Text(
            'Zeitraum: ${_uiDate(fromDate)} bis ${_uiDate(toDate)}',
            style: const pw.TextStyle(fontSize: 11),
          ),
          if (searchText.isNotEmpty) ...[
            pw.SizedBox(height: 2),
            pw.Text(
              'Suchfilter: $searchText',
              style: const pw.TextStyle(fontSize: 11),
            ),
          ],
          if (statusFilter != 'alle') ...[
            pw.SizedBox(height: 2),
            pw.Text(
              'Statusfilter: ${_statusLabel(statusFilter)}',
              style: const pw.TextStyle(fontSize: 11),
            ),
          ],
          pw.SizedBox(height: 16),
          pw.TableHelper.fromTextArray(
            headers: headers,
            data: data,
            headerStyle: pw.TextStyle(
              fontWeight: pw.FontWeight.bold,
              color: PdfColors.white,
              fontSize: 9,
            ),
            headerDecoration: const pw.BoxDecoration(
              color: PdfColors.red700,
            ),
            cellStyle: const pw.TextStyle(fontSize: 8),
            cellAlignment: pw.Alignment.centerLeft,
            headerAlignment: pw.Alignment.centerLeft,
            cellPadding: const pw.EdgeInsets.symmetric(
              horizontal: 6,
              vertical: 6,
            ),
            columnWidths: {
              0: const pw.FixedColumnWidth(24),
              1: const pw.FlexColumnWidth(5),
              2: const pw.FixedColumnWidth(60),
              3: const pw.FixedColumnWidth(60),
              4: const pw.FixedColumnWidth(50),
              5: const pw.FixedColumnWidth(60),
            },
            rowDecoration: const pw.BoxDecoration(
              border: pw.Border(
                bottom: pw.BorderSide(color: PdfColors.grey300, width: 0.5),
              ),
            ),
          ),
        ],
      ),
    );

    await Printing.layoutPdf(
      onLayout: (format) async => pdf.save(),
      name:
          'sitzungsdienst_auswertung_${_apiDate(fromDate)}_${_apiDate(toDate)}.pdf',
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.meStore.isPgf) {
      return const Scaffold(
        body: Center(child: Text('Kein Zugriff')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sitzungsdienst-Auswertung'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: pickFromDate,
                            icon: const Icon(Icons.date_range),
                            label: Text('Von: ${_uiDate(fromDate)}'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: pickToDate,
                            icon: const Icon(Icons.date_range),
                            label: Text('Bis: ${_uiDate(toDate)}'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      decoration: const InputDecoration(
                        labelText: 'Nach Name suchen',
                        prefixIcon: Icon(Icons.search),
                        border: OutlineInputBorder(),
                      ),
                      onChanged: (value) {
                        setState(() {
                          searchText = value.trim();
                        });
                      },
                    ),
                    const SizedBox(height: 8),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          ChoiceChip(
                            label: const Text('Alle'),
                            selected: statusFilter == 'alle',
                            onSelected: (_) {
                              setState(() {
                                statusFilter = 'alle';
                              });
                            },
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: const Text('Niedrig'),
                            selected: statusFilter == 'niedrig',
                            onSelected: (_) {
                              setState(() {
                                statusFilter = 'niedrig';
                              });
                            },
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: const Text('Mittel'),
                            selected: statusFilter == 'mittel',
                            onSelected: (_) {
                              setState(() {
                                statusFilter = 'mittel';
                              });
                            },
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: const Text('Gut'),
                            selected: statusFilter == 'gut',
                            onSelected: (_) {
                              setState(() {
                                statusFilter = 'gut';
                              });
                            },
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Übersicht über erledigte Sitzungsdienste im gewählten Zeitraum',
                        style: TextStyle(
                          color: Colors.grey.shade700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: future,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (snap.hasError) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        'Fehler:\n${snap.error}',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  );
                }

                final stats = snap.data ?? [];
                final filtered = _applyFilters(stats);

                if (filtered.isEmpty) {
                  return const Center(
                    child: Text('Keine passenden Daten gefunden'),
                  );
                }

                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: FilledButton.icon(
                          onPressed: () => _exportPdf(stats),
                          icon: const Icon(Icons.picture_as_pdf),
                          label: const Text('PDF exportieren'),
                        ),
                      ),
                    ),
                    Expanded(
                      child: RefreshIndicator(
                        onRefresh: refresh,
                        child: ListView.builder(
                          padding: const EdgeInsets.all(12),
                          itemCount: filtered.length,
                          itemBuilder: (context, i) {
                            final s = filtered[i];

                            final name =
                                '${s['first_name']} ${s['last_name']}';
                            final planned = (s['planned_count'] ?? 0) as int;
                            final done = (s['done_count'] ?? 0) as int;
                            final rate =
                                ((s['completion_rate'] ?? 0) as num).toDouble();

                            final ampelColor = _rateColor(rate);
                            final ampelLabel = _rateLabel(rate);

                            return Card(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    CircleAvatar(
                                      radius: 18,
                                      child: Text(
                                        '${i + 1}',
                                        style: const TextStyle(fontSize: 12),
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              Expanded(
                                                child: Text(
                                                  name,
                                                  style: const TextStyle(
                                                    fontWeight: FontWeight.w700,
                                                    fontSize: 15,
                                                  ),
                                                ),
                                              ),
                                              Container(
                                                width: 12,
                                                height: 12,
                                                decoration: BoxDecoration(
                                                  color: ampelColor,
                                                  shape: BoxShape.circle,
                                                ),
                                              ),
                                              const SizedBox(width: 6),
                                              Text(
                                                ampelLabel,
                                                style: TextStyle(
                                                  color: ampelColor,
                                                  fontWeight: FontWeight.w600,
                                                  fontSize: 13,
                                                ),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 6),
                                          Text(
                                            'Erledigt: $done   |   Geplant: $planned   |   Quote: ${rate.toStringAsFixed(1)}%',
                                            style: TextStyle(
                                              color: Colors.grey.shade700,
                                              fontSize: 13,
                                            ),
                                          ),
                                          const SizedBox(height: 8),
                                          LinearProgressIndicator(
                                            value: planned == 0
                                                ? 0
                                                : done / planned,
                                            minHeight: 8,
                                            borderRadius:
                                                BorderRadius.circular(999),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  String _apiDate(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

  String _uiDate(DateTime d) => DateFormat('dd.MM.yyyy').format(d);

  String _statusLabel(String value) {
    switch (value) {
      case 'niedrig':
        return 'Niedrig';
      case 'mittel':
        return 'Mittel';
      case 'gut':
        return 'Gut';
      case 'alle':
      default:
        return 'Alle';
    }
  }

  Color _rateColor(double rate) {
    if (rate >= 80) return Colors.green;
    if (rate >= 50) return Colors.orange;
    return Colors.red;
  }

  String _rateLabel(double rate) {
    if (rate >= 80) return 'gut';
    if (rate >= 50) return 'mittel';
    return 'niedrig';
  }
}