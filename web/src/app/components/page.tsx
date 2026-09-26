import type { Metadata } from "next";
import { Showcase } from "./showcase";

export const metadata: Metadata = { title: "Components · Bark", description: "The building blocks of Bark. Explore our colors, controls, and playful details." };

export default function ComponentsPage() {
  return <Showcase />;
}
