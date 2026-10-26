import { Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold, Onest_800ExtraBold, useFonts } from "@expo-google-fonts/onest";
import { I18nProvider } from "@kadreo/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { catalogs } from "./src/i18n";
import { SessionProvider, useSession } from "./src/session";
import { Shell } from "./src/Shell";
import { color } from "./src/theme";

function Localized() {
  const { locale } = useSession();
  return (
    <I18nProvider locale={locale} catalogs={catalogs} productName="Kadreo">
      <Shell />
    </I18nProvider>
  );
}

export default function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 0, refetchOnWindowFocus: true } } }));
  const [fontsLoaded, fontError] = useFonts({ Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold, Onest_800ExtraBold });
  // Without the fonts the app still works with the system font.
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: color.bg }} />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <Localized />
        </SessionProvider>
      </QueryClientProvider>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
