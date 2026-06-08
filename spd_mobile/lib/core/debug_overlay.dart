import 'package:flutter/material.dart';
import 'logger.dart';

class DebugOverlay extends StatefulWidget {
  const DebugOverlay({super.key});

  @override
  State<DebugOverlay> createState() => _DebugOverlayState();
}

class _DebugOverlayState extends State<DebugOverlay> {
  bool open = false;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        if (open)
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            height: 300,
            child: Material(
              elevation: 12,
              color: Colors.black.withOpacity(0.9),
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    height: 40,
                    child: Row(
                      children: [
                        const Text(
                          'Logs',
                          style: TextStyle(color: Colors.white),
                        ),
                        const Spacer(),
                        IconButton(
                          icon: const Icon(Icons.delete, color: Colors.white),
                          onPressed: AppLogger.clear,
                        ),
                        IconButton(
                          icon: const Icon(Icons.close, color: Colors.white),
                          onPressed: () => setState(() => open = false),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1, color: Colors.white24),
                  Expanded(
                    child: ValueListenableBuilder(
                      valueListenable: AppLogger.notifier,
                      builder: (_, __, ___) {
                        final logs = AppLogger.logs;

                        return ListView.builder(
                          reverse: true,
                          itemCount: logs.length,
                          itemBuilder: (context, i) {
                            final log = logs[i];

                            return Padding(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 2),
                              child: Text(
                                _format(log),
                                style: TextStyle(
                                  fontSize: 11,
                                  color: _color(log.level),
                                ),
                              ),
                            );
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),

        Positioned(
          bottom: 20,
          right: 20,
          child: FloatingActionButton(
            mini: true,
            onPressed: () => setState(() => open = !open),
            child: const Icon(Icons.bug_report),
          ),
        ),
      ],
    );
  }

  String _format(LogEntry log) {
    final time =
        '${log.time.hour.toString().padLeft(2, '0')}:${log.time.minute.toString().padLeft(2, '0')}';

    final tag = log.tag != null ? '[${log.tag}] ' : '';

    return '$time $tag${log.message}';
  }

  Color _color(LogLevel level) {
    switch (level) {
      case LogLevel.info:
        return Colors.white;
      case LogLevel.warn:
        return Colors.orange;
      case LogLevel.error:
        return Colors.red;
    }
  }
}