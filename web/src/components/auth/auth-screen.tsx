"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useInView } from "motion/react";
import { accounts, errorMessage, returnPath } from "@/lib/accounts";
import { accountRecoveryEnabled } from "@/lib/features";
import { useSession } from "./session";
import { Button } from "@/components/ui/button";
import { TextInput, PasswordInput } from "@/components/ui/fields";
import { Panel } from "@/components/ui/panel";
import { Icon } from "@/components/ui/icon";
import { transitions } from "@/components/ui/motion";
import s from "./auth.module.css";

type Mode = "login" | "signup";
type Values = { displayName: string; email: string; password: string };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: transitions.gentle } };

function AuthForm({ mode }: { mode: Mode }) {
  const signup = mode === "signup";
  const [values, setValues] = useState<Values>({ displayName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Values>>({});
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const { setUser } = useSession();
  const router = useRouter();
  const destination = returnPath(useSearchParams().get("next"));

  function change(field: keyof Values, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFeedback("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const email = form.elements.namedItem("email") as HTMLInputElement;
    const next: Partial<Values> = {};
    if (signup && !values.displayName.trim()) next.displayName = "What should we call you?";
    if (!values.email.trim()) next.email = "Enter your email address.";
    else if (email.validity.typeMismatch) next.email = "That email doesn’t look quite right.";
    if (!values.password) next.password = "Enter a password.";
    setErrors(next);
    setFeedback("");
    const first = Object.keys(next)[0];
    if (first) {
      (form.elements.namedItem(first) as HTMLInputElement)?.focus();
      return;
    }
    setBusy(true);
    let registered = false;
    try {
      if (signup) { await accounts.register(values.displayName.trim(), values.email.trim(), values.password); registered = true; }
      setUser(await accounts.login(values.email.trim(), values.password));
      router.replace(destination);
    } catch (error) { setFeedback(`${registered ? "Your account was created. Please log in to continue. " : ""}${errorMessage(error)}`); }
    finally { setBusy(false); }
  }

  return <motion.div className={s.formInner} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.055, delayChildren: 0.12 } } }}>
    <motion.div variants={item} className={s.formHeading}>
      <span className={s.eyebrow}>{signup ? "A LITTLE CURIOSITY GOES A LONG WAY" : "GOOD TO SEE YOU AGAIN"}</span>
      <h1>{signup ? <>Your next adventure<br />starts here.</> : <>Welcome back,<br />creator.</>}</h1>
      <p>{signup ? "Make room for a little imagination." : "A little imagination. A whole new adventure."}</p>
    </motion.div>
    <form noValidate onSubmit={submit} className={s.form} aria-label={signup ? "Create a Bark account" : "Log in to Bark"}>
      {signup && <motion.div variants={item}><TextInput name="displayName" label="Username" placeholder="Choose your username" autoComplete="username" maxLength={100} required value={values.displayName} error={errors.displayName} onChange={(event) => change("displayName", event.target.value)} /></motion.div>}
      <motion.div variants={item}><TextInput name="email" type="email" label="Email" placeholder="you@example.com" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={values.email} error={errors.email} onChange={(event) => change("email", event.target.value)} /></motion.div>
      <motion.div variants={item}><PasswordInput name="password" label="Password" placeholder={signup ? "Create a password" : "Enter your password"} autoComplete={signup ? "new-password" : "current-password"} required value={values.password} error={errors.password} onChange={(event) => change("password", event.target.value)} /></motion.div>
      <motion.div variants={item}><Button type="submit" loading={busy} variant={signup ? "accent" : "primary"} className={s.submit} trailingIcon={<Icon name="arrow" size={19} />}>{signup ? "Create account" : "Log in"}</Button></motion.div>
    </form>
    <div role="status" aria-live="polite" aria-atomic="true"><AnimatePresence initial={false}>{feedback && <motion.div key={feedback} className={s.feedbackWrap} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}><p className={s.feedback}><Icon name="spark" size={18} /><span>{feedback}</span></p></motion.div>}</AnimatePresence></div>
    <motion.p variants={item} className={s.switchPage}>{signup ? "Already have an account?" : "New to Bark?"} <Link href={`${signup ? "/login" : "/signup"}?next=${encodeURIComponent(destination)}`}>{signup ? "Log in" : "Sign up"}<Icon name="arrow" size={14} /></Link></motion.p>
    {!signup && accountRecoveryEnabled && <p><Link href="/forgot-password">Forgot password?</Link>{" · "}<Link href="/forgot-username">Forgot username?</Link></p>}
    {signup && !accountRecoveryEnabled && <p>Save your username and password somewhere safe. Account recovery is not available yet.</p>}
  </motion.div>;
}

export function AuthScreen({ mode }: { mode: Mode }) {
  const signup = mode === "signup";
  const artRef = useRef<HTMLDivElement>(null);
  const inView = useInView(artRef);
  return <Panel className={`${s.shell} ${signup ? s.signup : s.login}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} whileInView={undefined} transition={transitions.gentle}>
    <div className={s.split}>
      <div className={s.artPanel} ref={artRef}>
        <div className={s.artCopy}><span className={s.eyebrow}>{signup ? "LET’S MAKE SOMETHING WONDERFUL" : "PICK UP WHERE YOUR IMAGINATION LEFT OFF"}</span><h2>{signup ? <>Big ideas<br />{" "}start <em>small.</em></> : <>Your world<br />{" "}is <em>waiting.</em></>}</h2><p>{signup ? "A little spark. A first step. A world that’s all you." : "More little discoveries. More big ‘I made that!’ moments."}</p></div>
        <motion.div className={s.illustration} initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...transitions.gentle, delay: 0.15 }}><Image src={signup ? "/images/auth/byte-adventure.png" : "/images/auth/byte-welcome.png"} alt={signup ? "Byte stepping out of a blue doorway into a new adventure" : "Byte waving hello from a little floating island"} width={1254} height={1254} sizes="(max-width: 700px) 150px, (max-width: 1000px) 45vw, 580px" preload /></motion.div>
        <motion.span aria-hidden="true" className={s.starOne} animate={inView ? { y: [0, -10, 0], rotate: [-12, 8, -12] } : { y: 0 }} transition={{ duration: 4.5, repeat: inView ? Infinity : 0, ease: "easeInOut" }}>✦</motion.span>
        <motion.span aria-hidden="true" className={s.starTwo} animate={inView ? { y: [0, 8, 0], scale: [0.9, 1.15, 0.9] } : { y: 0 }} transition={{ duration: 3.5, repeat: inView ? Infinity : 0, ease: "easeInOut" }}>✳</motion.span>
        <motion.div className={s.artBadge} animate={inView ? { y: [0, -5, 0], rotate: [-3, 0, -3] } : { y: 0 }} transition={{ duration: 5, repeat: inView ? Infinity : 0, ease: "easeInOut" }}><span><Icon name={signup ? "spark" : "cube"} size={20} /></span><div>{signup ? "One little idea…" : "Made of imagination."}<strong>{signup ? "so many possibilities." : "Made by you."}</strong></div></motion.div>
        <p className={s.artFooter}><Icon name="code" size={16} /> Dream it. Build it. Give it a little bark.</p>
      </div>
      <div className={s.formPanel}><Suspense fallback={<p>Opening account…</p>}><AuthForm key={mode} mode={mode} /></Suspense></div>
    </div>
  </Panel>;
}
