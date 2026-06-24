import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_app_badger/flutter_app_badger.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core/api_client.dart';
import 'core/app_theme.dart';
import 'core/config.dart';
import 'core/device_activation.dart';
import 'core/debug_overlay.dart';
import 'core/feature_flags.dart';
import 'features/auth/device_activation_page.dart';
import 'core/logger.dart';
import 'features/auth/login_page.dart';
import 'features/home/home_page.dart';
import 'features/messages/message_store.dart';
import 'features/messages/messages_page.dart';
import 'features/profile/me_store.dart';
import 'features/slots/slots_page.dart';
import 'features/documents/document_page.dart';

// -----------------------------
// Firebase Background Handler
// -----------------------------
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

// DEV: aktueller Nutzer für Push-Token-Registrierung

Future<void> _sendTokenToBackend(String token, String userId) async {
  final uri = Uri.parse('${AppConfig.apiBaseUrl}/users/push-token');

  final firebaseUser = FirebaseAuth.instance.currentUser;
  final idToken = await firebaseUser?.getIdToken();
  if (idToken == null || idToken.isEmpty) {
    AppLogger.w(
      'sendTokenToBackend skipped: missing Firebase idToken',
      tag: 'Push',
    );
    return;
  }

  final res = await http.post(
    uri,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $idToken',
    },
    body: jsonEncode({
      'user_id': userId,
      'token': token,
      'platform': Platform.isIOS ? 'ios' : 'android',
    }),
  );

  AppLogger.i(
    'sendTokenToBackend status=${res.statusCode} body=${res.body}',
    tag: 'Push',
  );
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();

  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

  AppLogger.i('App gestartet', tag: 'App');
  runApp(const PraesenzdienstApp());
}

class PraesenzdienstApp extends StatefulWidget {
  const PraesenzdienstApp({super.key});

  @override
  State<PraesenzdienstApp> createState() => _PraesenzdienstAppState();
}

class _PraesenzdienstAppState extends State<PraesenzdienstApp> {
  int activationReloadKey = 0;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Fraktions-App',
      theme: AppTheme.light(),
      builder: (context, child) {
        if (!kDebugMode) return child!;
        return Stack(children: [child!, const DebugOverlay()]);
      },
      home: FutureBuilder<bool>(
        key: ValueKey(activationReloadKey),
        future: DeviceActivationStore.isActivated(),
        builder: (context, activationSnap) {
          if (activationSnap.connectionState == ConnectionState.waiting) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }

          if (activationSnap.data != true) {
            return DeviceActivationPage(
              onActivated: () {
                setState(() {
                  activationReloadKey += 1;
                });
              },
            );
          }

          return StreamBuilder<User?>(
            stream: FirebaseAuth.instance.authStateChanges(),
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Scaffold(
                  body: Center(child: CircularProgressIndicator()),
                );
              }

              if (snap.data == null) {
                return const LoginPage();
              }

              return const AppShell();
            },
          );
        },
      ),
    );
  }
}

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  String? transientBannerTitle;
  String? transientBannerBody;
  Color? transientBannerColor;
  int? transientBannerTargetTab;
  int index = 0;
  int slotsReloadKey = 0;
  int unreadCount = 0;
  void _showTransientBanner({
    required String title,
    required String body,
    required Color color,
    int? targetTab,
  }) {
    if (!mounted) return;

    setState(() {
      transientBannerTitle = title;
      transientBannerBody = body;
      transientBannerColor = color;
      transientBannerTargetTab = targetTab;
    });
  }

  void _clearTransientBanner() {
    if (!mounted) return;

    setState(() {
      transientBannerTitle = null;
      transientBannerBody = null;
      transientBannerColor = null;
      transientBannerTargetTab = null;
    });
  }

  late final MeStore meStore = MeStore(ApiClient(AppConfig.apiBaseUrl));
  final MessageStore messageStore = MessageStore();
  final api = ApiClient(AppConfig.apiBaseUrl);

  StreamSubscription<RemoteMessage>? _onMessageSub;
  StreamSubscription<RemoteMessage>? _onMessageOpenedSub;
  StreamSubscription<String>? _onTokenRefreshSub;
  DateTime? _lastResumeRefreshAt;
  _AppVersionPolicy? _appVersionPolicy;
  bool _showSoftUpdateNotice = false;

  late Future<void> meFuture;

  String get currentUserId {
    final id = meStore.id;
    if (id == null || id.isEmpty) {
      throw Exception('MeStore hat keine userId');
    }
    return id;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    meFuture = _initApp();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _onMessageSub?.cancel();
    _onMessageOpenedSub?.cancel();
    _onTokenRefreshSub?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshMessagesOnResume();
    }
  }

  void _refreshMessagesOnResume() {
    final now = DateTime.now();
    final last = _lastResumeRefreshAt;
    if (last != null && now.difference(last) < const Duration(seconds: 20)) {
      return;
    }
    _lastResumeRefreshAt = now;

    if (meStore.id == null || meStore.id!.isEmpty) return;

    // Lightweight refresh so new Mitteilungen show up even if push is delayed/missed.
    unawaited(messageStore.loadFromApi(api, userId: meStore.userIdOrThrow));
    unawaited(_loadUnreadCount());
  }

  Future<void> _initApp() async {
    AppLogger.i('Initialisierung gestartet', tag: 'AppShell');

    await meStore.loadMe();
    if (meStore.id == null || meStore.id!.isEmpty) {
      AppLogger.w(
        'Start abgebrochen, weil keine userId geladen wurde.',
        tag: 'AppShell',
      );
      return;
    }
    await _loadUnreadCount();
    await _loadAppVersionPolicy();

    _initPush();
    messageStore.loadFromApi(api, userId: meStore.userIdOrThrow);

    AppLogger.i('Initialisierung abgeschlossen', tag: 'AppShell');
  }

  Future<void> _loadUnreadCount() async {
    try {
      final data =
          await api.getJson(
                '/messages/unread-count',
                query: {'user_id': currentUserId},
              )
              as Map<String, dynamic>;

      if (!mounted) return;

      setState(() {
        unreadCount = (data['unread_count'] ?? 0) as int;
      });

      // Keep the iOS home screen app-icon badge in sync with the server count.
      // (APNS badge updates only arrive with pushes; reading messages should update immediately.)
      if (Platform.isIOS) {
        final count = unreadCount;
        if (count <= 0) {
          FlutterAppBadger.removeBadge();
        } else {
          FlutterAppBadger.updateBadgeCount(count);
        }
      }
    } catch (e, st) {
      AppLogger.e(
        'load unread count failed',
        tag: 'Messages',
        error: e,
        stackTrace: st,
      );
    }
  }

  Future<void> _loadAppVersionPolicy() async {
    try {
      final info = await PackageInfo.fromPlatform();
      final platform = Platform.isIOS ? 'ios' : 'android';
      final payload =
          await api.getJson(
                '/me/app-version-policy',
                query: {'platform': platform, 'current_version': info.version},
              )
              as Map<String, dynamic>?;
      if (!mounted || payload == null) return;
      final policy = _AppVersionPolicy.fromJson(payload);
      setState(() {
        _appVersionPolicy = policy;
        _showSoftUpdateNotice =
            policy.recommendedUpdate && !policy.updateRequired;
      });
    } catch (e, st) {
      AppLogger.e(
        'load app version policy failed',
        tag: 'Update',
        error: e,
        stackTrace: st,
      );
    }
  }

  Future<void> _openStoreUpdate() async {
    final raw = _appVersionPolicy?.storeUrl ?? '';
    if (raw.isEmpty) return;
    final uri = Uri.tryParse(raw);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _markAllMessagesAsRead() async {
    AppLogger.i('MARK ALL AS READ START', tag: 'Messages');

    try {
      await api.postJson('/messages/read-all?user_id=$currentUserId', {});
    } catch (e, st) {
      AppLogger.e(
        'mark all read failed',
        tag: 'Messages',
        error: e,
        stackTrace: st,
      );
    }

    await _loadUnreadCount();
    AppLogger.i('MARK ALL AS READ DONE', tag: 'Messages');
  }

  Future<void> _initPush() async {
    AppLogger.i('INIT PUSH START', tag: 'Push');

    final messaging = FirebaseMessaging.instance;

    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    AppLogger.i(
      'permission status=${settings.authorizationStatus}',
      tag: 'Push',
    );

    // iOS: show notifications while app is foreground (otherwise only onMessage fires).
    if (Platform.isIOS) {
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );
    }

    _registerMessageListeners();

    if (Platform.isIOS) {
      try {
        final apnsToken = await messaging.getAPNSToken();
        AppLogger.i(
          'APNS token received? ${apnsToken != null && apnsToken.isNotEmpty}',
          tag: 'Push',
        );
      } catch (e, st) {
        AppLogger.w('getAPNSToken failed (ok on simulator): $e', tag: 'Push');
        AppLogger.e(
          'APNS token fetch issue',
          tag: 'Push',
          error: e,
          stackTrace: st,
        );
      }
    }

    try {
      final fcmToken = await messaging.getToken();
      AppLogger.i(
        'FCM token received? ${fcmToken != null && fcmToken.isNotEmpty}',
        tag: 'Push',
      );
      if (fcmToken != null && fcmToken.isNotEmpty) {
        final tail = fcmToken.length <= 10
            ? fcmToken
            : fcmToken.substring(fcmToken.length - 10);
        AppLogger.i('FCM token tail=…$tail', tag: 'Push');
      }

      if (fcmToken != null && fcmToken.isNotEmpty) {
        await _sendTokenToBackend(fcmToken, currentUserId);
      } else {
        AppLogger.w('FCM token is null/empty.', tag: 'Push');
      }
    } catch (e, st) {
      AppLogger.e('FCM getToken failed', tag: 'Push', error: e, stackTrace: st);
    }

    _onTokenRefreshSub?.cancel();
    _onTokenRefreshSub = FirebaseMessaging.instance.onTokenRefresh.listen((
      newToken,
    ) async {
      AppLogger.i('FCM token refreshed', tag: 'Push');
      try {
        await _sendTokenToBackend(newToken, currentUserId);
      } catch (e, st) {
        AppLogger.e(
          'sendTokenToBackend(refresh) failed',
          tag: 'Push',
          error: e,
          stackTrace: st,
        );
      }
    });

    final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) {
      await _handleIncomingMessage(initialMessage, openedByTap: true);
    }

    AppLogger.i('INIT PUSH DONE', tag: 'Push');
  }

  void _registerMessageListeners() {
    _onMessageSub?.cancel();
    _onMessageSub = FirebaseMessaging.onMessage.listen((
      RemoteMessage message,
    ) async {
      AppLogger.i('ON MESSAGE FIRED', tag: 'Push');
      AppLogger.i('ON MESSAGE DATA: ${message.data}', tag: 'Push');
      AppLogger.i(
        'ON MESSAGE NOTIFICATION: ${message.notification?.title} / ${message.notification?.body}',
        tag: 'Push',
      );

      await _handleIncomingMessage(message, openedByTap: false);
    });

    _onMessageOpenedSub?.cancel();
    _onMessageOpenedSub = FirebaseMessaging.onMessageOpenedApp.listen((
      RemoteMessage message,
    ) async {
      AppLogger.i('ON MESSAGE OPENED APP', tag: 'Push');
      await _handleIncomingMessage(message, openedByTap: true);
    });
  }

  Future<void> _handleIncomingMessage(
    RemoteMessage message, {
    required bool openedByTap,
  }) async {
    final data = message.data;
    final type = (data['type'] ?? '').toString();

    if (type == 'pgf_message') {
      await messageStore.loadFromApi(api, userId: meStore.userIdOrThrow);
      await _loadUnreadCount();

      final urgency = (data['urgency'] ?? '').toString();

      final String title;
      final Color color;
      if (urgency == 'hoch') {
        title = 'Dringende Mitteilung';
        color = Colors.red;
      } else if (urgency == 'mittel') {
        title = 'Wichtige Mitteilung';
        color = Colors.orange;
      } else {
        title = 'Neue Mitteilung';
        color = const Color(0xFF39424E);
      }

      // Always show an in-app banner in foreground so users notice immediately,
      // even if iOS decides not to show system banners while the app is open.
      _showTransientBanner(
        title: title,
        body:
            message.notification?.body ??
            (urgency == 'hoch'
                ? 'Es gibt eine neue dringende Mitteilung.'
                : 'Es gibt eine neue Mitteilung.'),
        color: color,
        targetTab: 3,
      );

      if (openedByTap && mounted) {
        setState(() => index = 3);
      }

      return;
    }

    if (type == 'pgf_message_deleted') {
      await messageStore.loadFromApi(api, userId: meStore.userIdOrThrow);
      await _loadUnreadCount();

      _showTransientBanner(
        title: 'Mitteilung entfernt',
        body: 'Eine Mitteilung wurde entfernt.',
        color: const Color(0xFF39424E),
        targetTab: 3,
      );

      if (openedByTap && mounted) {
        setState(() => index = 3);
      }

      return;
    }

    if (type == 'pgf_messages_bulk_deleted') {
      await messageStore.loadFromApi(api, userId: meStore.userIdOrThrow);
      await _loadUnreadCount();

      _showTransientBanner(
        title: 'Mitteilungen aktualisiert',
        body: 'Mitteilungen wurden entfernt. Die Liste wurde aktualisiert.',
        color: const Color(0xFF39424E),
        targetTab: 3,
      );

      if (openedByTap && mounted) {
        setState(() => index = 3);
      }

      return;
    }

    if (type == 'attendance_reminder') {
      _showTransientBanner(
        title: 'Sitzungsdienst fehlt',
        body:
            'Du bist seit 30 Minuten eingeteilt, aber noch nicht eingecheckt.',
        color: Colors.red,
        targetTab: 1,
      );

      if (openedByTap && mounted) {
        setState(() => index = 1);
      }

      return;
    }

    if (type == 'parliament_roll_call') {
      final top = (data['top'] ?? '').toString();
      final titleText = (data['title'] ?? '').toString();
      _showTransientBanner(
        title: 'Namentliche Abstimmung in Kürze',
        body: [top, titleText].where((part) => part.isNotEmpty).join(' • '),
        color: const Color(0xFFB51C2D),
        targetTab: 0,
      );

      if (openedByTap && mounted) {
        setState(() => index = 0);
      }

      return;
    }

    if (type == 'parliament_speech') {
      final titleText = (data['title'] ?? '').toString();
      _showTransientBanner(
        title: 'Rede in Kürze',
        body: titleText.isEmpty
            ? 'Deine nächste Rede beginnt bald.'
            : titleText,
        color: const Color(0xFF6F4D57),
        targetTab: 0,
      );

      if (openedByTap && mounted) {
        setState(() => index = 0);
      }

      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: meFuture,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        if (snap.hasError) {
          return Scaffold(
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'Fehler beim Laden des Nutzers:\n${snap.error}',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          );
        }

        if (meStore.id == null || meStore.id!.isEmpty) {
          return Scaffold(
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 48),
                    const SizedBox(height: 12),
                    const Text(
                      'Die Nutzerdaten konnten beim Start nicht geladen werden.',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      meStore.error ??
                          'Bitte die App neu laden oder erneut anmelden.',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () {
                        setState(() {
                          meFuture = _initApp();
                        });
                      },
                      child: const Text('Erneut laden'),
                    ),
                    const SizedBox(height: 10),
                    TextButton(
                      onPressed: () async {
                        await FirebaseAuth.instance.signOut();
                      },
                      child: const Text('Zur Anmeldung'),
                    ),
                  ],
                ),
              ),
            ),
          );
        }

        final pages = [
          HomePage(
            onNavigateToTab: (i) => setState(() => index = i),
            meStore: meStore,
            liveUnreadCount: unreadCount,
          ),
          SlotsPage(key: ValueKey(slotsReloadKey), meStore: meStore),
          const _DisabledFeaturePage(
            title: 'Tausch',
            message:
                'Das Tauschtool bleibt vorerst deaktiviert und wird später freigeschaltet.',
          ),
          MessagesPage(
            store: messageStore,
            api: api,
            userId: meStore.userIdOrThrow, // ← NEU
            // Keep the Home "Ungelesen" KPI in sync when messages are read/hidden.
            onMarkedRead: _loadUnreadCount,
          ),
          const DocumentsPage(),
        ];

        if (_appVersionPolicy?.updateRequired == true &&
            _appVersionPolicy?.forceUpdate == true) {
          return _ForceUpdatePage(
            title: 'Update erforderlich',
            message: _appVersionPolicy?.message.isNotEmpty == true
                ? _appVersionPolicy!.message
                : 'Bitte aktualisiere die App, bevor du sie weiter nutzt.',
            currentVersion: _appVersionPolicy?.currentVersion ?? '—',
            targetVersion:
                _appVersionPolicy?.minRequiredVersion.isNotEmpty == true
                ? _appVersionPolicy!.minRequiredVersion
                : (_appVersionPolicy?.latestVersion ?? '—'),
            onRefresh: () async {
              await _loadAppVersionPolicy();
              setState(() {});
            },
            onUpdate: _openStoreUpdate,
          );
        }

        return Scaffold(
          body: SafeArea(
            child: AnimatedBuilder(
              animation: messageStore,
              builder: (context, _) {
                final hasUrgentMessageBanner =
                    messageStore.urgentSender != null &&
                    messageStore.urgentContent != null;

                final hasTransientBanner =
                    transientBannerTitle != null &&
                    transientBannerBody != null &&
                    transientBannerColor != null;

                final showBanner = hasUrgentMessageBanner || hasTransientBanner;
                return Stack(
                  children: [
                    IndexedStack(index: index, children: pages),
                    if (_showSoftUpdateNotice && _appVersionPolicy != null)
                      Align(
                        alignment: Alignment.topCenter,
                        child: Material(
                          elevation: 6,
                          child: Container(
                            width: double.infinity,
                            color: const Color(0xFF39424E),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(
                                  Icons.system_update,
                                  color: Colors.white,
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        'Update verfügbar',
                                        style: TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      Text(
                                        _appVersionPolicy!.message.isNotEmpty
                                            ? _appVersionPolicy!.message
                                            : 'Eine neuere App-Version steht bereit.',
                                        style: const TextStyle(
                                          color: Colors.white,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                TextButton(
                                  onPressed: _openStoreUpdate,
                                  child: const Text(
                                    'Update',
                                    style: TextStyle(color: Colors.white),
                                  ),
                                ),
                                IconButton(
                                  onPressed: () {
                                    setState(
                                      () => _showSoftUpdateNotice = false,
                                    );
                                  },
                                  icon: const Icon(
                                    Icons.close,
                                    color: Colors.white,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    if (showBanner)
                      Align(
                        alignment:
                            _showSoftUpdateNotice && _appVersionPolicy != null
                            ? const Alignment(0, -0.75)
                            : Alignment.topCenter,
                        child: Material(
                          elevation: 6,
                          child: InkWell(
                            onTap: () async {
                              if (hasTransientBanner) {
                                final target = transientBannerTargetTab;
                                _clearTransientBanner();

                                if (target != null && mounted) {
                                  setState(() => index = target);
                                  if (target == 3) {
                                    await _markAllMessagesAsRead();
                                  }
                                }
                                return;
                              }

                              setState(() => index = 3);
                              messageStore.clearUrgentBanner();
                              await _markAllMessagesAsRead();
                            },
                            child: Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 10,
                              ),
                              color: hasTransientBanner
                                  ? transientBannerColor!
                                  : Colors.red,
                              child: Row(
                                children: [
                                  const Icon(
                                    Icons.warning,
                                    color: Colors.white,
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          hasTransientBanner
                                              ? transientBannerTitle!
                                              : 'Dringend',
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                        Text(
                                          hasTransientBanner
                                              ? transientBannerBody!
                                              : '${messageStore.urgentSender}: ${messageStore.urgentContent}',
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            color: Colors.white,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  IconButton(
                                    onPressed: () {
                                      if (hasTransientBanner) {
                                        _clearTransientBanner();
                                      } else {
                                        messageStore.clearUrgentBanner();
                                      }
                                    },
                                    icon: const Icon(
                                      Icons.close,
                                      color: Colors.white,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
          bottomNavigationBar: NavigationBar(
            labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
            selectedIndex: index,
            onDestinationSelected: (i) async {
              if (i == 2 && !exchangesEnabled) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Das Tauschtool wird später freigeschaltet.'),
                  ),
                );
                return;
              }

              if (i == 1) {
                setState(() {
                  index = i;
                  slotsReloadKey++;
                });
              } else {
                setState(() => index = i);
              }

              if (i == 3) {
                // Refresh messages when user opens the tab (tab stays alive, so initState won't re-run).
                await messageStore.loadFromApi(
                  api,
                  userId: meStore.userIdOrThrow,
                );
                await _loadUnreadCount();
                messageStore.clearUrgentBanner();
                await _markAllMessagesAsRead();
              }
            },
            destinations: [
              const NavigationDestination(
                icon: Icon(Icons.home),
                label: 'Home',
              ),
              const NavigationDestination(
                icon: Icon(Icons.calendar_month),
                label: 'Dienstplan',
              ),
              NavigationDestination(
                icon: Icon(
                  Icons.swap_horiz,
                  color: exchangesEnabled ? null : Colors.grey,
                ),
                label: 'Tausch',
              ),
              NavigationDestination(
                icon: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    const Icon(Icons.notifications),
                    if (unreadCount > 0)
                      Positioned(
                        right: -6,
                        top: -6,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.red,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          constraints: const BoxConstraints(
                            minWidth: 16,
                            minHeight: 16,
                          ),
                          child: Text(
                            unreadCount > 99 ? '99+' : '$unreadCount',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                  ],
                ),
                label: 'Post',
              ),
              const NavigationDestination(
                icon: Icon(Icons.folder),
                label: 'Dateien',
              ),
            ],
          ),
        );
      },
    );
  }
}

class _AppVersionPolicy {
  const _AppVersionPolicy({
    required this.platform,
    required this.currentVersion,
    required this.latestVersion,
    required this.minRequiredVersion,
    required this.forceUpdate,
    required this.storeUrl,
    required this.message,
    required this.updateRequired,
    required this.recommendedUpdate,
  });

  factory _AppVersionPolicy.fromJson(Map<String, dynamic> json) {
    return _AppVersionPolicy(
      platform: (json['platform'] ?? '').toString(),
      currentVersion: (json['current_version'] ?? '').toString(),
      latestVersion: (json['latest_version'] ?? '').toString(),
      minRequiredVersion: (json['min_required_version'] ?? '').toString(),
      forceUpdate: json['force_update'] == true,
      storeUrl: (json['store_url'] ?? '').toString(),
      message: (json['message'] ?? '').toString(),
      updateRequired: json['update_required'] == true,
      recommendedUpdate: json['recommended_update'] == true,
    );
  }

  final String platform;
  final String currentVersion;
  final String latestVersion;
  final String minRequiredVersion;
  final bool forceUpdate;
  final String storeUrl;
  final String message;
  final bool updateRequired;
  final bool recommendedUpdate;
}

class _ForceUpdatePage extends StatelessWidget {
  const _ForceUpdatePage({
    required this.title,
    required this.message,
    required this.currentVersion,
    required this.targetVersion,
    required this.onRefresh,
    required this.onUpdate,
  });

  final String title;
  final String message;
  final String currentVersion;
  final String targetVersion;
  final Future<void> Function() onRefresh;
  final Future<void> Function() onUpdate;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.system_update_alt,
                        size: 40,
                        color: Color(0xFFB51C2D),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(message),
                      const SizedBox(height: 16),
                      Text('Aktuelle Version: $currentVersion'),
                      Text('Erforderliche Version: $targetVersion'),
                      const SizedBox(height: 20),
                      Row(
                        children: [
                          Expanded(
                            child: FilledButton(
                              onPressed: onUpdate,
                              child: const Text('Zum Update'),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: OutlinedButton(
                              onPressed: onRefresh,
                              child: const Text('Erneut prüfen'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DisabledFeaturePage extends StatelessWidget {
  const _DisabledFeaturePage({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.lock_clock_outlined,
                    size: 42,
                    color: Colors.grey.shade600,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    message,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey.shade700),
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
