import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  collapsed?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ collapsed }) => {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggle}
      title={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className={cn(
        'flex items-center gap-2 rounded-lg text-slate-500 hover:bg-white/[0.06] hover:text-slate-300 transition-all duration-150',
        collapsed ? 'p-2 justify-center' : 'w-full px-3 py-2',
      )}
    >
      {isDark
        ? <Sun className="w-3.5 h-3.5 flex-shrink-0" />
        : <Moon className="w-3.5 h-3.5 flex-shrink-0" />
      }
      {!collapsed && (
        <span className="text-xs">{isDark ? 'Tema claro' : 'Tema escuro'}</span>
      )}
    </button>
  );
};
