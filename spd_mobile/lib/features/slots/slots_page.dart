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

                      final title =
                          '${s['weekday']} · ${s['date']} · ${s['slot_code']}';
                      final subtitle = _timeText(s);

                      return Card(
                        margin: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        child: ListTile(
                          title: Text(
                            title,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(subtitle),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => SlotDetailPage(
                                  slotId: s['slot_id'] as String,
                                  title:
                                      '${s['weekday']}, ${s['date']} • ${s['slot_code']}',
                                  subtitle: subtitle,
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