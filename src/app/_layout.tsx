import { Stack } from 'expo-router/stack';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../components/ui';
import { CloudProvider } from '../lib/cloud-context';
import { migrate } from '../lib/db';
import { SettingsProvider } from '../lib/settings-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="noveltyos.db" onInit={migrate}>
        <SettingsProvider>
          <CloudProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.primary },
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: colors.bg },
              headerBackButtonDisplayMode: 'minimal',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="receive" options={{ title: 'Receive Stock' }} />
            <Stack.Screen name="settings" options={{ title: 'Business Settings' }} />
            <Stack.Screen name="account" options={{ title: 'Cloud Backup & Sync' }} />
          </Stack>
          </CloudProvider>
        </SettingsProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
