import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../profile/me_store.dart';

class AttendancePage extends StatefulWidget {
  const AttendancePage({
    super.key,
    required this.slotId,
    required this.meStore,
  });

  final String slotId;
  final MeStore meStore;

  @override
  State<AttendancePage> createState() => _AttendancePageState();
}

class _AttendancePageState extends State<AttendancePage> {
  late final ApiClient api;
  late Future<List<Map<String, dynamic>>> future;

  @override
  void initState() {
    super.initState();
    api = ApiClient(AppConfig.apiBaseUrl);
    future = load();
  }

  Future<List<Map<String, dynamic>>> load() async {
    final res =
        await api.getJson('/slots/${widget.slotId}/attendance')
            as List<dynamic>;
    return res.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<void> toggle(String userId) async {
    await api.postJson('/slots/${widget.slotId}/attendance/toggle', {
      'user_id': userId,
      'actor_user_id': widget.meStore.id,
    });

    setState(() {
      future = load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sitzungsdienst abhaken')),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: future,
        builder: (context, snap) {
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }

          final list = snap.data!;

          return ListView(
            children: list.map((e) {
              final checked = e['checked'] == true;

              return CheckboxListTile(
                value: checked,
                title: Text('${e['first_name']} ${e['last_name']}'),
                onChanged: (_) => toggle(e['id']),
              );
            }).toList(),
          );
        },
      ),
    );
  }
}
