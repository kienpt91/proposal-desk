// Maintained technology dictionary. Job posts and fact claims are mapped onto these canonical ids,
// so "k8s", "Kubernetes" and "kubernetes cluster" are the same requirement. To add a technology,
// add one line to `ENTRIES`; tests assert that ids and synonyms stay unique.
//
//   implies  – a fact about this technology fully covers the listed ones (TypeScript implies JavaScript)
//   related  – a fact about one of the listed technologies only partially covers this one
//   patterns – case-sensitive regular expressions for names that collide with English words

export type TechKind = 'language' | 'framework' | 'library' | 'database' | 'cloud' | 'tool' | 'platform' | 'practice';

export interface TechEntry {
  readonly id: string;
  readonly label: string;
  readonly kind: TechKind;
  readonly family: string;
  readonly synonyms: readonly string[];
  readonly implies: readonly string[];
  readonly related: readonly string[];
  readonly patterns: readonly string[];
}

interface Extra {
  readonly implies?: readonly string[];
  readonly related?: readonly string[];
  readonly patterns?: readonly string[];
}

function t(
  id: string,
  label: string,
  kind: TechKind,
  family: string,
  synonyms: readonly string[],
  extra: Extra = {},
): TechEntry {
  return {
    id,
    label,
    kind,
    family,
    synonyms,
    implies: extra.implies ?? [],
    related: extra.related ?? [],
    patterns: extra.patterns ?? [],
  };
}

const ENTRIES: readonly TechEntry[] = [
  // languages
  t('javascript', 'JavaScript', 'language', 'javascript', ['javascript', 'ecmascript', 'es6', 'vanilla js'], { related: ['typescript'] }),
  t('typescript', 'TypeScript', 'language', 'javascript', ['typescript'], { implies: ['javascript'] }),
  t('python', 'Python', 'language', 'python', ['python', 'python3', 'py3']),
  t('java', 'Java', 'language', 'jvm', ['java', 'java 17', 'java 21', 'jdk'], { related: ['kotlin', 'spring'] }),
  t('kotlin', 'Kotlin', 'language', 'jvm', ['kotlin'], { related: ['java'] }),
  t('scala', 'Scala', 'language', 'jvm', ['scala']),
  t('csharp', 'C#', 'language', 'dotnet', ['c#', 'c sharp', 'csharp']),
  t('dotnet', '.NET', 'framework', 'dotnet', ['.net', 'dotnet', 'asp.net', 'asp.net core'], { related: ['csharp'] }),
  t('cpp', 'C++', 'language', 'systems', ['c++', 'cpp', 'modern c++']),
  t('c', 'C', 'language', 'systems', ['c programming', 'c language', 'embedded c'], { related: ['cpp'] }),
  t('go', 'Go', 'language', 'go', ['golang', 'go lang'], {
    patterns: [
      '\\bGo\\b(?=\\s+(?:developer|engineer|programmer|backend|services|microservices|language))',
      '(?<=\\b(?:in|with|using|of|and|or|via)\\s)Go\\b(?!\\s+(?:to|for|ahead|live|home|back|on|through|beyond|get))',
      '(?<=[(/,]\\s?)Go(?=\\s*[/,)])',
    ],
  }),
  t('rust', 'Rust', 'language', 'rust', ['rust lang', 'rustlang'], { patterns: ['\\bRust\\b(?!\\s+(?:belt|bucket|proof|remover))'] }),
  t('php', 'PHP', 'language', 'php', ['php', 'php8'], { related: ['laravel'] }),
  t('ruby', 'Ruby', 'language', 'ruby', ['ruby'], { related: ['rails'] }),
  t('swift', 'Swift', 'language', 'mobile', ['swiftui', 'swift programming', 'swift developer', 'swift ios']),
  t('dart', 'Dart', 'language', 'mobile', ['dart'], { related: ['flutter'] }),
  t('sql', 'SQL', 'language', 'database', ['sql', 'sql queries', 't-sql', 'pl/sql']),
  t('html', 'HTML', 'language', 'frontend', ['html', 'html5']),
  t('css', 'CSS', 'language', 'frontend', ['css', 'css3', 'scss', 'sass']),
  t('bash', 'Bash', 'language', 'devops', ['bash', 'shell scripting', 'shell scripts']),
  t('solidity', 'Solidity', 'language', 'web3', ['solidity'], { related: ['ethereum'] }),
  // frontend
  t('react', 'React', 'framework', 'javascript', ['react', 'reactjs', 'react.js'], { related: ['javascript', 'typescript', 'nextjs'] }),
  t('nextjs', 'Next.js', 'framework', 'javascript', ['next.js', 'nextjs', 'next js'], { implies: [], related: ['react', 'typescript'] }),
  t('vue', 'Vue', 'framework', 'javascript', ['vue', 'vuejs', 'vue.js', 'vue 3', 'nuxt', 'nuxt.js'], { related: ['javascript', 'typescript'] }),
  t('angular', 'Angular', 'framework', 'javascript', ['angular', 'angularjs', 'angular.js'], { related: ['typescript'] }),
  t('svelte', 'Svelte', 'framework', 'javascript', ['svelte', 'sveltekit'], { related: ['javascript', 'typescript'] }),
  t('tailwind', 'Tailwind CSS', 'framework', 'frontend', ['tailwind', 'tailwindcss', 'tailwind css'], { related: ['css'] }),
  t('redux', 'Redux', 'library', 'javascript', ['redux', 'redux toolkit'], { related: ['react'] }),
  t('webpack', 'Webpack', 'tool', 'javascript', ['webpack', 'vite', 'rollup', 'esbuild']),
  // backend
  t('nodejs', 'Node.js', 'platform', 'javascript', ['node.js', 'nodejs', 'node js'], { related: ['javascript', 'typescript'] }),
  t('express', 'Express', 'framework', 'javascript', ['express.js', 'expressjs', 'express js', 'node express'], { related: ['nodejs'] }),
  t('nestjs', 'NestJS', 'framework', 'javascript', ['nestjs', 'nest.js'], { related: ['nodejs', 'typescript', 'express'] }),
  t('django', 'Django', 'framework', 'python', ['django', 'django rest framework', 'drf'], { related: ['python'] }),
  t('flask', 'Flask', 'framework', 'python', ['flask'], { related: ['python', 'fastapi'] }),
  t('fastapi', 'FastAPI', 'framework', 'python', ['fastapi', 'fast api'], { related: ['python', 'flask'] }),
  t('spring', 'Spring', 'framework', 'jvm', ['spring boot', 'spring framework', 'spring cloud', 'spring mvc'], { related: ['java', 'kotlin'] }),
  t('laravel', 'Laravel', 'framework', 'php', ['laravel', 'symfony'], { related: ['php'] }),
  t('rails', 'Ruby on Rails', 'framework', 'ruby', ['ruby on rails', 'rails', 'ror'], { related: ['ruby'] }),
  t('graphql', 'GraphQL', 'tool', 'api', ['graphql', 'apollo server', 'apollo client']),
  t('rest', 'REST APIs', 'practice', 'api', ['rest api', 'rest apis', 'restful', 'restful api', 'restful apis', 'rest services', 'api design', 'api development']),
  t('grpc', 'gRPC', 'tool', 'api', ['grpc', 'protobuf', 'protocol buffers']),
  t('websocket', 'WebSockets', 'tool', 'api', ['websocket', 'websockets', 'socket.io', 'real-time messaging']),
  t('microservices', 'Microservices', 'practice', 'architecture', ['microservice', 'microservices', 'service-oriented architecture']),
  // mobile
  t('reactnative', 'React Native', 'framework', 'mobile', ['react native', 'react-native', 'expo'], { related: ['react', 'javascript', 'typescript'] }),
  t('flutter', 'Flutter', 'framework', 'mobile', ['flutter'], { related: ['dart'] }),
  t('ios', 'iOS', 'platform', 'mobile', ['ios', 'iphone app', 'ios app', 'xcode'], { related: ['swift'] }),
  t('android', 'Android', 'platform', 'mobile', ['android', 'android studio', 'android app', 'jetpack compose'], { related: ['kotlin', 'java'] }),
  // databases
  t('postgresql', 'PostgreSQL', 'database', 'database', ['postgresql', 'postgres', 'psql', 'postgis'], { related: ['sql', 'mysql'] }),
  t('mysql', 'MySQL', 'database', 'database', ['mysql', 'mariadb'], { related: ['sql', 'postgresql'] }),
  t('sqlite', 'SQLite', 'database', 'database', ['sqlite', 'sqlite3'], { related: ['sql'] }),
  t('mongodb', 'MongoDB', 'database', 'database', ['mongodb', 'mongo db', 'mongoose'], { related: ['nosql'] }),
  t('redis', 'Redis', 'database', 'database', ['redis', 'memcached']),
  t('nosql', 'NoSQL', 'database', 'database', ['nosql', 'dynamodb', 'cassandra', 'couchdb', 'firestore']),
  t('elasticsearch', 'Elasticsearch', 'database', 'database', ['elasticsearch', 'opensearch', 'elk stack']),
  t('kafka', 'Kafka', 'tool', 'data', ['kafka', 'rabbitmq', 'message queue', 'message queues', 'sqs']),
  // cloud and devops
  t('aws', 'AWS', 'cloud', 'cloud', ['aws', 'amazon web services', 'ec2', 'lambda functions', 's3 bucket', 'cloudformation']),
  t('gcp', 'Google Cloud', 'cloud', 'cloud', ['gcp', 'google cloud', 'google cloud platform', 'bigquery', 'cloud run'], { related: ['aws', 'azure'] }),
  t('azure', 'Azure', 'cloud', 'cloud', ['azure', 'microsoft azure', 'azure devops'], { related: ['aws', 'gcp'] }),
  t('cloudflare', 'Cloudflare', 'cloud', 'cloud', ['cloudflare', 'cloudflare workers', 'cloudflare pages', 'workers kv']),
  t('docker', 'Docker', 'tool', 'devops', ['docker', 'dockerfile', 'docker compose', 'containers', 'containerization']),
  t('kubernetes', 'Kubernetes', 'tool', 'devops', ['kubernetes', 'k8s', 'helm', 'eks', 'gke'], { related: ['docker'] }),
  t('terraform', 'Terraform', 'tool', 'devops', ['terraform', 'infrastructure as code', 'pulumi', 'ansible'], { related: ['aws'] }),
  t('cicd', 'CI/CD', 'practice', 'devops', ['ci/cd', 'cicd', 'ci cd', 'continuous integration', 'continuous delivery', 'github actions', 'gitlab ci', 'jenkins', 'circleci']),
  t('linux', 'Linux', 'platform', 'devops', ['linux', 'ubuntu server', 'debian', 'sysadmin', 'system administration']),
  t('nginx', 'Nginx', 'tool', 'devops', ['nginx', 'apache httpd', 'haproxy', 'reverse proxy']),
  t('git', 'Git', 'tool', 'tooling', ['git', 'version control']),
  // data and ml
  t('pandas', 'pandas', 'library', 'data', ['pandas', 'numpy', 'data wrangling'], { related: ['python'] }),
  t('dataengineering', 'Data engineering', 'practice', 'data', ['etl', 'elt', 'data pipeline', 'data pipelines', 'airflow', 'dbt', 'spark', 'data warehouse'], { related: ['sql', 'python'] }),
  t('ml', 'Machine learning', 'practice', 'ml', ['machine learning', 'deep learning', 'tensorflow', 'pytorch', 'scikit-learn', 'sklearn', 'neural network', 'neural networks'], { related: ['python'] }),
  t('llm', 'LLM applications', 'practice', 'ml', ['llm', 'llms', 'large language model', 'large language models', 'rag pipeline', 'prompt engineering', 'vector database', 'embeddings'], { related: ['python', 'ml'] }),
  t('nlp', 'NLP', 'practice', 'ml', ['nlp', 'natural language processing', 'text classification'], { related: ['ml', 'python'] }),
  t('scraping', 'Web scraping', 'practice', 'data', ['web scraping', 'scraper', 'scrapers', 'scrapy', 'puppeteer', 'playwright scraping', 'crawler', 'crawlers'], { related: ['python', 'nodejs'] }),
  t('dataviz', 'Data visualization', 'practice', 'data', ['data visualization', 'tableau', 'power bi', 'd3.js'], { related: ['sql'] }),
  // cms, commerce, design
  t('wordpress', 'WordPress', 'platform', 'cms', ['wordpress', 'wp plugin', 'wp theme', 'elementor'], { related: ['php'] }),
  t('woocommerce', 'WooCommerce', 'platform', 'cms', ['woocommerce'], { related: ['wordpress', 'php'] }),
  t('shopify', 'Shopify', 'platform', 'cms', ['shopify', 'liquid templates'], { related: ['javascript'] }),
  t('stripe', 'Stripe integration', 'platform', 'payments', ['stripe', 'stripe api', 'payment gateway', 'payment integration', 'paypal']),
  t('figma', 'Figma', 'tool', 'design', ['figma', 'sketch app', 'adobe xd']),
  t('uiux', 'UI/UX design', 'practice', 'design', ['ui/ux', 'ux design', 'ui design', 'wireframes', 'prototyping', 'design system', 'design systems']),
  t('responsive', 'Responsive design', 'practice', 'frontend', ['responsive design', 'responsive layouts', 'mobile-first', 'cross-browser'], { related: ['css', 'html'] }),
  // web3
  t('ethereum', 'Ethereum', 'platform', 'web3', ['ethereum', 'evm', 'smart contract', 'smart contracts', 'web3', 'web3.js', 'ethers.js', 'hardhat', 'foundry'], { related: ['solidity'] }),
  t('solana', 'Solana', 'platform', 'web3', ['solana', 'anchor framework'], { related: ['rust'] }),
  // testing and practices
  t('testing', 'Automated testing', 'practice', 'testing', ['unit testing', 'unit tests', 'integration testing', 'integration tests', 'test automation', 'tdd', 'test-driven', 'jest', 'vitest', 'pytest', 'mocha']),
  t('e2e', 'End-to-end testing', 'practice', 'testing', ['end-to-end testing', 'e2e testing', 'e2e tests', 'cypress', 'playwright', 'selenium'], { related: ['testing'] }),
  t('agile', 'Agile delivery', 'practice', 'process', ['agile', 'scrum', 'kanban', 'sprint planning']),
  t('codereview', 'Code review', 'practice', 'process', ['code review', 'code reviews', 'pull request review']),
  t('documentation', 'Technical documentation', 'practice', 'process', ['technical documentation', 'api documentation', 'technical writing', 'openapi', 'swagger']),
  t('security', 'Application security', 'practice', 'security', ['application security', 'appsec', 'penetration testing', 'owasp', 'security audit', 'oauth', 'jwt']),
  t('performance', 'Performance optimization', 'practice', 'performance', ['performance optimization', 'performance tuning', 'profiling', 'load testing', 'core web vitals']),
  t('cli', 'CLI tooling', 'practice', 'tooling', ['command line tool', 'command-line tool', 'cli tool', 'cli tools', 'cli application']),
  t('automation', 'Automation', 'practice', 'tooling', ['automation scripts', 'workflow automation', 'zapier', 'n8n', 'make.com', 'rpa']),
  t('electron', 'Electron', 'framework', 'desktop', ['electron', 'tauri'], { related: ['javascript', 'typescript'] }),
  t('unity', 'Unity', 'platform', 'gamedev', ['unity3d', 'unity engine', 'unity game', 'unreal engine', 'godot']),
];

export const TECH_ENTRIES: readonly TechEntry[] = ENTRIES;

const BY_ID: ReadonlyMap<string, TechEntry> = new Map(ENTRIES.map((e) => [e.id, e]));

export function techById(id: string): TechEntry | undefined {
  return BY_ID.get(id);
}

/** Canonical id for a free-form tag such as "Node.js" or "k8s"; undefined when unknown. */
export function canonicalTechId(term: string): string | undefined {
  const needle = term.trim().toLowerCase();
  if (BY_ID.has(needle)) return needle;
  for (const entry of ENTRIES) {
    if (entry.label.toLowerCase() === needle) return entry.id;
    if (entry.synonyms.includes(needle)) return entry.id;
  }
  return undefined;
}

export interface TechMatch {
  readonly id: string;
  readonly index: number;
  readonly length: number;
  readonly text: string;
}

interface Matcher {
  readonly id: string;
  readonly regex: RegExp;
}

let matchers: readonly Matcher[] | undefined;

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function buildMatchers(): readonly Matcher[] {
  return ENTRIES.flatMap((entry) => {
    const out: Matcher[] = [];
    const sorted = [...entry.synonyms].sort((a, b) => b.length - a.length);
    if (sorted.length > 0) {
      const alternation = sorted.map(escapeForPattern).join('|');
      out.push({
        id: entry.id,
        regex: new RegExp(`(?<![a-z0-9+#.])(?:${alternation})(?![a-z0-9+#]|\\.[a-z0-9])`, 'gi'),
      });
    }
    for (const pattern of entry.patterns) out.push({ id: entry.id, regex: new RegExp(pattern, 'g') });
    return out;
  });
}

/** All technology mentions in `text`, left to right; overlapping matches resolve to the longest. */
export function findTechs(text: string): TechMatch[] {
  matchers ??= buildMatchers();
  const raw: TechMatch[] = [];
  for (const matcher of matchers) {
    matcher.regex.lastIndex = 0;
    for (const m of text.matchAll(matcher.regex)) {
      raw.push({ id: matcher.id, index: m.index ?? 0, length: m[0].length, text: m[0] });
    }
  }
  raw.sort((a, b) => a.index - b.index || b.length - a.length);
  const out: TechMatch[] = [];
  let end = -1;
  for (const match of raw) {
    if (match.index < end) continue;
    out.push(match);
    end = match.index + match.length;
  }
  return out;
}

/** Distinct canonical ids mentioned in `text`, in order of first mention. */
export function techIdsIn(text: string): string[] {
  return [...new Set(findTechs(text).map((m) => m.id))];
}
