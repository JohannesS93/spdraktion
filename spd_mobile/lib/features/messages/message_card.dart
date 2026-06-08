import 'package:flutter/material.dart';

class MessageCard extends StatelessWidget {
  final String sender;
  final String content;
  final String urgency;

  const MessageCard({
    super.key,
    required this.sender,
    required this.content,
    required this.urgency,
  });

  IconData _icon() {
    switch (urgency) {
      case 'hoch':
        return Icons.warning;
      case 'mittel':
        return Icons.priority_high;
      default:
        return Icons.info;
    }
  }

  Color _color() {
    switch (urgency) {
      case 'hoch':
        return Colors.red;
      case 'mittel':
        return Colors.orange;
      default:
        return Colors.blue;
    }
  }

  String _label() {
    switch (urgency) {
      case 'hoch':
        return "Hoch";
      case 'mittel':
        return "Mittel";
      default:
        return "Information";
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _color();

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(_icon(), color: color, size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _label(),
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: color,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    sender,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Text(content),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}