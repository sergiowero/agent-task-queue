import type { ThemePreference } from "../contexts/ThemeContext";
import { useTheme } from "../contexts/ThemeContext";
import { DarkIcon, LightIcon, SystemIcon } from "../lib/icons";
import { IconButton } from "./IconButton";
import { SegmentedControl } from "./SegmentedControl";

const OPTIONS = [
  { value: "light" as const, label: "Light", icon: LightIcon, iconOnly: true },
  { value: "dark" as const, label: "Dark", icon: DarkIcon, iconOnly: true },
  { value: "system" as const, label: "System", icon: SystemIcon, iconOnly: true },
];

function originOf(e: React.MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Light / dark / system switch. `compact` renders a single cycling button. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { preference, theme, setPreference, toggleTheme } = useTheme();

  if (compact) {
    return (
      <IconButton
        icon={theme === "dark" ? DarkIcon : LightIcon}
        label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        tooltipSide="right"
        onClick={(e) => toggleTheme(originOf(e))}
      />
    );
  }

  return (
    <SegmentedControl<ThemePreference>
      label="Color theme"
      size="sm"
      fullWidth
      value={preference}
      options={OPTIONS}
      onChange={(value, e) => setPreference(value, originOf(e))}
    />
  );
}
