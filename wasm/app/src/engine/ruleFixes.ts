import type { RuleFix } from './types';

/** Desktop rule messages use both colon and dash labels for the Cancel branch. */
export const isNoRuleFix = (fix: RuleFix): boolean => /\[No\s*(?::|-)/.test(fix.reason);
