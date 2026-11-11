/**
 * The FHIR **literal reader**: splits a string that carries a resource's logical id into the part the
 * pass replaces (the id) and the part it keeps (the structure around it), and says when a string is
 * none of the forms it knows, so the caller removes it rather than keep it.
 *
 * Five places carry a logical id: a resource's own `id`, a `Bundle.entry.fullUrl`, a
 * `Reference.reference`, a `Bundle.entry.request.url` and a `Bundle.entry.response.location`. The
 * last four are literals, read here. The forms, from FHIR R4 (references.html, bundle.html):
 *
 * - `#id`: a contained resource; and `#` alone, the container itself, which carries no id;
 * - `Type/id`: relative, resolved on the same server or against the Bundle entry's base;
 * - `base/Type/id`: absolute, where `base` is an `http` or `https` URL;
 * - `urn:uuid:...` and `urn:oid:...`: a logical id with no server at all, the whole tail being the id;
 * - `Type` alone, which only a request url uses (a create).
 *
 * Each of the RESTful forms may end in `/_history/vid`, a version id, which is dropped. `Type` must be
 * one of the 148 codes of the R4 `resource-types` code system, because a type segment is kept verbatim
 * and a word that only looks like a type could be anything. A RESTful `id` and `vid` must fit the R4
 * `id` datatype. Anything else (a search such as `Patient?identifier=...`, another scheme, an id
 * outside that alphabet, an empty string) is reported as unreadable.
 *
 * @packageDocumentation
 */

/**
 * The 148 codes of the FHIR R4 `resource-types` code system (4.0.1), the abstract `Resource` and
 * `DomainResource` among them. A literal's type segment is kept only when it is one of these.
 */
const R4_RESOURCE_TYPES: ReadonlySet<string> = new Set<string>([
  "Account",
  "ActivityDefinition",
  "AdverseEvent",
  "AllergyIntolerance",
  "Appointment",
  "AppointmentResponse",
  "AuditEvent",
  "Basic",
  "Binary",
  "BiologicallyDerivedProduct",
  "BodyStructure",
  "Bundle",
  "CapabilityStatement",
  "CarePlan",
  "CareTeam",
  "CatalogEntry",
  "ChargeItem",
  "ChargeItemDefinition",
  "Claim",
  "ClaimResponse",
  "ClinicalImpression",
  "CodeSystem",
  "Communication",
  "CommunicationRequest",
  "CompartmentDefinition",
  "Composition",
  "ConceptMap",
  "Condition",
  "Consent",
  "Contract",
  "Coverage",
  "CoverageEligibilityRequest",
  "CoverageEligibilityResponse",
  "DetectedIssue",
  "Device",
  "DeviceDefinition",
  "DeviceMetric",
  "DeviceRequest",
  "DeviceUseStatement",
  "DiagnosticReport",
  "DocumentManifest",
  "DocumentReference",
  "DomainResource",
  "EffectEvidenceSynthesis",
  "Encounter",
  "Endpoint",
  "EnrollmentRequest",
  "EnrollmentResponse",
  "EpisodeOfCare",
  "EventDefinition",
  "Evidence",
  "EvidenceVariable",
  "ExampleScenario",
  "ExplanationOfBenefit",
  "FamilyMemberHistory",
  "Flag",
  "Goal",
  "GraphDefinition",
  "Group",
  "GuidanceResponse",
  "HealthcareService",
  "ImagingStudy",
  "Immunization",
  "ImmunizationEvaluation",
  "ImmunizationRecommendation",
  "ImplementationGuide",
  "InsurancePlan",
  "Invoice",
  "Library",
  "Linkage",
  "List",
  "Location",
  "Measure",
  "MeasureReport",
  "Media",
  "Medication",
  "MedicationAdministration",
  "MedicationDispense",
  "MedicationKnowledge",
  "MedicationRequest",
  "MedicationStatement",
  "MedicinalProduct",
  "MedicinalProductAuthorization",
  "MedicinalProductContraindication",
  "MedicinalProductIndication",
  "MedicinalProductIngredient",
  "MedicinalProductInteraction",
  "MedicinalProductManufactured",
  "MedicinalProductPackaged",
  "MedicinalProductPharmaceutical",
  "MedicinalProductUndesirableEffect",
  "MessageDefinition",
  "MessageHeader",
  "MolecularSequence",
  "NamingSystem",
  "NutritionOrder",
  "Observation",
  "ObservationDefinition",
  "OperationDefinition",
  "OperationOutcome",
  "Organization",
  "OrganizationAffiliation",
  "Parameters",
  "Patient",
  "PaymentNotice",
  "PaymentReconciliation",
  "Person",
  "PlanDefinition",
  "Practitioner",
  "PractitionerRole",
  "Procedure",
  "Provenance",
  "Questionnaire",
  "QuestionnaireResponse",
  "RelatedPerson",
  "RequestGroup",
  "ResearchDefinition",
  "ResearchElementDefinition",
  "ResearchStudy",
  "ResearchSubject",
  "Resource",
  "RiskAssessment",
  "RiskEvidenceSynthesis",
  "Schedule",
  "SearchParameter",
  "ServiceRequest",
  "Slot",
  "Specimen",
  "SpecimenDefinition",
  "StructureDefinition",
  "StructureMap",
  "Subscription",
  "Substance",
  "SubstanceNucleicAcid",
  "SubstancePolymer",
  "SubstanceProtein",
  "SubstanceReferenceInformation",
  "SubstanceSourceMaterial",
  "SubstanceSpecification",
  "SupplyDelivery",
  "SupplyRequest",
  "Task",
  "TerminologyCapabilities",
  "TestReport",
  "TestScript",
  "ValueSet",
  "VerificationResult",
  "VisionPrescription",
]);

/** The R4 `id` datatype: 1 to 64 characters of letters, digits, `-` and `.`. */
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

/**
 * The base of an absolute RESTful URL: `http` or `https`, a host and an optional port, then path
 * segments, with no query, no fragment and no whitespace.
 */
const RESTFUL_BASE = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+)*$/;

/** The two logical schemes whose whole tail is the id. */
const LOGICAL_PREFIXES: readonly string[] = ["urn:uuid:", "urn:oid:"];

/**
 * What a literal holds:
 *
 * - `id`: a logical id, which is replaced, with `prefix` kept in front of the replacement. `base` is
 *   set on an absolute URL, so the caller can check which server it names.
 * - `self`: `#` alone, the container, which carries no id.
 * - `type`: a resource type alone, which carries no id.
 *
 * @internal
 */
export type FhirLiteral =
  | { readonly kind: "id"; readonly prefix: string; readonly id: string; readonly base?: string }
  | { readonly kind: "self" }
  | { readonly kind: "type" };

/** Read the RESTful forms: `Type/id` and `base/Type/id`, either one with `/_history/vid`. */
function readRestful(text: string): FhirLiteral | undefined {
  let segments = text.split("/");
  // `split` always returns at least one segment, and each read below is guarded by a length check,
  // so `String` only ever converts a string here.
  if (segments.length >= 4 && segments[segments.length - 2] === "_history") {
    if (!FHIR_ID.test(String(segments[segments.length - 1]))) return undefined;
    segments = segments.slice(0, -2); // the version id is dropped, never kept
  }
  if (segments.length < 2) return undefined;
  const type = String(segments[segments.length - 2]);
  const id = String(segments[segments.length - 1]);
  if (!R4_RESOURCE_TYPES.has(type) || !FHIR_ID.test(id)) return undefined;
  if (segments.length === 2) return { kind: "id", prefix: `${type}/`, id };
  const base = segments.slice(0, -2).join("/");
  if (!RESTFUL_BASE.test(base)) return undefined;
  return { kind: "id", prefix: `${base}/${type}/`, id, base };
}

/**
 * Read a literal, or return `undefined` when it is none of the forms this module knows.
 *
 * @param text - The literal as it arrived.
 * @param bareType - Whether a resource type alone is a form at this position (a request url only).
 * @returns What the literal holds, or `undefined` when the caller must remove it.
 * @internal
 */
export function readFhirLiteral(text: string, bareType: boolean): FhirLiteral | undefined {
  if (text === "#") return { kind: "self" };
  if (text.startsWith("#")) {
    const id = text.slice(1);
    return FHIR_ID.test(id) ? { kind: "id", prefix: "#", id } : undefined;
  }
  for (const prefix of LOGICAL_PREFIXES) {
    if (text.startsWith(prefix)) {
      const id = text.slice(prefix.length);
      return id.length > 0 ? { kind: "id", prefix, id } : undefined;
    }
  }
  if (bareType && R4_RESOURCE_TYPES.has(text)) return { kind: "type" };
  return readRestful(text);
}
