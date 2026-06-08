import 'package:flutter/foundation.dart';

enum LogLevel { info, warn, error }

class LogEntry {
  LogEntry({
    required this.message,
    required this.level,
    required this.time,
    this.tag,
  });

  final String message;
  final LogLevel level;
  final DateTime time;
  final String? tag;
}

class AppLogger {
  static final List<LogEntry> _logs = [];
  static final ValueNotifier<int> notifier = ValueNotifier(0);

  static List<LogEntry> get logs => List.unmodifiable(_logs);

  static void log(
    String message, {
    LogLevel level = LogLevel.info,
    String? tag,
    Object? error,
    StackTrace? stackTrace,
  }) {
    if (!kDebugMode) return;

    final now = DateTime.now();

    final entry = LogEntry(
      message: message,
      level: level,
      time: now,
      tag: tag,
    );

    _logs.insert(0, entry);

    if (_logs.length > 200) {
      _logs.removeLast();
    }

    notifier.value++;

    final levelStr = switch (level) {
      LogLevel.info => 'INFO',
      LogLevel.warn => 'WARN',
      LogLevel.error => 'ERROR',
    };

    final tagStr = tag != null ? '[$tag]' : '';

    debugPrint('[${now.toIso8601String()}][$levelStr]$tagStr $message');

    if (error != null) debugPrint('   ERROR: $error');
    if (stackTrace != null) debugPrint(stackTrace.toString());
  }

  static void i(String message, {String? tag}) {
    log(message, level: LogLevel.info, tag: tag);
  }

  static void w(String message, {String? tag}) {
    log(message, level: LogLevel.warn, tag: tag);
  }

  static void e(
    String message, {
    String? tag,
    Object? error,
    StackTrace? stackTrace,
  }) {
    log(
      message,
      level: LogLevel.error,
      tag: tag,
      error: error,
      stackTrace: stackTrace,
    );
  }

  static void clear() {
    _logs.clear();
    notifier.value++;
  }
}