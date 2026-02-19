import { Tabs } from 'expo-router';
import { colors } from '../../src/components/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
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
          title: 'ミク言葉',
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => <TabIcon label="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="vocab"
        options={{
          title: '단어장',
          tabBarLabel: '단어',
          tabBarIcon: ({ color }) => <TabIcon label="📖" color={color} />,
        }}
      />
      <Tabs.Screen
        name="study"
        options={{
          title: '학습',
          tabBarLabel: '학습',
          tabBarIcon: ({ color }) => <TabIcon label="✏️" color={color} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: '통계',
          tabBarLabel: '통계',
          tabBarIcon: ({ color }) => <TabIcon label="📊" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarLabel: '설정',
          tabBarIcon: ({ color }) => <TabIcon label="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}

function TabIcon({ label, color }: { label: string; color: string }) {
  const { Text } = require('react-native');
  return <Text style={{ fontSize: 24, color }}>{label}</Text>;
}
