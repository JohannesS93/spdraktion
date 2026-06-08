import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData light() {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      appBarTheme: const AppBarTheme(centerTitle: true),
      visualDensity: VisualDensity.adaptivePlatformDensity,
    );
  }
}
