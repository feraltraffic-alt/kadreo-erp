import { ApiError, type ConstraintViolation } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { useCallback } from "react";
import { useFormat } from "../../lib/format";

/** Human text for a failed hard constraint (9.1): names the exact rule, e.g. «Медосмотр истекает 27.10, смена 28.10». */
export function useViolationText() {
  const { t } = useI18n();
  const { competenceName, dayMonth } = useFormat();
  const one = useCallback(
    (v: ConstraintViolation, shiftDate: string) => {
      switch (v.code) {
        case "missing_competence":
          return t("violation.missing_competence", { name: competenceName(v.competenceId) });
        case "document_invalid":
          return v.validTo
            ? t("violation.document_invalid", { doc: t(`doc.${v.docType}`), date: dayMonth(v.validTo), shiftDate: dayMonth(shiftDate) })
            : t("violation.document_missing", { doc: t(`doc.${v.docType}`) });
        case "overlap":
          return t("violation.overlap", { shift: v.shift, date: dayMonth(v.date) });
        case "rest_period":
          return t("violation.rest_period", { hours: v.hours });
        case "weekly_limit":
          return t("violation.weekly_limit", { hours: v.hours, limit: v.limit });
        case "unavailable":
          return t("violation.unavailable", { status: t(`wstatus.${v.status}`) });
      }
    },
    [t, competenceName, dayMonth],
  );
  return useCallback(
    (err: unknown, shiftDate: string): string => {
      if (err instanceof ApiError && err.body.code === "constraint") return err.body.violations.map((v) => one(v, shiftDate)).join(" · ");
      if (err instanceof ApiError && err.body.code === "forbidden") return t("forbidden.text", { permission: err.body.permission });
      return t("common.saveError");
    },
    [one, t],
  );
}
