import type { CSSProperties } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-foreground group-[.toaster]:rounded-[2px_14px_2px_2px] group-[.toaster]:font-sans group-[.toaster]:shadow-[0_12px_32px_rgb(0_0_0/0.12)]",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground font-medium",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground font-medium",
        },
      }}
      // richColors toasts follow the palette: the red tint with dark-red text.
      style={
        {
          "--error-bg": "var(--destructive-tint)",
          "--error-border": "var(--destructive)",
          "--error-text": "var(--destructive-ink)",
        } as CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
