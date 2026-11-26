import { TIPS } from "./copyrightGlossary";

/**
 * The two hover-explanation components of the copyright pages (the texts are in copyrightGlossary.js). They are kept apart from the
 * texts so this file exports components only (React fast refresh).
 */

const TERM_CLS = "underline decoration-dotted decoration-gray-400 underline-offset-2 cursor-help";

/** Text with a dotted underline that explains itself on hover. Without a tip it is plain text. */
export function Term({ tip, children, className = "" }) {
  if (!tip) return <>{children}</>;
  return <span title={tip} className={`${TERM_CLS} ${className}`}>{children}</span>;
}

/** A column or box title: looks its own text up in TIPS.col. */
export function Col({ children }) {
  return <Term tip={typeof children === "string" ? TIPS.col[children] : null}>{children}</Term>;
}
