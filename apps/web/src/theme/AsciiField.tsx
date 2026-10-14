import { useTheme } from "./ThemeContext.tsx";
import { AsciiClouds } from "./AsciiClouds.tsx";
import { AsciiGameOfLife } from "./AsciiGameOfLife.tsx";

export function AsciiField() {
  const { theme } = useTheme();
  return theme === "light" ? <AsciiClouds /> : <AsciiGameOfLife />;
}
