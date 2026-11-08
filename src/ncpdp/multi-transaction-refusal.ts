/**
 * The **multi-transaction refusal**: a Telecom transmission carrying more than one transaction is
 * refused with a typed error, never half-handled.
 *
 * `@cosyte/ncpdp` decodes every group-separated transaction a transmission carries, and this adapter
 * de-identifies one. Handling only the first would either drop the rest or hand them back
 * untransformed, and its serializer refuses to write more than one with an error from outside this
 * package's fatal set. So the entry points refuse the transmission themselves, before anything is
 * extracted: a typed {@link "@cosyte/deid".DeidError} carrying `DEID_FORMAT_UNSUPPORTED`, a message
 * that reads nothing out of the document, and no transformed document, no manifest and no partial
 * output of any kind.
 *
 * @packageDocumentation
 */

import type { TelecomTransaction } from "@cosyte/ncpdp/telecom";

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
 * Refuse a transmission that decoded more than one transaction. Never returns for one.
 *
 * @param tx - The parsed Telecom transmission an entry point was handed.
 * @throws {@link "@cosyte/deid".DeidError} `DEID_FORMAT_UNSUPPORTED` when it decoded more than one
 *   transaction.
 * @internal Not exported from the package entry point.
 */
export function assertSingleTransaction(tx: TelecomTransaction): void {
  if (decodedTransactions(tx) > 1) {
    throw new DeidError(
      FATAL_CODES.DEID_FORMAT_UNSUPPORTED,
      NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE,
    );
  }
}
