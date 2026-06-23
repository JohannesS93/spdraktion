import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../profile/me_store.dart';
import 'slot_detail_page.dart';

class SlotsPage extends StatefulWidget {
  const SlotsPage({super.key, required this.meStore});

  final MeStore meStore;

  @override
  State<SlotsPage> createState() => _SlotsPageState();
}

class _SlotsPageState extends State<SlotsPage> {
  final api = ApiClient(AppConfig.apiBaseUrl);

  List<Map<String, dynamic>> slots = [];
  bool isLoading = true;

  String get currentUserId {
    final id = widget.meStore.id;
    if (id == null || id.isEmpty) {
      throw Exception('MeStore hat keine userId');
    }
    return id;
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => isLoading = true);

    try {
      final data = await api.getJson(
        '/me/upcoming-slots',
        query: {'user_id': currentUserId},
      ) as List<dynamic>;

      setState(() {
        slots = data.map((e) => e as Map<String, dynamic>).toList();
      });
    } catch (e) {
      _showSnack('Fehler beim Laden: $e');
    } finally {
      if (mounted) {
        setState(() => isLoading = false);
      }
    }
  }

  void _showSnack(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mein Dienstplan'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: isLoading
            ? const Center(child: CircularProgressIndicator())
            : slots.isEmpty
                ? ListView(
                    children: const [
                      SizedBox(height: 120),
                      Center(child: Text('Keine kommenden Dienste')),
                    ],
                  )
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: slots.length,
                    itemBuilder: (context, i) {
                      final s = slots[i];
                      final assignmentType = _assignmentType(s);
                      final isRuf = assignmentType == 'ruf';

                      final title =
                          '${s['weekday']} · ${s['date']} · ${s['slot_code']}';
                      final subtitle = _timeText(s);

                      return Card(
                        margin: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        child: ListTile(
                          leading: _AssignmentBadge(type: assignmentType),
                          title: Text(
                            title,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            isRuf
                                ? '$subtitle · Rufbereitschaft in der Nähe'
                                : '$subtitle · Präsenzdienst',
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => SlotDetailPage(
                                  slotId: s['slot_id'] as String,
                                  title:
                                      '${s['weekday']}, ${s['date']} • ${s['slot_code']}',
                                  subtitle: isRuf
                                      ? '$subtitle · Rufbereitschaft'
                                      : '$subtitle · Präsenzdienst',
                                  meStore: widget.meStore,
                                ),
                              ),
                            );
                          },
                        ),
                      );
                    },
                  ),
      ),
    );
  }

  String _timeText(Map<String, dynamic> s) {
    final start = _hhmm(s['start_time']);
    final end = _hhmmNullable(s['end_time']);

    if (end == null || end.isEmpty) {
      return '$start Uhr';
    }

    return '$start – $end Uhr';
  }

  String _assignmentType(Map<String, dynamic> s) {
    final value = (s['assignment_type'] ?? '').toString();
    return value == 'ruf' ? 'ruf' : 'active';
  }

  String _hhmm(dynamic value) {
    final text = (value ?? '').toString();
    if (text.length >= 5) return text.substring(0, 5);
    return text;
  }

  String? _hhmmNullable(dynamic value) {
    if (value == null) return null;
    final text = value.toString();
    if (text.isEmpty) return null;
    if (text.length >= 5) return text.substring(0, 5);
    return text;
  }
}

class _AssignmentBadge extends StatelessWidget {
  const _AssignmentBadge({required this.type});

  final String type;

  @override
  Widget build(BuildContext context) {
    final isRuf = type == 'ruf';
    final color = isRuf ? Colors.amber.shade800 : Colors.green.shade700;
    final background = isRuf ? Colors.amber.shade100 : Colors.green.shade100;
    final icon = isRuf ? Icons.phone_in_talk_outlined : Icons.how_to_reg;
    final label = isRuf ? 'Ruf' : 'Aktiv';

    return Tooltip(
      message: isRuf
          ? 'Rufbereitschaft: in der Nähe bleiben'
          : 'Präsenzdienst vor Ort',
      child: Container(
        width: 58,
        padding: const EdgeInsets.symmetric(vertical: 6),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: color),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
