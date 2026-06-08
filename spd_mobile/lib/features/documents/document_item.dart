class DocumentItem {
  final String id;
  final String title;
  final String filename;
  final String mimeType;
  final String category;
  final DateTime createdAt;

  DocumentItem({
    required this.id,
    required this.title,
    required this.filename,
    required this.mimeType,
    required this.category,
    required this.createdAt,
  });

  factory DocumentItem.fromJson(Map<String, dynamic> json) {
    return DocumentItem(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      filename: json['filename'] as String? ?? '',
      mimeType: json['mime_type'] as String? ?? '',
      category: json['category'] as String? ?? '',
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}
