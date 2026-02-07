export const SUPPORTED_REPORT_FILE_CATEGORIES = ["lab_report", "imaging_report"] as const;

export type SupportedReportFileCategory = (typeof SUPPORTED_REPORT_FILE_CATEGORIES)[number];
export type ReportFileCategory =
  | SupportedReportFileCategory
  | "clinical_note"
  | "voice_attachment"
  | "other";

export type ParsedDocumentFinding = {
  finding_type: "lab_result" | "imaging_impression";
  label: string;
  normalized_test_name: string | null;
  value_text: string | null;
  numeric_value: number | null;
  unit: string | null;
  normalized_unit: string | null;
  reference_range: string | null;
  is_abnormal: boolean;
  confidence: number;
  risk_markers: string[];
  provenance: Record<string, unknown>;
};

export type ParseClinicalDocumentInput = {
  file_category: string;
  report_text: string;
};

export type ParseClinicalDocumentResult =
  | {
      ok: true;
      findings: ParsedDocumentFinding[];
      risk_markers: string[];
    }
  | {
      ok: false;
      error_code: "unsupported_file_category" | "empty_report_text";
      message: string;
    };

const SUPPORTED_CATEGORY_SET = new Set<string>(SUPPORTED_REPORT_FILE_CATEGORIES);

const LAB_RISK_MARKER_LABELS = new Set<string>([
  "troponin i",
  "troponin",
  "d dimer",
  "d dimer quantitative",
  "potassium",
  "sodium",
  "creatinine",
  "hemoglobin",
  "hemoglobin a1c",
  "glucose",
  "platelets",
  "wbc",
  "white blood cell count",
  "lactate",
  "bnp",
  "nt probnp",
]);

const IMAGING_RISK_KEYWORDS = [
  "pulmonary embol",
  "pneumothorax",
  "intracranial hemorrhage",
  "hemorrhage",
  "acute fracture",
  "malignancy",
  "large pleural effusion",
  "bowel obstruction",
  "aortic dissection",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasUnnegatedKeyword(sentence: string, keyword: string): boolean {
  const normalizedSentence = sentence.toLowerCase();
  const escapedKeyword = escapeRegExp(keyword);
  const keywordPattern = new RegExp(`\\b${escapedKeyword}\\b`);
  if (!keywordPattern.test(normalizedSentence)) {
    return false;
  }

  const negationPattern = new RegExp(`\\b(no|without|not|absence of)\\s+(?:acute\\s+)?${escapedKeyword}\\b`);
  return !negationPattern.test(normalizedSentence);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function uniqueStrings(values: string[]): string[] {
  const next = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length > 0) {
      next.add(normalized);
    }
  }
  return [...next];
}

function parseReferenceBounds(referenceRange: string | null): { low: number; high: number } | null {
  if (!referenceRange) {
    return null;
  }
  const match = referenceRange.match(/(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) {
    return null;
  }
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return null;
  }
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

export function normalizeFindingLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeLabUnit(unit: string | null | undefined): string | null {
  if (typeof unit !== "string") {
    return null;
  }
  const normalized = unit
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/μ/g, "u")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseNumericValue(valueText: string | null | undefined): number | null {
  if (typeof valueText !== "string") {
    return null;
  }
  const match = valueText.match(/[<>]?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isSupportedReportFileCategory(value: string): value is SupportedReportFileCategory {
  return SUPPORTED_CATEGORY_SET.has(value);
}

function parseLabValueTail(tail: string): {
  valueText: string | null;
  numericValue: number | null;
  unit: string | null;
  referenceRange: string | null;
  abnormalHint: boolean;
} {
  const referenceByKeywordMatch = tail.match(
    /(?:ref(?:erence)?(?:\s*range)?|normal)\s*[:=]?\s*([A-Za-z0-9<>\-.\s/%]+)/i,
  );
  const referenceRangeMatch =
    referenceByKeywordMatch?.[1]?.trim() ?? tail.match(/(-?\d+(?:\.\d+)?\s*(?:-|to)\s*-?\d+(?:\.\d+)?)/i)?.[1] ?? null;
  const referenceRange = referenceRangeMatch && referenceRangeMatch.length > 0 ? referenceRangeMatch : null;

  const valueUnitMatch = tail.match(/([<>]?\s*-?\d+(?:\.\d+)?)(?:\s*([A-Za-z%/^.0-9-]+))?/);
  const numericValue = valueUnitMatch ? Number(valueUnitMatch[1].replace(/[<>\s]/g, "")) : null;
  const unit = valueUnitMatch?.[2]?.trim() ?? null;
  const valueText =
    valueUnitMatch && Number.isFinite(numericValue as number)
      ? `${valueUnitMatch[1].trim()}${unit ? ` ${unit}` : ""}`
      : null;

  const abnormalHint = /\b(high|low|abnormal|critical|panic|[HL])\b/i.test(tail);
  return {
    valueText,
    numericValue: Number.isFinite(numericValue as number) ? (numericValue as number) : null,
    unit,
    referenceRange,
    abnormalHint,
  };
}

function parseLabFinding(line: string, lineNumber: number): ParsedDocumentFinding | null {
  const colonPattern = line.match(/^([A-Za-z][A-Za-z0-9()/%._\-\s]{1,120})\s*[:\-]\s*(.+)$/);
  const tablePattern = !colonPattern ? line.split(/\s{2,}/).filter((part) => part.trim().length > 0) : [];

  let label = "";
  let tail = "";
  let parserRule = "";

  if (colonPattern) {
    label = colonPattern[1].trim();
    tail = colonPattern[2].trim();
    parserRule = "lab_colon_pattern";
  } else if (tablePattern.length >= 2) {
    label = tablePattern[0].trim();
    tail = tablePattern.slice(1).join(" ").trim();
    parserRule = "lab_table_pattern";
  } else {
    return null;
  }

  const normalizedLabel = normalizeFindingLabel(label);
  if (!normalizedLabel) {
    return null;
  }

  const parsed = parseLabValueTail(tail);
  if (parsed.numericValue === null && !parsed.valueText) {
    return null;
  }

  const normalizedUnit = normalizeLabUnit(parsed.unit);
  const bounds = parseReferenceBounds(parsed.referenceRange);
  const outOfReference =
    bounds && parsed.numericValue !== null
      ? parsed.numericValue < bounds.low || parsed.numericValue > bounds.high
      : false;
  const isAbnormal = parsed.abnormalHint || outOfReference;

  const riskMarkers: string[] = [];
  if (/critical|panic/i.test(line)) {
    riskMarkers.push("critical_lab_flag");
  }
  if (isAbnormal && LAB_RISK_MARKER_LABELS.has(normalizedLabel)) {
    riskMarkers.push(`abnormal_${normalizedLabel.replace(/\s+/g, "_")}`);
  }

  let confidence = 0.58;
  if (parsed.numericValue !== null) {
    confidence += 0.2;
  }
  if (parsed.referenceRange) {
    confidence += 0.12;
  }
  if (parsed.unit) {
    confidence += 0.06;
  }
  if (parserRule === "lab_colon_pattern") {
    confidence += 0.04;
  }

  return {
    finding_type: "lab_result",
    label,
    normalized_test_name: normalizedLabel,
    value_text: parsed.valueText,
    numeric_value: parsed.numericValue,
    unit: parsed.unit,
    normalized_unit: normalizedUnit,
    reference_range: parsed.referenceRange,
    is_abnormal: isAbnormal,
    confidence: clampConfidence(confidence),
    risk_markers: uniqueStrings(riskMarkers),
    provenance: {
      extraction_method: parserRule,
      source_line_number: lineNumber,
      source_excerpt: line,
    },
  };
}

function splitImagingSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) =>
      line
        .split(/(?<=[.;])\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    );
}

function parseImagingFindings(text: string): ParsedDocumentFinding[] {
  const lower = text.toLowerCase();
  const impressionIndex = lower.indexOf("impression");
  const sourceText = impressionIndex >= 0 ? text.slice(impressionIndex) : text;
  const sentences = splitImagingSentences(sourceText).slice(0, 12);

  return sentences
    .map((sentence, index) => {
      const line = sentence.replace(/^[-*]\s*/, "").trim();
      if (line.length < 10) {
        return null;
      }

      const normalized = line.toLowerCase();
      const hasNoAcuteFinding = /\bno acute\b/.test(normalized);
      const riskMarkers = IMAGING_RISK_KEYWORDS.filter((keyword) =>
        hasUnnegatedKeyword(normalized, keyword),
      ).map((keyword) => `imaging_${keyword.replace(/\s+/g, "_")}`);

      const likelyAbnormal =
        !hasNoAcuteFinding &&
        /\b(fracture|effusion|mass|lesion|hemorrhage|embol|edema|consolidation|abnormal)\b/i.test(line);

      let confidence = 0.66;
      if (likelyAbnormal || riskMarkers.length > 0) {
        confidence += 0.14;
      }
      if (/impression|findings/i.test(line)) {
        confidence += 0.06;
      }

      return {
        finding_type: "imaging_impression" as const,
        label: `Impression ${index + 1}`,
        normalized_test_name: null,
        value_text: line,
        numeric_value: null,
        unit: null,
        normalized_unit: null,
        reference_range: null,
        is_abnormal: likelyAbnormal || riskMarkers.length > 0,
        confidence: clampConfidence(confidence),
        risk_markers: uniqueStrings(riskMarkers),
        provenance: {
          extraction_method: "imaging_sentence_pattern",
          sentence_index: index,
          source_excerpt: line,
        },
      };
    })
    .filter((finding): finding is ParsedDocumentFinding => finding !== null);
}

export function parseClinicalDocument(input: ParseClinicalDocumentInput): ParseClinicalDocumentResult {
  const fileCategory = String(input.file_category ?? "").trim();
  if (!isSupportedReportFileCategory(fileCategory)) {
    return {
      ok: false,
      error_code: "unsupported_file_category",
      message: "Only lab_report and imaging_report categories are supported in this pipeline.",
    };
  }

  const reportText = String(input.report_text ?? "").trim();
  if (!reportText) {
    return {
      ok: false,
      error_code: "empty_report_text",
      message: "report_text is required.",
    };
  }

  let findings: ParsedDocumentFinding[] = [];
  if (fileCategory === "lab_report") {
    findings = reportText
      .split(/\r?\n/)
      .map((line, index) => parseLabFinding(line.trim(), index + 1))
      .filter((finding): finding is ParsedDocumentFinding => finding !== null);
  } else {
    findings = parseImagingFindings(reportText);
  }

  const riskMarkers = uniqueStrings(findings.flatMap((finding) => finding.risk_markers));
  return {
    ok: true,
    findings,
    risk_markers: riskMarkers,
  };
}
