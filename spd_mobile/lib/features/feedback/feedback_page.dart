import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';

class FeedbackPage extends StatefulWidget {
  const FeedbackPage({super.key});

  @override
  State<FeedbackPage> createState() => _FeedbackPageState();
}

class _FeedbackPageState extends State<FeedbackPage> {
  final api = ApiClient(AppConfig.apiBaseUrl);
  final titleController = TextEditingController();
  final contentController = TextEditingController();

  String kind = 'improvement';
  bool isSending = false;

  @override
  void dispose() {
    titleController.dispose();
    contentController.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    final title = titleController.text.trim();
    final content = contentController.text.trim();

    if (title.isEmpty) {
      _showSnack('Bitte einen kurzen Titel eingeben.');
      return;
    }

    if (content.isEmpty) {
      _showSnack('Bitte eine Beschreibung eingeben.');
      return;
    }

    setState(() {
      isSending = true;
    });

    try {
      await api.postJson('/feedback', {
        'kind': kind,
        'title': title,
        'content': content,
        'context': 'mobile_app',
      });

      if (!mounted) return;
      _showSnack('Rückmeldung wurde gesendet.');
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
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rückmeldung senden')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Fehler oder Verbesserung melden',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(
            'Hier können Hinweise, Probleme und Verbesserungsvorschläge direkt an das Team gesendet werden.',
            style: TextStyle(color: Colors.grey.shade700),
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: kind,
            decoration: const InputDecoration(
              labelText: 'Art der Rückmeldung',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(
                value: 'improvement',
                child: Text('Verbesserungsvorschlag'),
              ),
              DropdownMenuItem(value: 'error', child: Text('Fehler / Problem')),
              DropdownMenuItem(
                value: 'general',
                child: Text('Allgemeiner Hinweis'),
              ),
            ],
            onChanged: (value) {
              if (value == null) return;
              setState(() {
                kind = value;
              });
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: titleController,
            decoration: const InputDecoration(
              labelText: 'Kurzer Titel',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: contentController,
            minLines: 6,
            maxLines: 12,
            decoration: const InputDecoration(
              labelText: 'Beschreibung',
              alignLabelWithHint: true,
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: isSending ? null : submit,
            icon: isSending
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.send),
            label: Text(isSending ? 'Wird gesendet...' : 'Rückmeldung senden'),
          ),
        ],
      ),
    );
  }
}
