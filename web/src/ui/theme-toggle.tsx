import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme.tsx";
import { Button } from "./button.tsx";
import { Menu, MenuItem, MenuLabel } from "./menu.tsx";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
];

export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;

  return (
    <Menu
      trigger={
        <Button variant="ghost" size="icon" aria-label="Appearance">
          <Icon />
        </Button>
      }
    >
      <MenuLabel>Appearance</MenuLabel>
      {OPTIONS.map((option) => (
        <MenuItem key={option.value} onSelect={() => setTheme(option.value)} checked={theme === option.value}>
          <span className="flex items-center gap-2">
            <option.icon className="size-4" />
            {option.label}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}
