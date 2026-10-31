import { wordCount } from '../shared/text.js';
import type { JobPosting } from './posting.js';
import { extractRequirements, type Requirement } from './requirements.js';
import { toSentences, type Sentence } from './sentences.js';
import {
  extractAttachments,
  extractBudget,
  extractClientAsks,
  extractDuration,
  extractLocationRestriction,
  extractTimezoneRequirement,
  type Attachment,
  type Budget,
  type ClientAsk,
  type Duration,
  type LocationRestriction,
  type TimezoneRequirement,
} from './terms.js';

/** Everything the rules could read out of a post. Pure data; the coverage, risk and rate steps consume it. */
export interface JobSpec {
  readonly title: string;
  readonly wordCount: number;
  readonly requirements: readonly Requirement[];
  readonly budget: Budget | undefined;
  readonly duration: Duration | undefined;
  readonly attachments: readonly Attachment[];
  readonly asks: readonly ClientAsk[];
  readonly locationRestriction: LocationRestriction | undefined;
  readonly timezone: TimezoneRequirement | undefined;
  /** The sentences the analysis ran on (needed by the risk rules). */
  readonly sentences: readonly Sentence[];
}

export function extractSpec(job: JobPosting): JobSpec {
  const sentences = toSentences(job.body);
  const requirements = [...extractRequirements(sentences)];
  const location = extractLocationRestriction(sentences);
  const timezone = extractTimezoneRequirement(sentences);
  if (location !== undefined && location.mode !== 'preferred') {
    requirements.push({ id: 'location', kind: 'location', label: `Location: ${location.mode === 'excluding' ? 'not ' : ''}${location.places.join(', ')}`, priority: 'must', cue: location.strong ? 'restriction cue' : 'location mention', source: location.excerpt });
  }
  if (timezone !== undefined) {
    requirements.push({ id: 'timezone', kind: 'timezone', label: `Working hours overlap with ${timezone.label}`, priority: 'must', cue: 'timezone mention', source: timezone.excerpt });
  }
  return {
    title: job.title,
    wordCount: wordCount(job.body),
    requirements,
    budget: extractBudget(sentences),
    duration: extractDuration(sentences),
    attachments: extractAttachments(sentences),
    asks: extractClientAsks(sentences),
    locationRestriction: location,
    timezone,
    sentences,
  };
}
