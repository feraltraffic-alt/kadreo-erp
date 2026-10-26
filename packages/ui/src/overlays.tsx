import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AlertTriangle, Check, CheckCircle2, Info, RotateCw, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Button, cn } from "./primitives";

/* --------------------------------------------------------------------------- Dialog */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className, closeLabel, width = 520 }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; closeLabel: string; width?: number }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[1px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={cn("fixed top-1/2 left-1/2 z-50 max-h-[88vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-surface p-6 shadow-pop focus:outline-none", className)}
        style={{ maxWidth: width }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-[19px] font-bold">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-1 text-[14px] text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label={closeLabel}>
              <X className="size-4" />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-6 flex flex-wrap items-center justify-end gap-2", className)}>{children}</div>;
}

/* --------------------------------------------------------------------- Dropdown menu */

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;

export function MenuContent({ className, align = "end", ...rest }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={6} className={cn("z-50 min-w-48 rounded-control border border-border bg-surface p-1 shadow-pop", className)} {...rest} />
    </DropdownPrimitive.Portal>
  );
}

export function MenuItem({ className, tone, ...rest }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { tone?: "critical" }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-[14px] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-divider",
        tone === "critical" && "text-critical-text",
        className,
      )}
      {...rest}
    />
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownPrimitive.Label className="px-2.5 pt-2 pb-1 text-[12px] font-semibold text-muted uppercase">{children}</DropdownPrimitive.Label>;
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-divider" />;
}

export const MenuCheckboxItem = function MenuCheckboxItem({ className, children, ...rest }: ComponentPropsWithoutRef<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem
      className={cn("flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-[14px] outline-none select-none data-[highlighted]:bg-divider", className)}
      {...rest}
    >
      <span className="flex size-4 items-center justify-center rounded border border-input data-[state=checked]:border-accent-strong">
        <DropdownPrimitive.ItemIndicator>
          <Check className="size-3 text-accent-strong" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
};

/* -------------------------------------------------------------------------- Popover */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({ className, align = "start", ...rest }: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={6} className={cn("z-50 rounded-control border border-border bg-surface p-3 shadow-pop focus:outline-none", className)} {...rest} />
    </PopoverPrimitive.Portal>
  );
}

/* -------------------------------------------------------------------------- Tooltip */

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-50 max-w-72 rounded-[8px] bg-ink px-2.5 py-1.5 text-[12px] leading-snug font-medium text-white shadow-pop">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ Checkbox, Switch */

export function Checkbox({ className, ...rest }: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-input bg-surface data-[state=checked]:border-accent-strong data-[state=checked]:bg-accent-strong", className)}
      {...rest}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3.5 text-white" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ className, ...rest }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn("relative h-6 w-10 shrink-0 rounded-full bg-input transition-colors data-[state=checked]:bg-accent-strong", className)} {...rest}>
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

/* ----------------------------------------------------------------- Screen states 8.5 */

export function EmptyState({ title, action, icon, className }: { title: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      {icon && <div className="text-muted">{icon}</div>}
      <p className="max-w-80 text-[14px] text-muted">{title}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, retryLabel, onRetry, className }: { message: ReactNode; retryLabel: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-3 rounded-control bg-critical-bg/50 px-6 py-8 text-center", className)}>
      <AlertTriangle className="size-6 text-critical" aria-hidden />
      <p className="max-w-96 text-[14px] text-critical-text">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} icon={<RotateCw className="size-3.5" />}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------- Toast */

type ToastItem = { id: number; tone: "ok" | "critical" | "info"; text: ReactNode; action?: { label: string; onClick: () => void } };
const ToastCtx = createContext<{ push: (t: Omit<ToastItem, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-6 bottom-6 z-[60] flex w-96 max-w-[calc(100vw-32px)] flex-col gap-2">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onClose={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const Icon = item.tone === "ok" ? CheckCircle2 : item.tone === "critical" ? AlertTriangle : Info;
  return (
    <div className={cn("pointer-events-auto flex items-start gap-3 rounded-control bg-ink px-4 py-3 text-[14px] text-white shadow-pop transition-all duration-200", shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0")}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", item.tone === "ok" ? "text-ok" : item.tone === "critical" ? "text-critical" : "text-white/70")} />
      <div className="flex-1">{item.text}</div>
      {item.action && (
        <button
          className="font-semibold text-accent underline-offset-2 hover:underline"
          onClick={() => {
            item.action!.onClick();
            onClose();
          }}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}
