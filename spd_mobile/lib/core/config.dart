import 'package:flutter/foundation.dart'; // kDebugMode, kIsWeb, kProfileMode, kReleaseMode
import 'dart:io' show Platform;

class AppConfig {
  static const String _apiBaseOverride = String.fromEnvironment('API_BASE_URL');

  static const String _prodApiBaseUrl = 'https://api.spdfraktion-intern.de';

  static String get apiBaseUrl {
    if (_apiBaseOverride.isNotEmpty) {
      return _apiBaseOverride;
    }

    // In Release/Profile default to the deployed backend (TestFlight etc.).
    if (kReleaseMode || kProfileMode) return _prodApiBaseUrl;

    // Falls du mal versehentlich Web startest: kein dart:io Platform benutzen.
    // In debug it's fine to default to local, but production builds must not.
    if (kIsWeb) return 'http://127.0.0.1:8000';

    // In debug on real iOS devices, localhost points to the phone (not your Mac).
    // Default to the deployed backend; local dev can still override via --dart-define.
    if (Platform.isIOS) return _prodApiBaseUrl;

    // Android Emulator -> Host-Mac
    if (Platform.isAndroid) return 'http://10.0.2.2:8000';

    // iOS Simulator -> Host-Mac
    return 'http://127.0.0.1:8000';
  }

  static const String currentUserId = '9648b3dd-617f-411b-bce0-67fe56fb5fb3';
  static const String currentUserGroup = 'C';
}
