/**
 * The FHIR adapter's opt-in **transform labels**: the `meta.security` coding written on a resource
 * the pass changed, and the Data Absent Reason written in place of a value the pass removed where R4
 * requires the element.
 *
 * The codes follow the FHIR R4 security-labels value set and the IHE De-Identification Handbook
 * (2.0.0, FHIR example): the v3 `ObservationValue` integrity code `REDACTED` ("some portion of an IT
 * resource has been filtered and not included") on the resource, and the Data Absent Reason `masked`
 * ("not available due to security, privacy or related reasons") on the element. Neither says the
 * output is de-identified or anonymized: the handbook's `ANONYED` and `PSEUDED` codes claim a status
 * this pass cannot establish, so they are not written.
 *
 * @packageDocumentation
 */

import {
  complex,
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  list,
  primitive,
  type FhirComplex,
  type FhirNode,
  type FhirProperty,
} from "@cosyte/fhir";

import {
  FHIR_ELEMENT_ALIASES,
  FHIR_REQUIRED_CHOICES,
  FHIR_REQUIRED_ELEMENTS,
} from "./generated/required-elements.js";

/**
 * The `meta.security` coding the FHIR adapter writes, under `transformLabels`, on every resource the
 * pass changed: the v3 `ObservationValue` integrity code `REDACTED`. It claims that some portion of
 * the resource was filtered out and is not included, and nothing more: not that the resource is
 * de-identified, anonymized or pseudonymized.
 *
 * @example
 * ```ts
 * import { FHIR_TRANSFORMED_SECURITY_LABEL } from "@cosyte/deid/fhir";
 *
 * FHIR_TRANSFORMED_SECURITY_LABEL.code; // => "REDACTED"
 * ```
 */
export const FHIR_TRANSFORMED_SECURITY_LABEL = {
  system: "http://terminology.hl7.org/CodeSystem/v3-ObservationValue",
  code: "REDACTED",
  display: "redacted",
} as const;

/**
 * The Data Absent Reason extension the FHIR adapter writes, under `transformLabels`, in place of a
 * value the pass removed where R4 requires the element (`min` of 1 or more): the R4
 * `data-absent-reason` extension with the code `masked`.
 *
 * @example
 * ```ts
 * import { FHIR_DATA_ABSENT_REASON } from "@cosyte/deid/fhir";
 *
 * FHIR_DATA_ABSENT_REASON.valueCode; // => "masked"
 * ```
 */
export const FHIR_DATA_ABSENT_REASON = {
  url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
  valueCode: "masked",
} as const;

/** The Data Absent Reason extension as a model node. */
function absentReason(): FhirComplex {
  return complex([
    { name: "url", value: primitive(FHIR_DATA_ABSENT_REASON.url) },
    { name: "valueCode", value: primitive(FHIR_DATA_ABSENT_REASON.valueCode) },
  ]);
}

/** The security coding as a model node. */
function securityCoding(): FhirComplex {
  return complex([
    { name: "system", value: primitive(FHIR_TRANSFORMED_SECURITY_LABEL.system) },
    { name: "code", value: primitive(FHIR_TRANSFORMED_SECURITY_LABEL.code) },
    { name: "display", value: primitive(FHIR_TRANSFORMED_SECURITY_LABEL.display) },
  ]);
}

/**
 * The definition path of a child element: `parent.name`, read through `contentReference` so a nested
 * `Questionnaire.item.item` is `Questionnaire.item`.
 *
 * @internal
 */
export function childElementPath(parent: string, name: string): string {
  const path = `${parent}.${name}`;
  return FHIR_ELEMENT_ALIASES.get(path) ?? path;
}

/**
 * `true` when R4 requires the element `name` under the definition path `parent` and its type is one
 * the pass can remove: the element itself, or a required choice element (`content[x]`) whose name the
 * property starts with (`contentString`).
 *
 * @internal
 */
export function isRequiredElement(parent: string, name: string): boolean {
  return (
    FHIR_REQUIRED_ELEMENTS.has(childElementPath(parent, name)) ||
    FHIR_REQUIRED_CHOICES.get(parent)?.some((base) => name.startsWith(base)) === true
  );
}

/**
 * What stands in for a removed required element: a primitive with no value carrying the Data Absent
 * Reason (written on its `_` sibling), a complex carrying it as its one extension, and a list of one
 * such item when the element repeats.
 *
 * @internal
 */
export function absentPlaceholder(removed: FhirNode): FhirNode {
  const primitives = isList(removed) ? removed.items.every(isPrimitive) : isPrimitive(removed);
  const item = primitives
    ? primitive(undefined, { extension: [absentReason()] })
    : complex([{ name: "extension", value: list([absentReason()]) }]);
  return isList(removed) ? list([item]) : item;
}

/** The text of a primitive property of a complex, or `undefined`. */
function textOf(node: FhirNode, name: string): unknown {
  const value = isComplex(node) ? getProperty(node, name) : undefined;
  return value !== undefined && isPrimitive(value) ? value.value : undefined;
}

/** `true` when a coding already carries the label's system and code. */
function isTheLabel(node: FhirNode): boolean {
  return (
    textOf(node, "system") === FHIR_TRANSFORMED_SECURITY_LABEL.system &&
    textOf(node, "code") === FHIR_TRANSFORMED_SECURITY_LABEL.code
  );
}

/** Insert `prop` before the first property named in `before`, or at the end. */
function insertBefore(
  props: readonly FhirProperty[],
  prop: FhirProperty,
  before: ReadonlySet<string>,
): FhirProperty[] {
  const at = props.findIndex((p) => before.has(p.name));
  return at < 0 ? [...props, prop] : [...props.slice(0, at), prop, ...props.slice(at)];
}

/** The `meta` properties that follow `security` in R4. */
const AFTER_SECURITY: ReadonlySet<string> = new Set(["tag"]);

/** The resource properties that follow `meta` in R4: every one but `resourceType` and `id`. */
function afterMeta(props: readonly FhirProperty[]): ReadonlySet<string> {
  return new Set(props.map((p) => p.name).filter((n) => n !== "resourceType" && n !== "id"));
}

/**
 * A resource's properties with the security label added to its `meta`: a `meta` is created after the
 * `id` when there is none, a `security` list is added before any `tag`, and the coding is appended
 * to that list unless the same system and code is already there. A `meta` that is not an object is
 * left as it arrived.
 *
 * @internal
 */
export function withSecurityLabel(props: readonly FhirProperty[]): readonly FhirProperty[] {
  const existing = props.find((p) => p.name === "meta")?.value;
  const meta = existing ?? complex([]);
  if (!isComplex(meta)) return props;

  const security = getProperty(meta, "security");
  const codings = security === undefined ? [] : isList(security) ? security.items : [security];
  if (codings.some(isTheLabel)) return props;
  const labels: FhirProperty = { name: "security", value: list([...codings, securityCoding()]) };
  const metaProps =
    security === undefined
      ? insertBefore(meta.properties, labels, AFTER_SECURITY)
      : meta.properties.map((p) => (p.name === "security" ? labels : p));
  const next: FhirProperty = { name: "meta", value: complex(metaProps) };
  return existing === undefined
    ? insertBefore(props, next, afterMeta(props))
    : props.map((p) => (p.name === "meta" ? next : p));
}
