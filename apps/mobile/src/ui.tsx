import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text as RNText, TextInput, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { color, font, radius, toneColors, type Tone, type Weight } from "./theme";

/* -------------------------------------------------------------------------- text */

export function Text({ w = 400, size = 15, c = color.ink, style, ...rest }: TextProps & { w?: Weight; size?: number; c?: string }) {
  return <RNText {...rest} style={[{ fontFamily: font[w], fontSize: size, color: c, lineHeight: Math.round(size * 1.3) }, style]} />;
}

/* ------------------------------------------------------------------------ button */

type ButtonKind = "primary" | "secondary" | "ghost" | "danger" | "light";

export function Button({
  label,
  onPress,
  kind = "secondary",
  disabled,
  busy,
  icon,
  style,
  size = "md",
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  size?: "sm" | "md" | "lg";
  testID?: string;
  accessibilityLabel?: string;
}) {
  const palette: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
    primary: { bg: color.accentStrong, fg: "#fff", border: color.accentStrong },
    secondary: { bg: color.surface, fg: color.ink, border: color.input },
    ghost: { bg: "transparent", fg: color.accentStrong, border: "transparent" },
    danger: { bg: color.surface, fg: color.criticalText, border: color.input },
    light: { bg: "#fff", fg: color.ink, border: "#fff" },
  };
  const p = palette[kind];
  const h = size === "sm" ? 38 : size === "lg" ? 56 : 48;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        { minHeight: h, paddingHorizontal: size === "sm" ? 12 : 16, borderRadius: radius.control, backgroundColor: p.bg, borderWidth: 1, borderColor: p.border, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={p.fg} size="small" /> : icon}
      <Text w={700} size={size === "sm" ? 14 : 15} c={p.fg} style={{ textAlign: "center" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({ onPress, children, label, badge, style, testID }: { onPress?: () => void; children: ReactNode; label: string; badge?: number | "dot"; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} style={[{ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, alignItems: "center", justifyContent: "center" }, style]}>
      {children}
      {badge === "dot" ? <View style={{ position: "absolute", top: 9, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: color.critical, borderWidth: 1.5, borderColor: "#fff" }} /> : null}
      {typeof badge === "number" && badge > 0 ? (
        <View style={{ position: "absolute", top: -5, right: -5, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: color.critical, alignItems: "center", justifyContent: "center" }}>
          <Text w={700} size={11} c="#fff">
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------------ blocks */

export function Card({ children, style, bar, accent, onPress, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; bar?: Tone; accent?: boolean; onPress?: () => void; testID?: string }) {
  const body = (
    <View
      testID={testID}
      style={[
        { backgroundColor: color.surface, borderRadius: radius.card, borderWidth: accent ? 1.5 : 1, borderColor: accent ? color.accent : color.border, padding: 16, overflow: "hidden" },
        bar ? { borderLeftWidth: 4, borderLeftColor: toneColors[bar].bar } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  );
}

export function DarkCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: color.dark, borderRadius: 20, padding: 18 }, style]}>{children}</View>;
}

export function Badge({ label, tone = "neutral", style, size = 12 }: { label: string; tone?: Tone; style?: StyleProp<ViewStyle>; size?: number }) {
  const t = toneColors[tone];
  return (
    <View style={[{ alignSelf: "flex-start", backgroundColor: t.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }, style]}>
      <Text w={700} size={size} c={t.fg}>
        {label}
      </Text>
    </View>
  );
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <Row style={{ justifyContent: "space-between", marginTop: 8, marginBottom: 2 }}>
      <Text w={700} size={17}>
        {title}
      </Text>
      {action ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={8}>
          <Text w={700} size={14} c={color.accentStrong}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </Row>
  );
}

export function Screen({ children, refreshing, header }: { children: ReactNode; refreshing?: boolean; header?: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 14 }} keyboardShouldPersistTaps="handled">
        {children}
        {refreshing ? <ActivityIndicator color={color.accentStrong} /> : null}
      </ScrollView>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.bg }}>
      <ActivityIndicator color={color.accentStrong} size="large" />
    </View>
  );
}

export function ErrorBox({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <Card bar="critical" style={{ gap: 10 }}>
      <Text w={600}>{message}</Text>
      {onRetry ? <Button label={retryLabel ?? "↻"} onPress={onRetry} size="sm" style={{ alignSelf: "flex-start" }} /> : null}
    </Card>
  );
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <Card style={{ alignItems: "center", paddingVertical: 28, gap: 6 }}>
      <Text w={700} size={16}>
        {title}
      </Text>
      {text ? (
        <Text c={color.muted} style={{ textAlign: "center" }}>
          {text}
        </Text>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------------- input */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text w={600} size={13} c={color.muted}>
        {label}
      </Text>
      {children}
      {hint ? (
        <Text size={12} c={color.muted}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Input(props: React.ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  const { invalid, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor="#98a2b3"
      {...rest}
      style={[{ minHeight: 48, borderWidth: 1, borderColor: invalid ? color.critical : color.input, borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 10, fontFamily: font[500], fontSize: 16, color: color.ink, backgroundColor: "#fff" }, style as TextStyle]}
    />
  );
}

export function Choice<T extends string>({ options, value, onChange, testID }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; testID?: string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} testID={testID}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: on ? color.dark : color.input, backgroundColor: on ? color.dark : "#fff" }}
          >
            <Text w={600} size={14} c={on ? "#fff" : color.ink}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------------- sheet */

/** Bottom sheet for forms and confirmations. */
export function Sheet({ open, onClose, title, children, label }: { open: boolean; onClose: () => void; title: string; children: ReactNode; label?: string }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(14,21,37,0.45)" }} onPress={onClose} accessibilityLabel={label ?? "close"} />
      <View accessibilityRole={"dialog" as never} aria-label={title} style={{ backgroundColor: color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 14, maxHeight: "88%" }}>
        <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: color.border }} />
        <Text w={800} size={19}>
          {title}
        </Text>
        <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* --------------------------------------------------------------------------- toast */

export function Toast({ text, action, onAction, tone = "dark" }: { text: string; action?: string; onAction?: () => void; tone?: "dark" | "ok" | "critical" }) {
  const bg = tone === "ok" ? color.okText : tone === "critical" ? color.criticalText : color.dark;
  return (
    <View accessibilityRole={"alert" as never} style={{ position: "absolute", left: 16, right: 16, bottom: 92, backgroundColor: bg, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text w={600} c="#fff" style={{ flex: 1 }}>
        {text}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}>
          <Text w={800} c="#ffb38a">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
