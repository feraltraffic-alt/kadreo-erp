import { MOBILE_DEMO_USERS, type MobileDemoUserKey } from "@kadreo/domain";
import { useI18n } from "@kadreo/i18n";
import { BarChart3, CalendarDays, CheckSquare, Clock3, FileText, Gift, LayoutGrid, MapPin, MessageSquare, UserRound, Users } from "lucide-react-native";
import { useState, type ComponentType } from "react";
import { Platform, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrigadeScreen, OutputHistoryScreen } from "./screens/leader/BrigadeScreen";
import { DecisionsScreen, SitesScreen, SummaryScreen, useDecisionsCount } from "./screens/manager/ManagerScreens";
import { KioskScreen } from "./screens/kiosk/KioskScreen";
import { ClockScreen } from "./screens/worker/ClockScreen";
import { BonusesScreen, DocumentsScreen, ProfileScreen, ScheduleScreen } from "./screens/worker/WorkerTabs";
import { useSession } from "./session";
import { color } from "./theme";
import { Button, Card, Empty, Loading, Screen, Text } from "./ui";

type IconT = ComponentType<{ size?: number; color?: string }>;
interface Tab {
  key: string;
  label: string;
  icon: IconT;
  badge?: number;
}

/** The app's tabs depend on the role (14.1-15, 14.2-12, 14.3-10); the kiosk has no tabs. */
export function Shell() {
  const { user, me } = useSession();
  if (user === "kiosk") return me ? <KioskScreen /> : <Loading />;
  return <PhoneFrame>{!user ? <SignIn /> : !me ? <Loading /> : user === "manager" ? <ManagerShell /> : user === "leader" ? <LeaderShell /> : <WorkerShell />}</PhoneFrame>;
}

/** On a wide browser window (the web demo) the phone app is shown at phone size. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  if (Platform.OS !== "web" || width < 640) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: "#dfe3ea", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <View style={{ width: 400, height: Math.min(860, height - 32), borderRadius: 36, overflow: "hidden", borderWidth: 8, borderColor: color.dark, backgroundColor: color.bg }}>{children}</View>
    </View>
  );
}

function TabBar({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (k: string) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: color.border, backgroundColor: "#fff", paddingBottom: Math.max(insets.bottom, 8), paddingTop: 8 }}>
      {tabs.map((tb) => {
        const on = tb.key === active;
        const Icon = tb.icon;
        return (
          <Pressable key={tb.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={tb.label} onPress={() => onChange(tb.key)} style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 4 }}>
            <View>
              <Icon size={24} color={on ? color.accentStrong : color.muted} />
              {tb.badge ? (
                <View style={{ position: "absolute", top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.critical, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                  <Text w={700} size={10} c="#fff">
                    {tb.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text w={on ? 700 : 500} size={12} c={on ? color.accentStrong : color.muted}>
              {tb.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Frame({ children, tabs, active, onChange }: { children: React.ReactNode; tabs: Tab[]; active: string; onChange: (k: string) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg, paddingTop: insets.top }}>
      <View style={{ flex: 1 }}>{children}</View>
      <TabBar tabs={tabs} active={active} onChange={onChange} />
    </View>
  );
}

function WorkerShell() {
  const { t } = useI18n();
  const [tab, setTab] = useState("clock");
  const tabs: Tab[] = [
    { key: "schedule", label: t("tab.schedule"), icon: CalendarDays },
    { key: "clock", label: t("tab.clock"), icon: Clock3 },
    { key: "bonuses", label: t("tab.bonuses"), icon: Gift },
    { key: "documents", label: t("tab.documents"), icon: FileText },
    { key: "profile", label: t("tab.profile"), icon: UserRound },
  ];
  return (
    <Frame tabs={tabs} active={tab} onChange={setTab}>
      {tab === "clock" ? <ClockScreen onOpenSchedule={() => setTab("schedule")} /> : null}
      {tab === "schedule" ? <ScheduleScreen /> : null}
      {tab === "bonuses" ? <BonusesScreen /> : null}
      {tab === "documents" ? <DocumentsScreen /> : null}
      {tab === "profile" ? <ProfileScreen /> : null}
    </Frame>
  );
}

function LeaderShell() {
  const { t } = useI18n();
  const [tab, setTab] = useState("brigade");
  const tabs: Tab[] = [
    { key: "brigade", label: t("tab.brigade"), icon: Users },
    { key: "clock", label: t("tab.clock"), icon: Clock3 },
    { key: "output", label: t("tab.output"), icon: BarChart3 },
    { key: "chat", label: t("tab.chat"), icon: MessageSquare },
    { key: "profile", label: t("tab.profile"), icon: UserRound },
  ];
  return (
    <Frame tabs={tabs} active={tab} onChange={setTab}>
      {tab === "brigade" ? <BrigadeScreen /> : null}
      {tab === "clock" ? <ClockScreen onOpenSchedule={() => setTab("profile")} /> : null}
      {tab === "output" ? <OutputHistoryScreen /> : null}
      {tab === "chat" ? <ChatScreen /> : null}
      {tab === "profile" ? <ProfileScreen /> : null}
    </Frame>
  );
}

function ManagerShell() {
  const { t } = useI18n();
  const [tab, setTab] = useState("summary");
  const [site, setSite] = useState<string | null>(null);
  const decisions = useDecisionsCount();
  const tabs: Tab[] = [
    { key: "summary", label: t("tab.summary"), icon: LayoutGrid },
    { key: "sites", label: t("tab.sites"), icon: MapPin },
    { key: "decisions", label: t("tab.decisions"), icon: CheckSquare, badge: decisions },
    { key: "chat", label: t("tab.chat"), icon: MessageSquare },
    { key: "profile", label: t("tab.profile"), icon: UserRound },
  ];
  const change = (k: string) => {
    setSite(null);
    setTab(k);
  };
  return (
    <Frame tabs={tabs} active={tab} onChange={change}>
      {tab === "summary" && site ? <BrigadeScreen siteId={site} onBack={() => setSite(null)} /> : null}
      {tab === "summary" && !site ? <SummaryScreen onOpenSites={() => change("sites")} onOpenDecisions={() => change("decisions")} onOpenSite={setSite} /> : null}
      {tab === "sites" ? <SitesScreen /> : null}
      {tab === "decisions" ? <DecisionsScreen /> : null}
      {tab === "chat" ? <ChatScreen /> : null}
      {tab === "profile" ? <ProfileScreen worker={false} /> : null}
    </Frame>
  );
}

function ChatScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <Text w={800} size={25} accessibilityRole="header">
        {t("tab.chat")}
      </Text>
      <Empty title={t("chat.soon")} text={t("chat.soon_text")} />
    </Screen>
  );
}

/** Demo sign-in: pick a persona (production: phone number and SMS code through Keycloak). */
function SignIn() {
  const { t } = useI18n();
  const { signIn } = useSession();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg, paddingTop: insets.top }}>
      <Screen>
        <View style={{ gap: 6, marginTop: 24, marginBottom: 8 }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: color.accentStrong, alignItems: "center", justifyContent: "center" }}>
            <Text w={800} size={26} c="#fff">
              K
            </Text>
          </View>
          <Text w={800} size={28} accessibilityRole="header">
            {t("signin.title")}
          </Text>
          <Text c={color.muted}>{t("signin.text")}</Text>
        </View>
        {MOBILE_DEMO_USERS.map((u) => (
          <Card key={u.key} style={{ gap: 10 }}>
            <Text w={700} size={17}>
              {u.name}
            </Text>
            <Text c={color.muted}>{t(`signin.role.${u.key}`)}</Text>
            <Button kind="primary" label={t("signin.as", { name: u.key === "kiosk" ? t("signin.kiosk") : u.name.split(" ")[0]! })} onPress={() => signIn(u.key as MobileDemoUserKey)} />
          </Card>
        ))}
      </Screen>
    </View>
  );
}
