import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/tabs';
import type { ColorValue } from 'react-native';
import { colors, type IconName } from '../../components/ui';

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarLabel: title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={icon} size={size} color={color as string} />,
});

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarLabelStyle: { fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ ...tab('Home', 'home'), headerShown: false }} />
      <Tabs.Screen name="sell" options={tab('Sell', 'cart')} />
      <Tabs.Screen name="inventory" options={tab('Inventory', 'cube')} />
      <Tabs.Screen name="people" options={tab('Accounts', 'people')} />
      <Tabs.Screen name="history" options={tab('Records', 'receipt')} />
    </Tabs>
  );
}
