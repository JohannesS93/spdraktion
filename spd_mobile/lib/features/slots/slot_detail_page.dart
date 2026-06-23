import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/feature_flags.dart';
import '../attendance/attendance_page.dart';
import '../profile/me_store.dart';

class SlotDetailPage extends StatefulWidget {
  const SlotDetailPage({
    super.key,
    required this.slotId,
    required this.title,
    required this.subtitle,
    required this.meStore,
  });

  final String slotId;
  final String title;
  final String subtitle;
  final MeStore meStore;

  @override
  State<SlotDetailPage> createState() => _SlotDetailPageState();
}

class _SlotDetailPageState extends State<SlotDetailPage> {
  final api = ApiClient(AppConfig.apiBaseUrl);
  late Future<_SlotDetailData> future;

  String get loadedUserId {
    final value = widget.meStore.id;
    if (value == null || value.isEmpty) {
      throw Exception('MeStore hat noch keine userId geladen');
    }
    return value;
  }

  @override
  void initState() {
    super.initState();
    future = load();
  }

  Future<_SlotDetailData> load() async {
    String? userId = widget.meStore.id;

    if (userId == null || userId.isEmpty) {
      await widget.meStore.loadMe();
      userId = widget.meStore.id;
    }

    if (userId == null || userId.isEmpty) {
      throw Exception('MeStore hat noch keine userId geladen');
    }

    final participantsRaw =
        await api.getJson('/slots/${widget.slotId}/participants')
            as List<dynamic>;
    final exchangesRaw = exchangesEnabled
        ? await api.getJson('/slots/${widget.slotId}/exchanges')
              as List<dynamic>
        : <dynamic>[];
    final attendanceAccessRaw =
        await api.getJson('/slots/${widget.slotId}/attendance-access')
            as Map<String, dynamic>;

    final participants = participantsRaw
        .map((e) => e as Map<String, dynamic>)
        .toList();
    final exchanges = exchangesRaw
        .map((e) => e as Map<String, dynamic>)
        .toList();
    final canManageAttendance =
        attendanceAccessRaw['can_manage_attendance'] == true;

    return _SlotDetailData(
      participants: participants,
      exchanges: exchanges,
      canManageAttendance: canManageAttendance,
    );
  }

  Future<void> _offerExchange() async {
    await api.postJson('/exchanges', {
      'slot_id': widget.slotId,
      'mode': 'SWAP',
      'from_user_id': loadedUserId,
      'to_user_id': null,
    });
    setState(() => future = load());
  }

  Future<void> _acceptExchange(String exchangeId) async {
    await api.postJson('/exchanges/$exchangeId/accept', {
      'to_user_id': loadedUserId,
    });
    setState(() => future = load());
  }

  Future<void> _confirmExchange(String exchangeId) async {
    await api.postJson('/exchanges/$exchangeId/confirm', {
      'actor_user_id': loadedUserId,
    });
    setState(() => future = load());
  }

  bool _needsMyConfirm(Map<String, dynamic> e) {
    final from = e['from_user'] as Map<String, dynamic>;
    final to = e['to_user'] as Map<String, dynamic>?;
    final conf = (e['confirmations'] as Map<String, dynamic>?);
    final fromConfirmedAt = conf?['from_confirmed_at'];
    final toConfirmedAt = conf?['to_confirmed_at'];

    if (from['id'] == loadedUserId && fromConfirmedAt == null) return true;
    if (to != null && to['id'] == loadedUserId && toConfirmedAt == null) {
      return true;
    }
    return false;
  }

  String _assignmentLabel(Map<String, dynamic> participant) {
    final value = participant['assignment_type'];
    if (value == 'active') return 'Aktiv · Präsenzdienst';
    if (value == 'ruf') return 'Ruf · in der Nähe bleiben';
    return 'Nicht zugewiesen';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Slot-Detail')),
      body: FutureBuilder<_SlotDetailData>(
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

          final data = snap.data!;

          final isMeParticipant = data.participants.any(
            (p) => p['user_id'] == loadedUserId,
          );

          final iAlreadyOfferedOpen = data.exchanges.any(
            (e) =>
                (e['status'] == 'OPEN') &&
                ((e['from_user'] as Map<String, dynamic>)['id'] ==
                    loadedUserId) &&
                (e['to_user'] == null),
          );

          return RefreshIndicator(
            onRefresh: () async {
              setState(() => future = load());
              await future;
            },
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  widget.title,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(widget.subtitle),
                const SizedBox(height: 12),

                if (isMeParticipant && exchangesEnabled)
                  FilledButton.icon(
                    onPressed: iAlreadyOfferedOpen ? null : _offerExchange,
                    icon: const Icon(Icons.add),
                    label: Text(
                      iAlreadyOfferedOpen
                          ? 'Bereits angeboten'
                          : 'Ich biete an (Abgeben)',
                    ),
                  )
                else
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text(
                        'Du hast in diesem Slot keinen Dienst – daher kannst du ihn nicht anbieten.',
                      ),
                    ),
                  ),

                if (!exchangesEnabled) ...[
                  const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(
                        'Das Tauschtool bleibt vorerst deaktiviert und wird später freigeschaltet.',
                        style: TextStyle(color: Colors.grey.shade700),
                      ),
                    ),
                  ),
                ],

                if (data.canManageAttendance) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => AttendancePage(
                            slotId: widget.slotId,
                            meStore: widget.meStore,
                          ),
                        ),
                      );
                    },
                    icon: const Icon(Icons.checklist),
                    label: const Text('Sitzungsdienst abhaken'),
                  ),
                ],

                const SizedBox(height: 16),
                const SizedBox(height: 12),

                const SizedBox(height: 12),
                const _SectionTitle('Teilnehmer'),
                const SizedBox(height: 8),
                Card(
                  child: Column(
                    children: [
                      for (final p in data.participants)
                        ListTile(
                          dense: true,
                          title: Text('${p['first_name']} ${p['last_name']}'),
                          subtitle: Text(_assignmentLabel(p)),
                        ),
                    ],
                  ),
                ),

                const SizedBox(height: 16),
                const _SectionTitle('Tauschbörse'),
                const SizedBox(height: 8),

                if (!exchangesEnabled)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text('Die Tauschbörse ist aktuell deaktiviert.'),
                    ),
                  )
                else if (data.exchanges.isEmpty)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text('Keine Tauschangebote für diesen Slot.'),
                    ),
                  )
                else
                  Card(
                    child: Column(
                      children: [
                        for (final e in data.exchanges)
                          _ExchangeTile(
                            exchange: e,
                            onAccept: () => _acceptExchange(e['exchange_id']),
                            onConfirm: () => _confirmExchange(e['exchange_id']),
                            canAccept:
                                (e['status'] == 'OPEN' &&
                                e['to_user'] == null &&
                                (e['from_user']
                                        as Map<String, dynamic>)['id'] !=
                                    loadedUserId),
                            needsMyConfirm: _needsMyConfirm(e),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _SlotDetailData {
  _SlotDetailData({
    required this.participants,
    required this.exchanges,
    required this.canManageAttendance,
  });

  final List<Map<String, dynamic>> participants;
  final List<Map<String, dynamic>> exchanges;
  final bool canManageAttendance;
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
    );
  }
}

class _ExchangeTile extends StatelessWidget {
  const _ExchangeTile({
    required this.exchange,
    required this.onAccept,
    required this.onConfirm,
    required this.canAccept,
    required this.needsMyConfirm,
  });

  final Map<String, dynamic> exchange;
  final VoidCallback onAccept;
  final VoidCallback onConfirm;
  final bool canAccept;
  final bool needsMyConfirm;

  @override
  Widget build(BuildContext context) {
    final status = exchange['status'] ?? '';
    final from = exchange['from_user'] as Map<String, dynamic>;
    final to = exchange['to_user'] as Map<String, dynamic>?;

    final fromName = '${from['first_name']} ${from['last_name']}';
    final fromGroup = from['group'];
    final toText = to == null
        ? '— (offen)'
        : '${to['first_name']} ${to['last_name']} (Gruppe ${to['group']})';

    return ListTile(
      title: Text('$fromName (Gruppe $fromGroup) → $toText'),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            _StatusChip(status: status),
            if (to == null) const Text('Offen für Übernahme'),
          ],
        ),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (canAccept)
            TextButton(onPressed: onAccept, child: const Text('Ich übernehme')),
          if (!canAccept && needsMyConfirm)
            FilledButton(onPressed: onConfirm, child: const Text('Bestätigen')),
          if (!canAccept && !needsMyConfirm && status == 'CONFIRMED')
            const Icon(Icons.check_circle, color: Colors.green),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      'OPEN' => 'OFFEN',
      'PENDING_CONFIRMATION' => 'BESTÄTIGUNG AUSSTEHEND',
      'CONFIRMED' => 'BESTÄTIGT',
      'CANCELLED' => 'ABGEBROCHEN',
      _ => status,
    };

    final color = switch (status) {
      'OPEN' => Colors.grey,
      'PENDING_CONFIRMATION' => Colors.orange,
      'CONFIRMED' => Colors.green,
      'CANCELLED' => Colors.red,
      _ => Colors.blueGrey,
    };

    return Chip(
      label: Text(label),
      backgroundColor: color.withValues(alpha: 0.15),
      side: BorderSide(color: color.withValues(alpha: 0.35)),
    );
  }
}
