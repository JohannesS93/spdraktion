import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../profile/me_store.dart';

class MessageComposePage extends StatefulWidget {
  const MessageComposePage({super.key, required this.meStore});

  final MeStore meStore;

  @override
  State<MessageComposePage> createState() => _MessageComposePageState();
}

class _MessageComposePageState extends State<MessageComposePage> {
  final api = ApiClient(AppConfig.apiBaseUrl);

  final senderController = TextEditingController();
  final contentController = TextEditingController();

  String urgency = 'information';
  bool isSending = false;

  @override
  void initState() {
    super.initState();
    final firstName = widget.meStore.firstName ?? '';
    final lastName = widget.meStore.lastName ?? '';
    final fullName = '$firstName $lastName'.trim();
    senderController.text = fullName.isEmpty ? 'PGF' : fullName;
  }

  @override
  void dispose() {
    senderController.dispose();
    contentController.dispose();
    super.dispose();
  }

  Future<void> sendMessage() async {
    final senderName = senderController.text.trim();
    final content = contentController.text.trim();

    if (senderName.isEmpty) {
      _showSnack('Bitte Absendername eingeben.');
      return;
    }

    if (content.isEmpty) {
      _showSnack('Bitte eine Mitteilung eingeben.');
      return;
    }

    setState(() {
      isSending = true;
    });

    try {
      await api.postJson('/pgf/messages', {
        'sender_name': senderName,
        'content': content,
        'urgency': urgency,
      });

      if (!mounted) return;

      _showSnack('Mitteilung wurde versendet.');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      _showSnack('Senden fehlgeschlagen: $e');
    } finally {
      if (mounted) {
        setState(() {
          isSending = false;
        });
      }
    }
  }

  void _showSnack(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text)),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.meStore.isPgf) {
      return const Scaffold(
        body: Center(child: Text('Kein Zugriff')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mitteilung schreiben'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Neue PGF-Mitteilung',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Die Mitteilung wird an alle versendet.',
            style: TextStyle(
              color: Colors.grey.shade700,
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: senderController,
            decoration: const InputDecoration(
              labelText: 'Absendername',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: urgency,
            decoration: const InputDecoration(
              labelText: 'Wichtigkeit',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(
                value: 'information',
                child: Text('Information'),
              ),
              DropdownMenuItem(
                value: 'mittel',
                child: Text('Mittel'),
              ),
              DropdownMenuItem(
                value: 'hoch',
                child: Text('Hoch'),
              ),
            ],
            onChanged: (value) {
              if (value == null) return;
              setState(() {
                urgency = value;
              });
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: contentController,
            minLines: 6,
            maxLines: 12,
            decoration: const InputDecoration(
              labelText: 'Mitteilung',
              alignLabelWithHint: true,
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            color: _urgencyColor(urgency).withOpacity(0.08),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(
                    _urgencyIcon(urgency),
                    color: _urgencyColor(urgency),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _urgencyHint(urgency),
                      style: TextStyle(
                        color: _urgencyColor(urgency),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: isSending ? null : sendMessage,
            icon: isSending
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.send),
            label: Text(isSending ? 'Wird gesendet...' : 'Mitteilung senden'),
          ),
        ],
      ),
    );
  }

  Color _urgencyColor(String value) {
    switch (value) {
      case 'hoch':
        return Colors.red;
      case 'mittel':
        return Colors.orange;
      case 'information':
      default:
        return Colors.blueGrey;
    }
  }

  IconData _urgencyIcon(String value) {
    switch (value) {
      case 'hoch':
        return Icons.priority_high;
      case 'mittel':
        return Icons.warning_amber_rounded;
      case 'information':
      default:
        return Icons.info_outline;
    }
  }

  String _urgencyHint(String value) {
    switch (value) {
      case 'hoch':
        return 'Hohe Wichtigkeit: sollte sofort auffallen und als dringlich behandelt werden.';
      case 'mittel':
        return 'Mittlere Wichtigkeit: sichtbar, aber nicht maximal dringlich.';
      case 'information':
      default:
        return 'Information: normale Mitteilung ohne besondere Dringlichkeit.';
    }
  }
}