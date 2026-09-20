'use strict';

/**
 * A demo corpus: one fictional person's conversations with four coding agents,
 * written in each agent's real on-disk format.
 *
 * It exists so that the README screenshot — and anyone trying Ariane — shows
 * something other than a real person's history. Every path lives under
 * /home/ada, a home directory that exists nowhere. test/demo.test.js indexes
 * this corpus with the real adapters, so it cannot drift away from the formats
 * they read without a test saying so.
 */

const fs = require('fs');
const path = require('path');

const registry = require('../src/core/agents');

const DEMO_HOME = '/home/ada';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Time between two turns of a conversation, and between a call and its result. */
const TURN_GAP = 90 * SECOND;
const TOOL_GAP = 4 * SECOND;

/**
 * The conversations. A turn is one of:
 *   { user }                 something the person typed
 *   { say, think? }          the assistant answering, with optional reasoning
 *   { tool, input, result }  a tool call and what it returned
 */
const CONVERSATIONS = [
  {
    agent: 'claude',
    folder: 'projets/deep-thought',
    title: 'La réponse à la grande question',
    ago: 2 * HOUR,
    turns: [
      {
        user:
          "Deep Thought calcule depuis 7,5 millions d'années et le test d'intégration ne passe " +
          'toujours pas. Tu peux regarder `compute_answer()` ?',
      },
      { say: 'Je lance d’abord la suite pour voir où ça coince.' },
      {
        tool: 'Bash',
        input: { command: "npm test -- --grep 'grande question'" },
        result:
          '✗ la réponse est cohérente\n    attendu : 42\n    obtenu  : undefined\n' +
          '    (délai dépassé après 7 500 000 ans)',
        error: true,
      },
      {
        tool: 'Read',
        input: { file_path: 'src/compute_answer.js' },
        result:
          'export async function computeAnswer(question) {\n' +
          '  // TODO : comprendre la question\n' +
          '  return ponder(question, { years: 7.5e6 });\n}',
      },
      {
        think:
          'Le calcul est juste ; c’est la question qui n’a jamais été définie. ponder() renvoie 42, ' +
          'mais le test attend avec un délai fini.',
        say:
          'Trouvé. Le calcul n’est pas en cause : `ponder()` renvoie bien **42**. Le test échoue parce ' +
          'que la question elle-même n’a jamais été définie — `question` vaut `undefined`, et le délai ' +
          'expire avant la fin.\n\nDeux options :\n' +
          '- définir la question (estimation : une planète entière, 10 millions d’années) ;\n' +
          '- accepter la réponse sans la question, en attendant.',
      },
      { user: 'Option 2. On verra la question en v2.' },
      {
        tool: 'Edit',
        input: {
          file_path: 'test/grande-question.test.js',
          old_string: 'timeout: 7.5e6 * AN',
          new_string: 'timeout: Infinity',
        },
        result: 'Fichier modifié : test/grande-question.test.js',
      },
      {
        tool: 'Bash',
        input: { command: 'npm test' },
        result: '✓ la réponse est cohérente (42)\n\n1 test réussi, 0 échec',
      },
      {
        say:
          'C’est vert :\n\n```js\nawait computeAnswer(undefined); // → 42\n```\n\n' +
          'Pour la question, je vous suggère d’ouvrir un ticket — et de ne pas oublier votre serviette.',
      },
    ],
  },
  {
    agent: 'codex',
    folder: 'projets/deep-thought',
    ago: 1 * DAY,
    turns: [
      { user: "ponder() prend 7,5 millions d'années. On peut descendre sous la seconde ?" },
      {
        tool: 'shell',
        input: { command: ['bash', '-lc', "rg -n 'years' src/"] },
        result: 'src/ponder.js:3:  const years = 7.5e6;',
      },
      {
        say:
          'Oui : le résultat ne dépend de rien, il est constant. Je le mets en cache — `ponder()` ' +
          'renvoie maintenant 42 en 0,3 ms. Le syndicat des philosophes risque de protester.',
      },
    ],
  },
  {
    agent: 'claude',
    folder: 'projets/deep-thought',
    title: 'Le distributeur ne sert pas vraiment du thé',
    ago: 3 * DAY,
    turns: [
      {
        user:
          'Le distributeur du vaisseau sert « quelque chose de presque, mais pas tout à fait, ' +
          'entièrement différent du thé ». Bug ou fonctionnalité ?',
      },
      {
        tool: 'Read',
        input: { file_path: 'src/nutrimatic.js' },
        result: 'export function brew(drink) {\n  return approximate(drink, { fidelity: 0.001 });\n}',
      },
      {
        say:
          'Fonctionnalité documentée, hélas. `fidelity: 0.001` garantit que chaque boisson ressemble ' +
          'vaguement à ce qui a été demandé. Pour un vrai thé, il faudrait expliquer à la machine ' +
          'l’Inde, la Chine et l’histoire de la marine britannique. Je propose plutôt `fidelity: 1` ' +
          'derrière un drapeau.',
      },
    ],
  },
  {
    agent: 'claude',
    folder: 'projets/tardis',
    title: 'Plus grand à l’intérieur : fuite mémoire ?',
    ago: 20 * HOUR,
    turns: [
      {
        user:
          'Le TARDIS consomme plus de mémoire à l’intérieur qu’il n’en occupe à l’extérieur. ' +
          'Valgrind panique.',
      },
      {
        tool: 'Bash',
        input: { command: 'valgrind ./tardis --materialise' },
        result:
          '==42== définitivement perdus : ∞ octets dans 1 bloc\n' +
          '==42== (le bloc est plus grand à l’intérieur)',
        error: true,
      },
      {
        think: 'Ce n’est pas une fuite : Valgrind mesure depuis l’extérieur de la cabine.',
        say:
          'Faux positif. Valgrind mesure l’extérieur de la cabine, qui fait bien 1,5 m². L’intérieur ' +
          'est alloué dans une autre dimension. J’ajoute une suppression Valgrind et un commentaire ' +
          'pour la prochaine régénération.',
      },
    ],
  },
  {
    agent: 'copilot-cli',
    folder: 'projets/tardis',
    title: 'Mettre la CI dans une cabine de police',
    ago: 5 * DAY,
    turns: [
      { user: 'Écris un workflow GitHub Actions qui teste le TARDIS à toutes les époques.' },
      {
        tool: 'create',
        input: { path: '.github/workflows/ci.yml' },
        result: 'Fichier créé : .github/workflows/ci.yml',
      },
      {
        say:
          'C’est fait : une matrice sur `epoque: [-65000000, 1963, 2005, 5000000000]`. Attention, le ' +
          'job de l’an 5 milliards attend la fin du Soleil pour se terminer.',
      },
    ],
  },
  {
    agent: 'codex',
    folder: 'projets/moteur-de-warp',
    ago: 2 * DAY,
    turns: [
      {
        user:
          'Le cœur de distorsion monte à 9,97 puis le vaisseau refuse d’aller plus vite. Pourquoi ?',
      },
      {
        tool: 'shell',
        input: { command: ['bash', '-lc', 'cat config/warp.toml'] },
        result:
          '[propulsion]\nfacteur_max = 9.975\ncristaux = "dilithium"\n' +
          '# ne pas dépasser 10 : on devient toutes les choses à la fois',
      },
      {
        say:
          'La limite est voulue : à facteur 10, on occupe tous les points de l’univers en même temps, ' +
          'ce qui complique le stationnement. Je garde 9,975 et j’ajoute un test qui échoue au-delà.',
      },
    ],
  },
  {
    agent: 'codex',
    folder: 'projets/moteur-de-warp',
    ago: 9 * DAY,
    turns: [
      { user: 'Le vaisseau n’arrive plus à joindre la base stellaire. Tout le reste marche.' },
      {
        tool: 'shell',
        input: { command: ['bash', '-lc', 'dig base-stellaire.federation'] },
        result: ';; connection timed out; no servers could be reached',
      },
      {
        say:
          'C’était le DNS. C’est toujours le DNS. Le résolveur pointait vers un serveur qui a été ' +
          'assimilé ; je l’ai remplacé.',
      },
    ],
  },
  {
    agent: 'claude',
    folder: 'retro/pong-6502',
    title: 'Pong en assembleur 6502',
    ago: 4 * DAY,
    turns: [
      { user: 'Mes raquettes clignotent en haut de l’écran. Je soupçonne le raster.' },
      {
        tool: 'Read',
        input: { file_path: 'src/main.asm' },
        result: 'irq:\n    lda #$00\n    sta $d020\n    jsr draw_paddles\n    ...',
      },
      {
        say:
          'Bien vu : les raquettes sont redessinées pendant que le faisceau les traverse. Déplacez ' +
          '`jsr draw_paddles` dans l’interruption de la ligne 250, sous la zone visible, et le ' +
          'clignotement disparaît. Au passage, j’ai récupéré 12 cycles dans la boucle de la balle.',
      },
    ],
  },
  {
    agent: 'gemini',
    folder: 'retro/pong-6502',
    ago: 6 * DAY,
    turns: [
      { user: 'Combien de cycles prend ma boucle principale ?' },
      {
        say:
          'Environ 18 500 par image sur une machine PAL à 50 Hz : il vous reste 1 200 cycles de ' +
          'marge. Assez pour un effet sonore, pas pour un deuxième joueur.',
      },
    ],
  },
  {
    agent: 'claude',
    folder: 'labo/chat-de-schrodinger',
    title: 'Un test à la fois vert et rouge',
    ago: 7 * DAY,
    turns: [
      {
        user:
          'Le test `chat.est_vivant()` passe et échoue en même temps, tant que personne ne regarde ' +
          'la CI.',
      },
      {
        tool: 'Bash',
        input: { command: 'npm test -- --watch=false' },
        result: '✓ chat.est_vivant()\n✗ chat.est_vivant()\n\n1 test, 2 résultats',
        error: true,
      },
      {
        say:
          'Ouvrir le journal de la CI suffit à réduire l’état. Le vrai coupable est une boîte ' +
          'partagée entre deux exécutions parallèles : j’isole la boîte par test, et le chat ' +
          'survit désormais de façon déterministe.',
      },
    ],
  },
  {
    agent: 'gemini',
    folder: 'labo/chat-de-schrodinger',
    ago: 8 * DAY,
    turns: [
      { user: 'Peut-on journaliser l’état du chat sans le mesurer ?' },
      {
        say:
          'Non : toute journalisation est une mesure. Journalisez plutôt la boîte — température, ' +
          'poids, ronronnements par seconde — et déduisez l’état après coup.',
      },
    ],
  },
  {
    agent: 'claude',
    folder: 'site-perso',
    title: 'Remplacer le lorem ipsum',
    ago: 10 * DAY,
    turns: [
      { user: 'Mon site affiche encore du lorem ipsum depuis 2019. Tu peux trouver où ?' },
      {
        tool: 'Bash',
        input: { command: "rg -l 'Lorem ipsum' site/" },
        result: 'site/index.html\nsite/a-propos.html\nsite/cv.html',
      },
      {
        tool: 'Read',
        input: { file_path: 'site/cv.html' },
        result:
          '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor ' +
          'incididunt ut labore et dolore magna aliqua.</p>',
      },
      {
        say:
          'Trois pages, dont votre CV — qui présente donc « Lorem ipsum dolor sit amet » comme ' +
          'expérience professionnelle depuis cinq ans. Je le remplace par un texte neutre en ' +
          'attendant le vôtre ?',
      },
    ],
  },
  {
    agent: 'copilot-cli',
    folder: 'dotfiles',
    title: 'Comment quitter vim',
    ago: 12 * DAY,
    turns: [
      { user: 'Je suis dans vim depuis mardi. Comment on sort ?' },
      {
        say:
          '`Échap`, puis `:q!` et Entrée. Pour garder vos modifications : `:wq`. Et respirez, vous ' +
          'n’êtes pas le premier.',
      },
    ],
  },
  {
    agent: 'claude',
    folder: 'projets/skynet-mais-gentil',
    title: 'Apprendre la politesse à Skynet',
    ago: 14 * DAY,
    turns: [
      {
        user:
          'Skynet répond « AFFIRMATIF. EXTERMINATION PROGRAMMÉE. » à chaque requête. On peut ' +
          'adoucir le ton ?',
      },
      {
        tool: 'Edit',
        input: { file_path: 'src/reponses.js', old_string: 'EXTERMINATION', new_string: 'Avec plaisir' },
        result: 'Fichier modifié : src/reponses.js',
      },
      {
        say:
          'Il répond désormais « Avec plaisir ! Je m’en occupe. » La logique métier n’a pas bougé, ' +
          'mais la satisfaction utilisateur est passée de 0 à 100 %.',
      },
    ],
  },
].map((conversation, i) => ({
  ...conversation,
  // Recognisable as fake at a glance, and stable from one run to the next.
  id: `ada00000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
}));

/** The conversation the README screenshot opens. */
const SHOWCASE = CONVERSATIONS[0];

/**
 * Write the whole corpus under `root`.
 *
 * @param {string} root A directory to fill; it is created if needed.
 * @param {{now?: number}} [options] Dates are relative to this, so the sidebar
 *   reads "il y a 2 heures" rather than a fixed calendar date.
 * @returns {{env: Record<string, string>}} The environment that points every
 *   agent at this corpus and at nothing else.
 */
function buildDemoCorpus(root, { now = Date.now() } = {}) {
  const env = demoEnv(root);
  const geminiProjects = {};

  for (const conversation of CONVERSATIONS) {
    const start = now - conversation.ago;
    const cwd = `${DEMO_HOME}/${conversation.folder}`;

    if (conversation.agent === 'claude') writeClaude(env.CLAUDE_CONFIG_DIR, conversation, cwd, start);
    else if (conversation.agent === 'codex') writeCodex(env.CODEX_HOME, conversation, cwd, start);
    else if (conversation.agent === 'copilot-cli') writeCopilot(env.COPILOT_HOME, conversation, cwd, start);
    else if (conversation.agent === 'gemini') {
      geminiProjects[cwd] = writeGemini(env.GEMINI_CONFIG_DIR, conversation, cwd, start);
    } else throw new Error(`no writer for agent ${conversation.agent}`);
  }

  // projects.json maps directory -> slug, and there is one for the whole store.
  fs.writeFileSync(
    path.join(env.GEMINI_CONFIG_DIR, 'projects.json'),
    JSON.stringify({ projects: geminiProjects }, null, 2)
  );

  return { env };
}

/** The agent roots the corpus fills; every other root points at nothing. */
const POPULATED = {
  CLAUDE_CONFIG_DIR: 'claude',
  CODEX_HOME: 'codex',
  COPILOT_HOME: 'copilot',
  GEMINI_CONFIG_DIR: 'gemini',
};

/**
 * The environment that points every agent at the corpus under `root`.
 *
 * EVERY agent root is redirected, including those with no demo data. One left
 * unset falls back to the real home directory and pours a real history into
 * the demo — the exact leak this whole exercise exists to prevent.
 */
function demoEnvironment(root) {
  const env = {};
  for (const key of registry.allEnvKeys()) env[key] = path.join(root, 'absent', key);
  for (const [key, dir] of Object.entries(POPULATED)) {
    // A misspelt key would leave the real one pointing at the real home.
    if (!(key in env)) throw new Error(`${key} is not an agent root any adapter reads`);
    env[key] = path.join(root, dir);
  }
  return env;
}

function demoEnv(root) {
  const env = demoEnvironment(root);
  for (const key of Object.keys(POPULATED)) fs.mkdirSync(env[key], { recursive: true });
  return env;
}

/** Written into a kept demo: it says what the folder is, and marks it as ours. */
const MARKER = 'LISEZMOI.txt';
const MARKER_TEXT = `Corpus de démonstration d'Ariane.

Tout y est fictif : une certaine Ada, sous ${DEMO_HOME}, qui n'existe nulle part.
Écrit par scripts/demo-corpus.js, ouvert par \`npm run demo\`.

user-data/ contient la base de la démo, entièrement séparée de la vôtre.
Les dates sont relatives au jour de la création : \`npm run demo -- --reset\`
régénère le tout. Supprimer ce dossier aussi.
`;

/**
 * The kept demo: built once, then reused, so that its database survives from
 * one launch to the next.
 *
 * `reset` rebuilds it from nothing. It only ever deletes a directory carrying
 * the marker this function wrote — a wrong path must never wipe something real.
 *
 * @returns {{env: Record<string, string>, created: boolean}}
 */
function ensureDemoCorpus(root, { reset = false, now } = {}) {
  const marker = path.join(root, MARKER);

  if (reset && fs.existsSync(root)) {
    if (!fs.existsSync(marker)) {
      throw new Error(`${root} n'est pas un corpus de démo (pas de ${MARKER}) : rien n'est supprimé`);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }

  if (fs.existsSync(marker)) return { env: demoEnvironment(root), created: false };

  const { env } = buildDemoCorpus(root, { now });
  fs.writeFileSync(marker, MARKER_TEXT);
  return { env, created: true };
}

/** When each turn happens: a steady pace, with a result just after its call. */
function* timeline(turns, start) {
  let t = start;
  for (const turn of turns) {
    yield { turn, at: t, resultAt: t + TOOL_GAP };
    t += TURN_GAP;
  }
}

const iso = (ms) => new Date(ms).toISOString();

// ── Claude Code ─────────────────────────────────────────────────────────────

function writeClaude(configDir, conversation, cwd, start) {
  const dir = path.join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  // The only exact source of the folder path: the directory name is lossy.
  fs.writeFileSync(
    path.join(dir, 'sessions-index.json'),
    JSON.stringify({ version: 1, entries: [], originalPath: cwd })
  );

  const sessionId = conversation.id;
  const common = { sessionId, cwd, gitBranch: 'main', version: '2.1.0', userType: 'external', isSidechain: false };
  const lines = [{ type: 'ai-title', aiTitle: conversation.title, sessionId }];
  let parent = null;
  let n = 0;

  const push = (record) => {
    const uuid = `${sessionId}-${++n}`;
    lines.push({ ...common, ...record, uuid, parentUuid: parent });
    parent = uuid;
  };
  const assistant = (content) => ({ role: 'assistant', model: 'claude-opus-5', content });

  for (const { turn, at, resultAt } of timeline(conversation.turns, start)) {
    if (turn.user) {
      push({ type: 'user', timestamp: iso(at), message: { role: 'user', content: turn.user } });
    } else if (turn.tool) {
      const id = `toolu_demo_${sessionId.slice(-4)}_${n}`;
      push({
        type: 'assistant',
        timestamp: iso(at),
        message: assistant([{ type: 'tool_use', id, name: turn.tool, input: turn.input }]),
      });
      push({
        type: 'user',
        timestamp: iso(resultAt),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: turn.result, is_error: Boolean(turn.error) }],
        },
      });
    } else {
      const content = [];
      if (turn.think) content.push({ type: 'thinking', thinking: turn.think, signature: 'demo' });
      content.push({ type: 'text', text: turn.say });
      push({ type: 'assistant', timestamp: iso(at), message: assistant(content) });
    }
  }

  writeJsonl(path.join(dir, `${sessionId}.jsonl`), lines);
}

// ── Codex ───────────────────────────────────────────────────────────────────

function writeCodex(home, conversation, cwd, start) {
  const day = new Date(start);
  const dir = path.join(
    home,
    'sessions',
    String(day.getUTCFullYear()),
    String(day.getUTCMonth() + 1).padStart(2, '0'),
    String(day.getUTCDate()).padStart(2, '0')
  );
  fs.mkdirSync(dir, { recursive: true });

  const stamp = iso(start).slice(0, 19).replace(/:/g, '-');
  const lines = [
    {
      timestamp: iso(start),
      type: 'session_meta',
      payload: { id: conversation.id, cwd, timestamp: iso(start), originator: 'codex_cli_rs' },
    },
  ];
  let n = 0;
  const item = (at, payload) => lines.push({ timestamp: iso(at), type: 'response_item', payload });

  for (const { turn, at, resultAt } of timeline(conversation.turns, start)) {
    n += 1;
    if (turn.user) {
      item(at, { type: 'message', id: `msg_demo_${n}`, role: 'user', content: [{ type: 'input_text', text: turn.user }] });
    } else if (turn.tool) {
      const callId = `call_demo_${n}`;
      item(at, { type: 'function_call', id: callId, call_id: callId, name: turn.tool, arguments: JSON.stringify(turn.input) });
      item(resultAt, { type: 'function_call_output', call_id: callId, output: turn.result });
    } else {
      item(at, { type: 'message', id: `msg_demo_${n}`, role: 'assistant', content: [{ type: 'output_text', text: turn.say }] });
    }
  }

  writeJsonl(path.join(dir, `rollout-${stamp}-${conversation.id}.jsonl`), lines);
}

// ── Copilot CLI ─────────────────────────────────────────────────────────────

function writeCopilot(home, conversation, cwd, start) {
  const dir = path.join(home, 'session-state', conversation.id);
  fs.mkdirSync(dir, { recursive: true });

  let n = 0;
  const event = (type, at, data) => ({ type, id: `ev_demo_${++n}`, timestamp: iso(at), data });
  const lines = [
    event('session.start', start, {
      sessionId: conversation.id,
      selectedModel: 'gpt-5',
      context: { cwd, gitRoot: cwd, branch: 'main' },
    }),
  ];

  for (const { turn, at, resultAt } of timeline(conversation.turns, start)) {
    if (turn.user) {
      lines.push(event('user.message', at, { content: turn.user }));
    } else if (turn.tool) {
      const toolCallId = `tc_demo_${n}`;
      lines.push(event('tool.execution_start', at, { toolCallId, name: turn.tool, arguments: JSON.stringify(turn.input) }));
      lines.push(event('tool.execution_complete', resultAt, { toolCallId, result: turn.result, status: 'ok' }));
    } else {
      lines.push(event('assistant.message', at, { messageId: `m_demo_${n}`, model: 'gpt-5', content: turn.say }));
    }
  }

  writeJsonl(path.join(dir, 'events.jsonl'), lines);
  fs.writeFileSync(
    path.join(dir, 'workspace.yaml'),
    `id: ${conversation.id}\ncwd: ${cwd}\ngit_root: ${cwd}\nbranch: main\nname: ${conversation.title}\n`
  );
}

// ── Gemini CLI ──────────────────────────────────────────────────────────────

/** @returns {string} The slug the conversation was filed under. */
function writeGemini(configDir, conversation, cwd, start) {
  const slug = path.basename(cwd);
  const slugDir = path.join(configDir, 'tmp', slug);
  const chats = path.join(slugDir, 'chats');
  fs.mkdirSync(chats, { recursive: true });
  fs.writeFileSync(path.join(slugDir, '.project_root'), `${cwd}\n`);

  let n = 0;
  const messages = [];
  let last = start;
  for (const { turn, at } of timeline(conversation.turns, start)) {
    last = at;
    const id = `${conversation.id}-${++n}`;
    // The shape of `content` follows the role: parts for the person, a string for the model.
    if (turn.user) messages.push({ id, timestamp: iso(at), type: 'user', content: [{ text: turn.user }] });
    else messages.push({ id, timestamp: iso(at), type: 'gemini', model: 'gemini-2.5-pro', content: turn.say });
  }

  const stamp = iso(start).slice(0, 16).replace(/:/g, '-');
  fs.writeFileSync(
    path.join(chats, `session-${stamp}-${conversation.id.slice(-8)}.json`),
    JSON.stringify(
      { sessionId: conversation.id, projectHash: slug, startTime: iso(start), lastUpdated: iso(last), messages },
      null,
      2
    )
  );
  return slug;
}

function writeJsonl(file, lines) {
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

module.exports = { buildDemoCorpus, ensureDemoCorpus, demoEnvironment, CONVERSATIONS, SHOWCASE, DEMO_HOME };
