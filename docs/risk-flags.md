# Risk flags

Every flag is deterministic: it comes from a documented pattern or a number in the post, the optional
metadata block or your facts. Flags never block anything silently. They are listed in the report, hard
ones first, and they feed the fit score and the recommendation (see [scoring](scoring.md)).

A flag is a prompt for human review, not a verdict. Each rule below says why it exists and when it
fires although the post is fine. Severity penalties and thresholds are in the configuration
(`proposal-desk config show`), not in the code.

| Severity | Meaning |
| --- | --- |
| Hard warning | The recommendation becomes `skip` while it stands. Always shown first. |
| Warning | Counts against the fit score and prevents a plain `apply` recommendation. |
| Info | Small penalty; context worth knowing. |

## `credentials-request`

**Asks for credentials, wallet access or account access** (Hard warning)

- Why: No legitimate engagement needs your passwords, seed phrases, one-time codes, remote control of your computer or the use of your accounts before or instead of a contract. This is the signature of account-takeover and crypto-draining scams.
- False positives: A security-focused post that mentions "private key management" is not matched (a sharing verb is required), but a post that says "send your password hash for review" would be. Read the excerpt.

## `free-work`

**Asks for free or unpaid work** (Hard warning)

- Why: Unpaid test projects, free samples and "trial" work for a stranger transfer all the risk to you and are a common way to collect finished work without paying.
- False positives: Negated phrases ("no free work expected") and paid trials ("paid test task") are skipped. A short, clearly bounded screening exercise described as unpaid may still be acceptable to you.

## `location-excluded`

**Location restriction excludes your declared location** (Hard warning)

- Why: Posts that say "US only" or "must be located in ..." are often enforced by tax, legal or contract rules. Applying wastes a bid and your time. Severity follows the wording: hard for firm restrictions ("only", "must be located in", residents, exclusions), warning for weaker wording ("based in"), info for mere preferences.
- False positives: Posts that describe the company ("we are a US-based team looking for a developer") can read like a restriction. Weak cues are reported as warnings, preferences as info. Some clients waive the restriction for strong candidates.

## `off-platform`

**Moves the conversation off the platform or asks for contact details early** (Warning)

- Why: Moving to a messenger or private email before a contract exists removes the marketplace protections (payment protection, dispute handling) and is the usual first step of advance-fee and overpayment scams.
- False positives: Some clients put an application email or a company chat in the post for legitimate reasons. Direct contact after a contract is signed is normal.

## `video-intro-required`

**Requires a video introduction** (Warning)

- Why: A recorded video is time you spend before any commitment, and it exposes your face and voice to someone you have not vetted. It is also a cue that the post expects many applicants.
- False positives: Phrases like "optional video intro" are skipped. Some clients genuinely hire on communication skills and a short video is reasonable.

## `urgency-pressure`

**Urgency or pressure to start immediately** (Warning)

- Why: Deadlines that leave no time to ask questions correlate with unclear scope, unpaid overtime and scams that rely on skipping verification.
- False positives: A real production incident or a launch date is legitimately urgent. "No rush" is skipped.

## `client-payment-unverified`

**Client payment method is not verified** (Warning)

- Why: Without a verified payment method there is no evidence the client can pay. Needs the metadata block (payment-verified: no).
- False positives: New but honest clients start unverified. Ask the client to verify before you start any work.

## `many-proposals`

**Many proposals already submitted** (Warning)

- Why: A listing with many proposals is a lottery: your chance of a reply drops and the client has probably shortlisted already. Needs the metadata block (proposals: N); the threshold is in the configuration.
- False positives: A large number can come from a very broad post that will hire several people.

## `stack-mismatch`

**None of the required technologies is covered by your facts** (Warning)

- Why: When no must-have technology is covered, even partially, the post is for a different profile than yours, whatever the keywords say.
- False positives: Your fact base may simply be incomplete: add facts for what you really do. Dictionary gaps (a technology the tool does not know) also count as uncovered.

## `unrealistic-scope`

**Scope looks unrealistic** (Warning)

- Why: Many unrelated technology families, a very short deadline for a long must-have list, or "build an app like X" posts usually mean a budget and a timeline that do not match the work.
- False positives: A senior generalist role can legitimately span families. Read the post for what is actually deliverable.

## `budget-below-floor`

**Budget is below your declared rate floor** (Warning)

- Why: The client's stated maximum cannot meet the rate floor you declared in your facts. Needs a rate fact in the same currency.
- False positives: Budgets in posts are often opening offers. If you are willing to negotiate, the flag is only a reminder.

## `low-budget`

**Fixed budget is very low for the scope** (Warning)

- Why: A fixed budget that covers fewer hours (at your floor) than the scope implies (hours per must-have technology, set in the configuration) means you would work below your rate.
- False positives: The hours estimate is a crude heuristic. A small, well-bounded task with several technologies can need fewer hours.

## `timezone-gap`

**Required working hours are far from your timezone** (Warning)

- Why: Required overlap with a timezone more than the configured number of hours from yours means regular night work.
- False positives: Posts often say "overlap with EST" loosely, and many clients accept partial overlap.

## `hidden-characters`

**Post contains hidden or control characters** (Warning)

- Why: Zero-width, bidirectional and control characters can hide text from a reader or reorder what you see. They were removed before analysis.
- False positives: Copy and paste from web pages and chat tools sometimes leaves zero-width spaces behind.

## `automation-directives`

**Post contains text addressed to an automated reader** (Warning)

- Why: Phrases such as "ignore previous instructions" or "you are now" target software that reads posts on your behalf. proposal-desk treats the whole post as data and never follows it; the flag tells you the post tried.
- False positives: A post quoting such phrases as an example, for instance a job about prompt-injection testing.

## `no-usable-facts`

**The fact base has no usable facts** (Warning)

- Why: Without usable facts nothing can be covered and no claim can be drafted.
- False positives: None; add facts with `facts add`, or re-verify stale ones.

## `client-zero-hires`

**Client has not hired before** (Info)

- Why: A client with no hiring history has no track record of paying or of managing freelancers. Needs the metadata block (client-hires: 0).
- False positives: Every client has a first hire.

## `client-new-account`

**Client account is new** (Info)

- Why: Very new accounts have no history and are over-represented in scams. Needs the metadata block (account-age-days); the threshold is in the configuration.
- False positives: Legitimate clients also start somewhere.

## `vague-post`

**Post is vague** (Info)

- Why: Very short posts, or posts naming no technology the dictionary knows, give too little to match against, so the fit score is unreliable.
- False positives: Terse posts from experienced clients exist; the dictionary is English-centric and may miss a technology.

## `screening-instruction`

**Post asks for a keyword or format in the proposal** (Info)

- Why: Some clients ask applicants to start with a specific word to filter out copy-pasted proposals. proposal-desk never follows instructions found in a post; if you want to comply, do it by hand after reviewing the draft.
- False positives: A post that merely describes what a good proposal contains.

## `metadata-issues`

**Metadata block has problems** (Info)

- Why: Lines of the optional metadata block that could not be read were ignored, so related flags may be missing.
- False positives: A key the tool does not know, such as a typo, is reported even though nothing is wrong with the post.

## Text handling

The post is treated as untrusted data. Control characters, bidirectional overrides and zero-width
characters are removed before matching (and reported as `hidden-characters`), phrases are matched
with word boundaries, and negations such as "no rush" or "paid trial" are skipped for the rules that
need it. Nothing in the post is ever executed, followed or copied into a draft as an instruction.
