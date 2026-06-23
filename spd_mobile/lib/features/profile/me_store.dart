import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import '../../core/logger.dart';
import '../../core/api_client.dart';

class MeStore extends ChangeNotifier {
  MeStore(this.api);

  final ApiClient api;

  String? id;
  String? firstName;
  String? lastName;
  String? group;
  String? role;

  bool loading = false;
  String? error;

  String get displayName {
    final fn = firstName ?? '';
    final ln = lastName ?? '';
    final name = ('$fn $ln').trim();
    return name.isEmpty ? 'Unbekannt' : name;
  }

  String get userIdOrThrow {
    final value = id;
    if (value == null || value.isEmpty) {
      throw Exception('MeStore hat noch keine userId geladen');
    }
    return value;
  }

  String get groupOrEmpty => group ?? '';
  String get roleOrEmpty => role ?? '';
  bool get isPgf => role == 'pgf';
  bool get isMdb => role == 'mdb';
  bool get isMitarbeiter => role == 'mitarbeiter';

  Future<void> loadMe() async {
    AppLogger.i('LOAD ME START', tag: 'MeStore');
    loading = true;
    error = null;
    notifyListeners();

    try {
      final firebaseUser = FirebaseAuth.instance.currentUser;
      final email = firebaseUser?.email;
      if (kDebugMode) {
        AppLogger.i('LOAD ME EMAIL: $email', tag: 'MeStore');
      } else {
        AppLogger.i('LOAD ME EMAIL: <redacted>', tag: 'MeStore');
      }

      if (email == null || email.isEmpty) {
        throw Exception('Kein eingeloggter Firebase-User mit E-Mail gefunden');
      }

      final data =
          await api.getJson('/me', query: {'email': email})
              as Map<String, dynamic>;
      if (kDebugMode) {
        AppLogger.i('LOAD ME DATA: $data', tag: 'MeStore');
      }
      AppLogger.i("ME ROLE: ${data['role']}", tag: 'MeStore');
      id = data['id']?.toString();
      firstName = data['first_name']?.toString();
      lastName = data['last_name']?.toString();
      group = data['group']?.toString();
      role = data['role']?.toString();
    } catch (e, st) {
      // Don't leak internal URLs / emails to end users in release builds.
      final rawError = e.toString();
      if (rawError.contains('User not found')) {
        error =
            'Dieser Account ist in der App noch nicht freigeschaltet. Bitte E-Mail-Adresse prüfen oder eine Onboarding-Einladung erzeugen.';
      } else if (rawError.contains('Device not activated')) {
        error =
            'Dieses Gerät ist für diesen Account nicht aktiviert. Bitte den persönlichen QR-Code scannen.';
      } else if (rawError.contains('UID mismatch')) {
        error =
            'Dieser Login passt nicht zum hinterlegten Account. Bitte beim Support melden.';
      } else {
        error =
            'Nutzerdaten konnten nicht geladen werden. Bitte Internet/VPN prüfen und erneut versuchen.';
      }
      AppLogger.e('LOAD ME ERROR', tag: 'MeStore', error: e, stackTrace: st);
    } finally {
      loading = false;
      notifyListeners();
    }
  }
}
