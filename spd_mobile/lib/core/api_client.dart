import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'logger.dart';

class ApiClient {
  ApiClient(this.baseUrl);

  final String baseUrl;
  static const Duration _requestTimeout = Duration(seconds: 12);

  Uri _uri(String path, {Map<String, String>? query}) {
    return Uri.parse('$baseUrl$path').replace(queryParameters: query);
  }

  Future<Map<String, String>> _headers({bool json = true}) async {
    final user = FirebaseAuth.instance.currentUser;
    final token = await user?.getIdToken();

    AppLogger.i('currentUser: ${user?.email}', tag: 'API');
    AppLogger.i('token null? ${token == null}', tag: 'API');
    AppLogger.i('token empty? ${token?.isEmpty}', tag: 'API');


    final headers = <String, String>{};

    if (json) {
      headers['Content-Type'] = 'application/json';
    }

    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    return headers;
  }

  Future<Uint8List> getBytes(String path, {Map<String, String>? query}) async {
    final uri = _uri(path, query: query);
    final stopwatch = Stopwatch()..start();

    try {
      AppLogger.i('GET BYTES $uri', tag: 'API');

      final resp = await http.get(
        uri,
        headers: await _headers(json: false),
      ).timeout(_requestTimeout);
      stopwatch.stop();

      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        throw Exception('HTTP ${resp.statusCode}: ${resp.body}');
      }

      return resp.bodyBytes;
    } catch (e, st) {
      if (stopwatch.isRunning) stopwatch.stop();

      AppLogger.e(
        'GET BYTES $path crashed after ${stopwatch.elapsedMilliseconds} ms',
        tag: 'API',
        error: e,
        stackTrace: st,
      );
      rethrow;
    }
  }

  Future<dynamic> getJson(String path, {Map<String, String>? query}) async {
    final uri = _uri(path, query: query);
    final stopwatch = Stopwatch()..start();

    try {
      AppLogger.i('GET $uri', tag: 'API');

      final resp = await http.get(
        uri,
        headers: await _headers(json: false),
      ).timeout(_requestTimeout);
      stopwatch.stop();

      AppLogger.i(
        'GET $path -> ${resp.statusCode} (${stopwatch.elapsedMilliseconds} ms)',
        tag: 'API',
      );

      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        AppLogger.w(
          'GET $path failed (${resp.statusCode}) in ${stopwatch.elapsedMilliseconds} ms',
          tag: 'API',
        );
        throw Exception('HTTP ${resp.statusCode}: ${resp.body}');
      }

      if (resp.body.isEmpty) return null;

      return json.decode(resp.body);
    } catch (e, st) {
      if (stopwatch.isRunning) stopwatch.stop();

      AppLogger.e(
        'GET $path crashed after ${stopwatch.elapsedMilliseconds} ms',
        tag: 'API',
        error: e,
        stackTrace: st,
      );
      rethrow;
    }
  }

  Future<dynamic> postJson(String path, Map<String, dynamic> body) async {
    final uri = _uri(path);
    final stopwatch = Stopwatch()..start();

    try {
      AppLogger.i('POST $uri', tag: 'API');

      final resp = await http.post(
        uri,
        headers: await _headers(),
        body: json.encode(body),
      ).timeout(_requestTimeout);
      stopwatch.stop();

      AppLogger.i(
        'POST $path -> ${resp.statusCode} (${stopwatch.elapsedMilliseconds} ms)',
        tag: 'API',
      );

      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        AppLogger.w(
          'POST $path failed (${resp.statusCode}) in ${stopwatch.elapsedMilliseconds} ms',
          tag: 'API',
        );
        throw Exception('HTTP ${resp.statusCode}: ${resp.body}');
      }

      if (resp.body.isEmpty) return null;

      return json.decode(resp.body);
    } catch (e, st) {
      if (stopwatch.isRunning) stopwatch.stop();

      AppLogger.e(
        'POST $path crashed after ${stopwatch.elapsedMilliseconds} ms',
        tag: 'API',
        error: e,
        stackTrace: st,
      );
      rethrow;
    }
  }
}
