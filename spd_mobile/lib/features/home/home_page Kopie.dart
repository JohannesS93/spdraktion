import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../attendance/attendance_stats_page.dart';
import '../messages/message_compose_page.dart';
import '../profile/me_store.dart';
import '../attendance/current_session_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({
    super.key,
    required this.onNavigateToTab,
    required this.meStore,
  });

  final void Function(int index) onNavigateToTab;
  final MeStore meStore;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final api = ApiClient(AppConfig.apiBaseUrl);
  late Future<_HomeData> future;

  String get currentUserId {
    final id = widget.meStore.id;
    if (id == null || id.isEmpty) {
      throw Exception('MeStore hat keine userId geladen');
    }
    return id;
  }

  @override
  void initState() {
    super.initState();
    future = loadHome();
  }

  Future<_HomeData> loadHome() async {
    final upcomingRaw =
        await api.getJson(
              '/me/upcoming-slots',
              query: {'user_id': currentUserId},
            )
            as List<dynamic>;

    final upcoming = upcomingRaw.map((e) => e as Map<String, dynamic>).toList();
    final nextSlot = upcoming.isEmpty ? null : upcoming.first;

    final pendingRaw =
        await api.getJson(
              '/me/exchanges/pending',
              query: {'user_id': currentUserId},
            )
            as List<dynamic>;

    final latestMessage =
        await api.getJson('/messages/latest') as Map<String, dynamic>?;

    final unreadRaw =
        await api.getJson(
              '/messages/unread-count',
              query: {'user_id': currentUserId},
            )
            as Map<String, dynamic>;

    final unreadCount = unreadRaw['unread_count'] as int;

    return _HomeData(
      nextSlot: nextSlot,
      pendingCount: pendingRaw.length,
      latestMessage: latestMessage,
      unreadCount: unreadCount,
    );
  }

  Future<void> refresh() async {
    await widget.meStore.loadMe();

    setState(() {
      future = loadHome();
    });

    await future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
        actions: [
          IconButton(
            tooltip: 'Aktualisieren',
            onPressed: refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: AnimatedBuilder(
        animation: widget.meStore,
        builder: (context, _) {
          final greetingName = widget.meStore.firstName ?? '...';
          final roleLabel = widget.meStore.roleOrEmpty;
          final isPgf = widget.meStore.isPgf;

          return FutureBuilder<_HomeData>(
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

              final data =
                  snap.data ??
                  const _HomeData(
                    nextSlot: null,
                    pendingCount: 0,
                    latestMessage: null,
                    unreadCount: 0,
                  );

              return RefreshIndicator(
                onRefresh: refresh,
                child: ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        'Hallo $greetingName',
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    if (roleLabel.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          'Rolle: $roleLabel',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey.shade700,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    _ActionCard(
                      title: 'Mein Dienstplan',
                      subtitle: data.nextSlot == null
                          ? 'Kein anstehender Dienst gefunden.'
                          : _buildNextSlotText(data.nextSlot!),
                      icon: Icons.calendar_month,
                      onTap: () => widget.onNavigateToTab(1),
                    ),
                    const SizedBox(height: 12),
                    _ActionCard(
                      title: 'Tausche / Bestätigungen',
                      subtitle: data.pendingCount == 0
                          ? 'Keine offenen Bestätigungen.'
                          : '${data.pendingCount} offen',
                      icon: Icons.swap_horiz,
                      onTap: () => widget.onNavigateToTab(2),
                      highlight: data.pendingCount > 0,
                    ),
                    const SizedBox(height: 12),
                    _ActionCard(
                      title: 'Neue Mitteilungen',
                      subtitle: data.unreadCount == 0
                          ? 'Keine neuen Mitteilungen'
                          : '${data.unreadCount} neue Mitteilung(en)',
                      icon: Icons.notifications_active,
                      onTap: () => widget.onNavigateToTab(3),
                      highlight: data.unreadCount > 0,
                    ),
                    if (isPgf) ...[
                      const SizedBox(height: 12),
                      _ActionCard(
                        title: 'Mitteilung schreiben (PGF)',
                        subtitle: 'Neue Mitteilung an alle versenden',
                        icon: Icons.edit_note,
                        onTap: () async {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  MessageComposePage(meStore: widget.meStore),
                            ),
                          );

                          if (!mounted) return;
                          setState(() {
                            future = loadHome();
                          });
                        },
                      ),
                      _ActionCard(
                        title: 'Aktuelle Session (PGF)',
                        subtitle: 'Teilnehmer abhaken',
                        icon: Icons.play_circle,
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  CurrentSessionPage(meStore: widget.meStore),
                            ),
                          );
                        },
                      ),
                      const SizedBox(height: 12),
                      _ActionCard(
                        title: 'Statistik (PGF)',
                        subtitle: 'Sitzungsdienst-Auswertung',
                        icon: Icons.bar_chart,
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  AttendanceStatsPage(meStore: widget.meStore),
                            ),
                          );
                        },
                      ),
                    ],
                    const SizedBox(height: 12),
                    _ActionCard(
                      title: 'Profil',
                      subtitle: 'Einstellungen und persönliche Daten',
                      icon: Icons.person,
                      onTap: () => widget.onNavigateToTab(4),
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }

  String _buildNextSlotText(Map<String, dynamic> slot) {
    final weekday = (slot['weekday'] ?? '').toString();
    final date = (slot['date'] ?? '').toString();
    final slotCode = (slot['slot_code'] ?? '').toString();
    final start = _hhmm(slot['start_time']);
    final end = _hhmmNullable(slot['end_time']);

    final time = (end == null || end.isEmpty)
        ? '$start Uhr'
        : '$start–$end Uhr';

    return '$weekday, $date • $slotCode • $time';
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

class _HomeData {
  const _HomeData({
    required this.nextSlot,
    required this.pendingCount,
    required this.latestMessage,
    required this.unreadCount,
  });

  final Map<String, dynamic>? nextSlot;
  final int pendingCount;
  final Map<String, dynamic>? latestMessage;
  final int unreadCount;
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
    this.highlight = false,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final color = highlight
        ? Theme.of(context).colorScheme.primary.withOpacity(0.08)
        : null;

    return Card(
      color: color,
      child: ListTile(
        leading: Icon(icon),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(subtitle),
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
