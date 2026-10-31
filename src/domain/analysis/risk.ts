import { placeIncludes } from '../dictionary/geo.js';
import { techById } from '../dictionary/tech.js';
import type { Config } from '../config/config.js';
import type { FactBase } from '../facts/fact-base.js';
import type { JobPosting } from '../job/posting.js';
import type { JobSpec } from '../job/spec.js';
import { findContactDetails } from '../policy/contact.js';
import { AUTOMATION_DIRECTIVES, SCREENING_INSTRUCTIONS } from '../policy/phrases.js';
import { splitSentences, truncate } from '../shared/text.js';
import { declaredCountry, declaredTimezone, zoneGap, type CoverageRow } from './coverage.js';
import type { RateGuidance } from './rate.js';

export type Severity = 'info' | 'warn' | 'hard';

export interface RiskRule {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  /** Why the flag exists. */
  readonly rationale: string;
  /** When the flag fires although the post is fine. Every flag is a prompt for human review, not a verdict. */
  readonly falsePositives: string;
}

export interface RiskFlag {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  readonly excerpt?: string;
}

export interface RiskContext {
  readonly job: JobPosting;
  readonly spec: JobSpec;
  readonly coverage: readonly CoverageRow[];
  readonly facts: FactBase;
  readonly rate: RateGuidance;
  readonly config: Config;
}

export const RISK_RULES: readonly RiskRule[] = [
  {
    id: 'credentials-request',
    severity: 'hard',
    title: 'Asks for credentials, wallet access or account access',
    rationale: 'No legitimate engagement needs your passwords, seed phrases, one-time codes, remote control of your computer or the use of your accounts before or instead of a contract. This is the signature of account-takeover and crypto-draining scams.',
    falsePositives: 'A security-focused post that mentions "private key management" is not matched (a sharing verb is required), but a post that says "send your password hash for review" would be. Read the excerpt.',
  },
  {
    id: 'free-work',
    severity: 'hard',
    title: 'Asks for free or unpaid work',
    rationale: 'Unpaid test projects, free samples and "trial" work for a stranger transfer all the risk to you and are a common way to collect finished work without paying.',
    falsePositives: 'Negated phrases ("no free work expected") and paid trials ("paid test task") are skipped. A short, clearly bounded screening exercise described as unpaid may still be acceptable to you.',
  },
  {
    id: 'location-excluded',
    severity: 'hard',
    title: 'Location restriction excludes your declared location',
    rationale: 'Posts that say "US only" or "must be located in ..." are often enforced by tax, legal or contract rules. Applying wastes a bid and your time. Severity follows the wording: hard for firm restrictions ("only", "must be located in", residents, exclusions), warning for weaker wording ("based in"), info for mere preferences.',
    falsePositives: 'Posts that describe the company ("we are a US-based team looking for a developer") can read like a restriction. Weak cues are reported as warnings, preferences as info. Some clients waive the restriction for strong candidates.',
  },
  {
    id: 'off-platform',
    severity: 'warn',
    title: 'Moves the conversation off the platform or asks for contact details early',
    rationale: 'Moving to a messenger or private email before a contract exists removes the marketplace protections (payment protection, dispute handling) and is the usual first step of advance-fee and overpayment scams.',
    falsePositives: 'Some clients put an application email or a company chat in the post for legitimate reasons. Direct contact after a contract is signed is normal.',
  },
  {
    id: 'video-intro-required',
    severity: 'warn',
    title: 'Requires a video introduction',
    rationale: 'A recorded video is time you spend before any commitment, and it exposes your face and voice to someone you have not vetted. It is also a cue that the post expects many applicants.',
    falsePositives: 'Phrases like "optional video intro" are skipped. Some clients genuinely hire on communication skills and a short video is reasonable.',
  },
  {
    id: 'urgency-pressure',
    severity: 'warn',
    title: 'Urgency or pressure to start immediately',
    rationale: 'Deadlines that leave no time to ask questions correlate with unclear scope, unpaid overtime and scams that rely on skipping verification.',
    falsePositives: 'A real production incident or a launch date is legitimately urgent. "No rush" is skipped.',
  },
  {
    id: 'client-payment-unverified',
    severity: 'warn',
    title: 'Client payment method is not verified',
    rationale: 'Without a verified payment method there is no evidence the client can pay. Needs the metadata block (payment-verified: no).',
    falsePositives: 'New but honest clients start unverified. Ask the client to verify before you start any work.',
  },
  {
    id: 'many-proposals',
    severity: 'warn',
    title: 'Many proposals already submitted',
    rationale: 'A listing with many proposals is a lottery: your chance of a reply drops and the client has probably shortlisted already. Needs the metadata block (proposals: N); the threshold is in the configuration.',
    falsePositives: 'A large number can come from a very broad post that will hire several people.',
  },
  {
    id: 'stack-mismatch',
    severity: 'warn',
    title: 'None of the required technologies is covered by your facts',
    rationale: 'When no must-have technology is covered, even partially, the post is for a different profile than yours, whatever the keywords say.',
    falsePositives: 'Your fact base may simply be incomplete: add facts for what you really do. Dictionary gaps (a technology the tool does not know) also count as uncovered.',
  },
  {
    id: 'unrealistic-scope',
    severity: 'warn',
    title: 'Scope looks unrealistic',
    rationale: 'Many unrelated technology families, a very short deadline for a long must-have list, or "build an app like X" posts usually mean a budget and a timeline that do not match the work.',
    falsePositives: 'A senior generalist role can legitimately span families. Read the post for what is actually deliverable.',
  },
  {
    id: 'budget-below-floor',
    severity: 'warn',
    title: 'Budget is below your declared rate floor',
    rationale: 'The client\'s stated maximum cannot meet the rate floor you declared in your facts. Needs a rate fact in the same currency.',
    falsePositives: 'Budgets in posts are often opening offers. If you are willing to negotiate, the flag is only a reminder.',
  },
  {
    id: 'low-budget',
    severity: 'warn',
    title: 'Fixed budget is very low for the scope',
    rationale: 'A fixed budget that covers fewer hours (at your floor) than the scope implies (hours per must-have technology, set in the configuration) means you would work below your rate.',
    falsePositives: 'The hours estimate is a crude heuristic. A small, well-bounded task with several technologies can need fewer hours.',
  },
  {
    id: 'timezone-gap',
    severity: 'warn',
    title: 'Required working hours are far from your timezone',
    rationale: 'Required overlap with a timezone more than the configured number of hours from yours means regular night work.',
    falsePositives: 'Posts often say "overlap with EST" loosely, and many clients accept partial overlap.',
  },
  {
    id: 'hidden-characters',
    severity: 'warn',
    title: 'Post contains hidden or control characters',
    rationale: 'Zero-width, bidirectional and control characters can hide text from a reader or reorder what you see. They were removed before analysis.',
    falsePositives: 'Copy and paste from web pages and chat tools sometimes leaves zero-width spaces behind.',
  },
  {
    id: 'automation-directives',
    severity: 'warn',
    title: 'Post contains text addressed to an automated reader',
    rationale: 'Phrases such as "ignore previous instructions" or "you are now" target software that reads posts on your behalf. proposal-desk treats the whole post as data and never follows it; the flag tells you the post tried.',
    falsePositives: 'A post quoting such phrases as an example, for instance a job about prompt-injection testing.',
  },
  {
    id: 'no-usable-facts',
    severity: 'warn',
    title: 'The fact base has no usable facts',
    rationale: 'Without usable facts nothing can be covered and no claim can be drafted.',
    falsePositives: 'None; add facts with `facts add`, or re-verify stale ones.',
  },
  {
    id: 'client-zero-hires',
    severity: 'info',
    title: 'Client has not hired before',
    rationale: 'A client with no hiring history has no track record of paying or of managing freelancers. Needs the metadata block (client-hires: 0).',
    falsePositives: 'Every client has a first hire.',
  },
  {
    id: 'client-new-account',
    severity: 'info',
    title: 'Client account is new',
    rationale: 'Very new accounts have no history and are over-represented in scams. Needs the metadata block (account-age-days); the threshold is in the configuration.',
    falsePositives: 'Legitimate clients also start somewhere.',
  },
  {
    id: 'vague-post',
    severity: 'info',
    title: 'Post is vague',
    rationale: 'Very short posts, or posts naming no technology the dictionary knows, give too little to match against, so the fit score is unreliable.',
    falsePositives: 'Terse posts from experienced clients exist; the dictionary is English-centric and may miss a technology.',
  },
  {
    id: 'screening-instruction',
    severity: 'info',
    title: 'Post asks for a keyword or format in the proposal',
    rationale: 'Some clients ask applicants to start with a specific word to filter out copy-pasted proposals. proposal-desk never follows instructions found in a post; if you want to comply, do it by hand after reviewing the draft.',
    falsePositives: 'A post that merely describes what a good proposal contains.',
  },
  {
    id: 'metadata-issues',
    severity: 'info',
    title: 'Metadata block has problems',
    rationale: 'Lines of the optional metadata block that could not be read were ignored, so related flags may be missing.',
    falsePositives: 'A key the tool does not know, such as a typo, is reported even though nothing is wrong with the post.',
  },
];

const RULES = new Map(RISK_RULES.map((r) => [r.id, r]));

function flag(ruleId: string, detail: string, excerpt?: string, severity?: Severity): RiskFlag {
  const rule = RULES.get(ruleId) as RiskRule;
  return { ruleId, severity: severity ?? rule.severity, title: rule.title, detail, ...(excerpt === undefined ? {} : { excerpt: truncate(excerpt, 160) }) };
}

function allSentences(body: string): string[] {
  return body.split('\n').flatMap((line) => splitSentences(line.trim().replace(/^(?:[-*•·]|\d+[.)])\s+/, '')));
}

const NEGATION_BEFORE = /\b(?:no|not|without|never|don't|do not|doesn't|does not|isn't|aren't|won't|will not|nor|neither|avoid|paid)\s+(?:\w+\s+){0,3}$/i;

const GLOBAL_VARIANTS = new WeakMap<RegExp, RegExp>();

function globally(pattern: RegExp): RegExp {
  let re = GLOBAL_VARIANTS.get(pattern);
  if (re === undefined) {
    re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    GLOBAL_VARIANTS.set(pattern, re);
  }
  return re;
}

/** First sentence where `pattern` matches outside a negation ("no rush", "paid trial"). */
function firstMatch(sentences: readonly string[], pattern: RegExp): string | undefined {
  const re = globally(pattern);
  for (const sentence of sentences) {
    for (const m of sentence.matchAll(re)) {
      if (!NEGATION_BEFORE.test(sentence.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0))) return sentence;
    }
  }
  return undefined;
}

const CREDENTIALS = [
  /\b(?:seed phrase|recovery phrase|mnemonic phrase|secret recovery)\b/i,
  /\b(?:share|send|give|provide|submit|hand over|need|require)\b[^.]{0,40}\b(?:password|passcode|credentials|login details|otp|one[- ]time (?:code|password)|2fa|verification code|ssn|social security|bank (?:account|details|login)|card number|cvv|passport|private key|secret key)\b/i,
  /\b(?:access|login|log in|sign in) (?:to|into) (?:my|your|our|the) (?:wallet|bank|exchange|paypal|binance|coinbase|metamask)\b/i,
  /\bwallet (?:access|password|login)\b/i,
  /\b(?:remote (?:access|desktop|control)|anydesk|teamviewer|ultraviewer)\b/i,
  /\binstall (?:this|the|my) (?:software|app|extension|program|plugin|tool) (?:on your|to your)\b/i,
  /\b(?:use|share|lend|rent|borrow|sell)\b[^.]{0,20}\b(?:your|an?|my) (?:account|profile|identity)\b/i,
  /\b(?:buy|purchase)\b[^.]{0,20}\bgift cards?\b/i,
];
const FREE_WORK = [
  /\b(?:free|unpaid) (?:test|trial|sample|work|task|project|mock-?up|design|demo|prototype|week)\b/i,
  /\bwork for free\b|\bwithout (?:any )?pay(?:ment)?\b|\bfor exposure\b/i,
  /\btrial (?:project|period|task|work)\b[^.]{0,30}\b(?:unpaid|free|not paid)\b/i,
  /\b(?:build|create|make|deliver|complete)\b[^.]{0,40}\b(?:demo|prototype|sample|mock-?up|test project)\b[^.]{0,40}\b(?:before|prior to)\b[^.]{0,20}\b(?:hir|award|contract|payment)/i,
];
const OFF_PLATFORM = [
  /\b(?:outside (?:of )?(?:the )?(?:platform|site|marketplace|app|website)|off[- ]platform|pay (?:you )?(?:directly|outside))\b/i,
  /\b(?:move|switch|continue|take)\b[^.]{0,30}\b(?:to|on|over to)\b[^.]{0,15}\b(?:whatsapp|telegram|skype|discord|signal|wechat|viber|zalo|email|e-mail)\b/i,
  /\b(?:contact|reach|message|text|call|add|dm) me\b[^.]{0,20}\b(?:on|at|via|through)\b/i,
  /\b(?:send|share|give|provide)\b[^.]{0,20}\b(?:your |ur )?(?:email|e-mail|phone(?: number)?|whatsapp|telegram|skype|contact (?:details|info|information))\b/i,
  /\b(?:email|e-mail|dm|whatsapp|telegram|skype) me\b/i,
];
const URGENCY = /\b(?:asap|urgent(?:ly)?|immediately|right now|as soon as possible|within (?:24|48) hours|by tomorrow|start (?:today|now|immediately|right away)|(?:needed|need it|need this) (?:today|tonight|now)|deadline (?:is )?(?:tomorrow|today|tonight)|rush)\b/i;
const CLONE = /\b(?:like|similar to|clone of|copy of)\s+(?:uber|airbnb|facebook|instagram|tiktok|netflix|amazon|whatsapp|tinder|twitter|youtube|spotify|shopify|binance)\b/i;
const NON_STACK_FAMILIES = new Set(['api', 'architecture', 'process', 'testing', 'security', 'performance', 'tooling']);

type Detector = (ctx: RiskContext, sentences: readonly string[]) => RiskFlag[];

const DETECTORS: Readonly<Record<string, Detector>> = {
  'credentials-request': (_ctx, sentences) => {
    for (const pattern of CREDENTIALS) {
      const hit = firstMatch(sentences, pattern);
      if (hit !== undefined) return [flag('credentials-request', 'Never share credentials, seed phrases, codes or remote access. Treat this post as hostile.', hit)];
    }
    return [];
  },
  'free-work': (_ctx, sentences) => {
    for (const pattern of FREE_WORK) {
      const hit = firstMatch(sentences, pattern);
      if (hit !== undefined) return [flag('free-work', 'The post asks for work before any payment.', hit)];
    }
    return [];
  },
  'location-excluded': ({ spec, facts }) => {
    const restriction = spec.locationRestriction;
    if (restriction === undefined) return [];
    const mine = declaredCountry(facts);
    if (mine === undefined || mine.place === undefined) {
      return restriction.strong
        ? [flag('location-excluded', `The post restricts location (${restriction.places.join(', ')}) but your facts have no known-country location to compare.`, restriction.excerpt, 'info')]
        : [];
    }
    const inside = restriction.places.some((p) => placeIncludes(p, mine.place as string));
    const excluded = restriction.mode === 'excluding' ? inside : !inside;
    if (!excluded) return [];
    const severity: Severity = restriction.mode === 'preferred' ? 'info' : restriction.strong ? 'hard' : 'warn';
    return [flag('location-excluded', `Your declared location (${mine.text}, ${mine.factId}) is outside the stated ${restriction.mode === 'preferred' ? 'preference' : 'restriction'}: ${restriction.places.join(', ')}.`, restriction.excerpt, severity)];
  },
  'off-platform': ({ job }, sentences) => {
    for (const pattern of OFF_PLATFORM) {
      const hit = firstMatch(sentences, pattern);
      if (hit !== undefined) return [flag('off-platform', 'The post tries to move you off the platform or collect contact details.', hit)];
    }
    const contact = findContactDetails(job.body).find((f) => f.kind !== 'link');
    return contact === undefined ? [] : [flag('off-platform', `The post contains a ${contact.kind}; contact details in a listing invite you to leave the platform.`, contact.excerpt)];
  },
  'video-intro-required': ({ spec }) => {
    const hit = spec.attachments.find((a) => a.kind === 'video');
    if (hit === undefined || /\b(?:optional|if you like|if you want|not required|not mandatory|no need)\b/i.test(hit.excerpt)) return [];
    return [flag('video-intro-required', 'Recording a video is unpaid effort before any commitment.', hit.excerpt)];
  },
  'urgency-pressure': (_ctx, sentences) => {
    const hit = firstMatch(sentences, URGENCY);
    return hit === undefined ? [] : [flag('urgency-pressure', 'Pressure to move fast is a reason to slow down and ask questions.', hit)];
  },
  'client-payment-unverified': ({ job }) =>
    job.metadata.paymentVerified === false ? [flag('client-payment-unverified', 'Metadata says payment is not verified. Ask for verification before starting.')] : [],
  'many-proposals': ({ job, config }) =>
    job.metadata.proposals !== undefined && job.metadata.proposals >= config.risk.manyProposals
      ? [flag('many-proposals', `${job.metadata.proposals} proposals already; threshold ${config.risk.manyProposals} (configuration risk.manyProposals).`)]
      : [],
  'stack-mismatch': ({ coverage, facts }) => {
    const musts = coverage.filter((r) => r.kind === 'tech' && r.priority === 'must');
    if (musts.length === 0 || facts.usable().length === 0) return [];
    return musts.every((r) => r.status === 'uncovered') ? [flag('stack-mismatch', `None of the ${musts.length} required technologies is covered: ${musts.map((r) => r.label).join(', ')}.`)] : [];
  },
  'unrealistic-scope': ({ spec, config }) => {
    const musts = spec.requirements.filter((r) => r.kind === 'tech' && r.priority === 'must');
    const families = new Set(musts.map((r) => techById(r.techId as string)?.family).filter((f): f is string => f !== undefined && !NON_STACK_FAMILIES.has(f)));
    const reasons: string[] = [];
    if (families.size >= config.risk.maxMustTechFamilies) reasons.push(`${families.size} unrelated technology families are required (limit ${config.risk.maxMustTechFamilies})`);
    if (spec.duration !== undefined && spec.duration.maxDays <= config.risk.unrealisticScopeDays && musts.length >= config.risk.unrealisticScopeMusts) {
      reasons.push(`${musts.length} required technologies in ${spec.duration.maxDays} days or less`);
    }
    const clone = spec.sentences.find((s) => CLONE.test(s.text));
    if (clone !== undefined) reasons.push('asks for a clone of a large product');
    return reasons.length === 0 ? [] : [flag('unrealistic-scope', `${reasons.join('; ')}.`, clone?.text)];
  },
  'budget-below-floor': ({ rate }) =>
    rate.belowFloor && rate.floor !== undefined ? [flag('budget-below-floor', `The client's maximum is below your floor of ${rate.floor.amount} ${rate.floor.currency} per ${rate.floor.unit}.`)] : [],
  'low-budget': ({ rate }) =>
    rate.lowBudget ? [flag('low-budget', `The fixed budget covers about ${rate.hoursCovered ?? 0} hours at your floor, fewer than the scope implies.`)] : [],
  'timezone-gap': ({ spec, facts, config }) => {
    const mine = declaredTimezone(facts);
    if (spec.timezone === undefined || mine === undefined) return [];
    const gap = zoneGap(mine.offset, spec.timezone.offset);
    return gap > config.risk.maxTimezoneGapHours ? [flag('timezone-gap', `${spec.timezone.label} is ${gap} hours from your timezone (limit ${config.risk.maxTimezoneGapHours}).`, spec.timezone.excerpt)] : [];
  },
  'hidden-characters': ({ job }) =>
    job.hiddenCharacters > 0 ? [flag('hidden-characters', `${job.hiddenCharacters} hidden or control characters were removed before analysis.`)] : [],
  'automation-directives': (_ctx, sentences) => {
    for (const pattern of AUTOMATION_DIRECTIVES) {
      const hit = sentences.find((s) => pattern.test(s));
      if (hit !== undefined) return [flag('automation-directives', 'The post is addressed to an automated reader. It was analysed as data and not followed.', hit)];
    }
    return [];
  },
  'no-usable-facts': ({ facts }) => (facts.usable().length === 0 ? [flag('no-usable-facts', `${facts.facts.length} facts loaded, none usable in a proposal.`)] : []),
  'client-zero-hires': ({ job }) => (job.metadata.clientHires === 0 ? [flag('client-zero-hires', 'Metadata says the client has made no hires yet.')] : []),
  'client-new-account': ({ job, config }) =>
    job.metadata.accountAgeDays !== undefined && job.metadata.accountAgeDays < config.risk.newAccountDays
      ? [flag('client-new-account', `Account is ${job.metadata.accountAgeDays} days old; threshold ${config.risk.newAccountDays} days.`)]
      : [],
  'vague-post': ({ spec, config }) => {
    if (spec.wordCount < config.risk.vaguePostMinWords) return [flag('vague-post', `Only ${spec.wordCount} words (minimum ${config.risk.vaguePostMinWords}); the match below is unreliable.`)];
    const recognised = spec.requirements.some((r) => r.kind === 'tech' || r.kind === 'experience');
    return recognised ? [] : [flag('vague-post', 'No technology or experience requirement was recognised; the match below is unreliable.')];
  },
  'screening-instruction': (_ctx, sentences) => {
    for (const pattern of SCREENING_INSTRUCTIONS) {
      const hit = sentences.find((s) => pattern.test(s));
      if (hit !== undefined) return [flag('screening-instruction', 'The post asks for a specific word or format. It was not followed; do it by hand if you choose.', hit)];
    }
    return [];
  },
  'metadata-issues': ({ job }) => (job.metadataIssues.length > 0 ? [flag('metadata-issues', job.metadataIssues.join('; '))] : []),
};

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { hard: 0, warn: 1, info: 2 };

/** Runs every rule. Flags never block anything by themselves: they are listed in the report, hard ones first. */
export function detectRisks(ctx: RiskContext): RiskFlag[] {
  const sentences = allSentences(ctx.job.body);
  const flags = RISK_RULES.flatMap((rule) => (DETECTORS[rule.id] as Detector)(ctx, sentences));
  return flags
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
    .map(({ f }) => f);
}
