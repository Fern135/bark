import Link from "next/link";
import { nunito } from "@/lib/fonts";
import { Icon } from "@/components/ui/icon";
import s from "@/components/auth/auth.module.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${nunito.className} ${s.page}`}>
    <header className={s.header}>
      <Link href="/" aria-label="Bark home" className={s.brand}>bark<span aria-hidden="true">✳</span></Link>
      <Link href="/" className={s.homeLink}><span aria-hidden="true"><Icon name="arrow" size={18} /></span>Back to home</Link>
    </header>
    <main className={s.main}>{children}</main>
    <footer className={s.footer}><Icon name="spark" size={15} /> Small steps. Big imaginations.</footer>
  </div>;
}
