/**
 * The **multi-transaction refusal**: a Telecom transmission carrying more than one transaction is
 * refused with a typed error, never half-handled.
 *
 * `@cosyte/ncpdp` decodes every group-separated transaction a transmission carries, and this adapter
 * de-identifies one. Handling only the first would either drop the rest or hand them back
 * untransformed, and its serializer refuses to write more than one with an error from outside this
 * package's fatal set. So the entry points refuse the transmission themselves, before anything is
 * extracted.
 *
 * The decode alone does not settle it. A Group Separator starts each transaction and what precedes
 * the first belongs to the transmission, so a sender who leaves out the first Group Separator has its
 * first transaction decoded as transmission-level segments, and one transaction decodes where two
 * were declared. So a transmission is refused when it decoded more than one transaction, when its
 * header declares more than one, or when its decode carries the count-mismatch warning: whichever
 * way the sender wrote it, a count that is not plainly one is never handled. The refusal is a typed {@link "@cosyte/deid".DeidError} carrying `DEID_FORMAT_UNSUPPORTED`, a message
 * that reads nothing out of the document, and no transformed document, no manifest and no partial
 * output of any kind.
 *
 * @packageDocumentation
 */

import type { TelecomTransaction, TelecomWarningCode } from "@cosyte/ncpdp/telecom";

import { DeidError, FATAL_CODES } from "../codes.js";

/**
 * The refusal diagnostic, in full. Fixed text this library owns: it carries no value read from the
 * document, no key and no offset, so it is safe to log wherever a `DeidError` message is safe to log.
 *
 * @example
 * ```ts
 * import { NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE } from "@cosyte/deid/ncpdp";
 * NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE.includes("more than one transaction"); // => true
 * ```
 */
export const NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE: string =
  "An NCPDP Telecom transmission carrying more than one transaction is refused, not partially " +
  "handled: this adapter de-identifies one transaction per transmission, and handling only the " +
  "first would drop the others or return them untransformed. Split the transmission and " +
  "de-identify each transaction on its own.";

/**
 * The number of transactions a parsed transmission decoded. A model built by hand rather than by
 * `parseTelecom` may carry no `transactions` list; it then describes the one transaction its
 * `segments` hold.
 */
function decodedTransactions(tx: TelecomTransaction): number {
  const decoded: readonly unknown[] | undefined = tx.transactions;
  return decoded?.length ?? 1;
}

/**
 * The warning `@cosyte/ncpdp` raises when the header's declared transaction count disagrees with the
 * number of transactions decoded. Named here as text, so the check needs no runtime value from the
 * peer.
 */
const TRANSACTION_COUNT_MISMATCH =
  "NCPDP_TELECOM_TRANSACTION_COUNT_MISMATCH" satisfies TelecomWarningCode;

/**
 * Whether the header declares more than one transaction (109-A9, kept verbatim by the parser). A
 * count that reads as no number is left to the count-mismatch warning, which the parser raises for
 * any declared count other than the one decoded.
 */
function declaresMoreThanOne(tx: TelecomTransaction): boolean {
  const declared: string | undefined = tx.transactionCount;
  if (declared === undefined) return false;
  const count = Number.parseInt(declared.trim(), 10);
  return count > 1;
}

/** Whether the decode warned that the declared and decoded transaction counts disagree. */
function warnsCountMismatch(tx: TelecomTransaction): boolean {
  const warnings: readonly { readonly code: string }[] | undefined = tx.warnings;
  return warnings?.some((w) => w.code === TRANSACTION_COUNT_MISMATCH) ?? false;
}

/**
 * Refuse a transmission that carries, declares or may carry more than one transaction: it decoded
 * more than one, its header declares more than one, or its decode warned that the declared count
 * and the decoded one disagree. Never returns for one.
 *
 * @param tx - The parsed Telecom transmission an entry point was handed.
 * @throws {@link "@cosyte/deid".DeidError} `DEID_FORMAT_UNSUPPORTED` when it decoded more than one
 *   transaction, declares more than one, or carries the count-mismatch warning.
 * @internal Not exported from the package entry point.
 */
export function assertSingleTransaction(tx: TelecomTransaction): void {
  if (decodedTransactions(tx) > 1 || declaresMoreThanOne(tx) || warnsCountMismatch(tx)) {
    throw new DeidError(
      FATAL_CODES.DEID_FORMAT_UNSUPPORTED,
      NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE,
    );
  }
}
