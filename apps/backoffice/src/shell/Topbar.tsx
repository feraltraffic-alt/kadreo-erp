import type { RoleCode, SearchResults } from "@kadreo/domain";
import { LOCALE_LABEL, LOCALES, useI18n, useLocalized } from "@kadreo/i18n";
import { Avatar, Button, cn, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, useToast } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Building2, Check, ChevronDown, FileText, Loader2, Search, User, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, useSession } from "../app/session";
import { NOW } from "../lib/format";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-[70px] items-center gap-4 border-b border-border bg-surface px-8">
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-3">
        <LanguageMenu />
        <NotificationsBell />
        <UserMenu />
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- global search 8.4 */

type Hit = { group: keyof SearchResults; id: string; label: string; sub: string };
const groupIcon = { workers: Users, sites: Building2, clients: Building2, contracts: FileText } as const;
const groupPath = { workers: "/workers/", sites: "/sites/", clients: "/clients/", contracts: "/contracts/" } as const;

function GlobalSearch() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const res = useQuery({ queryKey: ["search", debounced], queryFn: () => api.search(debounced), enabled: debounced.length >= 2 });
  const hits = useMemo<Hit[]>(() => {
    if (!res.data) return [];
    return (Object.keys(res.data) as (keyof SearchResults)[]).flatMap((g) => res.data[g].map((h) => ({ group: g, ...h })));
  }, [res.data]);

  useEffect(() => setActive(0), [debounced]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    navigate(groupPath[h.group] + h.id);
  };

  return (
    <Popover open={open && q.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative w-full max-w-[486px]">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter" && hits[active]) {
                go(hits[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            role="combobox"
            aria-expanded={open && q.length > 0}
            aria-controls="global-search-results"
            aria-label={t("search.label")}
            placeholder={t("search.placeholder")}
            className="h-[42px] w-full rounded-control border border-border bg-bg pr-16 pl-10 text-[14px] placeholder:text-muted focus:border-accent-strong focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <span className="absolute top-1/2 right-3 -translate-y-1/2">
            <Kbd>Ctrl K</Kbd>
          </span>
        </div>
      </PopoverAnchor>
      <PopoverContent onOpenAutoFocus={(e) => e.preventDefault()} className="w-[var(--radix-popover-trigger-width)] max-w-[486px] min-w-[360px] p-2">
        <div id="global-search-results" role="listbox">
          {q.trim().length < 2 ? (
            <p className="px-2 py-3 text-[13px] text-muted">{t("search.minChars")}</p>
          ) : res.isFetching && !res.data ? (
            <p className="flex items-center gap-2 px-2 py-3 text-[13px] text-muted">
              <Loader2 className="size-4 animate-spin" />
            </p>
          ) : hits.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-muted">{t("search.empty", { q: debounced })}</p>
          ) : (
            (Object.keys(groupIcon) as (keyof SearchResults)[]).map((g) => {
              const groupHits = hits.filter((h) => h.group === g);
              if (!groupHits.length) return null;
              const Icon = groupIcon[g];
              return (
                <div key={g} className="py-1">
                  <div className="px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{t(`search.group.${g}`)}</div>
                  {groupHits.map((h) => {
                    const idx = hits.indexOf(h);
                    return (
                      <button
                        key={h.id}
                        type="button"
                        role="option"
                        aria-selected={idx === active}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(h)}
                        className={cn("flex w-full items-center gap-3 rounded-[8px] px-2 py-2 text-left", idx === active && "bg-divider")}
                      >
                        <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{h.label}</span>
                        <span className="shrink-0 text-[12px] text-muted">{h.sub}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ---------------------------------------------------------------------- language */

function LanguageMenu() {
  const { t, locale } = useI18n();
  const { setLocale } = useSession();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" className="gap-1.5 px-3" aria-label={t("lang.label")}>
          {LOCALE_LABEL[locale]}
          <ChevronDown className="size-4 text-muted" />
        </Button>
      </MenuTrigger>
      <MenuContent className="min-w-36">
        <MenuLabel>{t("lang.label")}</MenuLabel>
        {LOCALES.map((l) => (
          <MenuItem key={l} onSelect={() => setLocale(l)}>
            <span className="w-7 font-semibold">{LOCALE_LABEL[l]}</span>
            <span className="flex-1 text-muted">{{ pl: "Polski", uk: "Українська", ru: "Русский", en: "English" }[l]}</span>
            {l === locale && <Check className="size-4 text-accent-strong" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/* ------------------------------------------------------------------ notifications */

function NotificationsBell() {
  const { t, time, date } = useI18n();
  const loc = useLocalized();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications() });
  const markAll = useMutation({ mutationFn: () => api.markAllNotificationsRead(), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const unread = list.data?.filter((n) => !n.read).length ?? 0;
  const sameDay = (iso: string) => new Date(iso).toDateString() === NOW.toDateString();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="icon" aria-label={t("notif.open", { n: unread })} className="relative">
          <Bell className="size-[18px]" />
          {unread > 0 && <span className="absolute top-2 right-2.5 size-2 rounded-full bg-critical ring-2 ring-surface" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-divider px-4 py-3">
          <span className="font-bold">{t("notif.title")}</span>
          <button className="text-[13px] font-semibold text-accent-strong hover:underline disabled:text-muted disabled:no-underline" disabled={unread === 0} onClick={() => markAll.mutate()}>
            {t("notif.markAll")}
          </button>
        </div>
        <ul className="max-h-[420px] overflow-y-auto py-1">
          {(list.data ?? []).length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">{t("notif.empty")}</li>}
          {(list.data ?? []).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => n.href && navigate(n.href)}
                className={cn("flex w-full gap-3 px-4 py-2.5 text-left hover:bg-divider", !n.read && "bg-accent-soft/40")}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-accent")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-snug">{loc(n.title)}</span>
                  <span className="block text-[12px] text-muted">{sameDay(n.at) ? time(n.at) : `${date(n.at, { day: "2-digit", month: "2-digit" })} ${time(n.at)}`}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------------ user menu */

function UserMenu() {
  const { t } = useI18n();
  const { user, setRole } = useSession();
  const toast = useToast();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="flex items-center gap-3 rounded-control py-1 pr-2 pl-1 text-left hover:bg-divider" aria-label={t("user.menu")}>
          <Avatar initials={user.initials} size={36} tone="accent" />
          <span className="hidden xl:block">
            <span className="block text-[14px] leading-tight font-semibold">{user.fullName}</span>
            <span className="block text-[12px] text-muted">{t(`role.${user.activeRole}`)}</span>
          </span>
        </button>
      </MenuTrigger>
      <MenuContent className="min-w-64">
        {user.roles.length > 1 && (
          <>
            <MenuLabel>{t("user.switchRole")}</MenuLabel>
            {user.roles.map((r: RoleCode) => (
              <MenuItem key={r} onSelect={() => setRole(r)}>
                <span className="flex-1">{t(`role.${r}`)}</span>
                {r === user.activeRole && <Check className="size-4 text-accent-strong" />}
              </MenuItem>
            ))}
            <MenuSeparator />
          </>
        )}
        <MenuItem onSelect={() => toast.push({ tone: "info", text: t("shell.profileDemo") })}>
          <User className="size-4 text-muted" />
          {t("user.profile")}
        </MenuItem>
        <MenuItem onSelect={() => toast.push({ tone: "info", text: t("shell.profileDemo") })}>{t("user.twofa")}</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => toast.push({ tone: "info", text: t("shell.logoutDemo") })}>{t("user.logout")}</MenuItem>
      </MenuContent>
    </Menu>
  );
}
