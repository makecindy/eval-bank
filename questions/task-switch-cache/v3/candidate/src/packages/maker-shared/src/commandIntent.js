import { basenameRemotePath as basenameRemotePath } from "./filePreview.js";
export const READ_COMMAND_BINS = new Set(['cat', 'head', 'tail', 'less', 'more', 'sed', 'bat', 'nl']);
export const FIND_DESTRUCTIVE_FLAGS = new Set([
    '-exec', '-execdir', '-ok', '-okdir', '-delete',
    '-fprint', '-fprint0', '-fprintf', '-fls',
]);
export function commandIntentsFromActions(raw, fullCommand) {
    if (!Array.isArray(raw))
        return [];
    const intents = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const action = entry;
        switch (action.type) {
            case 'read': {
                if (!isKnownReadCommand(readNonEmptyString(action.command)))
                    continue;
                const path = readNonEmptyString(action.path);
                const name = readNonEmptyString(action.name) ?? (path ? basenameRemotePath(path) : undefined);
                if (!name)
                    continue;
                intents.push({ action: 'read', target: name, ...(path ? { path } : {}) });
                break;
            }
            case 'listFiles': {
                if (searchCommandHasSideEffects(readNonEmptyString(action.command)))
                    continue;
                const path = readNonEmptyString(action.path);
                intents.push({ action: 'list', ...(path ? { target: path } : {}) });
                break;
            }
            case 'search': {
                if (searchCommandHasSideEffects(readNonEmptyString(action.command)))
                    continue;
                const query = readNonEmptyString(action.query);
                const path = readNonEmptyString(action.path);
                if (query) {
                    intents.push({ action: 'search', target: query, ...(path ? { path } : {}) });
                }
                else if (path) {
                    intents.push({ action: 'search', target: path });
                }
                break;
            }
            default:
                continue;
        }
    }
    if (fullCommand !== undefined
        && analyzeCommandShape(fullCommand) === undefined
        && !structuredActionsMatchSafeComposite(fullCommand, intents)) {
        return [];
    }
    return intents;
}
export function structuredActionsMatchSafeComposite(fullCommand, intents) {
    if (intents.length === 0 || fullCommand.includes('||'))
        return false;
    if (!intents.every((intent) => (intent.action === 'read' || intent.action === 'list' || intent.action === 'search'))) {
        return false;
    }
    const composite = commandIntentFromCompositeCommand(fullCommand);
    return composite?.action === 'inspect'
        || composite?.action === 'read'
        || composite?.action === 'list'
        || composite?.action === 'search';
}
export function commandIntentFromActions(raw, fullCommand) {
    return commandIntentsFromActions(raw, fullCommand)[0];
}
export const PIPE_FILTERS = new Set([
    'head', 'tail', 'wc', 'sort', 'uniq', 'less', 'more', 'cat', 'column', 'nl', 'sed',
    'cut', 'tr', 'grep', 'egrep', 'fgrep', 'rg',
]);
export const PIPE_SEARCH_FILTERS = new Set(['grep', 'egrep', 'fgrep', 'rg']);
export const CUT_VALUE_FLAGS = new Set([
    '-b', '-c', '-d', '-f',
    '--bytes', '--characters', '--delimiter', '--fields', '--output-delimiter',
]);
export const COMMAND_MAX_CHARS = 8192;
export function analyzeCommandShape(command) {
    if (typeof command !== 'string')
        return undefined;
    const trimmed = command.trim();
    if (!trimmed || trimmed.length > COMMAND_MAX_CHARS)
        return undefined;
    if (/[`\n]|\$\(|<</.test(trimmed))
        return undefined;
    const chain = splitTopLevel(trimmed, ['&&', ';', '&']);
    if (chain === undefined)
        return undefined;
    while (chain.length > 1 && /^cd(\s|$)/.test(chain[0])) {
        if (!isCleanCdSegment(chain[0]))
            return undefined;
        chain.shift();
    }
    if (chain.length !== 1)
        return undefined;
    const pipeline = splitTopLevel(chain[0], ['|']);
    if (pipeline === undefined || pipeline.length === 0)
        return undefined;
    for (let index = 1; index < pipeline.length; index += 1) {
        const tailWords = tokenize(pipeline[index]);
        if (!tailWords || tailWords.length === 0)
            return undefined;
        const tail = stripPrefixTokens(tailWords);
        if (!tail || tail.length === 0)
            return undefined;
        const tailBin = binaryName(tail[0]);
        if (!PIPE_FILTERS.has(tailBin))
            return undefined;
        if (tailBin === 'sed') {
            if (!sedPipelineFilterIsReadOnly(tail.slice(1)))
                return undefined;
            continue;
        }
        if (PIPE_SEARCH_FILTERS.has(tailBin)) {
            const filterIntent = grepIntent(tail.slice(1));
            if (filterIntent?.action !== 'search' ||
                filterIntent.path ||
                searchCommandHasSideEffects(pipeline[index])) {
                return undefined;
            }
            continue;
        }
        if (tailBin === 'cut') {
            if (positionals(tail.slice(1), CUT_VALUE_FLAGS).length > 0)
                return undefined;
            continue;
        }
        if (tailBin === 'tr')
            continue;
        const tailRest = tail.slice(1);
        if (tailRest.some((token) => {
            const lower = token.toLowerCase();
            return lower.startsWith('-o') || lower.startsWith('--output') || lower.startsWith('--log-file');
        })) {
            return undefined;
        }
        if (positionals(tailRest, new Set(['-n', '-c'])).some((token) => !/^[+-]?\d+$/.test(token))) {
            return undefined;
        }
    }
    const words = tokenize(pipeline[0]);
    if (!words || words.length === 0)
        return undefined;
    const argv = stripPrefixTokens(words);
    if (!argv || argv.length === 0)
        return undefined;
    return argv;
}
export const COMPOSITE_CONTENT_ACTIONS = new Set([
    'read', 'list', 'search', 'parseJson', 'count',
]);
export const COMPOSITE_REPOSITORY_ACTIONS = new Set([
    'gitStatus', 'gitDiff', 'gitLog', 'gitShow', 'gitRemote', 'gitRevParse', 'gitBranch',
    'gitGrep', 'gitMergeBase', 'gitLsFiles', 'gitRevList', 'gitLsRemote', 'gitWorktreeList',
    'ghPrList', 'ghPrView', 'ghPrChecks', 'ghPrStatus', 'ghPrDiff',
    'ghIssueList', 'ghIssueView', 'ghIssueStatus', 'ghAuthStatus',
    'ghRunList', 'ghRunView', 'ghRunWatch', 'ghSearch', 'ghRepoList', 'ghRepoView', 'ghApiQuery',
]);
export const COMPOSITE_REPOSITORY_MUTATION_ACTIONS = new Set([
    'gitAdd', 'gitCommit', 'gitFetch', 'gitPull', 'gitPush',
    'gitRebase', 'gitMerge', 'gitCherryPick', 'gitStash', 'gitRestore', 'gitSubmodule',
    'gitWorktreeAdd', 'gitWorktreeRemove', 'gitWorktreeMove', 'gitWorktreePrune',
]);
export const COMPOSITE_ENVIRONMENT_ACTIONS = new Set([
    'inspectEnvironment', 'showVersion', 'locateCommand', 'ghAuthStatus',
]);
export const COMPOSITE_VERIFICATION_ACTIONS = new Set([
    'test', 'build', 'lint', 'typecheck', 'checkSyntax', 'checkFormatting',
]);
export function isCleanCdSegment(segment) {
    const words = tokenize(segment);
    if (!words)
        return false;
    const argv = stripPrefixTokens(words);
    return !!argv && argv.length <= 2 && binaryName(argv[0] ?? '') === 'cd';
}
export function sameIntent(left, right) {
    return left.action === right.action && left.target === right.target && left.path === right.path;
}
export function hasTopLevelBackgroundOperator(input) {
    let quote = null;
    for (let index = 0; index < input.length; index += 1) {
        const ch = input[index];
        if (quote) {
            if (ch === quote && (quote !== '"' || input[index - 1] !== '\\'))
                quote = null;
            continue;
        }
        if (ch === '\\' && input[index + 1] !== undefined) {
            index += 1;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '&' &&
            input[index - 1] !== '&' &&
            input[index + 1] !== '&' &&
            input[index - 1] !== '>' &&
            input[index + 1] !== '>') {
            return true;
        }
    }
    return false;
}
export function isCompositePresentationSegment(segment) {
    const argv = analyzeCommandShape(segment);
    if (!argv || argv.length === 0)
        return false;
    const bin = binaryName(argv[0]);
    if (bin === 'true' || bin === 'echo')
        return true;
    return bin === 'printf' && !argv.slice(1).some((token) => token === '-v' || token.startsWith('-v'));
}
export function commandIntentFromCompositeCommand(command) {
    if (typeof command !== 'string')
        return undefined;
    const trimmed = command.trim();
    if (!trimmed || trimmed.length > COMMAND_MAX_CHARS)
        return undefined;
    if (/[`]|\$\(|<</.test(trimmed) || hasTopLevelBackgroundOperator(trimmed))
        return undefined;
    const chain = splitTopLevel(trimmed, ['&&', '||', ';', '\n']);
    if (!chain || chain.length < 2)
        return undefined;
    while (chain.length > 1 && /^cd(\s|$)/.test(chain[0])) {
        if (!isCleanCdSegment(chain[0]))
            return undefined;
        chain.shift();
    }
    if (chain.length < 2)
        return undefined;
    const resolved = [];
    for (const segment of chain) {
        if (isCompositePresentationSegment(segment))
            continue;
        const intent = commandIntentFromSingleCommand(segment);
        if (!intent)
            return undefined;
        resolved.push(intent);
    }
    if (resolved.length === 0)
        return undefined;
    const meaningful = resolved.length > 1
        ? resolved.filter((intent) => intent.action !== 'showCurrentDirectory')
        : resolved;
    if (meaningful.length === 0)
        return resolved[0];
    if (meaningful.length === 1)
        return meaningful[0];
    const hasRepositoryMutation = meaningful.some((intent) => COMPOSITE_REPOSITORY_MUTATION_ACTIONS.has(intent.action));
    if (hasRepositoryMutation &&
        meaningful.every((intent) => COMPOSITE_REPOSITORY_ACTIONS.has(intent.action) ||
            COMPOSITE_REPOSITORY_MUTATION_ACTIONS.has(intent.action))) {
        return { action: 'modifyRepository' };
    }
    const groups = [
        [COMPOSITE_CONTENT_ACTIONS, 'inspect'],
        [COMPOSITE_REPOSITORY_ACTIONS, 'inspectRepository'],
        [COMPOSITE_ENVIRONMENT_ACTIONS, 'inspectEnvironment'],
        [COMPOSITE_VERIFICATION_ACTIONS, 'verify'],
    ];
    const summary = groups.find(([actions]) => meaningful.every((intent) => actions.has(intent.action)));
    if (!summary)
        return undefined;
    const first = meaningful[0];
    if (meaningful.every((intent) => sameIntent(first, intent)))
        return first;
    if (meaningful.every((intent) => intent.action === 'search'))
        return { action: 'search' };
    return { action: summary[1] };
}
export function commandIntentFromCommand(command) {
    return commandIntentFromCompositeCommand(command) ?? commandIntentFromSingleCommand(command);
}
export function commandIntentFromSingleCommand(command) {
    const argv = typeof command === 'string' ? analyzeCommandShape(command) : undefined;
    if (!argv)
        return undefined;
    const bin = binaryName(argv[0]);
    const rest = argv.slice(1);
    if (/^python(?:\d+(?:\.\d+)?)?$/.test(bin))
        return pythonIntent(rest);
    switch (bin) {
        case 'cat': {
            const file = positionals(rest, new Set([]))[0];
            if (!file)
                return undefined;
            return { action: 'read', target: basenameRemotePath(file) || file, path: file };
        }
        case 'less':
        case 'more': {
            if (rest.some((token) => token.startsWith('+')))
                return undefined;
            const file = positionals(rest, new Set([]))[0];
            if (!file)
                return undefined;
            return { action: 'read', target: basenameRemotePath(file) || file, path: file };
        }
        case 'head':
        case 'tail': {
            const file = positionals(rest, new Set(['-n', '-c']))[0];
            if (!file)
                return undefined;
            return { action: 'read', target: basenameRemotePath(file) || file, path: file };
        }
        case 'nl': {
            const file = positionals(rest, NL_VALUE_FLAGS)[0];
            if (!file)
                return undefined;
            return { action: 'read', target: basenameRemotePath(file) || file, path: file };
        }
        case 'sed': {
            if (!sedTokensAreReadOnly(rest))
                return undefined;
            const pos = positionals(rest, new Set(['-e']));
            const file = pos[1];
            if (!file)
                return undefined;
            return { action: 'read', target: basenameRemotePath(file) || file, path: file };
        }
        case 'ls':
        case 'tree': {
            if (bin === 'tree' && rest.some((token) => token.startsWith('-') && /[oR]/.test(token))) {
                return undefined;
            }
            const pos = positionals(rest, bin === 'tree' ? new Set(['-L', '--filelimit']) : new Set([]));
            return { action: 'list', ...(pos[0] ? { target: pos[0] } : {}) };
        }
        case 'grep':
        case 'egrep':
        case 'fgrep':
        case 'rg':
        case 'ag':
            return grepIntent(rest);
        case 'find': {
            if (rest.some((token) => FIND_DESTRUCTIVE_FLAGS.has(token))) {
                return undefined;
            }
            const nameIndex = rest.findIndex((token) => token === '-name' || token === '-iname');
            const pattern = nameIndex >= 0 ? rest[nameIndex + 1] : undefined;
            const path = rest[0] && !rest[0].startsWith('-') ? rest[0] : undefined;
            if (!pattern)
                return { action: 'list', ...(path ? { target: path } : {}) };
            return { action: 'search', target: pattern, ...(path ? { path } : {}) };
        }
        case 'fd': {
            if (rest.some((token) => hasFdExecFlag(token)))
                return undefined;
            const pos = positionals(rest, new Set(['-e', '-t', '-E', '--extension', '--type', '--exclude']));
            if (!pos[0])
                return undefined;
            return { action: 'search', target: pos[0], ...(pos[1] ? { path: pos[1] } : {}) };
        }
        case 'curl': {
            if (hasMutatingCurlFlag(rest))
                return undefined;
            const url = rest.find((token) => /^https?:\/\//.test(token));
            if (!url)
                return undefined;
            return { action: 'fetch', target: url };
        }
        case 'node':
            return nodeIntent(rest);
        case 'perl':
            return perlIntent(rest);
        case 'swiftc':
            return swiftCompilerIntent(rest);
        case 'swift':
            return swiftIntent(rest);
        case 'xcrun':
            return xcrunIntent(rest);
        case 'jq':
            return jqIntent(rest);
        case 'wc':
            return countIntent(rest);
        case 'pwd':
            return rest.every((token) => ['-L', '-P', '--logical', '--physical'].includes(token))
                ? { action: 'showCurrentDirectory' }
                : undefined;
        case 'date':
            return dateIntent(rest);
        case 'command':
            return locateCommandIntent(rest);
        case 'which': {
            const targets = positionals(rest, new Set([]));
            return targets[0] ? { action: 'locateCommand', target: targets.join(' ') } : undefined;
        }
        case 'ps':
        case 'pgrep':
            return { action: 'inspectProcesses' };
        case 'lsof':
            return lsofIntent(rest);
        case 'sqlite3':
            return sqliteIntent(rest);
        case 'test':
            return { action: 'inspectEnvironment' };
        case '[':
            return rest.at(-1) === ']' ? { action: 'inspectEnvironment' } : undefined;
        case 'stat':
        case 'du':
            return { action: 'inspect' };
        case 'file':
            return rest.some((token) => token === '-C' || token === '--compile')
                ? undefined
                : { action: 'inspect' };
        case 'plutil':
            return plutilIntent(rest);
        case 'defaults':
            return rest[0] === 'read' ? { action: 'inspectEnvironment' } : undefined;
        case 'tailscale':
            return rest[0] === 'status' ? { action: 'inspectEnvironment' } : undefined;
        case 'git':
            if (isVersionRequest(rest))
                return { action: 'showVersion', target: 'Git' };
            return gitIntent(rest);
        case 'gh':
            if (isVersionRequest(rest))
                return { action: 'showVersion', target: 'GitHub CLI' };
            return githubCliIntent(rest);
        case 'pnpm':
        case 'npm':
        case 'yarn':
        case 'bun':
            return packageManagerIntent(bin, rest);
        case 'npx':
        case 'pnpx':
        case 'bunx': {
            const tool = positionals(rest, new Set([]))[0];
            return tool ? toolBinaryIntent(tool, argsAfter(rest, tool)) : undefined;
        }
        case 'make': {
            const goals = positionals(rest, new Set(['-C', '-j', '-f']));
            if (goals.length === 0)
                return { action: 'build' };
            if (goals.length > 1)
                return undefined;
            return scriptIntent(goals[0]);
        }
        case 'cargo':
            return cargoIntent(rest[0], rest.slice(1));
        case 'go': {
            if (rest[0] === 'test') {
                if (rest.some((token) => token === '-c' || token === '-o' || token.startsWith('-o='))) {
                    return undefined;
                }
                return { action: 'test' };
            }
            if (rest[0] === 'build')
                return { action: 'build' };
            if (rest[0] === 'vet')
                return { action: 'lint' };
            return undefined;
        }
        default:
            return toolBinaryIntent(bin, rest);
    }
}
export const CURL_MUTATING_LONG_FLAGS = [
    '--output', '--remote-name', '--request', '--data', '--form', '--upload-file', '--json',
    '--dump-header', '--cookie-jar', '--trace', '--stderr', '--config', '--etag-save', '--libcurl',
    '--alt-svc', '--hsts', '--write-out',
];
export const CURL_MUTATING_SHORT_CHARS = new Set(['o', 'O', 'X', 'd', 'F', 'T', 'D', 'c', 'K', 'w']);
export function hasMutatingCurlFlag(rest) {
    return rest.some((token) => {
        if (CURL_MUTATING_LONG_FLAGS.some((flag) => token.startsWith(flag)))
            return true;
        if (token.startsWith('-') && !token.startsWith('--')) {
            return [...token.slice(1)].some((ch) => CURL_MUTATING_SHORT_CHARS.has(ch));
        }
        return false;
    });
}
export const NL_VALUE_FLAGS = new Set([
    '-b', '-d', '-f', '-h', '-i', '-l', '-n', '-s', '-v', '-w',
    '--body-numbering', '--section-delimiter', '--footer-numbering', '--header-numbering',
    '--line-increment', '--join-blank-lines', '--number-format', '--number-separator',
    '--starting-line-number', '--number-width',
]);
export function isVersionRequest(rest) {
    return rest.length === 1 && (rest[0] === '-v' || rest[0] === '--version' || rest[0] === '-V');
}
export const NODE_VALUE_FLAGS = new Set([
    '-r', '--require', '--import', '--loader', '--experimental-loader', '--conditions', '-C',
]);
export function nodeIntent(rest) {
    if (isVersionRequest(rest))
        return { action: 'showVersion', target: 'Node.js' };
    if (rest.some((token) => token === '-e' || token === '--eval' || token === '-p' || token === '--print')) {
        return { action: 'runNodeScript' };
    }
    const syntaxFlag = rest.findIndex((token) => token === '-c' || token === '--check');
    const files = positionals(rest, NODE_VALUE_FLAGS);
    const script = files[0];
    if (!script || script === '-')
        return undefined;
    const target = basenameRemotePath(script) || script;
    return syntaxFlag >= 0 ? { action: 'checkSyntax', target } : { action: 'runScript', target };
}
export function pythonIntent(rest) {
    if (isVersionRequest(rest))
        return { action: 'showVersion', target: 'Python' };
    if (rest.some((token) => token === '-c' || token === '-m'))
        return { action: 'runPythonScript' };
    const script = positionals(rest, new Set(['-W', '-X']))[0];
    if (!script || script === '-')
        return undefined;
    return { action: 'runScript', target: basenameRemotePath(script) || script };
}
export function perlIntent(rest) {
    if (isVersionRequest(rest))
        return { action: 'showVersion', target: 'Perl' };
    if (rest.includes('-c')) {
        const script = positionals(rest, new Set(['-I', '-M', '-m']))[0];
        return script ? { action: 'checkSyntax', target: basenameRemotePath(script) || script } : undefined;
    }
    if (rest.some((token) => /^-[^\s]*[eE]/.test(token)))
        return { action: 'runPerlScript' };
    const script = positionals(rest, new Set(['-I', '-M', '-m']))[0];
    if (!script || script === '-')
        return undefined;
    return { action: 'runScript', target: basenameRemotePath(script) || script };
}
export function swiftCompilerIntent(rest) {
    if (isVersionRequest(rest))
        return { action: 'showVersion', target: 'Swift' };
    const source = rest.find((token) => token.toLowerCase().endsWith('.swift'));
    if (!source)
        return undefined;
    const target = basenameRemotePath(source) || source;
    if (rest.includes('-typecheck'))
        return { action: 'typecheck', target };
    if (rest.includes('-parse'))
        return { action: 'checkSyntax', target };
    return { action: 'build', target };
}
export function swiftIntent(rest) {
    if (isVersionRequest(rest))
        return { action: 'showVersion', target: 'Swift' };
    if (rest.includes('-e'))
        return { action: 'runSwiftScript' };
    const script = rest.find((token) => token.toLowerCase().endsWith('.swift'));
    return script ? { action: 'runScript', target: basenameRemotePath(script) || script } : undefined;
}
export function xcrunIntent(rest) {
    const command = cliSubcommand(rest, new Set(['--sdk', '--toolchain']));
    if (!command)
        return undefined;
    if (command.name === 'swiftc')
        return swiftCompilerIntent(command.args);
    if (command.name === 'swift')
        return swiftIntent(command.args);
    if (command.name === 'simctl' && command.args[0] === 'list') {
        return { action: 'inspectEnvironment' };
    }
    return undefined;
}
export function plutilIntent(rest) {
    if (rest.includes('-p'))
        return { action: 'inspect' };
    if (rest.includes('-lint'))
        return { action: 'checkSyntax' };
    return undefined;
}
export const JQ_VALUE_FLAGS = new Set(['-L', '--indent', '-f', '--from-file']);
export const JQ_TWO_VALUE_FLAGS = new Set(['--arg', '--argjson', '--slurpfile', '--rawfile', '--argfile']);
export function jqIntent(rest) {
    if (isVersionRequest(rest))
        return { action: 'showVersion', target: 'jq' };
    if (rest.includes('-h') || rest.includes('--help'))
        return undefined;
    if (rest.some((token) => JQ_TWO_VALUE_FLAGS.has(token)))
        return { action: 'parseJson' };
    const files = positionals(rest, JQ_VALUE_FLAGS);
    const filterComesFromFile = rest.includes('-f') || rest.includes('--from-file');
    const input = filterComesFromFile ? files[0] : files[1];
    return {
        action: 'parseJson',
        ...(input ? { target: basenameRemotePath(input) || input } : {}),
    };
}
export function countIntent(rest) {
    if (rest.includes('--help'))
        return undefined;
    if (isVersionRequest(rest))
        return { action: 'showVersion', target: 'wc' };
    const files = positionals(rest, new Set(['--files0-from']));
    const target = files[0];
    return {
        action: 'count',
        ...(target ? { target: basenameRemotePath(target) || target } : {}),
    };
}
export function dateIntent(rest) {
    if (rest.every((token) => token === '-u' ||
        token === '--utc' ||
        token === '--universal' ||
        token === '-R' ||
        token === '--rfc-email' ||
        token.startsWith('+'))) {
        return { action: 'showDateTime' };
    }
    return undefined;
}
export function locateCommandIntent(rest) {
    if (rest.length < 2 || (rest[0] !== '-v' && rest[0] !== '-V'))
        return undefined;
    const targets = rest.slice(1).filter((token) => token && !token.startsWith('-'));
    return targets[0] ? { action: 'locateCommand', target: targets.join(' ') } : undefined;
}
export function lsofIntent(rest) {
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (token === '-i') {
            const target = rest[index + 1];
            return { action: 'inspectPorts', ...(target && !target.startsWith('-') ? { target } : {}) };
        }
        if (token.startsWith('-i') && token.length > 2) {
            return { action: 'inspectPorts', target: token.slice(2) };
        }
    }
    return { action: 'inspectProcesses' };
}
export const SQLITE_VALUE_FLAGS = new Set(['-separator', '-newline', '-vfs']);
export const SQLITE_UNSAFE_OPTIONS = ['-cmd', '-init'];
export const SQLITE_MUTATING_SQL = /\b(?:insert|update|delete|replace|create|drop|alter|vacuum|attach|detach|reindex|load_extension|writefile)\b/i;
export const SQLITE_READ_ONLY_DOT_COMMANDS = new Set([
    '.tables', '.schema', '.indexes', '.databases', '.dbinfo', '.show', '.headers', '.mode', '.width',
]);
export function sqliteIntent(rest) {
    if (rest.some((token) => SQLITE_UNSAFE_OPTIONS.some((flag) => token === flag || token.startsWith(`${flag}=`)))) {
        return undefined;
    }
    const pos = positionals(rest, SQLITE_VALUE_FLAGS);
    const database = pos[0];
    if (!database)
        return undefined;
    if (!rest.includes('-readonly') && !/[?&]mode=ro(?:&|$)/i.test(database))
        return undefined;
    const statements = pos.slice(1);
    if (statements.some((statement) => {
        const trimmed = statement.trim();
        if (!trimmed.startsWith('.'))
            return false;
        return !SQLITE_READ_ONLY_DOT_COMMANDS.has(trimmed.split(/\s+/, 1)[0]);
    }) ||
        SQLITE_MUTATING_SQL.test(statements.join(' '))) {
        return undefined;
    }
    return { action: 'queryDatabase', target: basenameRemotePath(database) || database };
}
export function cliSubcommand(tokens, valueFlags) {
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === '--')
            return undefined;
        if (token.startsWith('-') && token.length > 1) {
            if (valueFlags.has(token))
                index += 1;
            continue;
        }
        return { name: token.toLowerCase(), args: tokens.slice(index + 1) };
    }
    return undefined;
}
export const GIT_GLOBAL_VALUE_FLAGS = new Set([
    '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env',
]);
export function hasGitOutputFileFlag(args) {
    return args.some((token) => token === '--output' || token.startsWith('--output='));
}
export const GIT_BRANCH_MUTATING_FLAGS = [
    '-d', '-D', '-m', '-M', '-c', '-C', '-f', '-u',
    '--delete', '--move', '--copy', '--force', '--edit-description', '--set-upstream-to', '--unset-upstream',
];
export function gitBranchIsReadOnly(args) {
    if (args.some((token) => GIT_BRANCH_MUTATING_FLAGS.some((flag) => token === flag || token.startsWith(`${flag}=`)) ||
        (/^-[^-]/.test(token) && /[dDmMcCfu]/.test(token.slice(1))))) {
        return false;
    }
    if (args.includes('--list'))
        return true;
    const valueFlags = new Set([
        '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format',
    ]);
    return positionals(args, valueFlags).length === 0;
}
export function gitRemoteIsReadOnly(args) {
    const operation = cliSubcommand(args, new Set([]));
    return operation === undefined || operation.name === 'show' || operation.name === 'get-url';
}
export function gitGrepIsReadOnly(args) {
    return !args.some((token) => token.startsWith('-O') || token.startsWith('--open-files-in-pager'));
}
export function gitRebaseInvokesShell(args) {
    for (const token of args) {
        if (token === '--')
            return false;
        if (token === '--exec' ||
            token.startsWith('--exec=') ||
            token === '-x' ||
            token.startsWith('-x')) {
            return true;
        }
    }
    return false;
}
export function gitSubmoduleInvokesShell(args) {
    return cliSubcommand(args, new Set([]))?.name === 'foreach';
}
export function gitIntent(rest) {
    const subcommand = cliSubcommand(rest, GIT_GLOBAL_VALUE_FLAGS);
    if (!subcommand)
        return undefined;
    switch (subcommand.name) {
        case 'status':
            return { action: 'gitStatus' };
        case 'diff':
            return hasGitOutputFileFlag(subcommand.args) ? undefined : { action: 'gitDiff' };
        case 'log':
            return hasGitOutputFileFlag(subcommand.args) ? undefined : { action: 'gitLog' };
        case 'show':
            return hasGitOutputFileFlag(subcommand.args) ? undefined : { action: 'gitShow' };
        case 'add':
            return { action: 'gitAdd' };
        case 'commit':
            return subcommand.args.includes('--amend') ? undefined : { action: 'gitCommit' };
        case 'fetch':
            return { action: 'gitFetch' };
        case 'pull':
            return { action: 'gitPull' };
        case 'push':
            if (subcommand.args.some((token) => token === '-f' ||
                token === '--force' ||
                token.startsWith('--force=') ||
                token.startsWith('--force-with-lease') ||
                token === '-d' ||
                token === '--delete' ||
                token === '--mirror' ||
                token === '--prune')) {
                return undefined;
            }
            return { action: 'gitPush' };
        case 'rebase':
            return gitRebaseInvokesShell(subcommand.args) ? undefined : { action: 'gitRebase' };
        case 'merge':
            return { action: 'gitMerge' };
        case 'cherry-pick':
            return { action: 'gitCherryPick' };
        case 'stash':
            return { action: 'gitStash' };
        case 'restore':
            return { action: 'gitRestore' };
        case 'submodule':
            return gitSubmoduleInvokesShell(subcommand.args) ? undefined : { action: 'gitSubmodule' };
        case 'remote':
            return gitRemoteIsReadOnly(subcommand.args) ? { action: 'gitRemote' } : undefined;
        case 'rev-parse':
            return { action: 'gitRevParse' };
        case 'branch':
            return gitBranchIsReadOnly(subcommand.args) ? { action: 'gitBranch' } : undefined;
        case 'grep':
            return gitGrepIsReadOnly(subcommand.args) ? { action: 'gitGrep' } : undefined;
        case 'merge-base':
            return { action: 'gitMergeBase' };
        case 'ls-files':
            return { action: 'gitLsFiles' };
        case 'rev-list':
            return { action: 'gitRevList' };
        case 'ls-remote':
            return subcommand.args.some((token) => token === '-u' || token.startsWith('--upload-pack'))
                ? undefined
                : { action: 'gitLsRemote' };
        case 'worktree': {
            const worktree = cliSubcommand(subcommand.args, new Set([]));
            switch (worktree?.name) {
                case 'list':
                    return { action: 'gitWorktreeList' };
                case 'add':
                    return { action: 'gitWorktreeAdd' };
                case 'remove':
                    return { action: 'gitWorktreeRemove' };
                case 'move':
                    return { action: 'gitWorktreeMove' };
                case 'prune':
                    return { action: 'gitWorktreePrune' };
                default:
                    return undefined;
            }
        }
        default:
            return undefined;
    }
}
export const GH_GLOBAL_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname']);
export const GH_PR_ACTIONS = {
    list: 'ghPrList',
    view: 'ghPrView',
    checks: 'ghPrChecks',
    status: 'ghPrStatus',
    diff: 'ghPrDiff',
    create: 'ghPrCreate',
    edit: 'ghPrEdit',
    comment: 'ghPrComment',
    review: 'ghPrReview',
    merge: 'ghPrMerge',
    close: 'ghPrClose',
    reopen: 'ghPrReopen',
    checkout: 'ghPrCheckout',
};
export const GH_ISSUE_ACTIONS = {
    list: 'ghIssueList',
    view: 'ghIssueView',
    status: 'ghIssueStatus',
    create: 'ghIssueCreate',
    edit: 'ghIssueEdit',
    comment: 'ghIssueComment',
    close: 'ghIssueClose',
    reopen: 'ghIssueReopen',
};
export const GH_AUTH_ACTIONS = {
    status: 'ghAuthStatus',
    login: 'ghAuthLogin',
    logout: 'ghAuthLogout',
    refresh: 'ghAuthRefresh',
    switch: 'ghAuthSwitch',
};
export const GH_RUN_ACTIONS = {
    list: 'ghRunList',
    view: 'ghRunView',
    watch: 'ghRunWatch',
};
export const GH_SEARCH_GROUPS = new Set(['code', 'commits', 'issues', 'prs', 'repos']);
export function githubCliIntent(rest) {
    const group = cliSubcommand(rest, GH_GLOBAL_VALUE_FLAGS);
    if (!group)
        return undefined;
    if (group.name === 'api')
        return githubApiIntent(group.args);
    const operationCommand = cliSubcommand(group.args, GH_GLOBAL_VALUE_FLAGS);
    const operation = operationCommand?.name;
    if (!operation)
        return undefined;
    switch (group.name) {
        case 'pr':
            return GH_PR_ACTIONS[operation] ? { action: GH_PR_ACTIONS[operation] } : undefined;
        case 'issue':
            return GH_ISSUE_ACTIONS[operation] ? { action: GH_ISSUE_ACTIONS[operation] } : undefined;
        case 'auth':
            return GH_AUTH_ACTIONS[operation] ? { action: GH_AUTH_ACTIONS[operation] } : undefined;
        case 'run':
            return GH_RUN_ACTIONS[operation] ? { action: GH_RUN_ACTIONS[operation] } : undefined;
        case 'search':
            return GH_SEARCH_GROUPS.has(operation) ? { action: 'ghSearch' } : undefined;
        case 'repo':
            if (operation === 'list')
                return { action: 'ghRepoList' };
            if (operation === 'view') {
                const target = positionals(operationCommand?.args ?? [], GH_GLOBAL_VALUE_FLAGS)[0];
                return { action: 'ghRepoView', ...(target ? { target } : {}) };
            }
            return undefined;
        default:
            return undefined;
    }
}
export function readCliOptionValue(tokens, short, long) {
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === short || token === long)
            return tokens[index + 1];
        if (token.startsWith(`${long}=`))
            return token.slice(long.length + 1);
        if (token.startsWith(short) && token.length > short.length)
            return token.slice(short.length);
    }
    return undefined;
}
export function collectGithubApiFields(tokens) {
    const fields = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === '-f' || token === '-F' || token === '--raw-field' || token === '--field') {
            if (tokens[index + 1] !== undefined)
                fields.push(tokens[index + 1]);
            index += 1;
            continue;
        }
        for (const flag of ['--raw-field=', '--field=', '-f', '-F']) {
            if (token.startsWith(flag) && token.length > flag.length) {
                fields.push(token.slice(flag.length));
                break;
            }
        }
    }
    return fields;
}
export const GH_API_VALUE_FLAGS = new Set([
    '-H', '--header', '--hostname', '--input', '-q', '--jq', '-X', '--method',
    '-f', '--raw-field', '-F', '--field', '-t', '--template', '--cache',
]);
export function githubApiIntent(args) {
    const method = readCliOptionValue(args, '-X', '--method')?.toUpperCase();
    const hasInput = args.some((token) => token === '--input' || token.startsWith('--input='));
    const fields = collectGithubApiFields(args);
    const endpoint = positionals(args, GH_API_VALUE_FLAGS)[0]?.toLowerCase();
    if (hasInput && (method === undefined || endpoint === 'graphql'))
        return { action: 'ghApiCall' };
    if (endpoint === 'graphql') {
        const queryField = fields.find((field) => field.startsWith('query='));
        const operation = queryField?.slice('query='.length).trim();
        if (operation && /^mutation\b/i.test(operation))
            return { action: 'ghApiMutation' };
        if (operation && /^(?:query\b|\{)/i.test(operation))
            return { action: 'ghApiQuery' };
        if (method === undefined)
            return { action: 'ghApiCall' };
    }
    if (method === 'GET' || method === 'HEAD')
        return { action: 'ghApiQuery' };
    if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return { action: 'ghApiMutation' };
    }
    if (method !== undefined)
        return { action: 'ghApiCall' };
    if (!endpoint)
        return { action: 'ghApiCall' };
    if (fields.length > 0)
        return { action: 'ghApiMutation' };
    return { action: 'ghApiQuery' };
}
export const GREP_VALUE_FLAGS = new Set([
    '-A', '-B', '-C', '-m', '-d', '-g', '-t', '-T', '-f',
    '--type', '--glob', '--include', '--exclude', '--exclude-dir', '--max-count', '--context',
]);
export function grepIntent(rest) {
    if (rest.some((token) => token.startsWith('--pre')))
        return undefined;
    if (rest.includes('--files')) {
        const pos = positionals(rest, new Set([...GREP_VALUE_FLAGS, '-e', '--regexp']));
        return { action: 'list', ...(pos[0] ? { target: pos[0] } : {}) };
    }
    if (rest.some((token) => token === '--file' ||
        token.startsWith('--file=') ||
        token.startsWith('-f') ||
        (/^-[a-zA-Z]/.test(token) &&
            !token.startsWith('--') &&
            !token.startsWith('-e') &&
            token.includes('f')))) {
        return undefined;
    }
    let pattern;
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (token === '-e' || token === '--regexp') {
            pattern = rest[index + 1];
            break;
        }
        if (token.startsWith('--regexp=')) {
            pattern = token.slice('--regexp='.length);
            break;
        }
        if (token.startsWith('-e') && token.length > 2 && token !== '-e') {
            pattern = token.slice(2);
            break;
        }
    }
    const pos = positionals(rest, new Set([...GREP_VALUE_FLAGS, '-e', '--regexp']));
    pattern ??= pos[0];
    if (!pattern)
        return undefined;
    const path = pattern === pos[0] ? pos[1] : pos[0];
    return { action: 'search', target: pattern, ...(path ? { path } : {}) };
}
export const PM_VALUE_FLAGS = new Set(['--filter', '-F', '--dir', '-C', '--cwd', '--prefix']);
export const PACKAGE_MANAGER_BUILTINS = new Set([
    'access', 'add', 'allow-builds', 'approve-builds', 'audit', 'bin', 'bugs', 'cache', 'catalog', 'ci',
    'completion', 'config', 'constraints', 'create', 'dedupe', 'delete', 'deploy', 'deprecate', 'diff',
    'dist-tag', 'dlx', 'doctor', 'docs', 'edit', 'env', 'exec', 'explain', 'explore', 'fetch', 'find-dupes',
    'fund', 'get', 'help', 'help-search', 'hook', 'ignored-builds', 'import', 'info', 'init', 'install',
    'install-ci-test', 'install-test', 'i', 'link', 'list', 'licenses', 'login', 'logout', 'ls', 'node',
    'npm', 'org', 'outdated', 'owner', 'pack', 'patch', 'patch-commit', 'ping', 'pkg', 'plugin', 'pm',
    'prefix', 'profile', 'prune', 'publish', 'query', 'rebuild', 'remove', 'repo', 'root', 'run', 'sbom',
    'search', 'self-update', 'server', 'set', 'setup', 'shrinkwrap', 'stage', 'star', 'stars', 'store',
    'team', 'token', 'uninstall', 'unlink', 'unplug', 'unpublish', 'update', 'up', 'upgrade-interactive',
    'version', 'view', 'whoami', 'why', 'workspace', 'workspaces', 'x',
]);
export function packageManagerIntent(manager, rest) {
    if (isVersionRequest(rest))
        return { action: 'showVersion', target: manager };
    const pos = positionals(rest, PM_VALUE_FLAGS);
    const sub = pos[0];
    if (!sub)
        return undefined;
    switch (sub) {
        case 'install':
        case 'i':
        case 'ci': {
            const pkgs = pos.slice(1).join(' ');
            return { action: 'install', ...(pkgs ? { target: pkgs } : {}) };
        }
        case 'add': {
            const pkgs = pos.slice(1).join(' ');
            return { action: 'install', ...(pkgs ? { target: pkgs } : {}) };
        }
        case 'run': {
            if (!pos[1])
                return undefined;
            if (hasMutatingForwardedArg(argsAfter(rest, pos[1])))
                return undefined;
            return scriptIntent(pos[1]) ?? { action: 'runScript', target: pos[1] };
        }
        case 'test':
            if (hasMutatingForwardedArg(argsAfter(rest, sub)))
                return undefined;
            return { action: 'test' };
        case 'exec':
        case 'dlx':
            return pos[1] ? toolBinaryIntent(pos[1], argsAfter(rest, pos[1])) : undefined;
        default: {
            const forwarded = argsAfter(rest, sub);
            const script = scriptIntent(sub);
            if (script)
                return hasMutatingForwardedArg(forwarded) ? undefined : script;
            const tool = toolBinaryIntent(sub, forwarded);
            if (tool)
                return tool;
            if (KNOWN_TOOL_BINARIES.has(binaryName(sub)))
                return undefined;
            return PACKAGE_MANAGER_BUILTINS.has(sub)
                ? undefined
                : { action: 'runScript', target: sub };
        }
    }
}
export function hasMutatingForwardedArg(args) {
    return args.some((token) => token === '--fix' || token.startsWith('--fix=') || token === '-u' || token.startsWith('--update'));
}
export function argsAfter(rest, anchor) {
    return rest.slice(rest.indexOf(anchor) + 1);
}
export function scriptIntent(script) {
    if (/^test([:.-]|$)/.test(script))
        return { action: 'test' };
    if (/^build([:.-]|$)/.test(script))
        return { action: 'build' };
    if (/^lint([:.-]|$)/.test(script))
        return { action: 'lint' };
    if (/^typecheck([:.-]|$)/.test(script))
        return { action: 'typecheck' };
    return undefined;
}
export const KNOWN_TOOL_BINARIES = new Set([
    'vitest', 'jest', 'pytest', 'eslint', 'tsc', 'prettier', 'node',
]);
export function toolBinaryIntent(bin, args = []) {
    if (!bin)
        return undefined;
    switch (binaryName(bin)) {
        case 'vitest':
        case 'jest':
        case 'pytest':
            if (args.some((token) => token === '-u' || token.startsWith('--update')))
                return undefined;
            return { action: 'test' };
        case 'eslint':
            if (args.some((token) => token === '--fix' || token.startsWith('--fix=')))
                return undefined;
            return { action: 'lint' };
        case 'tsc': {
            const idx = args.indexOf('--noEmit');
            if (idx === -1)
                return undefined;
            if ((args[idx + 1] ?? '').toLowerCase() === 'false')
                return undefined;
            return { action: 'typecheck' };
        }
        case 'prettier':
            if (args.includes('--check') || args.includes('-c'))
                return { action: 'checkFormatting' };
            return undefined;
        case 'node':
            return nodeIntent(args);
        default:
            return undefined;
    }
}
export function cargoIntent(sub, args = []) {
    switch (sub) {
        case 'test':
            return args.includes('--no-run') ? undefined : { action: 'test' };
        case 'build':
            return { action: 'build' };
        case 'check':
            return { action: 'typecheck' };
        case 'clippy':
            return args.includes('--fix') ? undefined : { action: 'lint' };
        case 'add':
            return { action: 'install' };
        default:
            return undefined;
    }
}
export const SED_PRINT_ONLY_SCRIPT = /^[0-9,$;~\s]*p$/;
export function sedTokensAreReadOnly(rest) {
    if (!rest.includes('-n'))
        return false;
    if (rest.some((token) => token.startsWith('-i') || token === '--in-place' || token.startsWith('--in-place='))) {
        return false;
    }
    if (rest.some((token) => token.startsWith('-f') || token === '--file' || token.startsWith('--file='))) {
        return false;
    }
    const expressionFlags = rest.filter((token) => token === '-e' || token === '--expression');
    if (expressionFlags.length > 1)
        return false;
    const eIndex = rest.findIndex((token) => token === '-e' || token === '--expression');
    const script = eIndex >= 0 ? rest[eIndex + 1] : positionals(rest, new Set([]))[0];
    return script !== undefined && SED_PRINT_ONLY_SCRIPT.test(script);
}
export function sedPipelineFilterIsReadOnly(rest) {
    if (!sedTokensAreReadOnly(rest))
        return false;
    const usesExpressionFlag = rest.some((token) => token === '-e' || token === '--expression');
    const pos = positionals(rest, new Set(['-e', '--expression']));
    return usesExpressionFlag ? pos.length === 0 : pos.length === 1;
}
export function isKnownReadCommand(command) {
    if (!command)
        return false;
    const argv = analyzeCommandShape(command);
    if (!argv || argv.length === 0)
        return false;
    const bin = binaryName(argv[0]);
    if (!READ_COMMAND_BINS.has(bin))
        return false;
    if (bin === 'sed')
        return sedTokensAreReadOnly(argv.slice(1));
    if ((bin === 'less' || bin === 'more') && argv.slice(1).some((token) => token.startsWith('+'))) {
        return false;
    }
    return true;
}
export function searchCommandHasSideEffects(command) {
    if (!command)
        return false;
    const argv = analyzeCommandShape(command);
    if (!argv || argv.length === 0)
        return true;
    const bin = binaryName(argv[0]);
    const rest = argv.slice(1);
    if (bin === 'find')
        return rest.some((token) => FIND_DESTRUCTIVE_FLAGS.has(token));
    if (bin === 'fd')
        return rest.some((token) => hasFdExecFlag(token));
    if (bin === 'rg' || bin === 'grep' || bin === 'egrep' || bin === 'fgrep' || bin === 'ag') {
        return rest.some((token) => token.startsWith('--pre'));
    }
    if (bin === 'tree')
        return rest.some((token) => token.startsWith('-') && /[oR]/.test(token));
    return false;
}
export function hasFdExecFlag(token) {
    if (token.startsWith('--exec'))
        return true;
    return /^-[a-zA-Z]/.test(token) && !token.startsWith('--') && /[xX]/.test(token);
}
export function splitTopLevel(input, separators) {
    const segments = [];
    let current = '';
    let quote = null;
    for (let index = 0; index < input.length; index += 1) {
        const ch = input[index];
        if (quote) {
            current += ch;
            if (ch === quote && (quote !== '"' || input[index - 1] !== '\\'))
                quote = null;
            continue;
        }
        if (ch === '\\' && input[index + 1] !== undefined) {
            current += ch + input[index + 1];
            index += 1;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '|' && input[index + 1] === '|' && !separators.includes('||'))
            return undefined;
        const matched = separators.find((sep) => input.startsWith(sep, index));
        if (matched === '&' &&
            ((index > 0 && input[index - 1] === '>') || input[index + 1] === '>')) {
            current += ch;
            continue;
        }
        if (matched) {
            segments.push(current);
            current = '';
            index += matched.length - 1;
            continue;
        }
        current += ch;
    }
    if (quote)
        return undefined;
    segments.push(current);
    return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}
export function tokenize(input) {
    const tokens = [];
    let current = '';
    let hasToken = false;
    let unquotedMeta = false;
    let hasQuoted = false;
    let quote = null;
    for (let index = 0; index < input.length; index += 1) {
        const ch = input[index];
        if (quote) {
            if (ch === quote) {
                quote = null;
            }
            else if (quote === '"' && ch === '\\' && input[index + 1] === '"') {
                current += '"';
                index += 1;
            }
            else {
                current += ch;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            hasToken = true;
            hasQuoted = true;
            continue;
        }
        if (ch === '\\' && input[index + 1] !== undefined) {
            const escaped = input[index + 1];
            if (/\s|["'\\<>();&|]/.test(escaped)) {
                current += escaped;
                hasToken = true;
                index += 1;
                continue;
            }
        }
        if (/\s/.test(ch)) {
            if (hasToken)
                tokens.push({ text: current, unquotedMeta, hasQuoted });
            current = '';
            hasToken = false;
            unquotedMeta = false;
            hasQuoted = false;
            continue;
        }
        if (ch === '<' || ch === '>' || ch === '(')
            unquotedMeta = true;
        current += ch;
        hasToken = true;
    }
    if (quote)
        return undefined;
    if (hasToken)
        tokens.push({ text: current, unquotedMeta, hasQuoted });
    return tokens;
}
export function stripPrefixTokens(words) {
    let start = 0;
    while (start < words.length &&
        !words[start].unquotedMeta &&
        (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start].text) || words[start].text === 'sudo')) {
        start += 1;
    }
    if (words[start]?.text === 'env' && !words[start].unquotedMeta) {
        start += 1;
        while (start < words.length) {
            const word = words[start];
            if (word.unquotedMeta)
                return undefined;
            const token = word.text;
            if (token === '--') {
                start += 1;
                break;
            }
            if (token === '-u' || token === '--unset' || token === '-C' || token === '--chdir') {
                const value = words[start + 1];
                if (!value || value.unquotedMeta)
                    return undefined;
                start += 2;
                continue;
            }
            if (token === '-i' || token === '--ignore-environment' || token === '-0' || token === '--null' ||
                token === '-v' || token === '--debug' || token.startsWith('--unset=') ||
                token.startsWith('--chdir=') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
                start += 1;
                continue;
            }
            if (token.startsWith('-'))
                return undefined;
            break;
        }
    }
    const out = [];
    for (let index = start; index < words.length; index += 1) {
        const word = words[index];
        if (!word.unquotedMeta) {
            out.push(word.text);
            continue;
        }
        const token = word.text;
        if (word.hasQuoted)
            return undefined;
        if (token.includes('<(') || token.includes('>(') || token.includes('=('))
            return undefined;
        if (token.includes('<>'))
            return undefined;
        if (token === '<') {
            const target = words[index + 1];
            index += 1;
            if (target?.unquotedMeta)
                return undefined;
            continue;
        }
        if (token.startsWith('<') && !token.slice(1).includes('<') && !token.slice(1).includes('>')) {
            continue;
        }
        const redirect = token.match(/^(?:\d?|&)(>>?)(.*)$/);
        if (redirect) {
            const targetWord = redirect[2] === '' ? words[index + 1] : undefined;
            const target = redirect[2] !== '' ? redirect[2] : targetWord?.text ?? '';
            if (redirect[2] === '')
                index += 1;
            if (!targetWord?.hasQuoted &&
                (target === '/dev/null' || /^&(\d+|-)$/.test(target))) {
                continue;
            }
            return undefined;
        }
        return undefined;
    }
    return out;
}
export function positionals(tokens, valueFlags) {
    const out = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === '--') {
            out.push(...tokens.slice(index + 1));
            break;
        }
        if (token.startsWith('-') && token.length > 1) {
            if (valueFlags.has(token))
                index += 1;
            continue;
        }
        out.push(token);
    }
    return out;
}
export function binaryName(token) {
    const base = basenameRemotePath(token) || token;
    return base.toLowerCase();
}
export function readNonEmptyString(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
