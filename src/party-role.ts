/**
 * The **party-role test**: the one place this library answers the question §164.514(b)(2)(i) asks about
 * a *party* rather than about a field.
 *
 * The scope clause reads "the following identifiers **of the individual or of relatives, employers, or
 * household members of the individual**, are removed". So a party carried by a transaction is either
 * *inside* that clause (the individual, a relative, **an employer**, a household member: its name and
 * identifiers are Safe Harbor subjects) or *outside* it (a treating clinician, a facility, a payer, a
 * payee, a submitter, a receiver, a clearinghouse: not the individual's identity, retained). The
 * question is decided by the **role the wire format types at the party**, never by what the value
 * "looks like": an `NM1` is the employer's because the X12 TR3 entity-identifier code says `36`, and an
 * `IN2-70` is the insured's employer because the HL7 v2.5.1 field definition says so.
 *
 * Two properties make this shared rather than per-adapter:
 *
 * - **It fails closed.** A role code that is absent, empty, or on neither list is `unknown`, and an
 *   unknown party is treated as a Safe Harbor subject (its name and identifiers are blocked), because
 *   an unrecognized party could be the individual.
 * - **It is value-free.** The classification hands back the role code **from the caller's own committed
 *   table**, never the bytes read off the wire, so a role code recorded in the manifest can only ever be
 *   a member of a list this library ships.
 *
 * @packageDocumentation
 */

/**
 * Where a party's role places it relative to §164.514(b)(2)(i):
 *
 * - `safe-harbor-subject`: the individual, a relative, an employer or a household member. Name and
 *   identifiers are transformed under the Safe Harbor categories.
 * - `outside-scope`: a party the clause does not reach (provider / facility / payer / payee / submitter
 *   / receiver / clearinghouse). Name and identifiers are left in place.
 * - `unknown`: the role could not be established. **Fails closed**, handled exactly like a subject.
 *
 * @example
 * ```ts
 * import { type PartyRoleScope } from "@cosyte/deid";
 *
 * const scope: PartyRoleScope = "outside-scope";
 * ```
 */
export type PartyRoleScope = "safe-harbor-subject" | "outside-scope" | "unknown";

/**
 * One format's two role-code lists. Both are the format's own committed vocabulary (X12 element 98
 * entity-identifier codes; the role an HL7 v2.5.1 field definition types at a party), never a value read
 * off a document.
 *
 * @example
 * ```ts
 * import { type PartyRoleTable } from "@cosyte/deid";
 *
 * const table: PartyRoleTable = { subject: new Set(["36"]), outside: new Set(["85"]) };
 * ```
 */
export interface PartyRoleTable {
  /** Role codes the scope clause reaches: the individual, a relative, an **employer**, a household member. */
  readonly subject: ReadonlySet<string>;
  /** Role codes that place the party outside the clause: provider / facility / payer / payee / submitter. */
  readonly outside: ReadonlySet<string>;
}

/**
 * The outcome of {@link classifyPartyRole}. `roleCode` is present only when the role was **recognized**,
 * and is then the matching member of the caller's own table: it carries no name, no identifier and no
 * other value, so it is safe to record in the value-free manifest.
 *
 * @example
 * ```ts
 * import { classifyPartyRole, type PartyRoleClassification } from "@cosyte/deid";
 *
 * const c: PartyRoleClassification = classifyPartyRole("85", {
 *   subject: new Set(["36"]),
 *   outside: new Set(["85"]),
 * });
 * c.scope; // => "outside-scope"
 * ```
 */
export type PartyRoleClassification =
  | {
      /** The role was recognized on one of the two lists. */
      readonly scope: "safe-harbor-subject" | "outside-scope";
      /** The matching member of the caller's table: a code, never a value. */
      readonly roleCode: string;
    }
  | {
      /** The role is absent, empty, or on neither list: fail closed. */
      readonly scope: "unknown";
      /** Never carried for an unrecognized role: an unknown code is not this library's to echo. */
      readonly roleCode?: undefined;
    };

/**
 * Classify a party from the role code its format types at the party, against that format's own
 * {@link PartyRoleTable}. Comparison is trimmed and upper-cased, so a lower-case wire code resolves to
 * the same committed member. An absent, empty or unlisted code is `unknown` and **fails closed**.
 *
 * @param roleCode - The role code the format types at the party (`NM1-01` / `N1-01`; the role an HL7
 *   v2.5.1 field definition names at an organisation-typed position).
 * @param table - The format's committed subject / outside-scope role lists.
 * @returns The classification, carrying the table's own code when the role was recognized.
 * @example
 * ```ts
 * import { classifyPartyRole } from "@cosyte/deid";
 *
 * const table = { subject: new Set(["36"]), outside: new Set(["85"]) };
 * classifyPartyRole("36", table); // => { scope: "safe-harbor-subject", roleCode: "36" }
 * classifyPartyRole("zq", table); // => { scope: "unknown" }  (fails closed)
 * ```
 */
export function classifyPartyRole(
  roleCode: string,
  table: PartyRoleTable,
): PartyRoleClassification {
  const code = roleCode.trim().toUpperCase();
  if (code.length === 0) return { scope: "unknown" };
  if (table.subject.has(code)) return { scope: "safe-harbor-subject", roleCode: code };
  if (table.outside.has(code)) return { scope: "outside-scope", roleCode: code };
  return { scope: "unknown" };
}
