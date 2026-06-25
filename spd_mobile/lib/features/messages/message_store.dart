import 'package:flutter/foundation.dart';
import '../../core/api_client.dart';
import 'message.dart';
import '../../core/logger.dart';

class MessageStore extends ChangeNotifier {
  final List<Message> _messages = [];

  // Für den roten Banner
  String? urgentSender;
  String? urgentContent;

  List<Message> get messages => List.unmodifiable(_messages);

  void removeMessage(String messageId) {
    _messages.removeWhere((m) => m.id == messageId);
    notifyListeners();
  }

  void clearMessages() {
    _messages.clear();
    urgentSender = null;
    urgentContent = null;
    notifyListeners();
  }

  void addMessage(Message message) {
    // ❗ Duplikate vermeiden
    if (_messages.any((m) => m.id == message.id)) return;

    _messages.insert(0, message);

    if (message.urgency == 'hoch') {
      urgentSender = message.sender;
      urgentContent = message.content;
    }

    notifyListeners();
  }

  void addFromPush(Map<String, dynamic> data) {
    final msg = Message(
      id: (data["message_id"] ?? "").toString(),
      sender: (data["sender"] ?? data["sender_name"] ?? "Unbekannt").toString(),
      content: (data["content"] ?? "").toString(),
      urgency: (data["urgency"] ?? "information").toString(),
    );

    addMessage(msg);
  }

  // 🔥 NEU: lädt alle Mitteilungen vom Backend
  Future<void> loadFromApi(ApiClient api, {required String userId}) async {
    AppLogger.i('LOAD FROM API START');
    try {
      final data =
          await api.getJson('/messages', query: {'user_id': userId})
              as List<dynamic>;

      _messages.clear();
      // urgentSender/urgentContent absichtlich NICHT zurücksetzen –
      // der Banner wird nur durch Push-Nachrichten (addFromPush) gesetzt,
      // nicht durch das Nachladen der Liste (sonst käme er nach clearUrgentBanner zurück).
      for (final m in data) {
        _messages.add(
          Message(
            id: m['id'].toString(),
            sender: m['sender_name'] ?? '',
            content: m['content'] ?? '',
            urgency: m['urgency'] ?? 'information',
          ),
        );
      }

      notifyListeners();
      AppLogger.i(
        'LOAD FROM API DONE urgentSender=$urgentSender urgentContent=$urgentContent',
      );
    } catch (e) {
      AppLogger.i('load messages failed: $e');
    }
  }

  void clearUrgentBanner() {
    urgentSender = null;
    urgentContent = null;
    notifyListeners();
  }
}
