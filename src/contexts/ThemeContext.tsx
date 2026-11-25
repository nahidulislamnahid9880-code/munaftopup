import React, {createContext, useContext, useEffect, useState} from 'react';

interface ThemeContextValue {
  dark: boolean;
  toggleDark: () => void;
  setDark: (val: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [dark, setDarkState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sv_admin_theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('sv_admin_theme', dark ? 'dark' : 'light');
    } catch {
      // ignore storage failure
    }
  }, [dark]);

  const toggleDark = () => setDarkState((prev) => !prev);
  const setDark = (val: boolean) => setDarkState(val);

  return (
    <ThemeContext.Provider value={{dark, toggleDark, setDark}}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
