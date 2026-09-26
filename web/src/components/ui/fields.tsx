"use client";

import { useId, type CSSProperties, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { transitions } from "./motion";
import { Icon } from "./icon";
import styles from "./ui.module.css";

type FieldProps = { label: string; description?: string; error?: string };

function Field({ id, label, description, error, children }: FieldProps & { id: string; children: ReactNode }) {
  return <div className={styles.field}>
    <label htmlFor={id} className={styles.label}>{label}</label>
    {children}
    {description && <p id={`${id}-hint`} className={styles.hint}>{description}</p>}
    <AnimatePresence initial={false}>
      {error && <motion.p key="error" id={`${id}-error`} className={styles.error} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={transitions.fade}>{error}</motion.p>}
    </AnimatePresence>
  </div>;
}

function describedBy(id: string, description?: string, error?: string, external?: string) {
  return [external, description && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
}

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> & FieldProps & {
  type?: "text" | "search" | "number";
  leadingIcon?: ReactNode;
};

export function TextInput({ label, description, error, leadingIcon, type = "text", id: suppliedId, className = "", ...props }: TextInputProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return <Field id={id} label={label} description={description} error={error}>
    <div className={styles.inputWrap}>
      {(leadingIcon || type === "search") && <span className={styles.inputIcon}>{leadingIcon ?? <Icon name="search" />}</span>}
      <input {...props} id={id} type={type} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy(id, description, error, props["aria-describedby"])} className={`${styles.input} ${leadingIcon || type === "search" ? styles.withIcon : ""} ${className}`} />
    </div>
  </Field>;
}

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "multiple" | "size"> & FieldProps & { options: readonly SelectOption[]; placeholder?: string };

export function Select({ label, description, error, options, placeholder, id: suppliedId, className = "", ...props }: SelectProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return <Field id={id} label={label} description={description} error={error}>
    <div className={styles.inputWrap}>
      <select {...props} id={id} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy(id, description, error, props["aria-describedby"])} className={`${styles.input} ${styles.select} ${className}`}>
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <span className={styles.selectIcon}><Icon name="chevron" size={18} /></span>
    </div>
  </Field>;
}

export type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"> & {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (value: number) => string;
};

export function Slider({ label, value, onValueChange, min = 0, max = 100, step = 1, formatValue = String, id: suppliedId, className = "", style, ...props }: SliderProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const percent = max > min ? Math.min(100, Math.max(0, (value - min) / (max - min) * 100)) : 0;
  return <div className={styles.field}>
    <div className={styles.sliderHeading}><label htmlFor={id} className={styles.label}>{label}</label><output htmlFor={id}>{formatValue(value)}</output></div>
    <input {...props} id={id} type="range" value={value} min={min} max={max} step={step} onChange={(event) => onValueChange(Number(event.target.value))} aria-valuetext={formatValue(value)} className={`${styles.range} ${className}`} style={{ ...style, "--range-progress": `${percent}%` } as CSSProperties} />
  </div>;
}

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> & { label: string; description?: string };

export function Switch({ label, description, id: suppliedId, className = "", ...props }: SwitchProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return <div className={styles.switchRow}>
    <div><label htmlFor={id} className={styles.label}>{label}</label>{description && <p id={`${id}-hint`} className={styles.hint}>{description}</p>}</div>
    <input {...props} id={id} role="switch" type="checkbox" aria-describedby={describedBy(id, description, undefined, props["aria-describedby"])} className={`${styles.switch} ${className}`} />
  </div>;
}
