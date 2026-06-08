import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../profile/me_store.dart';

class ExchangeStatusPage extends StatefulWidget {
  const ExchangeStatusPage({super.key, required this.meStore});

  final MeStore meStore;

  @override
  State<ExchangeStatusPage> createState() => _ExchangeStatusPageState();
}

class _ExchangeStatusPageState extends State<ExchangeStatusPage> {
  late final ApiClient api;
  late Future<_ExchangeOverview> future;

  @override
  void initState() {
    super.initState();
    api = ApiClient(AppConfig.apiBaseUrl);
    future = load();
  }

  Future<_ExchangeOverview> load() async {
    final raw = await api.getJson('/exchange-requests/overview')
        as Map<String, dynamic>;

    final requests = (raw['requests'] as List<dynamic>? ?? [])
        .map((e) => e as Map<String, dynamic>)
        .toList();
    final matches = (raw['matches'] as List<dynamic>? ?? [])
        .map((e) => e as Map<String, dynamic>)
        .toList();

    return _ExchangeOverview(requests: requests, matches: matches);
  }

  Future<void> refresh() async {
    setState(() {
      future = load();
    });
    await future;
  }

  Future<void> confirmMatch(String matchId) async {
    await api.postJson('/exchange-matches/$matchId/confirm', {});
    await refresh();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tausch'),
        actions: [
          IconButton(
            tooltip: 'Aktualisieren',
            onPressed: refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: FutureBuilder<_ExchangeOverview>(
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

          final data = snap.data ?? const _ExchangeOverview();
          final openRequests = data.requests
              .where((e) => (e['status'] ?? '') != 'CONFIRMED')
              .toList();

          return RefreshIndicator(
            onRefresh: refresh,
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                _Section(
                  title: 'Laufende Tausche',
                  emptyText: 'Keine laufenden oder abgeschlossenen Tausche.',
                  children: [
                    for (final match in data.matches)
                      _MatchTile(
                        match: match,
                        principalId: widget.meStore.userIdOrThrow,
                        onConfirm: () =>
                            confirmMatch(match['id']?.toString() ?? ''),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                _Section(
                  title: 'Offene Tauschwünsche',
                  emptyText: 'Keine offenen Tauschwünsche.',
                  children: [
                    for (final request in openRequests)
                      _RequestTile(request: request),
                  ],
                ),
                const SizedBox(height: 24),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ExchangeOverview {
  final List<Map<String, dynamic>> requests;
  final List<Map<String, dynamic>> matches;

  const _ExchangeOverview({this.requests = const [], this.matches = const []});
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.emptyText,
    required this.children,
  });

  final String title;
  final String emptyText;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            if (children.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(emptyText),
              )
            else
              ...children,
          ],
        ),
      ),
    );
  }
}

class _MatchTile extends StatelessWidget {
  const _MatchTile({
    required this.match,
    required this.principalId,
    required this.onConfirm,
  });

  final Map<String, dynamic> match;
  final String principalId;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    final requestA = match['request_a'] as Map<String, dynamic>;
    final requestB = match['request_b'] as Map<String, dynamic>;
    final aUser = requestA['from_user'] as Map<String, dynamic>;
    final bUser = requestB['from_user'] as Map<String, dynamic>;
    final isA = aUser['id'] == principalId;
    final ownConfirmed =
        isA ? match['a_confirmed_at'] != null : match['b_confirmed_at'] != null;
    final canConfirm =
        match['status'] == 'PENDING_CONFIRMATION' && !ownConfirmed;

    return Column(
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('${_personName(aUser)} ↔ ${_personName(bUser)}'),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _StatusChip(status: match['status']?.toString() ?? ''),
                const SizedBox(height: 6),
                Text('A: ${_slotLabel(requestA['slot'] as Map<String, dynamic>)}'),
                Text('B: ${_slotLabel(requestB['slot'] as Map<String, dynamic>)}'),
              ],
            ),
          ),
        ),
        if (canConfirm)
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: onConfirm,
              child: const Text('Bestätigen'),
            ),
          ),
        const Divider(height: 1),
      ],
    );
  }
}

class _RequestTile extends StatelessWidget {
  const _RequestTile({required this.request});

  final Map<String, dynamic> request;

  @override
  Widget build(BuildContext context) {
    final alternatives = request['alternatives'] as List<dynamic>? ?? [];

    return Column(
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(_slotLabel(request['slot'] as Map<String, dynamic>)),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _StatusChip(status: request['status']?.toString() ?? ''),
                Text('${alternatives.length} Alternativen'),
              ],
            ),
          ),
        ),
        const Divider(height: 1),
      ],
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
      'PENDING_CONFIRMATION' => 'WARTET',
      'CONFIRMED' => 'BESTÄTIGT',
      'CANCELLED' => 'ABGEBROCHEN',
      _ => status,
    };

    final color = switch (status) {
      'CONFIRMED' => Colors.green,
      'PENDING_CONFIRMATION' => Colors.orange,
      'CANCELLED' => Colors.red,
      _ => Colors.blueGrey,
    };

    return Chip(
      label: Text(label),
      backgroundColor: color.withValues(alpha: 0.12),
      side: BorderSide(color: color.withValues(alpha: 0.35)),
    );
  }
}

String _slotLabel(Map<String, dynamic> slot) {
  final end = slot['open_end'] == true
      ? 'Ende'
      : (slot['end_time']?.toString() ?? '');
  return '${slot['weekday']}, ${slot['date']} · ${slot['slot_code']} · ${slot['start_time']}–$end';
}

String _personName(Map<String, dynamic> user) {
  final first = user['first_name']?.toString() ?? '';
  final last = user['last_name']?.toString() ?? '';
  final name = ('$first $last').trim();
  return name.isEmpty ? 'Unbekannt' : name;
}
