import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

class DeviceActivationStore {
  static const _deviceIdKey = 'device_activation.device_id';
  static const _activatedKey = 'device_activation.activated';
  static const _emailKey = 'device_activation.email';

  static Future<bool> isActivated() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_activatedKey) == true;
  }

  static Future<String?> getDeviceIdOrNull() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_deviceIdKey);
  }

  static Future<String> getOrCreateDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_deviceIdKey);
    if (existing != null && existing.isNotEmpty) return existing;

    final random = Random.secure();
    final bytes = List<int>.generate(24, (_) => random.nextInt(256));
    final deviceId = base64Url.encode(bytes).replaceAll('=', '');
    await prefs.setString(_deviceIdKey, deviceId);
    return deviceId;
  }

  static Future<void> markActivated({required String email}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_activatedKey, true);
    await prefs.setString(_emailKey, email);
  }

  static Future<void> clearActivation() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_activatedKey);
    await prefs.remove(_emailKey);
  }
}
