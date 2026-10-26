import { clsx, type ClassValue } from "clsx";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* -------------------------------------------------------------------------- Button */

export type ButtonVariant = "primary" | "secondary" | "accent-outline" | "ghost" | "danger-link" | "dark";
export type ButtonSize = "md" | "sm" | "xs" | "icon" | "icon-sm";

const variantClass: Record<ButtonVariant, string> = {
  // Q-04: white text on #C2410C passes WCAG AA for 14–15 px labels.
  primary: "bg-accent-strong text-white hover:bg-accent-ink disabled:bg-accent-strong/45",
  secondary: "bg-surface text-ink border border-input hover:bg-divider disabled:text-muted",
  "accent-outline": "bg-surface text-accent-strong border-2 border-accent hover:bg-accent-soft disabled:opacity-50",
  ghost: "bg-transparent text-ink hover:bg-divider disabled:text-muted",
  "danger-link": "bg-transparent text-critical-text hover:underline px-0 disabled:opacity-50",
  dark: "bg-ink text-white hover:bg-ink/85 disabled:opacity-50",
};
const sizeClass: Record<ButtonSize, string> = {
  md: "h-10 px-4 text-[14px] gap-2",
  sm: "h-9 px-3 text-[13px] gap-1.5",
  xs: "h-8 px-2.5 text-[13px] gap-1.5",
  icon: "h-10 w-10",
  "icon-sm": "h-8 w-8",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control font-semibold whitespace-nowrap transition-colors",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* --------------------------------------------------------------------------- Badge */

export type Tone = "ok" | "warn" | "critical" | "neutral" | "accent" | "dark";

const toneClass: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-text",
  warn: "bg-warn-bg text-warn-text",
  critical: "bg-critical-bg text-critical-text",
  neutral: "bg-neutral-bg text-neutral-text",
  accent: "bg-accent-soft text-accent-ink",
  dark: "bg-ink text-white",
};
const dotClass: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  critical: "bg-critical",
  neutral: "bg-muted",
  accent: "bg-accent",
  dark: "bg-white",
};

export function Badge({ tone = "neutral", dot, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap", toneClass[tone], className)} {...rest}>
      {dot && <span className={cn("size-1.5 rounded-full", dotClass[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/** Small rectangular tag used for candidate reasons, competences, clock methods. */
export function Tag({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-medium whitespace-nowrap", toneClass[tone], className)}>{children}</span>;
}

export function StatusDot({ tone }: { tone: Tone }) {
  return <span className={cn("inline-block size-2 rounded-full", dotClass[tone])} aria-hidden />;
}

/* ----------------------------------------------------------------------------- Card */

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border bg-surface shadow-card", className)} {...rest} />;
}

export function CardHeader({ title, actions, className }: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-5 pt-5 pb-3", className)}>
      <h2 className="text-[17px] font-bold">{title}</h2>
      {actions}
    </div>
  );
}

/* --------------------------------------------------------------------------- Inputs */

const fieldBase =
  "w-full rounded-control border border-input bg-surface px-3 text-[14px] text-ink placeholder:text-muted/80 transition-colors focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-divider disabled:text-muted aria-[invalid=true]:border-critical";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2.5 leading-snug", className)} {...rest} />;
});

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function NativeSelect({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-10 pr-8 font-medium", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, required, error, hint, htmlFor, children, className }: { label: ReactNode; required?: boolean; error?: string | undefined; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] font-medium text-critical-text" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ Segmented */

export function Segmented<T extends string>({ value, options, onChange, className, size = "md", ariaLabel }: { value: T; options: { value: T; label: ReactNode; disabled?: boolean }[]; onChange: (v: T) => void; className?: string; size?: "md" | "sm"; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-control bg-divider p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[8px] font-semibold transition-colors",
            size === "md" ? "h-8 px-3.5 text-[13px]" : "h-7 px-2.5 text-[12px]",
            value === o.value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Progress, skeleton */

export function ProgressBar({ value, tone = "accent", className, label }: { value: number; tone?: "accent" | "ok" | "warn" | "critical" | "white"; className?: string; label?: string }) {
  const colors = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", critical: "bg-critical", white: "bg-white" };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-black/8", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width]", colors[tone])} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-shimmer rounded-md bg-[linear-gradient(90deg,#eef0f3_25%,#f7f8fa_37%,#eef0f3_63%)] bg-[length:400%_100%]", className)} />;
}

export function Avatar({ initials, size = 36, tone = "neutral", className }: { initials: string; size?: number; tone?: "neutral" | "accent"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", tone === "accent" ? "bg-accent-soft text-accent-ink" : "bg-divider text-ink", className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

export function initialsOf(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted">{children}</kbd>;
}
