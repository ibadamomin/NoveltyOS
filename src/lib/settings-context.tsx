import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from './db';
import { setCurrencySymbol } from './money';
import { useDataVersion } from './use-data-version';

type Ctx = { settings: Settings; update: (s: Settings) => Promise<void> };

const SettingsContext = createContext<Ctx>({ settings: DEFAULT_SETTINGS, update: async () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const version = useDataVersion(); // reload when settings arrive from another phone

  useEffect(() => {
    getSettings(db).then((s) => {
      setCurrencySymbol(s.currency);
      setSettings(s);
    });
  }, [db, version]);

  const update = useCallback(
    async (s: Settings) => {
      await saveSettings(db, s);
      setCurrencySymbol(s.currency);
      setSettings(s);
    },
    [db],
  );

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
