import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/config.dart';
import '../../core/device_activation.dart';

class DeviceActivationPage extends StatefulWidget {
  const DeviceActivationPage({super.key, required this.onActivated});

  final VoidCallback onActivated;

  @override
  State<DeviceActivationPage> createState() => _DeviceActivationPageState();
}

class _DeviceActivationPageState extends State<DeviceActivationPage> {
  final codeController = TextEditingController();
  final emailController = TextEditingController();
  final passwordController = TextEditingController();
  final passwordRepeatController = TextEditingController();

  bool loading = false;
  String? error;
  String? info;

  @override
  void dispose() {
    codeController.dispose();
    emailController.dispose();
    passwordController.dispose();
    passwordRepeatController.dispose();
    super.dispose();
  }

  String _extractCode(String raw) {
    final text = raw.trim();
    final uri = Uri.tryParse(text);
    final code = uri?.queryParameters['code'];
    if (code != null && code.isNotEmpty) return code;
    return text;
  }

  Future<void> _scanCode() async {
    final code = await Navigator.of(
      context,
    ).push<String>(MaterialPageRoute(builder: (_) => const _QrScanPage()));
    if (code == null || code.isEmpty) return;
    setState(() {
      codeController.text = _extractCode(code);
      info = 'QR-Code gelesen. Bitte E-Mail und Passwort ergänzen.';
      error = null;
    });
  }

  Future<void> _activate() async {
    final code = _extractCode(codeController.text);
    final email = emailController.text.trim();
    final password = passwordController.text;

    if (code.isEmpty || email.isEmpty || password.isEmpty) {
      setState(() => error = 'Bitte QR-Code, E-Mail und Passwort ausfüllen.');
      return;
    }
    if (password != passwordRepeatController.text) {
      setState(() => error = 'Die Passwörter stimmen nicht überein.');
      return;
    }
    if (password.length < 10) {
      setState(() => error = 'Das Passwort muss mindestens 10 Zeichen haben.');
      return;
    }

    setState(() {
      loading = true;
      error = null;
      info = null;
    });

    try {
      final deviceId = await DeviceActivationStore.getOrCreateDeviceId();
      final uri = Uri.parse('${AppConfig.apiBaseUrl}/onboarding/activate');
      final response = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'code': code,
          'email': email,
          'password': password,
          'device_id': deviceId,
          'device_name': Platform.localHostname,
          'platform': Platform.isIOS ? 'ios' : 'android',
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          response.body.isNotEmpty
              ? response.body
              : 'Aktivierung fehlgeschlagen',
        );
      }

      await DeviceActivationStore.markActivated(email: email);
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      widget.onActivated();
    } catch (e) {
      setState(() {
        error = e.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() => loading = false);
      }
    }
  }

  Future<void> _activateReviewAccess() async {
    setState(() {
      loading = true;
      error = null;
      info = null;
    });

    try {
      final deviceId = await DeviceActivationStore.getOrCreateDeviceId();
      final uri = Uri.parse('${AppConfig.apiBaseUrl}/onboarding/review-access');
      final response = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'device_id': deviceId,
          'device_name': Platform.localHostname,
          'platform': Platform.isIOS ? 'ios' : 'android',
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          response.body.isNotEmpty
              ? response.body
              : 'Testzugang konnte nicht aktiviert werden',
        );
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final email = (data['email'] ?? '').toString();
      await DeviceActivationStore.markActivated(email: email);
      if (!mounted) return;
      setState(() {
        emailController.text = email;
        info = 'Testzugang aktiviert. Bitte mit dem Review-Account anmelden.';
      });
      widget.onActivated();
    } catch (e) {
      setState(() {
        error = e.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() => loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset(
                    'assets/spd-logo.png',
                    height: 72,
                    alignment: Alignment.centerLeft,
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Gerät aktivieren',
                    style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Bitte scanne den persönlichen QR-Code aus dem Brief. Danach setzt du dein Passwort für dieses Gerät.',
                    style: TextStyle(fontSize: 16, height: 1.35),
                  ),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    onPressed: loading ? null : _scanCode,
                    icon: const Icon(Icons.qr_code_scanner),
                    label: const Text('QR-Code scannen'),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: codeController,
                    decoration: const InputDecoration(
                      labelText: 'Aktivierungscode',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'Bundestags-E-Mail',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: passwordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Neues Passwort',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: passwordRepeatController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Passwort wiederholen',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (info != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        info!,
                        style: const TextStyle(color: Colors.green),
                      ),
                    ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        error!,
                        style: const TextStyle(color: Colors.red),
                      ),
                    ),
                  FilledButton(
                    onPressed: loading ? null : _activate,
                    child: loading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Gerät verbinden und Passwort setzen'),
                  ),
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    onPressed: loading ? null : _activateReviewAccess,
                    icon: const Icon(Icons.verified_user_outlined),
                    label: const Text('Testzugang aktivieren'),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Nur für App-Prüfung und interne Tests. Der Testzugang zeigt keine produktiven Dokumente, Dienste oder Mitteilungen.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, height: 1.3),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _QrScanPage extends StatefulWidget {
  const _QrScanPage();

  @override
  State<_QrScanPage> createState() => _QrScanPageState();
}

class _QrScanPageState extends State<_QrScanPage> {
  final MobileScannerController controller = MobileScannerController();
  bool handled = false;

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  Future<void> _handleDetect(BarcodeCapture capture) async {
    if (handled) return;
    final value = capture.barcodes.firstOrNull?.rawValue;
    if (value == null || value.isEmpty) return;

    handled = true;
    await controller.stop();
    if (!mounted) return;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('QR-Code scannen')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: controller,
            onDetect: (capture) {
              void _ = _handleDetect(capture);
            },
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              color: Colors.black54,
              child: const Text(
                'QR-Code aus dem Brief in den Rahmen halten.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white, fontSize: 16),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
