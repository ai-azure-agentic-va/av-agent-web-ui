import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
  width?: number;
  height?: number;
  // Decorative by default: every current placement sits next to the app name.
  alt?: string;
}

export function AppLogo({
  className,
  width = 32,
  height = 32,
  alt = "",
}: AppLogoProps) {
  return (
    <img
      src="/logo.png"
      alt={alt}
      width={width}
      height={height}
      className={cn("flex-shrink-0 object-contain", className)}
    />
  );
}
