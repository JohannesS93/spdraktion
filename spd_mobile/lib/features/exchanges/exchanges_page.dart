import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../core/config.dart';
import '../profile/me_store.dart';
import '../slots/slot_detail_page.dart';

class ExchangesPage extends StatefulWidget {
  const ExchangesPage({super.key, required this.meStore});

  final MeStore meStore;

  @override
  State<ExchangesPage> createState() => _ExchangesPageState();
}

class _ExchangesPageState extends State<ExchangesPage> {
  late final ApiClient api;
  String statusFilter =
      'ALL'; // ALL | OPEN | PENDING_CONFIRMATION | CONFIRMED | CANCELLED
  late Future<_ExchangeData> future;

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
    api = ApiClient(AppConfig.apiBaseUrl);
    future = _loadAfterMe();
  }

  Future<_ExchangeData> _loadAfterMe() async {
    if (widget.meStore.id == null || widget.meStore.id!.isEmpty) {
      await Future.delayed(Duration.zero);
      await widget.meStore.loadMe();
    }
    return load();
  }

  Future<_ExchangeData> load() async {
    String? userId = widget.meStore.id;

    if (userId == null || userId.isEmpty) {
      throw Exception('MeStore hat noch keine userId geladen');
    }
    if (userId == null || userId.isEmpty) {
      throw Exception('MeStore hat noch keine userId geladen');
    }

    final marketRaw =
        await api.getJson('/market/exchanges', query: {'user_id': userId})
            as List<dynamic>;
    final market = marketRaw.map((e) => e as Map<String, dynamic>).toList();

    final meQuery = <String, String>{'user_id': userId};
    if (statusFilter != 'ALL') meQuery['status'] = statusFilter;

    final meRaw =
        await api.getJson('/me/exchanges', query: meQuery) as List<dynamic>;
    final mine = meRaw.map((e) => e as Map<String, dynamic>).toList();

    return _ExchangeData(market: market, mine: mine);
  }

  Future<void> refresh() async {
    setState(() {
      future = _loadAfterMe();
    });
    await future;
  }

  Future<void> acceptExchange(String exchangeId) async {
    await api.postJson('/exchanges/$exchangeId/accept', {
      'to_user_id': loadedUserId,
    });
    await refresh();
  }

  Future<void> confirmExchange(String exchangeId) async {
    await api.postJson('/exchanges/$exchangeId/confirm', {
      'actor_user_id': loadedUserId,
    });
    await refresh();
  }

  Future<void> cancelExchange(String exchangeId, {String? reason}) async {
    await api.postJson('/exchanges/$exchangeId/cancel', {
      'actor_user_id': loadedUserId,
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
    await refresh();
  }

  bool isMineAsFrom(Map<String, dynamic> e) {
    final from = e['from_user'] as Map<String, dynamic>;
    return from['id'] == loadedUserId;
  }

  bool isMineAsTo(Map<String, dynamic> e) {
    final to = e['to_user'] as Map<String, dynamic>?;
    return to != null && to['id'] == loadedUserId;
  }

  bool canAcceptFromMarket(Map<String, dynamic> e) {
    final status = (e['status'] ?? '') as String;
    final from = e['from_user'] as Map<String, dynamic>;
    final to = e['to_user'] as Map<String, dynamic>?;

    return status == 'OPEN' && to == null && from['id'] != loadedUserId;
  }

  bool providerCanConfirm(Map<String, dynamic> e) {
    final status = (e['status'] ?? '') as String;
    if (status != 'PENDING_CONFIRMATION') return false;
    if (!isMineAsFrom(e)) return false;

    final conf = e['confirmations'] as Map<String, dynamic>?;
    final fromConfirmedAt = conf?['from_confirmed_at'];
    return fromConfirmedAt == null;
  }

  bool canCancel(Map<String, dynamic> e) {
    final status = (e['status'] ?? '') as String;
    if (status == 'CONFIRMED' || status == 'CANCELLED' || status == 'EXPIRED') {
      return false;
    }
    return isMineAsFrom(e) || isMineAsTo(e);
  }

  void openSlot(BuildContext context, Map<String, dynamic> e) {
    final slot = e['slot'] as Map<String, dynamic>;
    final title = '${slot['weekday']}, ${slot['date']} • ${slot['slot_code']}';
    final openEnd = slot['open_end'] == true;
    final subtitle = openEnd
        ? '${slot['start_time']}–Ende'
        : '${slot['start_time']}–${slot['end_time']}';

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SlotDetailPage(
          slotId: slot['id'] as String,
          title: title,
          subtitle: subtitle,
          meStore: widget.meStore,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tausch'),
        actions: [
          _StatusFilter(
            value: statusFilter,
            onChanged: (v) {
              setState(() {
                statusFilter = v;
                future = _loadAfterMe();
              });
            },
          ),
          IconButton(
            tooltip: 'Aktualisieren',
            onPressed: refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: FutureBuilder<_ExchangeData>(
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

          final data = snap.data ?? const _ExchangeData(market: [], mine: []);

          if (statusFilter == 'CANCELLED') {
            return RefreshIndicator(
              onRefresh: refresh,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  _Section(
                    title: '🛑 Abgebrochen',
                    subtitle: 'Nur abgebrochene Vorgänge.',
                    items: data.mine,
                    emptyText: 'Keine abgebrochenen Vorgänge.',
                    itemBuilder: (e) {
                      return _ExchangeCard(
                        exchange: e,
                        onOpen: () => openSlot(context, e),
                        showAccept: false,
                        showConfirm: false,
                        showCancel: false,
                        onAccept: () {},
                        onConfirm: () {},
                        onCancel: () {},
                      );
                    },
                  ),
                ],
              ),
            );
          }

          final marketOpen = data.market;

          final offeredByMe = <Map<String, dynamic>>[];
          final assignedToMe = <Map<String, dynamic>>[];
          final confirmed = <Map<String, dynamic>>[];

          for (final e in data.mine) {
            final status = (e['status'] ?? '') as String;

            if (status == 'CONFIRMED') {
              confirmed.add(e);
              continue;
            }

            final hideCancelled =
                status == 'CANCELLED' && statusFilter != 'CANCELLED';

            if (isMineAsFrom(e)) {
              if (!hideCancelled) offeredByMe.add(e);
              continue;
            }

            if (isMineAsTo(e)) {
              if (!hideCancelled) assignedToMe.add(e);
              continue;
            }

            if (!hideCancelled) offeredByMe.add(e);
          }

          return RefreshIndicator(
            onRefresh: refresh,
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                _Section(
                  title: '🧺 Tauschbörse (offen)',
                  subtitle:
                      'Offene Angebote anderer Personen – du kannst übernehmen.',
                  items: marketOpen,
                  emptyText: 'Keine offenen Angebote anderer Personen.',
                  itemBuilder: (e) {
                    return _ExchangeCard(
                      exchange: e,
                      onOpen: () => openSlot(context, e),
                      showAccept: canAcceptFromMarket(e),
                      showConfirm: false,
                      showCancel: false,
                      onAccept: () =>
                          acceptExchange(e['exchange_id'] as String),
                      onConfirm: () {},
                      onCancel: () {},
                    );
                  },
                ),
                const SizedBox(height: 12),
                _Section(
                  title: '📤 Von mir angeboten',
                  subtitle:
                      'Deine Angebote (offen oder wartet auf deine Bestätigung).',
                  items: offeredByMe,
                  emptyText: 'Du hast aktuell keine Angebote.',
                  itemBuilder: (e) {
                    return _ExchangeCard(
                      exchange: e,
                      onOpen: () => openSlot(context, e),
                      showAccept: false,
                      showConfirm: providerCanConfirm(e),
                      showCancel: canCancel(e),
                      onAccept: () {},
                      onConfirm: () =>
                          confirmExchange(e['exchange_id'] as String),
                      onCancel: () => _confirmCancel(context, e),
                    );
                  },
                ),
                const SizedBox(height: 12),
                _Section(
                  title: '📥 Ich soll übernehmen',
                  subtitle:
                      'Du hast übernommen (du bist beim Annehmen schon bestätigt).',
                  items: assignedToMe,
                  emptyText: 'Keine Vorgänge.',
                  itemBuilder: (e) {
                    return _ExchangeCard(
                      exchange: e,
                      onOpen: () => openSlot(context, e),
                      showAccept: false,
                      showConfirm: false,
                      showCancel: canCancel(e),
                      onAccept: () {},
                      onConfirm: () {},
                      onCancel: () => _confirmCancel(context, e),
                    );
                  },
                ),
                const SizedBox(height: 12),
                _Section(
                  title: '✅ Bestätigt',
                  subtitle: 'Erledigte Tausche.',
                  items: confirmed,
                  emptyText: 'Noch keine bestätigten Tausche.',
                  itemBuilder: (e) {
                    return _ExchangeCard(
                      exchange: e,
                      onOpen: () => openSlot(context, e),
                      showAccept: false,
                      showConfirm: false,
                      showCancel: false,
                      onAccept: () {},
                      onConfirm: () {},
                      onCancel: () {},
                    );
                  },
                ),
                const SizedBox(height: 24),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _confirmCancel(
    BuildContext context,
    Map<String, dynamic> e,
  ) async {
    final exchangeId = e['exchange_id'] as String;
    final slot = e['slot'] as Map<String, dynamic>;
    final title = '${slot['weekday']}, ${slot['date']} • ${slot['slot_code']}';

    final reasonController = TextEditingController();

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Tausch abbrechen?'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title),
              const SizedBox(height: 12),
              TextField(
                controller: reasonController,
                decoration: const InputDecoration(
                  labelText: 'Grund (optional)',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Nein'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Abbrechen'),
            ),
          ],
        );
      },
    );

    if (ok == true) {
      await cancelExchange(exchangeId, reason: reasonController.text);
    }
  }
}

class _ExchangeData {
  final List<Map<String, dynamic>> market;
  final List<Map<String, dynamic>> mine;

  const _ExchangeData({required this.market, required this.mine});
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.subtitle,
    required this.items,
    required this.emptyText,
    required this.itemBuilder,
  });

  final String title;
  final String subtitle;
  final List<Map<String, dynamic>> items;
  final String emptyText;
  final Widget Function(Map<String, dynamic> e) itemBuilder;

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
            const SizedBox(height: 4),
            Text(subtitle, style: const TextStyle(fontSize: 12)),
            const SizedBox(height: 12),
            if (items.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(emptyText),
              )
            else
              Column(children: [for (final e in items) itemBuilder(e)]),
          ],
        ),
      ),
    );
  }
}

class _ExchangeCard extends StatelessWidget {
  const _ExchangeCard({
    required this.exchange,
    required this.onOpen,
    required this.showAccept,
    required this.showConfirm,
    required this.showCancel,
    required this.onAccept,
    required this.onConfirm,
    required this.onCancel,
  });

  final Map<String, dynamic> exchange;
  final VoidCallback onOpen;

  final bool showAccept;
  final bool showConfirm;
  final bool showCancel;

  final VoidCallback onAccept;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final status = (exchange['status'] ?? '') as String;
    final from = exchange['from_user'] as Map<String, dynamic>;
    final to = exchange['to_user'] as Map<String, dynamic>?;
    final slot = exchange['slot'] as Map<String, dynamic>;

    final fromName = '${from['first_name']} ${from['last_name']}';
    final toName = to == null
        ? '— (offen)'
        : '${to['first_name']} ${to['last_name']}';

    final openEnd = slot['open_end'] == true;
    final time = openEnd
        ? '${slot['start_time']}–Ende'
        : '${slot['start_time']}–${slot['end_time']}';

    return Column(
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            '${slot['weekday']}, ${slot['date']} • ${slot['slot_code']}',
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _StatusChip(status: status),
                Text(time),
                Text('$fromName → $toName'),
              ],
            ),
          ),
          trailing: const Icon(Icons.chevron_right),
          onTap: onOpen,
        ),
        if (showCancel || showAccept || showConfirm)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (showCancel)
                  TextButton(
                    onPressed: onCancel,
                    child: const Text('Abbrechen'),
                  ),
                if (showAccept)
                  FilledButton(
                    onPressed: onAccept,
                    child: const Text('Ich übernehme'),
                  ),
                if (showConfirm) ...[
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: onConfirm,
                    child: const Text('Bestätigen'),
                  ),
                ],
              ],
            ),
          ),
        const Divider(height: 1),
      ],
    );
  }
}

class _StatusFilter extends StatelessWidget {
  const _StatusFilter({required this.value, required this.onChanged});

  final String value;
  final void Function(String) onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
          items: const [
            DropdownMenuItem(value: 'ALL', child: Text('Alle')),
            DropdownMenuItem(value: 'OPEN', child: Text('Offen')),
            DropdownMenuItem(
              value: 'PENDING_CONFIRMATION',
              child: Text('Bestätigung ausstehend'),
            ),
            DropdownMenuItem(value: 'CONFIRMED', child: Text('Bestätigt')),
            DropdownMenuItem(value: 'CANCELLED', child: Text('Abgebrochen')),
          ],
        ),
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
      'PENDING_CONFIRMATION' => 'BESTÄTIGUNG',
      'CONFIRMED' => 'BESTÄTIGT',
      'CANCELLED' => 'ABGEBROCHEN',
      'EXPIRED' => 'ABGELAUFEN',
      _ => status,
    };

    final color = switch (status) {
      'OPEN' => Colors.grey,
      'PENDING_CONFIRMATION' => Colors.orange,
      'CONFIRMED' => Colors.green,
      'CANCELLED' => Colors.red,
      'EXPIRED' => Colors.blueGrey,
      _ => Colors.blueGrey,
    };

    return Chip(
      label: Text(label),
      backgroundColor: color.withOpacity(0.15),
      side: BorderSide(color: color.withOpacity(0.35)),
    );
  }
}
