import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/feature_flags.dart';
import '../attendance/attendance_stats_page.dart';
import '../attendance/current_session_page.dart';
import '../feedback/feedback_page.dart';
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
  Future<PackageInfo>? _packageInfoFuture;
  Map<String, dynamic>? _agendaInfo;
  List<Map<String, dynamic>> _agendaSpeeches = const [];
  String? _selectedAgendaDate;
  String? _selectedAgendaTopKey;
  bool _agendaLoading = false;

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
    _packageInfoFuture ??= PackageInfo.fromPlatform();
    final fcmTokenFuture = FirebaseMessaging.instance.getToken();

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
              FutureBuilder<PackageInfo>(
                future: _packageInfoFuture,
                builder: (context, snap) {
                  if (!snap.hasData) {
                    return const _InfoRow(label: 'Version', value: '…');
                  }
                  final info = snap.data!;
                  final v = info.version;
                  final b = info.buildNumber;
                  return _InfoRow(label: 'Version', value: '$v ($b)');
                },
              ),
              FutureBuilder<String?>(
                future: fcmTokenFuture,
                builder: (context, snap) {
                  final token = snap.data;
                  if (snap.connectionState != ConnectionState.done) {
                    return const _InfoRow(label: 'Push-Token', value: '…');
                  }
                  if (token == null || token.isEmpty) {
                    return const _InfoRow(label: 'Push-Token', value: '-');
                  }
                  final tail = token.length <= 10
                      ? token
                      : token.substring(token.length - 10);
                  return Row(
                    children: [
                      Expanded(
                        child: _InfoRow(label: 'Push-Token', value: '…$tail'),
                      ),
                      IconButton(
                        tooltip: 'Kopieren',
                        onPressed: () async {
                          await Clipboard.setData(ClipboardData(text: token));
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Push-Token kopiert.'),
                              ),
                            );
                          }
                        },
                        icon: const Icon(Icons.copy),
                      ),
                    ],
                  );
                },
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
        liveInfo: null,
        factionSpeeches: [],
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
        liveInfo: null,
        factionSpeeches: [],
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
    final liveInfo =
        await api.getJson('/me/live-info') as Map<String, dynamic>?;
    final factionSpeeches = await _loadFactionSpeeches();

    return _HomeData(
      nextSlot: nextSlot,
      pendingCount: pendingRaw.length,
      unreadCount: unreadRaw['unread_count'] as int,
      latestDocument: latestDocument,
      latestSummaryDocument: latestSummaryDocument,
      liveInfo: liveInfo,
      factionSpeeches: factionSpeeches,
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
            liveInfo: null,
            factionSpeeches: [],
          ),
        );
      });
      return;
    }

    setState(() {
      future = loadHome();
    });

    final latest = await future;
    final currentSession =
        latest.liveInfo?['current_session'] as Map<String, dynamic>?;
    final currentSessionDate = (currentSession?['date'] ?? '')
        .toString()
        .trim();
    if (_selectedAgendaDate != null &&
        _selectedAgendaDate!.isNotEmpty &&
        _selectedAgendaDate != currentSessionDate) {
      await _loadAgendaForDate(_selectedAgendaDate!, silent: true);
      return;
    }
    if (mounted) {
      setState(() {
        _agendaInfo = null;
        _agendaSpeeches = latest.factionSpeeches;
        _selectedAgendaTopKey = null;
      });
    }
  }

  Map<String, String>? _agendaQuery(String? sessionDate) {
    if (sessionDate == null || sessionDate.isEmpty) return null;
    return {'at': '${sessionDate}T12:00:00+02:00'};
  }

  Future<List<Map<String, dynamic>>> _loadFactionSpeeches({
    String? sessionDate,
  }) async {
    final payload =
        await api.getJson(
              '/me/faction-speakers',
              query: _agendaQuery(sessionDate),
            )
            as Map<String, dynamic>?;
    final items =
        (payload?['speeches'] ?? payload?['items'] ?? const <dynamic>[])
            as List<dynamic>;
    return items.map((item) => item as Map<String, dynamic>).toList();
  }

  Future<void> _loadAgendaForDate(
    String sessionDate, {
    bool silent = false,
  }) async {
    if (_agendaLoading) return;
    setState(() {
      _agendaLoading = true;
      _selectedAgendaDate = sessionDate;
      _selectedAgendaTopKey = null;
    });
    try {
      final liveInfo =
          await api.getJson('/me/live-info', query: _agendaQuery(sessionDate))
              as Map<String, dynamic>?;
      final speeches = await _loadFactionSpeeches(sessionDate: sessionDate);
      if (!mounted) return;
      setState(() {
        _agendaInfo = liveInfo;
        _agendaSpeeches = speeches;
      });
    } catch (_) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Die Sitzungsagenda konnte nicht geladen werden.'),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _agendaLoading = false;
        });
      }
    }
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
                        liveInfo: null,
                        factionSpeeches: [],
                      );
                  final liveInfo = data.liveInfo;
                  final sessionRunning = liveInfo?['session_running'] == true;
                  final currentTop =
                      liveInfo?['current_top'] as Map<String, dynamic>?;
                  final nextTop =
                      liveInfo?['next_top'] as Map<String, dynamic>?;
                  final nextRollCall =
                      liveInfo?['next_roll_call'] as Map<String, dynamic>?;
                  final nextSpeech =
                      liveInfo?['next_speech'] as Map<String, dynamic>?;
                  final nextPgfDuty =
                      liveInfo?['next_pgf_duty'] as Map<String, dynamic>?;
                  final viewer = liveInfo?['viewer'] as Map<String, dynamic>?;
                  final principalName = (viewer?['principal_name'] ?? '')
                      .toString()
                      .trim();
                  final currentSession =
                      liveInfo?['current_session'] as Map<String, dynamic>?;
                  final currentSessionDate = (currentSession?['date'] ?? '')
                      .toString()
                      .trim();
                  final effectiveAgendaDate =
                      (_selectedAgendaDate == null ||
                          _selectedAgendaDate!.isEmpty)
                      ? currentSessionDate
                      : _selectedAgendaDate!;
                  final useAgendaOverride =
                      _agendaInfo != null &&
                      effectiveAgendaDate.isNotEmpty &&
                      effectiveAgendaDate != currentSessionDate;
                  final agendaInfo = useAgendaOverride ? _agendaInfo : liveInfo;
                  final agendaSpeeches = useAgendaOverride
                      ? _agendaSpeeches
                      : data.factionSpeeches;
                  final sessionDays =
                      ((liveInfo?['session_days'] ?? const <dynamic>[])
                              as List<dynamic>)
                          .map((item) => item as Map<String, dynamic>)
                          .toList();
                  final visibleSessionDays = _visibleSessionDays(
                    sessionDays,
                    effectiveAgendaDate.isNotEmpty
                        ? effectiveAgendaDate
                        : (liveInfo?['effective_at'] ?? '').toString(),
                  );
                  final agendaPoints =
                      ((agendaInfo?['agenda_points'] ?? const <dynamic>[])
                              as List<dynamic>)
                          .map((item) => item as Map<String, dynamic>)
                          .toList();
                  final isAgendaLiveDay =
                      effectiveAgendaDate.isNotEmpty &&
                      effectiveAgendaDate == currentSessionDate;

                  return RefreshIndicator(
                    onRefresh: refresh,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                      children: [
                        Row(
                          children: [
                            const _SpdLogoBadge(),
                            const SizedBox(width: 12),
                            const Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Fraktion Intern',
                                    style: TextStyle(
                                      fontSize: 20,
                                      fontWeight: FontWeight.w800,
                                      height: 1.1,
                                    ),
                                  ),
                                  SizedBox(height: 2),
                                  Text(
                                    'Interne Informationen für die SPD-Bundestagsfraktion',
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: Color(0xFF6B6B6B),
                                      fontWeight: FontWeight.w500,
                                    ),
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
                        const SizedBox(height: 16),
                        if (sessionRunning) ...[
                          _SessionBanner(
                            currentTop: _pointLabel(currentTop),
                            nextTop: _pointLabel(nextTop),
                            nextTopStart: _formatDateTime(
                              nextTop?['start_at']?.toString(),
                              timeOnly: true,
                            ),
                          ),
                          const SizedBox(height: 16),
                        ],
                        Row(
                          children: [
                            Expanded(
                              child: _KpiCard(
                                title: 'Nächster Dienst',
                                value: _nextSlotKpiValue(data.nextSlot),
                                hint: _nextSlotKpiHint(data.nextSlot),
                                icon: Icons.calendar_month_outlined,
                                color: const Color(0xFFB51C2D),
                                onTap: () => widget.onNavigateToTab(1),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: _KpiCard(
                                title: 'Ungelesen',
                                value: '$liveUnreadCount',
                                hint: liveUnreadCount == 1
                                    ? 'neue Mitteilung'
                                    : 'neue Mitteilungen',
                                icon: Icons.notifications_active_outlined,
                                color: const Color(0xFF39424E),
                                onTap: () => widget.onNavigateToTab(3),
                                accent: liveUnreadCount > 0,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 18),
                        _SectionTitle(title: 'Plenum aktuell', subtitle: ''),
                        const SizedBox(height: 10),
                        _InfoPanelCard(
                          title: 'Nächste namentliche',
                          headline: _pointLabel(nextRollCall),
                          detail: nextRollCall == null
                              ? 'Aktuell keine kommende namentliche Abstimmung erkannt'
                              : _formatRollCallRange(nextRollCall),
                          color: const Color(0xFFB51C2D),
                          icon: Icons.how_to_vote_outlined,
                        ),
                        const SizedBox(height: 12),
                        _InfoPanelCard(
                          title: principalName.isEmpty
                              ? 'Nächste Rede'
                              : 'Nächste Rede - $principalName',
                          headline:
                              (nextSpeech?['title'] ?? '').toString().isEmpty
                              ? 'Noch keine Rede erkannt'
                              : (nextSpeech?['title'] ?? '').toString(),
                          detail: nextSpeech == null
                              ? 'Aktuell keine kommende Rede erkannt'
                              : _formatDateTime(
                                  nextSpeech['start_at']?.toString(),
                                ),
                          color: const Color(0xFF6F4D57),
                          icon: Icons.record_voice_over_outlined,
                        ),
                        if (isPgf) ...[
                          const SizedBox(height: 12),
                          _InfoPanelCard(
                            title: 'Nächster PGF-Dienst',
                            headline: _formatPgfDutyHeadline(nextPgfDuty),
                            detail: _formatPgfDutyDetail(nextPgfDuty),
                            color: const Color(0xFF39424E),
                            icon: Icons.badge_outlined,
                          ),
                        ],
                        const SizedBox(height: 18),
                        _SectionTitle(title: 'Sitzungsagenda', subtitle: ''),
                        const SizedBox(height: 10),
                        if (visibleSessionDays.isNotEmpty)
                          SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: visibleSessionDays.map((day) {
                                final date = (day['date'] ?? '').toString();
                                final isSelected = date == effectiveAgendaDate;
                                return Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: ChoiceChip(
                                    label: Text(
                                      ((day['date_text'] ?? day['date']) ?? '')
                                          .toString(),
                                    ),
                                    selected: isSelected,
                                    onSelected: (_) {
                                      if (date.isEmpty) return;
                                      if (date == currentSessionDate) {
                                        setState(() {
                                          _selectedAgendaDate = date;
                                          _agendaInfo = null;
                                          _agendaSpeeches =
                                              data.factionSpeeches;
                                          _selectedAgendaTopKey = null;
                                        });
                                        return;
                                      }
                                      _loadAgendaForDate(date);
                                    },
                                  ),
                                );
                              }).toList(),
                            ),
                          ),
                        if (visibleSessionDays.isNotEmpty)
                          const SizedBox(height: 12),
                        if (isAgendaLiveDay &&
                            (currentTop != null || nextTop != null))
                          _AgendaLiveMarker(
                            currentTop: _pointLabel(currentTop),
                            nextTop: _pointLabel(nextTop),
                            currentRange: _formatPointRange(currentTop),
                            nextRange: _formatPointRange(nextTop),
                            effectiveAt: _formatDateTime(
                              liveInfo?['effective_at']?.toString(),
                              timeOnly: true,
                            ),
                          ),
                        if (isAgendaLiveDay &&
                            (currentTop != null || nextTop != null))
                          const SizedBox(height: 12),
                        if (_agendaLoading)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 24),
                            child: Center(child: CircularProgressIndicator()),
                          )
                        else if (agendaPoints.isEmpty)
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(22),
                              border: Border.all(
                                color: const Color(0xFFE8E1E3),
                              ),
                            ),
                            child: Text(
                              'Für diesen Sitzungstag liegen aktuell keine Tagesordnungspunkte vor.',
                              style: TextStyle(color: Colors.grey.shade700),
                            ),
                          )
                        else
                          ...agendaPoints.map((point) {
                            final pointTop = (point['top'] ?? '').toString();
                            final pointTopKeys = _normalizeTopLabels(pointTop);
                            final currentTopKeys = _normalizeTopLabels(
                              currentTop?['top']?.toString(),
                            );
                            final nextTopKeys = _normalizeTopLabels(
                              nextTop?['top']?.toString(),
                            );
                            final isCurrent =
                                isAgendaLiveDay &&
                                pointTopKeys.isNotEmpty &&
                                pointTopKeys.any(currentTopKeys.contains);
                            final isNext =
                                isAgendaLiveDay &&
                                pointTopKeys.isNotEmpty &&
                                pointTopKeys.any(nextTopKeys.contains);
                            final pointDate = _isoDatePart(
                              point['start_at']?.toString(),
                            );
                            final speakers = _speakersForPoint(
                              agendaSpeeches,
                              pointTopKeys,
                              pointDate,
                            );
                            final topKey = pointTopKeys.join('|');
                            final isExpanded = _selectedAgendaTopKey == topKey;
                            final displayTop = pointTopKeys.isNotEmpty
                                ? _deriveDisplayTop(pointTopKeys, speakers)
                                : pointTop;

                            return Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: _AgendaPointCard(
                                displayTop: displayTop.isEmpty
                                    ? 'Ohne TOP'
                                    : displayTop,
                                title: (point['title'] ?? 'Ohne Titel')
                                    .toString(),
                                timeRange: _formatPointRange(point),
                                isCurrent: isCurrent,
                                isNext: isNext,
                                isExpanded: isExpanded,
                                speakerCount: speakers.length,
                                speakers: speakers,
                                onTap: () {
                                  setState(() {
                                    _selectedAgendaTopKey = isExpanded
                                        ? null
                                        : topKey;
                                  });
                                },
                              ),
                            );
                          }),
                        const SizedBox(height: 18),
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
                              subtitle: exchangesEnabled
                                  ? data.pendingCount == 0
                                        ? 'Keine offenen Bestätigungen'
                                        : '${data.pendingCount} offen'
                                  : 'Vorübergehend deaktiviert',
                              icon: Icons.swap_horiz,
                              color: const Color(0xFF6F4D57),
                              onTap: () {
                                if (!exchangesEnabled) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'Das Tauschtool wird später freigeschaltet.',
                                      ),
                                    ),
                                  );
                                  return;
                                }
                                widget.onNavigateToTab(2);
                              },
                              accent: exchangesEnabled && data.pendingCount > 0,
                              enabled: exchangesEnabled,
                            ),
                            _QuickActionCard(
                              title: 'Kurzübersicht',
                              subtitle: data.latestSummaryDocument == null
                                  ? 'Noch keine Kurzübersicht'
                                  : '${data.latestSummaryDocument!['filename'] ?? ''}',
                              icon: Icons.article_outlined,
                              color: const Color(0xFF8E6B3A),
                              onTap: () => widget.onNavigateToTab(4),
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
                          ],
                        ),
                        const SizedBox(height: 12),
                        _ActionListCard(
                          title: 'Vorschlag oder Fehler melden',
                          subtitle:
                              'Ideen, Probleme und Verbesserungen direkt senden',
                          icon: Icons.lightbulb_outline,
                          onTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => const FeedbackPage(),
                              ),
                            );
                          },
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

  String _nextSlotKpiValue(Map<String, dynamic>? slot) {
    if (slot == null) return 'Kein Dienst';
    final slotCode = (slot['slot_code'] ?? '').toString();
    final start = _hhmm(slot['start_time']);
    if (slotCode.isEmpty || start.isEmpty) return 'Dienst geplant';
    return '$slotCode • $start';
  }

  String _nextSlotKpiHint(Map<String, dynamic>? slot) {
    if (slot == null) return 'Dienstplan öffnen';
    final date = (slot['date'] ?? '').toString();
    if (date.isEmpty) return 'Details im Dienstplan';
    return date;
  }

  String _buildNextSlotShortText(Map<String, dynamic> slot) {
    final date = (slot['date'] ?? '').toString();
    final slotCode = (slot['slot_code'] ?? '').toString();
    final start = _hhmm(slot['start_time']);
    final end = _hhmmNullable(slot['end_time']);
    final time = (end == null || end.isEmpty) ? '$start Uhr' : '$start–$end';

    return '$date • $slotCode • $time';
  }

  String _pointLabel(Map<String, dynamic>? point) {
    if (point == null) return 'Keine Angabe';
    final top = (point['top'] ?? '').toString().trim();
    final title = (point['title'] ?? '').toString().trim();
    if (top.isNotEmpty && title.isNotEmpty) return '$top • $title';
    return top.isNotEmpty ? top : (title.isNotEmpty ? title : 'Keine Angabe');
  }

  String _formatDateTime(String? value, {bool timeOnly = false}) {
    if (value == null || value.isEmpty) return '—';
    final parsed = DateTime.tryParse(value);
    if (parsed == null) return value;
    final local = parsed.toLocal();
    final date =
        '${local.day.toString().padLeft(2, '0')}.${local.month.toString().padLeft(2, '0')}.${local.year}';
    final time =
        '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
    return timeOnly ? time : '$date · $time Uhr';
  }

  String _formatRollCallRange(Map<String, dynamic> point) {
    final start = _formatDateTime(point['start_at']?.toString());
    final end = _formatDateTime(
      (point['end_at'] ?? point['start_at'])?.toString(),
    );
    return 'Start: $start\nVoraussichtliches Ende: $end';
  }

  String _formatPgfDutyHeadline(Map<String, dynamic>? duty) {
    if (duty == null) return 'Kein kommender PGF-Dienst';
    final slotCode = (duty['slot_code'] ?? '').toString();
    final weekday = (duty['weekday'] ?? '').toString();
    final date = (duty['date'] ?? '').toString();
    return [
      slotCode,
      weekday,
      date,
    ].where((part) => part.isNotEmpty).join(' • ');
  }

  String _formatPgfDutyDetail(Map<String, dynamic>? duty) {
    if (duty == null) {
      return 'Sobald ein Dienst geplant ist, erscheint er hier.';
    }
    final start = _hhmm(duty['start_time']);
    final end = _hhmmNullable(duty['end_time']);
    final assignmentType = (duty['assignment_type'] ?? '').toString();
    final time = (end == null || end.isEmpty)
        ? '$start Uhr'
        : '$start–$end Uhr';
    if (assignmentType == 'ruf') return '$time · Ruf';
    if (assignmentType == 'active') return '$time · Aktiv';
    return time;
  }

  List<Map<String, dynamic>> _visibleSessionDays(
    List<Map<String, dynamic>> sessionDays,
    String baseValue,
  ) {
    final baseDate = DateTime.tryParse(
      baseValue.length == 10 ? '${baseValue}T12:00:00+02:00' : baseValue,
    );
    if (baseDate == null) return sessionDays;
    final weekStart = _startOfWeek(baseDate);
    final weekEnd = weekStart.add(const Duration(days: 6));
    return sessionDays.where((day) {
      final date = (day['date'] ?? '').toString();
      final parsed = DateTime.tryParse('${date}T12:00:00+02:00');
      if (parsed == null) return false;
      return !parsed.isBefore(weekStart) && !parsed.isAfter(weekEnd);
    }).toList();
  }

  DateTime _startOfWeek(DateTime date) {
    final local = DateTime(date.year, date.month, date.day);
    final weekday = local.weekday;
    return local.subtract(Duration(days: weekday - 1));
  }

  String? _isoDatePart(String? value) {
    if (value == null || value.length < 10) return null;
    return value.substring(0, 10);
  }

  List<String> _normalizeTopLabels(String? value) {
    final raw = (value ?? '').trim().toUpperCase();
    if (raw.isEmpty) return const [];
    final parts = raw
        .replaceAll(RegExp(r'\s+'), ' ')
        .split(',')
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty);
    final labels = <String>[];

    void pushLabel(String? prefix, String number) {
      labels.add(prefix == 'ZP' ? 'ZP $number' : number);
    }

    for (final part in parts) {
      final rangeMatch = RegExp(
        r'^(TOP|ZP)?\s*(\d+)\s*[-–]\s*(\d+)$',
      ).firstMatch(part);
      if (rangeMatch != null) {
        final prefix = rangeMatch.group(1);
        final start = int.tryParse(rangeMatch.group(2)!);
        final end = int.tryParse(rangeMatch.group(3)!);
        if (start != null && end != null && end >= start) {
          for (var current = start; current <= end; current += 1) {
            pushLabel(prefix, '$current');
          }
          continue;
        }
      }

      final plusMatch = RegExp(r'^(TOP|ZP)?\s*(\d+)\+(\d+)$').firstMatch(part);
      if (plusMatch != null) {
        final prefix = plusMatch.group(1);
        pushLabel(prefix, plusMatch.group(2)!);
        pushLabel(prefix, plusMatch.group(3)!);
        continue;
      }

      final simpleMatch = RegExp(r'^(TOP|ZP)?\s*(\d+[A-Z]?)$').firstMatch(part);
      if (simpleMatch != null) {
        pushLabel(simpleMatch.group(1), simpleMatch.group(2)!);
        continue;
      }

      labels.add(
        part
            .replaceAll(RegExp(r'\bTOP\s+'), '')
            .replaceAll(RegExp(r'\bZP\s+'), 'ZP '),
      );
    }

    return labels.toSet().toList();
  }

  bool _sameTopNumberSequence(List<String> left, List<String> right) {
    if (left.length != right.length) return false;
    return left.join('|') == right.join('|');
  }

  bool _topSetsIntersect(List<String> left, List<String> right) {
    return left.any(right.contains);
  }

  bool _speechMatchesPoint(
    List<String> pointLabels,
    List<String> speechLabels,
  ) {
    final normalizedSpeechLabels = speechLabels.toSet().toList();
    if (pointLabels.isEmpty || normalizedSpeechLabels.isEmpty) return false;
    if (_sameTopNumberSequence(pointLabels, normalizedSpeechLabels)) {
      return true;
    }
    if (pointLabels.length == 1 || normalizedSpeechLabels.length == 1) {
      return _topSetsIntersect(pointLabels, normalizedSpeechLabels);
    }
    return false;
  }

  List<Map<String, dynamic>> _speakersForPoint(
    List<Map<String, dynamic>> speeches,
    List<String> pointTopKeys,
    String? pointDate,
  ) {
    final deduped = <String, Map<String, dynamic>>{};
    for (final speech in speeches) {
      final labels = [
        ...((speech['top_labels'] as List<dynamic>? ?? const <dynamic>[]).map(
          (item) => item.toString(),
        )),
        if ((speech['top'] ?? '').toString().isNotEmpty)
          (speech['top'] ?? '').toString(),
      ].expand(_normalizeTopLabels).toList();
      final speechDate = _isoDatePart(
        (speech['effective_start_at'] ?? speech['planned_start_at'])
            ?.toString(),
      );
      if (speechDate != pointDate ||
          !_speechMatchesPoint(pointTopKeys, labels)) {
        continue;
      }
      final displayName =
          ((speech['source_speaker_name'] ??
                      speech['speaker_name'] ??
                      'Unbekannt')
                  .toString())
              .trim();
      final key =
          '${displayName.toUpperCase()}|${(speech['top'] ?? '').toString()}';
      deduped[key] = {...speech, 'speaker_name': displayName};
    }
    final result = deduped.values.toList();
    result.sort((a, b) {
      final aHasLive =
          (a['has_live_time'] == true) &&
          ((a['effective_start_at'] ?? '').toString().isNotEmpty);
      final bHasLive =
          (b['has_live_time'] == true) &&
          ((b['effective_start_at'] ?? '').toString().isNotEmpty);
      if (aHasLive && bHasLive) {
        return ((a['effective_start_at'] ?? '').toString()).compareTo(
          (b['effective_start_at'] ?? '').toString(),
        );
      }
      if (aHasLive != bHasLive) return aHasLive ? -1 : 1;
      return ((a['speaker_name'] ?? '').toString()).compareTo(
        (b['speaker_name'] ?? '').toString(),
      );
    });
    return result;
  }

  String _deriveDisplayTop(
    List<String> pointLabels,
    List<Map<String, dynamic>> speakers,
  ) {
    final counts = <String, Map<String, dynamic>>{};
    for (final speaker in speakers) {
      final labels = [
        ...((speaker['top_labels'] as List<dynamic>? ?? const <dynamic>[]).map(
          (item) => item.toString(),
        )),
        if ((speaker['top'] ?? '').toString().isNotEmpty)
          (speaker['top'] ?? '').toString(),
      ].expand(_normalizeTopLabels).toList();
      if (labels.isEmpty) continue;
      final key = labels.join('|');
      final current = counts[key];
      if (current != null) {
        current['count'] = ((current['count'] as int?) ?? 0) + 1;
      } else {
        counts[key] = {'labels': labels, 'count': 1};
      }
    }
    final ranked = counts.values.toList()
      ..sort(
        (a, b) =>
            ((b['count'] as int?) ?? 0).compareTo((a['count'] as int?) ?? 0),
      );
    final best = ranked.isNotEmpty ? ranked.first : null;
    if (best != null &&
        _sameTopNumberSequence(
          pointLabels,
          (best['labels'] as List<dynamic>)
              .map((item) => item.toString())
              .toList(),
        )) {
      return (best['labels'] as List<dynamic>)
          .map((item) => item.toString())
          .join(', ');
    }
    return pointLabels.join(', ');
  }

  String _formatPointRange(Map<String, dynamic>? point) {
    if (point == null) return '—';
    final start = _formatDateTime(
      point['start_at']?.toString(),
      timeOnly: true,
    );
    final end = _formatDateTime(point['end_at']?.toString(), timeOnly: true);
    if (start == '—' && end == '—') return '—';
    if (end == '—') return '$start Uhr';
    return '$start – $end';
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
    required this.liveInfo,
    required this.factionSpeeches,
  });

  final Map<String, dynamic>? nextSlot;
  final int pendingCount;
  final int unreadCount;
  final Map<String, dynamic>? latestDocument;
  final Map<String, dynamic>? latestSummaryDocument;
  final Map<String, dynamic>? liveInfo;
  final List<Map<String, dynamic>> factionSpeeches;
}

class _SessionBanner extends StatelessWidget {
  const _SessionBanner({
    required this.currentTop,
    required this.nextTop,
    required this.nextTopStart,
  });

  final String currentTop;
  final String nextTop;
  final String nextTopStart;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFB51C2D), Color(0xFF7E1020)],
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.sensors, color: Colors.white),
              SizedBox(width: 8),
              Text(
                'Sitzung läuft',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            currentTop,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 18,
              height: 1.2,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Als Nächstes: $nextTop',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            nextTopStart.isEmpty || nextTopStart == '—'
                ? 'Nächster Start noch offen'
                : 'Voraussichtlicher Start: $nextTopStart Uhr',
            style: const TextStyle(color: Colors.white70),
          ),
        ],
      ),
    );
  }
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
        if (subtitle.isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(
            subtitle,
            style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
          ),
        ],
      ],
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

class _KpiCard extends StatelessWidget {
  const _KpiCard({
    required this.title,
    required this.value,
    required this.hint,
    required this.icon,
    required this.color,
    required this.onTap,
    this.accent = false,
  });

  final String title;
  final String value;
  final String hint;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: accent
                  ? color.withValues(alpha: 0.30)
                  : const Color(0xFFE8E1E3),
            ),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white,
                accent
                    ? color.withValues(alpha: 0.10)
                    : const Color(0xFFFDFDFD),
              ],
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(height: 12),
              Text(
                title,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: Colors.grey.shade700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                hint,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Colors.grey.shade700, fontSize: 12),
              ),
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
    this.enabled = true,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final bool accent;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: enabled ? onTap : null,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: !enabled
                  ? const Color(0xFFE5E7EB)
                  : accent
                  ? color.withValues(alpha: 0.28)
                  : const Color(0xFFE8E1E3),
            ),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white,
                !enabled
                    ? const Color(0xFFF8F8F8)
                    : accent
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
                  color: enabled
                      ? color.withValues(alpha: 0.12)
                      : Colors.grey.shade200,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  icon,
                  color: enabled ? color : Colors.grey.shade400,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                title,
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                  color: enabled ? Colors.black : Colors.grey.shade500,
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

class _InfoPanelCard extends StatelessWidget {
  const _InfoPanelCard({
    required this.title,
    required this.headline,
    required this.detail,
    required this.color,
    required this.icon,
  });

  final String title;
  final String headline;
  final String detail;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE8E1E3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
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
                  style: TextStyle(
                    color: Colors.grey.shade700,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  headline,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w500,
                    fontSize: 15,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  detail,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: Colors.grey.shade700, height: 1.3),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AgendaLiveMarker extends StatelessWidget {
  const _AgendaLiveMarker({
    required this.currentTop,
    required this.nextTop,
    required this.currentRange,
    required this.nextRange,
    required this.effectiveAt,
  });

  final String currentTop;
  final String nextTop;
  final String currentRange;
  final String nextRange;
  final String effectiveAt;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8F4F4),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE8E1E3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.timeline_outlined,
                size: 18,
                color: Color(0xFFB51C2D),
              ),
              const SizedBox(width: 8),
              const Text(
                'Plenum live',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF1F2937),
                ),
              ),
              const Spacer(),
              Text(
                effectiveAt == '—' ? '' : 'Stand $effectiveAt',
                style: TextStyle(color: Colors.grey.shade700, fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (currentTop != 'Keine Angabe') ...[
            const Text(
              'Aktuell',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Color(0xFF6B7280),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              currentTop,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                height: 1.25,
              ),
            ),
            if (currentRange != '—') ...[
              const SizedBox(height: 2),
              Text(
                currentRange,
                style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
              ),
            ],
          ],
          if (nextTop != 'Keine Angabe') ...[
            const SizedBox(height: 10),
            const Text(
              'Als Nächstes',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Color(0xFF6B7280),
              ),
            ),
            const SizedBox(height: 4),
            Text(nextTop, style: const TextStyle(fontSize: 14, height: 1.25)),
            if (nextRange != '—') ...[
              const SizedBox(height: 2),
              Text(
                nextRange,
                style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _AgendaPointCard extends StatelessWidget {
  const _AgendaPointCard({
    required this.displayTop,
    required this.title,
    required this.timeRange,
    required this.isCurrent,
    required this.isNext,
    required this.isExpanded,
    required this.speakerCount,
    required this.speakers,
    required this.onTap,
  });

  final String displayTop;
  final String title;
  final String timeRange;
  final bool isCurrent;
  final bool isNext;
  final bool isExpanded;
  final int speakerCount;
  final List<Map<String, dynamic>> speakers;
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
            border: Border.all(
              color: isExpanded
                  ? const Color(0xFF111827)
                  : const Color(0xFFE8E1E3),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(
                              displayTop,
                              style: TextStyle(
                                color: Colors.grey.shade700,
                                fontSize: 12,
                                letterSpacing: 1.6,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            if (isCurrent)
                              _MiniBadge(label: 'Aktuell', filled: true),
                            if (isNext) _MiniBadge(label: 'Als Nächstes'),
                            _MiniBadge(label: '$speakerCount Redner'),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                            height: 1.25,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        timeRange,
                        style: TextStyle(
                          color: Colors.grey.shade700,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Icon(
                        isExpanded ? Icons.expand_less : Icons.expand_more,
                        color: Colors.grey.shade600,
                      ),
                    ],
                  ),
                ],
              ),
              if (isExpanded) ...[
                const SizedBox(height: 14),
                const Divider(height: 1),
                const SizedBox(height: 14),
                if (speakers.isEmpty)
                  Text(
                    'Für diesen TOP sind aktuell keine SPD-Redner erfasst.',
                    style: TextStyle(color: Colors.grey.shade700),
                  )
                else
                  ...speakers.map((speaker) {
                    final liveTime = speaker['has_live_time'] == true
                        ? (speaker['effective_start_at'] ?? '').toString()
                        : '';
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8F8F8),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFE8E1E3)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              (speaker['speaker_name'] ?? 'Unbekannt')
                                  .toString(),
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            if (liveTime.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                'Live-Zeit: ${_AgendaFormatting.formatTime(liveTime)} Uhr',
                                style: TextStyle(
                                  color: Colors.grey.shade700,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    );
                  }),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniBadge extends StatelessWidget {
  const _MiniBadge({required this.label, this.filled = false});

  final String label;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: filled ? const Color(0xFF111827) : Colors.white,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: filled ? const Color(0xFF111827) : const Color(0xFFD1D5DB),
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: filled ? Colors.white : const Color(0xFF374151),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _AgendaFormatting {
  static String formatTime(String value) {
    final parsed = DateTime.tryParse(value);
    if (parsed == null) return value;
    final local = parsed.toLocal();
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
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
