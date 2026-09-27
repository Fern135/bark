import Link from "next/link";
import Image from "next/image";
import { AccountLinks } from "@/components/auth/session";
import { Icon } from "@/components/ui/icon";
import s from "./marketplace.module.css";

export function MarketHeader() {
  return (
    <header className={s.header}>
      <Link href="/" className={s.brand} aria-label="Bark home">
        bark<span aria-hidden="true">✳</span>
      </Link>
      <nav className={s.nav} aria-label="Main navigation">
        <Link href="/games" className={s.activeNav}>
          <Icon name="spark" />
          Explore
        </Link>
        <Link href="/editor">
          <Icon name="cube" />
          Create
        </Link>
      </nav>
      <div className={s.account}>
        <AccountLinks joinClassName={s.join} />
      </div>
    </header>
  );
}
export function MarketFooter() {
  return (
    <footer className={s.footer}>
      <Image
        src="/images/landing/byte-wave.png"
        alt=""
        width={70}
        height={70}
      />
      <div>
        <strong>Made for the joy of playing.</strong>
        <span>A little curiosity. A whole world of possibility.</span>
      </div>
      <Link href="/editor">
        Make a world of your own <Icon name="arrow" size={18} />
      </Link>
    </footer>
  );
}
