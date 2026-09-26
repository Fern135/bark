import type { Metadata } from "next";
import { MotionProvider } from "@/components/ui/motion";
import { SessionProvider } from "@/components/auth/session";
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bark",
  description: "Bark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body><SessionProvider><MotionProvider>{children}</MotionProvider></SessionProvider></body>
    </html>
  );
}
