import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

class DocumentViewerPage extends StatelessWidget {
  const DocumentViewerPage({
    super.key,
    required this.title,
    required this.filename,
    required this.mimeType,
    required this.bytes,
  });

  final String title;
  final String filename;
  final String mimeType;
  final Uint8List bytes;

  bool get _isPdf {
    final name = filename.toLowerCase();
    return name.endsWith('.pdf') || mimeType.toLowerCase().startsWith('application/pdf');
  }

  bool get _isImage {
    final name = filename.toLowerCase();
    return name.endsWith('.png') ||
        name.endsWith('.jpg') ||
        name.endsWith('.jpeg') ||
        mimeType.toLowerCase().startsWith('image/');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
      ),
      body: _isPdf
          ? PdfPreview(
              build: (_) async => bytes,
              allowPrinting: false,
              allowSharing: false,
              canChangeOrientation: false,
              canChangePageFormat: false,
            )
          : _isImage
              ? InteractiveViewer(
                  child: Center(
                    child: Image.memory(
                      bytes,
                      fit: BoxFit.contain,
                    ),
                  ),
                )
              : Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'Diese Datei kann in der App noch nicht direkt angezeigt werden.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
    );
  }
}
