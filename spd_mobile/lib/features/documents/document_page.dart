import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import 'document_item.dart';
import 'document_viewer_page.dart';

class DocumentsPage extends StatefulWidget {
  const DocumentsPage({super.key});

  @override
  State<DocumentsPage> createState() => _DocumentsPageState();
}

class _DocumentsPageState extends State<DocumentsPage> {
  final api = ApiClient(AppConfig.apiBaseUrl);

  bool _loading = true;
  String? _error;
  List<DocumentItem> _documents = [];

  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data = await api.getJson('/documents');

      if (data is List) {
        _documents = data
            .map((e) => DocumentItem.fromJson(e as Map<String, dynamic>))
            .toList();
      } else {
        _documents = [];
      }
    } catch (e) {
      _error = 'Fehler beim Laden der Dateien';
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  String _categoryLabel(String value) {
    switch (value) {
      case 'kurzuebersicht':
        return 'Kurzübersicht';
      case 'information':
        return 'Information';
      case 'musterantworten':
        return 'Musterantworten';
      case 'reden':
        return 'Reden';
      default:
        return value;
    }
  }

  Map<String, List<DocumentItem>> _groupedDocuments() {
    final grouped = <String, List<DocumentItem>>{};

    for (final doc in _documents) {
      grouped.putIfAbsent(doc.category, () => []);
      grouped[doc.category]!.add(doc);
    }

    return grouped;
  }

  bool _canPreview(DocumentItem doc) {
    final name = doc.filename.toLowerCase();
    final mime = doc.mimeType.toLowerCase();
    return name.endsWith('.pdf') ||
        name.endsWith('.png') ||
        name.endsWith('.jpg') ||
        name.endsWith('.jpeg') ||
        mime.startsWith('application/pdf') ||
        mime.startsWith('image/');
  }

  Future<void> _openDocument(DocumentItem doc) async {
    if (!_canPreview(doc)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Diese Datei kann in der App noch nicht angezeigt werden. Download folgt als Nächstes.',
          ),
        ),
      );
      return;
    }

    try {
      final bytes = await api.getBytes('/documents/${doc.id}/download');

      if (!mounted) return;

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => DocumentViewerPage(
            title: doc.title,
            filename: doc.filename,
            mimeType: doc.mimeType,
            bytes: bytes,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Die Datei konnte gerade nicht geöffnet werden.'),
        ),
      );
    }
  }

  String _createdAtLabel(DateTime value) {
    final local = value.toLocal();
    final d =
        '${local.day.toString().padLeft(2, '0')}.${local.month.toString().padLeft(2, '0')}.${local.year}';
    final t =
        '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
    return '$d · $t Uhr';
  }

  @override
  Widget build(BuildContext context) {
    final grouped = _groupedDocuments();
    final categoryOrder = [
      'kurzuebersicht',
      'information',
      'musterantworten',
      'reden',
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dateien'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadDocuments,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : _documents.isEmpty
                  ? const Center(child: Text('Noch keine Dateien vorhanden'))
                  : ListView(
                      children: categoryOrder
                          .where((category) => grouped.containsKey(category))
                          .map((category) {
                        final docs = grouped[category]!;

                        return Padding(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _categoryLabel(category),
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Zum Öffnen antippen. PDFs und Bilder öffnen direkt in der App.',
                                style: TextStyle(
                                  color: Colors.grey.shade700,
                                  fontSize: 12,
                                ),
                              ),
                              const SizedBox(height: 8),
                              ...docs.map(
                                (doc) => Card(
                                  child: ListTile(
                                    leading: Icon(
                                      _canPreview(doc)
                                          ? Icons.visibility_outlined
                                          : Icons.description_outlined,
                                    ),
                                    title: Text(doc.title),
                                    subtitle: Text(
                                      '${doc.filename}\n${_createdAtLabel(doc.createdAt)}',
                                    ),
                                    isThreeLine: true,
                                    onTap: () => _openDocument(doc),
                                    trailing: IconButton(
                                      tooltip: _canPreview(doc)
                                          ? 'In der App öffnen'
                                          : 'Nicht in der App anzeigbar',
                                      icon: Icon(
                                        _canPreview(doc)
                                            ? Icons.open_in_new
                                            : Icons.lock_outline,
                                      ),
                                      onPressed: () => _openDocument(doc),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        );
                      }).toList(),
                    ),
    );
  }
}
