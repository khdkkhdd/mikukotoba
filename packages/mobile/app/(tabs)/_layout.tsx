import { Tabs } from 'expo-router';
import { colors } from '../../src/components/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'JP Helper',
          tabBarLabel: '',
          tabBarIcon: ({ color }) => <TabIcon label="" color={color} />,
        }}
      />
      <Tabs.Screen
        name="vocab"
        options={{
          title: '',
          tabBarLabel: '',
          tabBarIcon: ({ color }) => <TabIcon label="" color={color} />,
        }}
      />
      <Tabs.Screen
        name="study"
        options={{
          title: '',
          tabBarLabel: '',
          tabBarIcon: ({ color }) => <TabIcon label="" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '',
          tabBarLabel: '',
          tabBarIcon: ({ color }) => <TabIcon label="" color={color} />,
        }}
      />
    </Tabs>
  );
}

function TabIcon({ label, color }: { label: string; color: string }) {
  const { Text } = require('react-native');
  return <Text style={{ fontSize: 24, color }}>{label}</Text>;
}
