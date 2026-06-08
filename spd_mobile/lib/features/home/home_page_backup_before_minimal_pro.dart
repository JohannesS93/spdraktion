import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../attendance/attendance_stats_page.dart';
import '../attendance/current_session_page.dart';
import '../messages/message_compose_page.dart';
import '../profile/me_store.dart';

class HomePage extends StatefulWidget {
  const HomePage({
    super.key,
    required this.onNavigateToTab,
    required this.meStore,
    required this.liveUnreadCount,
  });

  final void Function(int index) onNavigateToTab;
  final MeStore meStore;
  final int liveUnreadCount;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final api = ApiClient(AppConfig.apiBaseUrl);
  late Future<_HomeData> future;

  String _initialsFromName(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    String firstChar(String s) => s.isEmpty ? '' : s.substring(0, 1);
    if (parts.length == 1) {
      final p = parts.first;
      return (p.length <= 2 ? p : p.substring(0, 2)).toUpperCase();
    }
    return '${firstChar(parts.first)}${firstChar(parts.last)}'.toUpperCase();
  }

  void _openProfileSheet() {
    final displayName = widget.meStore.displayName;
    final email = FirebaseAuth.instance.currentUser?.email ?? '';
    final groupLabel = widget.meStore.groupOrEmpty;

    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: const Color(0xFFDA1E28),
                    child: Text(
                      _initialsFromName(displayName),
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      displayName,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _InfoRow(label: 'E-Mail', value: email.isEmpty ? '-' : email),
              _InfoRow(
                label: 'Gruppe',
                value: groupLabel.isEmpty ? '-' : groupLabel,
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () async {
                    Navigator.of(context).pop();
                    await _confirmAndLogout();
                  },
                  icon: const Icon(Icons.logout),
                  label: const Text('Abmelden'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmAndLogout() async {
    final shouldLogout = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Abmelden'),
        content: const Text('Möchtest du dich wirklich abmelden?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Abbrechen'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Abmelden'),
          ),
        ],
      ),
    );

    if (shouldLogout != true) return;

    await FirebaseAuth.instance.signOut();
  }

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
    future = _loadAfterMe();
  }

  Future<_HomeData> _loadAfterMe() async {
    if (widget.meStore.id == null || widget.meStore.id!.isEmpty) {
      await widget.meStore.loadMe();
    }
    if (widget.meStore.id == null || widget.meStore.id!.isEmpty) {
      return const _HomeData(
        nextSlot: null,
        pendingCount: 0,
        unreadCount: 0,
        latestDocument: null,
        latestSummaryDocument: null,
      );
    }
    return loadHome();
  }

  Future<_HomeData> loadHome() async {
    if (widget.meStore.id == null || widget.meStore.id!.isEmpty) {
      return const _HomeData(
        nextSlot: null,
        pendingCount: 0,
        unreadCount: 0,
        latestDocument: null,
        latestSummaryDocument: null,
      );
    }

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

    final unreadRaw =
        await api.getJson(
              '/messages/unread-count',
              query: {'user_id': currentUserId},
            )
            as Map<String, dynamic>;

    final documentsRaw = await api.getJson('/documents') as List<dynamic>;
    final documents = documentsRaw
        .map((e) => e as Map<String, dynamic>)
        .toList();
    final latestDocument = documents.isEmpty ? null : documents.first;
    final latestSummary = documents
        .where((doc) => (doc['category'] ?? '').toString() == 'kurzuebersicht')
        .toList();
    final latestSummaryDocument = latestSummary.isEmpty
        ? null
        : latestSummary.first;

    return _HomeData(
      nextSlot: nextSlot,
      pendingCount: pendingRaw.length,
      unreadCount: unreadRaw['unread_count'] as int,
      latestDocument: latestDocument,
      latestSummaryDocument: latestSummaryDocument,
    );
  }

  Future<void> refresh() async {
    await widget.meStore.loadMe();

    if (widget.meStore.id == null || widget.meStore.id!.isEmpty) {
      setState(() {
        future = Future.value(
          const _HomeData(
            nextSlot: null,
            pendingCount: 0,
            unreadCount: 0,
            latestDocument: null,
            latestSummaryDocument: null,
          ),
        );
      });
      return;
    }

    setState(() {
      future = loadHome();
    });

    await future;
  }

  @override
  Widget build(BuildContext context) {
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
          child: AnimatedBuilder(
            animation: widget.meStore,
            builder: (context, _) {
              final isPgf = widget.meStore.isPgf;
              final liveUnreadCount = widget.liveUnreadCount;

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
                        unreadCount: 0,
                        latestDocument: null,
                        latestSummaryDocument: null,
                      );

                  return RefreshIndicator(
                    onRefresh: refresh,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                      children: [
                        Row(
                          children: [
                            const _SpdLogoBadge(),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Dashboard',
                                    style: TextStyle(
                                      fontSize: 24,
                                      fontWeight: FontWeight.w800,
                                      height: 1.1,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  const Text(
                                    'Alles Wichtige auf einen Blick',
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: Color(0xFF6B6B6B),
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      _InfoPill(
                                        icon: Icons.notifications_outlined,
                                        label: liveUnreadCount == 0
                                            ? '0 neue Mitteilungen'
                                            : '$liveUnreadCount neue Mitteilungen',
                                        accent: liveUnreadCount > 0,
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              tooltip: 'Aktualisieren',
                              onPressed: refresh,
                              icon: const Icon(Icons.refresh),
                            ),
                            InkWell(
                              onTap: _openProfileSheet,
                              borderRadius: BorderRadius.circular(999),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 6,
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    CircleAvatar(
                                      radius: 14,
                                      backgroundColor: const Color(0xFFDA1E28),
                                      child: Text(
                                        _initialsFromName(
                                          widget.meStore.displayName,
                                        ),
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    const Icon(
                                      Icons.expand_more,
                                      size: 18,
                                      color: Color(0xFF39424E),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            Expanded(
                              child: _HeroCard(
                                title: 'Mein Dienstplan',
                                subtitle: data.nextSlot == null
                                    ? 'Kein anstehender Dienst gefunden.'
                                    : _buildNextSlotText(data.nextSlot!),
                                icon: Icons.calendar_month,
                                onTap: () => widget.onNavigateToTab(1),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _HeroCard(
                          title: 'Aktuelle Kurzübersicht',
                          subtitle: data.latestSummaryDocument == null
                              ? 'Noch keine Kurzübersicht vorhanden.'
                              : '${data.latestSummaryDocument!['title'] ?? ''} • ${data.latestSummaryDocument!['filename'] ?? ''}',
                          icon: Icons.article_outlined,
                          onTap: () => widget.onNavigateToTab(4),
                        ),
                        const SizedBox(height: 16),
                        _SectionTitle(
                          title: 'Schnellzugriff',
                          subtitle: 'Die wichtigsten Bereiche auf einen Blick',
                        ),
                        const SizedBox(height: 10),
                        GridView.count(
                          crossAxisCount: 2,
                          mainAxisSpacing: 12,
                          crossAxisSpacing: 12,
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          childAspectRatio: 1.08,
                          children: [
                            _QuickActionCard(
                              title: 'Dienstplan',
                              subtitle: data.nextSlot == null
                                  ? 'Dein nächster Dienst'
                                  : _buildNextSlotShortText(data.nextSlot!),
                              icon: Icons.calendar_month,
                              color: const Color(0xFFB51C2D),
                              onTap: () => widget.onNavigateToTab(1),
                            ),
                            _QuickActionCard(
                              title: 'Tausch',
                              subtitle: data.pendingCount == 0
                                  ? 'Keine offenen Bestätigungen'
                                  : '${data.pendingCount} offen',
                              icon: Icons.swap_horiz,
                              color: const Color(0xFF6F4D57),
                              onTap: () => widget.onNavigateToTab(2),
                              accent: data.pendingCount > 0,
                            ),
                            _QuickActionCard(
                              title: 'Mitteilungen',
                              subtitle: liveUnreadCount == 0
                                  ? 'Nichts Neues'
                                  : '$liveUnreadCount neu',
                              icon: Icons.notifications_active,
                              color: const Color(0xFF39424E),
                              onTap: () => widget.onNavigateToTab(3),
                              accent: liveUnreadCount > 0,
                            ),
                            _QuickActionCard(
                              title: 'Dateien',
                              subtitle: data.latestDocument == null
                                  ? 'Noch keine Dateien'
                                  : 'Neueste: ${data.latestDocument!['filename'] ?? ''}',
                              icon: Icons.folder_outlined,
                              color: const Color(0xFFB36A5E),
                              onTap: () => widget.onNavigateToTab(4),
                            ),
                            _QuickActionCard(
                              title: 'Schnellinfos',
                              subtitle: 'Themen und Bulletpoints',
                              icon: Icons.search,
                              color: const Color(0xFF8E6B3A),
                              onTap: () => widget.onNavigateToTab(5),
                            ),
                          ],
                        ),
                        if (isPgf) ...[
                          const SizedBox(height: 20),
                          _SectionTitle(
                            title: 'PGF Bereich',
                            subtitle: 'Sitzung, Mitteilung und Auswertung',
                          ),
                          const SizedBox(height: 10),
                          _ActionListCard(
                            title: 'Aktuelle Session',
                            subtitle: 'Teilnehmer abhaken',
                            icon: Icons.play_circle_outline,
                            onTap: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => CurrentSessionPage(
                                    meStore: widget.meStore,
                                  ),
                                ),
                              );
                            },
                          ),
                          const SizedBox(height: 12),
                          _ActionListCard(
                            title: 'Mitteilung schreiben',
                            subtitle: 'Neue Mitteilung an alle versenden',
                            icon: Icons.edit_note,
                            onTap: () async {
                              await Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => MessageComposePage(
                                    meStore: widget.meStore,
                                  ),
                                ),
                              );

                              if (!mounted) return;
                              setState(() {
                                future = loadHome();
                              });
                            },
                          ),
                          const SizedBox(height: 12),
                          _ActionListCard(
                            title: 'Statistik',
                            subtitle: 'Sitzungsdienst-Auswertung',
                            icon: Icons.bar_chart,
                            onTap: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => AttendanceStatsPage(
                                    meStore: widget.meStore,
                                  ),
                                ),
                              );
                            },
                          ),
                        ],
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
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

  String _buildNextSlotShortText(Map<String, dynamic> slot) {
    final date = (slot['date'] ?? '').toString();
    final slotCode = (slot['slot_code'] ?? '').toString();
    final start = _hhmm(slot['start_time']);
    final end = _hhmmNullable(slot['end_time']);
    final time = (end == null || end.isEmpty) ? '$start Uhr' : '$start–$end';

    return '$date • $slotCode • $time';
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
    required this.unreadCount,
    required this.latestDocument,
    required this.latestSummaryDocument,
  });

  final Map<String, dynamic>? nextSlot;
  final int pendingCount;
  final int unreadCount;
  final Map<String, dynamic>? latestDocument;
  final Map<String, dynamic>? latestSummaryDocument;
}

class _SpdLogoBadge extends StatelessWidget {
  const _SpdLogoBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      padding: const EdgeInsets.all(8),
      child: Image.asset('assets/spd-logo.png', fit: BoxFit.contain),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 2),
        Text(
          subtitle,
          style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
        ),
      ],
    );
  }
}

class _InfoPill extends StatelessWidget {
  const _InfoPill({
    required this.icon,
    required this.label,
    this.accent = false,
  });

  final IconData icon;
  final String label;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: accent
            ? const Color(0xFFF7E9EB)
            : Colors.white.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: accent
              ? const Color(0xFFB51C2D).withValues(alpha: 0.18)
              : Colors.black12,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 15,
            color: accent ? const Color(0xFFB51C2D) : Colors.black54,
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: accent ? const Color(0xFF8E1623) : Colors.black87,
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 72,
            child: Text(
              label,
              style: TextStyle(
                color: Colors.grey.shade700,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroCard extends StatelessWidget {
  const _HeroCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(24),
      elevation: 0,
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFE8E1E3)),
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: const Color(0xFFB51C2D).withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: const Color(0xFFB51C2D)),
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
                    const SizedBox(height: 6),
                    Text(
                      subtitle,
                      style: TextStyle(
                        color: Colors.grey.shade800,
                        height: 1.25,
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

class _QuickActionCard extends StatelessWidget {
  const _QuickActionCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
    required this.onTap,
    this.accent = false,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: accent
                  ? color.withValues(alpha: 0.28)
                  : const Color(0xFFE8E1E3),
            ),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white,
                accent
                    ? color.withValues(alpha: 0.08)
                    : const Color(0xFFFDFDFD),
              ],
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: color),
              ),
              const SizedBox(height: 12),
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: Colors.grey.shade700,
                  fontSize: 12,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionListCard extends StatelessWidget {
  const _ActionListCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: const Color(0xFFE8E1E3)),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: const Color(0xFFB51C2D).withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: const Color(0xFFB51C2D)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: TextStyle(color: Colors.grey.shade700),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
