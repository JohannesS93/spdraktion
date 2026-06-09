"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ArrowLeftRight,
  Bell,
  FileText,
  Lightbulb,
  Info,
  LogOut,
  MessageSquare,
  Pencil,
  Settings,
  Shield,
  UserCog,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearSession } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { API_BASE } from "@/lib/api";

type SessionUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  assigned_mdb_user_id?: string | null;
};

type Props = {
  title: string;
  subtitle?: string;
  session: SessionUser;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
  disabledHint?: string;
};

const SHARED_ADMIN_PGF_NAV: NavItem[] = [
  { href: "/admin/planner", label: "Planer", icon: CalendarDays },
  { href: "/admin/slots", label: "Slots", icon: Pencil },
  { href: "/admin/settings", label: "Einstellungen", icon: Settings },
  { href: "/admin/handbook", label: "Handbuch", icon: BookOpen },
  { href: "/admin/staff", label: "Mitarbeiter", icon: UserCog },
  { href: "/admin/documents", label: "Dateien", icon: FileText },
  { href: "/admin/feedback", label: "Rückmeldungen", icon: Lightbulb },
  { href: "/admin/exchanges", label: "Tausch", icon: ArrowLeftRight, disabled: true, disabledHint: "Später verfügbar" },
  { href: "/admin/messages", label: "Nachrichten", icon: MessageSquare },
  { href: "/admin/stats", label: "Statistik", icon: BarChart3 },
];

const JOHANNES_INFO_EMAIL = "johannes.schaetzl.mdb@bundestag.de";

const ADMIN_ONLY_NAV: NavItem[] = [
  { href: "/admin/users", label: "Nutzer", icon: Users },
];

const MDB_NAV: NavItem[] = [
  { href: "/admin/slots", label: "Präsenzdienste", icon: CalendarDays },
  { href: "/admin/feedback", label: "Rückmeldungen", icon: Lightbulb },
  { href: "/admin/exchanges", label: "Tausch", icon: ArrowLeftRight, disabled: true, disabledHint: "Später verfügbar" },
  { href: "/admin/staff", label: "Mitarbeiter", icon: UserCog },
  { href: "/admin/handbook", label: "Handbuch", icon: BookOpen },
];

function getNav(role: string): NavItem[] {
  if (role === "admin") return [...SHARED_ADMIN_PGF_NAV, ...ADMIN_ONLY_NAV];
  if (role === "pgf") return SHARED_ADMIN_PGF_NAV;
  return MDB_NAV;
}

function getNavForSession(session: SessionUser): NavItem[] {
  const baseNav = getNav(session.role);
  if (session.email?.toLowerCase() === JOHANNES_INFO_EMAIL) {
    return [...baseNav, { href: "/admin/informationen", label: "Informationen", icon: Info }];
  }
  return baseNav;
}

export function AdminShell({
  title,
  subtitle,
  session,
  actions,
  children,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = getNavForSession(session);
  const canSendPush = session.role === "admin" || session.role === "pgf";
  const [pushSending, setPushSending] = useState(false);
  const [pushStatus, setPushStatus] = useState<string | null>(null);

  async function logout() {
    clearSession();
    await auth.signOut();
    router.replace("/");
  }

  async function sendTestPush() {
    if (!canSendPush) return;
    if (pushSending) return;

    setPushStatus(null);
    setPushSending(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        setPushStatus("Nicht eingeloggt.");
        return;
      }

      const token = await firebaseUser.getIdToken();
      const now = new Date().toLocaleString("de-DE");
      const res = await fetch(`${API_BASE}/pgf/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sender_name: "Backend",
          content: `Test-Push (${now})`,
          urgency: "information",
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setPushStatus(`Fehler (${res.status}): ${text || "Push konnte nicht gesendet werden."}`);
        return;
      }

      setPushStatus("Test-Push gesendet.");
    } catch (err) {
      setPushStatus(`Fehler: ${String(err)}`);
    } finally {
      setPushSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f7f8] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="w-[220px] shrink-0 border-r border-slate-200 bg-white">
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 px-5 py-4">
              <Link href="/backend" className="flex items-center gap-3">
                <Image
                  src="/spd-logo.png"
                  alt="SPD"
                  width={80}
                  height={20}
                  className="h-5 w-auto object-contain opacity-90"
                />
                <div className="text-sm font-medium text-slate-900">Fraktion Intern</div>
              </Link>
            </div>

            <nav className="flex-1 p-3">
              <div className="space-y-1">
                {nav.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const classes = [
                    "flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm transition-colors",
                    item.disabled
                      ? "cursor-not-allowed border-l-transparent text-slate-400"
                      : active
                        ? "border-l-[#E3000F] bg-slate-50 text-slate-950"
                        : "border-l-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  ].join(" ");

                  if (item.disabled) {
                    return (
                      <div key={item.href} className={classes} title={item.disabledHint}>
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                        {item.disabledHint ? (
                          <span className="ml-auto text-[11px] uppercase tracking-[0.18em] text-slate-400">
                            {item.disabledHint}
                          </span>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <Link key={item.href} href={item.href} className={classes}>
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </nav>

            <div className="border-t border-slate-200 p-3">
              <div className="mb-3 px-1">
                <div className="text-sm font-medium">
                  {session.first_name} {session.last_name}
                </div>
                <div className="mt-1 text-xs text-slate-500">{session.email}</div>
              </div>

              {canSendPush ? (
                <div className="mb-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start rounded-none"
                    onClick={sendTestPush}
                    disabled={pushSending}
                  >
                    <Bell className="mr-2 h-4 w-4" />
                    {pushSending ? "Sende Test-Push…" : "Test-Push senden"}
                  </Button>
                  {pushStatus ? (
                    <div className="mt-1 px-1 text-xs text-slate-500">{pushStatus}</div>
                  ) : null}
                </div>
              ) : null}

              <Link
                href="/datenschutz"
                target="_blank"
                className="mb-2 block"
                rel="noreferrer"
              >
                <Button
                  variant="outline"
                  className="w-full justify-start rounded-none"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  Datenschutz
                </Button>
              </Link>

              <Button
                variant="outline"
                className="w-full justify-start rounded-none"
                onClick={logout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="relative z-10 border-b border-slate-200 bg-white px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <Image
                  src="/spd-logo.png"
                  alt="SPD"
                  width={96}
                  height={32}
                  className="hidden h-8 w-auto shrink-0 object-contain opacity-90 sm:block"
                />
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                  {subtitle ? (
                    <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
                  ) : null}
                </div>
              </div>

              {actions ? (
                <div className="relative z-20 flex shrink-0 flex-wrap gap-2 pointer-events-auto">
                  {actions}
                </div>
              ) : null}
            </div>
          </div>

          <div className="p-6">
            <div className="space-y-6">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
