import { DEMO_TODAY, type UrgentRequestResult } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, NativeSelect, ProgressBar, Textarea, useToast } from "@kadreo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../app/session";
import { useFormat } from "../../lib/format";

/** «Срочная замена» (11.1-06): first N workers who accept are assigned. */
export function UrgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const { positionName } = useFormat();
  const toast = useToast();
  const sites = useQuery({ queryKey: ["sitesWithTemplates"], queryFn: () => api.sitesWithTemplates(), enabled: open });
  const [siteId, setSiteId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [date, setDate] = useState(DEMO_TODAY);
  const [count, setCount] = useState(1);
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<UrgentRequestResult | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setTouched(false);
    }
  }, [open]);

  const templates = useMemo(() => sites.data?.find((s) => s.site.id === siteId)?.templates ?? [], [sites.data, siteId]);
  const create = useMutation({
    mutationFn: () => api.createUrgentRequest({ siteId, templateId, date, headcount: count, comment }),
    onSuccess: (r) => setResult(r),
    onError: () => toast.push({ tone: "critical", text: t("common.saveError") }),
  });
  const status = useQuery({
    queryKey: ["urgent", result?.id],
    queryFn: () => api.urgentRequestStatus(result!.id),
    enabled: !!result && open,
    refetchInterval: (q) => (q.state.data && q.state.data.accepted >= q.state.data.needed ? false : 1000),
  });
  const live = status.data ?? result;

  const submit = () => {
    setTouched(true);
    if (!siteId || !templateId || count < 1) return;
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("urgent.title")} closeLabel={t("common.close")} width={540}>
        {!live ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label={t("urgent.site")} required htmlFor="u-site" error={touched && !siteId ? t("urgent.required") : undefined}>
              <NativeSelect
                id="u-site"
                value={siteId}
                aria-invalid={touched && !siteId}
                onChange={(e) => {
                  setSiteId(e.target.value);
                  setTemplateId("");
                }}
              >
                <option value="">{t("urgent.pick")}</option>
                {sites.data?.map((s) => (
                  <option key={s.site.id} value={s.site.id}>
                    {s.site.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-[1fr_160px] gap-3">
              <Field label={t("urgent.shift")} required htmlFor="u-shift" error={touched && !templateId ? t("urgent.required") : undefined}>
                <NativeSelect id="u-shift" value={templateId} disabled={!siteId} aria-invalid={touched && !templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">{t("urgent.pick")}</option>
                  {templates.map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {positionName(tp.positionId)} · {tp.start}–{tp.end}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("urgent.date")} required htmlFor="u-date">
                <Input id="u-date" type="date" min={DEMO_TODAY} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <Field label={t("urgent.count")} required htmlFor="u-count">
              <Input id="u-count" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} className="w-32" />
            </Field>
            <Field label={t("urgent.comment")} htmlFor="u-comment">
              <Textarea id="u-comment" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <p className="rounded-control bg-bg px-3 py-2.5 text-[13px] text-muted">{t("urgent.note", { n: count })}</p>
            <DialogFooter className="mt-2">
              <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary" loading={create.isPending}>
                {t("urgent.send")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {live.accepted >= live.needed ? <CheckCircle2 className="size-6 text-ok" /> : <Loader2 className="size-6 animate-spin text-accent-strong" />}
              <p className="text-[15px] font-semibold">{live.accepted >= live.needed ? t("urgent.done") : t("urgent.progress", { offered: live.offeredTo, accepted: live.accepted, needed: live.needed })}</p>
            </div>
            <ProgressBar value={live.accepted / live.needed} tone={live.accepted >= live.needed ? "ok" : "accent"} />
            <DialogFooter>
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
