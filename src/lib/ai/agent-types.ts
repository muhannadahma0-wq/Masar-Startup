/** Shared serializable contracts for Masar's specialist review workflow. */
export type AgentSeverity = "critical" | "high" | "medium" | "low";
export type AgentEvidenceStatus = "supported" | "unverified" | "missing" | "contradictory";
export type AgentTaskStatus = "completed" | "unavailable" | "error";

export interface PitchAgentFinding {
  id: string;
  titleAr: string;
  titleEn: string;
  severity: AgentSeverity;
  detailsAr: string;
  detailsEn: string;
  recommendationAr: string;
  recommendationEn: string;
  slideIndex: number | null;
  evidenceQuote: string | null;
  evidenceStatus: AgentEvidenceStatus;
}

export interface PitchAgentResult {
  id: string;
  nameAr: string;
  nameEn: string;
  status: AgentTaskStatus;
  summaryAr: string;
  summaryEn: string;
  strengthsAr: string[];
  strengthsEn: string[];
  findings: PitchAgentFinding[];
  missingEvidenceAr: string[];
  missingEvidenceEn: string[];
  errorCode?: string;
  model?: string;
  latencyMs?: number;
}

export interface PitchAgentReview {
  status: "completed" | "partial" | "unavailable";
  provider: string;
  model: string;
  totalAgents: 20;
  completedAgents: number;
  summaryAr: string;
  summaryEn: string;
  prioritiesAr: string[];
  prioritiesEn: string[];
  agents: PitchAgentResult[];
  disclaimerAr: string;
  disclaimerEn: string;
  generatedAt: string;
}
