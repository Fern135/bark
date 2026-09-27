// NEXT_PUBLIC values are embedded at build time. The production image disables recovery.
export const accountRecoveryEnabled = process.env.NEXT_PUBLIC_ACCOUNT_RECOVERY_ENABLED !== "0";
