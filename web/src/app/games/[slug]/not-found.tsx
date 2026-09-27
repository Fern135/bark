import Link from "next/link";
import s from "@/components/marketplace/marketplace.module.css";
export default function MissingGame() {
  return (
    <main className={s.errorPage}>
      <h1>This world is still undiscovered.</h1>
      <p>We couldn’t find that game in the collection.</p>
      <Link href="/games">Find another adventure →</Link>
    </main>
  );
}
