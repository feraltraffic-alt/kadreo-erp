import type { StaffRequest, StaffRequestStatus } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, Tag, type Tone } from "@kadreo/ui";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileEdit, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { api, useSession } from "../app/session";
import { useFormat } from "../lib/format";
import { PageHeader } from "../shell/PortalLayout";

export const statusTone: Record<StaffRequestStatus, Tone> = { draft: "neutral", new: "accent", in_progress: "warn", staffed: "ok", done: "neutral", cancelled: "neutral" };

export function useStatusLabel() {
  const { t } = useI18n();
  return (r: Pick<StaffRequest, "status" | "assigned" | "headcount">) => t(`preq.status.${r.status}`, { x: r.assigned, n: r.headcount });
}

/** The client's requests (section «Заявки»). URL: /requests */
export function RequestsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const { positionName, dayMonth, fullDate } = useFormat();
  const statusLabel = useStatusLabel();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["requests"], queryFn: () => api.requests() });
  const sites = useQuery({ queryKey: ["sites"], queryFn: () => api.sites() });
  const siteName = (id: string) => sites.data?.find((s) => s.id === id)?.name ?? "…";

  return (
    <div>
      <PageHeader
        title={t("preq.title")}
        actions={
          can("staffrequest.create") ? (
            <Button variant="primary" onClick={() => navigate("/requests/new")}>
              {t("preq.new")}
            </Button>
          ) : undefined
        }
      />
      <Card className="overflow-x-auto px-2 py-2">
        {q.isError ? (
          <ErrorState message={t("common.loadError")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col gap-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : q.data.length === 0 ? (
          <EmptyState title={t("preq.empty")} className="py-14" />
        ) : (
          <table className="w-full min-w-[820px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold tracking-wide text-muted uppercase">
                {["number", "site", "position", "people", "period", "status"].map((c) => (
                  <th key={c} className="border-b border-border px-3 py-3">
                    {t(`preq.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => {
                const open = () => navigate(r.status === "draft" ? `/requests/${r.id}/edit` : `/requests/${r.id}`);
                return (
                  <tr key={r.id} onClick={open} className="cursor-pointer border-b border-divider last:border-0 hover:bg-bg">
                    <td className="px-3 py-3.5 font-bold tabular">
                      <button type="button" className="hover:underline" onClick={open}>
                        {r.number}
                      </button>
                    </td>
                    <td className="px-3 py-3.5 font-semibold">{siteName(r.siteId)}</td>
                    <td className="px-3 py-3.5">{positionName(r.positionId)}</td>
                    <td className="px-3 py-3.5 tabular">{t("preq.people", { x: r.assigned, n: r.headcount })}</td>
                    <td className="px-3 py-3.5 whitespace-nowrap tabular">{r.from === r.to ? fullDate(r.from) : `${dayMonth(r.from)} – ${fullDate(r.to)}`}</td>
                    <td className="px-3 py-3.5">
                      <Badge tone={statusTone[r.status]}>{statusLabel(r)}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** One request as the client sees it. URL: /requests/:id */
export function RequestPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const { positionName, competenceName, weekdayShort, dayMonth, fullDate, dateTime } = useFormat();
  const statusLabel = useStatusLabel();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["request", id], queryFn: () => api.request(id) });

  if (q.isError) return <ErrorState message={t("notFound")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const r = d?.request;
  const shift = (tid: string) => {
    const x = d?.templates.find((tt) => tt.id === tid);
    return x ? `${x.start}–${x.end}` : "—";
  };

  let plate: { tone: string; icon: ReactNode; text: string } | null = null;
  if (r?.status === "draft") plate = { tone: "bg-neutral-bg text-neutral-text", icon: <FileEdit className="size-4" />, text: t("preq.plate.draft") };
  else if (r?.status === "new") plate = { tone: "bg-accent-soft text-accent-ink", icon: <Clock className="size-4" />, text: t("preq.plate.new", { date: dateTime(r.createdAt), due: dateTime(r.slaDueAt) }) };
  else if (r?.status === "cancelled") plate = { tone: "bg-neutral-bg text-neutral-text", icon: <XCircle className="size-4" />, text: t("preq.plate.cancelled", { date: r.cancelledAt ? dateTime(r.cancelledAt) : "—", reason: r.cancelReason ?? "—" }) };
  else if (r?.acceptedAt) plate = { tone: "bg-ok-bg text-ok-text", icon: <CheckCircle2 className="size-4" />, text: t("preq.plate.accepted", { date: dateTime(r.acceptedAt), name: r.acceptedByName ?? "—" }) };

  return (
    <div>
      <PageHeader
        crumbs={[{ label: t("preq.title"), to: "/requests" }, { label: r ? String(r.number) : "…" }]}
        title={r ? t("preq.card.title", { n: r.number }) : "…"}
        meta={r ? <Badge tone={statusTone[r.status]}>{statusLabel(r)}</Badge> : undefined}
        actions={
          r?.status === "draft" ? (
            <Button variant="primary" onClick={() => navigate(`/requests/${r.id}/edit`)}>
              {t("preq.continue")}
            </Button>
          ) : undefined
        }
      />
      {!d || !r ? (
        <Skeleton className="h-80 rounded-card" />
      ) : (
        <>
          {plate && (
            <div role="status" className={`mb-6 flex items-center gap-2.5 rounded-[12px] px-4 py-3 text-[14px] font-medium ${plate.tone}`}>
              {plate.icon}
              {plate.text}
            </div>
          )}
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card className="p-6">
              <h2 className="mb-4 text-[16px] font-bold">{t("preq.ordered")}</h2>
              <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-3.5 text-[14px]">
                <Row label={t("preq.f.site")}>
                  <div className="font-semibold">{d.site.name}</div>
                  <div className="text-[13px] text-muted">{d.site.address}</div>
                </Row>
                <Row label={t("preq.f.position")}>{positionName(r.positionId)}</Row>
                <Row label={t("preq.f.headcount")}>{t("preq.f.headcount.value", { n: r.headcount })}</Row>
                <Row label={t("preq.f.period")}>
                  <span className="tabular">{r.from === r.to ? fullDate(r.from) : `${dayMonth(r.from)} – ${fullDate(r.to)}`}</span>
                </Row>
                <Row label={t("preq.f.shifts")}>
                  <div className="flex flex-wrap gap-1.5">
                    {r.templateIds.map((tid) => (
                      <Tag key={tid}>
                        <span className="tabular">{shift(tid)}</span>
                      </Tag>
                    ))}
                  </div>
                </Row>
                <Row label={t("preq.f.requirements")}>
                  {r.competenceIds.length || r.experiencedOnly ? (
                    <div className="flex flex-wrap gap-1.5">
                      {r.competenceIds.map((c) => (
                        <Tag key={c} tone="accent">
                          {competenceName(c)}
                        </Tag>
                      ))}
                      {r.experiencedOnly && <Tag tone="accent">{t("nr.experienced")}</Tag>}
                    </div>
                  ) : (
                    <span className="text-muted">{t("preq.f.none")}</span>
                  )}
                </Row>
                <Row label={t("preq.f.contact")}>{r.contactName || "—"}</Row>
                {r.clientRef && <Row label={t("preq.f.ref")}>{r.clientRef}</Row>}
                {r.comment && <Row label={t("preq.f.comment")}>{r.comment}</Row>}
              </dl>
            </Card>
            <Card className="p-6">
              <h2 className="mb-4 text-[16px] font-bold">{t("preq.staffing")}</h2>
              {d.cells.length === 0 ? (
                <p className="rounded-[12px] bg-bg px-4 py-3.5 text-[14px] text-muted">{t("preq.staffing.before")}</p>
              ) : (
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] font-semibold text-muted">
                      <th className="border-b border-divider py-2 pr-3">{t("preq.col.day")}</th>
                      <th className="border-b border-divider px-3 py-2">{t("preq.col.shift")}</th>
                      <th className="border-b border-divider px-3 py-2">{t("preq.col.filled")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.cells.map((c) => (
                      <tr key={`${c.templateId}|${c.date}`} className="border-b border-divider last:border-0">
                        <td className="py-2.5 pr-3 tabular">
                          {weekdayShort(c.date)} {dayMonth(c.date)}
                        </td>
                        <td className="px-3 py-2.5 text-muted tabular">{shift(c.templateId)}</td>
                        <td className={`px-3 py-2.5 font-semibold tabular ${c.assigned >= c.needed ? "text-ok-text" : ""}`}>
                          {c.assigned} / {c.needed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
