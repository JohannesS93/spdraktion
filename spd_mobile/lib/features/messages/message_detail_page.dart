import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';

class MessageDetailPage extends StatefulWidget {
  final String messageId;
  final ApiClient api;
  final String userId;
  final Future<void> Function()? onMarkedRead;

  const MessageDetailPage({
    super.key,
    required this.messageId,
    required this.api,
    required this.userId,
    this.onMarkedRead,
  });

  @override
  State<MessageDetailPage> createState() => _MessageDetailPageState();
}

class _MessageDetailPageState extends State<MessageDetailPage> {
  Map<String, dynamic>? data;
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    // Treat "opening the detail view" as reading the message.
    // This keeps the unread counters consistent even if the user deep-links here
    // (e.g. from a push notification) or if the list pre-marking fails.
    _markReadBestEffort();
    load();
  }

  Future<void> _markReadBestEffort() async {
    try {
      await widget.api.postJson(
        '/messages/${widget.messageId}/read?user_id=${widget.userId}',
        {},
      );
    } catch (_) {
      // best effort
    }
    try {
      await widget.onMarkedRead?.call();
    } catch (_) {
      // best effort
    }
  }

  Future<void> load() async {
    try {
      final res = await widget.api.getJson(
        '/messages/${widget.messageId}/detail',
        query: {'user_id': widget.userId},
      ) as Map<String, dynamic>;

      if (!mounted) return;
      setState(() {
        data = res;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = e.toString();
        loading = false;
      });
    }
  }

  Future<void> hideMessage() async {
    await widget.api.postJson(
      '/messages/${widget.messageId}/hide?user_id=${widget.userId}',
      {},
    );

    if (mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Mitteilung')),
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              error!,
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }

    final m = data!;
    final sender = (m['sender_name'] ?? '').toString();
    final content = (m['content'] ?? '').toString();
    final urgency = (m['urgency'] ?? 'information').toString();
    final createdAt = _formatDate(m['created_at']?.toString());

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mitteilung'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Ausblenden',
            onPressed: hideMessage,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            elevation: 1,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _UrgencyChip(urgency: urgency),
                  const SizedBox(height: 16),
                  Text(
                    sender,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    createdAt,
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.grey.shade700,
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Divider(),
                  const SizedBox(height: 12),
                  Text(
                    content,
                    style: const TextStyle(
                      fontSize: 17,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          TextButton.icon(
            onPressed: hideMessage,
            icon: const Icon(Icons.delete_outline),
            label: const Text('Mitteilung aus meiner Ansicht entfernen'),
          ),
        ],
      ),
    );
  }
}

class _UrgencyChip extends StatelessWidget {
  final String urgency;

  const _UrgencyChip({required this.urgency});

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (urgency) {
      'hoch' => ('Hoch', Colors.red),
      'mittel' => ('Mittel', Colors.orange),
      _ => ('Information', Colors.blueGrey),
    };

    return Chip(
      label: Text(
        label,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      backgroundColor: color.withOpacity(0.12),
      side: BorderSide(color: color.withOpacity(0.35)),
    );
  }
}

String _formatDate(String? iso) {
  if (iso == null || iso.isEmpty) return '';

  try {
    final dt = DateTime.parse(iso).toLocal();
    return DateFormat('dd-MM-yyyy HH:mm').format(dt);
  } catch (_) {
    return iso;
  }
}
