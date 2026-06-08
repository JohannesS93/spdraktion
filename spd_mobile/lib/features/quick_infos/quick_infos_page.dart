import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';

class QuickInfosPage extends StatefulWidget {
  const QuickInfosPage({super.key});

  @override
  State<QuickInfosPage> createState() => _QuickInfosPageState();
}

class _QuickInfosPageState extends State<QuickInfosPage> {
  final ApiClient _api = ApiClient(AppConfig.apiBaseUrl);
  final TextEditingController _controller = TextEditingController();
  String _query = '';
  bool _loading = true;
  String? _error;
  List<_QuickInfoTopic> _topics = const [];

  @override
  void initState() {
    super.initState();
    _loadTopics();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadTopics() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data = await _api.getJson('/quick-infos');
      if (data is List) {
        _topics = data
            .map((e) => _QuickInfoTopic.fromJson(e as Map<String, dynamic>))
            .toList();
      } else {
        _topics = [];
      }
    } catch (e) {
      _error = 'Schnellinfos konnten nicht geladen werden.';
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  List<_QuickInfoTopic> get _filteredTopics {
    if (_query.trim().isEmpty) {
      return _topics;
    }

    final needle = _query.toLowerCase().trim();
    return _topics.where((topic) {
      if (topic.title.toLowerCase().contains(needle)) return true;
      if (topic.bullets.any((b) => b.toLowerCase().contains(needle))) {
        return true;
      }
      return false;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final topics = _filteredTopics;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Schnellinfos'),
        centerTitle: true,
      ),
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color(0xFFFBF7F5),
              Color(0xFFF8F1EC),
              Color(0xFFF9F9F9),
            ],
          ),
        ),
        child: RefreshIndicator(
          onRefresh: _loadTopics,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              Text(
                'Thema suchen',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                'Hier entstehen später die durchsuchbaren Talking Points für Debatten, Termine und die schnelle Vorbereitung.',
                style: TextStyle(color: Colors.grey.shade700, height: 1.35),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _controller,
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: 'Zum Beispiel: Rentenniveau',
                  prefixIcon: const Icon(Icons.search),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(18),
                    borderSide: const BorderSide(color: Color(0xFFE8E1E3)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(18),
                    borderSide: const BorderSide(color: Color(0xFFE8E1E3)),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              if (_loading)
                const Center(child: Padding(
                  padding: EdgeInsets.all(24),
                  child: CircularProgressIndicator(),
                ))
              else if (_error != null)
                _EmptyState(message: _error!)
              else ...[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _topics
                      .take(4)
                      .map(
                        (topic) => ActionChip(
                          label: Text(topic.title),
                          onPressed: () {
                            _controller.text = topic.title;
                            setState(() => _query = topic.title);
                          },
                        ),
                      )
                      .toList(),
                ),
                const SizedBox(height: 20),
                if (topics.isEmpty)
                  const _EmptyState(
                    message:
                        'Kein Thema gefunden. Später werden hier auch Backend-Texte und Schlagworte durchsucht.',
                  )
                else
                  ...topics.map(
                    (topic) => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _TopicCard(topic: topic),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _TopicCard extends StatelessWidget {
  const _TopicCard({required this.topic});

  final _QuickInfoTopic topic;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE8E1E3)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: const Color(0xFFB51C2D).withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.lightbulb_outline,
                  color: Color(0xFFB51C2D),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  topic.title,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          ...topic.bullets.map(
            (bullet) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('•  ', style: TextStyle(fontSize: 18, height: 1.2)),
                  Expanded(
                    child: Text(
                      bullet,
                      style: TextStyle(
                        color: Colors.grey.shade800,
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE8E1E3)),
      ),
      child: Text(
        message,
        style: TextStyle(color: Colors.grey.shade700, height: 1.35),
      ),
    );
  }
}

class _QuickInfoTopic {
  const _QuickInfoTopic({
    required this.title,
    required this.slug,
    required this.sortOrder,
    required this.isActive,
    required this.bullets,
  });

  factory _QuickInfoTopic.fromJson(Map<String, dynamic> json) {
    return _QuickInfoTopic(
      title: (json['title'] ?? '').toString(),
      slug: (json['slug'] ?? '').toString(),
      sortOrder: (json['sort_order'] ?? 0) as int,
      isActive: (json['is_active'] ?? true) as bool,
      bullets: (json['bullets'] as List<dynamic>? ?? const [])
          .map((item) => (item as Map<String, dynamic>)['bullet_text'].toString())
          .toList(),
    );
  }

  final String title;
  final String slug;
  final int sortOrder;
  final bool isActive;
  final List<String> bullets;
}
