import { cn } from "@/lib/utils";

interface ETSLogoProps {
  className?: string;
  width?: number;
  height?: number;
}

export function ETSLogo({ className, width = 32, height = 32 }: ETSLogoProps) {
  return (
    <img
      src="/ETS_logo.png"
      alt="ETS"
      width={width}
      height={height}
      className={cn("flex-shrink-0 object-contain", className)}
    />
  );
}
