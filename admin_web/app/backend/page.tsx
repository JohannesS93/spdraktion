"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  FileText,
  Lightbulb,
  MessageSquare,
  Pencil,
  Settings,
  UserCog,
  Users,
} from "lucide-react";
import { clearSession, getSession, type SessionUser } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { AdminShell } from "@/components/admin-shell";
import { getPostLoginRoute } from "@/lib/navigation";

type NavItem = {
  href: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
  disabledHint?: string;
};

const SHARED_ITEMS: NavItem[] = [
  {
    href: "/admin/planner",
    title: "Planer",
    description: "Sitzungswochen erstellen und Präsenzregeln verwalten.",
    icon: CalendarDays,
  },
  {
    href: "/admin/slots",
    title: "Slots",
    description: "Einzelne Slots und Besetzungen manuell anpassen.",
    icon: Pencil,
  },
  {
    href: "/admin/settings",
    title: "Einstellungen",
    description: "Standardslot-Templates zentral verwalten.",
    icon: Settings,
  },
  {
    href: "/admin/staff",
    title: "Mitarbeiter",
    description: "Mitarbeiter-Übersicht und Zuordnungen prüfen.",
    icon: UserCog,
  },
  {
    href: "/admin/documents",
    title: "Dateien",
    description: "Dokumente hochladen, filtern und verteilen.",
    icon: FileText,
  },
  {
    href: "/admin/feedback",
    title: "Rückmeldungen",
    description: "Fehler, Hinweise und Verbesserungsvorschläge sammeln.",
    icon: Lightbulb,
  },
  {
    href: "/admin/exchanges",
    title: "Tausch",
    description: "Der Tauschbereich bleibt vorerst deaktiviert.",
    icon: ArrowLeftRight,
    disabled: true,
    disabledHint: "Später verfügbar",
  },
  {
    href: "/admin/messages",
    title: "Nachrichten",
    description: "Mitteilungen an alle Nutzer senden.",
    icon: MessageSquare,
  },
  {
    href: "/admin/stats",
    title: "Statistik",
    description: "Anwesenheitsstatistik und Übersicht.",
    icon: BarChart3,
  },
];

const ADMIN_ONLY_ITEMS: NavItem[] = [
  {
    href: "/admin/users",
    title: "Nutzer",
    description: "Nutzer anlegen, bearbeiten und Rollen steuern.",
    icon: Users,
  },
];

const STAFF_ITEMS: NavItem[] = [
  {
    href: "/admin/slots",
    title: "Präsenzdienste",
    description: "Nächste Dienste und Teilnehmer ansehen.",
    icon: CalendarDays,
  },
  {
    href: "/admin/exchanges",
    title: "Tausch",
    description: "Der Tauschbereich bleibt vorerst deaktiviert.",
    icon: ArrowLeftRight,
    disabled: true,
    disabledHint: "Später verfügbar",
  },
  {
    href: "/admin/staff",
    title: "Mitarbeiter",
    description: "Eigene Mitarbeiter verwalten.",
    icon: UserCog,
  },
];

function getTodayString() {
  return new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function BackendHomePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        clearSession();
        setSession(null);
        setAuthReady(true);
        router.replace("/");
        return;
      }

      const existing = getSession();
      if (!existing) {
        clearSession();
        setSession(null);
        setAuthReady(true);
        router.replace("/");
        return;
      }

      setSession(existing);
      setAuthReady(true);
    });

    return unsubscribe;
  }, [router]);

  useEffect(() => {
    if (!session) return;
    if (session.role === "admin") return;
    router.replace(getPostLoginRoute(session.role));
  }, [router, session]);

  const navItems = useMemo(() => {
    if (!session) return [];
    if (session.role === "admin") return [...SHARED_ITEMS, ...ADMIN_ONLY_ITEMS];
    if (session.role === "pgf") return SHARED_ITEMS;
    return STAFF_ITEMS;
  }, [session]);

  if (!authReady) {
    return <div className="min-h-screen bg-[#f7f7f8]" />;
  }

  if (!session || session.role !== "admin") return null;

  return (
    <AdminShell
      title="Startseite"
      subtitle={getTodayString()}
      session={session}
    >
      {/* Welcome banner */}
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#E3000F]/10">
            <Image
              src="/spd-logo.png"
              alt="SPD"
              width={24}
              height={24}
              className="h-6 w-auto object-contain"
            />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Willkommen, {session.first_name || session.email}
            </h2>
            <p className="text-sm text-slate-500">
              Wähle einen Bereich, um direkt weiterzuarbeiten.
            </p>
          </div>
        </div>
      </div>

      {/* Nav cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const content = (
            <div
              className={[
                "group flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-150",
                item.disabled
                  ? "cursor-not-allowed opacity-55"
                  : "hover:-translate-y-0.5 hover:border-[#E3000F]/30 hover:shadow-md",
              ].join(" ")}
            >
              <div
                className={[
                  "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                  item.disabled ? "bg-slate-200" : "bg-[#E3000F]/8 group-hover:bg-[#E3000F]/15",
                ].join(" ")}
              >
                <Icon className={["h-5 w-5", item.disabled ? "text-slate-400" : "text-[#E3000F]"].join(" ")} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {item.title}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-slate-500">
                  {item.description}
                </div>
                {item.disabledHint ? (
                  <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                    {item.disabledHint}
                  </div>
                ) : null}
              </div>
            </div>
          );

          return item.disabled ? (
            <div key={item.href}>{content}</div>
          ) : (
            <Link key={item.href} href={item.href}>
              {content}
            </Link>
          );
        })}
      </div>
    </AdminShell>
  );
}
