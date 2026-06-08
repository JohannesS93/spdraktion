import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../profile/me_store.dart';

class CurrentSessionPage extends StatefulWidget {
  const CurrentSessionPage({super.key, required this.meStore});

  final MeStore meStore;

  @override
  State<CurrentSessionPage> createState() => _CurrentSessionPageState();
}

class _CurrentSessionPageState extends State<CurrentSessionPage> {
  final api = ApiClient(AppConfig.apiBaseUrl);

  Map<String, dynamic>? slot;
  List<Map<String, dynamic>> participants = [];
  final Set<String> savingUserIds = {};

  bool isLoading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => isLoading = true);

    try {
      final data =
          await api.getJson('/pgf/current-session') as Map<String, dynamic>;

      setState(() {
        slot = data['slot'];
        participants = (data['participants'] as List<dynamic>)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      });
    } catch (e) {
      _showSnack('Fehler beim Laden: $e');
    } finally {
      if (mounted) {
        setState(() => isLoading = false);
      }
    }
  }

  Future<void> _toggleAttendance(String userId, bool isChecked) async {
    if (slot == null) return;

    final index = participants.indexWhere((p) => p['user_id'] == userId);
    if (index == -1) return;

    final newValue = !isChecked;

    setState(() {
      savingUserIds.add(userId);
      participants[index]['is_checked'] = newValue;
      participants[index]['checked'] = newValue;
    });

    try {
      await api.postJson('/slots/${slot!['id']}/attendance/toggle', {
        'user_id': userId,
        'actor_user_id': widget.meStore.id,
      });

      await _load();
    } catch (e) {
      if (mounted) {
        setState(() {
          participants[index]['is_checked'] = isChecked;
          participants[index]['checked'] = isChecked;
        });
      }
      _showSnack('Fehler beim Speichern: $e');
    } finally {
      if (mounted) {
        setState(() {
          savingUserIds.remove(userId);
        });
      }
    }
  }

  void _showSnack(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.meStore.isPgf) {
      return const Scaffold(body: Center(child: Text('Kein Zugriff')));
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Aktuelle Session'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: isLoading
          ? const Center(child: CircularProgressIndicator())
          : slot == null
          ? const Center(child: Text('Keine laufende Session'))
          : Column(
              children: [
                _buildHeader(),
                const Divider(height: 1),
                Expanded(
                  child: ListView.builder(
                    itemCount: participants.length,
                    itemBuilder: (context, i) {
                      final p = participants[i];
                      final isChecked =
                          p['is_checked'] == true || p['checked'] == true;
                      final isSaving = savingUserIds.contains(p['user_id']);

                      return ListTile(
                        leading: Icon(
                          isChecked ? Icons.check_circle : Icons.cancel,
                          color: isChecked ? Colors.green : Colors.red,
                        ),
                        title: Text('${p['first_name']} ${p['last_name']}'),
                        trailing: isSaving
                            ? const SizedBox(
                                width: 24,
                                height: 24,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Switch(
                                value: isChecked,
                                onChanged: (_) => _toggleAttendance(
                                  p['user_id'] as String,
                                  isChecked,
                                ),
                              ),
                      );
                    },
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildHeader() {
    final code = slot!['slot_code'] ?? '';
    final date = slot!['date'] ?? '';
    final start = _hhmm(slot!['start_time']);
    final end = _hhmmNullable(slot!['end_time']);

    final time = (end == null || end.isEmpty)
        ? '$start Uhr'
        : '$start–$end Uhr';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      color: Colors.grey.shade100,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            code,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text('$date • $time'),
        ],
      ),
    );
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
