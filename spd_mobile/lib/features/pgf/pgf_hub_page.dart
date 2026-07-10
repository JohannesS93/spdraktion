import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../attendance/attendance_stats_page.dart';
import '../attendance/current_session_page.dart';
import '../messages/message_compose_page.dart';
import '../profile/me_store.dart';

class PgfHubPage extends StatefulWidget {
  const PgfHubPage({super.key, required this.meStore});

  final MeStore meStore;

  @override
  State<PgfHubPage> createState() => _PgfHubPageState();
}

class _PgfHubPageState extends State<PgfHubPage> {
  final api = ApiClient(AppConfig.apiBaseUrl);
  late Future<Map<String, dynamic>?> future;

  @override
  void initState() {
    super.initState();
    future = _loadLiveInfo();
  }

  Future<Map<String, dynamic>?> _loadLiveInfo() async {
    return await api.getJson('/me/live-info') as Map<String, dynamic>?;
  }

  Future<void> _refresh() async {
    final next = _loadLiveInfo();
    setState(() {
      future = next;
    });
    await next;
  }

  @override
  Widget build(BuildContext context) {
    final isPgf = widget.meStore.isPgf;

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFFDF7F7), Color(0xFFF6F2F4), Color(0xFFF8F8F8)],
          ),
        ),
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: _refresh,
            child: FutureBuilder<Map<String, dynamic>?>(
              future: future,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }

                final liveInfo = snap.data;
                final nextPgfDuty =
                    liveInfo?['next_pgf_duty'] as Map<String, dynamic>?;

                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                isPgf ? 'PGF Bereich' : 'Sitzungsdienst',
                                style: const TextStyle(
                                  fontSize: 28,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                isPgf
                                    ? 'Aktuelle Session, Mitteilungen und Auswertung.'
                                    : 'Teilnehmer abhaken und Sitzungsdienst verwalten.',
                                style: const TextStyle(
                                  fontSize: 15,
                                  color: Color(0xFF5E6774),
                                ),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: 'Aktualisieren',
                          onPressed: _refresh,
                          icon: const Icon(Icons.refresh),
                        ),
                      ],
                    ),
                    if (isPgf) ...[
                      const SizedBox(height: 18),
                      _InfoCard(
                        title: 'Nächster PGF-Dienst',
                        headline: _formatPgfDutyHeadline(nextPgfDuty),
                        detail: _formatPgfDutyDetail(nextPgfDuty),
                        icon: Icons.badge_outlined,
                        color: const Color(0xFF39424E),
                      ),
                    ],
                    const SizedBox(height: 18),
                    _ActionCard(
                      title: 'Aktuelle Session',
                      subtitle: 'Teilnehmer abhaken und Präsenz verwalten',
                      icon: Icons.play_circle_outline,
                      color: const Color(0xFFB51C2D),
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) =>
                                CurrentSessionPage(meStore: widget.meStore),
                          ),
                        );
                      },
                    ),
                    if (isPgf) ...[
                      const SizedBox(height: 12),
                      _ActionCard(
                        title: 'Mitteilung schreiben',
                        subtitle: 'Neue Mitteilung an alle versenden',
                        icon: Icons.edit_note,
                        color: const Color(0xFF6F4D57),
                        onTap: () async {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  MessageComposePage(meStore: widget.meStore),
                            ),
                          );
                          if (!mounted) return;
                          setState(() {
                            future = _loadLiveInfo();
                          });
                        },
                      ),
                      const SizedBox(height: 12),
                      _ActionCard(
                        title: 'Statistik',
                        subtitle: 'Sitzungsdienst-Auswertung öffnen',
                        icon: Icons.bar_chart,
                        color: const Color(0xFF39424E),
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
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  String _formatPgfDutyHeadline(Map<String, dynamic>? duty) {
    if (duty == null) return 'Kein PGF-Dienst geplant';
    final assignee = (duty['assignee_name'] ?? '').toString().trim();
    final slotCode = (duty['slot_code'] ?? '').toString().trim();
    if (assignee.isEmpty && slotCode.isEmpty) return 'PGF-Dienst geplant';
    if (assignee.isEmpty) return slotCode;
    if (slotCode.isEmpty) return assignee;
    return '$assignee • $slotCode';
  }

  String _formatPgfDutyDetail(Map<String, dynamic>? duty) {
    if (duty == null) return 'Sobald ein PGF-Dienst ansteht, erscheint er hier.';
    final date = (duty['date'] ?? '').toString().trim();
    final start = _hhmm(duty['start_time']);
    final end = _hhmmNullable(duty['end_time']);
    final time = start.isEmpty
        ? ''
        : (end == null || end.isEmpty) ? '$start Uhr' : '$start-$end Uhr';
    if (date.isEmpty && time.isEmpty) return 'PGF-Dienst geplant';
    if (date.isEmpty) return time;
    if (time.isEmpty) return date;
    return '$date • $time';
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

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.title,
    required this.headline,
    required this.detail,
    required this.icon,
    required this.color,
  });

  final String title;
  final String headline;
  final String detail;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE9E2E3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: color),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    color: Color(0xFF6A7280),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  headline,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    height: 1.15,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  detail,
                  style: const TextStyle(
                    fontSize: 14,
                    color: Color(0xFF5E6774),
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFE9E2E3)),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: color),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontSize: 14,
                        color: Color(0xFF5E6774),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
