export interface BiomarkerScore {
  raw_score: number
  class: number
  label: string
}

export interface Interpretation {
  summary: string
  depression: string
  anxiety: string
  transcript_observations: string
  agreement: string
  divergence: string
  limitations: string
}

export interface AnalyzeResponse {
  depression: BiomarkerScore
  anxiety: BiomarkerScore
  transcript: string
  interpretation: Interpretation
  processing_seconds: number
}
