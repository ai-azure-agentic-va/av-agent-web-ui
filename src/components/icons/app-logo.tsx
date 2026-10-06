import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
  width?: number;
  height?: number;
}

export function AppLogo({ className, width = 32, height = 32 }: AppLogoProps) {
  return (
    <img
      src="/logo.svg"
      alt="App logo"
      width={width}
      height={height}
      className={cn("flex-shrink-0 object-contain", className)}
    />
  );
}
