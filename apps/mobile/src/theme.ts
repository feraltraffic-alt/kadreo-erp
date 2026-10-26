/** Design tokens of spec 8.1–8.3, same values as the web (packages/ui/src/styles.css). */
export const color = {
  accent: "#ff5b14",
  accentStrong: "#c2410c", // buttons with white text (Q-04)
  accentSoft: "#ffede3",
  accentRing: "#fbd5c4",
  accentInk: "#9a3412",
  bg: "#f4f5f8",
  surface: "#ffffff",
  border: "#e4e7ec",
  divider: "#f0f2f5",
  input: "#d0d5dd",
  ink: "#0e1525",
  muted: "#5b6474",
  dark: "#0e1525",
  darkCard: "#151d2e",
  darkMuted: "#aab1bf",
  darkBorder: "#283247",
  ok: "#12b76a",
  okBg: "#e7f8ef",
  okText: "#067647",
  warn: "#eaaa08",
  warnBg: "#fef7c3",
  warnText: "#854a0e",
  critical: "#e5484d",
  criticalBg: "#fdecec",
  criticalText: "#c01f2a",
  neutralBg: "#f0f2f5",
  neutralText: "#344054",
};

export const radius = { card: 16, control: 10, pill: 999 };

export const font = {
  400: "Onest_400Regular",
  500: "Onest_500Medium",
  600: "Onest_600SemiBold",
  700: "Onest_700Bold",
  800: "Onest_800ExtraBold",
} as const;

export type Weight = keyof typeof font;
export type Tone = "ok" | "warn" | "critical" | "neutral" | "accent";

export const toneColors: Record<Tone, { bg: string; fg: string; bar: string }> = {
  ok: { bg: color.okBg, fg: color.okText, bar: color.ok },
  warn: { bg: color.warnBg, fg: color.warnText, bar: color.warn },
  critical: { bg: color.criticalBg, fg: color.criticalText, bar: color.critical },
  neutral: { bg: color.neutralBg, fg: color.neutralText, bar: color.input },
  accent: { bg: color.accentSoft, fg: color.accentInk, bar: color.accent },
};
