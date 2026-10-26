import { ApiError, type StaffRequest, type StaffRequestInput } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Badge, Button, Card, cn, ErrorState, Field, Input, NativeSelect, Skeleton, Textarea, useToast } from "@kadreo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Clock, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, useSession } from "../app/session";
import { useFormat } from "../lib/format";
import { PageHeader } from "../shell/PortalLayout";
import { statusTone, useStatusLabel } from "./RequestsPage";

type Form = Omit<StaffRequestInput, "draft">;
type Field = "siteId" | "positionId" | "headcount" | "from" | "to" | "templateIds" | "contactName";

const empty: Form = { siteId: "", positionId: "", headcount: 1, from: "", to: "", templateIds: [], competenceIds: [], experiencedOnly: false, contactName: "", clientRef: "", comment: "" };

/** «Новая заявка на персонал» (12.1). URLs: /requests/new, draft /requests/:id/edit */
export function NewRequestPage() {
  const { id } = useParams();
  const { t, num, money } = useI18n();
  const { user } = useSession();
  const { positionName, competenceName, fullDate, dayMonth } = useFormat();
  const statusLabel = useStatusLabel();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const sites = useQuery({ queryKey: ["sites"], queryFn: () => api.sites() });
  const draft = useQuery({ queryKey: ["request", id], queryFn: () => api.request(id!), enabled: !!id });
  const recent = useQuery({ queryKey: ["requests"], queryFn: () => api.requests() });
  const [form, setForm] = useState<Form>(empty);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<Field | null>(null);
  const [sent, setSent] = useState<StaffRequest | null>(null);

  // Start from the first site, or from the draft being edited.
  useEffect(() => {
    if (id && draft.data) {
      const r = draft.data.request;
      setForm({ siteId: r.siteId, positionId: r.positionId, headcount: r.headcount, from: r.from, to: r.to, templateIds: r.templateIds, competenceIds: r.competenceIds, experiencedOnly: r.experiencedOnly, contactName: r.contactName, clientRef: r.clientRef ?? "", comment: r.comment ?? "" });
    } else if (!id && sites.data?.length && !form.siteId) setForm((f) => ({ ...f, siteId: sites.data![0]!.id }));
  }, [id, draft.data, sites.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts = useQuery({ queryKey: ["siteOptions", form.siteId], queryFn: () => api.siteOptions(form.siteId), enabled: !!form.siteId });
  const o = opts.data;

  // Defaults once the site's options arrive: position, its first shift, the user as contact, the earliest start.
  useEffect(() => {
    if (!o || o.site.id !== form.siteId) return;
    setForm((f) => {
      const positionId = o.positions.some((p) => p.id === f.positionId) ? f.positionId : (o.positions[0]?.id ?? "");
      const own = o.templates.filter((x) => x.positionId === positionId).map((x) => x.id);
      const templateIds = f.templateIds.filter((x) => own.includes(x));
      return {
        ...f,
        positionId,
        templateIds: templateIds.length || f.positionId === positionId ? templateIds : own.slice(0, 1),
        contactName: f.contactName || o.contacts.find((c) => c.name === user.fullName)?.name || o.contacts[0]?.name || "",
        from: f.from || o.earliestStart,
        to: f.to || o.earliestStart,
      };
    });
  }, [o, form.siteId, user.fullName]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setServerError(null);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const changeSite = (siteId: string) => setForm({ ...empty, siteId, contactName: form.contactName });
  const changePosition = (positionId: string) => setForm((f) => ({ ...f, positionId, templateIds: o?.templates.filter((x) => x.positionId === positionId).slice(0, 1).map((x) => x.id) ?? [] }));

  // «Итог заявки» recalculates 300 ms after the last change (12.1-11).
  const [debounced, setDebounced] = useState(form);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(form), 300);
    return () => clearTimeout(h);
  }, [form]);
  const estimate = useQuery({
    queryKey: ["estimate", debounced],
    queryFn: () => api.estimate({ ...debounced, draft: false }),
    enabled: !!debounced.siteId && !!debounced.positionId,
    placeholderData: (prev) => prev,
  });

  const errors = useMemo(() => {
    const e: Partial<Record<Field, string>> = {};
    if (!form.siteId) e.siteId = t("nr.required");
    if (!form.positionId) e.positionId = t("nr.required");
    if (!Number.isInteger(form.headcount) || form.headcount < 1 || form.headcount > 500) e.headcount = t("nr.required");
    if (o && (!form.from || form.from < o.earliestStart)) e.from = t("nr.err.from", { date: fullDate(o.earliestStart) });
    if (o && (!form.to || form.to < form.from || form.to > o.site.contractTo)) e.to = t("nr.err.to", { date: fullDate(o.site.contractTo) });
    if (!form.templateIds.length) e.templateIds = t("nr.err.shifts");
    if (!form.contactName) e.contactName = t("nr.required");
    if (serverError && !e[serverError]) e[serverError] = serverError === "templateIds" ? t("nr.err.shifts") : t("nr.required");
    return e;
  }, [form, o, t, fullDate, serverError]);

  const save = useMutation({
    mutationFn: (asDraft: boolean) => {
      const input: StaffRequestInput = { ...form, draft: asDraft };
      return id ? api.updateRequest(id, input) : api.createRequest(input);
    },
    onSuccess: (r, asDraft) => {
      void qc.invalidateQueries({ queryKey: ["requests"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["request", r.id] });
      if (asDraft) {
        toast.push({ tone: "ok", text: t("nr.draftSaved") });
        if (!id) navigate(`/requests/${r.id}/edit`, { replace: true });
      } else setSent(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.body.code === "bad_request") setServerError(e.body.message as Field);
      toast.push({ tone: "critical", text: t("common.saveError") });
    },
  });

  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    save.mutate(false);
  };

  if (sites.isError || (id && draft.isError)) return <ErrorState message={t("notFound")} retryLabel={t("common.retry")} onRetry={() => void sites.refetch()} />;
  if (sent) return <Sent r={sent} onAnother={() => { setSent(null); setForm({ ...empty, siteId: form.siteId }); setTried(false); if (id) navigate("/requests/new"); }} />;

  const e = tried ? errors : {};
  const est = estimate.data;
  const positionTemplates = o?.templates.filter((x) => x.positionId === form.positionId) ?? [];

  return (
    <div>
      <PageHeader crumbs={[{ label: t("preq.title"), to: "/requests" }, { label: id ? String(draft.data?.request.number ?? "…") : t("preq.new") }]} title={id ? t("nr.editTitle", { n: draft.data?.request.number ?? "…" }) : t("nr.title")} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card className="p-6">
          {!o ? (
            <div className="flex flex-col gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (
            <form
              className="flex flex-col gap-5"
              onSubmit={(ev) => {
                ev.preventDefault();
                submit();
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t("nr.site")} required htmlFor="nr-site" error={e.siteId}>
                  <NativeSelect id="nr-site" value={form.siteId} onChange={(ev) => changeSite(ev.target.value)}>
                    {sites.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={t("nr.position")} required htmlFor="nr-position" error={e.positionId}>
                  <NativeSelect id="nr-position" value={form.positionId} onChange={(ev) => changePosition(ev.target.value)}>
                    {!form.positionId && <option value="">{t("nr.pick")}</option>}
                    {o.positions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {positionName(p.id)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label={t("nr.headcount")} required htmlFor="nr-headcount" error={e.headcount}>
                  <div className="flex h-12 overflow-hidden rounded-control border border-input">
                    <button type="button" aria-label="−" disabled={form.headcount <= 1} onClick={() => set("headcount", Math.max(1, form.headcount - 1))} className="flex w-11 items-center justify-center bg-bg text-ink hover:bg-divider disabled:opacity-40">
                      <Minus className="size-4" />
                    </button>
                    <input
                      id="nr-headcount"
                      inputMode="numeric"
                      value={form.headcount}
                      onChange={(ev) => set("headcount", Number(ev.target.value.replace(/\D/g, "")) || 0)}
                      className="w-full min-w-0 text-center text-[16px] font-semibold tabular outline-none"
                    />
                    <button type="button" aria-label="+" disabled={form.headcount >= 500} onClick={() => set("headcount", Math.min(500, form.headcount + 1))} className="flex w-11 items-center justify-center bg-bg text-ink hover:bg-divider disabled:opacity-40">
                      <Plus className="size-4" />
                    </button>
                  </div>
                </Field>
                <Field label={t("nr.from")} required htmlFor="nr-from" error={e.from}>
                  <Input id="nr-from" type="date" className="h-12 tabular" min={o.earliestStart} max={o.site.contractTo} value={form.from} onChange={(ev) => set("from", ev.target.value)} />
                </Field>
                <Field label={t("nr.to")} required htmlFor="nr-to" error={e.to}>
                  <Input id="nr-to" type="date" className="h-12 tabular" min={form.from || o.earliestStart} max={o.site.contractTo} value={form.to} onChange={(ev) => set("to", ev.target.value)} />
                </Field>
              </div>
              <fieldset>
                <legend className="mb-2 text-[13px] font-semibold">
                  {t("nr.shifts")} <span className="text-accent-strong">*</span>
                </legend>
                <div className="flex flex-wrap gap-3">
                  {positionTemplates.map((x) => {
                    const on = form.templateIds.includes(x.id);
                    return (
                      <label key={x.id} className={cn("flex h-12 cursor-pointer items-center gap-3 rounded-control border px-4 text-[15px] tabular transition-colors", on ? "border-2 border-accent bg-accent-soft font-semibold text-accent-ink" : "border-input bg-surface hover:bg-bg")}>
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--color-accent-strong)]"
                          checked={on}
                          onChange={() => set("templateIds", on ? form.templateIds.filter((y) => y !== x.id) : [...form.templateIds, x.id])}
                        />
                        {x.start}–{x.end}
                      </label>
                    );
                  })}
                </div>
                {e.templateIds && <p className="mt-1.5 text-[13px] text-critical-text">{e.templateIds}</p>}
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-[13px] font-semibold">{t("nr.requirements")}</legend>
                <div className="flex flex-wrap gap-2">
                  {o.competenceIds.map((c) => (
                    <Pill key={c} on={form.competenceIds.includes(c)} onClick={() => set("competenceIds", form.competenceIds.includes(c) ? form.competenceIds.filter((y) => y !== c) : [...form.competenceIds, c])}>
                      {competenceName(c)}
                    </Pill>
                  ))}
                  <Pill on={form.experiencedOnly} onClick={() => set("experiencedOnly", !form.experiencedOnly)}>
                    {t("nr.experienced")}
                  </Pill>
                </div>
              </fieldset>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t("nr.contact")} required htmlFor="nr-contact" error={e.contactName}>
                  <NativeSelect id="nr-contact" value={form.contactName} onChange={(ev) => set("contactName", ev.target.value)}>
                    {o.contacts.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label={t("nr.clientRef")} htmlFor="nr-ref">
                  <Input id="nr-ref" maxLength={50} placeholder={t("nr.clientRef.ph")} value={form.clientRef} onChange={(ev) => set("clientRef", ev.target.value)} className="h-12" />
                </Field>
              </div>
              <Field label={t("nr.comment")} htmlFor="nr-comment">
                <Textarea id="nr-comment" maxLength={1000} placeholder={t("nr.comment.ph")} value={form.comment} onChange={(ev) => set("comment", ev.target.value)} />
              </Field>
              <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
            </form>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <h2 className="text-[16px] font-bold">{t("nr.summary")}</h2>
            <dl className="mt-4 flex flex-col gap-3 text-[14px]">
              <Line label={t("nr.personShifts")}>
                {est ? (form.templateIds.length > 1 ? t("nr.personShifts.valueShifts", { hc: form.headcount, days: est.days, s: form.templateIds.length, n: est.personShifts }) : t("nr.personShifts.value", { hc: form.headcount, days: est.days, n: est.personShifts })) : "—"}
              </Line>
              <Line label={t("nr.plannedHours")}>{est ? t("nr.hours", { h: num(est.plannedHours, { maximumFractionDigits: 2 }) }) : "—"}</Line>
              {est?.rate && <Line label={t("nr.rate")}>{t("nr.rate.value", { rate: money(est.rate, est.currency) })}</Line>}
            </dl>
            {est?.amount && (
              <div className="mt-5 border-t border-divider pt-5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] text-muted">{t("nr.approx")}</span>
                  <span className="text-[28px] font-extrabold tabular">{money(est.amount, est.currency)}</span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">{t("nr.approx.note")}</p>
              </div>
            )}
            {o && (
              <div className="mt-5 flex items-start gap-2.5 rounded-[12px] bg-accent-soft px-4 py-3 text-[13px] font-semibold text-accent-ink">
                <Clock className="mt-0.5 size-4 shrink-0" />
                {t("nr.sla", { h: o.slaResponseHours })}
              </div>
            )}
            <Button variant="primary" className="mt-5 h-12 w-full text-[16px]" loading={save.isPending && save.variables === false} disabled={!o} onClick={submit}>
              {t("nr.submit")}
            </Button>
            <Button className="mt-3 h-12 w-full" loading={save.isPending && save.variables === true} disabled={!o || !form.positionId} onClick={() => save.mutate(true)}>
              {t("nr.saveDraft")}
            </Button>
          </Card>
          <Card className="p-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[16px] font-bold">{t("nr.recent")}</h2>
              <Link to="/requests" className="text-[14px] font-semibold text-accent-strong hover:underline">
                {t("nr.all")}
              </Link>
            </div>
            <ul className="flex flex-col gap-2.5 text-[14px]">
              {(recent.data ?? []).filter((r) => r.status !== "draft").slice(0, 3).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <Link to={`/requests/${r.id}`} className="truncate hover:underline">
                    {t("nr.recent.line", { n: r.number, hc: r.headcount, position: positionName(r.positionId).toLowerCase(), date: dayMonth(r.from) })}
                  </Link>
                  <Badge tone={statusTone[r.status]} className="shrink-0">
                    {statusLabel(r)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular">{children}</dd>
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("flex h-10 items-center gap-1.5 rounded-full border px-4 text-[14px] transition-colors", on ? "border-ink bg-ink font-semibold text-white" : "border-input bg-surface hover:bg-bg")}
    >
      {children}
      {on && <Check className="size-4" />}
    </button>
  );
}

function Sent({ r, onAnother }: { r: StaffRequest; onAnother: () => void }) {
  const { t } = useI18n();
  const { dateTime } = useFormat();
  const navigate = useNavigate();
  return (
    <Card className="mx-auto mt-10 flex max-w-xl flex-col items-center gap-4 px-8 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-ok-bg">
        <CheckCircle2 className="size-7 text-ok" />
      </span>
      <h1 className="text-[24px] font-extrabold">{t("nr.sent.title", { n: r.number })}</h1>
      <p className="text-[15px] text-muted">{t("nr.sent.text", { date: dateTime(r.slaDueAt) })}</p>
      <div className="mt-2 flex gap-3">
        <Button variant="primary" onClick={() => navigate(`/requests/${r.id}`)}>
          {t("nr.sent.open")}
        </Button>
        <Button onClick={onAnother}>{t("nr.sent.another")}</Button>
      </div>
    </Card>
  );
}
