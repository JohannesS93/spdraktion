import 'package:flutter/material.dart';

import 'message_card.dart';
import 'message_store.dart';
import 'message_detail_page.dart';
import '../../core/api_client.dart';
import '../../core/logger.dart';

class MessagesPage extends StatefulWidget {
  final MessageStore store;
  final Future<void> Function()? onMarkedRead;
  final ApiClient api;
  final String userId;

  const MessagesPage({
    super.key,
    required this.store,
    required this.api,
    required this.userId,
    this.onMarkedRead,
  });

  @override
  State<MessagesPage> createState() => _MessagesPageState();
}

class _MessagesPageState extends State<MessagesPage> {
  @override
  void initState() {
    super.initState();
    // Ensure list is up-to-date when user navigates to the screen,
    // even if push was delayed/missed.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await widget.store.loadFromApi(widget.api, userId: widget.userId);
    });
  }

  int urgencyPriority(String urgency) {
    switch (urgency) {
      case "hoch":
        return 0;
      case "mittel":
        return 1;
      default:
        return 2;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mitteilungen'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_sweep_outlined),
            tooltip: 'Alle ausblenden',
            onPressed: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Alle Mitteilungen entfernen?'),
                  content: const Text(
                    'Damit werden alle Mitteilungen nur aus deiner Ansicht entfernt.',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.of(ctx).pop(false),
                      child: const Text('Abbrechen'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.of(ctx).pop(true),
                      child: const Text('Entfernen'),
                    ),
                  ],
                ),
              );

              if (ok == true) {
                await widget.api.postJson(
                  '/messages/hide-all?user_id=${widget.userId}',
                  {},
                );

                widget.store.clearMessages();
                await widget.store.loadFromApi(
                  widget.api,
                  userId: widget.userId,
                );
                await widget.onMarkedRead?.call();

                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Alle Mitteilungen wurden ausgeblendet.'),
                    ),
                  );
                }
              }
            },
          ),
        ],
      ),
      body: AnimatedBuilder(
        animation: widget.store,
        builder: (context, _) {
          final messages = widget.store.messages.toList();

          messages.sort(
            (a, b) => urgencyPriority(
              a.urgency,
            ).compareTo(urgencyPriority(b.urgency)),
          );

          if (messages.isEmpty) {
            return const Center(child: Text("Noch keine Mitteilungen"));
          }

          return ListView(
            children: messages
                .map(
                  (m) => InkWell(
                    onTap: () async {
                      // Sofort als gelesen markieren → Counter sinkt
                      try {
                        await widget.api.postJson(
                          '/messages/${m.id}/read?user_id=${widget.userId}',
                          {},
                        );
                      } catch (e) {
                        AppLogger.i('mark read failed: $e');
                      }
                      await widget.onMarkedRead?.call();

                      final changed = await Navigator.of(context).push<bool>(
                        MaterialPageRoute(
                          builder: (_) => MessageDetailPage(
                            messageId: m.id,
                            api: widget.api,
                            userId: widget.userId,
                            onMarkedRead: widget.onMarkedRead,
                          ),
                        ),
                      );

                      // Store nur neu laden wenn etwas geändert wurde (z.B. ausgeblendet)
                      if (changed == true) {
                        widget.store.removeMessage(m.id);
                        await widget.store.loadFromApi(
                          widget.api,
                          userId: widget.userId,
                        );
                        await widget.onMarkedRead?.call();
                      }
                    },
                    child: MessageCard(
                      sender: m.sender,
                      content: m.content,
                      urgency: m.urgency,
                    ),
                  ),
                )
                .toList(),
          );
        },
      ),
    );
  }
}
