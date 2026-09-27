import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Sign up — Bark", description: "Your next adventure starts here. Explore Bark's signup preview." };

export default function SignupPage() { return <AuthScreen key="signup" mode="signup" />; }
