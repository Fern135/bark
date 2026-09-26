import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Log in — Bark", description: "Welcome back, creator. Explore Bark's login preview." };

export default function LoginPage() { return <AuthScreen key="login" mode="login" />; }
